// Admin page (owner only): shops, users, brands, invitations and the stock upload.
// The real protection is in firestore.rules; the checks here are for a clear user experience.
import {
  auth, db, onAuthStateChanged, signOut, doc, getDoc, getDocs, collection, writeBatch,
  serverTimestamp, sendLink, emailKey, callFn, storageUpload, storageDelete
} from "./fb.js";
import { SCOPE_LABEL, scopeOf, scopeItems, itemsDocId, reservedDocId } from "./stockscope.js";
import { REGIONS, KINDS, regionFromCurrency, regionLabel, buildManifests, validateRecord, safeFileName, humanSize, privateByDefault } from "./library.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import { h } from "./render.js";
import { setLang, dateLabel, money } from "./i18n.js";
import { createStockView } from "./stockview.js";
import { exportShape, requestCsv } from "./requestexport.js";
import { normCountry, normProvince, COUNTRIES, PROVINCES } from "./customer.js";

// suggestions for the country and province fields (the workbook's own spellings)
document.getElementById("dl-country").replaceChildren(...COUNTRIES.map((c) => h("option", { value: c })));
document.getElementById("dl-prov").replaceChildren(...PROVINCES.map((p) => h("option", { value: p })));

const $ = (id) => document.getElementById(id);
const show = (name) => ["loading", "noaccess", "app"].forEach((v) => { $("view-" + v).hidden = v !== name; });

let shops = [], users = [], shopsPriv = {};   // shopsPriv: shopId -> private customer details (owner only)
let brandNames = {};           // key -> display name, from admin/brands and from what shops already use
let editing = null;            // { id|null, users:[{email,userActive,existing,override:null|[keys]}], removed:[email] }
let pendingFile = null;

const TIER_RE = /^(SHOP|RETAIL|EXPORT)_(CAD|USD|EUR)$/;
const KEY_RE = /^[a-z0-9]+$/;
const ITEM_KEYS = ["id", "brand", "code", "sku", "category", "family", "description", "size", "color", "condition", "available", "unit", "minQty", "img",
  "previousSeason"];   // the age and last season stay in the export file only: shops see the badge and the label, not the age
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// ------------------------------------------------------------------ small helpers
let toastTimer;
function toast(msg, isError) {
  document.querySelectorAll(".toast").forEach((n) => n.remove());
  const el = h("div", { class: "toast" + (isError ? " err" : ""), role: "status", text: msg });
  document.body.append(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), isError ? 7000 : 3500);
}
const tierOf = (type, cur) => `${type}_${cur}`;
const fmtDateTime = (v) => {
  const d = v && v.toDate ? v.toDate() : v ? new Date(v) : null;
  return d && !isNaN(d) ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(d) : "–";
};
/** Same rule as tools/export_stock.py: lower case letters and digits only. */
const brandKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const brandLabel = (key) => brandNames[key] || key;
const brandKeysSorted = () => Object.keys(brandNames).sort((a, b) => brandLabel(a).localeCompare(brandLabel(b)));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// ------------------------------------------------------------------ tabs
const TABS = ["shops", "requests", "view", "docs", "stock"];
function selectTab(name) {
  for (const t of TABS) {
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
    $("panel-" + t).hidden = t !== name;
  }
  if (name !== "view") setLang("en");   // the shop view may use another language; the admin pages stay in English
  if (name === "stock") loadPublished();
  if (name === "requests") loadRequests();
  if (name === "view") openShopView();
  if (name === "docs") loadDocs();
}
for (const t of TABS) $("tab-" + t).addEventListener("click", () => selectTab(t));
$("signout").addEventListener("click", () => signOut(auth));

// ------------------------------------------------------------------ shops
async function loadShops() {
  const [s, u, b, p] = await Promise.all([
    getDocs(collection(db, "shops")), getDocs(collection(db, "users")), getDoc(doc(db, "admin", "brands")), getDocs(collection(db, "shopsPrivate"))
  ]);
  shops = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, c) => a.name.localeCompare(c.name));
  users = u.docs.map((d) => ({ ...d.data(), email: d.id }));
  shopsPriv = Object.fromEntries(p.docs.map((d) => [d.id, d.data()]));
  brandNames = {};
  if (b.exists() && b.data().brands) Object.assign(brandNames, b.data().brands);
  // brands already granted to a shop or user stay selectable even if no stock exists for them right now
  for (const x of [...shops, ...users]) for (const k of x.brands || []) if (!brandNames[k]) brandNames[k] = k;
  for (const x of users) for (const k of x.brandsOverride || []) if (!brandNames[k]) brandNames[k] = k;
  renderShops();
}

function renderShops() {
  const body = $("shops-table").querySelector("tbody");
  body.replaceChildren();
  $("shops-empty").hidden = shops.length > 0;
  const unset = shops.filter((s) => !Array.isArray(s.brands));
  $("migrate-box").hidden = unset.length === 0;
  $("migrate-count").textContent = unset.length;
  for (const s of shops) {
    const mine = users.filter((u) => u.shopId === s.id);
    const edit = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit" });
    edit.addEventListener("click", () => openEditor(s));
    const brands = Array.isArray(s.brands) ? (s.brands.length ? s.brands.map(brandLabel).join(", ") : "none") : "not set";
    body.append(h("tr", {},
      h("td", {}, h("b", { text: s.name }), (shopsPriv[s.id] && shopsPriv[s.id].customerId) ? h("span", { class: "hint", style: "display:block", text: shopsPriv[s.id].customerId }) : null),
      h("td", { text: `${s.priceType || "SHOP"} · ${s.currency}` }, h("span", { class: "hint", style: "display:block", text: regionLabel(s.region || regionFromCurrency(s.currency)) }),
        scopeOf(s) !== "all" ? h("span", { class: "hint warn-text", style: "display:block", text: SCOPE_LABEL[scopeOf(s)] }) : null),
      h("td", { class: Array.isArray(s.brands) ? "" : "warn-text", text: brands }),
      h("td", { text: (s.language || "en").toUpperCase() }),
      h("td", { text: mine.length ? mine.map((u) => u.email + (Array.isArray(u.brandsOverride) ? " *" : "")).join(", ") : "–" }),
      h("td", {}, h("span", { class: "status " + (s.active ? "s-on" : "s-off"), text: s.active ? "Active" : "Inactive" })),
      h("td", {}, edit)));
  }
}

// One-click migration: shops created before brands existed get SkiTrab (what they could see until now).
$("migrate-btn").addEventListener("click", async () => {
  const unset = shops.filter((s) => !Array.isArray(s.brands));
  if (!unset.length) return;
  if (!confirm(`Give SkiTrab to ${unset.length} shop(s) that have no brand yet? You can change it per shop afterwards.`)) return;
  const btn = $("migrate-btn"); btn.disabled = true;
  try {
    const batch = writeBatch(db);
    for (const s of unset) {
      batch.set(doc(db, "shops", s.id), { brands: ["skitrab"] }, { merge: true });
      for (const u of users.filter((x) => x.shopId === s.id)) {
        batch.set(doc(db, "users", u.email), { brands: Array.isArray(u.brandsOverride) ? u.brandsOverride : ["skitrab"] }, { merge: true });
      }
    }
    await batch.commit();
    toast("SkiTrab added to the shops that had no brand.");
    await loadShops();
  } catch (e) { console.error(e); toast(`Could not update: ${e.code || e.message}`, true); }
  finally { btn.disabled = false; }
});

// ---- editor dialog
function addressBlock(i, a) {
  return h("div", { class: "addr" },
    h("div", { class: "field", style: "margin-bottom:8px" },
      h("label", { for: `a-label-${i}`, text: `Address ${i + 1} name (e.g. Warehouse)` }),
      h("input", { id: `a-label-${i}`, maxlength: "60", value: a.label || "" })),
    h("div", { class: "field", style: "margin:0" },
      h("label", { for: `a-text-${i}`, text: "Address" }),
      h("textarea", { id: `a-text-${i}`, rows: "3", maxlength: "300", text: a.text || "" })));
}

function brandChecks(idPrefix, selected, onChange) {
  const keys = brandKeysSorted();
  if (!keys.length) return [h("span", { class: "hint", text: "No brand known yet. Publish the stock once first." })];
  return keys.map((k) => {
    const cb = h("input", { type: "checkbox", id: `${idPrefix}-${k}`, value: k });
    cb.checked = selected.includes(k);
    cb.addEventListener("change", () => onChange(k, cb.checked));
    return h("label", { class: "check", style: "font-weight:400" }, cb, brandLabel(k));
  });
}

function renderShopBrands() {
  $("f-brands").replaceChildren(...brandChecks("fb", editing.brands, (k, on) => {
    editing.brands = on ? [...new Set([...editing.brands, k])] : editing.brands.filter((x) => x !== k);
  }));
}

function renderEditorUsers() {
  const box = $("users");
  box.replaceChildren();
  if (!editing.users.length) box.append(h("p", { class: "hint", text: "No user yet." }));
  editing.users.forEach((u, idx) => {
    const cb = h("input", { type: "checkbox", id: `u-act-${idx}`, "aria-label": `Active: ${u.email}` });
    cb.checked = u.userActive;
    cb.addEventListener("change", () => { u.userActive = cb.checked; });
    const send = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Send sign-in email" });
    if (!u.existing) { send.disabled = true; send.title = "Save the shop first"; }
    send.addEventListener("click", async () => {
      send.disabled = true;
      try { await sendLink(u.email, $("f-lang").value, false); toast(`Sign-in email sent to ${u.email}`); }
      catch (e) { console.error(e); toast(`Could not send to ${u.email}: ${e.code || e.message}`, true); }
      finally { send.disabled = false; }
    });
    const rm = h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Remove" });
    rm.addEventListener("click", () => {
      if (u.existing) editing.removed.push(u.email);
      editing.users.splice(idx, 1); renderEditorUsers();
    });
    // per-user brands: same as the shop (default) or a custom list
    const mode = h("select", { class: "sel", id: `u-mode-${idx}`, "aria-label": `Brands for ${u.email}`, style: "padding:5px 8px;font-size:14px" },
      h("option", { value: "inherit", text: "Brands: same as shop" }), h("option", { value: "custom", text: "Brands: custom" }));
    mode.value = u.override ? "custom" : "inherit";
    mode.addEventListener("change", () => { u.override = mode.value === "custom" ? [...editing.brands] : null; renderEditorUsers(); });
    const custom = u.override
      ? h("div", { class: "brands", style: "width:100%;padding:4px 0 2px 2px" },
          ...brandChecks(`uo-${idx}`, u.override, (k, on) => { u.override = on ? [...new Set([...u.override, k])] : u.override.filter((x) => x !== k); }))
      : null;
    box.append(h("div", { class: "urow" }, h("span", { class: "em", text: u.email }),
      h("label", { class: "check", style: "font-weight:400" }, cb, "Active"), mode, send, rm, custom));
  });
}

function openEditor(shop) {
  const mine = shop ? users.filter((u) => u.shopId === shop.id) : [];
  editing = {
    id: shop ? shop.id : null,
    brands: shop && Array.isArray(shop.brands) ? [...shop.brands] : [],
    users: mine.map((u) => ({ email: u.email, userActive: u.userActive !== false, existing: true,
      override: Array.isArray(u.brandsOverride) ? [...u.brandsOverride] : null })),
    removed: []
  };
  $("dlg-title").textContent = shop ? `Edit: ${shop.name}` : "Add a shop";
  $("f-name").value = shop ? shop.name : "";
  $("f-currency").value = shop ? shop.currency : "CAD";
  $("f-type").value = shop ? (shop.priceType || "SHOP") : "SHOP";
  $("f-lang").value = shop ? (shop.language || "en") : "en";
  $("f-region").value = shop ? (shop.region || regionFromCurrency(shop.currency)) : "canada";
  regionTouched = !!(shop && shop.region);
  $("f-scope").value = scopeOf(shop);
  $("f-active").checked = shop ? shop.active !== false : true;
  const pv = (shop && shopsPriv[shop.id]) || {};
  $("f-custid").value = pv.customerId || ""; $("f-tax").value = pv.taxMode || ""; $("f-country").value = pv.country || "";
  $("f-prov").value = pv.province || ""; $("f-bill").value = pv.billTo || "";
  const addrs = shop && Array.isArray(shop.addresses) ? shop.addresses : [];
  $("addresses").replaceChildren(...[0, 1, 2].map((i) => addressBlock(i, addrs[i] || {})));
  $("f-newuser").value = ""; $("dlg-error").hidden = true;
  renderShopBrands();
  renderEditorUsers();
  $("shop-dialog").showModal();
}

function dlgError(msg) { $("dlg-error").textContent = msg; $("dlg-error").hidden = !msg; if (msg) $("dlg-error").scrollIntoView({ block: "nearest" }); }

$("new-shop").addEventListener("click", () => openEditor(null));
$("dlg-close").addEventListener("click", () => $("shop-dialog").close());
$("dlg-cancel").addEventListener("click", () => $("shop-dialog").close());

$("add-user").addEventListener("click", addUserFromInput);
$("f-newuser").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUserFromInput(); } });
function addUserFromInput() {
  const email = emailKey($("f-newuser").value);
  if (!EMAIL_RE.test(email)) { dlgError("Please enter a valid email address."); return; }
  if (editing.users.some((u) => u.email === email)) { dlgError("That address is already in this shop."); return; }
  const other = users.find((u) => u.email === email && u.shopId !== editing.id);
  if (other) { dlgError(`${email} already belongs to another shop (${other.shopName}).`); return; }
  dlgError("");
  const existing = users.find((u) => u.email === email && u.shopId === editing.id);
  editing.users.push({ email, userActive: true, existing: !!existing,
    override: existing && Array.isArray(existing.brandsOverride) ? [...existing.brandsOverride] : null });
  $("f-newuser").value = ""; renderEditorUsers();
}

let regionTouched = false;   // until the owner picks a region by hand it follows the currency
const followCurrency = () => { if (!regionTouched) $("f-region").value = regionFromCurrency($("f-currency").value); };
$("f-region").addEventListener("change", () => { regionTouched = true; });
$("f-currency").addEventListener("change", followCurrency);
$("f-type").addEventListener("change", () => { if ($("f-type").value === "EXPORT") { $("f-currency").value = "EUR"; followCurrency(); } });

$("shop-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("f-name").value.trim(), currency = $("f-currency").value, type = $("f-type").value;
  if (!name) { dlgError("Please enter the shop name."); return; }
  if (type === "EXPORT" && currency !== "EUR") { dlgError("Export prices exist in EUR only."); return; }
  if (!editing.brands.length) { dlgError("Tick at least one brand this shop may see."); return; }
  const bad = editing.users.find((u) => u.override && !u.override.length);
  if (bad) { dlgError(`Pick at least one brand for ${bad.email}, or choose "Brands: same as shop".`); return; }
  const customerId = $("f-custid").value.trim().toUpperCase();
  if (customerId && !/^[A-Z0-9-]{1,12}$/.test(customerId)) { dlgError("The workbook customer number should look like C008."); return; }
  const dup = Object.entries(shopsPriv).find(([id, v]) => customerId && v.customerId === customerId && id !== editing.id);
  if (dup) { const other = shops.find((s) => s.id === dup[0]); dlgError(`${customerId} is already used by ${other ? other.name : "another shop"}.`); return; }
  const priv = { customerId, taxMode: $("f-tax").value, country: normCountry($("f-country").value), province: normProvince($("f-prov").value), billTo: $("f-bill").value.trim() };
  const addresses = [0, 1, 2].map((i) => ({ label: $(`a-label-${i}`).value.trim(), text: $(`a-text-${i}`).value.trim() })).filter((a) => a.text);
  const active = $("f-active").checked, language = $("f-lang").value, region = $("f-region").value, stockScope = $("f-scope").value;
  const ref = editing.id ? doc(db, "shops", editing.id) : doc(collection(db, "shops"));
  const shopId = ref.id, tier = tierOf(type, currency), shopBrands = [...editing.brands].sort();

  const btn = $("dlg-save"); btn.disabled = true; dlgError("");
  try {
    const batch = writeBatch(db);
    batch.set(ref, { name, currency, priceType: type, priceTier: tier, brands: shopBrands, language, region, stockScope, active, addresses, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(db, "shopsPrivate", shopId), { ...priv, updatedAt: serverTimestamp() }, { merge: true });   // private: owner only
    for (const u of editing.users) {
      const data = {
        email: u.email, shopId, shopName: name, currency, priceType: type, priceTier: tier, region, stockScope,
        brands: u.override ? [...u.override].sort() : shopBrands, brandsOverride: u.override ? [...u.override].sort() : null,
        active: active && u.userActive, userActive: u.userActive
      };
      if (!u.existing) { data.language = language; data.invitedAt = serverTimestamp(); } // keep a language the user chose themselves
      batch.set(doc(db, "users", u.email), data, { merge: true });
    }
    for (const email of editing.removed) batch.delete(doc(db, "users", email));
    await batch.commit();
    $("shop-dialog").close();
    toast(`Saved ${name}`);
    await loadShops();
  } catch (err) {
    console.error(err);
    dlgError(`Could not save: ${err.code || err.message}`);
  } finally { btn.disabled = false; }
});

// ------------------------------------------------------------------ documents (catalogs, price lists)
// Master list: admin/library { docs: [record] } (owner only, holds the Storage paths).
// Shops get small manifests library/<brand>__<region> (no paths) and one cover document per file.
let docsList = [], docCovers = {}, editingDoc = null;   // docCovers: record id -> data URL (loaded on demand for the list)
const COVER_W = 420;

async function loadDocs() {
  $("docs-msg").hidden = true;
  try {
    const snap = await getDoc(doc(db, "admin", "library"));
    docsList = snap.exists() && Array.isArray(snap.data().docs) ? snap.data().docs : [];
  } catch (e) { console.error(e); $("docs-msg").textContent = `Could not load the documents: ${e.code || e.message}`; $("docs-msg").hidden = false; docsList = []; }
  renderDocs();
  loadDownloads();
  // covers for the list (small images), fetched once per document
  for (const r of docsList) {
    if (!r.hasCover || docCovers[r.id]) continue;
    getDoc(doc(db, "libraryCovers", `${r.brandKey}__${r.id}`)).then((s) => { if (s.exists()) { docCovers[r.id] = s.data().dataUrl; renderDocs(); } }).catch(() => {});
  }
}

/** Who downloaded which private document (written by the getDocument function). Newest 50. */
async function loadDownloads() {
  const body = $("dl-table").querySelector("tbody"); body.replaceChildren();
  let rows = [];
  try { rows = (await getDocs(collection(db, "downloads"))).docs.map((d) => d.data()); } catch (e) { console.error(e); }
  rows.sort((a, b) => (b.at && b.at.toDate ? b.at.toDate() : 0) - (a.at && a.at.toDate ? a.at.toDate() : 0));
  $("dl-empty").hidden = rows.length > 0;
  for (const r of rows.slice(0, 50)) body.append(h("tr", {}, h("td", { text: fmtDateTime(r.at) }), h("td", { text: r.shopName || "–" }), h("td", { text: r.email }), h("td", { text: r.title })));
}

function renderDocs() {
  const body = $("docs-table").querySelector("tbody");
  body.replaceChildren();
  $("docs-empty").hidden = docsList.length > 0;
  const sorted = [...docsList].sort((a, b) => brandLabel(a.brandKey).localeCompare(brandLabel(b.brandKey)) || a.kind.localeCompare(b.kind) || String(b.season || "").localeCompare(String(a.season || "")));
  for (const r of sorted) {
    const edit = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit" });
    edit.addEventListener("click", () => openDocEditor(r));
    const del = h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete" });
    del.addEventListener("click", () => deleteDoc(r, del));
    body.append(h("tr", {},
      h("td", {}, docCovers[r.id] ? h("img", { class: "cover-prev", style: "width:42px;height:56px", alt: "", src: docCovers[r.id] }) : h("span", { class: "hint", text: r.hasCover ? "…" : "–" })),
      h("td", {}, h("b", { text: r.title })),
      h("td", { text: brandLabel(r.brandKey) }),
      h("td", { text: (KINDS.find((k) => k.key === r.kind) || {}).label || r.kind }),
      h("td", { text: r.season || "–" }),
      h("td", { text: r.regions.map(regionLabel).join(", ") }),
      h("td", {}, r.private ? h("span", { text: r.file.name }) : h("a", { href: r.file.url, target: "_blank", rel: "noopener noreferrer", text: r.file.name }),
        h("span", { class: "hint", style: "display:block", text: [humanSize(r.file.size), r.private ? "private, no link" : "shared by link"].filter(Boolean).join(" · ") })),
      h("td", {}, edit, " ", del)));
  }
}

function ddError(msg) { $("dd-error").textContent = msg; $("dd-error").hidden = !msg; if (msg) $("dd-error").scrollIntoView({ block: "nearest" }); }

function openDocEditor(rec) {
  editingDoc = rec || null;
  $("dd-title").textContent = rec ? `Edit: ${rec.title}` : "Add a document";
  const keys = brandKeysSorted();
  $("d-brand").replaceChildren(...keys.map((k) => h("option", { value: k, text: brandLabel(k) })));
  $("d-title").value = rec ? rec.title : "";
  $("d-brand").value = rec ? rec.brandKey : (keys[0] || "");
  $("d-kind").value = rec ? rec.kind : "catalog";
  $("d-season").value = rec ? (rec.season || "") : "";
  $("d-private").checked = rec ? !!rec.private : privateByDefault($("d-kind").value);
  privateTouched = !!rec;
  $("d-regions").replaceChildren(...REGIONS.map((r) => {
    const cb = h("input", { type: "checkbox", id: `dr-${r.key}`, value: r.key });
    cb.checked = rec ? rec.regions.includes(r.key) : r.key !== "other";
    return h("label", { class: "check", style: "font-weight:400" }, cb, r.label);
  }));
  $("d-file").value = ""; $("d-cover").value = ""; $("d-cover-rm").checked = false;
  $("d-file-cur").textContent = rec ? `(current: ${rec.file.name}; choose a file only to replace it)` : "";
  const prev = $("d-cover-prev"), cur = rec && docCovers[rec.id];
  prev.hidden = !cur; if (cur) prev.src = cur;
  $("d-cover-rm-wrap").hidden = !(rec && rec.hasCover);
  $("d-progress").hidden = true; ddError("");
  $("doc-dialog").showModal();
}
let privateTouched = false;   // until the owner ticks it by hand, Private follows the type (price lists private)
$("d-private").addEventListener("change", () => { privateTouched = true; });
$("d-kind").addEventListener("change", () => { if (!privateTouched) $("d-private").checked = privateByDefault($("d-kind").value); });
$("new-doc").addEventListener("click", () => {
  if (!brandKeysSorted().length) { toast("No brand known yet: publish the stock once first.", true); return; }
  openDocEditor(null);
});
$("dd-close").addEventListener("click", () => $("doc-dialog").close());
$("dd-cancel").addEventListener("click", () => $("doc-dialog").close());
$("d-cover").addEventListener("change", async () => {
  const f = $("d-cover").files[0]; if (!f) return;
  try { const url = await coverDataUrl(f); $("d-cover-prev").src = url; $("d-cover-prev").hidden = false; $("d-cover-rm").checked = false; }
  catch (e) { ddError(e.message); $("d-cover").value = ""; }
});

/** Downsize a picked image to a small JPEG data URL (about 420 px wide, 50-80 KB). */
async function coverDataUrl(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("The cover must be a JPG, PNG or WebP image.");
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { throw new Error("That image could not be read."); }
  const scale = Math.min(1, COVER_W / bmp.width), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  if (url.length > 400000) throw new Error("The cover is too large even after resizing.");
  return url;
}

/** Rebuild every manifest from the master list and remove the ones that no longer apply. */
function writeManifests(batch, records, existingIds) {
  const built = buildManifests(records);
  for (const [id, m] of Object.entries(built)) batch.set(doc(db, "library", id), { ...m, updatedAt: serverTimestamp() });
  for (const id of existingIds) if (!built[id]) batch.delete(doc(db, "library", id));
}
async function manifestIds() { return (await getDocs(collection(db, "library"))).docs.map((d) => d.id); }

$("doc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const old = editingDoc, file = $("d-file").files[0];
  const id = old ? old.id : doc(collection(db, "libraryCovers")).id;
  const rec = {
    id, brandKey: $("d-brand").value, brand: brandLabel($("d-brand").value), kind: $("d-kind").value,
    title: $("d-title").value.trim(), season: $("d-season").value.trim(),
    regions: REGIONS.map((r) => r.key).filter((k) => $(`dr-${k}`).checked),
    private: $("d-private").checked,
    file: old ? old.file : null, hasCover: old ? old.hasCover : false, updatedAt: new Date().toISOString()
  };
  if (!old && !file) { ddError("Please choose the file."); return; }
  // switching between private and link needs the file again: the old download link only stops working when the file is replaced
  if (old && !file && rec.private !== !!old.private) {
    ddError(rec.private ? "To make this document private, choose the file again. The old link keeps working until the file is replaced."
      : "To share this document with a link, choose the file again.");
    return;
  }
  if (file) rec.file = { path: `library/${rec.brandKey}/${id}-${safeFileName(file.name)}`, url: "pending", name: file.name, size: file.size, contentType: file.type || "" };
  const bad = validateRecord(rec); if (bad) { ddError(bad); return; }

  let cover = null;                                    // data URL, or null to keep the current one
  const pickedCover = $("d-cover").files[0];
  try { if (pickedCover) cover = await coverDataUrl(pickedCover); } catch (err) { ddError(err.message); return; }
  const removeCover = $("d-cover-rm").checked && !pickedCover;

  const btn = $("dd-save"); btn.disabled = true; ddError("");
  const bar = $("d-progress"); bar.hidden = true;
  let uploaded = null;
  try {
    if (file) {
      bar.hidden = false;
      uploaded = await storageUpload(rec.file.path, file, (p) => { bar.firstElementChild.style.width = Math.round(p * 100) + "%"; });
      rec.file = rec.private ? { ...uploaded, url: "" } : uploaded;   // a private file's link is never stored
    }
    // the cover follows the document: it is stored per brand, so a brand change moves it
    const brandChanged = old && old.brandKey !== rec.brandKey;
    if (!cover && old && old.hasCover && brandChanged && !removeCover) {
      const s = await getDoc(doc(db, "libraryCovers", `${old.brandKey}__${id}`));
      cover = s.exists() ? s.data().dataUrl : null;
    }
    rec.hasCover = removeCover ? false : (cover ? true : !!(old && old.hasCover));
    const records = [...docsList.filter((r) => r.id !== id), rec];
    const ids = await manifestIds();
    const batch = writeBatch(db);
    batch.set(doc(db, "admin", "library"), { docs: records, updatedAt: serverTimestamp() });
    writeManifests(batch, records, ids);
    if (old && old.hasCover && (brandChanged || removeCover || !rec.hasCover)) batch.delete(doc(db, "libraryCovers", `${old.brandKey}__${id}`));
    if (cover) batch.set(doc(db, "libraryCovers", `${rec.brandKey}__${id}`), { dataUrl: cover, updatedAt: serverTimestamp() });
    await batch.commit();
    if (cover) docCovers[id] = cover; else if (!rec.hasCover) delete docCovers[id];
    if (old && uploaded && old.file.path !== uploaded.path) { try { await storageDelete(old.file.path); } catch (err) { console.warn("Old file not deleted", err); } }
    $("doc-dialog").close();
    toast(`Saved ${rec.title}`);
    await loadDocs();
  } catch (err) {
    console.error(err);
    if (uploaded && !old) { try { await storageDelete(uploaded.path); } catch (x) { /* ignore */ } }   // do not leave an orphan file
    ddError(`Could not save: ${err.code || err.message}`);
  } finally { btn.disabled = false; }
});

async function deleteDoc(rec, btn) {
  if (!confirm(`Delete "${rec.title}"? The file is removed and shops can no longer open it. This cannot be undone.`)) return;
  btn.disabled = true;
  try {
    const records = docsList.filter((r) => r.id !== rec.id);
    const ids = await manifestIds();
    const batch = writeBatch(db);
    batch.set(doc(db, "admin", "library"), { docs: records, updatedAt: serverTimestamp() });
    writeManifests(batch, records, ids);
    if (rec.hasCover) batch.delete(doc(db, "libraryCovers", `${rec.brandKey}__${rec.id}`));
    await batch.commit();
    try { await storageDelete(rec.file.path); } catch (err) { console.warn("File not deleted", err); }
    delete docCovers[rec.id];
    toast(`Deleted ${rec.title}`);
    await loadDocs();
  } catch (err) { console.error(err); toast(`Could not delete: ${err.code || err.message}`, true); btn.disabled = false; }
}

// ------------------------------------------------------------------ stock upload
async function loadPublished() {
  const kv = $("published"); kv.replaceChildren();
  try {
    const snap = await getDoc(doc(db, "admin", "stockMeta"));
    if (!snap.exists()) { kv.append(h("dt", { text: "Status" }), h("dd", { text: "Nothing published yet" })); return; }
    const m = snap.data();
    const when = m.stockRefreshedAt || m.generatedAt;
    const rows = [
      ["Stock as of", when ? fmtDateTime(when) : "–"], ["Season", m.season || "–"], ["Items", m.itemCount ?? "–"],
      ["Brands", m.brands ? Object.values(m.brands).map((b) => `${b.name} ${b.count}`).join(", ") : "–"],
      ["Published", fmtDateTime(m.uploadedAt)], ["By", m.uploadedBy || "–"]
    ];
    if (m.priced) rows.push(["Priced (SHOP_CAD)", `${m.priced.SHOP_CAD ?? 0} of ${m.itemCount}`]);
    for (const [k, v] of rows) kv.append(h("dt", { text: k }), h("dd", { text: String(v) }));
  } catch (e) { console.error(e); kv.append(h("dt", { text: "Error" }), h("dd", { text: "Could not read the published stock." })); }
}

function sanitize(data) {
  if (!data || ![1, 2].includes(data.schema) || !Array.isArray(data.items) || !data.prices || typeof data.prices !== "object")
    throw new Error("This does not look like a stock.json produced by tools/export_stock.py (schema 1 or 2).");
  const ids = new Set(), brands = {};      // brands: key -> { name, count }
  const items = data.items.map((i, n) => {
    for (const k of ["id", "description", "category", "condition", "unit", "brand"]) if (typeof i[k] !== "string" || !i[k]) throw new Error(`Item ${n + 1}: missing "${k}". Export again with the current tools/export_stock.py.`);
    if (typeof i.available !== "number" || !(i.available > 0)) throw new Error(`Item ${n + 1} (${i.description}): available must be a positive number.`);
    if (ids.has(i.id)) throw new Error(`Duplicate item id ${i.id}.`);
    ids.add(i.id);
    const key = brandKey(i.brand);
    if (!KEY_RE.test(key)) throw new Error(`Item ${n + 1}: brand "${i.brand}" has no usable letters or digits.`);
    if (brands[key] && brands[key].name !== i.brand) throw new Error(`Brands "${brands[key].name}" and "${i.brand}" are too similar.`);
    brands[key] = { name: i.brand, count: (brands[key] ? brands[key].count : 0) + 1 };
    const o = {};
    for (const k of ITEM_KEYS) if (i[k] !== undefined && i[k] !== null && i[k] !== "") o[k] = i[k]; // whitelist: anything else (e.g. a location) is dropped
    return o;
  });
  const prices = {};
  for (const [tier, map] of Object.entries(data.prices)) {
    if (!TIER_RE.test(tier)) throw new Error(`Unknown price tier "${tier}".`);
    prices[tier] = {};
    for (const [id, p] of Object.entries(map)) {
      if (!ids.has(id)) throw new Error(`Price for unknown item ${id} in ${tier}.`);
      if (typeof p.p !== "number" || !(p.p > 0)) throw new Error(`Bad price for ${id} in ${tier}.`);
      // previous-season rebate (schema 2): b = base (list) price, pct = integer percent, mb = base suggested retail (m is then the net retail)
      const rebate = p.pct !== undefined || p.b !== undefined;
      if (rebate && !(Number.isInteger(p.pct) && p.pct >= 1 && p.pct <= 99 && p.b > p.p)) throw new Error(`Bad rebate on ${id} in ${tier}.`);
      prices[tier][id] = { p: p.p, ...(p.m > 0 ? { m: p.m } : {}), ...(p.est ? { est: true } : {}),
        ...(rebate ? { b: p.b, pct: p.pct } : {}), ...(p.mb > 0 ? { mb: p.mb } : {}) };
    }
  }
  const locations = (data.private && data.private.locations) || {};
  // per warehouse: on hand, held by Excel draft invoices, available (kept for the owner's request export)
  const stock = {}, num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
  for (const [id, perLoc] of Object.entries((data.private && data.private.stock) || {})) {
    if (!ids.has(id) || !perLoc || typeof perLoc !== "object") continue;
    stock[id] = {};
    for (const [loc, v] of Object.entries(perLoc)) if (["Eastman", "CDEC", "Other"].includes(loc) && v) stock[id][loc] = { onHand: num(v.onHand), reserved: num(v.reserved), available: num(v.available) };
  }
  for (const key of Object.keys(brands)) {
    const bytes = JSON.stringify(items.filter((i) => brandKey(i.brand) === key)).length;
    if (bytes > 900000) throw new Error(`Brand ${brands[key].name} is too large for one document (over 900 KB).`);
  }
  return { items, prices, locations, stock, brands };
}

/** Read, check and preview a chosen or dropped stock.json. */
async function processFile(file) {
  $("preview").hidden = true; pendingFile = null;
  $("drop-name").textContent = file ? file.name : "";
  if (!file) return;
  try {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { throw new Error(`"${file.name}" is not a stock export. Please choose stock.json from tools\\output.`); }
    const clean = sanitize(data);
    pendingFile = { data, clean };
    const kv = $("preview-kv"); kv.replaceChildren();
    const refreshed = data.stockRefreshedAt ? new Date(data.stockRefreshedAt) : null;
    const ageH = refreshed ? (Date.now() - refreshed.getTime()) / 36e5 : null;
    $("preview-warn").replaceChildren(
      ...(ageH != null && ageH > 36 ? [h("div", { class: "msg msg-warn", text: `The Stock sheet was last refreshed ${Math.round(ageH)} hours ago. Refresh it in Excel and export again if the stock has changed.` })] : []),
      ...(ageH == null ? [h("div", { class: "msg msg-warn", text: "The file has no Stock-sheet refresh date." })] : []));
    const unpriced = clean.items.filter((i) => !(clean.prices.SHOP_CAD || {})[i.id]).length;
    const rows = [
      ["File", file.name], ["Season", data.season || "–"], ["Stock sheet refreshed", data.stockRefreshedAt ? fmtDateTime(data.stockRefreshedAt) : "–"],
      ["Items", clean.items.length], ["Brands", Object.values(clean.brands).map((b) => `${b.name} ${b.count}`).join(", ")],
      ["Without a SHOP_CAD price", unpriced],
      ["Previous-season rebates", data.schema >= 2 ? `${clean.items.filter((i) => i.previousSeason).length} items priced with a rebate` : "none: this is an older export (schema 1), export again with the current tools\\export_stock.py"],
      ["Items for Eastman-only / CDEC-only shops", ["w1", "w2"].map((sc) => scopeItems(clean.items, clean.stock, sc).length).join(" / ")],
      ["Price tiers", Object.keys(clean.prices).join(", ") || "none"], ["Items with a location (admin only)", Object.keys(clean.locations).length],
      ["Items with on hand / reserved detail", Object.keys(clean.stock).length + (Object.keys(clean.stock).length ? "" : "  (export again with the current tools\\export_stock.py)")]
    ];
    for (const [k, v] of rows) kv.append(h("dt", { text: k }), h("dd", { text: String(v) }));
    $("preview").hidden = false;
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not read the file.", true);
    $("file").value = ""; $("drop-name").textContent = "";
  }
}

// ---- drag and drop, plus a "Choose file…" picker
const drop = $("drop");
const pickFile = async () => {
  if (typeof window.showOpenFilePicker === "function") {
    // Chrome / Edge: the same `id` makes the browser reopen in the folder used last time (tools\output after the first pick)
    try {
      const [handle] = await window.showOpenFilePicker({ id: "m-stock-export", multiple: false, types: [{ description: "Stock export (stock.json)", accept: { "application/json": [".json"] } }] });
      return processFile(await handle.getFile());
    } catch (e) { if (e && e.name === "AbortError") return; /* anything else: fall back to the classic picker */ }
  }
  $("file").click();
};
$("pick").addEventListener("click", (e) => { e.stopPropagation(); pickFile(); });
$("file").addEventListener("change", (e) => processFile(e.target.files[0]));
drop.addEventListener("keydown", (e) => { if (e.target === drop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickFile(); } });
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "dragend"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("over");
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
  if (files.length !== 1) { toast("Please drop one file: stock.json.", true); return; }
  processFile(files[0]);
});
// a file dropped outside the box must not make the browser leave the page
for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => { if (e.target !== drop && !drop.contains(e.target)) e.preventDefault(); });

$("cancel-publish").addEventListener("click", () => { $("preview").hidden = true; $("file").value = ""; $("drop-name").textContent = ""; pendingFile = null; });

$("publish").addEventListener("click", async () => {
  if (!pendingFile) return;
  const { data, clean } = pendingFile, btn = $("publish");
  if (!confirm(`Publish ${clean.items.length} items (${Object.values(clean.brands).map((b) => b.name).join(", ")}) to the shops now?`)) return;
  btn.disabled = true;
  try {
    const email = emailKey(auth.currentUser.email);
    const [existingPrices, existingStock, brandsDoc] = await Promise.all([
      getDocs(collection(db, "prices")), getDocs(collection(db, "stock")), getDoc(doc(db, "admin", "brands"))
    ]);
    const batch = writeBatch(db), keepStock = new Set(["meta"]), keepPrices = new Set();
    const priced = {};

    for (const [key, b] of Object.entries(clean.brands)) {
      const id = `items__${key}`; keepStock.add(id);
      const brandItems = clean.items.filter((i) => brandKey(i.brand) === key);
      batch.set(doc(db, "stock", id), { schema: 1, brand: b.name, brandKey: key, items: brandItems });
      // the same stock again per warehouse, for shops limited to Eastman or CDEC (a shop only ever reads its own scope's document)
      for (const sc of ["w1", "w2"]) {
        const sid = itemsDocId(key, sc); keepStock.add(sid);
        batch.set(doc(db, "stock", sid), { schema: 1, brand: b.name, brandKey: key, scope: sc, items: scopeItems(brandItems, clean.stock, sc) });
      }
      const ids = new Set(clean.items.filter((i) => brandKey(i.brand) === key).map((i) => i.id));
      for (const [tier, map] of Object.entries(clean.prices)) {
        const sub = Object.fromEntries(Object.entries(map).filter(([iid]) => ids.has(iid)));
        if (!Object.keys(sub).length) continue;
        const pid = `${tier}__${key}`; keepPrices.add(pid);
        batch.set(doc(db, "prices", pid), { tier, brandKey: key, prices: sub });
        priced[tier] = (priced[tier] || 0) + Object.keys(sub).length;
      }
    }
    // what shops may read: dates and a contact only (no counts, no brand list)
    batch.set(doc(db, "stock", "meta"), {
      schema: 1, season: data.season || null, stockRefreshedAt: data.stockRefreshedAt || null, generatedAt: data.generatedAt || null,
      uploadedAt: serverTimestamp(), contact: email
    });
    // admin-only details
    batch.set(doc(db, "admin", "stockMeta"), {
      schema: 1, season: data.season || null, stockRefreshedAt: data.stockRefreshedAt || null, generatedAt: data.generatedAt || null,
      uploadedAt: serverTimestamp(), uploadedBy: email, itemCount: clean.items.length, brands: clean.brands, priced
    });
    const known = brandsDoc.exists() && brandsDoc.data().brands ? brandsDoc.data().brands : {};
    for (const [key, b] of Object.entries(clean.brands)) known[key] = b.name;
    batch.set(doc(db, "admin", "brands"), { brands: known });
    batch.set(doc(db, "admin", "locations"), { locations: clean.locations, stock: clean.stock, updatedAt: serverTimestamp() });

    // no stale documents left behind (old single-brand documents, brands or tiers that disappeared)
    existingStock.docs.forEach((d) => { if (!keepStock.has(d.id)) batch.delete(d.ref); });
    existingPrices.docs.forEach((d) => { if (!keepPrices.has(d.id)) batch.delete(d.ref); });
    await batch.commit();
    // what Eastman-only and CDEC-only shops see as held depends on the new warehouse quantities: refresh it
    let note = "";
    try { await callFn("refreshReserved", {}); } catch (e) { console.error(e); note = ` The held quantities for Eastman-only and CDEC-only shops could not be refreshed (${(e && (e.message || e.code)) || "error"}).`; }
    toast("Published. Shops now see the new stock." + note, !!note);
    $("preview").hidden = true; $("file").value = ""; $("drop-name").textContent = ""; pendingFile = null;
    loadPublished(); loadShops();
  } catch (err) {
    console.error(err);
    toast(`Publish failed: ${err.code || err.message}`, true);
  } finally { btn.disabled = false; }
});

// ------------------------------------------------------------------ requests
let allRequests = [], reqFilter = "open", openRequestId = null;
const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const fmtDay = (v) => { const d = toDate(v); return d ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(d) : "–"; };
const STATUS_CLASS = { reserved: "s-res", expired: "s-exp", cancelled: "s-can", released: "s-rel", invoiced: "s-inv" };
const STATUS_TEXT = { reserved: "Reserved", expired: "Expired", cancelled: "Cancelled", released: "Released", invoiced: "Invoiced" };

async function loadRequests() {
  try {
    const snap = await getDocs(collection(db, "requests"));
    allRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  } catch (e) { console.error(e); toast(`Could not load requests: ${e.code || e.message}`, true); }
  renderRequests();
}

function renderRequests() {
  const open = allRequests.filter((r) => r.status === "reserved");
  $("req-badge").textContent = String(open.length); $("req-badge").hidden = open.length === 0;
  const keep = { open: (r) => r.status === "reserved", invoiced: (r) => r.status === "invoiced", closed: (r) => ["expired", "cancelled", "released"].includes(r.status), all: () => true }[reqFilter];
  const rows = allRequests.filter(keep);
  const body = $("req-table").querySelector("tbody"); body.replaceChildren();
  $("req-empty").hidden = rows.length > 0;
  const soon = Date.now() + 2 * 864e5;
  for (const r of rows) {
    const b = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Open" });
    b.addEventListener("click", () => openRequest(r.id));
    const ends = toDate(r.expiresAt);
    body.append(h("tr", {},
      h("td", {}, h("b", { text: r.number }), h("br"), h("span", { class: "hint", text: fmtDay(r.createdAt) })),
      h("td", {}, r.shopName, h("br"), h("span", { class: "hint", text: r.userEmail })),
      h("td", { text: String(r.lines.length) }),
      h("td", { class: "num", text: r.hasTbd && !(r.subtotal > 0) ? "to be priced" : `${money(r.subtotal, r.currency)}${r.hasTbd ? " +" : ""}` }),
      h("td", { class: r.status === "reserved" && ends && ends.getTime() < soon ? "warn-text" : "", text: r.status === "reserved" ? fmtDay(r.expiresAt) : "–" }),
      h("td", {}, h("span", { class: "status " + (STATUS_CLASS[r.status] || "s-can"), text: STATUS_TEXT[r.status] || r.status })),
      h("td", {}, b)));
  }
}
$("req-filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  reqFilter = b.dataset.f;
  $("req-filters").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  renderRequests();
});
$("req-refresh").addEventListener("click", loadRequests);

// Email check: the Cloud Function sends a test message and reports the exact error if Gmail refuses it.
$("mail-test").addEventListener("click", async () => {
  const out = $("mail-result"), btn = $("mail-test");
  btn.disabled = true; out.className = "msg msg-info"; out.textContent = "Sending a test email…"; out.hidden = false;
  try {
    const r = await callFn("sendTestEmail", {});
    if (r.ok) { out.className = "msg msg-ok"; out.textContent = `Sent to ${ADMIN_EMAIL}. Check your inbox (and spam). Request emails will work.`; }
    else {
      out.className = "msg msg-error";
      const hint = r.shape ? ` Saved password: ${r.shape}.` : (r.secretLength !== 16 ? ` The saved password has ${r.secretLength} characters but a Google app password has 16.` : "");
      out.textContent = `The email could not be sent: ${String(r.error || "unknown error").replace(/[.\s]+$/, "")}.${hint}`;
    }
  } catch (e) {
    console.error(e); out.className = "msg msg-error";
    out.textContent = `Could not reach the email check: ${(e && e.message) || e.code}`;
  } finally { btn.disabled = false; }
});

function download(name, text, type) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function privateOf(id) { try { const s = await getDoc(doc(db, "requestsPrivate", id)); return s.exists() ? s.data() : null; } catch (e) { return null; } }

$("req-export-open").addEventListener("click", async () => {
  const open = allRequests.filter((r) => r.status === "reserved");
  if (!open.length) { toast("No open request to export."); return; }
  const all = [];
  for (const r of open) all.push(exportShape(r, await privateOf(r.id)));
  download(`open-requests-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(all, null, 2), "application/json");
});

const ACTION_TEXT = {
  extend: ["Extend 7 days", "Hold the items for 7 more days?", "btn-ghost"],
  release: ["Release", "Release the items now? They become available to other shops.", "btn-danger"],
  cancel: ["Cancel request", "Cancel this request and release the items?", "btn-danger"],
  invoice: ["Mark invoiced", "Mark as invoiced? Items still held are released (your Excel stock already accounts for the invoice).", "btn-primary"]
};
const ACTIONS_FOR = { reserved: ["extend", "invoice", "release", "cancel"], expired: ["invoice"], released: ["invoice"], cancelled: [], invoiced: [] };

async function openRequest(id) {
  const r = allRequests.find((x) => x.id === id); if (!r) return;
  openRequestId = id;
  const priv = await privateOf(id);
  const loc = (priv && priv.lines) || {};
  $("rd-title").textContent = `${r.number} · ${r.shopName}`;
  const info = [
    ["Status", STATUS_TEXT[r.status] || r.status], ["Contact", r.userEmail], ["Sent", fmtDay(r.createdAt)],
    ["Held until", r.status === "reserved" ? fmtDay(r.expiresAt) : "–"], ["Prices", `${r.priceTier} · ${r.currency}`],
    ["Customer no.", (priv && priv.shop && priv.shop.customerId) || "(not set: add it on the shop)"],
    ["Tax mode · province", priv && priv.shop ? [priv.shop.taxMode || "not set", priv.shop.province || "–"].join(" · ") : "–"],
    ["Billing address", (priv && priv.shop && priv.shop.billTo) || "–"],
    ["Stock as of", priv && priv.stockAsOf ? fmtDateTime(priv.stockAsOf) : "–"],
    ["Ship to", r.shipTo ? [r.shipTo.label, r.shipTo.text].filter(Boolean).join(" / ") : "(none on file)"],
    ["Requested ship date", r.shipDate || "–"], ["PO", r.po || "–"], ["Notes", r.notes || "–"],
    ["Emails", r.emails ? `owner ${r.emails.owner}, shop ${r.emails.shop}${r.emails.error ? "\nProblem: " + r.emails.error : ""}` : "–"]
  ];
  const kv = h("dl", { class: "kv", style: "margin-bottom:14px" }, ...info.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { style: "white-space:pre-line", text: v })]));
  const tbl = h("table", { class: "t" },
    h("thead", {}, h("tr", {}, ...["Brand", "Code", "Item", "Qty", "Unit price", "Total", "Available E / C"].map((x, i) => h("th", { class: i > 2 ? "num" : "", text: x })))),
    h("tbody", {}, ...r.lines.map((l) => {
      const lo = loc[l.itemId] || {};
      return h("tr", {},
        h("td", { text: l.brand }), h("td", { text: l.code || "" }),
        h("td", { text: [l.description, l.size, l.color].filter(Boolean).join(" ") + (l.condition !== "New" ? ` (${l.condition})` : "") }),
        h("td", { class: "num", text: `${l.qty} ${l.unit}` }),
        h("td", { class: "num", text: l.priceTbd ? "TBD" : money(l.unitPrice, r.currency) + (l.unit === "m" ? " / m" : "") + (l.est ? " est." : "") }),
        h("td", { class: "num", text: l.priceTbd ? "–" : money(l.lineTotal, r.currency) }),
        h("td", { class: "num", title: "available (on hand, held by Excel drafts) per warehouse, as of the last upload", text: ["Eastman", "CDEC"].map((w) => {
          const d = ((priv && priv.stock && priv.stock[l.itemId]) || {})[w];
          return d ? `${d.available}` + (d.reserved ? ` (${d.onHand}, ${d.reserved} drafts)` : "") : `${lo[w] || 0}`;
        }).join(" / ") }));
    })));
  $("rd-body").replaceChildren(kv, h("div", { style: "overflow:auto" }, tbl),
    h("p", { style: "margin-top:10px" }, h("b", { text: `Subtotal (before tax): ${r.hasTbd && !(r.subtotal > 0) ? "to be priced" : money(r.subtotal, r.currency)}` }), r.hasTbd && r.subtotal > 0 ? "  + lines to price" : ""));

  const mkAction = (a) => {
    const [label, ask, cls] = ACTION_TEXT[a];
    const b = h("button", { class: "btn btn-sm " + cls, type: "button", text: label });
    b.addEventListener("click", async () => {
      if (!confirm(ask)) return;
      b.disabled = true;
      try { await callFn("updateRequest", { id, action: a }); toast(`${r.number}: ${label.toLowerCase()} done`); await loadRequests(); openRequest(id); }
      catch (e) { console.error(e); toast(`Could not do that: ${(e && e.message) || e.code}`, true); b.disabled = false; }
    });
    return b;
  };
  const dl = (txt, fn) => { const b = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: txt }); b.addEventListener("click", fn); return b; };
  $("rd-actions").replaceChildren(
    dl("Download JSON", () => download(`${r.number}.json`, JSON.stringify(exportShape(r, priv), null, 2), "application/json")),
    dl("Download CSV", () => download(`${r.number}.csv`, requestCsv(r, priv), "text/csv;charset=utf-8")),
    h("span", { class: "spacer", style: "flex:1" }),
    ...(ACTIONS_FOR[r.status] || []).map(mkAction));
  if (!$("req-dialog").open) $("req-dialog").showModal();
}
$("rd-close").addEventListener("click", () => $("req-dialog").close());

// ------------------------------------------------------------------ shop view (what a shop sees)
let shopView = null;
const shopViewFill = () => {
  const sel = $("v-shop"), keep = sel.value;
  sel.replaceChildren(...shops.map((s) => h("option", { value: s.id, text: s.name })));
  sel.value = shops.some((s) => s.id === keep) ? keep : (shops[0] ? shops[0].id : "");
  fillViewUsers();
};
function fillViewUsers() {
  const shop = shops.find((s) => s.id === $("v-shop").value);
  const mine = users.filter((u) => shop && u.shopId === shop.id);
  const sel = $("v-user"), keep = sel.value;
  sel.replaceChildren(h("option", { value: "", text: "All users of this shop" }), ...mine.map((u) => h("option", { value: u.email, text: u.email })));
  sel.value = mine.some((u) => u.email === keep) ? keep : "";
  $("v-lang").value = (shop && shop.language) || "en";
}
async function openShopView() { await loadShops().catch(() => {}); shopViewFill(); await loadShopView(); }

async function loadShopView() {
  const shop = shops.find((s) => s.id === $("v-shop").value);
  const msg = $("v-msg"), banner = $("v-banner"); msg.hidden = true; banner.hidden = true;
  if (!shop) { msg.textContent = "No shop yet: add one in the Shops tab."; msg.hidden = false; $("v-root").replaceChildren(); return; }
  const u = $("v-user").value ? users.find((x) => x.email === $("v-user").value) : null;
  const keys = (u ? u.brands : shop.brands) || [];
  const tier = shop.priceTier, cur = shop.currency, scope = scopeOf(u || shop);
  setLang($("v-lang").value);
  try {
    const [metaSnap, ...rest] = await Promise.all([
      getDoc(doc(db, "stock", "meta")),
      ...keys.map((k) => getDoc(doc(db, "stock", itemsDocId(k, scope)))),
      ...keys.map((k) => getDoc(doc(db, "prices", `${tier}__${k}`))),
      ...keys.map((k) => getDoc(doc(db, "reserved", reservedDocId(k, scope))))
    ]);
    const n = keys.length, itemSnaps = rest.slice(0, n), priceSnaps = rest.slice(n, 2 * n), resSnaps = rest.slice(2 * n);
    const items = [], prices = {}, reserved = {}, brands = [];
    keys.forEach((k, i) => {
      if (itemSnaps[i].exists()) {
        const d = itemSnaps[i].data(); brands.push({ key: k, name: d.brand || k });
        for (const it of d.items || []) items.push({ ...it, brand: d.brand || k, brandKey: k });
      }
      if (priceSnaps[i].exists()) Object.assign(prices, priceSnaps[i].data().prices || {});
      if (resSnaps[i].exists()) Object.assign(reserved, resSnaps[i].data().map || {});
    });
    brands.sort((a, b) => a.name.localeCompare(b.name));
    const meta = metaSnap.exists() ? metaSnap.data() : null;
    const when = meta && (meta.stockRefreshedAt || meta.generatedAt);
    banner.replaceChildren(h("b", { text: "Previewing: " }), `${shop.name} · ${tier} · ${u ? u.email : "all users"} · brands: ${keys.map(brandLabel).join(", ") || "none"} · stock: ${SCOPE_LABEL[scope]}`,
      when ? h("span", {}, " · ", h("b", { text: "Stock as of " }), dateLabel(when)) : null);
    banner.hidden = false;
    const warn = [];
    if (shop.active === false) warn.push("This shop is inactive: its users cannot sign in.");
    if (u && u.active === false) warn.push("This user is inactive.");
    if (!keys.length) warn.push("No brand is enabled here: this user sees nothing.");
    else if (!items.length) warn.push("Nothing is published for these brands yet.");
    if (warn.length) { msg.textContent = warn.join(" "); msg.className = "msg msg-warn"; msg.hidden = false; }
    if (!shopView) shopView = createStockView($("v-root"), { cart: null });
    shopView.setData({ items, prices, reserved, brands, currency: cur }, true);
  } catch (e) {
    console.error(e); msg.textContent = `Could not load the view: ${e.code || e.message}`; msg.className = "msg msg-error"; msg.hidden = false;
  }
}
$("v-shop").addEventListener("change", () => { fillViewUsers(); loadShopView(); });
$("v-user").addEventListener("change", loadShopView);
$("v-lang").addEventListener("change", () => { setLang($("v-lang").value); if (shopView) shopView.render(); loadShopView(); });
$("v-refresh").addEventListener("click", loadShopView);

// ------------------------------------------------------------------ start
onAuthStateChanged(auth, async (user) => {
  if (!user) { $("noaccess-text").textContent = "This page is for the portal owner. Please sign in on the portal first."; show("noaccess"); return; }
  if (emailKey(user.email) !== ADMIN_EMAIL) { $("noaccess-text").textContent = "This account does not have access to the admin page."; show("noaccess"); return; }
  $("who").textContent = emailKey(user.email);
  show("app");
  try { await loadShops(); } catch (e) { console.error(e); toast(`Could not load shops: ${e.code || e.message}`, true); }
  loadRequests().catch(() => {});   // fills the badge on the Requests tab
});
