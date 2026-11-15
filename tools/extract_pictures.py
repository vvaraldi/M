#!/usr/bin/env python3
"""Extract one picture per product from the Ski Trab catalogues and match it to the portal's stock by part number.

Reads   tools/output/stock.json (the part numbers in stock) and the catalogue PDFs (newest first).
Writes  tools/output/pictures/thumb/<code>.jpg   (fit in 320 x 240)
        tools/output/pictures/large/<code>.jpg   (fit in 900 x 900, never enlarged)
        tools/output/pictures/pictures.json      (everything above in one file: what the Admin "Pictures" tab publishes)
        tools/output/pictures/matches.json       (chosen picture, alternatives, source page, distance)
        tools/output/pictures/contact-sheet.html (one self-contained page to check every match by eye)

How a picture is matched: the part number is searched as text on each catalogue page; the nearest product picture on
the same page half (the pages are double-page spreads) wins. A product picture is a cut-out (has a transparency mask)
or a photo on a white background; lifestyle photos, textures and icons are skipped. A newer catalogue wins over an older one.

Manual corrections go in tools/picture-overrides.json:
  { "13214": {"pdf": "CATALOGUE_ALP_2026.pdf", "page": 12, "xref": 226},   // pick another picture from the contact sheet
    "40297": {"pdf": "catalogo_skitrab_2024.pdf", "page": 26, "xrefs": [877, 885]},   // several pictures side by side
    "99001": {"file": "C:/path/to/picture.jpg"},                              // or a picture of your own
    "13177": {"skip": true} }                                                  // never show a picture for this code
Nothing here touches the workbook, the website or Firebase.
"""
import argparse
import base64
import html
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.normpath(os.path.join(HERE, "..", "..", "Documents", "Skitrab"))
LIBRARY = os.path.normpath(os.path.join(HERE, "..", "..", "Pictures"))   # Sharable info\Pictures\<Brand>\<season>\<part number> <description>.jpg
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
CATALOGUE_TAG = " (catalogue)"   # files the script saved from a catalogue carry this tag, so any real picture beats them
CATALOGUES = [  # newest first: the first catalogue that shows a product gives its picture
    "2026/CATALOGUE_ALP_2026.pdf",
    "2025/20250108_Catalogue_XC_200x285_2025_SOLOSCHEDE_ENG-1.pdf",
    "2024/catalogo_skitrab_2024.pdf",
    "2023/20221213_CATALOGO_ALPINISMO_2023_small.pdf",
    "2022/2022-23 --- Skitrab - catalogue.pdf",
    "2021/20202112_CATALOGO_ALPINISMO_20X20_2021_full.pdf",
    "2020/Skitrab catalogue 2020-21.pdf",
]
MIN_PX = 80          # smaller images are icons
MAX_PAGE_SHARE = 0.35  # bigger images are lifestyle photos or backgrounds
MAX_DIST = 500       # points between the part number and its picture
THUMB_FIT, LARGE_FIT = (320, 240), (900, 900)
BG = (0.96, 0.96, 0.96)   # tile colour behind cut-outs


def norm_tok(s):
    return re.sub(r"[^0-9A-Za-z]", "", s).upper()


def pixmap_of(doc, xref, smask):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.colorspace is not None and pix.colorspace.n > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    if smask:
        try:
            pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, smask))
        except Exception:
            pass
    return pix


def corners_white(pix):
    """True when the four corners of a picture without mask are near white (a product photographed on white)."""
    if pix.alpha or pix.width < 4 or pix.height < 4:
        return pix.alpha > 0
    try:
        pts = [(1, 1), (pix.width - 2, 1), (1, pix.height - 2), (pix.width - 2, pix.height - 2)]
        return all(min(pix.pixel(x, y)[:3]) >= 232 for x, y in pts)
    except Exception:
        return False


def render(pix, fit, fmt="jpg", never_enlarge=True):
    """Fit the picture inside `fit` (w, h) on the tile colour; returns (bytes, w, h)."""
    s = min(fit[0] / pix.width, fit[1] / pix.height)
    if never_enlarge:
        s = min(s, 1.0)
    w, h = max(8, int(round(pix.width * s))), max(8, int(round(pix.height * s)))
    d = pymupdf.open()
    pg = d.new_page(width=w, height=h)
    pg.draw_rect(pg.rect, color=None, fill=BG)
    pg.insert_image(pg.rect, stream=pix.tobytes("png"))
    out = pg.get_pixmap(dpi=72)
    return out.tobytes("jpg", jpg_quality=82), out.width, out.height


def candidates_on_page(doc, pg):
    """Product pictures on one page: [{xref, rect, w, h, smask, half}]."""
    out, seen = [], set()
    area = pg.rect.width * pg.rect.height
    for im in pg.get_images(full=True):
        xref, smask, w, h = im[0], im[1], im[2], im[3]
        if w < MIN_PX or h < MIN_PX:
            continue
        for r in pg.get_image_rects(xref)[:2]:
            if r.width * r.height > MAX_PAGE_SHARE * area or (xref, int(r.x0 // 50)) in seen:
                continue
            seen.add((xref, int(r.x0 // 50)))
            out.append({"xref": xref, "rect": r, "w": w, "h": h, "smask": smask})
    return out


def scan_catalogue(path, codes):
    """{code: [candidate]} for every part number found as text on a page of this catalogue."""
    doc = pymupdf.open(path)
    found = defaultdict(list)
    wanted = {norm_tok(c): c for c in codes}
    for pno, pg in enumerate(doc, 1):
        words = pg.get_text("words")
        hits = defaultdict(list)
        for w in words:
            c = wanted.get(norm_tok(w[4]))
            if c:
                hits[c].append(pymupdf.Rect(w[:4]))
        if not hits:
            continue
        cands = candidates_on_page(doc, pg)
        if not cands:
            continue
        mid = pg.rect.width / 2
        spread = pg.rect.width > 1.4 * pg.rect.height
        keep = []
        for c in cands:
            pix = None
            if not c["smask"]:
                pix = pixmap_of(doc, c["xref"], 0)
                if not corners_white(pix):
                    continue   # a photo or a texture, not a product picture
            keep.append(c)
        for code, rects in hits.items():
            for tr in rects:
                tc = ((tr.x0 + tr.x1) / 2, (tr.y0 + tr.y1) / 2)
                for c in keep:
                    if spread and ((tc[0] < mid) != (((c["rect"].x0 + c["rect"].x1) / 2) < mid)):
                        continue   # the other half of the spread
                    cc = ((c["rect"].x0 + c["rect"].x1) / 2, (c["rect"].y0 + c["rect"].y1) / 2)
                    dist = ((tc[0] - cc[0]) ** 2 + (tc[1] - cc[1]) ** 2) ** 0.5
                    if dist <= MAX_DIST:
                        found[code].append({"pdf": os.path.basename(path), "page": pno, "xref": c["xref"], "smask": c["smask"],
                                            "dist": round(dist), "px": [c["w"], c["h"]]})
    doc.close()
    for code in found:   # one entry per picture, nearest first
        best = {}
        for f in found[code]:
            k = (f["pdf"], f["page"], f["xref"])
            if k not in best or f["dist"] < best[k]["dist"]:
                best[k] = f
        found[code] = sorted(best.values(), key=lambda f: f["dist"])
    return found


def brand_key(name):
    return re.sub(r"[^a-z0-9]+", "", str(name).lower())   # same rule as brand_key() in export_stock.py


def scan_library(root):
    """The picture library: <root>\\<Brand>\\<season>\\<part number> <description>.jpg
    Returns ({brandKey: {PART NUMBER: {file, season, key}}}, {brandKey: folder name}).
    For one part number the newest season folder wins, then the larger picture."""
    out, folders = {}, {}
    if not os.path.isdir(root):
        return out, folders
    for brand in sorted(os.listdir(root)):
        bdir = os.path.join(root, brand)
        if not os.path.isdir(bdir):
            continue
        bk = brand_key(brand)
        folders[bk] = brand
        for season in sorted(os.listdir(bdir)):
            sdir = os.path.join(bdir, season)
            m = re.match(r"(\d{4})", season)
            if not os.path.isdir(sdir) or not m:
                continue
            for f in os.listdir(sdir):
                mm = re.match(r"^([A-Za-z0-9]+)", os.path.splitext(f)[0])
                if not mm or not f.lower().endswith(IMG_EXT):
                    continue
                path = os.path.join(sdir, f)
                try:
                    px = pymupdf.Pixmap(path)
                except Exception:
                    print("skipped (not readable):", path)
                    continue
                # a real picture (from the website, a photographer, Ski Trab) beats a picture the script took from a catalogue; then newest season; then the larger one
                key = (0 if CATALOGUE_TAG in f else 1, int(m.group(1)), px.width * px.height)
                cur = out.setdefault(bk, {}).get(mm.group(1).upper())
                if cur is None or key > cur["key"]:
                    out[bk][mm.group(1).upper()] = {"file": path, "season": season, "key": key}
    return out, folders


def season_of_catalogue(pdf_name):
    """'2026/CATALOGUE_ALP_2026.pdf' in the CATALOGUES list gives the season folder 2026-27."""
    for rel in CATALOGUES:
        if os.path.basename(rel) == pdf_name:
            y = int(rel.split("/")[0])
            return f"{y}-{(y + 1) % 100:02d}"
    return None


def file_name_part(s):
    return re.sub(r"\s+", " ", re.sub(r'[<>:"/\\|?*]+', " ", s)).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stock", default=os.path.join(HERE, "output", "stock.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "output", "pictures"))
    ap.add_argument("--overrides", default=os.path.join(HERE, "picture-overrides.json"))
    ap.add_argument("--library", default=LIBRARY)
    ap.add_argument("--no-library-export", action="store_true", help="do not save catalogue pictures into the library folders")
    ap.add_argument("--with-catalogue", action="store_true", help="also put the small pictures taken from catalogues into pictures.json (default: real pictures only)")
    args = ap.parse_args()

    stock = json.load(open(args.stock, encoding="utf-8"))
    by_code = OrderedDict()
    for i in stock["items"]:
        c = (i.get("code") or "").strip()
        if len(c) >= 4:
            by_code.setdefault(c, []).append(i)
    overrides = json.load(open(args.overrides, encoding="utf-8")) if os.path.exists(args.overrides) else {}
    library, lib_folders = scan_library(args.library)
    print("library:", args.library, "-", sum(len(v) for v in library.values()), "pictures")

    cat_paths = [os.path.join(DOCS, p.replace("/", os.sep)) for p in CATALOGUES]
    cat_paths = [p for p in cat_paths if os.path.exists(p)]
    matches, remaining = OrderedDict(), set(by_code)
    for path in cat_paths:
        if not remaining:
            break
        print("scanning", os.path.relpath(path, DOCS), "for", len(remaining), "part numbers")
        found = scan_catalogue(path, remaining)
        for code, cands in found.items():
            matches[code] = {"candidates": cands}
            remaining.discard(code)

    os.makedirs(os.path.join(args.out, "thumb"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "large"), exist_ok=True)
    docs_cache, results, sheet = {}, OrderedDict(), []

    def open_pdf(name):
        if name not in docs_cache:
            p = next((q for q in cat_paths if os.path.basename(q) == name), None)
            docs_cache[name] = pymupdf.open(p) if p else None
        return docs_cache[name]

    def page_pixmap(src, xref):
        d = open_pdf(src["pdf"])
        smask = src.get("smask", 0) if xref == src.get("xref") else 0
        smask = smask or next((im[1] for im in d[src["page"] - 1].get_images(full=True) if im[0] == xref), 0)
        return pixmap_of(d, xref, smask)

    def compose(pixes, gap=14):
        """Several pictures side by side (a ski with its binding, say), all brought to the tallest height."""
        H = max(p.height for p in pixes)
        widths = [p.width * H / p.height for p in pixes]
        d = pymupdf.open()
        pg = d.new_page(width=int(sum(widths) + gap * (len(pixes) - 1)), height=int(H))
        pg.draw_rect(pg.rect, color=None, fill=BG)
        x = 0.0
        for p, w in zip(pixes, widths):
            pg.insert_image(pymupdf.Rect(x, 0, x + w, H), stream=p.tobytes("png"))
            x += w + gap
        return pg.get_pixmap(dpi=72)

    def make(code, src, label):
        """Write thumb + large for one chosen source; returns a record (and the small preview bytes)."""
        if "file" in src:
            pix = pymupdf.Pixmap(src["file"])
            if pix.colorspace is not None and pix.colorspace.n > 3:
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        elif "xrefs" in src:
            pix = compose([page_pixmap(src, x) for x in src["xrefs"]])
        else:
            pix = page_pixmap(src, src["xref"])
        t, tw, th = render(pix, THUMB_FIT)
        big, bw, bh = render(pix, LARGE_FIT)
        open(os.path.join(args.out, "thumb", code + ".jpg"), "wb").write(t)
        open(os.path.join(args.out, "large", code + ".jpg"), "wb").write(big)
        return {"thumb": [tw, th, len(t)], "large": [bw, bh, len(big)], "source": label}, render(pix, (110, 110))[0]

    for code, items in by_code.items():
        ov = overrides.get(code, {})
        entry = {"code": code, "items": sorted({i["description"] for i in items}), "status": "none"}
        libpic = library.get(brand_key(items[0]["brand"]), {}).get(code.upper())
        if ov.get("skip"):
            entry["status"] = "skipped"
            if libpic:
                entry["libraryHas"] = f'{libpic["season"]}/{os.path.basename(libpic["file"])}'   # you said no picture, but the library has one
        elif "file" in ov:
            rec, prev = make(code, ov, "your own file")
            entry.update(status="override", **rec)
            sheet.append((code, entry, prev, []))
        elif libpic:   # the picture library wins over the catalogues (a file you put there is what shops see)
            from_cat = CATALOGUE_TAG in os.path.basename(libpic["file"])
            rec, prev = make(code, {"file": libpic["file"]}, f'library {libpic["season"]}' + (" (taken from a catalogue)" if from_cat else ""))
            entry.update(status="library", fromCatalogue=from_cat, **rec)
            sheet.append((code, entry, prev, []))
        elif "xref" in ov or "xrefs" in ov:
            rec, prev = make(code, ov, f'{ov["pdf"]} p{ov["page"]} (override)')
            entry.update(status="override", **rec)
            sheet.append((code, entry, prev, []))
        elif code in matches:
            cands = matches[code]["candidates"]
            best = cands[0]
            rec, prev = make(code, best, f'{best["pdf"]} p{best["page"]}')
            entry.update(status="matched", dist=best["dist"], pdf=best["pdf"], page=best["page"], xref=best["xref"],
                         alternatives=[{k: c[k] for k in ("pdf", "page", "xref", "dist")} for c in cands[1:4]], **rec)
            alts = []
            for c in cands[1:4]:
                try:
                    d = open_pdf(c["pdf"])
                    alts.append((c, render(pixmap_of(d, c["xref"], c["smask"]), (80, 80))[0]))
                except Exception:
                    pass
            sheet.append((code, entry, prev, alts))
        results[code] = entry

    for d in docs_cache.values():
        if d:
            d.close()
    keep = {c for c, e in results.items() if e["status"] in ("matched", "override", "library")}
    # ---- save the catalogue pictures into the library (never over an existing file), so the folder holds every picture shops see
    exported = 0
    if not args.no_library_export and os.path.isdir(args.library):
        for code, e in results.items():
            pdf = e.get("pdf") or (overrides.get(code, {}).get("pdf") if e["status"] == "override" else None)
            if e["status"] not in ("matched", "override") or not pdf or "file" in overrides.get(code, {}):
                continue
            season = season_of_catalogue(pdf)
            if not season:
                continue
            bk = brand_key(by_code[code][0]["brand"])
            if library.get(bk, {}).get(code.upper()):
                continue
            folder = lib_folders.get(bk) or by_code[code][0]["brand"]
            desc = file_name_part(min(e["items"], key=len))
            target_dir = os.path.join(args.library, folder, season)
            os.makedirs(target_dir, exist_ok=True)
            target = os.path.join(target_dir, (f"{code} {desc}" if desc else code) + CATALOGUE_TAG + ".jpg")
            if not os.path.exists(target):
                with open(target, "wb") as fh:
                    fh.write(open(os.path.join(args.out, "large", code + ".jpg"), "rb").read())
                exported += 1
        if exported:
            print(f"saved {exported} catalogue pictures into the library ({args.library})")
    for sub in ("thumb", "large"):   # drop pictures of codes that are skipped now or no longer matched
        for f in os.listdir(os.path.join(args.out, sub)):
            if f.endswith(".jpg") and f[:-4] not in keep:
                os.remove(os.path.join(args.out, sub, f))
    json.dump(results, open(os.path.join(args.out, "matches.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- the package the Admin "Pictures" tab publishes: { schema: 1, brands: { <brandKey>: { <code>: { t: <base64 thumb>, l: <base64 large> } } } }
    # Only real pictures (website, photographer, your own files) go to shops by default; the small catalogue pictures only with --with-catalogue.
    def from_catalogue(code):
        e = results[code]
        return e["status"] == "matched" or e.get("fromCatalogue") or (e["status"] == "override" and "file" not in overrides.get(code, {}))
    publish = sorted(c for c in keep if args.with_catalogue or not from_catalogue(c))
    pkg = {"schema": 1, "brands": {}}
    for code in publish:
        bk = re.sub(r"[^a-z0-9]+", "", by_code[code][0]["brand"].lower())   # same rule as brand_key() in export_stock.py
        t = base64.b64encode(open(os.path.join(args.out, "thumb", code + ".jpg"), "rb").read()).decode()
        l = base64.b64encode(open(os.path.join(args.out, "large", code + ".jpg"), "rb").read()).decode()
        pkg["brands"].setdefault(bk, {})[code] = {"t": t, "l": l}
    with open(os.path.join(args.out, "pictures.json"), "w", encoding="utf-8") as f:
        json.dump(pkg, f)
    n_pub = sum(len(v) for v in pkg["brands"].values())
    print(f"pictures.json: {n_pub} pictures, {os.path.getsize(os.path.join(args.out, 'pictures.json')) / 1e6:.1f} MB"
          + ("" if args.with_catalogue else f" (real pictures only; {len(keep) - n_pub} taken from catalogues are left out: use --with-catalogue to include them)"))

    # ---- contact sheet (self-contained)
    def b64(b):
        return base64.b64encode(b).decode()
    rows = []
    for code, e, prev, alts in sorted(sheet, key=lambda s: (s[1]["items"][0].lower(), s[0])):
        alt_html = "".join(f'<figure><img src="data:image/jpeg;base64,{b64(a)}" alt=""><figcaption>{html.escape(c["pdf"][:14])} p{c["page"]}<br>xref {c["xref"]}</figcaption></figure>' for c, a in alts)
        conf = "ok" if e.get("dist", 0) < 250 else "check"
        rows.append(f'<section class="row {conf}"><figure class="main"><img src="data:image/jpeg;base64,{b64(prev)}" alt=""></figure>'
                    f'<div class="info"><b>{html.escape(", ".join(e["items"]))}</b><br><code>{html.escape(code)}</code> · {html.escape(e["source"])}'
                    f'{" · distance " + str(e["dist"]) if "dist" in e else ""}<div class="alts">{alt_html}</div></div></section>')
    missing = [(c, e) for c, e in results.items() if e["status"] == "none"]
    miss_html = "".join(f'<li><code>{html.escape(c)}</code> {html.escape(", ".join(e["items"]))}</li>' for c, e in missing)
    skipped_has = [(c, e) for c, e in results.items() if e["status"] == "skipped" and e.get("libraryHas")]
    skipped_html = "".join(f'<li><code>{html.escape(c)}</code> {html.escape(", ".join(e["items"]))} (library: {html.escape(e["libraryHas"])})</li>' for c, e in skipped_has)
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Picture matches</title>
<style>body{{font:14px system-ui,sans-serif;margin:20px;color:#123}}h1{{font-size:20px}}.row{{display:flex;gap:14px;border-top:1px solid #dde;padding:10px 0;align-items:flex-start}}
.row.check{{background:#fff8e6}}.main img{{display:block;background:#f4f4f4;border-radius:8px}}.alts{{display:flex;gap:8px;margin-top:6px}}.alts figure{{margin:0;font-size:11px;color:#667}}
.alts img{{display:block;background:#f4f4f4;border-radius:6px}}code{{background:#eef;padding:1px 4px;border-radius:4px}}.info{{min-width:0}}</style></head><body>
<h1>Picture matches: {len(keep)} of {len(results)} part numbers have a picture</h1>
<p>Each row: the chosen picture, the part number and where it comes from ("library" = a file in the picture library folder, which always wins). Rows on a yellow background are catalogue matches farther from the part number on the page: check them first. Smaller pictures are the next candidates.
To correct one, put a better file in the library folder (same part number at the start of the name, newest season folder) or tell me the part number.</p>{''.join(rows)}
<h2>Set to "no picture" although the library has one ({len(skipped_has)})</h2><ul>{skipped_html}</ul>
<h2>No picture found ({len(missing)})</h2><ul>{miss_html}</ul></body></html>"""
    open(os.path.join(args.out, "contact-sheet.html"), "w", encoding="utf-8").write(page)
    count = lambda s: sum(1 for e in results.values() if e["status"] == s)
    real = sum(1 for e in results.values() if e["status"] == "library" and not e.get("fromCatalogue"))
    print(f"library {count('library')} ({real} real pictures, {count('library') - real} taken from catalogues), catalogue {count('matched')}, "
          f"overrides {count('override')}, skipped {count('skipped')}, none {len(missing)} of {len(results)} part numbers")
    print("contact sheet:", os.path.join(args.out, "contact-sheet.html"))


if __name__ == "__main__":
    sys.exit(main())
