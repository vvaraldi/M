// Which warehouse stock a shop may buy from ("stock scope"), as PURE functions (unit-tested, no Firebase).
//
//   scope "all"  the shop sees and can request the combined stock of every warehouse (the default)
//   scope "w1"   only what Eastman holds
//   scope "w2"   only what CDEC holds
//
// A shop never sees WHERE stock is: it only ever receives numbers for its own scope. The scope codes are opaque on purpose
// (w1, w2): they appear in the shop's own user record, in document names and in its requests, which the shop can read.
// Only the owner's own data (admin screens, private request record, export) uses the readable names (SCOPE_NAME).
//
// Reservations are tracked per scope: byScope = { all: {itemId: qty}, w1: {...}, w2: {...} }.
// A reservation by an "all" shop may later be shipped from either warehouse, so with two warehouses E and C (plus anything
// else, O = total - E - C) the set of reservations is feasible exactly when:
//     w1 <= E     w2 <= C     w1 + w2 <= E + C     w1 + w2 + all <= total
// so no warehouse is ever promised twice, without deciding the shipping warehouse in advance.

export const SCOPES = ["all", "w1", "w2"];
export const scopeOf = (user) => (user && SCOPES.includes(user.stockScope) ? user.stockScope : "all");
export const SCOPE_LABEL = { all: "All warehouses", w1: "Eastman only", w2: "CDEC only" };
export const SCOPE_NAME = { all: "all", w1: "eastman", w2: "cdec" };   // owner-side names (export, private request record)

const num = (x) => (typeof x === "number" && isFinite(x) && x > 0 ? x : 0);

/** Capacities of one item: E (Eastman), C (CDEC), T (total sold in the portal). detail = stockDetail[itemId]. */
export function capacities(item, detail) {
  const T = num(item && item.available);
  const E = Math.min(T, num(detail && detail.Eastman && detail.Eastman.available));
  const C = Math.min(T - E, num(detail && detail.CDEC && detail.CDEC.available));
  return { E, C, T };
}

/** How many more units a shop of `scope` can reserve now. res = { all, w1, w2 } quantities already reserved. */
export function maxAddable(scope, cap, res) {
  const all = res.all || 0, e = res.w1 || 0, c = res.w2 || 0, total = all + e + c, pair = e + c;
  const left = cap.T - total;
  if (scope === "w1") return Math.max(0, Math.min(cap.E - e, cap.E + cap.C - pair, left));
  if (scope === "w2") return Math.max(0, Math.min(cap.C - c, cap.E + cap.C - pair, left));
  return Math.max(0, left);
}

/** What a scope's shop can see as "available" in the portal, before reservations. */
export const scopeCapacity = (scope, cap) => (scope === "w1" ? cap.E : scope === "w2" ? cap.C : cap.T);

/** The quantity to show as "held" so that  available - held = maxAddable  for a shop of this scope. */
export const heldView = (scope, cap, res) => Math.max(0, scopeCapacity(scope, cap) - maxAddable(scope, cap, res));

/** Empty / legacy-safe reservation record: a document without byScope is an old all-shops record (everything is "all"). */
export function normReserved(doc) {
  const by = doc && doc.byScope ? doc.byScope : null;
  const legacyAll = (doc && doc.map) || {};
  return {
    map: { ...((doc && doc.map) || {}) },
    byScope: { all: { ...(by ? by.all || {} : legacyAll) }, w1: { ...((by && by.w1) || {}) }, w2: { ...((by && by.w2) || {}) } }
  };
}

/** Total map from the three scope maps. */
export function totalMap(byScope) {
  const out = {};
  for (const s of SCOPES) for (const [id, q] of Object.entries(byScope[s] || {})) out[id] = (out[id] || 0) + q;
  return out;
}

/**
 * The "held" maps the w1 (Eastman-only) and w2 (CDEC-only) shops read (reserved/<brand>__w1, __w2).
 * items = the brand's published items (all-scope doc); stockDetail = per item, per warehouse, from the last upload.
 */
export function scopeViews(byScope, items, stockDetail) {
  const byId = new Map((items || []).map((i) => [i.id, i]));
  const ids = new Set(SCOPES.flatMap((s) => Object.keys(byScope[s] || {})));
  const out = { w1: {}, w2: {} };
  for (const id of ids) {
    const item = byId.get(id); if (!item) continue;
    const cap = capacities(item, stockDetail && stockDetail[id]);
    const res = { all: (byScope.all || {})[id] || 0, w1: (byScope.w1 || {})[id] || 0, w2: (byScope.w2 || {})[id] || 0 };
    for (const s of ["w1", "w2"]) { const v = heldView(s, cap, res); if (v > 0) out[s][id] = v; }
  }
  return out;
}

/** Items a scope's shops see: items with stock in that warehouse, `available` replaced by that warehouse's quantity. */
export function scopeItems(items, stockDetail, scope) {
  if (scope === "all") return items;
  const out = [];
  for (const i of items) {
    const qty = scopeCapacity(scope, capacities(i, stockDetail && stockDetail[i.id]));
    if (qty > 0) out.push({ ...i, available: qty });
  }
  return out;
}
