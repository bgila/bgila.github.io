# Data pipeline for oneratecalifornia.org (SF property-tax map)

This backs a map that argues San Francisco's property tax system unfairly
subsidizes long-held homes over recently-purchased ones (a side effect of
Prop 13's assessed-value caps), by estimating each parcel's *current market
value* and comparing the tax it would owe under that value to the tax it
actually pays. There is no official, public, bulk sale-price dataset for SF
real estate to pull market value from directly, so this pipeline infers it
from DataSF's public assessor roll: it detects years in which a parcel's
assessed value jumped far more than Prop 13's ~2%/yr inflation cap allows,
cross-checks that jump against a recorded sale date nearby in time, and
treats the resulting post-jump assessed value as a real price signal
("jump-confirmed comp"). Nearby jump-confirmed comps are then used to
estimate market value for every other parcel. Street geometry for the map's
basemap comes from OpenStreetMap via the Overpass API.

## Requirements

```
pip install -r requirements.txt
```

Only non-stdlib dependency across all 11 scripts: **numpy**. No API keys
are needed anywhere in this pipeline -- DataSF's Socrata endpoints and the
Overpass API are both open to the public (rate-limited, not key-gated).

## Running the pipeline

Run from inside this `pipeline/` directory, in order:

```
python3 01_fetch_sfr_snapshot.py
python3 02_fetch_sfr_history.py
python3 03_process_sfr.py
python3 04_fetch_mfr_snapshot.py
python3 05_fetch_mfr_history.py
python3 06_process_mfr.py
python3 07_make_map_data_sfr.py
python3 08_make_map_data_mfr.py
python3 09_build_neighborhoods.py
python3 10_build_streets.py
python3 11_validate_accuracy.py
```

The full run touches the DataSF API for ~250MB of parcel/history JSON and
the Overpass API for OSM road geometry -- expect it to take on the order of
15-30 minutes depending on network conditions and Overpass's public-server
load.

Raw fetches and full (non-slim) intermediate CSVs are written to
`pipeline/tmp/`, which is gitignored -- nothing in there is committed. Only
the four small artifacts the live page actually fetches are written to
`../data/` and committed:

- `data/sf-map-data.csv`
- `data/sf-map-data-mf.csv`
- `data/sf-neighborhoods.json`
- `data/sf-streets.json`

### Dependency graph -- what reads what

| Script | Reads | Writes |
|---|---|---|
| `01_fetch_sfr_snapshot.py` | network (DataSF) | `tmp/sfr_snapshot_raw.json` |
| `02_fetch_sfr_history.py` | network (DataSF) | `tmp/sfr_history_2020_2025.json` |
| `03_process_sfr.py` | `tmp/sfr_snapshot_raw.json`, `tmp/sfr_history_2020_2025.json` | `tmp/sf-citywide-sfr-full.csv`, `tmp/sf-citywide-summary.json` |
| `04_fetch_mfr_snapshot.py` | network (DataSF) | `tmp/mfr_snapshot_raw.json` |
| `05_fetch_mfr_history.py` | network (DataSF) | `tmp/mfr_history_2020_2025.json` |
| `06_process_mfr.py` | `tmp/mfr_snapshot_raw.json`, `tmp/mfr_history_2020_2025.json`, `tmp/sf-citywide-sfr-full.csv` (for neighborhood centroids) | `tmp/sf-multifamily-full.csv`, `tmp/sf-multifamily-summary.json` |
| `07_make_map_data_sfr.py` | `tmp/sf-citywide-sfr-full.csv` | `../data/sf-map-data.csv` |
| `08_make_map_data_mfr.py` | `tmp/sf-multifamily-full.csv` | `../data/sf-map-data-mf.csv` |
| `09_build_neighborhoods.py` | `tmp/sf-citywide-sfr-full.csv` | `../data/sf-neighborhoods.json` |
| `10_build_streets.py` | network (Overpass) | `tmp/major_roads_raw.json`, `tmp/minor_roads_raw.json`, `../data/sf-streets.json` |
| `11_validate_accuracy.py` | `tmp/sfr_history_2020_2025.json`, `tmp/sf-citywide-sfr-full.csv` | stdout only |

Because `06_process_mfr.py` derives its neighborhood centroids from the
single-family CSV rather than a separate file, it must run after
`03_process_sfr.py` (as reflected in the numbering). `10_build_streets.py`
is fully independent of the parcel data and can run any time.

## Methodology at a glance

**Single-family / condo** (`03_process_sfr.py`, 155,059 parcels, 92
neighborhoods, 16,614 jump-confirmed comps, 153,756 rows estimated):

- Comp detection: assessed value jump of >=8% year-over-year (`JUMP_THRESHOLD
  = 1.08`), confirmed by a recorded sale date within a year of the jump.
- Estimate: median $/sqft of the 7 nearest jump-confirmed comps (`K = 7`),
  preferring same-neighborhood comps if the neighborhood has 12+
  (`MIN_COMPS_FOR_LOCAL_GROUP`), else falling back to citywide nearest-K.
- Subsidy distribution (current law, market value vs. actual assessed
  value, `$/year` at 1.00% general + 0.18% SF bond rate): p10 -$1,845,
  median $6,468, mean $7,757, p90 $19,292, p99 $40,557.
- Under the modeled reform (0.65% general + 0.18% bond rate applied to
  market value instead of assessed value): 57.8% of homes (88,896) would
  pay more, 42.2% (64,860) would pay less.

**Multi-family** (`06_process_mfr.py`, 35,216 parcels, 2,184 jump-confirmed
sales, 2,096 comps survive outlier filtering, 35,210 rows estimated,
6 skipped for lack of any neighborhood data):

- Same >=8%/yr jump test, but averaged into one $/sqft per neighborhood
  (`MIN_COMPS_FOR_NB = 5` qualifying sales required) rather than nearest-K,
  since multi-family sales are far less frequent. Neighborhoods below that
  threshold pool comps from the 5 nearest neighborhoods by centroid
  distance (`FALLBACK_K_NEIGHBORHOODS = 5`) instead.
- This is a building-level estimate (not per-unit).
- Subsidy distribution: median $14,879, mean $22,935, p90 $47,764.
- Under the modeled reform: 24,534 buildings would pay more, 10,676 less.

**Validation** (`11_validate_accuracy.py`): parcels with a jump-confirmed
sale specifically in 2024 or 2025 have an essentially-known true value, so
comparing the model's own `est_market_value` for those same parcels against
that truth is a clean leave-one-out accuracy check (3,983 such parcels,
3,967 matched against the estimate table):

- Median signed error: **+4.5%** (slight overestimate on average)
- Median absolute error: **14.4%**
- Mean absolute error: 21.8%
- Within 10% of true value: 36.9%
- Within 20% of true value: 64.1%
- Within 30% of true value: 79.6%
- p90 absolute error: 45.1%

These are the numbers referenced by the "~14% median error" line in the
site's own methodology section.
