// Email texts (pure functions, no sending here) + the fixed export format used for the owner's attachments.
// Shop emails are in the shop's language (en, fr, it). The owner's copy is in English.

const TZ = "America/Toronto";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOC = { en: "en-CA", fr: "fr-CA", it: "it-IT" };

export function money(v, currency, lang = "en") {
  const loc = lang === "fr" ? (currency === "EUR" ? "fr-FR" : "fr-CA") : lang === "it" ? "it-IT" : currency === "USD" ? "en-US" : currency === "EUR" ? "en-IE" : "en-CA";
  return new Intl.NumberFormat(loc, { style: "currency", currency, currencyDisplay: lang === "it" ? "code" : "symbol" }).format(v);
}
export const dateLong = (d, lang = "en") => new Intl.DateTimeFormat(LOC[lang] || "en-CA", { dateStyle: "long", timeZone: TZ }).format(d);
export const dateTime = (d, lang = "en") => new Intl.DateTimeFormat(LOC[lang] || "en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(d);

/** True when nothing in the request has a price yet: the subtotal is then "to be confirmed", not $0.00. */
const allTbd = (r) => !!r.hasTbd && !(r.subtotal > 0);
const subtotalText = (r, word, lang) => (allTbd(r) ? word : money(r.subtotal, r.currency, lang));

const T = {
  en: {
    subj: "Your request {num} is saved", hello: "Hello,",
    intro: "Thank you. We received your request {num}. The items below are held for you until {date}. M will now confirm the order and send you the invoice.",
    h_item: "Item", h_size: "Size", h_qty: "Qty", h_price: "Unit price", h_total: "Total", subtotal: "Subtotal (before tax)",
    tbd: "to be confirmed", tbd_note: "Lines marked \"to be confirmed\" will be priced by M on the invoice.", est: "estimated price",
    shipto: "Ship to", po: "Your PO number", notes: "Your notes", shipdate: "Requested ship date",
    cancel_hint: "You can cancel this request any time from the portal (History).", sig: "M",
    rsubj: "Reminder: your reservation {num} ends on {date}",
    rintro: "The items held for you in request {num} will be released on {date} unless the order is confirmed with M before then. If you still want them, please reply to this email."
  },
  fr: {
    subj: "Votre demande {num} est enregistrée", hello: "Bonjour,",
    intro: "Merci. Nous avons bien reçu votre demande {num}. Les articles ci-dessous vous sont réservés jusqu'au {date}. M confirmera maintenant la commande et vous enverra la facture.",
    h_item: "Article", h_size: "Taille", h_qty: "Qté", h_price: "Prix unitaire", h_total: "Total", subtotal: "Sous-total (avant taxes)",
    tbd: "à confirmer", tbd_note: "Les lignes « à confirmer » seront tarifées par M sur la facture.", est: "prix estimé",
    shipto: "Livrer à", po: "Votre numéro de bon de commande", notes: "Vos remarques", shipdate: "Date d'expédition souhaitée",
    cancel_hint: "Vous pouvez annuler cette demande à tout moment depuis le portail (Historique).", sig: "M",
    rsubj: "Rappel : votre réservation {num} se termine le {date}",
    rintro: "Les articles réservés dans la demande {num} seront libérés le {date} si la commande n'est pas confirmée avec M d'ici là. Si vous les voulez toujours, répondez simplement à ce courriel."
  },
  it: {
    subj: "La tua richiesta {num} è stata registrata", hello: "Buongiorno,",
    intro: "Grazie. Abbiamo ricevuto la tua richiesta {num}. Gli articoli qui sotto sono riservati per te fino al {date}. M confermerà l'ordine e ti invierà la fattura.",
    h_item: "Articolo", h_size: "Misura", h_qty: "Qtà", h_price: "Prezzo unitario", h_total: "Totale", subtotal: "Subtotale (IVA esclusa)",
    tbd: "da confermare", tbd_note: "Le righe «da confermare» saranno quotate da M in fattura.", est: "prezzo stimato",
    shipto: "Spedisci a", po: "Il tuo numero d'ordine", notes: "Le tue note", shipdate: "Data di spedizione richiesta",
    cancel_hint: "Puoi annullare questa richiesta in qualsiasi momento dal portale (Cronologia).", sig: "M",
    rsubj: "Promemoria: la tua prenotazione {num} termina il {date}",
    rintro: "Gli articoli riservati nella richiesta {num} saranno rilasciati il {date} se l'ordine non viene confermato con M entro tale data. Se li vuoi ancora, rispondi semplicemente a questa email."
  }
};
const fill = (s, p) => Object.entries(p).reduce((a, [k, v]) => a.split("{" + k + "}").join(v), s);
const unitWord = (u, n, lang) => ({ pair: { en: ["pair", "pairs"], fr: ["paire", "paires"], it: ["paio", "paia"] }, piece: { en: ["piece", "pieces"], fr: ["pièce", "pièces"], it: ["pezzo", "pezzi"] }, m: { en: ["m", "m"], fr: ["m", "m"], it: ["m", "m"] } }[u] || { en: ["", ""] })[lang][n === 1 ? 0 : 1];
const lineName = (l) => [l.description, l.color].filter(Boolean).join(" · ");

function shopTable(r, tx, lang) {
  const rows = r.lines.map((l) => `<tr>
<td style="padding:6px 8px;border-bottom:1px solid #e8ebec">${esc(lineName(l))}${l.code ? `<br><span style="color:#5a6f7a;font-size:12px">${esc(l.code)}</span>` : ""}</td>
<td style="padding:6px 8px;border-bottom:1px solid #e8ebec">${esc(l.size)}</td>
<td style="padding:6px 8px;border-bottom:1px solid #e8ebec;text-align:right">${l.qty} ${esc(unitWord(l.unit, l.qty, lang))}</td>
<td style="padding:6px 8px;border-bottom:1px solid #e8ebec;text-align:right">${l.priceTbd ? esc(tx.tbd) : esc(money(l.unitPrice, r.currency, lang)) + (l.unit === "m" ? " / m" : "") + (l.est ? ` <span style="color:#5a6f7a;font-size:11px">(${esc(tx.est)})</span>` : "")}</td>
<td style="padding:6px 8px;border-bottom:1px solid #e8ebec;text-align:right">${l.priceTbd ? "–" : esc(money(l.lineTotal, r.currency, lang))}</td></tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#004D71;color:#fff">
<th style="padding:7px 8px;text-align:left">${esc(tx.h_item)}</th><th style="padding:7px 8px;text-align:left">${esc(tx.h_size)}</th><th style="padding:7px 8px;text-align:right">${esc(tx.h_qty)}</th><th style="padding:7px 8px;text-align:right">${esc(tx.h_price)}</th><th style="padding:7px 8px;text-align:right">${esc(tx.h_total)}</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="4" style="padding:8px;text-align:right;font-weight:600">${esc(tx.subtotal)}</td><td style="padding:8px;text-align:right;font-weight:600">${esc(subtotalText(r, tx.tbd, lang))}</td></tr></tfoot></table>${r.hasTbd ? `<p style="font-size:13px;color:#5a6f7a">${esc(tx.tbd_note)}</p>` : ""}`;
}
function details(r, tx, lang, withHeader = true) {
  const b = [];
  if (r.shipTo) b.push([tx.shipto, [r.shipTo.label, r.shipTo.text].filter(Boolean).join("\n")]);
  if (r.shipDate) b.push([tx.shipdate, dateLong(new Date(r.shipDate + "T12:00:00Z"), lang)]);
  if (r.po) b.push([tx.po, r.po]);
  if (r.notes) b.push([tx.notes, r.notes]);
  return b.map(([k, v]) => `<p style="margin:4px 0;font-size:14px"><b>${esc(k)}:</b> ${esc(v).replace(/\n/g, "<br>")}</p>`).join("");
}
function shell(inner) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#12303e;max-width:680px"><div style="background:#004D71;color:#C4D600;padding:12px 16px;font-weight:700;letter-spacing:.15em">M</div><div style="padding:16px 4px">${inner}</div></div>`;
}
function plainLines(r, lang) {
  return r.lines.map((l) => `- ${l.description}${l.size ? " " + l.size : ""}${l.code ? " [" + l.code + "]" : ""}: ${l.qty} ${unitWord(l.unit, l.qty, lang)}` + (l.priceTbd ? "" : ` x ${money(l.unitPrice, r.currency, lang)} = ${money(l.lineTotal, r.currency, lang)}`)).join("\n");
}

/** Confirmation to the shop user, in the language of the request. */
export function buildShopEmail(r) {
  const lang = T[r.language] ? r.language : "en", tx = T[lang], date = dateLong(r.expiresAt, lang);
  const html = shell(`<p>${esc(tx.hello)}</p><p>${esc(fill(tx.intro, { num: r.number, date }))}</p>${shopTable(r, tx, lang)}${details(r, tx, lang)}<p style="color:#5a6f7a;font-size:13px">${esc(tx.cancel_hint)}</p><p>${esc(tx.sig)}</p>`);
  const text = `${tx.hello}\n\n${fill(tx.intro, { num: r.number, date })}\n\n${plainLines(r, lang)}\n${tx.subtotal}: ${subtotalText(r, tx.tbd, lang)}${r.hasTbd ? "\n" + tx.tbd_note : ""}\n\n${tx.cancel_hint}\n${tx.sig}`;
  return { subject: fill(tx.subj, { num: r.number }), html, text };
}

/** Reminder (day 5 of 7) to the shop user. */
export function buildReminderEmail(r) {
  const lang = T[r.language] ? r.language : "en", tx = T[lang], date = dateLong(r.expiresAt, lang);
  const html = shell(`<p>${esc(tx.hello)}</p><p>${esc(fill(tx.rintro, { num: r.number, date }))}</p>${shopTable(r, tx, lang)}<p>${esc(tx.sig)}</p>`);
  return { subject: fill(tx.rsubj, { num: r.number, date }), html, text: `${tx.hello}\n\n${fill(tx.rintro, { num: r.number, date })}\n\n${plainLines(r, lang)}\n${tx.sig}` };
}

// ---------------------------------------------------------------- owner copy + exports
const iso = (d) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

/** The fixed export format (schema 1). Other tools (shipment email, invoice drafting, ledger) rely on it. */
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

/** Copy of a new request for the owner, in English, with CSV and JSON attached. */
export function buildOwnerEmail(r, priv) {
  const x = exportShape(r, priv), cdec = x.lines.filter((l) => (l.locations.CDEC || 0) > 0).length;
  const rows = x.lines.map((l) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #e8ebec">${esc(l.brand)}</td><td style="padding:5px 8px;border-bottom:1px solid #e8ebec">${esc(l.code)}</td>
<td style="padding:5px 8px;border-bottom:1px solid #e8ebec">${esc(l.description)} ${esc(l.size)} ${l.condition !== "New" ? `<i>(${esc(l.condition)})</i>` : ""}</td>
<td style="padding:5px 8px;border-bottom:1px solid #e8ebec;text-align:right">${l.qty} ${esc(l.unit)}</td>
<td style="padding:5px 8px;border-bottom:1px solid #e8ebec;text-align:right">${l.priceTbd ? "<b>TBD</b>" : esc(money(l.lineTotal, x.currency, "en"))}</td>
<td style="padding:5px 8px;border-bottom:1px solid #e8ebec">E ${l.locations.Eastman || 0} · C ${l.locations.CDEC || 0}</td></tr>`).join("");
  const html = shell(`<h2 style="margin:0 0 8px">New request ${esc(x.number)}</h2>
<p style="margin:2px 0"><b>${esc(x.shop.name)}</b> · ${esc(x.contact.email)} · ${esc(x.currency)}</p>
<p style="margin:2px 0">Held until <b>${esc(dateLong(r.expiresAt, "en"))}</b>${cdec ? ` · <b>${cdec}</b> line(s) with stock at CDEC` : ""}</p>
${details(r, T.en, "en")}
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:10px"><thead><tr style="background:#004D71;color:#fff"><th style="padding:6px 8px;text-align:left">Brand</th><th style="padding:6px 8px;text-align:left">Code</th><th style="padding:6px 8px;text-align:left">Item</th><th style="padding:6px 8px;text-align:right">Qty</th><th style="padding:6px 8px;text-align:right">Total</th><th style="padding:6px 8px;text-align:left">Stock E=Eastman C=CDEC</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:10px"><b>Subtotal (before tax): ${esc(subtotalText(r, "to be priced", "en"))}</b>${x.hasPriceTbd && !allTbd(r) ? " <span style=\"color:#8a5a00\">+ lines to price (TBD)</span>" : ""}</p>
<p style="color:#5a6f7a;font-size:12px">CSV and JSON attached. Manage it in the portal Admin page, tab Requests.</p>`);
  const text = `New request ${x.number} from ${x.shop.name} (${x.contact.email})\nHeld until ${dateLong(r.expiresAt, "en")}\n\n` +
    x.lines.map((l) => `- [${l.brand}] ${l.code} ${l.description} ${l.size}: ${l.qty} ${l.unit}${l.priceTbd ? " (price TBD)" : " = " + money(l.lineTotal, x.currency, "en")}  [Eastman ${l.locations.Eastman || 0}, CDEC ${l.locations.CDEC || 0}]`).join("\n") +
    `\n\nSubtotal (before tax): ${subtotalText(r, "to be priced", "en")}${x.hasPriceTbd && !allTbd(r) ? " + lines to price" : ""}`;
  return {
    subject: `New request ${x.number}: ${x.shop.name} (${x.lines.length} line${x.lines.length === 1 ? "" : "s"}, ${allTbd(r) ? "price TBD" : money(x.subtotal, x.currency, "en") + (x.hasPriceTbd ? " + TBD" : "")})`,
    html, text,
    attachments: [
      { filename: `${x.number}.csv`, content: requestCsv(r, priv), contentType: "text/csv; charset=utf-8" },
      { filename: `${x.number}.json`, content: JSON.stringify(x, null, 2), contentType: "application/json" }
    ]
  };
}
