"""
Fetch San Francisco road geometry from OpenStreetMap (via the Overpass API)
and build the simplified street-line + label data the live map draws under
the parcel markers.

Two road tiers are fetched separately so they can be simplified and styled
differently (major roads drawn heavier / labeled more sparsely than minor
ones):
  - major: highway in {motorway, trunk, primary}
  - minor: highway in {secondary, tertiary, residential, unclassified}

Each tier's line geometry is simplified with Ramer-Douglas-Peucker (RDP) to
cut point count while preserving shape, then named ways are used to place
street-name labels: for each street name, take its longest segments first
and drop any candidate label whose midpoint falls within `min_spacing` of
an already-placed label for that name, so a long street gets a handful of
readable labels instead of one per OSM way segment.

Reads:  nothing (hits the network; no API key needed, Overpass is open)
Writes: pipeline/tmp/major_roads_raw.json  (raw Overpass response, major tier)
        pipeline/tmp/minor_roads_raw.json  (raw Overpass response, minor tier)
        data/sf-streets.json (committed -- fetched by index.html), containing:
          "major"/"minor":            simplified [[x,y],...] polylines per way,
                                       in the same projected coordinate space
                                       used elsewhere in the pipeline
          "labelsMajor"/"labelsMinor": [{x,y,a,n}] label placements (position,
                                       angle in radians, street name)

Note: OSM data changes over time, so re-running this against the live
Overpass API may return a slightly different road/label set than what is
currently committed -- that's expected and fine.
"""
import json
import math
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
DATA_DIR = PIPELINE_DIR.parent / "data"
MAJOR_RAW_PATH = TMP_DIR / "major_roads_raw.json"
MINOR_RAW_PATH = TMP_DIR / "minor_roads_raw.json"
OUT_PATH = DATA_DIR / "sf-streets.json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Bounding box roughly covering San Francisco city limits plus a small buffer.
SF_BBOX = (37.70, -122.52, 37.835, -122.35)  # (min_lat, min_lon, max_lat, max_lon)
MAJOR_HIGHWAY_TAGS = "motorway|trunk|primary"
MINOR_HIGHWAY_TAGS = "secondary|tertiary|residential|unclassified"

LAT0 = 37.7749
COS_LAT0 = math.cos(math.radians(LAT0))


def project(lat, lon):
    return ((lon + 122.4194) * COS_LAT0, -(lat - LAT0))


def overpass_query(highway_tags, bbox):
    min_lat, min_lon, max_lat, max_lon = bbox
    return (
        "[out:json][timeout:180];\n"
        f'way["highway"~"^({highway_tags})$"]({min_lat},{min_lon},{max_lat},{max_lon});\n'
        "out geom;"
    )


def fetch_overpass(query, out_path, attempts=3):
    data = query.encode("utf-8")
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(OVERPASS_URL, data=data)
            with urllib.request.urlopen(req, timeout=200) as resp:
                result = json.loads(resp.read())
            with open(out_path, "w") as f:
                json.dump(result, f)
            return result
        except Exception as e:
            print(f"  retry {attempt} after error: {e}", file=sys.stderr)
            time.sleep(5)
    raise RuntimeError("failed to fetch from Overpass API")


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker simplification on a list of (x,y) tuples."""
    if len(points) < 3:
        return points

    def perp_dist(pt, a, b):
        (x, y), (ax, ay), (bx, by) = pt, a, b
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(x - ax, y - ay)
        t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
        t = max(0, min(1, t))
        px, py = ax + t * dx, ay + t * dy
        return math.hypot(x - px, y - py)

    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        d = perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > epsilon:
        left = rdp(points[:idx + 1], epsilon)
        right = rdp(points[idx:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def line_length(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


def midpoint_and_angle(pts):
    total = line_length(pts)
    if total == 0:
        return pts[0], 0.0
    half = total / 2
    acc = 0
    for i in range(len(pts) - 1):
        seg = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if acc + seg >= half or i == len(pts) - 2:
            t = 0 if seg == 0 else (half - acc) / seg
            mx = pts[i][0] + t * (pts[i + 1][0] - pts[i][0])
            my = pts[i][1] + t * (pts[i + 1][1] - pts[i][1])
            angle = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
            return (mx, my), angle
        acc += seg
    return pts[len(pts) // 2], 0.0


def process(overpass_result, epsilon, min_points_keep=2):
    lines = []
    named = []  # (name, simplified_pts, length)
    for el in overpass_result["elements"]:
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        pts = [project(g["lat"], g["lon"]) for g in geom]
        simplified = rdp(pts, epsilon)
        if len(simplified) < min_points_keep:
            continue
        rounded = [[round(x, 5), round(y, 5)] for x, y in simplified]
        lines.append(rounded)
        name = (el.get("tags") or {}).get("name")
        if name:
            named.append((name, rounded, line_length(rounded)))
    return lines, named


def build_labels(named, min_spacing, min_length):
    by_name = defaultdict(list)
    for name, pts, length in named:
        if length >= min_length:
            by_name[name].append((pts, length))
    labels = []
    for name, segs in by_name.items():
        segs.sort(key=lambda s: -s[1])  # longest first, preferred for label placement
        chosen = []
        for pts, length in segs:
            (mx, my), angle = midpoint_and_angle(pts)
            if all(math.hypot(mx - c[0], my - c[1]) >= min_spacing for c in chosen):
                chosen.append((mx, my))
                # normalize angle to avoid upside-down text
                if angle > math.pi / 2 or angle < -math.pi / 2:
                    angle += math.pi
                labels.append({"x": round(mx, 5), "y": round(my, 5), "a": round(angle, 3), "n": name})
    return labels


EPS_MAJOR = 0.00003
EPS_MINOR = 0.00002  # tighter than major -- preserve more grid detail at high zoom


def main():
    TMP_DIR.mkdir(exist_ok=True)

    print("fetching major roads from Overpass...", file=sys.stderr)
    major_raw = fetch_overpass(overpass_query(MAJOR_HIGHWAY_TAGS, SF_BBOX), MAJOR_RAW_PATH)
    print("fetching minor roads from Overpass...", file=sys.stderr)
    minor_raw = fetch_overpass(overpass_query(MINOR_HIGHWAY_TAGS, SF_BBOX), MINOR_RAW_PATH)

    print("processing major...", file=sys.stderr)
    major, major_named = process(major_raw, EPS_MAJOR)
    print("processing minor...", file=sys.stderr)
    minor, minor_named = process(minor_raw, EPS_MINOR)

    print("major lines:", len(major), "points:", sum(len(l) for l in major), file=sys.stderr)
    print("minor lines:", len(minor), "points:", sum(len(l) for l in minor), file=sys.stderr)

    labels_major = build_labels(major_named, min_spacing=0.018, min_length=0.003)
    labels_minor = build_labels(minor_named, min_spacing=0.007, min_length=0.0015)
    print("major labels:", len(labels_major), file=sys.stderr)
    print("minor labels:", len(labels_minor), file=sys.stderr)

    out = {
        "major": major, "minor": minor,
        "labelsMajor": labels_major, "labelsMinor": labels_minor,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    import os
    print("file size:", os.path.getsize(OUT_PATH), "bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
