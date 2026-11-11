import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeItems as docsScopeItems, itemsDocId, reservedDocId, scopeOf as docsScopeOf } from "../../docs/assets/js/stockscope.js";
import { capacities, maxAddable, heldView, scopeViews, scopeItems, normReserved, totalMap, scopeOf, SCOPES } from "./scope.js";

const cap = (E, C, T = E + C) => ({ E, C, T });

test("capacities come from the warehouse detail and never exceed the total", () => {
  assert.deepEqual(capacities({ available: 5 }, { Eastman: { available: 3 }, CDEC: { available: 2 } }), { E: 3, C: 2, T: 5 });
  assert.deepEqual(capacities({ available: 5 }, undefined), { E: 0, C: 0, T: 5 });
  assert.deepEqual(capacities({ available: 4 }, { Eastman: { available: 3 }, CDEC: { available: 3 } }), { E: 3, C: 1, T: 4 });   // detail larger than the total: trimmed
});

test("an Eastman-only shop is limited to Eastman, a CDEC-only shop to CDEC, an all-warehouses shop to the total", () => {
  const c = cap(3, 2);
  assert.equal(maxAddable("w1", c, {}), 3);
  assert.equal(maxAddable("w2", c, {}), 2);
  assert.equal(maxAddable("all", c, {}), 5);
});

test("reservations of one scope reduce what the others can still take, but only as far as they must", () => {
  const c = cap(3, 2);
  // an all-warehouses shop holds 2: they could still be shipped from CDEC, so Eastman is untouched
  assert.equal(maxAddable("w1", c, { all: 2 }), 3);
  assert.equal(maxAddable("w2", c, { all: 2 }), 2);   // min(C = 2, total left = 3)
  // an all shop holds 4: only one unit is left overall
  assert.equal(maxAddable("w1", c, { all: 4 }), 1);
  assert.equal(maxAddable("w2", c, { all: 4 }), 1);
  assert.equal(maxAddable("all", c, { all: 4 }), 1);
  // a CDEC-only shop holds 2 (all of CDEC): the Eastman-only and all shops still see Eastman's 3
  assert.equal(maxAddable("w1", c, { w2: 2 }), 3);
  assert.equal(maxAddable("all", c, { w2: 2 }), 3);
  assert.equal(maxAddable("w2", c, { w2: 2 }), 0);
});

test("what the shop sees (available - held) is exactly what it can still request", () => {
  for (const scope of SCOPES) for (const [E, C] of [[3, 2], [0, 4], [5, 0], [1, 1]]) {
    const c = cap(E, C);
    for (let a = 0; a <= E + C; a++) for (let e = 0; e <= E; e++) for (let k = 0; k <= C; k++) {
      const res = { all: a, w1: e, w2: k };
      const shown = Math.max(0, (scope === "w1" ? E : scope === "w2" ? C : E + C) - heldView(scope, c, res));
      assert.equal(shown, maxAddable(scope, c, res), `${scope} E${E} C${C} ${JSON.stringify(res)}`);
    }
  }
});

// Exhaustive check: whatever order shops order in, accepted reservations can always be shipped from the warehouses.
function feasible(E, C, T, res) {
  // brute force: split the "all" demand between Eastman, CDEC and the rest
  for (let toE = 0; toE <= res.all; toE++) for (let toC = 0; toE + toC <= res.all; toC++) {
    const rest = res.all - toE - toC;
    if (res.w1 + toE <= E && res.w2 + toC <= C && rest <= T - E - C) return true;
  }
  return false;
}
test("accepting only what maxAddable allows never promises a warehouse twice (random orders)", () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 400; round++) {
    const E = rnd(6), C = rnd(6), T = E + C + rnd(3), c = { E, C, T }, res = { all: 0, w1: 0, w2: 0 };
    for (let step = 0; step < 12; step++) {
      const scope = SCOPES[rnd(3)], q = 1 + rnd(4), ok = q <= maxAddable(scope, c, res);
      if (ok) res[scope] += q;
      assert.ok(feasible(E, C, T, res), `${JSON.stringify({ E, C, T, res })}`);
      if (!ok) assert.ok(!feasible(E, C, T, { ...res, [scope]: res[scope] + q }), "refused although it fitted");   // and nothing that fits is refused
    }
  }
});

test("scope documents: items and held views", () => {
  const items = [{ id: "a", available: 5, description: "A" }, { id: "b", available: 2, description: "B" }, { id: "c", available: 1, description: "C" }];
  const detail = { a: { Eastman: { available: 3 }, CDEC: { available: 2 } }, b: { CDEC: { available: 2 } }, c: { Eastman: { available: 1 } } };
  assert.deepEqual(scopeItems(items, detail, "w1").map((i) => [i.id, i.available]), [["a", 3], ["c", 1]]);
  assert.deepEqual(scopeItems(items, detail, "w2").map((i) => [i.id, i.available]), [["a", 2], ["b", 2]]);
  assert.equal(scopeItems(items, detail, "all"), items);
  const v = scopeViews({ all: { a: 4 }, w1: {}, w2: { b: 1 } }, items, detail);
  assert.deepEqual(v.w1, { a: 2 });        // 3 shown - 1 addable (5 total - 4 held)... = held 2
  assert.deepEqual(v.w2, { a: 1, b: 1 });     // CDEC: 2 shown, 1 addable on a; b: held 1
});

test("old reservation documents (no byScope) are all-warehouse reservations", () => {
  const n = normReserved({ map: { a: 2 } });
  assert.deepEqual(n.byScope, { all: { a: 2 }, w1: {}, w2: {} });
  assert.deepEqual(normReserved(undefined).byScope, { all: {}, w1: {}, w2: {} });
  assert.deepEqual(totalMap({ all: { a: 1 }, w1: { a: 2, b: 1 }, w2: {} }), { a: 3, b: 1 });
  assert.equal(scopeOf({ stockScope: "w2" }), "w2"); assert.equal(scopeOf({ stockScope: "mars" }), "all"); assert.equal(scopeOf({}), "all");
});

test("the browser copy of scopeItems publishes exactly what the function module would", () => {
  let seed = 3; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const items = Array.from({ length: 60 }, (_, n) => ({ id: "i" + n, available: rnd(8) }));
  const detail = Object.fromEntries(items.filter(() => rnd(5) > 0).map((i) => [i.id, { Eastman: { available: rnd(9) }, CDEC: { available: rnd(9) } }]));
  for (const s of SCOPES) assert.deepEqual(docsScopeItems(items, detail, s), scopeItems(items, detail, s), s);
  assert.equal(itemsDocId("skitrab", "all"), "items__skitrab"); assert.equal(itemsDocId("skitrab", "w2"), "items__skitrab__w2");
  assert.equal(reservedDocId("skitrab", "all"), "skitrab"); assert.equal(reservedDocId("skitrab", "w1"), "skitrab__w1");
  assert.equal(docsScopeOf({ stockScope: "w2" }), scopeOf({ stockScope: "w2" })); assert.equal(docsScopeOf({ stockScope: "x" }), "all");
});