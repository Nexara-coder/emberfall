# Verification scripts

These scripts check the claims in the "Verification" section of
`../../README_GODOT.md`. They check the GDScript port independently of the
Godot editor, because a port of a terrain hash or a collision model that is
"probably right" is worse than useless: it fails quietly.

Each script mirrors a GDScript file in Python, **hand-transcribed from the
GDScript rather than from the JavaScript**, so a transcription error in the
GDScript shows up as a mismatch rather than being copied into the test.

They need Python 3 and Node, and they run from the project root.

## Terrain parity — is `terrain_def.gd` bit-exact?

```sh
python3 -I tools/verify/check_parity.py
```

Compares the ported `hash`, `vnoise`, `fbm`, `height`, `ground`, `region`,
`roadDist` and `riverDist` against Node running `js/terrain_height.js`, as exact
doubles, over the whole world plus every terrain feature and the 32-bit wrap
edge cases. Expect **29,114 comparisons, 0 mismatches**.

Run this after any change to `godot/scripts/terrain_def.gd`. A mismatch means
the Godot client and the server disagree about where the ground is.

## Collision parity — does the client agree with the validator?

```sh
node tools/verify/dump_blocked.js > /tmp/blocked_js.bin
python3 -I - <<'PY'
import json, sys
sys.path.insert(0, 'tools/verify')
import astar_mirror as A
A.build_grid(json.load(open('data/world.json')))
ref = open('/tmp/blocked_js.bin','rb').read()
print("identical" if bytes(A.BLOCKED) == ref else "MISMATCH")
PY
```

`dump_blocked.js` re-runs the collision stamping from
`tools/validate_world.js`; the Python side mirrors `world_data.gd`. Expect all
**148,225 cells identical**.

Run this after any change to the constants or the stamping order in
`godot/scripts/world_data.gd`.

## Pathfinding — does A* work on the real world?

```sh
python3 -I tools/verify/check_astar.py
```

Checks path invariants over hundreds of random routes, compares costs against a
plain Dijkstra to prove the A* is optimal and the heap is correct, then walks
from the spawn to the nearest tree, rock and fishing spot, to every settlement,
and checks all 47 building doorways are walkable. Expect **0 failures**.

## JSON round-trip — will a save reshuffle the file?

```sh
python3 -I tools/verify/check_json_roundtrip.py data/authored_world.json
```

Mirrors the serialiser in `godot/addons/emberfall_map/authored_io.gd` and
re-serialises the real file. Expect **byte-identical: 53051 bytes**. If this
fails, every save from the map editor will produce a whole-file diff and real
moves will be invisible in it.

## What these do NOT check

Anything that needs the Godot engine: whether the scene files load, whether
`HeightMapShape3D` positions as calculated, whether the glTF importer orients
the rigs as expected, whether the web export runs. Those need the editor.
