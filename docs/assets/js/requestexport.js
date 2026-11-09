// The fixed export format of a request (schema 1), for download from the Admin page.
// It is a deliberate copy of exportShape()/requestCsv() in functions/src/emails.js (the email attachments);
// functions/src/exportparity.test.js fails if the two ever differ.
const iso = (d) => {
  const x = d && d.toDate ? d.toDate() : d;
  return x instanceof Date ? x.toISOString() : x == null ? null : String(x);
};

export function exportShape(r, priv) {
  const loc = (priv && priv.lines) || {};
  return {
    schema: 1, number: r.number, status: r.status, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt),
    shop: { id: r.shopId, name: r.shopName }, contact: { email: r.userEmail, language: r.language },
    currency: r.currency, priceTier: r.priceTier, shipTo: r.shipTo || null, po: r.po || "", notes: r.notes || "", shipDate: r.shipDate || null,
    lines: r.lines.map((l) => ({
      brand: l.brand, code: l.code, sku: l.sku, description: l.description, size: l.size, color: l.color, condition: l.condition, unit: l.unit,
      qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, priceTbd: !!l.priceTbd, estimatedPrice: !!l.est,
      locations: loc[l.itemId] || {}
    })),
    subtotal: r.subtotal, hasPriceTbd: !!r.hasTbd
  };
}

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function requestCsv(r, priv) {
  const x = exportShape(r, priv);
  const head = ["request", "shop", "contact", "currency", "po", "ship_to", "brand", "code", "barcode", "description", "size", "color", "condition", "qty", "unit", "unit_price", "line_total", "price_tbd", "eastman", "cdec"];
  const shipTo = x.shipTo ? [x.shipTo.label, x.shipTo.text].filter(Boolean).join(" / ").replace(/\n/g, ", ") : "";
  const rows = x.lines.map((l) => [x.number, x.shop.name, x.contact.email, x.currency, x.po, shipTo, l.brand, l.code, l.sku, l.description, l.size, l.color, l.condition, l.qty, l.unit,
    l.unitPrice, l.lineTotal, l.priceTbd ? "yes" : "", l.locations.Eastman || 0, l.locations.CDEC || 0]);
  return "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
