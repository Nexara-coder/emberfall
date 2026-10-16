"""Compare the GDScript terrain port (via its Python mirror) against the
original JavaScript, value by value, as exact doubles."""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import gd_mirror as G  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
JS = os.path.join(ROOT, "js", "terrain_height.js")

raw = subprocess.run(
    ["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "dump_js.js"), JS],
    capture_output=True, text=True, check=True,
).stdout
ref = {d["k"]: d["v"] for d in json.loads(raw)}

fails = 0
checked = 0


def cmp(label, a, b, idx):
    """Exact comparison. Floats must be the identical double."""
    global fails, checked
    checked += 1
    if isinstance(a, float) or isinstance(b, float):
        same = float(a) == float(b)
    else:
        same = a == b
    if not same:
        fails += 1
        if fails <= 12:
            print(f"  MISMATCH {label}[{idx}]: js={a!r} gd={b!r}")


print("1. hash3 — 32-bit imul and unsigned shift")
for i, v in enumerate(ref["hash"]):
    # regenerate the same inputs the dumper used
    if i < 4000:
        x = ((i * 7919) % 100000) - 50000
        y = ((i * 104729) % 100000) - 50000
        s = 101 + (i % 7) * 13
    else:
        edge = [
            (0, 0, 0), (-1, -1, -1), (2147483647, 2147483647, 2147483647),
            (-2147483648, -2147483648, -2147483648), (1, 0, 0), (0, 1, 0),
            (0, 0, 1), (65535, 65536, 1442695041),
            (374761393, 668265263, 1274126177),
        ][i - 4000]
        x, y, s = edge
    cmp("hash", v, G.hash3(x, y, s), i)
print(f"   {len(ref['hash'])} samples")

print("2. vnoise / fbm")
for i, row in enumerate(ref["fbm"]):
    x = ((i * 13.7) % 500) - 60
    z = ((i * 29.3) % 500) - 60
    got = [
        G.vnoise(x, z, 101), G.fbm(x, z, 4, 0.017, 101),
        G.fbm(x, z, 3, 0.021, 307), G.fbm(x, z, 2, 0.061, 211),
        G.fbm(x, z, 2, 0.05, 409),
    ]
    for j in range(5):
        cmp(f"fbm.{j}", row[j], got[j], i)
print(f"   {len(ref['fbm'])} points x 5 functions")

print("3. height / ground / region / roadDist / riverDist")
for i, row in enumerate(ref["pts"]):
    x, z, h, _h2, g, r, rd, vd = row
    cmp("height", h, G.height(x, z), i)
    cmp("ground", g, G.ground(x, z, h), i)
    cmp("region", r, G.region(x, z), i)
    cmp("roadDist", rd, G.road_dist(x, z), i)
    cmp("riverDist", vd, G.river_dist(x, z), i)
print(f"   {len(ref['pts'])} points x 5 functions")

print()
print(f"total comparisons: {checked}   mismatches: {fails}")
sys.exit(1 if fails else 0)
