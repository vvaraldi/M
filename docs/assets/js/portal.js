// Portal page: sign-in with an emailed link, invitation check, stock list.
import {
  auth, db, onAuthStateChanged, signOut, doc, getDoc, updateDoc,
  sendLink, openedFromEmailLink, completeEmailLink, emailKey
} from "./fb.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import { LANGS, t, setLang, getLang, detectLang, rememberLang, countLabel, dateLabel, categoryLabel, conditionLabel } from "./i18n.js";
import { h, filterItems, presentGroups, presentSizes, presentConditions, renderStock } from "./render.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["loading", "signin", "sent", "confirm", "denied", "app"];
const show = (name) => VIEWS.forEach((v) => { $("view-" + v).hidden = v !== name; });

let profile = null, shop = null, meta = null, items = [], prices = {}, brands = [];   // brands: [{key,name}] that have stock
let pendingError = null, lastEmail = "";
const filters = { query: "", brand: "", group: "", size: "", condition: "" };

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
    }, { once: false });
  });
}

document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", () => signOut(auth)));
document.querySelectorAll("[data-pills]").forEach((p) => p.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-l]"); if (b) chooseLang(b.dataset.l);
}));

// ------------------------------------------------------------------ data
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
  $("stock-ui").hidden = true;
  $("banner").replaceChildren();
  try {
    // Only the brands the admin allowed for this user are requested (the security rules enforce the same list).
    const keys = (Array.isArray(profile.brands) ? profile.brands : []).filter((k) => /^[a-z0-9]+$/.test(k));
    const [shopSnap, metaSnap, ...rest] = await Promise.all([
      getDoc(doc(db, "shops", profile.shopId)),
      getDoc(doc(db, "stock", "meta")),
      ...keys.map((k) => getDoc(doc(db, "stock", `items__${k}`))),
      ...keys.map((k) => getDoc(doc(db, "prices", `${profile.priceTier}__${k}`)))
    ]);
    const itemSnaps = rest.slice(0, keys.length), priceSnaps = rest.slice(keys.length);
    shop = shopSnap.exists() ? shopSnap.data() : { name: profile.shopName, currency: profile.currency };
    meta = metaSnap.exists() ? metaSnap.data() : null;
    items = []; prices = {}; brands = [];
    keys.forEach((k, n) => {
      if (itemSnaps[n].exists()) {
        const d = itemSnaps[n].data();
        brands.push({ key: k, name: d.brand || k });
        for (const it of d.items || []) items.push({ ...it, brand: d.brand || k });
      }
      if (priceSnaps[n].exists()) Object.assign(prices, priceSnaps[n].data().prices || {});
    });
    brands.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error("Load error:", err);
    $("app-error").textContent = t("load_err"); $("app-error").hidden = false;
    $("shop-chip").textContent = profile.shopName || "";
    return;
  }
  buildFilters();
  renderApp();
}

// ------------------------------------------------------------------ stock UI
function fillSelect(sel, firstLabel, values, labelOf) {
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "", text: firstLabel }), ...values.map((v) => h("option", { value: v, text: labelOf ? labelOf(v) : v })));
  sel.value = values.includes(keep) ? keep : "";
}

function buildFilters() {
  filters.query = ""; filters.brand = ""; filters.group = ""; filters.size = ""; filters.condition = "";
  $("q").value = "";
}

function renderApp() {
  if (!profile || $("view-app").hidden) return;
  const cur = profile.currency;
  const strong = (tag, txt) => h(tag, {}, txt);
  $("shop-chip").replaceChildren(`${shop.name} · `, strong("b", cur));

  const note = (profile.priceTier || "").startsWith("RETAIL") ? "pricenote_retail" : "pricenote";
  const when = dateLabel(meta && (meta.stockRefreshedAt || meta.generatedAt));
  $("banner").replaceChildren(
    ...(meta ? [h("span", {}, h("b", { text: t("asof") }), " " + when)] : []),
    h("span", { text: t(note, { cur }) }));

  const noBrand = !(Array.isArray(profile.brands) && profile.brands.length);
  if (noBrand || !meta || !items.length) {
    $("app-error").textContent = t(noBrand ? "no_brands" : "none_published"); $("app-error").className = "msg msg-info"; $("app-error").hidden = false;
    $("stock-ui").hidden = true; return;
  }
  $("app-error").hidden = true; $("app-error").className = "msg msg-error";
  $("stock-ui").hidden = false;

  // brand chips: only when this user may see more than one brand that has stock
  if (filters.brand && !brands.some((b) => b.name === filters.brand)) filters.brand = "";
  const brandBox = $("brand-chips");
  brandBox.hidden = brands.length < 2;
  if (brands.length >= 2) {
    const mkb = (name, label) => {
      const b = h("button", { class: "chip", type: "button", "aria-pressed": String(filters.brand === name), text: label });
      b.addEventListener("click", () => { filters.brand = name; renderApp(); });
      return b;
    };
    brandBox.replaceChildren(mkb("", t("all_brands")), ...brands.map((b) => mkb(b.name, b.name)));
  }
  const scope = filters.brand ? items.filter((i) => i.brand === filters.brand) : items;

  fillSelect($("size"), t("all_sizes"), presentSizes(scope));
  fillSelect($("cond"), t("all_cond"), presentConditions(scope), conditionLabel);
  filters.size = $("size").value; filters.condition = $("cond").value;

  // group chips
  const groups = presentGroups(scope);
  if (filters.group && !groups.includes(filters.group)) filters.group = "";
  const mk = (key, label) => {
    const b = h("button", { class: "chip", type: "button", "aria-pressed": String(filters.group === key), text: label });
    b.addEventListener("click", () => { filters.group = key; renderApp(); });
    return b;
  };
  $("chips").replaceChildren(mk("", t("all")), ...groups.map((g) => mk(g, t(g))));

  const contact = $("contact");
  contact.replaceChildren();
  if (meta.contact && /^[^\s@<>"]+@[^\s@<>"]+$/.test(meta.contact)) {
    contact.append(t("contact") + " ", h("a", { href: "mailto:" + meta.contact, text: t("contact_link") }));
  }
  renderList();
}

function renderList() {
  const shown = filterItems(items, filters);
  $("count").textContent = countLabel(shown.length);
  const list = $("list");
  if (!shown.length) { list.replaceChildren(h("div", { class: "empty", text: t("no_results") })); return; }
  renderStock(list, shown, { prices, currency: profile.currency, showBrand: brands.length > 1 });
}

$("q").addEventListener("input", (e) => { filters.query = e.target.value; renderList(); });
$("size").addEventListener("change", (e) => { filters.size = e.target.value; renderList(); });
$("cond").addEventListener("change", (e) => { filters.condition = e.target.value; renderList(); });

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
    profile = null;
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
