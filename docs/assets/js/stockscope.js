// Which warehouse stock a shop sees ("stock scope"): the browser side. The rules are in functions/src/scope.js, which holds the
// reservation logic; scopeItems() here is a copy of its publishing function and a unit test checks that both give the same result.
//
//   all  combined stock of every warehouse (default)   documents stock/items__<brand>        reserved/<brand>
//   w1   Eastman stock only                            stock/items__<brand>__w1              reserved/<brand>__w1
//   w2   CDEC stock only                               stock/items__<brand>__w2              reserved/<brand>__w2
// The codes w1/w2 are opaque on purpose: a shop reads them in its own records, so they must not name a warehouse.
// A shop only receives the documents of its own scope, so it can never tell where stock is held.

export const SCOPES = ["all", "w1", "w2"];
export const SCOPE_LABEL = { all: "All warehouses", w1: "Eastman only", w2: "CDEC only" };
export const scopeOf = (u) => (u && SCOPES.includes(u.stockScope) ? u.stockScope : "all");
export const itemsDocId = (brandKey, scope) => (scope === "all" ? `items__${brandKey}` : `items__${brandKey}__${scope}`);
export const reservedDocId = (brandKey, scope) => (scope === "all" ? brandKey : `${brandKey}__${scope}`);

const num = (x) => (typeof x === "number" && isFinite(x) && x > 0 ? x : 0);

/** Items a scope's shops see: items with stock in that warehouse, `available` replaced by that warehouse's quantity. */
export function scopeItems(items, stockDetail, scope) {
  if (scope === "all") return items;
  const out = [];
  for (const i of items) {
    const d = (stockDetail && stockDetail[i.id]) || {}, T = num(i.available);
    const E = Math.min(T, num(d.Eastman && d.Eastman.available));
    const C = Math.min(T - E, num(d.CDEC && d.CDEC.available));
    const qty = scope === "w1" ? E : C;
    if (qty > 0) out.push({ ...i, available: qty });
  }
  return out;
}
