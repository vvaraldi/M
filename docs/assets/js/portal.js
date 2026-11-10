// Portal page: sign-in with an emailed link, invitation check, stock, request (cart) and history.
import {
  auth, db, onAuthStateChanged, signOut, doc, getDoc, getDocs, collection, query, where, updateDoc,
  sendLink, openedFromEmailLink, completeEmailLink, emailKey, callFn
} from "./fb.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import { LANGS, t, setLang, getLang, detectLang, rememberLang, dateLabel, money } from "./i18n.js";
import { h } from "./render.js";
import { createStockView } from "./stockview.js";
import { initCart, cart, count as cartCount, entries as cartEntries, onCartChange, reconcile } from "./cart.js";
import { renderCartView, renderHistory } from "./requests.js";
import { renderLibrary } from "./library-view.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["loading", "signin", "sent", "confirm", "denied", "app"];
const show = (name) => VIEWS.forEach((v) => { $("view-" + v).hidden = v !== name; });
const ROUTES = ["stock", "request", "history", "documents"];

let profile = null, shop = null, meta = null, items = [], prices = {}, reserved = {}, brands = [];
let pendingError = null, lastEmail = "", stockView = null, route = "stock", firstRender = true;

// ------------------------------------------------------------------ language
function hasStoredLang() { try { return LANGS.includes(localStorage.getItem("lang")); } catch (e) { return false; } }

function applyStaticText() {
  document.querySelectorAll("[data-i]").forEach((el) => { el.textContent = t(el.dataset.i); });
  document.querySelectorAll("[data-ph]").forEach((el) => { el.placeholder = t(el.dataset.ph); });
  document.querySelectorAll("[data-pills] button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.l === getLang())));
  document.title = "M · " + t("portal");
  if (lastEmail && !$("view-sent").hidden) $("sent-text").textContent = t("sent_p", { email: lastEmail });
  if (profile && !$("view-denied").hidden) $("denied-text").textContent = t("denied_p", { email: profile.email });
}

async function chooseLang(l) {
  setLang(l); rememberLang(l); applyStaticText();
  if (!$("view-app").hidden) renderApp();
  if (profile) updateDoc(doc(db, "users", emailKey(profile.email)), { language: l }).catch(() => { /* not critical */ });
}

// ------------------------------------------------------------------ sign-in
function errorText(code) {
  switch (code) {
    case "auth/invalid-email": return t("err_email");
    case "auth/too-many-requests": return t("err_many");
    case "auth/network-request-failed": return t("err_net");
    case "auth/invalid-action-code": case "auth/expired-action-code": return t("err_link");
    default: console.error("Sign-in error:", code); return t("err_generic");
  }
}
function showSignInError(msg) {
  const box = $("signin-error");
  box.textContent = msg || ""; box.hidden = !msg;
}

$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("signin-email"), email = input.value.trim();
  if (!input.checkValidity() || !email) { showSignInError(t("err_email")); input.focus(); return; }
  const btn = $("signin-btn");
  btn.disabled = true; btn.textContent = t("sending"); showSignInError("");
  try {
    await sendLink(email, getLang());
    lastEmail = email;
    $("sent-text").textContent = t("sent_p", { email });
    show("sent");
  } catch (err) {
    showSignInError(errorText(err && err.code));
  } finally {
    btn.disabled = false; btn.textContent = t("send_link");
  }
});
$("sent-other").addEventListener("click", () => { show("signin"); $("signin-email").focus(); });

function askEmail(mismatch) {
  return new Promise((resolve) => {
    $("confirm-error").textContent = mismatch ? t("err_mismatch") : "";
    $("confirm-error").hidden = !mismatch;
    $("confirm-email").value = "";
    show("confirm");
    $("confirm-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("confirm-email");
      if (input.checkValidity()) resolve(input.value.trim());
    });
  });
}

document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", () => signOut(auth)));
document.querySelectorAll("[data-pills]").forEach((p) => p.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-l]"); if (b) chooseLang(b.dataset.l);
}));

// ------------------------------------------------------------------ data
/** Read what this user may see: only the allowed brands, only their own price tier, plus what is already reserved. */
async function fetchData() {
  const keys = (Array.isArray(profile.brands) ? profile.brands : []).filter((k) => /^[a-z0-9]+$/.test(k));
  const [shopSnap, metaSnap, ...rest] = await Promise.all([
    getDoc(doc(db, "shops", profile.shopId)),
    getDoc(doc(db, "stock", "meta")),
    ...keys.map((k) => getDoc(doc(db, "stock", `items__${k}`))),
    ...keys.map((k) => getDoc(doc(db, "prices", `${profile.priceTier}__${k}`))),
    ...keys.map((k) => getDoc(doc(db, "reserved", k)))
  ]);
  const n = keys.length, itemSnaps = rest.slice(0, n), priceSnaps = rest.slice(n, 2 * n), reservedSnaps = rest.slice(2 * n);
  shop = shopSnap.exists() ? shopSnap.data() : { name: profile.shopName, currency: profile.currency, addresses: [] };
  meta = metaSnap.exists() ? metaSnap.data() : null;
  items = []; prices = {}; reserved = {}; brands = [];
  keys.forEach((k, i) => {
    if (itemSnaps[i].exists()) {
      const d = itemSnaps[i].data();
      brands.push({ key: k, name: d.brand || k });
      for (const it of d.items || []) items.push({ ...it, brand: d.brand || k, brandKey: k });
    }
    if (priceSnaps[i].exists()) Object.assign(prices, priceSnaps[i].data().prices || {});
    if (reservedSnaps[i].exists()) Object.assign(reserved, reservedSnaps[i].data().map || {});
  });
  brands.sort((a, b) => a.name.localeCompare(b.name));
  reconcile(items, reserved);   // trim the cart to what is still available
}

async function reloadData() {
  await fetchData();
  renderApp();
}

async function loadPortal(user) {
  const email = emailKey(user.email);
  const userSnap = await getDoc(doc(db, "users", email));
  if (!userSnap.exists() || userSnap.data().active !== true) {
    if (email === ADMIN_EMAIL) { location.replace("admin.html"); return; } // the owner has no shop profile: go to Admin
    profile = { email };
    $("denied-text").textContent = t("denied_p", { email });
    show("denied");
    return;
  }
  profile = { ...userSnap.data(), email };
  if (!hasStoredLang() && LANGS.includes(profile.language)) { setLang(profile.language); applyStaticText(); }

  show("app");
  $("admin-link").hidden = email !== ADMIN_EMAIL;
  $("app-error").hidden = true;
  setPages(null);
  $("banner").replaceChildren();
  initCart(email);
  try {
    await fetchData();
  } catch (err) {
    console.error("Load error:", err);
    $("app-error").textContent = t("load_err"); $("app-error").hidden = false;
    $("shop-chip").textContent = profile.shopName || "";
    return;
  }
  firstRender = true;
  route = routeFromHash();
  renderApp();
}

// ------------------------------------------------------------------ pages and navigation
function routeFromHash() { const r = location.hash.replace("#", ""); return ROUTES.includes(r) ? r : "stock"; }
function setPages(active) {
  for (const r of ROUTES) $("page-" + r).hidden = r !== active;
  document.querySelectorAll("#nav [data-route]").forEach((b) => b.setAttribute("aria-current", b.dataset.route === active ? "page" : "false"));
}
function go(r) { if (location.hash !== "#" + r) location.hash = r; else renderApp(); }
window.addEventListener("hashchange", () => { if (profile && !$("view-app").hidden) { route = routeFromHash(); renderApp(); } });
document.querySelectorAll("#nav [data-route]").forEach((b) => b.addEventListener("click", () => go(b.dataset.route)));
$("cartbar-btn").addEventListener("click", () => go("request"));

function cartTotals() {
  const byId = new Map(items.map((i) => [i.id, i]));
  let sub = 0, tbd = false, n = 0;
  for (const e of cartEntries()) {
    const it = byId.get(e.itemId); if (!it) continue;
    n++;
    const p = prices[it.id];
    if (p) sub += p.p * e.qty; else tbd = true;
  }
  return { n, sub: Math.round(sub * 100) / 100, tbd };
}

function updateCartBar() {
  const { n, sub, tbd } = cartTotals();
  $("nav-count").textContent = String(n); $("nav-count").hidden = n === 0;
  const bar = $("cartbar");
  bar.hidden = !(n > 0 && route === "stock" && !$("view-app").hidden);
  if (n > 0) {
    const one = new Intl.PluralRules(getLang()).select(n) === "one";
    $("cartbar-text").replaceChildren(h("b", {}, t(one ? "cartbar_one" : "cartbar_other", { n })),
      " · ", tbd && !(sub > 0) ? t("r_tbd") : money(sub, profile.currency), tbd && sub > 0 ? " " + t("cartbar_tbd") : "");
    $("cartbar-btn").textContent = t("cartbar_review");
  }
}
onCartChange(() => { if (profile) updateCartBar(); });

function renderApp() {
  if (!profile || $("view-app").hidden) return;
  const cur = profile.currency;
  $("shop-chip").replaceChildren(`${shop.name} · `, h("b", {}, cur));

  const note = (profile.priceTier || "").startsWith("RETAIL") ? "pricenote_retail" : "pricenote";
  const when = dateLabel(meta && (meta.stockRefreshedAt || meta.generatedAt));
  $("banner").replaceChildren(
    ...(meta ? [h("span", {}, h("b", { text: t("asof") }), " " + when)] : []),
    h("span", { text: t(note, { cur }) }));

  const noBrand = !(Array.isArray(profile.brands) && profile.brands.length);
  if (noBrand || !meta || !items.length) {
    $("app-error").textContent = t(noBrand ? "no_brands" : "none_published"); $("app-error").className = "msg msg-info"; $("app-error").hidden = false;
    setPages(null); $("cartbar").hidden = true; return;
  }
  $("app-error").hidden = true; $("app-error").className = "msg msg-error";
  setPages(route);
  const ctx = {
    items, prices, reserved, brands, currency: cur, profile, shop, callFn, reloadData,
    goStock: () => go("stock"), goHistory: () => go("history"),
    fetchRequests: async () => (await getDocs(query(collection(db, "requests"), where("shopId", "==", profile.shopId)))).docs
  };

  if (route === "stock") {
    if (!stockView) stockView = createStockView($("stock-root"), { cart, onCartChange: updateCartBar });
    stockView.setData({ items, prices, reserved, brands, currency: cur }, firstRender);
    firstRender = false;
    const contact = $("contact");
    contact.replaceChildren();
    if (meta.contact && /^[^\s@<>"]+@[^\s@<>"]+$/.test(meta.contact)) contact.append(t("contact") + " ", h("a", { href: "mailto:" + meta.contact, text: t("contact_link") }));
  } else if (route === "request") {
    renderCartView($("page-request"), ctx);
  } else if (route === "documents") {
    renderLibrary($("page-documents"), { db, doc, getDoc, callFn, profile, brands });
  } else {
    renderHistory($("page-history"), ctx);
  }
  updateCartBar();
}

// ------------------------------------------------------------------ start
async function boot() {
  setLang(detectLang());
  applyStaticText();
  show("loading");
  if (openedFromEmailLink()) {
    const err = await completeEmailLink(askEmail);
    if (err && err !== "cancelled") pendingError = errorText(err);
  }
  onAuthStateChanged(auth, async (user) => {
    profile = null; stockView = null; $("stock-root").replaceChildren();
    if (!user) {
      show("signin");
      showSignInError(pendingError); pendingError = null;
      return;
    }
    try { await loadPortal(user); }
    catch (err) { console.error(err); show("app"); $("app-error").textContent = t("load_err"); $("app-error").hidden = false; }
  });
}
boot();
