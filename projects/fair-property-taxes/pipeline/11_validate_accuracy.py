"""
Leave-one-out accuracy check for the single-family/condo market-value model.

Since the estimator (03_process_sfr.py) relies on jump-confirmed comps, we
already have a clean way to check it: take every parcel with a
jump-confirmed sale specifically in 2024 or 2025 (i.e. whose true near-
market value is essentially known) and compare that true value against the
model's own est_market_value for that same parcel. This is the source of
the "~14% median error" figure quoted in the site's methodology section.

Reads:  pipeline/tmp/sfr_history_2020_2025.json  (02_fetch_sfr_history.py)
        pipeline/tmp/sf-citywide-sfr-full.csv    (03_process_sfr.py)
Writes: nothing -- prints the accuracy report to stdout
"""
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
HISTORY = TMP_DIR / "sfr_history_2020_2025.json"
SFR_FULL_CSV = TMP_DIR / "sf-citywide-sfr-full.csv"

JUMP_THRESHOLD = 1.08


def to_float(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def main():
    # rebuild the confirmed-jump set restricted to 2024/2025 specifically, as a holdout
    history = json.load(open(HISTORY))
    by_parcel_year = defaultdict(dict)
    for r in history:
        y = int(r["closed_roll_year"])
        total = (to_float(r.get("assessed_land_value"))
                 + to_float(r.get("assessed_improvement_value"))
                 + to_float(r.get("assessed_fixtures_value")))
        by_parcel_year[r["parcel_number"]][y] = {"total": total, "sale_date": r.get("current_sales_date")}

    confirmed_2024_2025 = {}
    for pn, years in by_parcel_year.items():
        for y in (2024, 2025):
            if y not in years or (y - 1) not in years:
                continue
            prev, cur = years[y - 1]["total"], years[y]["total"]
            if prev <= 0 or cur <= 0:
                continue
            ratio = cur / prev
            sale_date = years[y].get("sale_date")
            sale_near = bool(sale_date) and int(sale_date[:4]) in (y - 1, y)
            if sale_near and ratio >= JUMP_THRESHOLD:
                confirmed_2024_2025[pn] = cur  # true near-market value

    print("clean 2024/2025 confirmed-sale holdout set:", len(confirmed_2024_2025))

    rows = {r["parcel_number"]: r for r in csv.DictReader(open(SFR_FULL_CSV))}

    abs_errs, signed_errs = [], []
    for pn, truth in confirmed_2024_2025.items():
        r = rows.get(pn)
        if not r:
            continue
        est = float(r["est_market_value"])
        pct = (est - truth) / truth * 100
        signed_errs.append(pct)
        abs_errs.append(abs(pct))

    print("matched rows:", len(abs_errs))
    print("median signed % error:", round(statistics.median(signed_errs), 1))
    print("median ABS % error:", round(statistics.median(abs_errs), 1))
    print("mean ABS % error:", round(statistics.mean(abs_errs), 1))
    print("within 10%:", round(100 * sum(1 for e in abs_errs if e <= 10) / len(abs_errs), 1), "%")
    print("within 20%:", round(100 * sum(1 for e in abs_errs if e <= 20) / len(abs_errs), 1), "%")
    print("within 30%:", round(100 * sum(1 for e in abs_errs if e <= 30) / len(abs_errs), 1), "%")
    print("p90 abs % error:", round(sorted(abs_errs)[int(len(abs_errs) * 0.9)], 1))


if __name__ == "__main__":
    main()
