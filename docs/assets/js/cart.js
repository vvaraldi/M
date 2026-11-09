// The shop's working request ("cart"): quantities chosen on the stock page, kept in this browser per user.
// Nothing is reserved until the request is sent; the server decides again when it is sent.
import { effective } from "./render.js";

let key = null, lines = {};            // lines: itemId -> { qty, brandKey }
const listeners = new Set();

export function initCart(email) {
  key = "cart:" + String(email || "").toLowerCase();
  try { lines = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { lines = {}; }
  notify();
}
function save() { try { localStorage.setItem(key, JSON.stringify(lines)); } catch (e) { /* private mode: the cart lasts for this page only */ } }
function notify() { listeners.forEach((fn) => fn()); }

export const onCartChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const qty = (id) => (lines[id] && lines[id].qty) || 0;
export const count = () => Object.keys(lines).length;
export const entries = () => Object.entries(lines).map(([itemId, l]) => ({ itemId, ...l }));

/** Set the quantity of an item (0 removes it). `item.brandKey` tells the server which brand it belongs to. */
export function set(item, n) {
  if (n > 0) lines[item.id] = { qty: n, brandKey: item.brandKey };
  else delete lines[item.id];
  save(); notify();
}
export function clear() { lines = {}; save(); notify(); }

/** Drop lines whose item is gone and trim quantities to what can still be requested. Returns true if anything changed. */
export function reconcile(items, reserved) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let changed = false;
  for (const [id, l] of Object.entries(lines)) {
    const it = byId.get(id), eff = it ? effective(it, reserved) : 0;
    if (eff <= 0) { delete lines[id]; changed = true; }
    else if (l.qty > eff) { l.qty = eff; changed = true; }
  }
  if (changed) { save(); notify(); }
  return changed;
}

export const cart = { qty, set };
