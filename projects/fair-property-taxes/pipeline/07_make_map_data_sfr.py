"""
Slim the full single-family/condo estimate table down to just the columns
the live map needs, with cleaned-up street addresses.

The full table (pipeline/tmp/sf-citywide-sfr-full.csv, ~25MB) carries beds/
baths/lot-size/comp metadata that the map never renders; this script strips
it to the 8 columns actually used and cleans up addresses (drops the
Assessor's leading "0000" placeholder unit number and other zero-padding
artifacts), which shrinks the file by more than half.

Reads:  pipeline/tmp/sf-citywide-sfr-full.csv (03_process_sfr.py)
Writes: data/sf-map-data.csv (committed -- this is what index.html fetches)
"""
import csv
import re
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
DATA_DIR = PIPELINE_DIR.parent / "data"
SRC = TMP_DIR / "sf-citywide-sfr-full.csv"
OUT = DATA_DIR / "sf-map-data.csv"


def clean_addr(addr):
    parts = addr.split()
    if parts and parts[0] == "0000":
        parts = parts[1:]
    s = " ".join(parts)
    s = re.sub(r'(?<=[A-Za-z])0*\d{2,4}$', '', s)
    s = re.sub(r'\s+0000$', '', s)
    s = re.sub(r'^0+(?=\d)', '', s)
    return s.strip().title()


def main():
    rows = list(csv.DictReader(open(SRC)))
    print("input rows:", len(rows))

    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lat", "lon", "addr", "sqft", "assessed", "market", "subsidy", "change"])
        for r in rows:
            w.writerow([
                round(float(r["lat"]), 5), round(float(r["lon"]), 5),
                clean_addr(r["address"]),
                int(float(r["sqft"])),
                int(float(r["assessed_total"])),
                int(float(r["est_market_value"])),
                int(float(r["subsidy_vs_market_today"])),
                int(float(r["change_under_reform"])),
            ])

    print("wrote", OUT)


if __name__ == "__main__":
    main()
