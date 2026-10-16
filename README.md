# Emberfall

An original, browser-based 3D MMORPG built in the style of mid-2000s point-and-click RPGs. It is server-authoritative, tile-based and multiplayer, and runs on ordinary PHP 8 shared hosting with no Node, SSH, build step or database server.

It has two clients. The original is in vanilla JavaScript and Three.js. A second, parallel client is being written in Godot 4. Both talk to the same PHP API and the same world data.

> Live build: [nexarastudios.online](https://nexarastudios.online)

## What's in it

- **23 skills** on a classic exponential XP curve, **387 items**, **66 NPC types**, **23 quests**, **18 spells**, **15 prayers** and **12 shops**
- Tick-based combat (600 ms ticks, weapon-speed timing), banking, two-stage trade confirmation, and ground items with ownership timers
- A 384×384 deterministic world with six hand-authored settlements. Nothing is placed at random.
- Point-and-click movement with A* pathfinding (binary heap)

## Architecture

```
Browser (Three.js client)  ─┐
                            ├── HTTP polling ~5 Hz ──►  PHP 8 front controller (api/index.php)
Godot 4 client (web export) ─┘                                    │
                                                   SQLite, or locked-JSON fallback (data/store)
```

| Layer | Approach |
|---|---|
| **Server** | PHP 8, no framework. A front controller handles routing, sessions and storage. All game maths runs on the server, and clients may only *request* actions, never assert results. |
| **Storage** | PDO SQLite when it's available, with a flat-file JSON fallback. Writes go through a re-entrant `mutate()` wrapper so nested transactions can't deadlock. |
| **Netcode** | HTTP polling at about 5 Hz with snapshot interpolation on the client. It needs no WebSocket server, so it works on any shared host. |
| **Three.js client** | Plain `<script>` tags with no bundler, framework or ES modules. Includes a custom GLB reader with skinning, procedural terrain meshing, instanced world objects and a canvas-drawn icon set. |
| **Godot client** | A GDScript port of terrain, collision, pathfinding and networking, plus an in-editor map editor plugin (`godot/addons/emberfall_map`). |
| **Deployment** | Upload the folder and go. `health.php` checks the host environment and explains any problems in plain language. |

## World authoring pipeline

The world is data. Settlements and resources are authored in `tools/authored_*.js`, applied to `data/world.json`, baked into the client bundle and the Godot data mirror, then validated:

```sh
sh tools/build.sh
```

`tools/validate_world.js` enforces the world's rules: walkability, building access, collision and the difficulty curve (for example, no high-level monsters near spawn). A build only ships with **0 errors**. The current world has 47 buildings, 569 objects and 348 spawns, and is 74% walkable.

## Verification

The Godot port has to agree *exactly* with the JavaScript and server code. A terrain function that's "probably right" fails silently, so the port is checked with independent Python mirrors of the GDScript:

| Check | Result |
|---|---|
| `tools/verify/check_parity.py`: terrain height, noise and region functions, compared as exact doubles against Node | 29,114 comparisons, 0 mismatches |
| `tools/verify/check_astar.py`: pathfinder behaviour | 0 failures |
| `tools/verify/check_json_roundtrip.py <file>`: the map editor writes `authored_world.json` byte-identically | pass |

See [`tools/verify/README.md`](tools/verify/README.md) for details.

## Repository layout

```
api/        PHP server (front controller, storage, sessions, game maths)
js/         Three.js client
css/        UI styles
data/       items, NPCs, quests, magic, world (JSON); data/store = runtime saves (not committed)
assets/     models, textures, UI art
godot/      Godot 4 client and map-editor plugin (see README_GODOT.md)
tools/      world authoring, baking, validation, verification
health.php  host environment checker
```

## Running it

- **Hosting:** see [`INSTALL.txt`](INSTALL.txt). You need PHP 8.0 or newer and a writable `data/store/`.
- **Locally:** run `php -S localhost:8000` from the project root, then open `http://localhost:8000`.
- **Godot client:** see [`README_GODOT.md`](README_GODOT.md).

## Status

This is an active personal project under Nexara Studios. The Three.js client is playable, and the Godot client is in progress.

All content (names, quests, maps, code) is original. No assets or data from any commercial game are included.
