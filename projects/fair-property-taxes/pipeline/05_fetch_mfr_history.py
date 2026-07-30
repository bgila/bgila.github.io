"""
Fetch multi-year (2020-2025) assessed-value history for San Francisco
multi-family residential parcels from the DataSF Socrata API.

Same jump-detection purpose as 02_fetch_sfr_history.py, but for the
multi-family building dataset used by 06_process_mfr.py.

Reads:  nothing (hits the network)
Writes: pipeline/tmp/mfr_history_2020_2025.json

No API key required.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
OUT_PATH = TMP_DIR / "mfr_history_2020_2025.json"

BASE_URL = "https://data.sfgov.org/resource/wv5m-vpq2.json"
FIELDS = (
    "parcel_number,closed_roll_year,assessed_land_value,assessed_improvement_value,"
    "assessed_fixtures_value,property_area,current_sales_date"
)
USE_DEFINITION = "Multi-Family Residential"
YEARS = range(2020, 2026)
PAGE_SIZE = 50000


def fetch_year(year, use_definition, page_size):
    rows = []
    offset = 0
    while True:
        params = {
            "$select": FIELDS,
            "closed_roll_year": str(year),
            "use_definition": use_definition,
            "$limit": page_size,
            "$offset": offset,
        }
        url = BASE_URL + "?" + urllib.parse.urlencode(params)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    batch = json.loads(resp.read())
                break
            except Exception as e:
                print(f"  retry {attempt} after error: {e}", file=sys.stderr)
                time.sleep(2)
        else:
            raise RuntimeError(f"failed at year={year} offset={offset}")

        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(0.2)
    return rows


if __name__ == "__main__":
    TMP_DIR.mkdir(exist_ok=True)
    all_rows = []
    for year in YEARS:
        year_rows = fetch_year(year, USE_DEFINITION, PAGE_SIZE)
        print(f"year {year}: {len(year_rows)} rows", file=sys.stderr)
        all_rows.extend(year_rows)
        with open(OUT_PATH, "w") as f:
            json.dump(all_rows, f)
    print(f"TOTAL: {len(all_rows)} -> {OUT_PATH}", file=sys.stderr)
