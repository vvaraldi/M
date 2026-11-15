"""Tests for the picture library helpers (python test_pictures_library.py)."""
import os
import sys
import tempfile
import unittest

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_pictures as ep  # noqa: E402
import import_pictures as ip   # noqa: E402


def make_jpg(path, w, h):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    pix.clear_with(200)
    pix.save(path)


class Library(unittest.TestCase):
    def test_part_number_is_the_start_of_the_name(self):
        for name, part in [("13205_0_2.JPG", "13205"), ("40237R_1_2.JPG", "40237R"), ("13214 GARA SPEED.jpg", "13214"),
                           ("36043 AERO PRO (catalogue).jpg", "36043"), ("pr-b02.jpg", "PR")]:
            self.assertEqual(ip.part_of(name), part)
        self.assertEqual(ip.part_of("_x.jpg"), "")

    def test_names_are_made_safe(self):
        self.assertEqual(ip.clean_name('GLASS STRAP/ATTIVO  "HELMET"'), "GLASS STRAP ATTIVO HELMET")
        self.assertEqual(ep.file_name_part("A: B*C"), "A B C")

    def test_season_follows_the_catalogue_year(self):
        self.assertEqual(ep.season_of_catalogue("CATALOGUE_ALP_2026.pdf"), "2026-27")
        self.assertEqual(ep.season_of_catalogue("2022-23 --- Skitrab - catalogue.pdf"), "2022-23")
        self.assertIsNone(ep.season_of_catalogue("unknown.pdf"))

    def test_scan_library_priority(self):
        with tempfile.TemporaryDirectory() as root:
            make_jpg(os.path.join(root, "Skitrab", "2026-27", "13214 GARA SPEED (catalogue).jpg"), 100, 100)   # newest season but taken from a catalogue
            make_jpg(os.path.join(root, "Skitrab", "2025-26", "13214 GARA SPEED.jpg"), 50, 50)                  # real picture, older season: wins
            make_jpg(os.path.join(root, "Skitrab", "2025-26", "40237R_1_2.JPG"), 60, 60)
            make_jpg(os.path.join(root, "Skitrab", "2026-27", "40237R TITAN.jpg"), 40, 40)                      # real, newer season: wins over the 2025-26 one
            make_jpg(os.path.join(root, "Skitrab", "2026-27", "36043_1.jpg"), 30, 30)
            make_jpg(os.path.join(root, "Skitrab", "2026-27", "36043 AERO PRO.jpg"), 80, 80)                    # same season: the larger wins
            make_jpg(os.path.join(root, "Villa Campa", "2026-27", "99001.jpg"), 10, 10)
            os.makedirs(os.path.join(root, "Skitrab", "notaseason"))
            lib, folders = ep.scan_library(root)
            sk = lib["skitrab"]
            self.assertTrue(sk["13214"]["file"].endswith(os.path.join("2025-26", "13214 GARA SPEED.jpg")))
            self.assertEqual(sk["40237R"]["season"], "2026-27")
            self.assertTrue(sk["36043"]["file"].endswith("36043 AERO PRO.jpg"))
            self.assertIn("99001", lib["villacampa"])                      # brand folder names become brand keys
            self.assertEqual(folders["villacampa"], "Villa Campa")
        self.assertEqual(ep.scan_library(os.path.join(tempfile.gettempdir(), "no-such-folder-xyz")), ({}, {}))


if __name__ == "__main__":
    unittest.main()
