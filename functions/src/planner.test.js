import { test } from "node:test";
import assert from "node:assert/strict";
import { planSubmit, planRelease, planAction, needsReminder, effectiveAvailable, PlanError, requestNumber } from "./planner.js";

const NOW = new Date("2026-11-08T15:00:00Z");
const DAY = 86400000;
const item = (o) => ({ id: "a1", code: "13216", sku: "805", category: "Ski", description: "GARA PLUS", size: "162", condition: "New", unit: "pair", available: 3, minQty: 1, ...o });
const base = () => ({
  user: { email: "buyer@shop.test", active: true, shopId: "s1", brands: ["skitrab"], currency: "CAD", priceTier: "SHOP_CAD", language: "fr" },
  shop: { name: "Shop One", currency: "CAD", addresses: [{ label: "Store", text: "1 Main St" }, { label: "Dock", text: "2 Rear Rd" }] },
  input: { lines: [{ brandKey: "skitrab", itemId: "a1", qty: 2 }], addressIndex: 1, po: "PO-1", notes: "hello", shipDate: "2026-11-20" },
  itemsDocs: { skitrab: { brand: "SkiTrab", items: [item(), item({ id: "m1", description: "ROLL MIX", size: "100", unit: "m", available: 83, minQty: 1 }), item({ id: "n1", description: "TR1", available: 2 })] } },
  priceDocs: { skitrab: { prices: { a1: { p: 714.97, m: 1299.95 }, m1: { p: 21.97, est: true } } } },
  reservedDocs: { skitrab: { map: {} } },
  locations: { a1: { Eastman: 1, CDEC: 2 } },
  now: NOW, seq: 7
});

test("a valid request reserves stock, prices lines and sets a 7-day hold", () => {
  const r = planSubmit(base());
  assert.equal(r.request.number, "R-0007");
  assert.equal(r.request.status, "reserved");
  assert.equal(r.request.expiresAt.getTime(), NOW.getTime() + 7 * DAY);
  assert.deepEqual(r.reserved.skitrab, { a1: 2 });
  assert.equal(r.request.lines[0].lineTotal, 1429.94);
  assert.equal(r.request.subtotal, 1429.94);
  assert.equal(r.request.hasTbd, false);
  assert.deepEqual(r.request.shipTo, { label: "Dock", text: "2 Rear Rd" });
  assert.equal(r.request.language, "fr");
});

test("locations stay out of the request the shop can read", () => {
  const r = planSubmit(base());
  assert.equal(JSON.stringify(r.request).includes("CDEC"), false);
  assert.deepEqual(r.priv.lines.a1, { Eastman: 1, CDEC: 2 });
});

test("the private record carries stock detail, held quantities and the shop's customer details", () => {
  const c = base();
  c.stockDetail = { a1: { Eastman: { onHand: 1, reserved: 0, available: 1 }, CDEC: { onHand: 4, reserved: 2, available: 2 } } };
  c.stockAsOf = "2026-11-08T17:53";
  c.shopPrivate = { customerId: "C008", country: "Canada", province: "QC", taxMode: "QC", billTo: "1 Billing Rd\nGatineau QC", ignored: "x" };
  c.reservedDocs.skitrab.map = { a1: 1 };            // another request already holds 1 pair
  const { request, priv } = planSubmit(c);
  assert.deepEqual(priv.stock.a1.CDEC, { onHand: 4, reserved: 2, available: 2 });
  assert.equal(priv.stockAsOf, "2026-11-08T17:53");
  assert.equal(priv.held.a1, 3);                     // 1 held before + 2 in this request
  assert.deepEqual(priv.shop, { customerId: "C008", country: "Canada", province: "QC", taxMode: "QC", billTo: "1 Billing Rd\nGatineau QC",
    addresses: [{ label: "Store", text: "1 Main St" }, { label: "Dock", text: "2 Rear Rd" }] });
  // none of it reaches the request document the shop can read
  const shopSide = JSON.stringify(request);
  for (const secret of ["C008", "Gatineau", "onHand", "taxMode", "CDEC"]) assert.equal(shopSide.includes(secret), false, secret);
});

test("missing private details are empty, not an error", () => {
  const { priv } = planSubmit(base());
  assert.deepEqual(priv.stock.a1, {}); assert.equal(priv.stockAsOf, null); assert.equal(priv.shop.customerId, ""); assert.equal(priv.held.a1, 2);
});

test("an item without a price becomes a 'price to be confirmed' line and is flagged", () => {
  const c = base(); c.input.lines.push({ brandKey: "skitrab", itemId: "n1", qty: 1 });
  const r = planSubmit(c);
  const tbd = r.request.lines.find((l) => l.itemId === "n1");
  assert.equal(tbd.priceTbd, true); assert.equal(tbd.unitPrice, null); assert.equal(tbd.lineTotal, null);
  assert.equal(r.request.hasTbd, true);
  assert.equal(r.request.subtotal, 1429.94);
});

test("price per metre is multiplied by the metres and keeps the estimate flag", () => {
  const c = base(); c.input.lines = [{ brandKey: "skitrab", itemId: "m1", qty: 10 }];
  const l = planSubmit(c).request.lines[0];
  assert.equal(l.lineTotal, 219.7); assert.equal(l.est, true); assert.equal(l.unit, "m");
});

test("ordering more than what is available (minus reservations) is refused", () => {
  const c = base(); c.input.lines[0].qty = 3; c.reservedDocs.skitrab.map = { a1: 2 };   // 3 in stock, 2 already reserved by someone else
  assert.throws(() => planSubmit(c), (e) => e instanceof PlanError && e.code === "insufficient-stock" && e.details.available === 1);
});

test("two shops competing for the last pair: the second request is refused", () => {
  const c1 = base(); c1.itemsDocs.skitrab.items[0].available = 1; c1.input.lines[0].qty = 1;
  const first = planSubmit(c1);
  const c2 = base(); c2.itemsDocs.skitrab.items[0].available = 1; c2.input.lines[0].qty = 1; c2.seq = 8;
  c2.reservedDocs.skitrab.map = first.reserved.skitrab;   // what the transaction would read after the first commit
  assert.throws(() => planSubmit(c2), (e) => e.code === "insufficient-stock" && e.details.available === 0);
});

test("a brand the user may not see is refused", () => {
  const c = base(); c.user.brands = ["villacampa"];
  assert.throws(() => planSubmit(c), (e) => e.code === "permission-denied");
});

test("inactive users, empty, duplicate and malformed lines are refused", () => {
  let c = base(); c.user.active = false; assert.throws(() => planSubmit(c), (e) => e.code === "permission-denied");
  c = base(); c.input.lines = []; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.lines.push({ brandKey: "skitrab", itemId: "a1", qty: 1 }); assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  for (const qty of [0, -1, 1.5, "2", null, 1e9]) { c = base(); c.input.lines[0].qty = qty; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument", `qty ${qty}`); }
  c = base(); c.input.lines[0].brandKey = "SkiTrab!"; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.lines[0].itemId = "ghost"; assert.throws(() => planSubmit(c), (e) => e.code === "not-found");
});

test("address, date and text fields are validated", () => {
  let c = base(); c.input.addressIndex = 5; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.addressIndex = undefined; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.shop.addresses = []; c.input.addressIndex = undefined; assert.equal(planSubmit(c).request.shipTo, null);
  c = base(); c.input.shipDate = "2020-01-01"; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.shipDate = "tomorrow"; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.shipDate = undefined; assert.equal(planSubmit(c).request.shipDate, null);
  c = base(); c.input.notes = "x".repeat(1001); assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
  c = base(); c.input.po = 12; assert.throws(() => planSubmit(c), (e) => e.code === "invalid-argument");
});

test("cancelling releases exactly what the request held", () => {
  const sub = planSubmit(base());
  const req = sub.request;
  const reserved = { skitrab: { map: { a1: 2 + 1, other: 4 } } };   // 1 more pair reserved by another request
  const r = planAction({ action: "cancel", request: req, actor: { isAdmin: false, email: "buyer@shop.test", shopId: "s1" }, now: NOW, reservedDocs: reserved });
  assert.equal(r.patch.status, "cancelled");
  assert.deepEqual(r.reserved.skitrab, { a1: 1, other: 4 });
});

test("a shop cannot cancel another shop's request or an already closed one", () => {
  const req = planSubmit(base()).request;
  assert.throws(() => planAction({ action: "cancel", request: req, actor: { email: "x@y", shopId: "s2" }, now: NOW }), (e) => e.code === "permission-denied");
  assert.throws(() => planAction({ action: "cancel", request: { ...req, status: "invoiced" }, actor: { isAdmin: true, email: "o" }, now: NOW }), (e) => e.code === "failed-precondition");
  assert.throws(() => planAction({ action: "release", request: req, actor: { email: "buyer@shop.test", shopId: "s1" }, now: NOW }), (e) => e.code === "permission-denied");
});

test("release, extend and invoice follow the allowed transitions", () => {
  const req = planSubmit(base()).request, admin = { isAdmin: true, email: "owner@x" };
  const reserved = { skitrab: { map: { a1: 2 } } };
  const rel = planAction({ action: "release", request: req, actor: admin, now: NOW, reservedDocs: reserved });
  assert.equal(rel.patch.status, "released"); assert.deepEqual(rel.reserved.skitrab, {});
  const later = new Date(NOW.getTime() + 3 * DAY);
  const ext = planAction({ action: "extend", request: req, actor: admin, now: later, reservedDocs: reserved });
  assert.equal(ext.patch.expiresAt.getTime(), req.expiresAt.getTime() + 7 * DAY);   // 7 days after the old end, not after today
  assert.equal(ext.patch.reminderSent, false); assert.equal(ext.patch.extendedCount, 1); assert.equal(ext.reserved, null);
  const inv = planAction({ action: "invoice", request: req, actor: admin, now: NOW, reservedDocs: reserved });
  assert.equal(inv.patch.status, "invoiced"); assert.deepEqual(inv.reserved.skitrab, {});
  const invExpired = planAction({ action: "invoice", request: { ...req, status: "expired" }, actor: admin, now: NOW, reservedDocs: reserved });
  assert.equal(invExpired.reserved, null);   // nothing held any more, nothing to release twice
  assert.throws(() => planAction({ action: "invoice", request: { ...req, status: "cancelled" }, actor: admin, now: NOW }), (e) => e.code === "failed-precondition");
});

test("extending after the hold has already ended counts from today", () => {
  const req = planSubmit(base()).request;
  const way = new Date(NOW.getTime() + 20 * DAY);
  const ext = planAction({ action: "extend", request: req, actor: { isAdmin: true, email: "o" }, now: way });
  assert.equal(ext.patch.expiresAt.getTime(), way.getTime() + 7 * DAY);
});

test("expiry only fires after the end of the hold and only for the system", () => {
  const req = planSubmit(base()).request;
  assert.throws(() => planAction({ action: "expire", request: req, actor: { isSystem: true }, now: NOW }), (e) => e.code === "failed-precondition");
  assert.throws(() => planAction({ action: "expire", request: req, actor: { isAdmin: true, email: "o" }, now: new Date(NOW.getTime() + 8 * DAY) }), (e) => e.code === "permission-denied");
  const r = planAction({ action: "expire", request: req, actor: { isSystem: true }, now: new Date(NOW.getTime() + 7 * DAY + 1), reservedDocs: { skitrab: { map: { a1: 2 } } } });
  assert.equal(r.patch.status, "expired"); assert.equal(r.patch.statusChangedBy, "system"); assert.deepEqual(r.reserved.skitrab, {});
});

test("reminders go out once, in the last two days only", () => {
  const req = planSubmit(base()).request;
  assert.equal(needsReminder(req, NOW), false);
  assert.equal(needsReminder(req, new Date(NOW.getTime() + 5 * DAY + 1000)), true);
  assert.equal(needsReminder({ ...req, reminderSent: true }, new Date(NOW.getTime() + 6 * DAY)), false);
  assert.equal(needsReminder(req, new Date(NOW.getTime() + 8 * DAY)), false);
  assert.equal(needsReminder({ ...req, status: "cancelled" }, new Date(NOW.getTime() + 6 * DAY)), false);
});

test("helpers", () => {
  assert.equal(requestNumber(142), "R-0142");
  assert.equal(effectiveAvailable({ id: "x", available: 5 }, { x: 7 }), 0);
  assert.equal(effectiveAvailable({ id: "x", available: 5 }, undefined), 5);
  assert.deepEqual(planRelease({ lines: [{ brandKey: "b", itemId: "x", qty: 9 }] }, { b: { map: { x: 3 } } }), { b: {} });
});

// ---- stock scope: a shop may be limited to Eastman or CDEC stock
const detail = { a1: { Eastman: { available: 1 }, CDEC: { available: 2 } } };   // a1: 3 in total, 1 at Eastman, 2 at CDEC
const scoped = (scope, qty) => { const c = base(); c.user.stockScope = scope; c.stockDetail = detail; c.input.lines[0].qty = qty; return c; };

test("an Eastman-only shop can only take what Eastman holds, a CDEC-only shop what CDEC holds", () => {
  assert.throws(() => planSubmit(scoped("w1", 2)), (e) => e.code === "insufficient-stock" && e.details.available === 1);
  assert.throws(() => planSubmit(scoped("w2", 3)), (e) => e.code === "insufficient-stock" && e.details.available === 2);
  const r = planSubmit(scoped("w2", 2));
  assert.equal(r.request.stockScope, "w2");
  assert.deepEqual(r.byScope.skitrab.w2, { a1: 2 }); assert.deepEqual(r.byScope.skitrab.all, {});
  assert.deepEqual(r.reserved.skitrab, { a1: 2 });            // the total map still counts everything
  assert.equal(planSubmit(scoped("all", 3)).request.stockScope, "all");
});

test("a held quantity limits the other scopes only as much as it must", () => {
  const first = planSubmit(scoped("w2", 2));                 // CDEC's two pairs are now held
  const c = scoped("all", 2); c.reservedDocs = { skitrab: { map: first.reserved.skitrab, byScope: first.byScope.skitrab } };
  assert.throws(() => planSubmit(c), (e) => e.details.available === 1);   // only Eastman's pair is left for an all-warehouses shop
  const e = scoped("w1", 1); e.reservedDocs = c.reservedDocs;
  assert.equal(planSubmit(e).request.lines[0].qty, 1);          // the Eastman-only shop is not affected by CDEC's hold
});

test("a shop with no warehouse detail for an item gets nothing in a restricted scope, but a normal shop is unaffected", () => {
  const c = base(); c.user.stockScope = "w1";
  assert.throws(() => planSubmit(c), (e) => e.code === "insufficient-stock" && e.details.available === 0);
  assert.equal(planSubmit(base()).request.stockScope, "all");
});

test("releasing a restricted request frees its own scope, and old requests count as 'all'", () => {
  const sub = planSubmit(scoped("w2", 2));
  const reservedDocs = { skitrab: { map: sub.reserved.skitrab, byScope: sub.byScope.skitrab } };
  const r = planAction({ action: "cancel", request: sub.request, actor: { isAdmin: true, email: "o" }, now: NOW, reservedDocs });
  assert.deepEqual(r.reserved.skitrab, {}); assert.deepEqual(r.byScope.skitrab, { all: {}, w1: {}, w2: {} });
  // a request and reservation document from before scopes existed
  const old = planSubmit(base()).request; delete old.stockScope;
  const legacy = planAction({ action: "cancel", request: old, actor: { isAdmin: true, email: "o" }, now: NOW, reservedDocs: { skitrab: { map: { a1: 2 } } } });
  assert.deepEqual(legacy.reserved.skitrab, {}); assert.deepEqual(legacy.byScope.skitrab.all, {});
});

// ---- previous-season rebate: the net price is the unit price, the rebate rides on the line
test("a rebated item is priced at its net price and the line carries the list price and the rebate", () => {
  const c = base(); c.priceDocs.skitrab.prices.a1 = { p: 412.34, b: 634.38, pct: 35, m: 659.94, mb: 1099.9 };
  const l = planSubmit(c).request.lines[0];
  assert.equal(l.unitPrice, 412.34); assert.equal(l.lineTotal, 824.68); assert.equal(l.priceTbd, false);
  assert.equal(l.listPrice, 634.38); assert.equal(l.rebatePct, 35); assert.equal(l.rebateReason, "Previous season");
  const plain = planSubmit(base()).request.lines[0];
  assert.equal(plain.listPrice, null); assert.equal(plain.rebatePct, null); assert.equal(plain.rebateReason, "");
});
