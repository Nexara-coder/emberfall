# Emberfall in Godot

This is the existing Emberfall project with a Godot 4 client added alongside the
Three.js one. Nothing was removed: the browser client, the PHP server, the data
and the authoring tools all still work exactly as they did.

What is new is in three places:

```
godot/                  the Godot project - open THIS folder in Godot 4.4
play/                   where the Godot web export goes (empty until you export)
data/authored_world.json  the hand-placed world, now editable in Godot
```

**Status:** the world, terrain, map editor and HUD shell render and run; gameplay systems are still to be ported. See [Status](#status) at the bottom.

---

## Why this is a rewrite and not a port

Godot cannot consume the Three.js client. There is no translation layer between
`THREE.Mesh` and `MeshInstance3D`, and there should not be — they are different
renderers with different scene graphs.

What *does* carry over is the part that took the longest to get right, and it
carries over untouched:

| Carried over unchanged | Rewritten in GDScript |
|---|---|
| `api/` — the whole PHP server | the renderer |
| `data/` — world, items, npcs, quests, magic | terrain meshing |
| `tools/` — the authoring pipeline and validator | input and camera |
| `assets/` — the GLB models and PNG textures | pathfinding |
| `js/terrain_height.js` — ported literally, bit for bit | networking |

Both clients hit the same `/api`, so one account and one world serve both. You
can run them side by side and compare.

---

## Opening it

1. Install **Godot 4.4** or newer (standard build, not .NET — there is no C#
   here).
2. Open the `godot/` folder as a project.
3. The first open takes a minute while Godot imports 24 GLB models and 127 PNG
   textures. It writes a `.godot/` cache and a `.import` file beside each asset.
   Those are generated, and deliberately not shipped.
4. Press F5 to run.

You should get a loading line, then the world: terrain, 47 buildings, the
authored scenery, and a character you move by clicking the ground.

---

## Editing the map in Godot

**Open `godot/scenes/map_editor.tscn`.** The `Emberfall Map` dock appears on the
right. Press **Reload from JSON**.

You get the real terrain, and a marker for every hand-placed thing in the world:

| Marker colour | What it is | How many |
|---|---|---|
| orange | buildings | 47 |
| blue | props (wells, barrels, signs, stalls…) | 47 |
| green | authored trees | 16 |
| brown | fence runs, one marker per end | 4 |
| pink | NPC posts | 31 |
| purple | resource zones, sized to their radius | 28 |
| red | one-off landmarks | 36 |

Select one and drag it with the normal move gizmo. Three constraints are applied
as you drag, which is what makes this usable rather than merely possible:

- **Height is not yours to set.** The marker snaps back onto the ground every
  time it moves, using the same `height()` function the server uses. The world
  data has no way to express a building floating in the air.
- **Positions snap to the grid the data uses** — whole tiles for buildings, half
  tiles for props and trees — so saved coordinates stay the clean numbers you
  would have typed.
- **Only yaw survives**, rounded to whole degrees. A building tipped on its side
  is not representable either.

Buildings also show a **yellow pad on the door side**. A door facing a
neighbour's wall is the most common authoring mistake and it is invisible from
above.

Then press **Save to JSON** and run the pipeline:

```sh
sh tools/build.sh
```

That is `apply_towns` → `apply_resources` → `bake` → `validate`, in the only
order that works.

### What the dock's buttons do

- **Reload from JSON** — throw away everything in the scene and rebuild from
  `data/authored_world.json`. The JSON is always the source of truth.
- **Save to JSON** — write every moved marker back. Reports how many moved.
- **Run validator** — shell out to `node tools/validate_world.js` and show the
  error count. Needs Node on your PATH; says so plainly if it is missing.
- **Toggle models** — draw the real meshes, or just coloured posts. Posts are
  much faster to rebuild when you are only moving things about.
- **Go to / Jump** — select the marker nearest a settlement centre, so you can
  press F in the viewport to frame it.
- **Add** — append a new building, prop or tree to the chosen settlement at the
  x/z you type, then save and rebuild.
- **Delete selected marker** — remove what the selected marker points at.

### You never need to save map_editor.tscn

Markers are given an owner so the editor's gizmos can move them, which means
saving the scene writes a snapshot of them into the `.tscn`. That snapshot is
harmless — **Reload from JSON** deletes every child and rebuilds from the JSON —
but there is no reason to save it either.

---

## The new source of truth

The coordinates used to live as hand-written JavaScript arrays inside
`tools/authored_towns.js` and `tools/authored_resources.js`. They now live in
**`data/authored_world.json`**, and those two files are thin loaders over it.

This was necessary — Godot cannot edit a JavaScript array literal — but it is
also an improvement on its own: the authored world is now plain data that
anything can read.

`tools/extract_authored.js` is the one-shot migration that produced it. It has
already been run; it is kept so you can see where the JSON came from.

**Nothing downstream changed.** `apply_towns.js`, `apply_resources.js` and
`validate_world.js` are untouched, and the world they produce is byte-identical
to the one you had.

---

## Deploying

Godot 4 exports the web build as plain static files — no Node, no build step on
the host — so it deploys the same way the rest of the project does.

1. In Godot: **Editor > Manage Export Templates > Download and Install**. This
   is a one-off ~800 MB download of the export templates.
2. **Project > Export**. The `Web` preset is already configured and already
   points at `../play/index.html`.
3. Press **Export Project**.
4. Upload the whole site.

The finished layout on the host:

```
public_html/
  index.html        the Three.js client, unchanged
  js/ css/ assets/
  api/              the PHP server, shared by both clients
  data/
  play/             the Godot client
    index.html  index.js  index.wasm  index.pck
    .htaccess
```

`https://your-site/` is the old client. `https://your-site/play/` is the Godot
one. Both talk to `/api`.

### Two hosting details that bite silently

- **`.wasm` must be served as `application/wasm`.** Apache's defaults do not
  include it, so the browser gets `application/octet-stream` and refuses to
  compile. `play/.htaccess` sets it.
- **Threads are off on purpose.** Godot's threaded web builds need
  `SharedArrayBuffer`, which the browser only grants when the server sends
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. Plenty of
  shared hosts will not let you set those, and a threaded build without them
  fails to start with an error nobody can act on. Single-threaded works
  everywhere. If your host does allow the headers, `play/.htaccess` has them
  commented out with a note.

The Godot client finds the API by trying `../api/index.php`, then
`api/index.php`, then `/api/index.php`, so it works wherever you put it. If the
export's build stamp does not match the server's, it says so on screen rather
than desyncing quietly — the same cache trap the web client had.

---
## Verification

The Godot client must agree exactly with the server and the authoring tools, so each ported system is checked against the original rather than eyeballed. The scripts live in `tools/verify/`.

**The terrain port is bit-exact.** `godot/scripts/terrain_def.gd` is a literal port of `js/terrain_height.js`. The hard part is `Math.imul` and `>>>`. JavaScript multiplies as 32-bit signed and shifts unsigned, while GDScript ints are 64-bit and shift arithmetically, so a naive port changes the terrain hash and every building sinks or floats. The port carries hash state as an unsigned 32-bit value in a 64-bit int and only reinterprets it as signed inside the multiply.

Checked by transcribing the GDScript into Python with identical semantics and comparing it against Node running the original, as exact doubles: **29,114 comparisons, 0 mismatches**. The checks cover `hash`, `vnoise`, `fbm`, `height`, `ground`, `region`, `roadDist` and `riverDist` over the whole world, every terrain feature and the 32-bit wrap edge cases.

**The collision model is byte-identical to the authoritative one.** It is a literal port of `tools/validate_world.js`, down to the order the stamps are applied in. Checked by dumping that file's collision grid from Node and diffing it cell by cell: **all 148,225 cells are identical**, and the walkable figure matches the validator's 74%.

**The pathfinder was tested on the real world.** 867 random routes were checked for adjacency, corner-cutting and blocked tiles. Another 263 routes were compared against a plain Dijkstra on the same grid, and every cost matched, so the A* is optimal and the heap is correct. Then the cases the game needs:

```
spawn -> nearest tree  at (135, 268)  46 tiles
spawn -> nearest rock  at (156, 209)  70 tiles
spawn -> nearest fish  at (172, 267)  15 tiles
spawn -> Aldermere                   105 tiles
spawn -> Dunhollow                   221 tiles
spawn -> Saltbrook                    71 tiles
spawn -> Mirefen                     127 tiles
spawn -> Blightfort                  175 tiles
spawn -> Outposts                     95 tiles
47/47 building doorways walkable
clicking a tree walks to (134, 267), beside the trunk at (135, 268)
```

**Saves round-trip exactly.** A save with nothing moved reproduces `data/authored_world.json` to all 53,051 bytes, so moving one building produces a one-line diff instead of a whole-file rewrite. This needs a hand-written serialiser rather than Godot's `JSON.stringify`, which prints floats with a fixed digit count. pi/2 would otherwise come back as `1.5707963267949` and silently change the world. The serialiser emits the shortest decimal that reads back as the identical double.

**The editor workflow was tested end to end.** Moving a building two tiles east in the editor produces a one-line diff:

```
-          "x": 151,
+          "x": 153,
```

`sh tools/build.sh` then moves exactly 1 of 47 buildings, changes the build stamp, and the validator still reports **0 errors**.

**The pipeline is deterministic.** Three full runs produce byte-identical `world.json` and `gamedata.js`.

**Static checks.** Every GDScript file passes `gdparse` and `gdlint` (gdtoolkit 4). Every `res://` path referenced in any script, scene or config resolves to a file that exists, including asset paths built at runtime from constants.

**Rendering is checked headlessly.** `xvfb-run` with Godot's `opengl3` driver renders the real project to PNG without a GPU. A test-harness autoload waits for the staged boot to finish, moves the camera through a set of fixed angles, and saves a frame from each. Visual changes are checked against those frames.

---

## Technical notes

**Terrain triangle winding.** Godot treats the winding opposite to the right-hand rule as front-facing. Ground triangles whose normals point +Y were therefore back faces when viewed from above, and were culled. Every tile is wound accordingly, and `generate_normals()` is called without a flip.

**Mipmaps are set in the committed `.import` files.** The materials use linear-with-mipmaps filtering. Godot's "detect 3D" hook only enables mip generation when a texture is first used in 3D inside the editor, so the result would otherwise depend on how the project happened to be opened. The `.import` files set `mipmaps/generate=true` explicitly (see `godot/.gitignore`).

**Per-primitive texturing.** The v2 models ship with placeholder materials, and the real textures are separate sheets applied per primitive by height band. That mapping (`V2_SPEC` in `js/assets.js`) is ported into `godot/scripts/props.gd` with the same split fractions. Materials are baked per surface onto each MultiMesh batch's mesh, because `material_override` would force one material onto every surface.

**Building texel density.** `BoxMesh` UVs run 0..1 across each face, which stretches one texture repeat over a whole wall. Building materials use world-space triplanar mapping at a fixed texel density, so walls, floors and chimneys match.

**Map editor performance.** Building the terrain synchronously inside a `@tool` script costs about 3.1 million noise evaluations on the editor's main thread. Terrain is therefore off by default in `map_editor.tscn`, and when it is enabled from the dock the height and ground grids are cached first (about 295,000 evaluations in one pass). The dock sits in `DOCK_SLOT_RIGHT_BL` so it gets its own panel.

**Startup diagnostics.** On launch the status line and console report the world build, chunk and surface counts, vertex count, which of the nine ground textures loaded, and scenery and building counts. A ground texture that fails to load falls back to its measured mean colour and is flagged on screen.

**`tools/gen_data.js` is reference only.** It regenerates the world from scratch, and its output no longer passes the validator (it places a level 18 monster in the starting area). The authored world in `data/` is the source of truth, and `tools/build.sh` deliberately leaves `gen_data.js` out.

### Terrain is procedural by design

There is no heightmap. The landscape is a pure function: `terrain_def.gd` computes the height of any point from fbm noise plus the settlement pads, roads, river and ponds. The PHP server, the Node authoring tools and both clients all derive the same world from that function, which is why the collision grid matches byte for byte.

Terrain is shaped by the constants at the top of `godot/scripts/terrain_def.gd` and the identical ones in `js/terrain_height.js` (they must stay in step):

- `PADS`: flattened build pads under each settlement (centre, radius, height)
- `ROADS`: road polylines, which flatten and smooth the ground they cross
- `RIVER`: the river's course, which carves a bed
- `PONDS`: standing water (centre, radius, depth)

After any change, run `sh tools/build.sh`, because authored objects are seated on the ground and their stored `y` values move with it. Making these four lists editable in the map editor is planned.

### The HUD

The side panel is built from the authored art in `assets/ui` (frames, tab sets, slots and orbs):

- **Nine tabs** in two rows, using the tab art
- **A 4 × 7 inventory** of 28 slots, with item icons and stack counts in classic shorthand (15000 shows as 15K)
- **A skills tab** listing all 23 skills with levels and a running total
- **An equipment tab** shown as a paper doll with eleven slots
- **A chat box** with a scrolling log and an entry line
- **Health, prayer and run orbs**, plus hover tooltips

**Item icons are drawn, not loaded.** Every item in `data/items.json` carries a shape name and two colours, for example `"icon": ["sword", "#b07a3c", "#7a5228"]`, across 60 distinct shapes. `scripts/ui/item_icons.gd` draws each one into an `ImageTexture` at 2x and downsamples it, the same approach `js/icons.js` takes for the web client, and caches textures by that triple.

**Offline sample.** Run from the editor with no server, the panel shows a sample drawn from the real item table, labelled as such in the chat box. Once `Net` has a session, the server's inventory, equipment and levels replace it.

---

## Status

**Working in Godot:** terrain, all 47 buildings and the authored scenery, click-to-move with pathfinding, networking against the PHP API, the in-editor map editor, and the HUD shell (tabs, inventory, skills, equipment, chat, orbs).

**Still to port from the web client:** bank, shops, context menus, minimap and world map, XP drops, the combat interface, prayer and magic pages, login and character creation, NPCs and monsters, ground items, trading, and the 23 skills' gameplay loops. Tabs for unbuilt features say "Not built yet".

**Art gaps:** 25 object types are still drawn as primitive stand-ins (listed in `MISSING_MODELS` in `godot/scripts/props.gd`), building styles are assembled from primitives with the v2 wall and roof textures, and the character animation clips drive only some joints, so walking animation is incomplete.
