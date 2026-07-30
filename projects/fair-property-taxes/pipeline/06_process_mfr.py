"""
Build market-value estimates for every SF multi-family residential building
(apartment buildings, flats, duplexes -- not condos, which are covered by
the single-family/condo pipeline).

Same jump-confirmed-comp philosophy as 03_process_sfr.py (Prop 13 caps
ordinary inflation at ~2%/yr, so a >=8% year-over-year assessed-value jump
paired with a recorded sale within a year is treated as a confirmed market
reset). But multi-family sales are much less frequent than single-family
ones, so instead of finding individual nearest comps per building, this
script:

1. Averages jump-confirmed $/sqft into one figure per neighborhood (after
   dropping outliers more than 3.5x or less than 0.3x the neighborhood's
   own median $/sqft).
2. Falls back to a $/sqft average pooled from the 5 nearest neighborhoods
   (by centroid distance) for any neighborhood with fewer than 5 qualifying
   sales.
3. Estimates a building's market value as neighborhood (or pooled-nearby)
   avg $/sqft x the building's total sqft. This is a building-level, not
   per-unit, estimate.

Neighborhood centroids for the "5 nearest neighborhoods" fallback are
computed here directly from the single-family dataset (mean lat/lon of all
SFR parcels per neighborhood) -- both datasets share the same
assessor_neighborhood universe, and single-family parcels are numerous
enough per neighborhood to give a stable centroid.

Reads:  pipeline/tmp/mfr_snapshot_raw.json       (04_fetch_mfr_snapshot.py)
        pipeline/tmp/mfr_history_2020_2025.json  (05_fetch_mfr_history.py)
        pipeline/tmp/sf-citywide-sfr-full.csv    (03_process_sfr.py, for centroids)
Writes: pipeline/tmp/sf-multifamily-full.csv      (full per-building estimate table)
        pipeline/tmp/sf-multifamily-summary.json  (methodology + summary stats)
"""
import csv
import datetime
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
RAW_SNAPSHOT = TMP_DIR / "mfr_snapshot_raw.json"
HISTORY = TMP_DIR / "mfr_history_2020_2025.json"
SFR_FULL_CSV = TMP_DIR / "sf-citywide-sfr-full.csv"  # used only to derive neighborhood centroids
OUT_CSV = TMP_DIR / "sf-multifamily-full.csv"
OUT_SUMMARY = TMP_DIR / "sf-multifamily-summary.json"

JUMP_THRESHOLD = 1.08
MIN_COMPS_FOR_NB = 5  # few sales overall citywide -- use a per-neighborhood average, not nearest-K
FALLBACK_K_NEIGHBORHOODS = 5
GENERAL_RATE_CURRENT = 1.00
BOND_RATE_SF = 0.18
GENERAL_RATE_PROPOSED = 0.65

LAT0 = 37.7749
COS_LAT0 = math.cos(math.radians(LAT0))


def project(lat, lon):
    return ((lon + 122.4194) * COS_LAT0, -(lat - LAT0))


def to_float(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def load_neighborhood_centroids(sfr_full_csv_path):
    """Mean lat/lon of all SFR parcels in each neighborhood."""
    lats = defaultdict(list)
    lons = defaultdict(list)
    with open(sfr_full_csv_path) as f:
        for row in csv.DictReader(f):
            lats[row["neighborhood"]].append(float(row["lat"]))
            lons[row["neighborhood"]].append(float(row["lon"]))
    return {
        nb: (statistics.mean(lats[nb]), statistics.mean(lons[nb]))
        for nb in lats
    }


def main():
    print("loading 2025 multi-family snapshot...", file=sys.stderr)
    raw = json.load(open(RAW_SNAPSHOT))

    parcels = {}
    for r in raw:
        geom = r.get("the_geom")
        if not geom or geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"]
        area = to_float(r.get("property_area"))
        if area <= 200:  # sanity guard: exclude missing/placeholder sqft only
            continue
        land = to_float(r.get("assessed_land_value"))
        impr = to_float(r.get("assessed_improvement_value"))
        fix = to_float(r.get("assessed_fixtures_value"))
        assessed_total = land + impr + fix
        if assessed_total <= 0:
            continue
        sale_date = r.get("current_sales_date")
        pn = r.get("parcel_number")
        parcels[pn] = {
            "parcel_number": pn,
            "address": " ".join((r.get("property_location") or "").split()),
            "neighborhood": r.get("assessor_neighborhood") or "Unknown",
            "lat": lat, "lon": lon,
            "units": to_float(r.get("number_of_units")),
            "sqft": area,
            "year_built": r.get("year_property_built"),
            "sale_date": sale_date[:10] if sale_date else None,
            "assessed_total": assessed_total,
        }
    print("usable multi-family parcels:", len(parcels), file=sys.stderr)

    print("loading multi-year history...", file=sys.stderr)
    history = json.load(open(HISTORY))
    by_parcel_year = defaultdict(dict)
    for r in history:
        y = int(r["closed_roll_year"])
        total = (to_float(r.get("assessed_land_value"))
                 + to_float(r.get("assessed_improvement_value"))
                 + to_float(r.get("assessed_fixtures_value")))
        by_parcel_year[r["parcel_number"]][y] = {"total": total, "sale_date": r.get("current_sales_date")}

    confirmed = {}
    for pn, years in by_parcel_year.items():
        best = None
        for y in range(2021, 2026):
            if y not in years or (y - 1) not in years:
                continue
            prev, cur = years[y - 1]["total"], years[y]["total"]
            if prev <= 0 or cur <= 0:
                continue
            ratio = cur / prev
            sale_date = years[y].get("sale_date")
            sale_near = bool(sale_date) and int(sale_date[:4]) in (y - 1, y)
            if sale_near and ratio >= JUMP_THRESHOLD:
                if best is None or y > best[0]:
                    best = (y, cur)
        if best:
            confirmed[pn] = {"year": best[0], "total": best[1]}
    print("jump-confirmed multi-family sales:", len(confirmed), file=sys.stderr)

    # attach comps with price/sqft, filter non-arms-length noise same as SFR pipeline
    raw_comps = []
    for pn, info in confirmed.items():
        p = parcels.get(pn)
        if not p:
            continue
        psf = info["total"] / p["sqft"]
        raw_comps.append({"neighborhood": p["neighborhood"], "lat": p["lat"], "lon": p["lon"], "psf": psf})

    comps_by_nb_raw = defaultdict(list)
    for c in raw_comps:
        comps_by_nb_raw[c["neighborhood"]].append(c)

    comps_by_nb = {}
    dropped = 0
    for nb, lst in comps_by_nb_raw.items():
        med = statistics.median(c["psf"] for c in lst)
        lo, hi = med * 0.3, med * 3.5
        kept = [c for c in lst if lo <= c["psf"] <= hi]
        dropped += len(lst) - len(kept)
        if kept:
            comps_by_nb[nb] = kept
    print("comps after outlier filter:", sum(len(v) for v in comps_by_nb.values()), "dropped:", dropped, file=sys.stderr)
    print("neighborhoods with >=", MIN_COMPS_FOR_NB, "comps:",
          sum(1 for v in comps_by_nb.values() if len(v) >= MIN_COMPS_FOR_NB), "of", len(comps_by_nb), file=sys.stderr)

    nb_avg_psf = {nb: statistics.mean(c["psf"] for c in lst) for nb, lst in comps_by_nb.items()}
    nb_comp_count = {nb: len(lst) for nb, lst in comps_by_nb.items()}

    print("computing neighborhood centroids from SFR data...", file=sys.stderr)
    centroids = load_neighborhood_centroids(SFR_FULL_CSV)
    nb_proj = {name: project(lat, lon) for name, (lat, lon) in centroids.items()}

    def nearest_k_neighborhoods(nb_name, k):
        if nb_name not in nb_proj:
            return []
        x0, y0 = nb_proj[nb_name]
        dists = []
        for name, (x, y) in nb_proj.items():
            if name == nb_name:
                continue
            d = (x - x0) ** 2 + (y - y0) ** 2
            dists.append((d, name))
        dists.sort(key=lambda t: t[0])
        return [name for _, name in dists[:k]]

    def estimate_psf_for(nb_name):
        if nb_name in comps_by_nb and len(comps_by_nb[nb_name]) >= MIN_COMPS_FOR_NB:
            return nb_avg_psf[nb_name], nb_comp_count[nb_name], "same_neighborhood"
        # fallback: pool comps from 5 nearest neighborhoods (by centroid distance)
        nearest = nearest_k_neighborhoods(nb_name, FALLBACK_K_NEIGHBORHOODS)
        pooled = []
        for n in nearest:
            pooled.extend(comps_by_nb.get(n, []))
        # include the neighborhood's own thin comp set too, if any
        pooled.extend(comps_by_nb.get(nb_name, []))
        if not pooled:
            return None, 0, "no_data"
        return statistics.mean(c["psf"] for c in pooled), len(pooled), "5_nearest_neighborhoods"

    subsidy_all = []
    increases = decreases = 0
    no_estimate = 0

    fieldnames = [
        "parcel_number", "address", "neighborhood", "lat", "lon", "units", "sqft", "year_built",
        "last_sale_date", "assessed_total", "est_market_value", "est_price_per_sqft",
        "comp_count", "comp_source", "current_tax_est", "subsidy_vs_market_today",
        "tax_under_reform_est", "change_under_reform",
    ]

    with open(OUT_CSV, "w", newline="") as fcsv:
        writer = csv.DictWriter(fcsv, fieldnames=fieldnames)
        writer.writeheader()
        rows_batch = []
        nb_cache = {}
        for p in parcels.values():
            nb = p["neighborhood"]
            if nb not in nb_cache:
                nb_cache[nb] = estimate_psf_for(nb)
            psf, n_comps, source = nb_cache[nb]
            if psf is None:
                no_estimate += 1
                continue
            est_market_value = psf * p["sqft"]
            current_tax = p["assessed_total"] * (GENERAL_RATE_CURRENT + BOND_RATE_SF) / 100
            market_tax_current_law = est_market_value * (GENERAL_RATE_CURRENT + BOND_RATE_SF) / 100
            reform_tax = est_market_value * (GENERAL_RATE_PROPOSED + BOND_RATE_SF) / 100
            subsidy = market_tax_current_law - current_tax
            change = reform_tax - current_tax
            subsidy_all.append(subsidy)
            if change > 0:
                increases += 1
            elif change < 0:
                decreases += 1
            rows_batch.append({
                "parcel_number": p["parcel_number"], "address": p["address"], "neighborhood": nb,
                "lat": round(p["lat"], 6), "lon": round(p["lon"], 6),
                "units": p["units"], "sqft": p["sqft"], "year_built": p["year_built"],
                "last_sale_date": p["sale_date"] or "",
                "assessed_total": round(p["assessed_total"]), "est_market_value": round(est_market_value),
                "est_price_per_sqft": round(psf, 2), "comp_count": n_comps, "comp_source": source,
                "current_tax_est": round(current_tax), "subsidy_vs_market_today": round(subsidy),
                "tax_under_reform_est": round(reform_tax), "change_under_reform": round(change),
            })
        writer.writerows(rows_batch)
        rows_written = len(rows_batch)

    print("wrote", rows_written, "rows, skipped (no neighborhood data at all):", no_estimate, file=sys.stderr)

    summary = {
        "methodology": {
            "scope": "Citywide, Multi-Family Residential (actual rental/apartment buildings -- flats, duplexes, apartment buildings; NOT condos, which are already in the single-family/condo dataset)",
            "market_value_estimation": (
                "Building-level (not per-unit) estimate. Confirmed jump-sales (same >=8%/yr assessed-value-jump "
                "test as the single-family dataset, cross-checked against a recorded sale within a year) are "
                "averaged into a single $/sqft figure per neighborhood, rather than using individual nearest "
                "comps -- multi-family sales are far less frequent, so a per-neighborhood average is more stable "
                f"than trying to find individual nearby comps. Neighborhoods with fewer than {MIN_COMPS_FOR_NB} "
                f"qualifying sales fall back to a $/sqft average pooled from the {FALLBACK_K_NEIGHBORHOODS} "
                "nearest neighborhoods (by centroid distance) instead. Estimate = neighborhood (or pooled-nearby) "
                "avg $/sqft x building's total sqft."
            ),
            "caveats": (
                "This is a rougher estimate than the single-family/condo model: it values the whole building at "
                "once, not individual units, and rests on fewer confirmed sales. It says nothing about individual "
                "tenants' rents -- only about the building owner's assessed-vs-market tax gap."
            ),
            "tax_assumptions": {
                "current_general_rate_pct": GENERAL_RATE_CURRENT,
                "sf_bond_rate_pct": BOND_RATE_SF,
                "proposed_general_rate_pct": GENERAL_RATE_PROPOSED,
            },
            "generated": datetime.date.today().isoformat(),
        },
        "counts": {
            "total_parcels": len(parcels),
            "jump_confirmed_sales": len(confirmed),
            "comps_after_filter": sum(len(v) for v in comps_by_nb.values()),
            "estimated_rows_written": rows_written,
            "skipped_no_data": no_estimate,
        },
        "stats": {
            "subsidy_vs_market_today": {
                "median": round(statistics.median(subsidy_all)) if subsidy_all else None,
                "mean": round(statistics.mean(subsidy_all)) if subsidy_all else None,
                "p90": round(np.percentile(subsidy_all, 90)) if subsidy_all else None,
                "min": round(min(subsidy_all)) if subsidy_all else None,
                "max": round(max(subsidy_all)) if subsidy_all else None,
            },
            "under_reform": {
                "would_pay_more": increases, "would_pay_less": decreases,
            } if rows_written else {},
        },
    }
    with open(OUT_SUMMARY, "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
