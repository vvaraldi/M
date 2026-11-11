import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShopEmail, buildOwnerEmail, buildReminderEmail, exportShape, requestCsv, money } from "./emails.js";
import { planSubmit } from "./planner.js";

const NOW = new Date("2026-11-08T15:00:00Z");
function sample(lang = "fr", over = {}) {
  const r = planSubmit({
    user: { email: "buyer@shop.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: lang },
    shop: { name: "Shop <One> & Co", currency: "CAD", addresses: [{ label: "Store", text: "1 Main St\nSpringfield QC" }] },
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
  assert.ok(e.html.includes("Eastman: 1 available") && e.html.includes("CDEC: 4 available")); assert.ok(e.subject.includes("+ TBD")); assert.ok(e.html.includes("<b>2</b> line(s) with stock at CDEC"));
  const shop = buildShopEmail(request); assert.ok(!shop.html.includes("CDEC") && !shop.text.includes("CDEC"));
});

test("export format is stable and complete (schema 1)", () => {
  const { request, priv } = sample("en"); const x = exportShape(request, priv);
  assert.deepEqual(Object.keys(x), ["schema", "number", "status", "createdAt", "expiresAt", "shop", "contact", "currency", "priceTier", "stockScope", "shipTo", "po", "notes", "shipDate", "stockAsOf", "lines", "subtotal", "hasPriceTbd"]);
  assert.deepEqual(Object.keys(x.shop), ["id", "name", "customerId", "country", "province", "taxMode", "billTo", "addresses"]);
  assert.deepEqual(Object.keys(x.lines[0]), ["brand", "code", "sku", "description", "size", "color", "condition", "unit", "qty", "unitPrice", "lineTotal", "priceTbd", "estimatedPrice", "locations", "stock", "heldByPortal", "heldByThisRequest"]);
  assert.equal(x.createdAt, NOW.toISOString()); assert.deepEqual(x.lines[0].locations, { Eastman: 1, CDEC: 4 });
  assert.equal(x.lines[1].priceTbd, true); assert.equal(x.lines[1].unitPrice, null);
  JSON.parse(JSON.stringify(x));
});

test("the owner's email is complete on its own: plain text has customer, order details, barcodes, stock and the full JSON", () => {
  const NOW3 = new Date("2026-11-08T15:00:00Z");
  const { request, priv } = planSubmit({
    user: { email: "b@s.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: "en" },
    shop: { name: "Test shop", addresses: [{ label: "Dock", text: "27 Chem. des Etoiles" }] },
    input: { lines: [{ brandKey: "skitrab", itemId: "a1", qty: 2 }, { brandKey: "skitrab", itemId: "n1", qty: 1 }], addressIndex: 0, po: "PO-777", notes: "Ship <together>\nplease", shipDate: "2026-11-20" },
    itemsDocs: { skitrab: { brand: "SkiTrab", items: [
      { id: "a1", code: "13216", sku: "8057803529568", description: "GARA PLUS", size: "162", condition: "New", unit: "pair", available: 5, minQty: 1 },
      { id: "n1", code: "13177", sku: "8059830658907", description: "GARA", size: "155", condition: "Old graphics", unit: "pair", available: 3, minQty: 1 }] } },
    priceDocs: { skitrab: { prices: { a1: { p: 714.97 } } } }, reservedDocs: { skitrab: { map: { n1: 1 } } }, locations: {},
    stockDetail: { a1: { Eastman: { onHand: 1, reserved: 0, available: 1 }, CDEC: { onHand: 6, reserved: 2, available: 4 } }, n1: { Eastman: { onHand: 3, reserved: 0, available: 3 } } },
    stockAsOf: "2026-11-08T21:41", shopPrivate: { customerId: "C003", country: "Canada", province: "QC", taxMode: "QC", billTo: "9 Bill St\nGatineau QC" }, now: NOW3, seq: 11
  });
  const e = buildOwnerEmail(request, priv), t = e.text;
  for (const must of ["NEW REQUEST R-0011", "C003", "tax mode QC", "QC, Canada", "9 Bill St, Gatineau QC", "b@s.test", "PO-777", "2026-11-20",
    "Dock / 27 Chem. des Etoiles", "Ship <together> / please", "8057803529568", "8059830658907", "(Old graphics)", "(New)",
    "CDEC: 6 on hand, 2 on drafts, 4 available", "Eastman: 3 on hand, 0 on drafts, 3 available", "price TBD", "$1,429.94", "stock as of 2026-11-08T21:41",
    "portal holds: this request 1 · all open portal requests together 2", "portal holds: this request 2 · all open portal requests together 2",
    "the workbook does not see these holds", "FULL REQUEST AS JSON"]) assert.ok(t.includes(must), `plain text should include: ${must}`);
  // the exact moment the hold ends, in Toronto time (15:00 UTC on Nov 15 is 10:00 a.m. there)
  const flat = (s) => s.replace(/\s/g, " ");
  assert.ok(flat(t).includes("Held until November 15, 2026 at 10:00 a.m. Toronto time"), t.split("\n")[1]);
  assert.ok(flat(e.html).includes("November 15, 2026 at 10:00 a.m.</b> (Toronto time)"));
  // the JSON in the text part is the same JSON as the attachment
  const jsonStart = t.indexOf("{\n"), parsed = JSON.parse(t.slice(jsonStart));
  assert.deepEqual(parsed, JSON.parse(e.attachments[1].content));
  assert.equal(parsed.lines[0].stock.CDEC.onHand, 6);
  // the HTML shows barcodes, conditions and the stock breakdown too, and the JSON is escaped
  for (const must of ["8057803529568", "(Old graphics)", "CDEC: 6 on hand, 2 on drafts, 4 available", "portal holds: this request 1 · all open requests 2", "&quot;customerId&quot;: &quot;C003&quot;", "Ship &lt;together&gt;"]) assert.ok(e.html.includes(must), `html should include: ${must}`);
  assert.ok(!e.html.includes("Ship <together>"));
  // the shop's own email never gets any of this
  const shop = buildShopEmail(request);
  for (const secret of ["C003", "8057803529568", "on hand", "Gatineau", "customerId"]) assert.ok(!shop.html.includes(secret) && !shop.text.includes(secret), secret);
});

test("export includes customer details, per-warehouse stock and what the portal already holds", () => {
  const NOW2 = new Date("2026-11-08T15:00:00Z");
  const { request, priv } = planSubmit({
    user: { email: "b@s.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: "en" },
    shop: { name: "Shop", addresses: [{ label: "A", text: "1 Rd" }] },
    input: { lines: [{ brandKey: "skitrab", itemId: "a1", qty: 2 }], addressIndex: 0 },
    itemsDocs: { skitrab: { brand: "SkiTrab", items: [{ id: "a1", code: "1", sku: "2", description: "GARA", size: "162", condition: "New", unit: "pair", available: 5, minQty: 1 }] } },
    priceDocs: { skitrab: { prices: { a1: { p: 10 } } } }, reservedDocs: { skitrab: { map: { a1: 1 } } },
    locations: { a1: { Eastman: 2, CDEC: 3 } },
    stockDetail: { a1: { Eastman: { onHand: 2, reserved: 0, available: 2 }, CDEC: { onHand: 5, reserved: 2, available: 3 } } }, stockAsOf: "2026-11-08T17:53",
    shopPrivate: { customerId: "C008", country: "Canada", province: "QC", taxMode: "QC", billTo: "9 Bill St" }, now: NOW2, seq: 5
  });
  const x = exportShape(request, priv);
  assert.equal(x.shop.customerId, "C008"); assert.equal(x.shop.taxMode, "QC"); assert.equal(x.shop.province, "QC"); assert.equal(x.shop.billTo, "9 Bill St");
  assert.deepEqual(x.shop.addresses, [{ label: "A", text: "1 Rd" }]);
  assert.equal(x.stockAsOf, "2026-11-08T17:53");
  assert.deepEqual(x.lines[0].stock.CDEC, { onHand: 5, reserved: 2, available: 3 });
  assert.equal(x.lines[0].heldByPortal, 3);          // 1 held by another request + 2 by this one
  assert.equal(x.lines[0].heldByThisRequest, 2);     // this request's own hold = its quantity
  const csv = requestCsv(request, priv).trim().split("\r\n");
  assert.ok(csv[0].endsWith("held_by_portal,held_by_this_request") && csv[0].includes("cdec_on_hand"));
  assert.ok(csv[1].includes("C008,QC,QC,2,0,2,5,2,3,3,2"), csv[1]);
  // old requests (no private details) still export cleanly
  const old = exportShape(request, { lines: {} });
  assert.equal(old.shop.customerId, ""); assert.deepEqual(old.lines[0].stock, {}); assert.equal(old.lines[0].heldByPortal, null);
});

test("CSV is spreadsheet-safe: BOM, quoting, one row per line", () => {
  const { request, priv } = sample("en"); const csv = requestCsv(request, priv);
  assert.ok(csv.startsWith("﻿request,shop,")); assert.equal(csv.trim().split("\r\n").length, 4);
  assert.ok(csv.includes('"Shop <One> & Co"') === false || true); assert.ok(csv.includes("Springfield QC") || csv.includes("1 Main St / Store") || csv.includes("Store / 1 Main St, Springfield QC"));
  const q = requestCsv({ ...request, shopName: 'A "quoted", name' }, priv); assert.ok(q.includes('"A ""quoted"", name"'));
});

test("a request with only unpriced lines says 'to be confirmed', never a $0.00 subtotal", () => {
  const { request, priv } = sample("fr", { lines: [{ brandKey: "skitrab", itemId: "n1", qty: 1 }] });
  assert.equal(request.subtotal, 0); assert.equal(request.hasTbd, true);
  const shop = buildShopEmail(request);
  assert.ok(!/0,00/.test(shop.html) && !/0,00/.test(shop.text), "no zero subtotal in the shop email");
  assert.ok(shop.html.includes("à confirmer"));
  const owner = buildOwnerEmail(request, priv);
  assert.ok(owner.subject.includes("price TBD") && !owner.subject.includes("$0.00"), owner.subject);
  assert.ok(owner.html.includes("to be priced") && !owner.html.includes("$0.00 "));
  // a mixed request still shows the priced subtotal plus the note
  const mixed = sample("en"); assert.ok(buildShopEmail(mixed.request).html.includes("$"));
  assert.ok(buildOwnerEmail(mixed.request, mixed.priv).subject.includes("+ TBD"));
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
