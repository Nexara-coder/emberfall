# The Godot project

Open **this folder** in Godot 4.4 or newer. The full story is in
`../README_GODOT.md`; this is the map of the code.

```
project.godot            autoloads, renderer, layers. No [input] section on
                         purpose - camera keys are read directly in GDScript so
                         there is no binary input-map blob to get wrong.
export_presets.cfg       the Web preset, already pointing at ../play/

scenes/
  main.tscn              the game
  map_editor.tscn        the map editor - open this to move things about

scripts/
  terrain_def.gd         LITERAL port of ../js/terrain_height.js. Bit-exact.
                         Touch nothing here without re-running the parity check.
  world_data.gd          autoload "WorldData". Loads data/*.json and owns the
                         height / ground / collision grids. The collision rules
                         are a literal port of ../tools/validate_world.js.
  terrain_mesh.gd        chunked ground mesh + one HeightMapShape3D collider
  props.gd               scenery and building meshes; MISSING_MODELS lists what
                         is a primitive stand-in and why
  world_builder.gd       places data/world.json into the scene; MultiMesh for
                         repeated scenery, Area3D for picking
  pathfinder.gd          A* over the collision grid, with its own binary heap
  actor.gd               one creature: path walking, ground following, clips
  camera_rig.gd          orbit camera; arrow keys, wheel, middle-drag
  net.gd                 autoload "Net". The PHP API, same protocol as js/net.js
  main.gd                startup, picking, click-to-move

addons/emberfall_map/
  plugin.gd              adds the dock
  dock.gd                the dock, built in code
  map_root.gd            spawns a draggable marker per authored entry
  marker.gd              one marker; snaps itself to the ground and the grid
  authored_io.gd         reads/writes ../data/authored_world.json byte-exactly

data/                    mirror of ../data, written by ../tools/bake.js.
                         Do not edit by hand - bake.js overwrites it.
assets/                  copies of ../assets that Godot imports
```

## Things that are load-bearing

**`terrain_def.gd` must stay bit-exact.** It is what decides where the ground
is, and the PHP server and the Node tools derive the same world from the
JavaScript original. A one-bit difference in the hash and every building in the
world sinks or floats. The `_imul` function emulates JavaScript's 32-bit signed
multiply; the unsigned shifts are why hash state is carried as an unsigned
32-bit value in a 64-bit int.

**The collision grid is a CORNER grid of 385 x 385**, sampled at integer
coordinates. Not tile centres. `tools/validate_world.js` samples
`T.height(x, z)` at whole numbers and that file is what gates a release, so the
client samples the same points. The terrain mesh corners and the
`HeightMapShape3D` use the same samples, so the drawn surface, the physics floor
and the server all agree.

**`EmberPath`'s nodes are those same corners**, so a route node's coordinates
*are* its world position. Round, do not floor, when converting a click into a
goal.

**The renderer is GL Compatibility on every platform.** Forward+ needs WebGPU,
which browsers do not broadly have. Do not switch it.

**Markers in the map editor are given an owner.** That is not housekeeping — the
editor's gizmos only move owned nodes, so an unowned marker is undraggable and
the whole scene is pointless. The cost is that saving the scene writes a
snapshot of them; `rebuild()` throws it away on open, so you never need to save.

**Do not add a `.import` file by hand.** Godot writes them on first open.

## Re-running the checks

The verification scripts are not in this folder because they are Python and Node
and have nothing to do with the Godot project, but if you change
`terrain_def.gd`, `world_data.gd`'s collision rules or `pathfinder.gd`, they are
what tells you whether you broke the agreement with the server. See
the "Verification" section of `../README_GODOT.md`.
