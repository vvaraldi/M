import { test } from "node:test";
import assert from "node:assert/strict";
import { normCountry, normProvince, COUNTRIES, PROVINCES } from "../../docs/assets/js/customer.js";

test("countries are tidied to the workbook's spellings", () => {
  for (const [typed, want] of [["CA", "Canada"], ["canada", "Canada"], [" Canada ", "Canada"], ["US", "USA"], ["U.S.A.", "USA"], ["United States", "USA"],
    ["États-Unis", "USA"], ["IT", "Italy"], ["Italia", "Italy"], ["Italie", "Italy"], ["AU", "Australia"], ["Australie", "Australia"]]) assert.equal(normCountry(typed), want, typed);
  assert.equal(normCountry("Switzerland"), "Switzerland");      // unknown: kept as typed
  assert.equal(normCountry(""), ""); assert.equal(normCountry(undefined), "");
});

test("Canadian provinces become two-letter codes, in English or French, with or without accents", () => {
  for (const [typed, want] of [["Québec", "QC"], ["Quebec", "QC"], ["quebec", "QC"], ["qc", "QC"], ["QC", "QC"], ["Alberta", "AB"], ["British Columbia", "BC"],
    ["Colombie-Britannique", "BC"], ["Ontario", "ON"], ["Nouveau-Brunswick", "NB"], ["Nova Scotia", "NS"], ["Nouvelle-Écosse", "NS"], ["Île-du-Prince-Édouard", "PE"],
    ["Terre-Neuve-et-Labrador", "NL"], ["Yukon", "YT"], ["Saskatchewan", "SK"]]) assert.equal(normProvince(typed), want, typed);
  assert.equal(normProvince("UT"), "UT");                      // a US state is kept
  assert.equal(normProvince("  Utah "), "Utah");
  assert.equal(normProvince(""), "");
});

test("the suggestion lists contain exactly the spellings the normaliser produces", () => {
  for (const c of COUNTRIES) assert.equal(normCountry(c), c);
  for (const p of PROVINCES) assert.equal(normProvince(p), p);
  assert.ok(["Canada", "USA", "Italy", "Australia"].every((c) => COUNTRIES.includes(c)));
  assert.ok(["QC", "AB", "BC", "ON"].every((p) => PROVINCES.includes(p)));
});
