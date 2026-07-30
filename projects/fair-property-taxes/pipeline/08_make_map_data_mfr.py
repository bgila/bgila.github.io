"""
Slim the full multi-family estimate table down to just the columns the live
map needs, with cleaned-up street addresses. Same idea as
07_make_map_data_sfr.py, but keeps the `units` and `comp_source` columns
that the multi-family map popup shows and the SFR one doesn't.

Reads:  pipeline/tmp/sf-multifamily-full.csv (06_process_mfr.py)
Writes: data/sf-map-data-mf.csv (committed -- this is what index.html fetches)
"""
import csv
import re
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
DATA_DIR = PIPELINE_DIR.parent / "data"
SRC = TMP_DIR / "sf-multifamily-full.csv"
OUT = DATA_DIR / "sf-map-data-mf.csv"


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
        w.writerow(["lat", "lon", "addr", "units", "sqft", "assessed", "market", "subsidy", "change", "source"])
        for r in rows:
            w.writerow([
                round(float(r["lat"]), 5), round(float(r["lon"]), 5),
                clean_addr(r["address"]),
                int(float(r["units"])) if r["units"] else 0,
                int(float(r["sqft"])),
                int(float(r["assessed_total"])),
                int(float(r["est_market_value"])),
                int(float(r["subsidy_vs_market_today"])),
                int(float(r["change_under_reform"])),
                r["comp_source"],
            ])

    print("wrote", OUT)


if __name__ == "__main__":
    main()
