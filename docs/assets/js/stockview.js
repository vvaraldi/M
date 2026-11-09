// The stock browser (search, brand / category chips, size and condition filters, product cards).
// Used by the portal page and by the admin "Shop view", so the admin sees exactly what a shop sees.
import { t, countLabel, conditionLabel } from "./i18n.js";
import { h, filterItems, presentGroups, presentSizes, presentConditions, renderStock } from "./render.js";

/**
 * createStockView(root, { cart, onCartChange })
 *   cart: null (read-only, no quantities) or { qty(id), set(item, n) }
 * Returns { setData({items, prices, reserved, brands, currency}, resetFilters), render() }
 */
export function createStockView(root, opts = {}) {
  const dom = {
    search: h("input", { type: "search", autocomplete: "off" }),
    size: h("select", { class: "sel" }),
    cond: h("select", { class: "sel" }),
    brandChips: h("div", { class: "chips", role: "group" }),
    groupChips: h("div", { class: "chips", role: "group" }),
    count: h("p", { class: "count", "aria-live": "polite" }),
    list: h("div", { class: "list-grid" })
  };
  const label = h("label", { class: "sr-only" });
  root.replaceChildren(
    h("div", { class: "toolbar" }, h("div", { class: "search" }, h("span", { class: "search-ico", "aria-hidden": "true" }), label, dom.search), dom.size, dom.cond),
    dom.brandChips, dom.groupChips, dom.count, dom.list);

  let data = { items: [], prices: {}, reserved: {}, brands: [], currency: "CAD" };
  const f = { query: "", brand: "", group: "", size: "", condition: "" };

  const fillSelect = (sel, first, values, labelOf) => {
    const keep = sel.value;
    sel.replaceChildren(h("option", { value: "", text: first }), ...values.map((v) => h("option", { value: v, text: labelOf ? labelOf(v) : v })));
    sel.value = values.includes(keep) ? keep : "";
  };

  function renderList() {
    const shown = filterItems(data.items, f);
    dom.count.textContent = countLabel(shown.length);
    if (!shown.length) { dom.list.replaceChildren(h("div", { class: "empty", text: t("no_results") })); return; }
    renderStock(dom.list, shown, {
      prices: data.prices, currency: data.currency, showBrand: data.brands.length > 1, reserved: data.reserved,
      cart: opts.cart || null, onCartChange: opts.onCartChange
    });
  }

  function render() {
    label.textContent = t("search_lbl"); label.htmlFor = "";
    dom.search.placeholder = t("search_ph"); dom.search.setAttribute("aria-label", t("search_lbl"));
    dom.size.setAttribute("aria-label", t("h_size")); dom.cond.setAttribute("aria-label", t("h_cond"));

    if (f.brand && !data.brands.some((b) => b.name === f.brand)) f.brand = "";
    dom.brandChips.hidden = data.brands.length < 2;
    if (data.brands.length < 2) dom.brandChips.replaceChildren();
    else {
      const mk = (name, text) => {
        const b = h("button", { class: "chip", type: "button", "aria-pressed": String(f.brand === name), text });
        b.addEventListener("click", () => { f.brand = name; render(); });
        return b;
      };
      dom.brandChips.replaceChildren(mk("", t("all_brands")), ...data.brands.map((b) => mk(b.name, b.name)));
    }
    const scope = f.brand ? data.items.filter((i) => i.brand === f.brand) : data.items;
    fillSelect(dom.size, t("all_sizes"), presentSizes(scope));
    fillSelect(dom.cond, t("all_cond"), presentConditions(scope), conditionLabel);
    f.size = dom.size.value; f.condition = dom.cond.value;

    const groups = presentGroups(scope);
    if (f.group && !groups.includes(f.group)) f.group = "";
    const mkg = (key, text) => {
      const b = h("button", { class: "chip", type: "button", "aria-pressed": String(f.group === key), text });
      b.addEventListener("click", () => { f.group = key; render(); });
      return b;
    };
    dom.groupChips.replaceChildren(mkg("", t("all")), ...groups.map((g) => mkg(g, t(g))));
    renderList();
  }

  dom.search.addEventListener("input", () => { f.query = dom.search.value; renderList(); });
  dom.size.addEventListener("change", () => { f.size = dom.size.value; renderList(); });
  dom.cond.addEventListener("change", () => { f.condition = dom.cond.value; renderList(); });

  return {
    setData(d, resetFilters = false) {
      data = { items: [], prices: {}, reserved: {}, brands: [], currency: "CAD", ...d };
      if (resetFilters) { Object.assign(f, { query: "", brand: "", group: "", size: "", condition: "" }); dom.search.value = ""; }
      render();
    },
    render
  };
}
