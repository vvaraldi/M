// "Documents" page for shops: catalogs (with a cover image, title and season) and price lists,
// limited to the shop's own brands and region. The security rules enforce the same limit on the server.
import { t } from "./i18n.js";
import { h } from "./render.js";
import { manifestsFor, humanSize, regionFromCurrency } from "./library.js";

/**
 * ctx = { db, doc, getDoc, callFn, profile, brands:[{key,name}] }
 * brands = the brands this user may see (names come from the stock; a brand with no stock falls back to its key).
 */
export async function renderLibrary(root, ctx) {
  root.replaceChildren(h("h2", { class: "page-title", text: t("d_title") }), h("div", { class: "center-note" }, h("div", { class: "spinner", role: "status" })));
  const region = ctx.profile.region || regionFromCurrency(ctx.profile.currency);
  const keys = (Array.isArray(ctx.profile.brands) ? ctx.profile.brands : []);
  const nameOf = (k) => (ctx.brands.find((b) => b.key === k) || { name: k }).name;
  let items = [];
  try {
    const ids = manifestsFor(keys, region);
    const snaps = await Promise.all(ids.map((id) => ctx.getDoc(ctx.doc(ctx.db, "library", id))));
    snaps.forEach((s, n) => { if (s.exists()) for (const it of s.data().items || []) items.push({ ...it, brandKey: keys.filter((k) => ids[n] === `${k}__${region}`)[0], }); });
  } catch (e) {
    console.error("Library error:", e);
    root.replaceChildren(h("h2", { class: "page-title", text: t("d_title") }), h("div", { class: "msg msg-error", text: t("d_err") }));
    return;
  }
  items = items.filter((i) => i.brandKey).map((i) => ({ ...i, brand: nameOf(i.brandKey) }));
  root.replaceChildren(h("h2", { class: "page-title", text: t("d_title") }));
  if (!items.length) { root.append(h("div", { class: "empty", text: t("d_empty") })); return; }

  const multi = keys.length > 1;
  const section = (kind, titleKey, openKey) => {
    const list = items.filter((i) => i.kind === kind);
    if (!list.length) return null;
    return h("section", { class: "doc-section" }, h("h3", { class: "doc-h", text: t(titleKey) }),
      h("div", { class: "doc-grid" }, list.map((i) => docCard(i, multi, t(openKey), ctx))));
  };
  root.append(...[section("catalog", "d_catalogs", "d_open"), section("pricelist", "d_pricelists", "d_download")].filter(Boolean));
}

const TYPES = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", pdf: "application/pdf" };

/** Save a file received from the getDocument function ({ name, contentType, base64 }) through the browser's normal download. */
export function saveReceivedFile(res) {
  const bin = atob(res.base64), bytes = new Uint8Array(bin.length);
  for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
  const ext = String(res.name).split(".").pop().toLowerCase();
  const a = h("a", { href: URL.createObjectURL(new Blob([bytes], { type: res.contentType || TYPES[ext] || "application/octet-stream" })), download: res.name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function privateButton(i, label, ctx) {
  const b = h("button", { class: "btn btn-primary btn-sm", type: "button", text: label });
  const note = h("div", { class: "doc-err", role: "alert", hidden: true });
  b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = t("d_preparing"); note.hidden = true;
    try { saveReceivedFile(await ctx.callFn("getDocument", { id: i.id })); }
    catch (e) { console.error("Download failed:", e); note.textContent = t("d_dl_err"); note.hidden = false; }
    finally { b.disabled = false; b.textContent = label; }
  });
  const wrap = h("div", {}, b, note);
  return wrap;
}

function docCard(i, showBrand, openLabel, ctx) {
  const cover = h("div", { class: "doc-cover" + (i.hasCover ? "" : " none") },
    i.hasCover ? null : h("span", { class: "doc-ico " + i.format, text: i.format === "file" ? "FILE" : i.format.toUpperCase() }));
  if (i.hasCover) {   // the cover image is a small separate document, loaded when the card appears
    ctx.getDoc(ctx.doc(ctx.db, "libraryCovers", `${i.brandKey}__${i.id}`)).then((s) => {
      if (s.exists() && /^data:image\/(jpeg|png|webp);base64,/.test(s.data().dataUrl || "")) cover.replaceChildren(h("img", { src: s.data().dataUrl, alt: "", loading: "lazy" }));
      else cover.classList.add("none");
    }).catch(() => cover.classList.add("none"));
  }
  // a catalog is opened through its link; a private document (price list) has none: the portal fetches it for this user
  const open = i.private ? privateButton(i, openLabel, ctx) : h("a", { class: "btn btn-primary btn-sm", href: i.url, target: "_blank", rel: "noopener noreferrer", text: openLabel });
  const meta = [showBrand ? i.brand : "", i.season ? t("d_season", { season: i.season }) : "", [i.format === "file" ? "" : i.format.toUpperCase(), humanSize(i.size)].filter(Boolean).join(" · ")].filter(Boolean);
  return h("article", { class: "doc-card" }, cover,
    h("div", { class: "doc-body" }, h("h4", { class: "doc-title", text: i.title }), h("div", { class: "doc-meta", text: meta.join(" · ") }), open));
}
