// Request and reservation logic as PURE functions: they take data that was already read and return
// what to write. No Firebase here, so the same code runs in the Cloud Functions, in the unit tests
// and in the browser test stand-in. The Cloud Function wraps these in one Firestore transaction,
// which is what makes a reservation safe when two shops order the last pair at the same moment.

import { scopeOf, capacities, maxAddable, normReserved, SCOPE_NAME } from "./scope.js";

export const RESERVATION_DAYS = 7;
export const REMINDER_BEFORE_DAYS = 2;   // reminder on day 5 of 7
const DAY = 24 * 60 * 60 * 1000;

export class PlanError extends Error {
  /** code: 'invalid-argument' | 'not-found' | 'insufficient-stock' | 'permission-denied' | 'failed-precondition' */
  constructor(code, message, details = {}) { super(message); this.name = "PlanError"; this.code = code; this.details = details; }
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isKey = (k) => typeof k === "string" && /^[a-z0-9]+$/.test(k);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const requestNumber = (seq) => "R-" + String(seq).padStart(4, "0");

/** Quantity still available to request: what the last stock upload says minus what is already reserved. */
export function effectiveAvailable(item, reservedMap) {
  return Math.max(0, (item.available || 0) - ((reservedMap && reservedMap[item.id]) || 0));
}

function cleanText(v, max, field) {
  if (v == null || v === "") return "";
  if (typeof v !== "string") throw new PlanError("invalid-argument", `${field} must be text.`);
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (s.length > max) throw new PlanError("invalid-argument", `${field} is too long (maximum ${max} characters).`);
  return s;
}

/**
 * Plan a new request.
 * ctx: { user, shop, input:{lines:[{brandKey,itemId,qty}], addressIndex, po, notes, shipDate},
 *        itemsDocs:{brandKey:{brand,items:[]}}, priceDocs:{brandKey:{prices:{}}},
 *        reservedDocs:{brandKey:{map:{}, byScope?:{all,w1,w2}}}, locations:{itemId:{Eastman:n,CDEC:n}}, now:Date, seq:number }
 * The user's stockScope ("all" | "w1" = Eastman only | "w2" = CDEC only; opaque codes, see scope.js) limits which warehouse
 * stock the request may draw on. Returns { request, priv, reserved:{brandKey: newTotalMap}, byScope:{brandKey:{all,w1,w2}} }
 */
export function planSubmit(ctx) {
  const { user, shop, input, itemsDocs = {}, priceDocs = {}, reservedDocs = {}, locations = {}, now, seq,
    shopPrivate = null, stockDetail = {}, stockAsOf = null } = ctx;
  if (!user || user.active !== true) throw new PlanError("permission-denied", "Your account is not active.");
  if (!shop) throw new PlanError("failed-precondition", "Your shop profile was not found.");
  const brands = Array.isArray(user.brands) ? user.brands : [];
  const rawLines = input && input.lines;
  if (!Array.isArray(rawLines) || rawLines.length < 1) throw new PlanError("invalid-argument", "The request has no items.");
  if (rawLines.length > 100) throw new PlanError("invalid-argument", "A request can have at most 100 lines.");

  const scope = scopeOf(user);
  const seen = new Set(), lines = [], newReserved = {}, newByScope = {};
  for (const [n, l] of rawLines.entries()) {
    if (!l || !isKey(l.brandKey) || typeof l.itemId !== "string" || !l.itemId) throw new PlanError("invalid-argument", `Line ${n + 1} is not valid.`);
    if (!brands.includes(l.brandKey)) throw new PlanError("permission-denied", "This brand is not enabled for your account.", { brandKey: l.brandKey });
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100000) throw new PlanError("invalid-argument", `Line ${n + 1}: the quantity must be a whole number of at least 1.`);
    if (seen.has(l.itemId)) throw new PlanError("invalid-argument", "The same item appears twice in the request.");
    seen.add(l.itemId);

    const doc = itemsDocs[l.brandKey];
    const item = doc && Array.isArray(doc.items) ? doc.items.find((i) => i.id === l.itemId) : null;
    if (!item) throw new PlanError("not-found", "An item in your request is no longer in stock.", { itemId: l.itemId });
    if (!newReserved[l.brandKey]) { const n = normReserved(reservedDocs[l.brandKey]); newReserved[l.brandKey] = n.map; newByScope[l.brandKey] = n.byScope; }
    const reservedMap = newReserved[l.brandKey], by = newByScope[l.brandKey];
    const eff = maxAddable(scope, capacities(item, stockDetail[item.id]),
      { all: by.all[item.id] || 0, w1: by.w1[item.id] || 0, w2: by.w2[item.id] || 0 });
    const label = [item.description, item.size].filter(Boolean).join(" ");
    if (l.qty < (item.minQty || 1)) throw new PlanError("invalid-argument", `${label}: the minimum quantity is ${item.minQty}.`, { itemId: item.id, minQty: item.minQty });
    if (l.qty > eff) throw new PlanError("insufficient-stock", `Not enough stock for ${label}: ${eff} available.`, { itemId: item.id, description: label, available: eff });

    const price = priceDocs[l.brandKey] && priceDocs[l.brandKey].prices ? priceDocs[l.brandKey].prices[item.id] : null;
    const unitPrice = price && typeof price.p === "number" ? price.p : null;
    lines.push({
      itemId: item.id, brandKey: l.brandKey, brand: doc.brand || l.brandKey, code: item.code || "", sku: item.sku || "",
      description: item.description, size: item.size || "", color: item.color || "", condition: item.condition, unit: item.unit,
      qty: l.qty, unitPrice, msrp: price && typeof price.m === "number" ? price.m : null, est: !!(price && price.est),
      lineTotal: unitPrice == null ? null : round2(unitPrice * l.qty), priceTbd: unitPrice == null,
      // previous-season rebate carried by the price: the invoice draft puts it on the line like the workbook's invoice editor does
      listPrice: price && Number.isInteger(price.pct) && typeof price.b === "number" ? price.b : null,
      rebatePct: price && Number.isInteger(price.pct) && price.pct > 0 ? price.pct : null,
      rebateReason: price && Number.isInteger(price.pct) && price.pct > 0 ? "Previous season" : ""
    });
    reservedMap[item.id] = (reservedMap[item.id] || 0) + l.qty;
    by[scope][item.id] = (by[scope][item.id] || 0) + l.qty;
  }

  // delivery address: one of the shop's saved addresses (up to 3), chosen by index
  const addrs = Array.isArray(shop.addresses) ? shop.addresses : [];
  let shipTo = null;
  if (addrs.length) {
    const i = input.addressIndex;
    if (!Number.isInteger(i) || i < 0 || i >= addrs.length) throw new PlanError("invalid-argument", "Please choose a delivery address.");
    shipTo = { label: addrs[i].label || "", text: addrs[i].text || "" };
  }
  const po = cleanText(input.po, 60, "PO number"), notes = cleanText(input.notes, 1000, "Notes");
  let shipDate = null;
  if (input.shipDate) {
    if (typeof input.shipDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.shipDate)) throw new PlanError("invalid-argument", "The requested ship date is not valid.");
    const t = Date.parse(input.shipDate + "T12:00:00Z");
    if (isNaN(t) || t < now.getTime() - 2 * DAY || t > now.getTime() + 400 * DAY) throw new PlanError("invalid-argument", "The requested ship date is out of range.");
    shipDate = input.shipDate;
  }

  const priced = lines.filter((l) => !l.priceTbd);
  const request = {
    schema: 1, number: requestNumber(seq), seq, status: "reserved", stockScope: scope,
    shopId: user.shopId, shopName: shop.name || user.shopName || "", userEmail: user.email,
    language: user.language || shop.language || "en", currency: user.currency || shop.currency, priceTier: user.priceTier,
    shipTo, po, notes, shipDate, lines,
    subtotal: round2(priced.reduce((s, l) => s + l.lineTotal, 0)), hasTbd: lines.length > priced.length,
    createdAt: now, expiresAt: addDays(now, RESERVATION_DAYS), extendedCount: 0, reminderSent: false,
    statusChangedAt: now, statusChangedBy: user.email
  };
  // Everything the owner needs for invoicing and shipping but a shop must never read lives here, apart from the request:
  //  - warehouse stock per item (available, plus on hand and quantities held by Excel draft invoices) as of the last stock upload
  //  - how many of each item open portal requests hold in total after this request (so a draft invoice is not counted twice)
  //  - the shop's private customer details (workbook customer number, tax mode, province, billing address)
  const sp = shopPrivate || {};
  const txt = (v) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
  const priv = {
    number: request.number, createdAt: now, stockScope: SCOPE_NAME[scope],   // readable name for the owner's export (the request itself only carries the opaque code)
    stockAsOf: typeof stockAsOf === "string" ? stockAsOf : null,
    lines: Object.fromEntries(lines.map((l) => [l.itemId, locations[l.itemId] || {}])),
    stock: Object.fromEntries(lines.map((l) => [l.itemId, stockDetail[l.itemId] || {}])),
    held: Object.fromEntries(lines.map((l) => [l.itemId, (newReserved[l.brandKey] && newReserved[l.brandKey][l.itemId]) || l.qty])),
    shop: {
      customerId: txt(sp.customerId), country: txt(sp.country), province: txt(sp.province), taxMode: txt(sp.taxMode), billTo: txt(sp.billTo),
      addresses: (Array.isArray(shop.addresses) ? shop.addresses : []).slice(0, 3).map((a) => ({ label: txt(a && a.label), text: txt(a && a.text) }))
    }
  };
  return { request, priv, reserved: newReserved, byScope: newByScope };
}

/** New reserved maps (totals) and per-scope maps after releasing every line of `request`. */
export function planReleaseScoped(request, reservedDocs = {}) {
  const maps = {}, byScope = {}, scope = scopeOf({ stockScope: request.stockScope });   // requests from before scopes existed are "all"
  const take = (m, id, q) => { const left = (m[id] || 0) - q; if (left > 0) m[id] = left; else delete m[id]; };
  for (const l of request.lines || []) {
    if (!maps[l.brandKey]) { const n = normReserved(reservedDocs[l.brandKey]); maps[l.brandKey] = n.map; byScope[l.brandKey] = n.byScope; }
    take(maps[l.brandKey], l.itemId, l.qty);
    take(byScope[l.brandKey][scope], l.itemId, l.qty);
  }
  return { maps, byScope };
}
/** Same, totals only. */
export const planRelease = (request, reservedDocs = {}) => planReleaseScoped(request, reservedDocs).maps;

/**
 * Plan a status change. action: 'cancel' | 'release' | 'invoice' | 'extend' | 'expire'
 * actor: { isAdmin, email, shopId }  (for 'expire' the system calls with { isSystem: true })
 * Returns { patch, reserved|null } where patch is merged into the request document.
 */
export function planAction({ action, request, actor, now, reservedDocs = {} }) {
  if (!request) throw new PlanError("not-found", "Request not found.");
  const st = request.status, base = { statusChangedAt: now, statusChangedBy: actor.isSystem ? "system" : actor.email };
  const needAdmin = () => { if (!actor.isAdmin && !actor.isSystem) throw new PlanError("permission-denied", "Only the portal owner can do this."); };
  const release = () => planReleaseScoped(request, reservedDocs);
  const out = (patch, rel) => ({ patch, reserved: rel ? rel.maps : null, byScope: rel ? rel.byScope : null });

  switch (action) {
    case "cancel":
      if (!actor.isAdmin && !(actor.shopId && actor.shopId === request.shopId)) throw new PlanError("permission-denied", "This request belongs to another shop.");
      if (st !== "reserved") throw new PlanError("failed-precondition", "Only a reserved request can be cancelled.");
      return out({ ...base, status: "cancelled" }, release());
    case "release":
      needAdmin();
      if (st !== "reserved") throw new PlanError("failed-precondition", "Only a reserved request can be released.");
      return out({ ...base, status: "released" }, release());
    case "invoice":
      needAdmin();
      if (!["reserved", "expired", "released"].includes(st)) throw new PlanError("failed-precondition", `A ${st} request cannot be marked invoiced.`);
      return out({ ...base, status: "invoiced" }, st === "reserved" ? release() : null);
    case "extend": {
      needAdmin();
      if (st !== "reserved") throw new PlanError("failed-precondition", "Only a reserved request can be extended.");
      const from = Math.max(now.getTime(), request.expiresAt.getTime());
      return out({ ...base, expiresAt: new Date(from + RESERVATION_DAYS * DAY), reminderSent: false, extendedCount: (request.extendedCount || 0) + 1 }, null);
    }
    case "expire":
      if (!actor.isSystem) throw new PlanError("permission-denied", "Only the system expires requests.");
      if (st !== "reserved" || request.expiresAt.getTime() > now.getTime()) throw new PlanError("failed-precondition", "Nothing to expire.");
      return out({ ...base, status: "expired" }, release());
    default:
      throw new PlanError("invalid-argument", "Unknown action.");
  }
}

/** True when a reminder should go out now (reserved, 2 days or less left, not sent yet). */
export function needsReminder(request, now) {
  return request.status === "reserved" && !request.reminderSent
    && request.expiresAt.getTime() > now.getTime()
    && request.expiresAt.getTime() - now.getTime() <= REMINDER_BEFORE_DAYS * DAY;
}
