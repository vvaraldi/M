// The stock browser (search, brand / category chips, size and condition filters, product cards).
// Used by the portal page and by the admin "Shop view", so the admin sees exactly what a shop sees.
import { t, countLabel, conditionLabel } from "./i18n.js";
import { h, filterItems, presentGroups, presentSizes, presentConditions, renderStock, sortByRebate } from "./render.js";

/**
 * createStockView(root, { cart, onCartChange, loadLarge })
 *   cart: null (read-only, no quantities) or { qty(id), set(item, n) }
 *   loadLarge(brandKey, code): async, the large picture as a data URL (or null), called when a shop opens a picture
 * Returns { setData({items, prices, reserved, brands, currency, pictures:{code:dataUrl}}, resetFilters), render() }
 */
export function createStockView(root, opts = {}) {
  const dom = {
    search: h("input", { type: "search", autocomplete: "off" }),
    size: h("select", { class: "sel" }),
    cond: h("select", { class: "sel" }),
    sort: h("select", { class: "sel" }),
    brandChips: h("div", { class: "chips", role: "group" }),
    groupChips: h("div", { class: "chips", role: "group" }),
    prevChip: h("button", { class: "chip", type: "button", "aria-pressed": "false" }),
    prevNote: h("p", { class: "hint prev-note" }),
    picChip: h("button", { class: "chip", type: "button", "aria-pressed": "true", hidden: true }),
    count: h("p", { class: "count", "aria-live": "polite" }),
    list: h("div", { class: "list-grid" }),
    picImg: h("img", { alt: "" }),
    picTitle: h("span"),
    picNote: h("p", { class: "pic-note" }),
    picClose: h("button", { class: "btn btn-ghost-light btn-sm", type: "button" })
  };
  // the enlarged picture (opens on a tap on a thumbnail; the large picture is read only now)
  dom.picDialog = h("dialog", { class: "pic-dialog", "aria-labelledby": "pic-title" },
    h("div", { class: "dh" }, h("span", { id: "pic-title" }, dom.picTitle), dom.picClose),
    h("div", { class: "db" }, dom.picImg, dom.picNote));
  dom.picClose.addEventListener("click", () => dom.picDialog.close());
  dom.picDialog.addEventListener("click", (e) => { if (e.target === dom.picDialog) dom.picDialog.close(); });
  const PIC_KEY = "m.pictures";   // per browser: "0" = this shop hides the pictures
  const picsOn = () => { try { return localStorage.getItem(PIC_KEY) !== "0"; } catch (e) { return true; } };
  const setPicsOn = (on) => { try { localStorage.setItem(PIC_KEY, on ? "1" : "0"); } catch (e) { /* the choice just is not remembered */ } };
  async function openPicture(p) {
    dom.picTitle.textContent = p.title; dom.picNote.textContent = t("pic_note"); dom.picClose.textContent = t("pic_close");
    dom.picImg.src = p.thumb; dom.picImg.alt = p.title;
    if (!dom.picDialog.open) dom.picDialog.showModal();
    if (opts.loadLarge) {
      const big = await opts.loadLarge(p.brandKey, p.code);
      if (big && dom.picDialog.open && dom.picTitle.textContent === p.title) dom.picImg.src = big;
    }
  }
  dom.chipRow = h("div", { class: "chips" }, dom.prevChip, dom.picChip);
  const label = h("label", { class: "sr-only" });
  root.replaceChildren(
    h("div", { class: "toolbar" }, h("div", { class: "search" }, h("span", { class: "search-ico", "aria-hidden": "true" }), label, dom.search), dom.size, dom.cond, dom.sort),
    dom.brandChips, dom.groupChips, dom.chipRow, dom.prevNote, dom.count, dom.list, dom.picDialog);

  let data = { items: [], prices: {}, reserved: {}, brands: [], currency: "CAD", pictures: {} };
  const f = { query: "", brand: "", group: "", size: "", condition: "", prev: false, sort: "" };

  const fillSelect = (sel, first, values, labelOf) => {
    const keep = sel.value;
    sel.replaceChildren(h("option", { value: "", text: first }), ...values.map((v) => h("option", { value: v, text: labelOf ? labelOf(v) : v })));
    sel.value = values.includes(keep) ? keep : "";
  };

  function renderList() {
    let shown = filterItems(data.items, { ...f, prices: data.prices });
    if (f.sort === "rebate") shown = sortByRebate(shown, data.prices);
    dom.count.textContent = countLabel(shown.length);
    if (!shown.length) { dom.list.replaceChildren(h("div", { class: "empty", text: t("no_results") })); return; }
    renderStock(dom.list, shown, {
      prices: data.prices, currency: data.currency, showBrand: data.brands.length > 1, reserved: data.reserved,
      cart: opts.cart || null, onCartChange: opts.onCartChange,
      pictures: data.pictures, showPictures: picsOn(), onPicture: openPicture
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

    // previous-season items: a filter, a sort and one line of explanation, only when the stock has some
    const hasPrev = scope.some((i) => data.prices[i.id] && data.prices[i.id].pct);
    if (!hasPrev) { f.prev = false; f.sort = ""; }
    dom.prevChip.hidden = dom.sort.hidden = dom.prevNote.hidden = !hasPrev;
    dom.prevChip.textContent = t("prev_only"); dom.prevChip.setAttribute("aria-pressed", String(f.prev));
    dom.prevNote.textContent = t("prev_note");
    dom.sort.setAttribute("aria-label", t("sort_label"));
    dom.sort.replaceChildren(h("option", { value: "", text: t("sort_default") }), h("option", { value: "rebate", text: t("sort_rebate") }));
    dom.sort.value = f.sort;
    // the "Show pictures" switch only exists when this shop has pictures; the choice is kept in this browser
    const hasPics = Object.keys(data.pictures || {}).length > 0;
    dom.picChip.hidden = !hasPics;
    dom.picChip.textContent = t("pics_show"); dom.picChip.setAttribute("aria-pressed", String(picsOn()));
    dom.chipRow.hidden = dom.prevChip.hidden && dom.picChip.hidden;
    renderList();
  }

  dom.search.addEventListener("input", () => { f.query = dom.search.value; renderList(); });
  dom.size.addEventListener("change", () => { f.size = dom.size.value; renderList(); });
  dom.cond.addEventListener("change", () => { f.condition = dom.cond.value; renderList(); });
  dom.sort.addEventListener("change", () => { f.sort = dom.sort.value; renderList(); });
  dom.prevChip.addEventListener("click", () => { f.prev = !f.prev; dom.prevChip.setAttribute("aria-pressed", String(f.prev)); renderList(); });
  dom.picChip.addEventListener("click", () => { setPicsOn(!picsOn()); dom.picChip.setAttribute("aria-pressed", String(picsOn())); renderList(); });

  return {
    setData(d, resetFilters = false) {
      data = { items: [], prices: {}, reserved: {}, brands: [], currency: "CAD", pictures: {}, ...d };
      if (resetFilters) { Object.assign(f, { query: "", brand: "", group: "", size: "", condition: "", prev: false, sort: "" }); dom.search.value = ""; }
      render();
    },
    render
  };
}
