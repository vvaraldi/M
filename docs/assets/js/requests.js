// "My request" (review the cart, send it) and "History" (past requests, cancel) for shops.
import { t, money, qtyFormat, unitLabel, conditionLabel, dateLabel, countLabel } from "./i18n.js";
import { h, BADGE, effective, qtyControl } from "./render.js";
import * as cartApi from "./cart.js";

const DAY = 864e5;
const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

let toastTimer;
export function toast(msg, isError) {
  document.querySelectorAll(".toast").forEach((n) => n.remove());
  const el = h("div", { class: "toast" + (isError ? " err" : ""), role: "status", text: msg });
  document.body.append(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), isError ? 7000 : 3500);
}

/** Turn an error from a Cloud Function call into a sentence for the shop. */
function errorText(e) {
  const code = String((e && e.code) || "").replace("functions/", ""), d = (e && e.details) || {};
  if (code === "failed-precondition" && d.reason === "insufficient-stock") return t("r_err_stock", { name: d.description || "", n: d.available ?? 0 });
  if (code === "not-found") return t("r_err_gone");
  if (code === "permission-denied") return t("r_err_denied");
  if (code === "unauthenticated") return t("r_err_auth");
  console.error("Request error:", e);
  return t("r_err_generic");
}

// ====================================================================== My request (cart)
export function renderCartView(root, ctx) {
  root.replaceChildren();
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const rows = cartApi.entries().map((e) => ({ e, item: byId.get(e.itemId) })).filter((r) => r.item);
  const heading = h("h2", { class: "page-title", text: t("r_title") });

  if (!rows.length) {
    root.append(heading, h("div", { class: "empty" }, h("p", { text: t("r_empty") }),
      (() => { const b = h("button", { class: "btn btn-primary", type: "button", text: t("r_back") }); b.addEventListener("click", ctx.goStock); return b; })()));
    return;
  }

  const rerender = () => renderCartView(root, ctx);
  const total = { sub: 0, tbd: false };
  const lineEls = rows.map(({ e, item }) => {
    const price = ctx.prices[item.id], eff = effective(item, ctx.reserved);
    const lineTotal = price ? Math.round(price.p * e.qty * 100) / 100 : null;
    if (lineTotal == null) total.tbd = true; else total.sub += lineTotal;
    const per = item.unit === "m" ? " / m" : "";
    const remove = h("button", { class: "btn btn-link btn-sm", type: "button", text: t("r_remove") });
    remove.addEventListener("click", () => { cartApi.set(item, 0); rerender(); });
    return h("div", { class: "cline" },
      h("div", { class: "cinfo" },
        h("b", { text: item.description }), " ",
        h("span", { class: "badge " + (BADGE[item.condition] || "b-new"), text: conditionLabel(item.condition) }),
        h("div", { class: "sub", text: [ctx.brands.length > 1 ? item.brand : "", item.size, item.color, item.code].filter(Boolean).join(" · ") })),
      h("div", { class: "cqty" }, qtyControl(item, eff, cartApi.cart, rerender), h("span", { class: "unit", text: unitLabel(item.unit, e.qty) })),
      h("div", { class: "cprice" },
        price ? h("span", {}, money(price.p, ctx.currency) + per) : h("span", { class: "tbd", text: t("r_tbd") }),
        h("b", { text: lineTotal == null ? "–" : money(lineTotal, ctx.currency) })),
      remove);
  });
  total.sub = Math.round(total.sub * 100) / 100;

  // ---- form
  const addrs = Array.isArray(ctx.shop.addresses) ? ctx.shop.addresses : [];
  const shipSel = h("select", { id: "rq-ship" }, ...addrs.map((a, i) => h("option", { value: String(i), text: [a.label, String(a.text || "").split("\n")[0]].filter(Boolean).join(" · ") })));
  const po = h("input", { id: "rq-po", maxlength: "60", autocomplete: "off" });
  const date = h("input", { id: "rq-date", type: "date", min: todayIso() });
  const notes = h("textarea", { id: "rq-notes", rows: "3", maxlength: "1000" });
  const err = h("div", { class: "msg msg-error", role: "alert", hidden: true });
  const send = h("button", { class: "btn btn-cta", type: "submit", style: "width:100%", text: t("r_send") });
  const field = (id, label, input, hint) => h("div", { class: "field" }, h("label", { for: id, text: label }), input, hint ? h("span", { class: "hint", text: hint }) : null);
  const holdDate = dateLabel(new Date(Date.now() + 7 * DAY));

  const form = h("form", { class: "card pad summary", novalidate: true },
    addrs.length ? field("rq-ship", t("r_shipto"), shipSel) : h("div", { class: "msg msg-info", text: t("r_noaddr") }),
    field("rq-po", t("r_po"), po), field("rq-date", t("r_date"), date), field("rq-notes", t("r_notes"), notes),
    h("div", { class: "callout c-info", text: t("r_hold", { date: holdDate }) }), err, send);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    send.disabled = true; send.textContent = t("r_sending"); err.hidden = true;
    const payload = {
      lines: rows.map(({ e }) => ({ brandKey: e.brandKey, itemId: e.itemId, qty: e.qty })),
      addressIndex: addrs.length ? Number(shipSel.value) : undefined, po: po.value.trim(), notes: notes.value.trim(), shipDate: date.value || undefined
    };
    try {
      const res = await ctx.callFn("submitRequest", payload);
      cartApi.clear();
      await ctx.reloadData().catch(() => {});
      showSent(root, ctx, res);
    } catch (e) {
      err.textContent = errorText(e); err.hidden = false; err.scrollIntoView({ block: "nearest" });
      const code = String((e && e.code) || "");
      if (/failed-precondition|not-found/.test(code)) { await ctx.reloadData().catch(() => {}); }   // refresh stock, then the cart is trimmed
      send.disabled = false; send.textContent = t("r_send");
      if (/failed-precondition|not-found/.test(code)) setTimeout(() => { const m = err.textContent; rerender(); const e2 = root.querySelector(".msg-error"); if (e2) { e2.textContent = m; e2.hidden = false; } }, 0);
    }
  });

  root.append(heading, h("div", { class: "cols" },
    h("div", { class: "card pad" },
      h("div", { class: "cline chead", "aria-hidden": "true" }, h("span", { text: t("r_title") }), h("span", { text: t("qty") }), h("span", { text: t("r_total") }), h("span")),
      ...lineEls,
      h("div", { class: "total" }, h("span", { text: t("r_sub") }), h("span", { text: money(total.sub, ctx.currency) })),
      total.tbd ? h("p", { class: "hint", text: t("r_tbd_note") }) : null),
    form));
}

function showSent(root, ctx, res) {
  const date = dateLabel(res.expiresAt);
  const text = res.emailed ? t("r_ok_p", { num: res.number, date, email: ctx.profile.email }) : t("r_ok_nomail", { num: res.number, date });
  const hist = h("button", { class: "btn btn-cta", type: "button", text: t("r_ok_btn") });
  const more = h("button", { class: "btn btn-ghost", type: "button", text: t("r_ok_more") });
  hist.addEventListener("click", ctx.goHistory); more.addEventListener("click", ctx.goStock);
  root.replaceChildren(h("div", { class: "card pad sent" }, h("h2", { text: t("r_ok_h") }), h("p", { text: text }), h("div", { class: "btnrow" }, hist, more)));
}

// ====================================================================== History
const STATUS = { reserved: "s-res", expired: "s-exp", cancelled: "s-can", released: "s-rel", invoiced: "s-inv" };

export async function renderHistory(root, ctx) {
  root.replaceChildren(h("div", { class: "center-note" }, h("div", { class: "spinner", role: "status" })));
  let reqs;
  try {
    const snap = await ctx.fetchRequests();
    reqs = snap.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  } catch (e) {
    console.error(e);
    const retry = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("h_refresh") });
    retry.addEventListener("click", () => renderHistory(root, ctx));
    root.replaceChildren(h("h2", { class: "page-title", text: t("h_title") }), h("div", { class: "msg msg-error", text: t("h_err") }), retry);
    return;
  }
  const refresh = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("h_refresh") });
  refresh.addEventListener("click", () => renderHistory(root, ctx));
  root.replaceChildren(h("div", { class: "h-row" }, h("h2", { class: "page-title", text: t("h_title") }), refresh));
  if (!reqs.length) { root.append(h("div", { class: "empty", text: t("h_empty") })); return; }

  const plural = (n) => (new Intl.PluralRules(document.documentElement.lang).select(n) === "one" ? "h_lines_one" : "h_lines_other");
  for (const r of reqs) {
    const cancel = r.status === "reserved" ? h("button", { class: "btn btn-danger btn-sm", type: "button", text: t("h_cancel") }) : null;
    if (cancel) cancel.addEventListener("click", async () => {
      if (!confirm(t("h_cancel_ask", { num: r.number }))) return;
      cancel.disabled = true;
      try { await ctx.callFn("updateRequest", { id: r.id, action: "cancel" }); toast(t("h_cancelled_ok", { num: r.number })); await ctx.reloadData().catch(() => {}); renderHistory(root, ctx); }
      catch (e) { toast(errorText(e), true); cancel.disabled = false; }
    });
    root.append(h("article", { class: "card pad req" },
      h("div", { class: "req-head" },
        h("b", { class: "req-num", text: r.number }),
        h("span", { class: "status " + (STATUS[r.status] || "s-can"), text: t("st_" + r.status) }),
        h("span", { class: "hint", text: t("h_sent", { date: dateLabel(toDate(r.createdAt)) }) }),
        r.status === "reserved" ? h("span", { class: "hint", text: t("h_until", { date: dateLabel(toDate(r.expiresAt)) }) }) : null),
      h("ul", { class: "req-lines" }, ...r.lines.map((l) => h("li", {},
        h("span", { text: [l.description, l.size, l.color].filter(Boolean).join(" ") }),
        h("span", { class: "hint", text: ` × ${qtyFormat(l.qty)} ${unitLabel(l.unit, l.qty)}` }),
        h("span", { class: "right", text: l.priceTbd ? t("r_tbd") : money(l.lineTotal, r.currency) })))),
      h("div", { class: "req-foot" },
        h("span", { class: "hint", text: t(plural(r.lines.length), { n: r.lines.length }) + (r.hasTbd ? " · " + t("h_plus_tbd") : "") }),
        h("b", { text: t("r_sub") + ": " + money(r.subtotal, r.currency) }),
        cancel)));
  }
}
