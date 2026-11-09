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
SCHEMA = 1
LOCATIONS = ("Eastman", "CDEC", "Other")


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
    need = ["Active", "PartNo", "Brand", "Category", "Family", "Description", "EAN", "RetailCAD", "DealerCAD", "RetailUSD",
            "DealerUSD", "RetailEUR", "DealerEUR", "ExportEUR", "FromSeason", "ToSeason"]
    missing = [h for h in need if h not in ix]
    if missing:
        raise SystemExit(f"Catalogue sheet is missing columns: {missing}")
    by_ean = defaultdict(list)
    for row in ws.iter_rows(min_row=hdr_row + 1, values_only=True):
        if row[ix["Ref"]] is None:
            continue
        ean = clean(row[ix["EAN"]])
        if not ean:
            continue
        rec = {k: row[ix[k]] for k in need}
        rec["Ref"] = row[ix["Ref"]]
        by_ean[ean].append(rec)
    return by_ean


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
        })
    return lines, stamp


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
    stock_lines, stamp = read_stock(wb, settings)
    catalogue = read_catalogue(wb)
    move_codes = read_move_codes(wb)
    wb.close()

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
        if cond not in settings["pricedConditions"]:
            rep["non_new_on_request"].append(label)
            continue
        if cat_line is None:
            rep["no_price_for_season"].append(label)
            continue
        if how == "older":
            rep["price_from_older_season"].append(label)
        src = {  # tier -> (price column, msrp column)
            "SHOP_CAD": ("DealerCAD", "RetailCAD"), "SHOP_USD": ("DealerUSD", "RetailUSD"),
            "SHOP_EUR": ("DealerEUR", "RetailEUR"), "RETAIL_CAD": ("RetailCAD", None),
            "RETAIL_USD": ("RetailUSD", None), "RETAIL_EUR": ("RetailEUR", None), "EXPORT_EUR": ("ExportEUR", None),
        }
        got = 0
        for tier in settings["priceTiers"]:
            pcol, mcol = src[tier]
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
    titles = {
        "no_catalogue_match": "NO CATALOGUE MATCH (code starts with P:), no price: fix in the workbook",
        "no_price_for_season": f"NO PRICE FOR SEASON {settings['currentSeasonLabel']} (shown as 'price on request')",
        "price_from_older_season": "PRICE TAKEN FROM AN OLDER SEASON (fallbackToLastKnownPrice is on)",
        "non_new_on_request": "NOT NEW (Demo / Old graphics / Defect): price on request until clearance pricing exists",
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
