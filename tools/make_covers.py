r"""Make a cover image (first page) for every PDF in the Documents folder.

For each  <folder>\<name>.pdf  it writes  <folder>\<name>.cover.jpg  next to the PDF (about 420 px wide, 40-90 KB).
In the portal Admin page, Documents tab, pick that .cover.jpg as the cover when you add the catalog.
PDFs that already have an up-to-date cover are skipped. The PDFs themselves are never changed.

Usage:  python make_covers.py [folder]      (default: ..\..\Documents, i.e. "Sharable info\Documents")
"""
import sys
from pathlib import Path

try:
    import pymupdf as fitz  # PyMuPDF (older releases only have the name "fitz")
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None
if fitz is None:
    sys.exit("PyMuPDF is missing. Run make-covers.bat (it installs it), or:  python -m pip install --user pymupdf")

WIDTH = 420
HERE = Path(__file__).resolve().parent


def make_cover(pdf: Path) -> str:
    out = pdf.with_name(pdf.stem + ".cover.jpg")
    if out.exists() and out.stat().st_mtime >= pdf.stat().st_mtime:
        return "skipped (already done)"
    with fitz.open(pdf) as doc:
        if doc.page_count == 0:
            return "no pages"
        page = doc[0]
        zoom = WIDTH / page.rect.width
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        pix.save(out, jpg_quality=82)
    return f"ok ({out.stat().st_size // 1024} KB)"


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent.parent / "Documents"
    if not folder.is_dir():
        print(f"Folder not found: {folder}")
        return 1
    pdfs = sorted(p for p in folder.rglob("*.pdf") if not p.name.endswith(".cover.pdf"))
    if not pdfs:
        print(f"No PDF found in {folder}")
        return 0
    failed = 0
    for pdf in pdfs:
        try:
            result = make_cover(pdf)
        except Exception as e:  # a damaged or protected PDF must not stop the others
            result, failed = f"FAILED: {e}", failed + 1
        print(f"{pdf.relative_to(folder)}: {result}")
    print(f"\nDone: {len(pdfs)} PDF(s), {failed} problem(s). Covers are the .cover.jpg files next to the PDFs.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
