"""
Build neighborhood boundary polygons, average subsidy, and centroids for the
live map's neighborhood overlay.

SF assessor "neighborhoods" have no official polygon boundaries published
alongside this parcel data, so boundaries are traced directly from the
parcel point cloud: parcels are snapped onto a small grid, and any grid
cell containing at least one parcel of a given neighborhood is marked
"occupied" for that neighborhood. Walking the edges between occupied and
unoccupied cells (marching-squares style) produces one or more closed
rings per neighborhood; the largest ring (plus any other ring at least 8%
of the largest ring's area, to keep real detached pieces like islands of a
neighborhood while dropping single-cell noise) is kept, capped at 4 rings.

Reads:  pipeline/tmp/sf-citywide-sfr-full.csv (03_process_sfr.py)
Writes: data/sf-neighborhoods.json (committed -- fetched by index.html), with:
          - "avg_subsidy":  {neighborhood -> mean subsidy_vs_market_today}
          - "boundaries":   {neighborhood -> [ring, ...]}, each ring a list of [x,y]
                            polygon points in the same projected coordinate
                            space the map already uses for street data
          - "centroids":    {neighborhood -> [lat, lon]}, mean parcel lat/lon,
                            used by the map for neighborhood label placement
"""
import csv
import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
TMP_DIR = PIPELINE_DIR / "tmp"
DATA_DIR = PIPELINE_DIR.parent / "data"
SRC = TMP_DIR / "sf-citywide-sfr-full.csv"
OUT = DATA_DIR / "sf-neighborhoods.json"

LAT0 = 37.7749
COS_LAT0 = math.cos(math.radians(LAT0))


def project(lat, lon):
    return ((lon + 122.4194) * COS_LAT0, -(lat - LAT0))


CELL = 0.0028  # world-units grid cell (~ a few hundred feet), tuned for tracing


def trace_boundary(cells):
    """cells: set of (gx,gy) occupied grid cells. Returns list of rings, each a list of (x,y) world points."""
    # For each occupied cell, for each of its 4 sides, if the neighbor across that side is NOT occupied, that side is a boundary edge.
    boundary_edges = []
    for (gx, gy) in cells:
        corners = {
            'BL': (gx, gy), 'BR': (gx + 1, gy), 'TR': (gx + 1, gy + 1), 'TL': (gx, gy + 1)
        }
        neighbors = {
            'B': (gx, gy - 1, corners['BL'], corners['BR']),
            'T': (gx, gy + 1, corners['TL'], corners['TR']),
            'L': (gx - 1, gy, corners['BL'], corners['TL']),
            'R': (gx + 1, gy, corners['BR'], corners['TR']),
        }
        for side, (nx, ny, c1, c2) in neighbors.items():
            if (nx, ny) not in cells:
                boundary_edges.append((c1, c2))

    # build adjacency: corner -> list of connected corners via boundary edges
    adj = defaultdict(list)
    for a, b in boundary_edges:
        adj[a].append(b)
        adj[b].append(a)

    visited_edges = set()
    rings = []

    def edge_key(a, b):
        return (a, b) if a <= b else (b, a)

    for start in list(adj.keys()):
        for nxt in list(adj[start]):
            ek = edge_key(start, nxt)
            if ek in visited_edges:
                continue
            # walk a ring starting with this edge
            ring = [start]
            prev, cur = start, nxt
            visited_edges.add(ek)
            steps = 0
            while cur != start and steps < 200000:
                ring.append(cur)
                # pick next neighbor of cur that isn't back to prev, preferring unvisited edge
                candidates = adj[cur]
                nxt2 = None
                for cand in candidates:
                    ek2 = edge_key(cur, cand)
                    if ek2 in visited_edges:
                        continue
                    nxt2 = cand
                    break
                if nxt2 is None:
                    break
                visited_edges.add(edge_key(cur, nxt2))
                prev, cur = cur, nxt2
                steps += 1
            if len(ring) >= 4:
                rings.append(ring)
    return rings


def ring_area(ring):
    a = 0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def main():
    rows = list(csv.DictReader(open(SRC)))
    by_nb = defaultdict(list)
    latlon_by_nb = defaultdict(list)
    for r in rows:
        lat, lon = float(r["lat"]), float(r["lon"])
        x, y = project(lat, lon)
        by_nb[r["neighborhood"]].append((x, y, float(r["subsidy_vs_market_today"])))
        latlon_by_nb[r["neighborhood"]].append((lat, lon))

    result = {}
    avg_subsidy = {}
    centroids = {}
    for nb, pts in by_nb.items():
        avg_subsidy[nb] = round(statistics.mean(p[2] for p in pts))
        lats = [ll[0] for ll in latlon_by_nb[nb]]
        lons = [ll[1] for ll in latlon_by_nb[nb]]
        centroids[nb] = [round(statistics.mean(lats), 5), round(statistics.mean(lons), 5)]

        cells = set()
        for (x, y, _) in pts:
            gx = math.floor(x / CELL)
            gy = math.floor(y / CELL)
            cells.add((gx, gy))
        rings_grid = trace_boundary(cells)
        # convert grid-corner coords back to world coords, keep only rings with meaningful area, cap ring count
        rings_world = []
        for ring in rings_grid:
            world_ring = [(round(c[0] * CELL, 5), round(c[1] * CELL, 5)) for c in ring]
            area = ring_area(world_ring)
            rings_world.append((area, world_ring))
        rings_world.sort(key=lambda r: -r[0])
        # keep the largest ring, plus any other ring with area >= 8% of the largest (drop tiny noise specks)
        if not rings_world:
            continue
        biggest = rings_world[0][0]
        kept = [rings_world[0][1]] + [r[1] for r in rings_world[1:] if r[0] >= biggest * 0.08]
        kept = kept[:4]
        result[nb] = kept

    with open(OUT, "w") as f:
        json.dump({"avg_subsidy": avg_subsidy, "boundaries": result, "centroids": centroids}, f)

    print("neighborhoods with boundaries:", len(result))
    sizes = [(nb, sum(len(r) for r in rings)) for nb, rings in result.items()]
    sizes.sort(key=lambda x: -x[1])
    print("largest ring-point-count neighborhoods:", sizes[:5])
    print("smallest:", sizes[-5:])
    print("file size:", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
