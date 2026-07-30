"""
Fetch the current (2025 closed-roll) snapshot of San Francisco multi-family
residential parcels (apartment buildings, flats, duplexes -- not condos,
which are covered by the single-family/condo pipeline) from the DataSF
Socrata API.

Reads:  nothing (hits the network)
Writes: pipeline/tmp/mfr_snapshot_raw.json

No API key required -- same open DataSF endpoint as the SFR fetch scripts.
Includes number_of_units, which an earlier draft of this fetch omitted.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
OUT_PATH = TMP_DIR / "mfr_snapshot_raw.json"

BASE_URL = "https://data.sfgov.org/resource/wv5m-vpq2.json"
FIELDS = (
    "property_location,parcel_number,number_of_units,property_area,lot_area,"
    "year_property_built,current_sales_date,assessed_land_value,"
    "assessed_improvement_value,assessed_fixtures_value,assessor_neighborhood,"
    "analysis_neighborhood,the_geom"
)
USE_DEFINITION = "Multi-Family Residential"
ROLL_YEAR = "2025"
PAGE_SIZE = 50000


def fetch_all(use_definition, roll_year, page_size):
    rows = []
    offset = 0
    while True:
        params = {
            "$select": FIELDS,
            "closed_roll_year": roll_year,
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
            raise RuntimeError(f"failed at offset {offset}")

        rows.extend(batch)
        print(f"  offset={offset} got={len(batch)} total={len(rows)}", file=sys.stderr)
        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(0.3)
    return rows


if __name__ == "__main__":
    TMP_DIR.mkdir(exist_ok=True)
    data = fetch_all(USE_DEFINITION, ROLL_YEAR, PAGE_SIZE)
    print("TOTAL:", len(data), file=sys.stderr)
    with open(OUT_PATH, "w") as f:
        json.dump(data, f)
    print("wrote", OUT_PATH, file=sys.stderr)
