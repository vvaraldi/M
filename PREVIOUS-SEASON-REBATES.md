# Previous-season rebates: what changed in the workbook, and what to build in the export and the portal

Written 2026-11-11 for the Claude Code session that maintains this repository (`tools/export_stock.py`, `tools/run-export.bat`, the web pages in `docs/` and the functions in `functions/src`).
Updated 2026-11-12: new exceptions table `tAgeExceptions` (items kept out of the rule), see §2 and §3.
The workbook side is done and saved. The export and the web interface still have to be adapted: that is your part.

Read with: `README.md` (how the portal works), `AUTOMATION-PLAYBOOK.md`, `REQUESTS-SCHEMA.md`, and `..\SKITRAB-WORKBOOK-REFERENCE.md` (outside the repo).
Items marked **TO CONFIRM** are proposals the owner has not confirmed yet: ask him before relying on them.

## 1. The owner's rule

Older collections are sold with a standard rebate that depends on the **age of the collection** and on the **brand**.

- **Age** = current selling season − the last season the item is in the Catalogue. 0 = in the current catalogue (26-27), 1 = last listed in 25-26, 2 = in 24-25, and so on.
- **Base price** = the **latest available price** of the item in the Catalogue (the line of its last season), per price column.
- **Rebate** = a % off that base price: one % for retail prices, another for shop prices.
- It applies to **New** items only (and **Mounted & New**, see below). Used, Mounted & Used, Demo and Defect items keep a price set case by case by the owner.
- The % will change over time. They are kept in **one place**, the workbook, and everything else reads them from there.

Ski Trab rule at the start (Settings sheet, editable):

| Age (years) | Retail % | Shop % |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 30 | 25 |
| 2–3 | 40 | 35 |
| 4–5 | 50 | 45 |
| 6 and more | 70 | 60 |

Other brands (VillaCampa) have no rule yet: no rebate.

## 2. What is now in the workbook (`M - Gestion SkiTrab.xlsm`)

### Settings sheet
- **Table `tAgeRules`** (columns R:V, header row 4): `Brand` | `Age from` | `Age to` | `Retail %` | `Shop %`.
  - Percentages are stored as fractions (0.3 = 30 %). If someone types 30 instead of 30 %, the macros treat any value above 1 as a percentage (÷ 100). Do the same.
  - Brand matching ignores case and spaces (`SkiTrab`, `Ski Trab`, `skitrab` are the same), like `brand_key()` in `export_stock.py`.
  - "6 and more" is stored as `Age to` = 99.
  - A brand with no rows = no rebate. No matching age band = no rebate.
- **Conditions the rule applies to**: column X under the header `Age rule conditions` (X5 downwards, defined name `lstAgeConditions`). Today: `New`, `Mounted & New`.
- **Table `tAgeExceptions`** (columns Z:AC, header row 4): `PartNo or SKU` | `Description` | `Rebate` | `Note`.
  - A row whose `Rebate` starts with N (`No`, case ignored) keeps the item out of the rule: no rebate, priced at its latest available price, whatever its age.
  - The key is compared with the stock line's part number (`PartNo` in Stock moves) and with its SKU.
  - A part number also covers every SKU the Catalogue lists under it. So a new code that keeps the same barcode is covered (22048 also covers 22048N, same EAN).
  - Today 8 accessories: 22048, 42026, 22051, 22062, 36031 (same barcode as the 26-27 "N" code, identical for the consumer) and 40265, 40281, 22065 (accessories still valid).
  - The owner decided these item by item on 2026-11-12. Every other aged item follows the rule.
- **Current selling season**: C29, defined name `set_Season`, value `26-27` (season code = first two digits, 26). `portal-settings.json` repeats it as `currentSeasonCode`: the export should check that both agree and stop with a clear message if they don't.
- The rebate reason list has a new value: **`Previous season`**.
- The condition list now also has `Mounted & New` and `Mounted & Used`. A mounted pair is 2 stock lines (ski + binding) whose Stock moves note starts with `KIT A` / `KIT B`. At Eastman, `Old graphics` items were changed to `New` on 2026-11-11 (the age now carries that information). The value `Old graphics` is still in the list.

### Stock sheet (written by the `RefreshStock` macro; header row 8; read the cached values as today)
New columns at the right, after "Reserved for". Find them **by header text**: the names are unique.

| Header | Content |
|---|---|
| `Last season` | e.g. `23-24` (text); empty when the item is not in the Catalogue |
| `Age (years)` | 0, 1, 2 … ; empty when unknown |
| `Brand` | from the Catalogue (latest line of the SKU, else of the part number) |
| `Retail rebate %` | fraction (0.4); 0 for current items and for `tAgeExceptions` items; empty when the condition is not in `lstAgeConditions` or the brand has no rule |
| `Shop rebate %` | fraction (0.35); same rule |
| `Retail CAD (latest)` | base retail price in CAD (latest available) |
| `Retail CAD net` | base × (1 − retail %), only for rule items |
| `Shop CAD (latest)` | base shop price in CAD (DealerCAD, latest available) |
| `Shop CAD net` | base × (1 − shop %), only for rule items |

- Age, brand and rebate depend on the SKU and the condition, not on the location. When the export merges the same SKU + condition held in several warehouses, the values are identical.
- **Stock valuation changed:** for rule items aged 1 year or more, `Unit shop $` = the latest shop price and `Value %` = 1 − shop %. This does not concern the portal (cost and value never go to shops), but don't be surprised by it.
- How the macro computes things, if you need to reproduce it in Python:
  - Last season: the highest `ToSeason` among the Catalogue lines with the same `PartNo`, else the same SKU. `ToSeason` 50 means still current, which counts as the current season. Lines without `ToSeason` (inactive) are ignored.
  - Latest price: for each price column separately, the Catalogue line with the highest season (`ToSeason`, 50 → current) where the price is > 0. On a tie, the lower row wins (higher Ref). Look up by SKU first, then by part number.
- The workbook's net columns are rounded with VBA `Round` (banker's rounding). The export should compute its own prices with `cents()` (half up), so a 1-cent difference on an exact half cent is normal.

### Invoice editor
When the owner adds an aged item and leaves the rebate empty, the macro fills it in:
- the retail % on the Retail price list, or the shop % on the Shop and Export price lists;
- reason `Previous season`.

The owner does not want the age itself on invoices: only "Previous season".

## 3. What to change in the export (`tools/export_stock.py`, `tools/run-export.bat`)

1. **Read the rules** from the Settings sheet:
   - find the row holding `Brand`, `Age from`, `Age to`, `Retail %`, `Shop %` and read the rows below it until the first empty Brand;
   - read the `Age rule conditions` column the same way.
   - read `tAgeExceptions` the same way: the header row holding `PartNo or SKU` and `Rebate`, rows below until the first empty key. Keep the rows whose `Rebate` starts with N. Add the SKUs of every Catalogue line whose `PartNo` is one of those keys, as the macro does.
   - `openpyxl` in read-only mode does not expose `ws.tables`, so locate the headers.
2. **Read the new Stock columns** by header (see the table above), together with the existing ones.
3. **Price the rule items** (condition in the rule conditions, age known, a rule row found for the brand and age):
   - base = the **latest available** Catalogue line for that SKU, for each tier's price column. That is the `fallbackToLastKnownPrice` behaviour, but only for these items.
   - Pick the % by tier: `RETAIL_*` → retail %; `SHOP_*` → shop %; `EXPORT_EUR` → shop % (**TO CONFIRM**).
   - net = `cents(base × (1 − pct))`. Keep the `est` flag when the base price ends in .99.
   - Age 0 items in a rule condition are priced normally, with no rebate.
   - **Exceptions** (`tAgeExceptions`, matched by SKU, or by part number through the Catalogue): priced like age 0 items, at the latest available price, no rebate, `previousSeason: false`. The Stock sheet already shows 0 % for them after a refresh, so an export that takes the % from the Stock sheet gets this for free. An export that recomputes from `tAgeRules` must apply the exceptions itself.
4. **`pricedConditions`:**
   - Items whose condition is in the rule conditions get a price (so `Mounted & New` gets one too). Other conditions stay "price on request" as today.
   - **TO CONFIRM:** whether the owner wants the mounted pairs priced on the portal, or kept "on request" because they are sold as a ski + binding kit.
5. **New fields in `stock.json`** (schema 1, additions only; bump `schema` to 2 if the website needs to know):
   - In each item, add the shop-facing `"previousSeason": true|false`. Add `"lastSeason": "23-24"` and `"age": 3` too, for sorting and filtering (see §4 about displaying the age).
   - Price entry for a rule item:
     - `{"p": <net>, "b": <base>, "pct": 35}`, where `pct` is an integer percent.
     - Shop tiers keep `"m"` (suggested retail): make it the **net retail** (base retail × (1 − retail %)). Add `"mb"` with the base retail, so shops see the suggested selling price after the retail rebate. Items without a rebate keep today's format.
   - Top level:
     - `"rebateRules": {"SkiTrab": [{"ageFrom": 1, "ageTo": 1, "retailPct": 30, "shopPct": 25}, …]}` (by brand, the same rows as `tAgeRules`);
     - `"rebateConditions": ["New", "Mounted & New"]`;
     - `"currentSeason": "26-27"`.
6. **Report (`output/report.txt`)**, add:
   - the number of items priced with a previous-season rebate, by brand and age band;
   - aged items whose brand has no rule;
   - aged items kept out by `tAgeExceptions`;
   - aged items in a condition outside the rule (on request);
   - a warning if the new Stock columns are missing or all empty. That means the workbook was not opened and refreshed since the macro update: ask the owner to open it, open the Stock sheet, save, and run the export again.
7. **`run-export.bat`:** no change needed beyond the reminder already printed (refresh the Stock sheet, save, close). Optionally print the rebate summary line from the report.
8. **Tests:** update `functions/src/exportparity.test.js` and its fixtures for the new fields.

### Checks with the 2026-11-11 data (CAD)

| Item | SKU | Condition | Age | Retail base → net | Shop base → net |
|---|---|---|---|---|---|
| Neve 174 | 8059830652035 | New | 3 | 1,099.90 → 659.94 (−40 %) | 634.38 → 412.34 (−35 %) |
| Gara 155 | 8059830658907 | New | 4 | 1,049.90 → 524.95 (−50 %) | 598.05 → 328.93 (−45 %) |
| Stelvio Rental 85 171 (13174) | 8059830636202 | New | 5 | 889.90 → 444.95 (−50 %) | 441.67 → 242.92 (−45 %) |
| Ortles Next 90 171 orange | 8057971064809 | Mounted & New | 1 | 969.95 → 678.97 (−30 %) | 484.98 → 363.73 (−25 %) |
| Gara Aero tracksuit man L | 8056201708070 | New | 1 | 319.95 → 223.97 (−30 %) | 159.975 → 119.98 (−25 %) |
| Maestro.2 171 (current) | 8057971068395 | New | 0 | 1,649.95, no rebate | 874.47, no rebate |
| Endhook Attivo (22048, exception) | 8059830407574 | New | 2 | 16.95, no rebate | 9.32, no rebate |

These are the export values, computed with `cents()` from the unrounded base: Neve shop base is 634.375, Ortles Next 484.975, Stelvio Rental 441.6725.
The Stock sheet shows 223.96 for the tracksuit, because VBA `Round` uses banker's rounding on the exact half cent.
Shop base = DealerCAD of the item's latest Catalogue line. For the current Maestro.2 this is the 26-27 price, not the 25-26 valuation price used in the stock value.

## 4. What to show on the website

- **Product list and product page, rule items:**
  - net price large;
  - base price struck through;
  - a badge `−25 %`;
  - a label **"Previous season"** (FR: **"Saison précédente"**).
  - In shop tiers, also show the suggested retail (`m`, net retail) next to the shop price, as today.
- **Filter** "Previous season only", and a sort by rebate.
- **Legend / help:** the brand's rule from `rebateRules` (age bands and %).
  - **TO CONFIRM:** whether the owner wants the age shown at all. On invoices he wants "Previous season" without the age, so default to the badge and the label, and use the age only for filtering and sorting.
- **Requests** (`REQUESTS-SCHEMA.md`):
  - for a rule line, `unitPrice` = the net price and `priceTbd` = false;
  - add `listPrice` (base), `rebatePct` (integer) and `rebateReason: "Previous season"`, so the invoice draft can carry the rebate on the line exactly like the workbook's invoice editor does;
  - update `AUTOMATION-PLAYBOOK.md` sections 3 and 7 accordingly (a rule line is no longer a red flag).
- Admin → **Shop view** should show the same thing a shop sees.
- Firestore rules: no change expected (prices stay in `prices/<TIER>__<brand>`).

## 5. Changing the % later
The owner edits `tAgeRules` (and `tAgeExceptions`) on the Settings sheet, opens the Stock sheet (refresh), saves, runs `run-export.bat` and uploads `stock.json` in Admin. Nothing in the repository should hold its own copy of the percentages or of the exceptions.
