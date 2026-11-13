#!/usr/bin/env python3
"""
Export the sellable stock from the M workbook into tools/output/stock.json.

READ-ONLY on the workbook: it is opened with openpyxl in read-only mode and never saved.
The workbook must have been refreshed (Stock sheet) and SAVED in Excel first: this script
reads the values Excel stored, it does not recalculate anything.

What goes into stock.json (and later to shops):  SKU/EAN, description, size, colour, condition,
available quantity, unit, and prices per price tier.
What never goes in the shop-facing part: customers, invoices, cost, export value, locations.
Locations are written under "private" and are uploaded to an admin-only record.

Usage:   python export_stock.py [--config local-config.json] [--out output]
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import sys
from collections import OrderedDict, defaultdict

try:
    import openpyxl
except ImportError:  # friendly message for a first run
    sys.exit("openpyxl is missing. Run:  python -m pip install --user openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = 2   # 2 = adds the previous-season rebate fields (item.previousSeason/age/lastSeason, price b/pct/mb, rebateRules...)
LOCATIONS = ("Eastman", "CDEC", "Other")
OPEN_SEASON = 50   # a Catalogue line with ToSeason 50 is still current

# Which Catalogue columns feed each price tier: (price column, suggested-retail column)
TIER_COLUMNS = {
    "SHOP_CAD": ("DealerCAD", "RetailCAD"), "SHOP_USD": ("DealerUSD", "RetailUSD"),
    "SHOP_EUR": ("DealerEUR", "RetailEUR"), "RETAIL_CAD": ("RetailCAD", None),
    "RETAIL_USD": ("RetailUSD", None), "RETAIL_EUR": ("RetailEUR", None), "EXPORT_EUR": ("ExportEUR", None),
}


# ----------------------------------------------------------------------------- helpers
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def clean(s):
    """Collapse whitespace; return '' for empty / placeholder values."""
    if s is None:
        return ""
    s = re.sub(r"\s+", " ", str(s)).strip()
    return "" if s.upper() in ("N/A", "NONE", "NAN") else s


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def cents(v):
    """Round half up to 2 decimals (avoids Python's banker's rounding on prices)."""
    return math.floor(v * 100 + 0.5 + 1e-9) / 100


def is_estimate(price):
    """The Catalogue sheet says: prices ending in .99 are estimates."""
    return price is not None and abs(round(price * 100) % 100 - 99) == 0


def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s or "")]


def item_id(sku, condition, used):
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{sku}~{condition}").strip("_")
    cand, n = base, 2
    while cand in used:
        cand, n = f"{base}_{n}", n + 1
    used.add(cand)
    return cand


def find_header(ws, must_have, max_scan=40):
    """Return (row_number, {header_text: [col_indexes]}) for the first row containing all `must_have`."""
    for rn, row in enumerate(ws.iter_rows(min_row=1, max_row=max_scan, values_only=True), start=1):
        cols = defaultdict(list)
        for i, c in enumerate(row):
            if isinstance(c, str) and c.strip():
                cols[c.strip()].append(i)
        if all(h in cols for h in must_have):
            return rn, cols
    raise SystemExit(f"Could not find a header row with {must_have} in sheet '{ws.title}'.")


# ----------------------------------------------------------------------------- catalogue
def read_catalogue(wb):
    ws = wb["Catalogue"]
    hdr_row, cols = find_header(ws, ["Ref", "EAN", "DealerCAD", "FromSeason", "ToSeason"])
    ix = {k: v[0] for k, v in cols.items()}
    need = ["Active", "PartNo", "Brand", "Category", "Family", "Description", "Size", "EAN", "RetailCAD", "DealerCAD", "RetailUSD",
            "DealerUSD", "RetailEUR", "DealerEUR", "ExportEUR", "FromSeason", "ToSeason"]
    missing = [h for h in need if h not in ix]
    if missing:
        raise SystemExit(f"Catalogue sheet is missing columns: {missing}")
    by_ean = defaultdict(list)
    for n, row in enumerate(ws.iter_rows(min_row=hdr_row + 1, values_only=True)):
        if row[ix["Ref"]] is None:
            continue
        ean = clean(row[ix["EAN"]])
        if not ean:
            continue
        rec = {k: row[ix[k]] for k in need}
        rec["Ref"] = row[ix["Ref"]]
        rec["_row"] = n   # position in the sheet: on a tie for "latest", the lower row wins
        by_ean[ean].append(rec)
    return by_ean


def index_by_part(by_ean):
    """PartNo -> all Catalogue lines with that part number (second lookup after the barcode)."""
    out = defaultdict(list)
    for lines in by_ean.values():
        for l in lines:
            pn = clean(l.get("PartNo"))
            if pn:
                out[pn].append(l)
    return out


# ----------------------------------------------------------------------------- previous-season rebates
def season_value(to_season, current):
    """ToSeason as a number; 50 (still current) counts as the current season."""
    return current if to_season == OPEN_SEASON else to_season


def size_key(s):
    """Sizes compared as text without case, spaces or a trailing .0; empty and 'N/A' are the same 'no size'."""
    s = clean(s).lower().replace(" ", "")
    if s in ("", "n/a", "na", "-"):
        return ""
    return s[:-2] if s.endswith(".0") and s[:-2].isdigit() else s


def latest_price_line(lines_by_sku, lines_by_part, col, current, size=None):
    """The Catalogue line that holds the LATEST available price for one price column, or None.

    Per price column: among the lines with an active ToSeason and a price > 0, the highest season wins
    (on a tie the line lower in the sheet, i.e. the higher Ref, as the workbook's Stock refresh does).
    Looked up by barcode first, then by part number. A part number is shared by every size of a model
    (rolls, skis): the second lookup only takes lines of the SAME size as the item, otherwise a 115 mm roll
    would get the 85 mm price (`size` = the item's size; None skips the check)."""
    for lines, by_part in ((lines_by_sku, False), (lines_by_part, True)):
        cands = [l for l in lines if num(l.get("ToSeason")) is not None and (num(l.get(col)) or 0) > 0
                 and not (by_part and size is not None and size_key(l.get("Size")) != size_key(size))]
        if cands:
            return max(cands, key=lambda l: (season_value(l["ToSeason"], current), l["_row"]))
    return None


def read_rebate_exceptions(wb):
    """Settings table tAgeExceptions: (set of part numbers / SKUs with Rebate = No, [(key, description, note)]).

    The header row holds 'PartNo or SKU' and 'Rebate'; rows below it up to the first empty key. Only rows whose
    Rebate starts with N (No) keep the item out of the age rule. Keys are compared as text, case-insensitive."""
    ws = wb["Settings"]
    try:
        hdr_row, cols = find_header(ws, ["PartNo or SKU", "Rebate"], max_scan=80)
    except SystemExit:
        return set(), []
    c_key, c_reb = cols["PartNo or SKU"][0], cols["Rebate"][0]
    c_desc = next((i for i in cols.get("Description", []) if i > c_key), None)
    keys, rows = set(), []
    for row in ws.iter_rows(min_row=hdr_row + 1, values_only=True):
        key = clean(row[c_key]) if len(row) > c_key else ""
        if not key:
            break
        if clean(row[c_reb]).lower().startswith("n"):
            keys.add(key.lower())
            rows.append((key, clean(row[c_desc]) if c_desc is not None and len(row) > c_desc else ""))
    return keys, rows


def exception_skus(keys, by_ean):
    """Every SKU kept out of the rule: a key matches the SKU itself, or the part number of Catalogue lines (all their SKUs)."""
    skus = set()
    for ean, lines in by_ean.items():
        if ean.lower() in keys or any(clean(l.get("PartNo")).lower() in keys for l in lines):
            skus.add(ean)
    return skus


def as_fraction(v):
    """A percentage typed as 30 instead of 30 % is read as 30 % (anything above 1 is divided by 100), like the macros do."""
    v = num(v)
    if v is None or v < 0:
        return 0.0
    return v / 100 if v > 1 else v


def read_rebate_rules(wb):
    """Rules from the Settings sheet: ({brand_key: [{brand, ageFrom, ageTo, retail, shop}]}, [conditions]).

    openpyxl read-only mode does not expose Excel tables, so the headers are located in the sheet."""
    ws = wb["Settings"]
    hdr_row, cols = find_header(ws, ["Brand", "Age from", "Age to", "Retail %", "Shop %"], max_scan=80)
    c_from, c_to, c_ret, c_shop = (cols[h][0] for h in ("Age from", "Age to", "Retail %", "Shop %"))
    c_brand = max(i for i in cols["Brand"] if i < c_from)
    rules = defaultdict(list)
    for row in ws.iter_rows(min_row=hdr_row + 1, values_only=True):
        brand = clean(row[c_brand]) if len(row) > c_brand else ""
        if not brand:
            break   # the table ends at the first empty Brand
        a_from, a_to = num(row[c_from]), num(row[c_to])
        if a_from is None or a_to is None:
            continue
        rules[brand_key(brand)].append({"brand": brand, "ageFrom": int(a_from), "ageTo": int(a_to),
                                        "retail": as_fraction(row[c_ret]), "shop": as_fraction(row[c_shop])})
    conditions = []
    try:
        chdr, ccols = find_header(ws, ["Age rule conditions"], max_scan=80)
        c_cond = ccols["Age rule conditions"][0]
        for row in ws.iter_rows(min_row=chdr + 1, values_only=True):
            v = clean(row[c_cond]) if len(row) > c_cond else ""
            if not v:
                break
            conditions.append(v)
    except SystemExit:
        pass
    return dict(rules), conditions


def read_workbook_season(wb):
    """The workbook's current selling season (defined name set_Season, else Settings!C29), e.g. '26-27'."""
    try:
        dn = wb.defined_names["set_Season"]
        sheet, cell = next(iter(dn.destinations))
        v = wb[sheet][cell.replace("$", "")].value
    except Exception:
        v = wb["Settings"]["C29"].value
    return clean(v)


def rebate_for(rules, brand, age, tier_kind):
    """Rebate as a fraction for a brand and age (tier_kind 'retail' or 'shop'); None when there is no rule or no matching age band."""
    for r in rules.get(brand_key(brand), []):
        if r["ageFrom"] <= age <= r["ageTo"]:
            return r[tier_kind]
    return None


def rebate_entry(base, pct, msrp_base=None, retail_pct=0.0):
    """One price entry for an item with a previous-season rebate.

    p = net price, b = base (list) price and pct = integer percent (only when pct > 0).
    For shop tiers m = suggested retail after the RETAIL rebate and mb = the base retail price."""
    entry = {"p": cents(base * (1 - pct))}
    if pct > 0:
        entry["b"], entry["pct"] = cents(base), int(round(pct * 100))
    if is_estimate(cents(base)):
        entry["est"] = True   # the Catalogue marks prices ending in .99 as estimates: the base decides
    if msrp_base:
        entry["m"] = cents(msrp_base * (1 - retail_pct))
        if retail_pct > 0:
            entry["mb"] = cents(msrp_base)
    return entry


def pick_catalogue_line(lines, season, fallback):
    """The line valid for `season` (FromSeason <= season <= ToSeason, 50 = open); else optionally the latest older one."""
    valid = [l for l in lines
             if num(l["FromSeason"]) is not None and l["FromSeason"] <= season <= (l["ToSeason"] or 50)]
    if valid:
        return max(valid, key=lambda l: (l["Active"] == 1, l["FromSeason"])), "current"
    if fallback and lines:
        older = [l for l in lines if num(l["ToSeason"] or 50) is not None and (l["ToSeason"] or 50) < season]
        if older:
            return max(older, key=lambda l: (l["ToSeason"] or 50, l["Ref"])), "older"
    return None, "none"


def read_move_codes(wb):
    """SKU -> part number as typed on the 'Stock moves' sheet (used only when the Catalogue has none)."""
    if "Stock moves" not in wb.sheetnames:
        return {}
    ws = wb["Stock moves"]
    try:
        hdr_row, cols = find_header(ws, ["MoveID", "SKU", "PartNo"])
    except SystemExit:
        return {}
    isku, ipn = cols["SKU"][0], cols["PartNo"][0]
    out = {}
    for row in ws.iter_rows(min_row=hdr_row + 1, values_only=True):
        sku, pn = clean(row[isku]), clean(row[ipn])
        if sku and pn and not pn.startswith("P:") and any(ch.isdigit() for ch in pn):  # 'VILLACAMPA' is a brand, not a code
            out.setdefault(sku, pn)
    return out


def derive_code(sku):
    """For lines kept under a 'P:' code (no catalogue match): 'P:21022-115|115|' -> '21022-115'. Brand names give ''."""
    if not sku.startswith("P:"):
        return ""
    first = sku[2:].split("|")[0].strip()
    return first if first and any(ch.isdigit() for ch in first) else ""


def brand_key(name):
    """Same rule as the website: lower case letters and digits only ('Villa Campa' -> 'villacampa')."""
    return re.sub(r"[^a-z0-9]+", "", str(name).lower())


def brand_of(description, all_lines, settings):
    """Brand from the Catalogue match; otherwise the first matching rule in settings; otherwise the default brand."""
    for l in sorted(all_lines, key=lambda l: l["FromSeason"] or 0, reverse=True):
        b = clean(l.get("Brand"))
        if b:
            return b, "catalogue"
    for rule in settings.get("brandRules", []):
        if description.upper().startswith(rule["descriptionStartsWith"].upper()):
            return rule["brand"], "rule"
    return settings["defaultBrand"], "default"


def item_code(sku, cat_line, all_lines, move_codes):
    """Item code shown to shops (the barcode stays in the data only for searching)."""
    for l in ([cat_line] if cat_line else []) + sorted(all_lines, key=lambda l: l["FromSeason"] or 0, reverse=True):
        pn = clean(l.get("PartNo"))
        if pn:
            return pn, "catalogue"
    if sku in move_codes:
        return move_codes[sku], "stock moves"
    d = derive_code(sku)
    return (d, "derived") if d else ("", "none")


# ----------------------------------------------------------------------------- stock
def read_stock(wb, settings):
    ws = wb["Stock"]
    hdr_row, cols = find_header(ws, ["Location", "SKU / barcode", "Condition", "Description", "Available"])
    ix = {k: v[0] for k, v in cols.items()}  # first occurrence (the left-hand table)
    for h in ("Category", "Size", "Color", "Reserved"):
        if h not in ix:
            raise SystemExit(f"Stock sheet is missing column '{h}'.")
    # columns written by the workbook's Stock refresh since 2026-11-11 (age and previous-season rebates); found by header text
    age_cols = {"lastSeason": "Last season", "age": "Age (years)", "retailPct": "Retail rebate %", "shopPct": "Shop rebate %",
                "retailLatest": "Retail CAD (latest)", "retailNet": "Retail CAD net", "shopLatest": "Shop CAD (latest)", "shopNet": "Shop CAD net"}
    has_age_cols = all(h in ix for h in age_cols.values())

    stamp = None
    for row in ws.iter_rows(min_row=1, max_row=hdr_row, values_only=True):
        for c in row:
            if isinstance(c, str):
                m = re.search(r"refreshed\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})", c)
                if m:
                    stamp = dt.datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M")

    lines = []
    for row in ws.iter_rows(min_row=hdr_row + 1, values_only=True):
        loc = row[ix["Location"]]
        sku = clean(row[ix["SKU / barcode"]])
        if loc not in LOCATIONS or not sku:
            continue
        avail = num(row[ix["Available"]])
        if avail is None:
            continue
        lines.append({
            "location": loc,
            "sku": sku,
            "condition": clean(row[ix["Condition"]]) or "New",
            "category": clean(row[ix["Category"]]),
            "description": clean(row[ix["Description"]]),
            "size": clean(row[ix["Size"]]),
            "color": clean(row[ix["Color"]]),
            "onHand": num(row[ix.get("On hand")]) if "On hand" in ix else None,
            "reserved": num(row[ix["Reserved"]]) or 0,
            "available": avail,
            "lastSeason": clean(row[ix["Last season"]]) if has_age_cols else "",
            "age": int(num(row[ix["Age (years)"]])) if has_age_cols and num(row[ix["Age (years)"]]) is not None else None,
            # the workbook's own figures, used only to cross-check the export's calculation
            "wbRetailNet": num(row[ix["Retail CAD net"]]) if has_age_cols else None,
            "wbShopNet": num(row[ix["Shop CAD net"]]) if has_age_cols else None,
        })
    return lines, stamp, has_age_cols


def unit_for(category, description, settings):
    for o in settings.get("unitOverrides", []):
        if o.get("category") in (None, category) and description.upper().startswith(o["descriptionStartsWith"].upper()):
            return o["unit"]
    return settings["units"].get(category, "piece")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "local-config.json"))
    ap.add_argument("--settings", default=os.path.join(HERE, "portal-settings.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    args = ap.parse_args()

    if not os.path.exists(args.config):
        sys.exit(f"Missing {args.config}. Copy local-config.example.json to local-config.json and set the workbook path.")
    cfg, settings = load_json(args.config), load_json(args.settings)
    wb_path = cfg["workbook"]
    if not os.path.exists(wb_path):
        sys.exit(f"Workbook not found: {wb_path}")

    season = settings["currentSeasonCode"]
    wb = openpyxl.load_workbook(wb_path, data_only=True, read_only=True, keep_vba=False)
    stock_lines, stamp, has_age_cols = read_stock(wb, settings)
    catalogue = read_catalogue(wb)
    by_part = index_by_part(catalogue)
    move_codes = read_move_codes(wb)
    rules, rule_conditions = read_rebate_rules(wb)
    exc_keys, exc_rows = read_rebate_exceptions(wb)
    exc_skus = exception_skus(exc_keys, catalogue)
    wb_season = read_workbook_season(wb)
    wb.close()

    # the season in the workbook (Settings, set_Season) and in portal-settings.json must agree: the ages depend on it
    m_season = re.match(r"^(\d{2})-\d{2}$", wb_season or "")
    if not m_season or int(m_season.group(1)) != season:
        sys.exit(f"The workbook's current season is '{wb_season}' but portal-settings.json says {season} ({settings['currentSeasonLabel']}). "
                 "Fix currentSeasonCode / currentSeasonLabel in tools/portal-settings.json (or the workbook) so they agree, then export again.")
    rule_set = set(rule_conditions)
    priced_conditions = set(settings["pricedConditions"]) | rule_set
    hide_conditions = set(settings.get("hideConditions", []))
    rebate_count = defaultdict(int)   # (brand, age band) -> items priced with a previous-season rebate

    # ---- merge identical SKU + condition held in several locations
    merged = OrderedDict()
    for l in stock_lines:
        key = (l["sku"], l["condition"])
        m = merged.setdefault(key, {**l, "available": 0.0, "locations": {}, "detail": {}})
        m["available"] += l["available"]
        m["locations"][l["location"]] = m["locations"].get(l["location"], 0) + l["available"]
        # per warehouse: on hand, held by draft invoices in Excel ("Reserved"), and what is left ("Available")
        d = m["detail"].setdefault(l["location"], {"onHand": 0.0, "reserved": 0.0, "available": 0.0})
        d["onHand"] += l["onHand"] if l["onHand"] is not None else l["available"] + l["reserved"]
        d["reserved"] += l["reserved"]
        d["available"] += l["available"]
    n_lines_in = len(stock_lines)
    n_zero = sum(1 for m in merged.values() if m["available"] <= 0)

    used_ids, items, prices, private_loc, private_stock = set(), [], {t: {} for t in settings["priceTiers"]}, {}, {}
    rep = defaultdict(list)
    hide = set(settings.get("hideCategories", []))
    for (sku, cond), m in merged.items():
        if m["available"] <= 0 or m["category"] in hide:
            continue
        if cond in hide_conditions:   # e.g. mounted ski + binding kits: not sold through the portal
            rep["hidden_conditions"].append(f'{m["description"]} {m["size"]} [{cond}] ({sku})')
            continue
        iid = item_id(sku, cond, used_ids)
        unit = unit_for(m["category"], m["description"], settings)
        qty = m["available"]
        qty = math.floor(qty + 1e-9) if unit != "m" else math.floor(qty * 10 + 1e-9) / 10  # metres keep 1 decimal
        if qty <= 0:
            rep["rounded_to_zero"].append(f'{m["description"]} {m["size"]} ({m["available"]})')
            continue
        qty = int(qty) if float(qty).is_integer() else qty
        all_lines = catalogue.get(sku, [])
        brand, brand_src = brand_of(m["description"], all_lines, settings)
        if brand_src != "catalogue":
            rep["brand_assumed"].append(f'{m["description"]} {m["size"]}: {brand} (by {brand_src})')
        cat_line, how = pick_catalogue_line(all_lines, settings.get("seasonByBrand", {}).get(brand, season),
                                            settings["fallbackToLastKnownPrice"])
        family = clean((cat_line or (all_lines[-1] if all_lines else {})).get("Family"))
        code, code_src = item_code(sku, cat_line, all_lines, move_codes)
        if not code:
            rep["no_item_code"].append(f'{m["description"]} {m["size"]} ({sku})')
        elif code_src != "catalogue":
            rep["code_not_from_catalogue"].append(f'{m["description"]} {m["size"]}: {code} (from {code_src})')
        item = {
            "id": iid, "brand": brand, "code": code, "sku": sku if not sku.startswith("P:") else "", "category": m["category"],
            "family": family,
            "description": m["description"], "size": m["size"], "color": m["color"],
            "condition": cond, "available": qty, "unit": unit,
            "minQty": settings.get("minQty", {}).get(unit, 1),
        }
        age = m["age"]
        if age is not None:
            item["age"], item["lastSeason"] = age, m["lastSeason"]   # for sorting and filtering on the website
        items.append(item)
        private_loc[iid] = {k: v for k, v in m["locations"].items() if v}
        num_out = lambda v: int(v) if float(v).is_integer() else round(v, 2)
        private_stock[iid] = {loc: {k: num_out(v) for k, v in d.items()} for loc, d in m["detail"].items() if any(d.values())}
        if len(m["locations"]) > 1:
            rep["merged_locations"].append(f'{m["description"]} {m["size"]} {cond}: ' +
                                           ", ".join(f"{k} {v:g}" for k, v in m["locations"].items()))

        label = f'{m["description"]} {m["size"]}'.strip() + f" [{cond}] ({sku})"
        if sku.startswith("P:"):
            rep["no_catalogue_match"].append(label)
            continue
        # ---- previous-season rebate: a rule item is New (or another condition listed in the workbook's rule conditions),
        # at least 1 year old, and its brand has a rebate for that age. It is priced from the LATEST price in the Catalogue.
        # tAgeExceptions (Rebate = No): kept out of the rule, priced at the latest available price like an age-0 item, no rebate
        excepted = age is not None and age >= 1 and cond in rule_set and (sku.lower() in exc_keys or sku in exc_skus or (code or "").lower() in exc_keys)
        retail_pct = rebate_for(rules, brand, age, "retail") if age is not None and age >= 1 and cond in rule_set and not excepted else None
        shop_pct = rebate_for(rules, brand, age, "shop") if age is not None and age >= 1 and cond in rule_set and not excepted else None
        if age is not None and age >= 1:
            if excepted:
                rep["aged_exception"].append(f"{label} age {age}")
            elif cond in rule_set and not ((retail_pct or 0) > 0 or (shop_pct or 0) > 0):
                rep["aged_no_rule"].append(f"{label} age {age}")
            elif cond not in rule_set:
                rep["aged_outside_rule"].append(f"{label} age {age}")
        if (retail_pct or 0) > 0 or (shop_pct or 0) > 0 or excepted:
            part = code if code_src == "catalogue" else ""
            part_lines = by_part.get(part, []) if part else []
            got = 0
            for tier in settings["priceTiers"]:
                pcol, mcol = TIER_COLUMNS[tier]
                # the part-number lookup only accepts lines of the item's own size (the barcode lookup needs no check)
                line = latest_price_line(all_lines, part_lines, pcol, season, m["size"])
                if line is None:
                    continue
                if not any(line is l for l in all_lines):
                    rep["price_from_part_number"].append(f'{label}: {tier} base price taken from another line with part number {part} (same size {line.get("Size")})')
                msrp_line = latest_price_line(all_lines, part_lines, mcol, season, m["size"]) if mcol else None
                prices[tier][iid] = rebate_entry(num(line[pcol]), (retail_pct if tier.startswith("RETAIL") else shop_pct) or 0.0,
                                                 num(msrp_line[mcol]) if msrp_line else None, retail_pct or 0.0)
                got += 1
            if got == 0:
                rep["no_price_for_season"].append(label)
                continue
            if excepted:
                continue   # latest price, no rebate, not flagged as previous season
            item["previousSeason"] = True
            band = next(r for r in rules[brand_key(brand)] if r["ageFrom"] <= age <= r["ageTo"])
            rebate_count[(brand, f'{band["ageFrom"]}' if band["ageFrom"] == band["ageTo"] else f'{band["ageFrom"]}-{band["ageTo"]}' if band["ageTo"] < 99 else f'{band["ageFrom"]}+')] += 1
            # cross-check against the workbook's own CAD figures (a 1-cent difference on an exact half cent is normal: VBA rounds half to even)
            for tier, wb_net in (("SHOP_CAD", m["wbShopNet"]), ("RETAIL_CAD", m["wbRetailNet"])):
                if wb_net is not None and iid in prices[tier] and abs(prices[tier][iid]["p"] - wb_net) > 0.011:
                    rep["crosscheck"].append(f'{label}: {tier} export {prices[tier][iid]["p"]:.2f}, workbook {wb_net:.2f}')
            continue

        if cond not in priced_conditions:
            rep["non_new_on_request"].append(label)
            continue
        if cat_line is None:
            rep["no_price_for_season"].append(label)
            continue
        if how == "older":
            rep["price_from_older_season"].append(label)
        got = 0
        for tier in settings["priceTiers"]:
            pcol, mcol = TIER_COLUMNS[tier]
            p = num(cat_line[pcol])
            if p is None or p <= 0:
                continue
            entry = {"p": cents(p)}
            if is_estimate(entry["p"]):
                entry["est"] = True
            if mcol and num(cat_line[mcol]):
                entry["m"] = cents(num(cat_line[mcol]))
            prices[tier][iid] = entry
            got += 1
        if got == 0:
            rep["no_price_for_season"].append(label)

    cat_order = ["Ski", "Binding", "Skin", "Pole", "Helmet", "BackPack", "Clothes",
                 "Skin Acc", "Binding Acc", "Pole Acc", "HeadLamp", "Bag"]
    items.sort(key=lambda i: (cat_order.index(i["category"]) if i["category"] in cat_order else 99,
                              i["description"].lower(), natural_key(i["size"]), i["color"].lower(), i["condition"]))

    brands = OrderedDict()
    for i in items:
        brands.setdefault(i["brand"], 0)
        brands[i["brand"]] += 1
    keys = defaultdict(list)
    for name in brands:
        keys[brand_key(name)].append(name)
    for k, names in keys.items():
        if not k or len(names) > 1:
            raise SystemExit(f"Brand names {names} give the same web key '{k}'. Please make them different in the Catalogue sheet.")

    now = dt.datetime.now(dt.timezone.utc)
    out = {
        "schema": SCHEMA,
        "generatedAt": now.isoformat(timespec="seconds"),
        "stockRefreshedAt": stamp.isoformat(timespec="minutes") if stamp else None,
        "season": settings["currentSeasonLabel"],
        "currentSeason": settings["currentSeasonLabel"],
        # the rebate table and conditions exactly as in the workbook (Settings, tAgeRules): the website shows them as a legend
        "rebateRules": {rs[0]["brand"]: [{"ageFrom": r["ageFrom"], "ageTo": r["ageTo"], "retailPct": int(round(r["retail"] * 100)),
                                          "shopPct": int(round(r["shop"] * 100))} for r in rs] for rs in rules.values()},
        "rebateConditions": rule_conditions,
        "items": items,
        "prices": prices,
        "private": {"locations": private_loc, "stock": private_stock},
    }

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "stock.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # ---- report
    lines_out = []
    P = lines_out.append
    P(f"M portal stock export, {now.astimezone():%Y-%m-%d %H:%M}")
    P(f"Workbook: {os.path.basename(wb_path)} (read only)")
    P(f"Stock sheet refreshed at: {stamp:%Y-%m-%d %H:%M}" if stamp else "Stock sheet refreshed at: unknown")
    if stamp and (dt.datetime.now() - stamp).total_seconds() > settings.get("staleStockHours", 36) * 3600:
        P(f"  WARNING: the Stock sheet was refreshed more than {settings.get('staleStockHours', 36)} h ago."
          " Open the workbook, refresh the Stock sheet, save it, then export again.")
    P("")
    P(f"Stock lines read: {n_lines_in}  ->  {len(merged)} distinct items after merging locations"
      f"  ->  {len(items)} published (available > 0)")
    P(f"Items with nothing available (not published): {n_zero}")
    P("By brand: " + ", ".join(f"{b} {n}" for b, n in brands.items()))
    for tier in settings["priceTiers"]:
        P(f"  prices {tier:<11}: {len(prices[tier])} of {len(items)} items")
    P("")
    # previous-season rebates
    n_rebate = sum(rebate_count.values())
    P(f"Previous-season rebates: {n_rebate} items priced with a rebate"
      + (" (" + ", ".join(f"{b} age {band}: {n}" for (b, band), n in sorted(rebate_count.items())) + ")" if n_rebate else ""))
    for rs in rules.values():
        P(f"  rule {rs[0]['brand']}: " + "; ".join(f"age {r['ageFrom']}" + (f"-{r['ageTo']}" if r['ageTo'] != r['ageFrom'] else "") + f" = {r['retail']*100:g}% retail / {r['shop']*100:g}% shop" for r in rs))
    P(f"  conditions: {', '.join(rule_conditions) or '(none)'}   current season: {wb_season}")
    if not has_age_cols:
        P("  WARNING: the Stock sheet has no age / rebate columns. Open the workbook, open the Stock sheet (it refreshes), save, and export again.")
    elif not any(l["age"] is not None for l in stock_lines):
        P("  WARNING: the age columns of the Stock sheet are all empty. The workbook was probably not refreshed since the macro update:"
          " open it, open the Stock sheet, save, and export again.")
    if not rules:
        P("  WARNING: no rule found in the Settings sheet (table tAgeRules): no previous-season rebate is applied.")
    P(f"  exceptions (tAgeExceptions, Rebate = No): {len(exc_rows)} listed ({', '.join(k for k, _ in exc_rows) or 'none'}); "
      f"{len(rep['aged_exception'])} aged items kept at their latest price")
    P("")
    titles = {
        "aged_exception": "AGED ITEMS KEPT OUT OF THE RULE BY tAgeExceptions (latest price, no rebate)",
        "no_catalogue_match": "NO CATALOGUE MATCH (code starts with P:), no price: fix in the workbook",
        "no_price_for_season": f"NO PRICE FOR SEASON {settings['currentSeasonLabel']} (shown as 'price on request')",
        "price_from_older_season": "PRICE TAKEN FROM AN OLDER SEASON (fallbackToLastKnownPrice is on)",
        "non_new_on_request": "CONDITION WITHOUT A RULE (Used / Demo / Defect...): price on request, set case by case by the owner",
        "aged_no_rule": "AGED ITEMS WITHOUT A REBATE RULE (brand or age band not in tAgeRules): normal price logic applies",
        "aged_outside_rule": "AGED ITEMS IN A CONDITION OUTSIDE THE RULE (price on request)",
        "hidden_conditions": "HIDDEN FROM THE PORTAL (condition listed in hideConditions of portal-settings.json, e.g. mounted kits)",
        "price_from_part_number": "PREVIOUS-SEASON BASE PRICE TAKEN FROM A LINE WITH THE SAME PART NUMBER (the item's own barcode has no price): check it",
        "crosscheck": "CROSS-CHECK: export differs from the workbook's own net price by more than a cent",
        "rounded_to_zero": "Fractional quantity rounded down to zero (not published)",
        "brand_assumed": "BRAND NOT IN THE CATALOGUE (brand taken from a rule or the default in portal-settings.json)",
        "no_item_code": "NO ITEM CODE found (shown without a code)",
        "code_not_from_catalogue": "Item code taken from the Stock moves sheet or derived from the P: code",
        "merged_locations": "Same item in several locations (merged; locations stay private)",
    }
    for k, title in titles.items():
        if rep[k]:
            P(f"{title}: {len(rep[k])}")
            for x in rep[k]:
                P(f"   - {x}")
            P("")
    text = "\n".join(lines_out)
    with open(os.path.join(args.out, "report.txt"), "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    print(f"Written: {os.path.join(args.out, 'stock.json')}")


if __name__ == "__main__":
    main()
