#!/usr/bin/env python3
"""Copy a folder of product pictures into the picture library, one folder per brand and season, named by part number.

  python import_pictures.py --src "C:\\...\\Product images" --brand Skitrab --season 2026-27

Result: <library>\\<Brand>\\<season>\\<part number> <DESCRIPTION>.jpg   (library = "Sharable info\\Pictures")
The part number is the start of the source file name: 13205_0_2.JPG gives 13205, 40237R_1_2.JPG gives 40237R.
The description comes from the workbook's Catalogue sheet (read only) so the folder is readable; without it the file is just <part number>.jpg.
Existing files are never overwritten (use --force). Nothing else is touched: the website and Firebase are not involved.
"""
import argparse
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY = os.path.normpath(os.path.join(HERE, "..", "..", "Pictures"))
EXT = {".jpg", ".jpeg", ".png", ".webp"}


def part_of(filename):
    """Leading letters and digits of the file name: the part number."""
    m = re.match(r"^([A-Za-z0-9]+)", os.path.splitext(filename)[0])
    return m.group(1).upper() if m else ""


def clean_name(s):
    return re.sub(r"\s+", " ", re.sub(r'[<>:"/\\|?*]+', " ", s or "")).strip()


def catalogue_descriptions():
    """{PART NUMBER (upper case): description of its newest Catalogue line}, or {} when the workbook is not available."""
    try:
        import json
        import openpyxl
        sys.path.insert(0, HERE)
        import export_stock as ex
        cfg = json.load(open(os.path.join(HERE, "local-config.json"), encoding="utf-8"))
        wb = openpyxl.load_workbook(cfg["workbook"], data_only=True, read_only=True, keep_vba=False)
        by_part = ex.index_by_part(ex.read_catalogue(wb))
        wb.close()
    except Exception as e:   # no workbook, no openpyxl...: the files are then named by part number only
        print("note: part descriptions not read from the workbook:", e)
        return {}
    out = {}
    for part, lines in by_part.items():
        best = max(lines, key=lambda l: (ex.num(l.get("ToSeason")) or 0, l.get("_row", 0)))
        out[part.upper()] = ex.clean(best.get("Description"))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="folder with the pictures (searched recursively)")
    ap.add_argument("--brand", required=True, help="brand folder name, e.g. Skitrab")
    ap.add_argument("--season", required=True, help='season folder name, e.g. 2026-27')
    ap.add_argument("--library", default=LIBRARY)
    ap.add_argument("--force", action="store_true", help="overwrite files that already exist")
    ap.add_argument("--only-new", action="store_true", help="skip part numbers that already have a picture in any season folder of this brand")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.season):
        sys.exit('The season must look like 2026-27.')
    dest = os.path.join(args.library, args.brand, args.season)
    os.makedirs(dest, exist_ok=True)
    names = catalogue_descriptions()
    copied = skipped = 0
    seen = {}
    if args.only_new:   # parts that already have a real picture in this brand's folder (a "(catalogue)" file does not count: it is the lower-quality fallback)
        brand_dir = os.path.join(args.library, args.brand)
        for root, _, files in os.walk(brand_dir):
            for f in files:
                if os.path.splitext(f)[1].lower() in EXT and "(catalogue)" not in f:
                    seen[part_of(f)] = "the library"
    for root, _, files in os.walk(args.src):
        for f in sorted(files):
            if os.path.splitext(f)[1].lower() not in EXT:
                continue
            part = part_of(f)
            if not part:
                print("skipped (no part number in the name):", f)
                continue
            if part in seen:
                if seen[part] != "the library":
                    print(f"skipped {f}: {seen[part]} already gives part {part}")
                continue
            seen[part] = f
            desc = clean_name(names.get(part, ""))
            target = os.path.join(dest, (f"{part} {desc}" if desc else part) + ".jpg")
            if os.path.exists(target) and not args.force:
                skipped += 1
                continue
            src = os.path.join(root, f)
            if os.path.splitext(f)[1].lower() in (".jpg", ".jpeg"):
                shutil.copyfile(src, target)
            else:   # png / webp: convert to JPEG
                import pymupdf
                pix = pymupdf.Pixmap(src)
                if pix.alpha:
                    pix = pymupdf.Pixmap(pix, 0)   # drop the transparency (JPEG has none)
                if pix.colorspace is not None and pix.colorspace.n > 3:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                pix.save(target)
            copied += 1
    print(f"copied {copied}, already there {skipped} -> {dest}")


if __name__ == "__main__":
    main()
