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
    if (f.group && groupKey(i.category) !== f.group) return false;
    if (f.size && i.size !== f.size) return false;
    if (f.condition && i.condition !== f.condition) return false;
    if (!words.length) return true;
    const hay = norm([i.description, i.size, i.color, i.sku, i.family, categoryLabel(i.category), conditionLabel(i.condition)].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

const BADGE = { New: "b-new", Demo: "b-demo", "Old graphics": "b-old", Defect: "b-defect" };

function priceCell(entry, currency, unit) {
  if (!entry) return h("div", { class: "price none", text: t("price_on_request") });
  const per = unit === "m" ? " / m" : ""; // skin rolls are priced per metre
  const el = h("div", { class: "price" }, money(entry.p, currency) + per);
  if (entry.est) el.append(h("span", { class: "badge b-est", title: t("est_tip"), text: t("est") }));
  if (entry.m && entry.m > entry.p) el.append(h("small", { text: t("msrp") + " " + money(entry.m, currency) + per }));
  return el;
}

/** Render the grouped product cards into `container`. `ctx` = { prices: {id:{p,m,est}}, currency }. */
export function renderStock(container, items, ctx) {
  container.replaceChildren();
  const groups = new Map();
  for (const i of items) {
    const key = i.category + "|" + i.description;
    if (!groups.has(key)) groups.set(key, { category: i.category, family: i.family, description: i.description, rows: [] });
    groups.get(key).rows.push(i);
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => natural(a.size, b.size) || natural(a.color, b.color) || natural(a.condition, b.condition));
    const meta = [categoryLabel(g.category), g.family].filter(Boolean).join(" · ");
    const card = h("article", { class: "product" },
      h("div", { class: "pbody" },
        h("h3", { class: "ptitle", text: g.description }),
        h("div", { class: "pmeta", text: meta }),
        h("div", { class: "vrow vhead", "aria-hidden": "true" },
          h("span", { text: t("h_size") }), h("span", { text: t("h_cond") }), h("span", { text: t("h_av") }), h("span", { text: t("h_price") })),
        g.rows.map((i) => h("div", { class: "vrow" },
          h("span", {}, [i.size, i.color].filter(Boolean).join(" · ") || "–", i.sku ? h("span", { class: "sub", text: i.sku }) : null),
          h("span", {}, h("span", { class: "badge " + (BADGE[i.condition] || "b-new"), text: conditionLabel(i.condition) })),
          h("span", { class: "avail" }, qtyFormat(i.available) + " ", h("small", { text: unitLabel(i.unit, i.available) })),
          priceCell(ctx.prices[i.id], ctx.currency, i.unit)))));
    container.append(card);
  }
}
