// Documents library (catalogs and price lists): who sees what.
//
// The owner uploads files in Admin -> Documents and says, for each file, which BRAND it belongs to and which REGIONS
// (Canada, USA, other countries) may see it. From those records this module builds one small "manifest" per
// brand + region (library/<brand>__<region>). A shop reads only the manifests of ITS brands and ITS region, and the
// security rules enforce exactly that, so a Canadian shop never learns about a USA-only price list.
// Pure functions only (no Firebase), so they are unit-tested and shared by the admin page and the shop page.

export const REGIONS = [
  { key: "canada", label: "Canada" },
  { key: "usa", label: "USA" },
  { key: "other", label: "Other countries" }
];
export const KINDS = [
  { key: "catalog", label: "Catalog" },
  { key: "pricelist", label: "Price list" }
];
const REGION_KEYS = REGIONS.map((r) => r.key), KIND_KEYS = KINDS.map((k) => k.key);

/** Region used for documents when the owner has not chosen one: from the shop's currency. */
export const regionFromCurrency = (currency) => (currency === "CAD" ? "canada" : currency === "USD" ? "usa" : "other");
export const regionLabel = (key) => (REGIONS.find((r) => r.key === key) || { label: key }).label;
export const manifestId = (brandKey, region) => `${brandKey}__${region}`;
export const brandKeyOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A file name that is safe in a storage path. */
export function safeFileName(name) {
  const m = String(name).match(/\.([A-Za-z0-9]{1,5})$/), ext = m ? m[1].toLowerCase() : "", base = m ? String(name).slice(0, -m[0].length) : String(name);
  const clean = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return (clean(base) || "file") + (ext ? "." + ext : "");
}
export function fileFormat(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return ["pdf", "xlsx", "xls", "xlsm", "csv", "docx", "pptx", "zip"].includes(ext) ? ext : "file";
}

/** Check one record from the admin form. Returns an error text or "". */
export function validateRecord(r) {
  if (!r || !r.title || !String(r.title).trim()) return "Please enter a title.";
  if (String(r.title).length > 120) return "The title is too long (120 characters at most).";
  if (!/^[a-z0-9]+$/.test(r.brandKey || "")) return "Please choose a brand.";
  if (!KIND_KEYS.includes(r.kind)) return "Please choose catalog or price list.";
  if (r.season && String(r.season).length > 20) return "The season is too long (for example 2026-27).";
  if (!Array.isArray(r.regions) || !r.regions.length || r.regions.some((x) => !REGION_KEYS.includes(x))) return "Tick at least one region.";
  if (!r.file || !r.file.url || !r.file.path) return "The file is missing.";
  return "";
}

const byDisplay = (a, b) =>
  KIND_KEYS.indexOf(a.kind) - KIND_KEYS.indexOf(b.kind) ||
  String(b.season || "").localeCompare(String(a.season || ""), "en", { numeric: true }) ||
  String(a.title).localeCompare(String(b.title));

/**
 * Build the manifests (what each brand + region may see) from the owner's records.
 * Returns { "<brand>__<region>": { brandKey, region, items: [...] } }. Nothing admin-only (storage paths) is copied.
 */
export function buildManifests(records) {
  const out = {};
  for (const r of records || []) {
    for (const region of r.regions || []) {
      const id = manifestId(r.brandKey, region);
      (out[id] ||= { brandKey: r.brandKey, region, items: [] }).items.push({
        id: r.id, kind: r.kind, title: r.title, season: r.season || "", url: r.file.url, name: r.file.name,
        size: r.file.size || 0, format: fileFormat(r.file.name), hasCover: !!r.hasCover, updatedAt: r.updatedAt || ""
      });
    }
  }
  for (const m of Object.values(out)) m.items.sort(byDisplay);
  return out;
}

/** Which manifests a user must read: one per brand they may see, in their own region. */
export const manifestsFor = (brandKeys, region) => (brandKeys || []).filter((k) => /^[a-z0-9]+$/.test(k)).map((k) => manifestId(k, region));

export const humanSize = (bytes) => {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1 ? mb.toFixed(mb >= 10 ? 0 : 1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
};
