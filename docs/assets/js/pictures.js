// Product pictures. Pure helpers (sizes, packing into documents, package check, write plan) and the small Firestore readers.
//
// Storage model (all gated by brand in firestore.rules, written by the owner only, like the catalog covers):
//   pictures/<brand>               manifest   { chunks: n, codes: [part numbers], updatedAt }
//   pictureThumbs/<brand>__<k>     thumbnails { map: { <part number>: <base64 JPEG> } }  (k = 1..n, each document below ~450 KB)
//   pictureLarge/<brand>__<code>   one picture { data: <base64 JPEG> }                    (read only when a shop opens the picture)
// A picture belongs to a PART NUMBER (the item "code"): every size of a model shares it.

export const THUMB_FIT = [320, 240];
export const LARGE_FIT = [900, 900];
export const CHUNK_CHARS = 450000;        // base64 characters per thumbnail document (Firestore limit: 1 MiB)
export const MAX_THUMB_CHARS = 80000;     // one thumbnail
export const MAX_LARGE_CHARS = 700000;    // one large picture
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const codeOk = (c) => typeof c === "string" && /^[A-Za-z0-9]{2,30}$/.test(c);
export const brandOk = (k) => typeof k === "string" && /^[a-z0-9]{1,30}$/.test(k);
export const dataUrl = (b64) => "data:image/jpeg;base64," + b64;
export const thumbDocId = (brandKey, k) => `${brandKey}__${k}`;
export const largeDocId = (brandKey, code) => `${brandKey}__${code}`;

/** Size that fits inside `fit` keeping the proportions; never enlarged unless `enlarge`. */
export function fitSize(w, h, fit, enlarge = false) {
  let s = Math.min(fit[0] / w, fit[1] / h);
  if (!enlarge) s = Math.min(s, 1);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** Split { code: base64 } into documents of at most `max` characters (codes sorted, so the result is stable). */
export function packThumbs(map, max = CHUNK_CHARS) {
  const chunks = [];
  let cur = {}, size = 0;
  for (const code of Object.keys(map).sort()) {
    const len = map[code].length + code.length + 8;
    if (size && size + len > max) { chunks.push(cur); cur = {}; size = 0; }
    cur[code] = map[code]; size += len;
  }
  if (Object.keys(cur).length) chunks.push(cur);
  return chunks;
}

/**
 * Check a pictures package (tools/output/pictures/pictures.json made by tools/extract_pictures.py):
 *   { schema: 1, brands: { <brandKey>: { <code>: { t: <base64 thumb>, l: <base64 large> } } } }
 * Returns { <brandKey>: { <code>: { t, l } } } or throws an Error with a clear message.
 */
export function validatePackage(pkg) {
  if (!pkg || pkg.schema !== 1 || !pkg.brands || typeof pkg.brands !== "object")
    throw new Error("This does not look like a pictures.json produced by tools/extract_pictures.py (schema 1).");
  const out = {};
  for (const [bk, codes] of Object.entries(pkg.brands)) {
    if (!brandOk(bk)) throw new Error(`Brand key "${bk}" is not valid (lower case letters and digits only).`);
    out[bk] = {};
    for (const [code, p] of Object.entries(codes || {})) {
      if (!codeOk(code)) throw new Error(`Part number "${code}" is not valid (letters and digits only, 2 to 30).`);
      if (!p || typeof p.t !== "string" || typeof p.l !== "string" || !B64.test(p.t) || !B64.test(p.l)) throw new Error(`Picture ${code}: thumbnail or large picture missing or not valid.`);
      if (p.t.length > MAX_THUMB_CHARS) throw new Error(`Picture ${code}: the thumbnail is too large (${Math.round(p.t.length / 1000)} KB).`);
      if (p.l.length > MAX_LARGE_CHARS) throw new Error(`Picture ${code}: the large picture is too large (${Math.round(p.l.length / 1000)} KB).`);
      out[bk][code] = { t: p.t, l: p.l };
    }
  }
  return out;
}

/**
 * The writes that bring one brand to a new state.
 *   thumbs      full new { code: base64 thumb }
 *   largeSets   { code: base64 large } for pictures added or replaced
 *   oldManifest the manifest now stored (or null)
 * Large documents of codes that are in the old manifest but not in `thumbs` are deleted, and so are surplus thumbnail documents.
 * Returns { sets: [{ col, id, data }], deletes: [{ col, id }] }.
 */
export function planBrand(brandKey, thumbs, largeSets, oldManifest) {
  const chunks = packThumbs(thumbs);
  const sets = [], deletes = [];
  chunks.forEach((map, i) => sets.push({ col: "pictureThumbs", id: thumbDocId(brandKey, i + 1), data: { map } }));
  const codes = Object.keys(thumbs).sort();
  if (codes.length) sets.push({ col: "pictures", id: brandKey, data: { chunks: chunks.length, codes } });
  else deletes.push({ col: "pictures", id: brandKey });
  for (const [code, l] of Object.entries(largeSets || {})) sets.push({ col: "pictureLarge", id: largeDocId(brandKey, code), data: { data: l } });
  const oldChunks = oldManifest && Number.isInteger(oldManifest.chunks) ? oldManifest.chunks : 0;
  for (let k = chunks.length + 1; k <= oldChunks; k++) deletes.push({ col: "pictureThumbs", id: thumbDocId(brandKey, k) });
  for (const code of (oldManifest && oldManifest.codes) || []) if (!(code in thumbs)) deletes.push({ col: "pictureLarge", id: largeDocId(brandKey, code) });
  return { sets, deletes };
}

/**
 * Group writes into batches that stay small (Firestore accepts about 10 MiB per commit): at most `maxOps` operations and
 * about `maxBytes` of data per batch. The order is kept, so the manifest (last in the plan) is committed after the pictures it lists.
 */
export function batchOps(ops, maxBytes = 2000000, maxOps = 100) {
  const batches = [];
  let cur = [], size = 0;
  for (const op of ops) {
    const bytes = op.data ? JSON.stringify(op.data).length : 50;
    if (cur.length && (cur.length >= maxOps || size + bytes > maxBytes)) { batches.push(cur); cur = []; size = 0; }
    cur.push(op); size += bytes;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** A plan as an ordered list of operations: pictures first, then thumbnail documents and the manifest, then the deletions. */
export function planOps(plan) {
  const rank = (s) => (s.col === "pictureLarge" ? 0 : s.col === "pictureThumbs" ? 1 : 2);
  return [...plan.sets.map((s) => ({ ...s, op: "set" })).sort((a, b) => rank(a) - rank(b)), ...plan.deletes.map((d) => ({ ...d, op: "delete" }))];
}

// ---------------------------------------------------------------- Firestore readers (ctx = { db, doc, getDoc })
/** Thumbnails for the given brand keys: { byCode: { code: dataUrl }, brandOf: { code: brandKey } }. Never throws: no pictures is fine. */
export async function loadThumbs(ctx, brandKeys) {
  const byCode = {}, brandOf = {};
  await Promise.all(brandKeys.map(async (bk) => {
    try {
      const m = await ctx.getDoc(ctx.doc(ctx.db, "pictures", bk));
      if (!m.exists()) return;
      const n = Number(m.data().chunks) || 0;
      const snaps = await Promise.all(Array.from({ length: n }, (_, i) => ctx.getDoc(ctx.doc(ctx.db, "pictureThumbs", thumbDocId(bk, i + 1)))));
      for (const s of snaps) if (s.exists()) for (const [code, b64] of Object.entries(s.data().map || {})) { byCode[code] = dataUrl(b64); brandOf[code] = bk; }
    } catch (e) { console.warn("Pictures not loaded for", bk, e && (e.code || e.message)); }
  }));
  return { byCode, brandOf };
}

/** The large picture of one part number as a data URL, or null. */
export async function loadLarge(ctx, brandKey, code) {
  try {
    const s = await ctx.getDoc(ctx.doc(ctx.db, "pictureLarge", largeDocId(brandKey, code)));
    return s.exists() && s.data().data ? dataUrl(s.data().data) : null;
  } catch (e) { return null; }
}
