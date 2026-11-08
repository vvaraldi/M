// Admin page (owner only): shops, users, brands, invitations and the stock upload.
// The real protection is in firestore.rules; the checks here are for a clear user experience.
import {
  auth, db, onAuthStateChanged, signOut, doc, getDoc, getDocs, collection, writeBatch,
  serverTimestamp, sendLink, emailKey
} from "./fb.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import { h } from "./render.js";

const $ = (id) => document.getElementById(id);
const show = (name) => ["loading", "noaccess", "app"].forEach((v) => { $("view-" + v).hidden = v !== name; });

let shops = [], users = [];
let brandNames = {};           // key -> display name, from admin/brands and from what shops already use
let editing = null;            // { id|null, users:[{email,userActive,existing,override:null|[keys]}], removed:[email] }
let pendingFile = null;

const TIER_RE = /^(SHOP|RETAIL|EXPORT)_(CAD|USD|EUR)$/;
const KEY_RE = /^[a-z0-9]+$/;
const ITEM_KEYS = ["id", "brand", "code", "sku", "category", "family", "description", "size", "color", "condition", "available", "unit", "minQty", "img"];
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
function selectTab(name) {
  for (const t of ["shops", "stock"]) {
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
    $("panel-" + t).hidden = t !== name;
  }
  if (name === "stock") loadPublished();
}
$("tab-shops").addEventListener("click", () => selectTab("shops"));
$("tab-stock").addEventListener("click", () => selectTab("stock"));
$("signout").addEventListener("click", () => signOut(auth));

// ------------------------------------------------------------------ shops
async function loadShops() {
  const [s, u, b] = await Promise.all([
    getDocs(collection(db, "shops")), getDocs(collection(db, "users")), getDoc(doc(db, "admin", "brands"))
  ]);
  shops = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, c) => a.name.localeCompare(c.name));
  users = u.docs.map((d) => ({ ...d.data(), email: d.id }));
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
      h("td", {}, h("b", { text: s.name })),
      h("td", { text: `${s.priceType || "SHOP"} · ${s.currency}` }),
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
  $("f-active").checked = shop ? shop.active !== false : true;
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

$("f-type").addEventListener("change", () => { if ($("f-type").value === "EXPORT") $("f-currency").value = "EUR"; });

$("shop-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("f-name").value.trim(), currency = $("f-currency").value, type = $("f-type").value;
  if (!name) { dlgError("Please enter the shop name."); return; }
  if (type === "EXPORT" && currency !== "EUR") { dlgError("Export prices exist in EUR only."); return; }
  if (!editing.brands.length) { dlgError("Tick at least one brand this shop may see."); return; }
  const bad = editing.users.find((u) => u.override && !u.override.length);
  if (bad) { dlgError(`Pick at least one brand for ${bad.email}, or choose "Brands: same as shop".`); return; }
  const addresses = [0, 1, 2].map((i) => ({ label: $(`a-label-${i}`).value.trim(), text: $(`a-text-${i}`).value.trim() })).filter((a) => a.text);
  const active = $("f-active").checked, language = $("f-lang").value;
  const ref = editing.id ? doc(db, "shops", editing.id) : doc(collection(db, "shops"));
  const shopId = ref.id, tier = tierOf(type, currency), shopBrands = [...editing.brands].sort();

  const btn = $("dlg-save"); btn.disabled = true; dlgError("");
  try {
    const batch = writeBatch(db);
    batch.set(ref, { name, currency, priceType: type, priceTier: tier, brands: shopBrands, language, active, addresses, updatedAt: serverTimestamp() }, { merge: true });
    for (const u of editing.users) {
      const data = {
        email: u.email, shopId, shopName: name, currency, priceType: type, priceTier: tier,
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
  if (!data || data.schema !== 1 || !Array.isArray(data.items) || !data.prices || typeof data.prices !== "object")
    throw new Error("This does not look like a stock.json produced by tools/export_stock.py (schema 1).");
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
      prices[tier][id] = { p: p.p, ...(p.m > 0 ? { m: p.m } : {}), ...(p.est ? { est: true } : {}) };
    }
  }
  const locations = (data.private && data.private.locations) || {};
  for (const key of Object.keys(brands)) {
    const bytes = JSON.stringify(items.filter((i) => brandKey(i.brand) === key)).length;
    if (bytes > 900000) throw new Error(`Brand ${brands[key].name} is too large for one document (over 900 KB).`);
  }
  return { items, prices, locations, brands };
}

$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  $("preview").hidden = true; pendingFile = null;
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
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
      ["Price tiers", Object.keys(clean.prices).join(", ") || "none"], ["Items with a location (admin only)", Object.keys(clean.locations).length]
    ];
    for (const [k, v] of rows) kv.append(h("dt", { text: k }), h("dd", { text: String(v) }));
    $("preview").hidden = false;
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not read the file.", true);
    e.target.value = "";
  }
});
$("cancel-publish").addEventListener("click", () => { $("preview").hidden = true; $("file").value = ""; pendingFile = null; });

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
      batch.set(doc(db, "stock", id), { schema: 1, brand: b.name, brandKey: key, items: clean.items.filter((i) => brandKey(i.brand) === key) });
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
    batch.set(doc(db, "admin", "locations"), { locations: clean.locations, updatedAt: serverTimestamp() });

    // no stale documents left behind (old single-brand documents, brands or tiers that disappeared)
    existingStock.docs.forEach((d) => { if (!keepStock.has(d.id)) batch.delete(d.ref); });
    existingPrices.docs.forEach((d) => { if (!keepPrices.has(d.id)) batch.delete(d.ref); });
    await batch.commit();
    toast("Published. Shops now see the new stock.");
    $("preview").hidden = true; $("file").value = ""; pendingFile = null;
    loadPublished(); loadShops();
  } catch (err) {
    console.error(err);
    toast(`Publish failed: ${err.code || err.message}`, true);
  } finally { btn.disabled = false; }
});

// ------------------------------------------------------------------ start
onAuthStateChanged(auth, async (user) => {
  if (!user) { $("noaccess-text").textContent = "This page is for the portal owner. Please sign in on the portal first."; show("noaccess"); return; }
  if (emailKey(user.email) !== ADMIN_EMAIL) { $("noaccess-text").textContent = "This account does not have access to the admin page."; show("noaccess"); return; }
  $("who").textContent = emailKey(user.email);
  show("app");
  try { await loadShops(); } catch (e) { console.error(e); toast(`Could not load shops: ${e.code || e.message}`, true); }
});
