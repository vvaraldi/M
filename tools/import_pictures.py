#!/usr/bin/env python3
"""Copy a folder of product pictures into the picture library, one folder per brand and season, named by part number.

  python import_pictures.py --src "C:\\...\\Product images" --brand Skitrab --season 2026-27
  python import_pictures.py --pack "C:\\...\\Product images" --brand Skitrab --season 2026-27 [--dry-run]   (Ski Trab's image pack, see pack_pictures)

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


DUPLICATE_DIR = re.compile(r"-\d{8}T\d{6}Z")   # a second copy of a download made by a zip: 04_ACCESSORIES-20261115T035944Z-1-001


def pack_pictures(root):
    """The first picture of every product in Ski Trab's image pack (folders like 00_SKIMO\\13214_GARA SPEED\\13214_0.jpg).

    {PART NUMBER: {"path", "old"}}. Each product folder holds <code>_0.jpg (skis and bindings: the pack shot, top and base) and/or <code>_1.jpg, <code>_2.jpg ...
    The first picture is _0 when it exists, otherwise _1 (helmets, bags, gloves, apparel...: _1 is the product on white). Folders named OLD hold earlier
    models; they only fill part numbers the current folders do not have. Mac files (._x.jpg), thumbnails and the duplicate zip copy are ignored."""
    best = {}
    for dp, _, files in os.walk(root):
        if DUPLICATE_DIR.search(dp):
            continue
        rel = os.path.relpath(dp, root).upper().split(os.sep)
        old = any(p == "OLD" or p.endswith("_OLD") for p in rel)
        found = []
        for f in files:
            m = re.match(r"^([A-Za-z0-9]+)_(\d+)\.jpe?g$", f, re.I)
            if f.startswith("._") or not m:
                continue
            found.append((m.group(1).upper(), int(m.group(2)), os.path.join(dp, f)))
        # a folder 41168_BORMIO... whose files are all named 41153_n.jpg (an earlier code): the pictures belong to the folder's code too
        fm = re.match(r"^(\d{5}[A-Z]{0,3})", os.path.basename(dp).upper())
        codes_here = {c for c, _, _ in found}
        names = [(c, i, p) for c, i, p in found]
        if fm and len(codes_here) == 1 and fm.group(1) not in codes_here:
            names += [(fm.group(1), i, p) for _, i, p in found]
        for code, idx, path in names:
            key = (old, idx)   # current before old, then _0, then _1, then _2...
            if code not in best or key < best[code]["key"]:
                best[code] = {"path": path, "old": old, "key": key}
    return best


def import_pack(args, names):
    """Copy the first picture of each product of the pack into the library.

    For a part number and season, the pack's picture REPLACES the real picture already in that season folder (it is the official one), and the
    "(catalogue)" fallback files of that part number are removed (the script can always make them again)."""
    pack = pack_pictures(args.pack)
    copied = replaced = removed = 0
    brand_dir = os.path.join(args.library, args.brand)
    existing = {}   # (season, PART) -> [paths of real files], and PART -> [paths of catalogue files]
    catalogue_files = {}
    for season in (os.listdir(brand_dir) if os.path.isdir(brand_dir) else []):
        sdir = os.path.join(brand_dir, season)
        if not os.path.isdir(sdir):
            continue
        for f in os.listdir(sdir):
            if os.path.splitext(f)[1].lower() not in EXT:
                continue
            (catalogue_files.setdefault(part_of(f), []) if "(catalogue)" in f else existing.setdefault((season, part_of(f)), [])).append(os.path.join(sdir, f))
    for code, p in sorted(pack.items()):
        season = args.old_season if p["old"] else args.season
        dest = os.path.join(brand_dir, season)
        desc = clean_name(names.get(code, ""))
        target = os.path.join(dest, (f"{code} {desc}" if desc else code) + ".jpg")
        old_files = existing.get((season, code), [])
        if not args.dry_run:
            os.makedirs(dest, exist_ok=True)
        for fp in old_files:
            if os.path.abspath(fp) != os.path.abspath(target):
                if not args.dry_run:
                    os.remove(fp)
                removed += 1
        for fp in catalogue_files.get(code, []):
            if not args.dry_run:
                os.remove(fp)
            removed += 1
        if not args.dry_run:
            shutil.copyfile(p["path"], target)
        replaced += 1 if old_files else 0
        copied += 0 if old_files else 1
    print(f"{'would copy' if args.dry_run else 'copied'}: {copied} new pictures, {replaced} replaced; removed {removed} older files; "
          f"{len(pack)} products in the pack ({sum(1 for p in pack.values() if p['old'])} from OLD folders)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="folder with the pictures (searched recursively)")
    ap.add_argument("--pack", help="Ski Trab's image pack folder: takes the first picture (_0, else _1) of every product")
    ap.add_argument("--old-season", default="2025-26", help="season folder for products found in OLD folders of the pack")
    ap.add_argument("--dry-run", action="store_true", help="show what would be copied and removed, change nothing")
    ap.add_argument("--brand", required=True, help="brand folder name, e.g. Skitrab")
    ap.add_argument("--season", required=True, help='season folder name, e.g. 2026-27')
    ap.add_argument("--library", default=LIBRARY)
    ap.add_argument("--force", action="store_true", help="overwrite files that already exist")
    ap.add_argument("--only-new", action="store_true", help="skip part numbers that already have a picture in any season folder of this brand")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.season) or not re.fullmatch(r"\d{4}-\d{2}", args.old_season):
        sys.exit('The season must look like 2026-27.')
    if bool(args.src) == bool(args.pack):
        sys.exit("Give either --src (a folder of pictures) or --pack (Ski Trab's image pack).")
    names = catalogue_descriptions()
    if args.pack:
        import_pack(args, names)
        return
    dest = os.path.join(args.library, args.brand, args.season)
    os.makedirs(dest, exist_ok=True)
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
