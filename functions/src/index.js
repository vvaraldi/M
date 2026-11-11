// Cloud Functions for the M dealer portal (Phase 2): requests, reservations, emails.
//
//   submitRequest   a signed-in shop user sends a request; stock is reserved for 7 days in ONE Firestore
//                   transaction (so two shops cannot take the last pair), then two emails go out.
//   updateRequest   cancel (shop or owner) / release, extend, mark invoiced (owner only).
//   getDocument     sends a private document (price list) to a shop entitled to it; no download link exists.
//   housekeeping    every hour: expires holds that ended and sends the day-5 reminder.
//
// All the rules live in planner.js (pure and unit-tested). This file only reads, calls the planner,
// writes, and sends mail. Email is sent from the owner's Gmail with an app password kept as the secret
// GMAIL_APP_PASSWORD (never in the code or the repository).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { checkDocumentAccess, contentTypeOf, MAX_PRIVATE_BYTES } from "./access.js";
import { scopeViews, normReserved } from "./scope.js";
import nodemailer from "nodemailer";
import { planSubmit, planAction, needsReminder, PlanError } from "./planner.js";
import { buildShopEmail, buildOwnerEmail, buildReminderEmail } from "./emails.js";

const OWNER_EMAIL = "vincent.varaldi@gmail.com";
const REGION = "us-central1";
const CORS = ["https://vvaraldi.github.io", "http://localhost:8766", "http://127.0.0.1:8766"];
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

const app = initializeApp();
const db = getFirestore(app, "m-dealer-db");
db.settings({ ignoreUndefinedProperties: true });

// ---------------------------------------------------------------- helpers
const fromFs = (v) => v instanceof Timestamp ? v.toDate()
  : Array.isArray(v) ? v.map(fromFs)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromFs(x)])) : v;

function authedEmail(req) {
  const t = req.auth && req.auth.token;
  if (!t || !t.email || t.email_verified !== true) throw new HttpsError("unauthenticated", "Please sign in.");
  return String(t.email).toLowerCase();
}

/** Turn a planner error into the error the browser receives. */
function toHttps(e) {
  if (e instanceof HttpsError) return e;
  if (e instanceof PlanError) {
    const code = e.code === "insufficient-stock" ? "failed-precondition" : e.code;
    return new HttpsError(code, e.message, { reason: e.code, ...e.details });
  }
  logger.error("Unexpected error", e);
  return new HttpsError("internal", "Something went wrong. Please try again.");
}

function transporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: OWNER_EMAIL, pass: GMAIL_APP_PASSWORD.value().replace(/\s+/g, "") }   // app passwords are shown in groups of 4
  });
}
async function sendMail(to, msg) {
  return transporter().sendMail({
    from: `"M" <${OWNER_EMAIL}>`, to, replyTo: OWNER_EMAIL,
    subject: msg.subject, text: msg.text, html: msg.html, attachments: msg.attachments
  });
}
const settledStatus = (r) => (r.status === "fulfilled" ? "sent" : "failed");
/** Describes the saved Gmail password WITHOUT revealing it: only counts of each kind of character. */
function secretShape() {
  const v = GMAIL_APP_PASSWORD.value().replace(/\s+/g, "");
  const n = (re) => (v.match(re) || []).length;
  return `${v.length} characters (${n(/[a-z]/g)} lowercase, ${n(/[A-Z]/g)} uppercase, ${n(/[0-9]/g)} digits, ${n(/[^a-zA-Z0-9]/g)} other). A Google app password is 16 lowercase letters`;
}
/** Short, safe description of an email error (never contains the password). */
const errText = (e) => `${(e && (e.code || e.responseCode)) || ""} ${(e && (e.response || e.message)) || e}`.trim().replace(/\s+/g, " ").slice(0, 300);

/**
 * Write what is reserved for one brand: reserved/<brand> (total + per scope, read by shops that see all warehouses) and the
 * two "held" views read by scope-limited shops (reserved/<brand>__w1, __w2). Shops never see where stock is:
 * each only reads the numbers for its own scope.
 */
function writeReserved(tx, brand, map, byScope, items, stockDetail) {
  const updatedAt = Timestamp.now(), views = scopeViews(byScope, items, stockDetail);
  tx.set(db.doc(`reserved/${brand}`), { map, byScope, updatedAt });
  tx.set(db.doc(`reserved/${brand}__w1`), { map: views.w1, updatedAt });
  tx.set(db.doc(`reserved/${brand}__w2`), { map: views.w2, updatedAt });
}

// ---------------------------------------------------------------- submitRequest
// invoker "public": the web page calls the function directly; the sign-in is checked INSIDE (authedEmail) and by the rules.
export const submitRequest = onCall({ region: REGION, cors: CORS, invoker: "public", secrets: [GMAIL_APP_PASSWORD], maxInstances: 5 }, async (req) => {
  const email = authedEmail(req);
  const input = req.data || {};
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const brandKeys = [...new Set(rawLines.map((l) => l && l.brandKey).filter((k) => typeof k === "string" && /^[a-z0-9]+$/.test(k)))].slice(0, 10);

  let done;
  try {
    done = await db.runTransaction(async (tx) => {
      // ---- all reads first
      const userSnap = await tx.get(db.doc(`users/${email}`));
      if (!userSnap.exists) throw new PlanError("permission-denied", "You are not invited to the portal.");
      const user = { ...userSnap.data(), email };
      const counterRef = db.doc("counters/requests");
      const refs = [
        db.doc(`shops/${user.shopId}`), db.doc("admin/locations"), counterRef,
        db.doc(`shopsPrivate/${user.shopId}`), db.doc("stock/meta"),
        ...brandKeys.map((k) => db.doc(`stock/items__${k}`)),
        ...brandKeys.map((k) => db.doc(`prices/${user.priceTier}__${k}`)),
        ...brandKeys.map((k) => db.doc(`reserved/${k}`))
      ];
      const snaps = await tx.getAll(...refs);
      const [shopSnap, locSnap, counterSnap, shopPrivSnap, metaSnap] = snaps;
      const n = brandKeys.length, at = (i, j) => snaps[5 + i * n + j];
      const itemsDocs = {}, priceDocs = {}, reservedDocs = {};
      brandKeys.forEach((k, j) => {
        if (at(0, j).exists) itemsDocs[k] = fromFs(at(0, j).data());
        if (at(1, j).exists) priceDocs[k] = fromFs(at(1, j).data());
        reservedDocs[k] = at(2, j).exists ? fromFs(at(2, j).data()) : { map: {} };
      });
      const seq = counterSnap.exists ? counterSnap.data().next : 1;

      // ---- decide
      const plan = planSubmit({
        user, shop: shopSnap.exists ? shopSnap.data() : null, input, itemsDocs, priceDocs, reservedDocs,
        locations: locSnap.exists ? (locSnap.data().locations || {}) : {}, now: new Date(), seq,
        stockDetail: locSnap.exists ? (locSnap.data().stock || {}) : {},
        shopPrivate: shopPrivSnap.exists ? shopPrivSnap.data() : null,
        stockAsOf: metaSnap.exists ? (metaSnap.data().stockRefreshedAt || metaSnap.data().generatedAt || null) : null
      });

      // ---- then write, all or nothing
      tx.set(db.doc(`requests/${plan.request.number}`), plan.request);
      tx.set(db.doc(`requestsPrivate/${plan.request.number}`), plan.priv);
      const detail = locSnap.exists ? (locSnap.data().stock || {}) : {};
      for (const [k, map] of Object.entries(plan.reserved)) writeReserved(tx, k, map, plan.byScope[k], (itemsDocs[k] || {}).items, detail);
      tx.set(counterRef, { next: seq + 1 });
      return plan;
    });
  } catch (e) { throw toHttps(e); }

  // ---- emails (a failure here never undoes the request)
  const { request, priv } = done;
  const results = await Promise.allSettled([
    sendMail(OWNER_EMAIL, buildOwnerEmail(request, priv)),
    sendMail(request.userEmail, buildShopEmail(request))
  ]);
  results.forEach((r) => { if (r.status === "rejected") logger.error("Email failed for " + request.number, r.reason); });
  const firstError = results.find((r) => r.status === "rejected");
  await db.doc(`requests/${request.number}`).update({
    emails: { owner: settledStatus(results[0]), shop: settledStatus(results[1]), error: firstError ? errText(firstError.reason) + " | Saved password: " + secretShape() : "" }
  }).catch(() => {});
  return { number: request.number, status: request.status, expiresAt: request.expiresAt.toISOString(), emailed: settledStatus(results[1]) === "sent" };
});

// ---------------------------------------------------------------- updateRequest
const ACTIONS = new Set(["cancel", "release", "invoice", "extend"]);

async function applyAction(id, action, actor) {
  return db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(db.doc(`requests/${id}`));
    if (!reqSnap.exists) throw new PlanError("not-found", "Request not found.");
    const request = fromFs(reqSnap.data());
    let shopId = actor.shopId || null;
    if (!actor.isAdmin && !actor.isSystem) {
      const u = await tx.get(db.doc(`users/${actor.email}`));
      if (!u.exists || u.data().active !== true) throw new PlanError("permission-denied", "Your account is not active.");
      shopId = u.data().shopId;
    }
    const keys = [...new Set((request.lines || []).map((l) => l.brandKey))];
    const rsnaps = keys.length ? await tx.getAll(...keys.map((k) => db.doc(`reserved/${k}`)), ...keys.map((k) => db.doc(`stock/items__${k}`)), db.doc("admin/locations")) : [];
    const reservedDocs = {}, itemsOf = {};
    keys.forEach((k, i) => {
      reservedDocs[k] = rsnaps[i].exists ? fromFs(rsnaps[i].data()) : { map: {} };
      itemsOf[k] = rsnaps[keys.length + i].exists ? (rsnaps[keys.length + i].data().items || []) : [];
    });
    const locSnap = rsnaps[2 * keys.length], detail = locSnap && locSnap.exists ? (locSnap.data().stock || {}) : {};

    const plan = planAction({ action, request, actor: { ...actor, shopId }, now: new Date(), reservedDocs });
    tx.update(db.doc(`requests/${id}`), plan.patch);
    if (plan.reserved) for (const [k, map] of Object.entries(plan.reserved)) writeReserved(tx, k, map, plan.byScope[k], itemsOf[k], detail);
    return { request, patch: plan.patch };
  });
}

export const updateRequest = onCall({ region: REGION, cors: CORS, invoker: "public", secrets: [GMAIL_APP_PASSWORD], maxInstances: 5 }, async (req) => {
  const email = authedEmail(req);
  const { id, action } = req.data || {};
  if (typeof id !== "string" || !/^R-\d{4,}$/.test(id) || !ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Invalid request.");
  let res;
  try { res = await applyAction(id, action, { isAdmin: email === OWNER_EMAIL, email }); }
  catch (e) { throw toHttps(e); }

  // tell the owner when a shop cancels on its own
  if (action === "cancel" && email !== OWNER_EMAIL) {
    sendMail(OWNER_EMAIL, {
      subject: `Request ${id} cancelled by ${res.request.shopName}`,
      text: `${res.request.shopName} (${email}) cancelled request ${id}. The reserved items were released.`,
      html: `<p><b>${res.request.shopName}</b> (${email}) cancelled request <b>${id}</b>. The reserved items were released.</p>`
    }).catch((e) => logger.error("Owner cancel mail failed", e));
  }
  return { id, status: res.patch.status || res.request.status, expiresAt: (res.patch.expiresAt || res.request.expiresAt).toISOString() };
});

// ---------------------------------------------------------------- email check (owner only)
// Sends a test email to the owner and reports the exact reason when it fails, so the setup can be checked
// from the Admin page without reading logs. It also reports how many characters the stored password has
// (an app password has 16) but never the password itself.
export const sendTestEmail = onCall({ region: REGION, cors: CORS, invoker: "public", secrets: [GMAIL_APP_PASSWORD], maxInstances: 2 }, async (req) => {
  const email = authedEmail(req);
  if (email !== OWNER_EMAIL) throw new HttpsError("permission-denied", "Only the portal owner can do this.");
  const secretLength = GMAIL_APP_PASSWORD.value().replace(/\s+/g, "").length;
  try {
    const info = await sendMail(OWNER_EMAIL, {
      subject: "M portal: test email",
      text: "This is a test from the M dealer portal. If you can read it, request emails will work.",
      html: "<p>This is a test from the <b>M dealer portal</b>. If you can read it, request emails will work.</p>"
    });
    return { ok: true, accepted: info.accepted || [], secretLength };
  } catch (e) {
    logger.error("Test email failed", e);
    return { ok: false, error: errText(e), secretLength, shape: secretShape() };
  }
});

// ---------------------------------------------------------------- refreshReserved (owner only)
// After a stock upload the warehouse quantities change, so what scope-limited shops see as "held" must be
// recomputed. The Admin page calls this right after publishing. It also converts old reservation documents (no per-scope part).
export const refreshReserved = onCall({ region: REGION, cors: CORS, invoker: "public", maxInstances: 2 }, async (req) => {
  const email = authedEmail(req);
  if (email !== OWNER_EMAIL) throw new HttpsError("permission-denied", "Only the portal owner can do this.");
  const stockDocs = await db.collection("stock").get();
  const brands = stockDocs.docs.map((d) => d.id).filter((id) => /^items__[a-z0-9]+$/.test(id)).map((id) => id.slice(7));
  let refreshed = 0;
  for (const k of brands) {
    await db.runTransaction(async (tx) => {
      const [rs, is, ls] = await tx.getAll(db.doc(`reserved/${k}`), db.doc(`stock/items__${k}`), db.doc("admin/locations"));
      const n = normReserved(rs.exists ? fromFs(rs.data()) : null);
      writeReserved(tx, k, n.map, n.byScope, is.exists ? (is.data().items || []) : [], ls.exists ? (ls.data().stock || {}) : {});
    });
    refreshed++;
  }
  return { refreshed };
});

// ---------------------------------------------------------------- getDocument
// A PRIVATE document (price lists) has no download link. The portal asks here; the function checks that the user is
// active, has the brand and is in the region of the document, then sends the file in the reply and logs the download.
// A public document (catalog) just gets its link back. The owner can always fetch any document.
const STORAGE_BUCKET = "m-dealer-portal.firebasestorage.app";
export const getDocument = onCall({ region: REGION, cors: CORS, invoker: "public", maxInstances: 5, memory: "512MiB" }, async (req) => {
  const email = authedEmail(req);
  const id = req.data && req.data.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(id)) throw new HttpsError("invalid-argument", "Invalid document.");
  const isOwner = email === OWNER_EMAIL;
  const [libSnap, userSnap] = await Promise.all([db.doc("admin/library").get(), isOwner ? null : db.doc(`users/${email}`).get()]);
  const record = ((libSnap.exists && libSnap.data().docs) || []).find((r) => r && r.id === id);
  const user = userSnap && userSnap.exists ? userSnap.data() : null;
  const reason = isOwner ? (record ? "" : "not-found") : checkDocumentAccess(user, record);
  if (reason === "denied") throw new HttpsError("permission-denied", "Your account is not active.");
  if (reason) throw new HttpsError("not-found", "This document is not available.");

  if (!record.private) return { url: record.file.url, name: record.file.name };
  if ((record.file.size || 0) > MAX_PRIVATE_BYTES) throw new HttpsError("failed-precondition", "This file is too large to send privately.");
  let buf;
  try { [buf] = await getStorage().bucket(STORAGE_BUCKET).file(record.file.path).download(); }
  catch (e) { logger.error("Document read failed " + id, e); throw new HttpsError("internal", "The file could not be read. Please try again later."); }
  if (!isOwner) {
    db.collection("downloads").add({ email, shopId: user.shopId || "", shopName: user.shopName || "", docId: id, title: record.title, brandKey: record.brandKey, kind: record.kind, at: Timestamp.now() })
      .catch((e) => logger.error("Download log failed", e));   // a logging problem never blocks the download
  }
  return { name: record.file.name, contentType: contentTypeOf(record.file.name), base64: buf.toString("base64") };
});

// ---------------------------------------------------------------- housekeeping
export const housekeeping = onSchedule(
  { schedule: "every 60 minutes", timeZone: "America/Toronto", region: REGION, secrets: [GMAIL_APP_PASSWORD], retryCount: 0 },
  async () => {
    const snap = await db.collection("requests").where("status", "==", "reserved").get();
    const now = new Date();
    let expired = 0, reminded = 0;
    for (const d of snap.docs) {
      const r = fromFs(d.data());
      try {
        if (r.expiresAt.getTime() <= now.getTime()) {
          await applyAction(d.id, "expire", { isSystem: true });
          expired++;
        } else if (needsReminder(r, now)) {
          await sendMail(r.userEmail, buildReminderEmail(r));
          await d.ref.update({ reminderSent: true });
          reminded++;
        }
      } catch (e) { logger.error(`Housekeeping failed for ${d.id}`, e); }
    }
    logger.info(`housekeeping: ${snap.size} reserved, ${expired} expired, ${reminded} reminders`);
  });
