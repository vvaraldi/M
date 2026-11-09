// Tidy a shop's country and province to the spellings used in the workbook's Customers sheet:
//   Country:  Canada, USA, Italy, Australia          Province: QC, AB, BC, ON, ... (blank for the USA in the workbook)
// Anything not recognised is kept exactly as typed.
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.’']/g, "").replace(/[\s-]+/g, " ").trim();

export const COUNTRIES = ["Canada", "USA", "Italy", "Australia"];
const COUNTRY_ALIASES = {
  Canada: ["ca", "can", "canada"],
  USA: ["us", "usa", "united states", "united states of america", "etats unis", "stati uniti", "america"],
  Italy: ["it", "ita", "italy", "italie", "italia"],
  Australia: ["au", "aus", "australia", "australie"]
};

export const PROVINCES = ["QC", "AB", "BC", "ON", "MB", "NB", "NL", "NS", "PE", "SK", "NT", "NU", "YT"];
const PROVINCE_ALIASES = {
  QC: ["qc", "que", "quebec"], AB: ["ab", "alta", "alberta"], BC: ["bc", "british columbia", "colombie britannique"], ON: ["on", "ont", "ontario"],
  MB: ["mb", "manitoba"], NB: ["nb", "new brunswick", "nouveau brunswick"], NL: ["nl", "newfoundland", "newfoundland and labrador", "terre neuve", "terre neuve et labrador"],
  NS: ["ns", "nova scotia", "nouvelle ecosse"], PE: ["pe", "pei", "prince edward island", "ile du prince edouard"], SK: ["sk", "saskatchewan"],
  NT: ["nt", "northwest territories", "territoires du nord ouest"], NU: ["nu", "nunavut"], YT: ["yt", "yukon"]
};

const lookup = (table, value) => {
  const f = fold(value);
  for (const [canon, aliases] of Object.entries(table)) if (aliases.includes(f)) return canon;
  return null;
};

export function normCountry(value) {
  const v = String(value || "").trim();
  return v ? (lookup(COUNTRY_ALIASES, v) || v) : "";
}
/** Canadian provinces are turned into their two-letter code; other values (for example a US state) are only trimmed. */
export function normProvince(value) {
  const v = String(value || "").trim();
  return v ? (lookup(PROVINCE_ALIASES, v) || v) : "";
}
