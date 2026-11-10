import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifests, manifestsFor, validateRecord, regionFromCurrency, safeFileName, fileFormat, humanSize, manifestId, REGIONS } from "../../docs/assets/js/library.js";

const file = (name, size = 1000) => ({ path: "library/x/" + name, url: "https://example.test/" + name, name, size });
const recs = [
  { id: "d1", brandKey: "skitrab", kind: "catalog", title: "Alpine catalog", season: "2026-27", regions: ["canada", "usa", "other"], file: file("alp26.pdf", 19e6), hasCover: true, updatedAt: "2026-11-09" },
  { id: "d2", brandKey: "skitrab", kind: "catalog", title: "Alpine catalog", season: "2025-26", regions: ["canada", "usa", "other"], file: file("alp25.pdf"), hasCover: true },
  { id: "d3", brandKey: "skitrab", kind: "pricelist", title: "Price list CAD", season: "2026-27", regions: ["canada"], file: file("cad.xlsx", 80e3) },
  { id: "d4", brandKey: "skitrab", kind: "pricelist", title: "Price list USD", season: "2026-27", regions: ["usa"], file: file("usd.xlsx") },
  { id: "d5", brandKey: "villacampa", kind: "catalog", title: "VillaCampa catalog", season: "2026", regions: ["canada"], file: file("vc.pdf") }
];

test("each brand + region only gets the documents meant for it", () => {
  const m = buildManifests(recs);
  assert.deepEqual(Object.keys(m).sort(), ["skitrab__canada", "skitrab__other", "skitrab__usa", "villacampa__canada"]);
  const titles = (id) => m[id].items.map((i) => i.title + (i.kind === "pricelist" ? "" : " " + i.season));
  assert.deepEqual(titles("skitrab__canada"), ["Alpine catalog 2026-27", "Alpine catalog 2025-26", "Price list CAD"]);   // catalogs first, newest season first
  assert.deepEqual(titles("skitrab__usa"), ["Alpine catalog 2026-27", "Alpine catalog 2025-26", "Price list USD"]);
  assert.deepEqual(titles("skitrab__other"), ["Alpine catalog 2026-27", "Alpine catalog 2025-26"]);              // no price list for other countries
  assert.equal(m["villacampa__usa"], undefined);                                                                  // nothing for the USA: no manifest at all
});

test("a Canadian shop never gets the USA price list, and a brand it lacks gives nothing", () => {
  const m = buildManifests(recs);
  const read = (brands, region) => manifestsFor(brands, region).flatMap((id) => (m[id] ? m[id].items : [])).map((i) => i.title);
  assert.ok(!read(["skitrab"], "canada").includes("Price list USD"));
  assert.ok(read(["skitrab"], "usa").includes("Price list USD") && !read(["skitrab"], "usa").includes("Price list CAD"));
  assert.ok(!read(["skitrab"], "canada").includes("VillaCampa catalog"));
  assert.ok(read(["skitrab", "villacampa"], "canada").includes("VillaCampa catalog"));
  assert.deepEqual(read([], "canada"), []);
});

test("manifests carry no storage paths, only what a shop needs", () => {
  const item = buildManifests(recs)["skitrab__canada"].items[0];
  assert.deepEqual(Object.keys(item).sort(), ["format", "hasCover", "id", "kind", "name", "private", "season", "size", "title", "updatedAt", "url"]);
  assert.equal(JSON.stringify(buildManifests(recs)).includes("library/x/"), false);
  assert.equal(item.format, "pdf");
});

test("validation catches the usual mistakes", () => {
  const ok = recs[0];
  assert.equal(validateRecord(ok), "");
  assert.match(validateRecord({ ...ok, title: " " }), /title/);
  assert.match(validateRecord({ ...ok, brandKey: "" }), /brand/);
  assert.match(validateRecord({ ...ok, kind: "photo" }), /catalog or price list/);
  assert.match(validateRecord({ ...ok, regions: [] }), /region/);
  assert.match(validateRecord({ ...ok, regions: ["mars"] }), /region/);
  assert.match(validateRecord({ ...ok, file: null }), /file/);
});

test("helpers: region from currency, safe file names, formats, sizes", () => {
  assert.equal(regionFromCurrency("CAD"), "canada"); assert.equal(regionFromCurrency("USD"), "usa"); assert.equal(regionFromCurrency("EUR"), "other");
  assert.equal(safeFileName("Liste de prix 26-27 (CAD) é.xlsx"), "Liste-de-prix-26-27-CAD-e.xlsx");
  assert.equal(safeFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeFileName("CATALOGUE_ALP_2026.PDF"), "CATALOGUE_ALP_2026.pdf");
  assert.equal(fileFormat("a.PDF"), "pdf"); assert.equal(fileFormat("a.xlsx"), "xlsx"); assert.equal(fileFormat("noext"), "file");
  assert.equal(humanSize(19e6), "18 MB"); assert.equal(humanSize(80e3), "78 KB"); assert.equal(humanSize(0), "");
  assert.equal(manifestId("skitrab", "usa"), "skitrab__usa"); assert.equal(REGIONS.length, 3);
});
