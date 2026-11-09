// The browser download (docs/assets/js/requestexport.js) and the email attachments (emails.js) must stay identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportShape as emailShape, requestCsv as emailCsv } from "./emails.js";
import { exportShape as webShape, requestCsv as webCsv } from "../../docs/assets/js/requestexport.js";
import { planSubmit } from "./planner.js";

test("web export equals email export, including Firestore-style timestamps", () => {
  const NOW = new Date("2026-11-08T15:00:00Z");
  const { request, priv } = planSubmit({
    user: { email: "b@s.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: "en" },
    shop: { name: 'Shop "Q", Inc', addresses: [{ label: "A", text: "1 Rd\nTown" }] },
    input: { lines: [{ brandKey: "skitrab", itemId: "a1", qty: 2 }, { brandKey: "skitrab", itemId: "n1", qty: 1 }], addressIndex: 0, po: "P", notes: "n;1", shipDate: "2026-11-20" },
    itemsDocs: { skitrab: { brand: "SkiTrab", items: [
      { id: "a1", code: "1", sku: "2", description: "GARA", size: "162", condition: "New", unit: "pair", available: 5, minQty: 1 },
      { id: "n1", code: "3", sku: "4", description: "TR1", size: "1", condition: "Demo", unit: "pair", available: 2, minQty: 1 }] } },
    priceDocs: { skitrab: { prices: { a1: { p: 10.5, est: true } } } }, reservedDocs: {}, locations: { a1: { CDEC: 2 } }, now: NOW, seq: 3,
    stockDetail: { a1: { CDEC: { onHand: 3, reserved: 1, available: 2 } } }, stockAsOf: "2026-11-08T17:53",
    shopPrivate: { customerId: "C008", country: "Canada", province: "QC", taxMode: "QC", billTo: "9 Bill St\nGatineau" }
  });
  const asFirestore = { ...request, createdAt: { toDate: () => request.createdAt }, expiresAt: { toDate: () => request.expiresAt } };
  assert.deepEqual(webShape(asFirestore, priv), emailShape(request, priv));
  assert.equal(webCsv(asFirestore, priv), emailCsv(request, priv));
});
