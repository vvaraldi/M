import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDocumentAccess, regionOf, contentTypeOf } from "./access.js";
import { buildManifests, manifestsFor, validateRecord } from "../../docs/assets/js/library.js";

const rec = (o) => ({ id: "d1", brandKey: "skitrab", kind: "pricelist", title: "CAD list", regions: ["canada"], private: true,
  file: { path: "library/skitrab/d1-cad.xlsx", url: "", name: "cad.xlsx", size: 90000 }, ...o });
const user = (o) => ({ active: true, brands: ["skitrab"], currency: "CAD", ...o });

test("only an active shop with the brand and the region may download", () => {
  assert.equal(checkDocumentAccess(user(), rec()), "");
  assert.equal(checkDocumentAccess(null, rec()), "denied");
  assert.equal(checkDocumentAccess(user({ active: false }), rec()), "denied");
  assert.equal(checkDocumentAccess(user({ currency: "USD" }), rec()), "not-found");           // USA shop, Canada-only list
  assert.equal(checkDocumentAccess(user({ currency: "USD", region: "canada" }), rec()), ""); // the owner's region choice wins
  assert.equal(checkDocumentAccess(user({ brands: ["villacampa"] }), rec()), "not-found");
  assert.equal(checkDocumentAccess(user({ brands: undefined }), rec()), "not-found");
  assert.equal(checkDocumentAccess(user(), undefined), "not-found");
  assert.equal(regionOf({ currency: "EUR" }), "other");
});

test("the function allows exactly what the shop's manifest lists (same rule in both places)", () => {
  const records = [rec(), rec({ id: "d2", regions: ["usa"] }), rec({ id: "d3", brandKey: "villacampa", regions: ["canada", "usa"] }), rec({ id: "d4", regions: ["canada", "usa", "other"] })];
  const manifests = buildManifests(records);
  for (const u of [user(), user({ currency: "USD" }), user({ currency: "EUR" }), user({ brands: ["skitrab", "villacampa"] }), user({ brands: [] })]) {
    const listed = new Set(manifestsFor(u.brands, regionOf(u)).flatMap((m) => (manifests[m] ? manifests[m].items : [])).map((i) => i.id));
    const allowed = new Set(records.filter((r) => checkDocumentAccess(u, r) === "").map((r) => r.id));
    assert.deepEqual([...allowed].sort(), [...listed].sort());
  }
});

test("a private document never exposes a link or a path to shops", () => {
  const m = buildManifests([rec()]);
  const json = JSON.stringify(m);
  assert.ok(!json.includes("url") && !json.includes("library/skitrab") && !json.includes("token"));
  assert.equal(m["skitrab__canada"].items[0].private, true);
  const pub = buildManifests([rec({ private: false, file: { path: "library/skitrab/d1.pdf", url: "https://x.test/f?token=1", name: "d1.pdf", size: 5e7 } })]);
  assert.equal(pub["skitrab__canada"].items[0].url, "https://x.test/f?token=1");
});

test("private files must be small; a public one needs its link", () => {
  assert.equal(validateRecord(rec()), "");
  assert.match(validateRecord(rec({ file: { path: "p", url: "", name: "a.xlsx", size: 8 * 1024 * 1024 } })), /7 MB/);
  assert.match(validateRecord(rec({ private: false })), /file/);   // public but no link
});

test("content types", () => {
  assert.match(contentTypeOf("a.XLSX"), /spreadsheetml/); assert.equal(contentTypeOf("a.pdf"), "application/pdf"); assert.equal(contentTypeOf("noext"), "application/octet-stream");
});
