"""Tests for the previous-season rebate calculations in export_stock.py.   Run:  python -m unittest tools/test_export_rebates.py
Values come from the check table in PREVIOUS-SEASON-REBATES.md (CAD, 2026-11-11)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_stock as ex  # noqa: E402

RULES = {"skitrab": [
    {"brand": "SkiTrab", "ageFrom": 0, "ageTo": 0, "retail": 0.0, "shop": 0.0},
    {"brand": "SkiTrab", "ageFrom": 1, "ageTo": 1, "retail": 0.30, "shop": 0.25},
    {"brand": "SkiTrab", "ageFrom": 2, "ageTo": 3, "retail": 0.40, "shop": 0.35},
    {"brand": "SkiTrab", "ageFrom": 4, "ageTo": 5, "retail": 0.50, "shop": 0.45},
    {"brand": "SkiTrab", "ageFrom": 6, "ageTo": 99, "retail": 0.70, "shop": 0.60}]}


def line(row, to_season, retail=None, dealer=None):
    return {"_row": row, "ToSeason": to_season, "RetailCAD": retail, "DealerCAD": dealer, "Size": "x"}


class Rebates(unittest.TestCase):
    def test_rule_lookup_by_brand_and_age(self):
        self.assertEqual(ex.rebate_for(RULES, "Ski Trab", 1, "shop"), 0.25)       # brand names ignore case and spaces
        self.assertEqual(ex.rebate_for(RULES, "SKITRAB", 3, "retail"), 0.40)
        self.assertEqual(ex.rebate_for(RULES, "SkiTrab", 12, "shop"), 0.60)       # "6 and more" is stored as 99
        self.assertEqual(ex.rebate_for(RULES, "SkiTrab", 0, "shop"), 0.0)
        self.assertIsNone(ex.rebate_for(RULES, "VillaCampa", 2, "shop"))           # a brand without rows: no rebate
        self.assertIsNone(ex.rebate_for({"skitrab": RULES["skitrab"][:2]}, "SkiTrab", 5, "shop"))   # no matching age band

    def test_percentages_typed_as_whole_numbers(self):
        self.assertEqual(ex.as_fraction(0.3), 0.3)
        self.assertEqual(ex.as_fraction(30), 0.3)
        self.assertEqual(ex.as_fraction(None), 0.0)

    def test_guide_check_values(self):
        # Neve 174, age 3: retail 1,099.90 -> 659.94 (-40 %), shop 634.375 -> 412.34 (-35 %)
        shop = ex.rebate_entry(634.375, 0.35, 1099.90, 0.40)
        self.assertEqual((shop["p"], shop["b"], shop["pct"], shop["m"], shop["mb"]), (412.34, 634.38, 35, 659.94, 1099.9))
        retail = ex.rebate_entry(1099.90, 0.40)
        self.assertEqual((retail["p"], retail["b"], retail["pct"]), (659.94, 1099.9, 40))
        # Gara 155, age 4
        self.assertEqual(ex.rebate_entry(598.05, 0.45)["p"], 328.93)
        self.assertEqual(ex.rebate_entry(1049.90, 0.50)["p"], 524.95)
        # tracksuit, age 1: half-up rounding of the exact half cent (the workbook's VBA rounds to even and shows 223.96 for retail)
        self.assertEqual(ex.rebate_entry(159.975, 0.25)["p"], 119.98)
        self.assertEqual(ex.rebate_entry(319.95, 0.30)["p"], 223.97)

    def test_no_rebate_keeps_the_plain_format(self):
        e = ex.rebate_entry(874.47, 0.0, 1649.95, 0.0)
        self.assertEqual(e, {"p": 874.47, "m": 1649.95})

    def test_estimate_flag_follows_the_base_price(self):
        self.assertTrue(ex.rebate_entry(100.99, 0.30).get("est"))
        self.assertNotIn("est", ex.rebate_entry(100.95, 0.30))

    def test_latest_price_line(self):
        cur = 26
        a = line(1, 23, 40, 20)
        b = line(2, 25, 45, 22)
        c = line(3, 25, 46, 23)                                    # same season as b: the line lower in the sheet wins
        open_line = line(4, 50, 50, 25)                            # ToSeason 50 counts as the current season
        none_priced = line(5, 25, None, None)
        inactive = line(6, None, 99, 99)                           # no ToSeason: ignored
        self.assertIs(ex.latest_price_line([a, b], [], "RetailCAD", cur), b)
        self.assertIs(ex.latest_price_line([a, b, c], [], "RetailCAD", cur), c)
        self.assertIs(ex.latest_price_line([a, b, c, open_line], [], "RetailCAD", cur), open_line)
        self.assertIs(ex.latest_price_line([a, none_priced, inactive], [], "RetailCAD", cur), a)
        self.assertIsNone(ex.latest_price_line([none_priced, inactive], [], "RetailCAD", cur))
        self.assertIs(ex.latest_price_line([none_priced], [a, b], "DealerCAD", cur), b)    # barcode first, then the part number
        self.assertIs(ex.latest_price_line([a], [b], "DealerCAD", cur), a)

    def test_part_number_lookup_takes_the_same_size_only(self):
        # a 115 mm roll must never get the 85 mm price of the same part number (21108B)
        def roll(row, size, usd):
            return {"_row": row, "ToSeason": 50, "DealerUSD": usd, "Size": size}
        r85, r100, r115 = roll(1, "85", 17.99), roll(2, "100", 19.99), roll(3, "115", None)
        part_lines = [r85, r100, r115]
        self.assertIsNone(ex.latest_price_line([r115], part_lines, "DealerUSD", 26, "115"))        # no 115 mm USD price: none, not 85 mm's
        self.assertIs(ex.latest_price_line([], part_lines, "DealerUSD", 26, "100"), r100)
        self.assertIs(ex.latest_price_line([], part_lines, "DealerUSD", 26, "85.0"), r85)          # 85.0 and 85 are the same size
        self.assertIs(ex.latest_price_line([r115], part_lines, "DealerUSD", 26), r100)             # size None: no check (old behaviour)
        na = {"_row": 4, "ToSeason": 50, "DealerUSD": 5.0, "Size": "N/A"}
        self.assertIs(ex.latest_price_line([], [na, r85], "DealerUSD", 26, ""), na)                # no size and N/A are the same
        self.assertEqual((ex.size_key(" 115 "), ex.size_key("N/A"), ex.size_key(None), ex.size_key("S")), ("115", "", "", "s"))

    def test_exceptions_cover_part_number_and_every_sku_under_it(self):
        by_ean = {"805A": [{"PartNo": "22048"}], "805B": [{"PartNo": "22048N"}, {"PartNo": "22048"}],
                  "805C": [{"PartNo": "99999"}], "805D": [{"PartNo": "40265"}]}
        self.assertEqual(ex.exception_skus({"22048", "805d"}, by_ean), {"805A", "805B", "805D"})   # part numbers and SKUs, any case
        self.assertEqual(ex.exception_skus(set(), by_ean), set())


if __name__ == "__main__":
    unittest.main()
