import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSize, packThumbs, validatePackage, planBrand, planOps, batchOps, codeOk, brandOk, thumbDocId, largeDocId, loadThumbs, loadLarge, dataUrl } from "../../docs/assets/js/pictures.js";

test("fitSize keeps the proportions and never enlarges", () => {
  assert.deepEqual(fitSize(1000, 500, [320, 240]), [320, 160]);
  assert.deepEqual(fitSize(100, 400, [320, 240]), [60, 240]);
  assert.deepEqual(fitSize(90, 105, [900, 900]), [90, 105]);              // small stays small
  assert.deepEqual(fitSize(90, 105, [900, 900], true), [771, 900]);       // unless asked
});

test("packThumbs fills documents up to the limit, in code order", () => {
  const map = { B2: "x".repeat(100), A1: "y".repeat(100), C3: "z".repeat(100) };
  assert.deepEqual(packThumbs(map, 1000).map((c) => Object.keys(c)), [["A1", "B2", "C3"]]);
  assert.deepEqual(packThumbs(map, 230).map((c) => Object.keys(c)), [["A1", "B2"], ["C3"]]);
  assert.deepEqual(packThumbs({}, 100), []);
  assert.equal(packThumbs({ A1: "x".repeat(500) }, 100).length, 1);          // one picture bigger than the limit still gets its document
});

test("code and brand keys", () => {
  assert.ok(codeOk("13214") && codeOk("40328B") && codeOk("PRB02"));
  assert.ok(!codeOk("") && !codeOk("1") && !codeOk("13 214") && !codeOk("a/b") && !codeOk("x".repeat(31)) && !codeOk(5));
  assert.ok(brandOk("skitrab") && !brandOk("Ski Trab") && !brandOk(""));
});

test("validatePackage accepts a good package and explains a bad one", () => {
  const good = { schema: 1, brands: { skitrab: { 13214: { t: "AAAA", l: "BBBB==" } } } };
  assert.deepEqual(validatePackage(good), { skitrab: { 13214: { t: "AAAA", l: "BBBB==" } } });
  assert.throws(() => validatePackage(null), /pictures\.json/);
  assert.throws(() => validatePackage({ schema: 2, brands: {} }), /schema 1/);
  assert.throws(() => validatePackage({ schema: 1, brands: { "Ski Trab": {} } }), /Brand key/);
  assert.throws(() => validatePackage({ schema: 1, brands: { skitrab: { "a/b": { t: "AA", l: "BB" } } } }), /Part number/);
  assert.throws(() => validatePackage({ schema: 1, brands: { skitrab: { 13214: { t: "not base64!", l: "BB" } } } }), /13214/);
  assert.throws(() => validatePackage({ schema: 1, brands: { skitrab: { 13214: { t: "A".repeat(80001), l: "BB" } } } }), /thumbnail is too large/);
  assert.throws(() => validatePackage({ schema: 1, brands: { skitrab: { 13214: { t: "AA", l: "B".repeat(700001) } } } }), /large picture is too large/);
});

test("planBrand writes chunks, manifest and large pictures, and cleans up what disappeared", () => {
  const thumbs = { A1: "aa", B2: "bb" };
  const p = planBrand("skitrab", thumbs, { A1: "LA", B2: "LB" }, null);
  assert.deepEqual(p.sets.map((s) => `${s.col}/${s.id}`), ["pictureThumbs/skitrab__1", "pictures/skitrab", "pictureLarge/skitrab__A1", "pictureLarge/skitrab__B2"]);
  assert.deepEqual(p.sets[1].data, { chunks: 1, codes: ["A1", "B2"] });
  assert.deepEqual(p.deletes, []);

  // second publish: C3 is gone, the old manifest had 3 chunk documents
  const old = { chunks: 3, codes: ["A1", "B2", "C3"] };
  const q = planBrand("skitrab", thumbs, {}, old);
  assert.deepEqual(q.deletes.map((d) => `${d.col}/${d.id}`), ["pictureThumbs/skitrab__2", "pictureThumbs/skitrab__3", "pictureLarge/skitrab__C3"]);

  // everything removed: the manifest goes too
  const none = planBrand("skitrab", {}, {}, old);
  assert.deepEqual(none.sets, []);
  assert.ok(none.deletes.some((d) => d.col === "pictures" && d.id === "skitrab"));
  assert.equal(thumbDocId("a", 2), "a__2");
  assert.equal(largeDocId("a", "X1"), "a__X1");
});

test("planOps puts pictures before thumbnails and the manifest, deletions last; batchOps keeps batches small", () => {
  const plan = planBrand("skitrab", { A1: "aa" }, { A1: "LA" }, { chunks: 2, codes: ["A1", "Z9"] });
  assert.deepEqual(planOps(plan).map((o) => `${o.op} ${o.col}/${o.id}`), [
    "set pictureLarge/skitrab__A1", "set pictureThumbs/skitrab__1", "set pictures/skitrab",
    "delete pictureThumbs/skitrab__2", "delete pictureLarge/skitrab__Z9"]);
  const ops = Array.from({ length: 5 }, (_, i) => ({ op: "set", col: "c", id: "x" + i, data: { v: "a".repeat(100) } }));
  assert.deepEqual(batchOps(ops, 1e6, 2).map((b) => b.length), [2, 2, 1]);          // by count
  assert.deepEqual(batchOps(ops, 250, 100).map((b) => b.length), [2, 2, 1]);        // by size (~110 bytes each)
  assert.deepEqual(batchOps([], 100, 10), []);
});

// a tiny in-memory Firestore for the readers
function fakeCtx(docs) {
  return { db: "db", doc: (_db, col, id) => ({ col, id }), getDoc: async (r) => { const d = docs[r.col + "/" + r.id]; return { exists: () => !!d, data: () => d }; } };
}

test("loadThumbs reads manifest and chunks; a missing brand or a read error just means no pictures", async () => {
  const ctx = fakeCtx({ "pictures/skitrab": { chunks: 2 }, "pictureThumbs/skitrab__1": { map: { A1: "aa" } }, "pictureThumbs/skitrab__2": { map: { B2: "bb" } } });
  const r = await loadThumbs(ctx, ["skitrab", "villacampa"]);
  assert.deepEqual(r.byCode, { A1: dataUrl("aa"), B2: dataUrl("bb") });
  assert.deepEqual(r.brandOf, { A1: "skitrab", B2: "skitrab" });
  const bad = { db: 1, doc: () => ({}), getDoc: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); } };
  assert.deepEqual((await loadThumbs(bad, ["skitrab"])).byCode, {});
  assert.equal(await loadLarge(bad, "skitrab", "A1"), null);
  assert.equal(await loadLarge(fakeCtx({ "pictureLarge/skitrab__A1": { data: "LL" } }), "skitrab", "A1"), dataUrl("LL"));
});
