// Pure rendering helpers for the stock page (no Firebase here, so they can be tested on their own).
// All text from the data goes through textContent: nothing from the data is ever parsed as HTML.
import { t, money, qtyFormat, unitLabel, conditionLabel, categoryLabel, groupKey } from "./i18n.js";

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const natural = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });

/** Group keys present in the data, in the order of first appearance (the export sorts by category). */
export function presentGroups(items) {
  const seen = [];
  for (const i of items) { const g = groupKey(i.category); if (!seen.includes(g)) seen.push(g); }
  return seen;
}
export const presentSizes = (items) => [...new Set(items.map((i) => i.size).filter(Boolean))].sort(natural);
export const presentConditions = (items) => [...new Set(items.map((i) => i.condition))];

export function filterItems(items, f) {
  const words = norm(f.query).split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f.brand && i.brand !== f.brand) return false;
    if (f.group && groupKey(i.category) !== f.group) return false;
    if (f.size && i.size !== f.size) return false;
    if (f.condition && i.condition !== f.condition) return false;
    if (f.prev && !(f.prices && f.prices[i.id] && f.prices[i.id].pct)) return false;   // a previous-season item that carries a rebate in THIS shop's price list
    if (!words.length) return true;
    const hay = norm([i.description, i.size, i.color, i.code, i.sku, i.family, categoryLabel(i.category), conditionLabel(i.condition)].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** Order for "biggest rebate first": items whose price carries the largest previous-season % come first (stable for the rest). */
export const sortByRebate = (items, prices) => [...items].sort((a, b) => ((prices[b.id] && prices[b.id].pct) || 0) - ((prices[a.id] && prices[a.id].pct) || 0));

export const BADGE ={ New: "b-new", Demo: "b-demo", "Old graphics": "b-old", Defect: "b-defect" };

/** What can still be requested: the last stock upload minus what open requests hold. */
export const effective = (item, reserved) => Math.max(0, (item.available || 0) - ((reserved && reserved[item.id]) || 0));

export function priceCell(entry, currency, unit) {
  if (!entry) return h("div", { class: "price none", text: t("price_on_request") });
  const per = unit === "m" ? " / m" : ""; // skin rolls are priced per metre
  const el = h("div", { class: "price" }, money(entry.p, currency) + per);
  // previous-season item: net price above, regular price crossed out and the rebate badge (the age itself is never shown)
  if (entry.pct && entry.b > entry.p) el.append(h("small", { class: "was" }, h("s", { text: money(entry.b, currency) + per }), h("span", { class: "badge b-rebate", text: `−${entry.pct} %` })));
  if (entry.est) el.append(h("span", { class: "badge b-est", title: t("est_tip"), text: t("est") }));
  if (entry.m && entry.m > entry.p) el.append(h("small", { text: t("msrp") + " " + money(entry.m, currency) + per }));
  return el;
}

/** Quantity control: [-] [number] [+]. `cart` = { qty(id), set(item, n) }. */
export function qtyControl(item, eff, cart, onChange) {
  const name = [item.description, item.size].filter(Boolean).join(" ");
  const input = h("input", { class: "st-input", type: "number", min: "0", max: String(eff), step: "1", inputmode: "numeric", value: String(cart.qty(item.id) || 0), "aria-label": t("qty_for", { name }) });
  const minus = h("button", { class: "st-btn", type: "button", "aria-label": t("less"), text: "−" });
  const plus = h("button", { class: "st-btn", type: "button", "aria-label": t("more"), text: "+" });
  const wrap = h("span", { class: "stepper" + (cart.qty(item.id) > 0 ? " on" : "") }, minus, input, plus);
  const apply = (v) => {
    let n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > eff) n = eff;
    input.value = String(n);
    wrap.classList.toggle("on", n > 0);
    cart.set(item, n);
    if (onChange) onChange();
  };
  minus.addEventListener("click", () => apply(Number(input.value) - 1));
  plus.addEventListener("click", () => apply(Number(input.value) + 1));
  input.addEventListener("change", () => apply(input.value));
  input.addEventListener("focus", () => input.select());
  return wrap;
}

/**
 * Render the grouped product cards into `container`.
 * ctx = { prices:{id:{p,m,est}}, currency, showBrand, reserved:{id:qty}, cart:null|{qty,set}, onCartChange }
 */
export function renderStock(container, items, ctx) {
  container.replaceChildren();
  const reserved = ctx.reserved || {}, cart = ctx.cart || null;
  const groups = new Map();
  for (const i of items) {
    const key = i.brand + "|" + i.category + "|" + i.description;
    if (!groups.has(key)) groups.set(key, { brand: i.brand, category: i.category, family: i.family, description: i.description, rows: [] });
    groups.get(key).rows.push(i);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => natural(a.size, b.size) || natural(a.color, b.color) || natural(a.condition, b.condition));
    const meta = [ctx.showBrand ? g.brand : "", categoryLabel(g.category), g.family].filter(Boolean).join(" · ");
    const card = h("article", { class: "product" },
      h("div", { class: "pbody" },
        h("h3", { class: "ptitle", text: g.description }),
        h("div", { class: "pmeta", text: meta }),
        h("div", { class: "vrow vhead" + (cart ? " has-qty" : ""), "aria-hidden": "true" },
          h("span", { text: t("h_size") }), h("span", { text: t("h_cond") }), h("span", { text: t("h_av") }), h("span", { text: t("h_price") }), cart ? h("span", { text: t("qty") }) : null),
        g.rows.map((i) => {
          const eff = effective(i, reserved), held = (reserved[i.id] || 0) > 0;
          const avail = eff > 0
            ? h("span", { class: "avail" }, qtyFormat(eff) + " ", h("small", { text: unitLabel(i.unit, eff) }))
            : h("span", { class: "avail" }, held ? h("span", { class: "badge b-held", text: t("reserved_badge") }) : "0");
          return h("div", { class: "vrow" + (cart ? " has-qty" : "") + (eff <= 0 ? " is-out" : "") },
            h("span", {}, [i.size, i.color].filter(Boolean).join(" · ") || "–", i.code ? h("span", { class: "sub", text: i.code }) : null),
            h("span", {}, h("span", { class: "badge " + (BADGE[i.condition] || "b-new"), text: conditionLabel(i.condition) }),
              (ctx.prices[i.id] && ctx.prices[i.id].pct) ? h("span", { class: "badge b-prev", text: t("prev_season") }) : null),
            avail,
            priceCell(ctx.prices[i.id], ctx.currency, i.unit),
            cart ? (eff > 0 ? qtyControl(i, eff, cart, ctx.onCartChange) : h("span", {})) : null);
        })));
    container.append(card);
  }
}
