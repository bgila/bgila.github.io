"""
Fetch the current (2025 closed-roll) snapshot of San Francisco single-family
residential parcels from the DataSF Socrata API.

This is the "Assessor Historical Secured Property Tax Rolls" dataset
(resource id wv5m-vpq2), filtered to use_definition="Single Family
Residential" (which also includes individually-deeded condos) and
closed_roll_year=2025. It gives us, per parcel: location/geometry,
beds/baths/sqft/lot size, year built, last sale date, assessed
land/improvement/fixtures values, and neighborhood.

Reads:  nothing (hits the network)
Writes: pipeline/tmp/sfr_snapshot_raw.json

No API key required -- DataSF's Socrata endpoints are open to the public,
just rate-limited, hence the small per-page delay and retry loop below.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
OUT_PATH = TMP_DIR / "sfr_snapshot_raw.json"

BASE_URL = "https://data.sfgov.org/resource/wv5m-vpq2.json"
FIELDS = (
    "property_location,parcel_number,number_of_bedrooms,number_of_bathrooms,"
    "property_area,lot_area,year_property_built,current_sales_date,"
    "assessed_land_value,assessed_improvement_value,assessed_fixtures_value,"
    "assessor_neighborhood,analysis_neighborhood,the_geom"
)
USE_DEFINITION = "Single Family Residential"
ROLL_YEAR = "2025"
PAGE_SIZE = 50000


def fetch_all(use_definition, roll_year, page_size, out_path):
    """Page through the Socrata API and return all matching rows, checkpointing
    to out_path after every page so a mid-run failure doesn't lose progress."""
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
            raise RuntimeError(f"failed to fetch page at offset {offset}")

        rows.extend(batch)
        print(f"  offset={offset} got={len(batch)} total_so_far={len(rows)}", file=sys.stderr)
        with open(out_path, "w") as f:
            json.dump(rows, f)

        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(0.3)
    return rows


if __name__ == "__main__":
    TMP_DIR.mkdir(exist_ok=True)
    print(f"fetching {USE_DEFINITION!r} parcels for closed_roll_year={ROLL_YEAR}...", file=sys.stderr)
    data = fetch_all(USE_DEFINITION, ROLL_YEAR, PAGE_SIZE, OUT_PATH)
    print(f"DONE. total rows: {len(data)} -> {OUT_PATH}", file=sys.stderr)
