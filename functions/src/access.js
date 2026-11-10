// Who may download a document (pure, unit-tested). Same rule as the manifests and firestore.rules:
// the shop must be active, have the document's brand, and be in one of the document's regions.

export const MAX_PRIVATE_BYTES = 7 * 1024 * 1024;   // the file travels inside the function's reply

/** Region of a user: the one the owner set, else from the currency (CAD = canada, USD = usa, else other). */
export const regionOf = (u) => (u && u.region) || (u && u.currency === "CAD" ? "canada" : u && u.currency === "USD" ? "usa" : "other");

/**
 * Returns "" when allowed, or the reason: "denied" (not an active invited user) or "not-found"
 * (no such document, or not for this brand or region: a shop must not learn that it exists).
 */
export function checkDocumentAccess(user, record) {
  if (!user || user.active !== true) return "denied";
  if (!record || !record.file || !record.file.path) return "not-found";
  if (!Array.isArray(user.brands) || !user.brands.includes(record.brandKey)) return "not-found";
  if (!Array.isArray(record.regions) || !record.regions.includes(regionOf(user))) return "not-found";
  return "";
}

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", csv: "text/csv", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip"
};
export const contentTypeOf = (name) => TYPES[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";
