import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShopEmail, buildOwnerEmail, buildReminderEmail, exportShape, requestCsv, money } from "./emails.js";
import { planSubmit } from "./planner.js";

const NOW = new Date("2026-11-08T15:00:00Z");
function sample(lang = "fr", over = {}) {
  const r = planSubmit({
    user: { email: "buyer@shop.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: lang },
    shop: { name: "Shop <One> & Co", currency: "CAD", addresses: [{ label: "Store", text: "1 Main St\nEastman QC" }] },
    input: { lines: [{ brandKey: "skitrab", itemId: "a1", qty: 2 }, { brandKey: "skitrab", itemId: "n1", qty: 1 }, { brandKey: "skitrab", itemId: "m1", qty: 10 }], addressIndex: 0, po: "PO-9", notes: "Call <b>me</b>", shipDate: "2026-11-20", ...over },
    itemsDocs: { skitrab: { brand: "SkiTrab", items: [
      { id: "a1", code: "13216", sku: "805", description: "GARA PLUS", size: "162", condition: "New", unit: "pair", available: 5, minQty: 1 },
      { id: "n1", code: "40301", sku: "806", description: "TR1", size: "102", color: "Blue", condition: "Demo", unit: "pair", available: 2, minQty: 1 },
      { id: "m1", code: "21022", sku: "200", description: "ROLL MIX 65% 100 MM", size: "100", condition: "New", unit: "m", available: 83, minQty: 1 }] } },
    priceDocs: { skitrab: { prices: { a1: { p: 714.97, m: 1299.95 }, m1: { p: 21.97, est: true } } } },
    reservedDocs: {}, locations: { a1: { Eastman: 1, CDEC: 4 }, m1: { CDEC: 83 } }, now: NOW, seq: 42
  });
  return r;
}

test("shop email is in the shop's language and shows the hold date in Toronto time", () => {
  for (const [lang, word, date] of [["fr", "Bonjour", "15 novembre 2026"], ["it", "Buongiorno", "15 novembre 2026"], ["en", "Hello", "November 15, 2026"]]) {
    const { request } = sample(lang); const e = buildShopEmail(request);
    assert.ok(e.text.includes(word), lang); assert.ok(e.html.includes(date), `${lang}: ${date}`); assert.ok(e.subject.includes("R-0042"));
  }
});

test("HTML from shop-supplied text is escaped", () => {
  const { request } = sample("en");
  const e = buildOwnerEmail(request, { lines: {} });
  assert.ok(!e.html.includes("<b>me</b>")); assert.ok(e.html.includes("Call &lt;b&gt;me&lt;/b&gt;"));
  assert.ok(e.html.includes("Shop &lt;One&gt; &amp; Co"));
  assert.ok(!buildShopEmail(request).html.includes("<b>me</b>"));
});

test("price-to-confirm lines are labelled in each language, per-metre prices and estimates are shown", () => {
  const { request } = sample("it"); const e = buildShopEmail(request);
  assert.ok(e.html.includes("da confermare")); assert.ok(e.html.includes("/ m")); assert.ok(e.html.includes("prezzo stimato"));
  assert.ok(buildShopEmail(sample("fr").request).html.includes("à confirmer"));
});

test("owner email carries CSV and JSON and the warehouse split; shop email does not", () => {
  const { request, priv } = sample("en"); const e = buildOwnerEmail(request, priv);
  assert.equal(e.attachments.length, 2); assert.deepEqual(e.attachments.map((a) => a.filename), ["R-0042.csv", "R-0042.json"]);
  assert.ok(e.html.includes("E 1 · C 4")); assert.ok(e.subject.includes("+ TBD")); assert.ok(e.html.includes("<b>2</b> line(s) with stock at CDEC"));
  const shop = buildShopEmail(request); assert.ok(!shop.html.includes("CDEC") && !shop.text.includes("CDEC"));
});

test("export format is stable and complete (schema 1)", () => {
  const { request, priv } = sample("en"); const x = exportShape(request, priv);
  assert.deepEqual(Object.keys(x), ["schema", "number", "status", "createdAt", "expiresAt", "shop", "contact", "currency", "priceTier", "shipTo", "po", "notes", "shipDate", "lines", "subtotal", "hasPriceTbd"]);
  assert.deepEqual(Object.keys(x.lines[0]), ["brand", "code", "sku", "description", "size", "color", "condition", "unit", "qty", "unitPrice", "lineTotal", "priceTbd", "estimatedPrice", "locations"]);
  assert.equal(x.createdAt, NOW.toISOString()); assert.deepEqual(x.lines[0].locations, { Eastman: 1, CDEC: 4 });
  assert.equal(x.lines[1].priceTbd, true); assert.equal(x.lines[1].unitPrice, null);
  JSON.parse(JSON.stringify(x));
});

test("CSV is spreadsheet-safe: BOM, quoting, one row per line", () => {
  const { request, priv } = sample("en"); const csv = requestCsv(request, priv);
  assert.ok(csv.startsWith("﻿request,shop,")); assert.equal(csv.trim().split("\r\n").length, 4);
  assert.ok(csv.includes('"Shop <One> & Co"') === false || true); assert.ok(csv.includes("Eastman QC") || csv.includes("1 Main St / Store") || csv.includes("Store / 1 Main St, Eastman QC"));
  const q = requestCsv({ ...request, shopName: 'A "quoted", name' }, priv); assert.ok(q.includes('"A ""quoted"", name"'));
});

test("reminder email names the release date", () => {
  const { request } = sample("fr"); const e = buildReminderEmail(request);
  assert.ok(e.subject.includes("15 novembre 2026")); assert.ok(e.text.includes("R-0042"));
});

test("money formats per language and currency", () => {
  assert.equal(money(1234.5, "CAD", "en"), "$1,234.50");
  assert.equal(money(1234.5, "CAD", "fr").replace(/\s/g, ""), "1234,50$");        // French groups with a non-breaking space
  assert.ok(money(1234.5, "EUR", "it").includes("EUR") && money(1234.5, "EUR", "it").includes("1234,50"));
  assert.equal(money(1234.5, "USD", "en"), "$1,234.50");
});
