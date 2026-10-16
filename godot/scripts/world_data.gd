## Emberfall - world and content data.
##
## Registered as the autoload "WorldData". Loads the same JSON the PHP server
## reads, from res://data/, which tools/bake.js mirrors out of the project's
## data/ directory. There is one world definition, not two.
##
## Also owns the derived grids the rest of the game asks about: terrain height,
## ground type, and what is walkable. Those are expensive to recompute per
## frame, so they are built once into packed arrays.
##
## The collision rules below are a LITERAL port of tools/validate_world.js,
## down to the thresholds and the order the stamps are applied in. That file is
## the authoritative definition of walkability - it is what gates a release -
## and the server derives movement from the same terrain function. A client
## that guesses its own rules disagrees with the server about where the player
## may stand, which shows up as rubber-banding and doors that cannot be used.
extends Node

const DATA_DIR := "res://data/"
const WORLD := EmberTerrainDef.WORLD

## The collision and height grids are CORNER grids of (WORLD + 1) squared,
## sampled at integer coordinates. This is not a detail: the Node validator and
## the authored pipeline both sample T.height(x, z) at whole numbers, so a
## client that sampled tile centres instead would disagree with the server
## about every slope and doorway. Terrain mesh corners use the same samples.
const GRID := WORLD + 1

## Everything below mirrors tools/validate_world.js exactly. That file is the
## authoritative definition of what is walkable, because it is what gates a
## release, and the server derives movement from the same terrain function.
## Changing a number here without changing it there is how the client and the
## server start disagreeing about where the player may stand.

## Below this height the ground is water. Note 0.08, not 0.0 - the shoreline is
## not walkable.
const WATER_LEVEL := 0.08
## Metres of height change per tile above which the ground is a cliff.
const CLIFF_SLOPE := 1.55
## Roads are walkable on dry ground even when the grade says cliff. Without this
## the mountain road counted as a cliff and Dunhollow was unreachable on foot.
const ROAD_WIDTH := 2.4
## Doorways are carved open with this radius, so a doorway is an opening rather
## than a single tile you have to hit exactly.
const DOOR_CLEAR := 1.8

## Which object types block, and how wide. Types NOT listed here do not block at
## all - the standing stone the player spawns on is deliberately absent, and
## adding it sealed the spawn tile.
const OBJECT_RADII: Dictionary = {
	"tree": 0.8, "rock": 1.1, "sign": 0.4, "well": 1.3, "furnace": 1.6,
	"anvil": 1.1, "range": 1.2, "altar": 1.4, "altar_rc": 1.6,
	"bank_booth": 1.2, "statue": 1.0, "fountain": 1.6,
}

## Ground type names, indexed by the byte stored in _ground. Ground type decides
## which texture a tile gets; it has nothing to do with collision.
const GROUND_NAMES: Array[String] = [
	"grass", "path", "dirt", "sand", "rock", "snow", "muck", "blight", "water",
]

var items: Array = []
var npcs: Array = []
var shops: Array = []
var quests: Array = []
var spells: Array = []
var prayers: Array = []
var world: Dictionary = {}
var build_stamp: String = ""

var npc_by_key: Dictionary = {}
var item_by_id: Dictionary = {}

var ready_ok: bool = false
var load_error: String = ""

## Corner grids, indexed z * GRID + x.
var _height: PackedFloat32Array = PackedFloat32Array()
var _blocked: PackedByteArray = PackedByteArray()
## Tile-centre ground types, indexed z * WORLD + x. Appearance only.
var _ground: PackedByteArray = PackedByteArray()

var _ground_index: Dictionary = {}


func _ready() -> void:
	for i in range(GROUND_NAMES.size()):
		_ground_index[GROUND_NAMES[i]] = i
	_load_all()
	# The grids are NOT built here. 385x385 corners plus 384x384 tiles is about
	# 295,000 samples of a four-octave fbm, which takes seconds in GDScript -
	# and seconds inside an autoload's _ready is a browser tab that appears to
	# have hung, with no way to show progress. scripts/main.gd drives
	# build_grids_stepped() across frames instead. build_grids() remains for
	# tools and tests that can afford to block.


func _load_json(file_name: String) -> Variant:
	var path := DATA_DIR + file_name
	if not FileAccess.file_exists(path):
		load_error = "missing " + path
		push_error("WorldData: " + load_error)
		return null
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		load_error = "empty " + path
		push_error("WorldData: " + load_error)
		return null
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		load_error = "could not parse " + path
		push_error("WorldData: " + load_error)
		return null
	return parsed


func _load_all() -> void:
	var w: Variant = _load_json("world.json")
	if w == null:
		return
	world = w

	var it: Variant = _load_json("items.json")
	if it is Array:
		items = it
		for item: Variant in items:
			if item is Dictionary and item.has("id"):
				item_by_id[int(item["id"])] = item

	var n: Variant = _load_json("npcs.json")
	if n is Dictionary:
		npcs = n.get("npcs", [])
		shops = n.get("shops", [])
		for npc: Variant in npcs:
			if npc is Dictionary and npc.has("key"):
				npc_by_key[String(npc["key"])] = npc

	var q: Variant = _load_json("quests.json")
	if q is Array:
		quests = q

	var m: Variant = _load_json("magic.json")
	if m is Dictionary:
		spells = m.get("spells", [])
		prayers = m.get("prayers", [])

	build_stamp = String(world.get("build", ""))
	ready_ok = true


## ---------------------------------------------------------------------------
## Derived grids
## ---------------------------------------------------------------------------

## Build the height, ground and collision grids. 385 x 385 corners plus
## 384 x 384 tiles is about 295,000 samples and each one costs several fbm
## evaluations, so this is the most expensive thing the client does at startup.
## Use build_grids_stepped() if you want a progress bar.
func build_grids() -> void:
	_alloc()
	for z in range(GRID):
		_height_row(z)
	for z in range(WORLD):
		_ground_row(z)
	_stamp_all()


## Total rows build_grids_stepped() has to get through, for a progress bar.
func grid_rows() -> int:
	return GRID + WORLD


## Call repeatedly with an advancing row index until it returns true.
func build_grids_stepped(row: int, rows_per_call: int = 12) -> bool:
	if row == 0:
		_alloc()
	var last: int = mini(row + rows_per_call, GRID + WORLD)
	for r in range(row, last):
		if r < GRID:
			_height_row(r)
		else:
			_ground_row(r - GRID)
	if last >= GRID + WORLD:
		_stamp_all()
		return true
	return false


func _alloc() -> void:
	_height.resize(GRID * GRID)
	_blocked.resize(GRID * GRID)
	_ground.resize(WORLD * WORLD)


func _height_row(z: int) -> void:
	var base := z * GRID
	var fz := float(z)
	for x in range(GRID):
		_height[base + x] = EmberTerrainDef.height(float(x), fz)


func _ground_row(z: int) -> void:
	var base := z * WORLD
	var fz := float(z) + 0.5
	for x in range(WORLD):
		var fx := float(x) + 0.5
		var g := EmberTerrainDef.ground(fx, fz)
		_ground[base + x] = int(_ground_index.get(g, 0))


## The stamping order is the order tools/validate_world.js uses and it matters:
## terrain, then bridges clear the water, then building walls, then solid
## scenery, then doorways are carved back open last so nothing can seal them.
func _stamp_all() -> void:
	_stamp_terrain()
	_stamp_bridges()
	_stamp_building_walls()
	_stamp_objects()
	_carve_doorways()


func _stamp_terrain() -> void:
	for z in range(GRID):
		var base := z * GRID
		var fz := float(z)
		for x in range(GRID):
			var h := _height[base + x]
			var b := 0
			if h < WATER_LEVEL:
				b = 1
			else:
				var mx: float = maxf(
					maxf(absf(_h_raw(x - 1, z) - h), absf(_h_raw(x + 1, z) - h)),
					maxf(absf(_h_raw(x, z - 1) - h), absf(_h_raw(x, z + 1) - h))
				)
				if mx > CLIFF_SLOPE:
					b = 1
			if b == 1 and h >= WATER_LEVEL:
				if EmberTerrainDef.road_dist(float(x), fz) < ROAD_WIDTH:
					b = 0
			_blocked[base + x] = b


## Height at a grid corner, computing it when the corner is outside the grid so
## the slope test at the world edge matches the validator's, which also calls
## T.height() with out-of-range coordinates rather than clamping.
func _h_raw(x: int, z: int) -> float:
	if x >= 0 and z >= 0 and x < GRID and z < GRID:
		return _height[z * GRID + x]
	return EmberTerrainDef.height(float(x), float(z))


## A bridge is something you walk ONTO. Its deck clears the water along the
## bridge's OWN axis - clearing on a fixed world axis is what made the bridges
## unusable in the WebGL client, because the deck is built along local Z and
## then rotated.
func _stamp_bridges() -> void:
	for o: Variant in world.get("objects", []):
		if not o is Dictionary or String(o.get("t", "")) != "bridge":
			continue
		var rot := float(o.get("rot", 0.0))
		var sx := sin(rot)
		var cz := cos(rot)
		var ln := float(o.get("len", 16.0))
		var cx := float(o.get("x", 0))
		var cx_z := float(o.get("z", 0))
		if absf(sx) > absf(cz):
			_stamp_rect(cx, cx_z, ln + 4.0, 5.0, 0)
		else:
			_stamp_rect(cx, cx_z, 5.0, ln + 4.0, 0)


## Buildings block at their WALLS; the interior floor is walkable, which is how
## the game stamps them. Filling the whole footprint made every shop and quest
## giver inside a building unreachable.
func _stamp_building_walls() -> void:
	for b: Variant in world.get("buildings", []):
		if not b is Dictionary:
			continue
		var bx := float(b.get("x", 0))
		var bz := float(b.get("z", 0))
		var bw := float(b.get("w", 4))
		var bd := float(b.get("d", 4))
		var x0 := int(floor(bx - bw * 0.5))
		var x1 := int(ceil(bx + bw * 0.5))
		var z0 := int(floor(bz - bd * 0.5))
		var z1 := int(ceil(bz + bd * 0.5))
		for x in range(x0, x1 + 1):
			for z in range(z0, z1 + 1):
				if x < 0 or z < 0 or x > WORLD or z > WORLD:
					continue
				if x == x0 or x == x1 or z == z0 or z == z1:
					_blocked[z * GRID + x] = 1


func _stamp_objects() -> void:
	for o: Variant in world.get("objects", []):
		if not o is Dictionary:
			continue
		var t := String(o.get("t", ""))
		if not OBJECT_RADII.has(t):
			continue
		_stamp_circle(float(o.get("x", 0)), float(o.get("z", 0)), float(OBJECT_RADII[t]), 1)


func _carve_doorways() -> void:
	for b: Variant in world.get("buildings", []):
		if not b is Dictionary:
			continue
		var d := door_position(b)
		_stamp_circle(d.x, d.y, DOOR_CLEAR, 0)


## The door's position in world coordinates. side: 0=+z 1=+x 2=-z 3=-x,
## offset along that wall. Rotation is not applied, because the authored data
## and the validator both treat the door offset in unrotated local space.
func door_position(b: Dictionary) -> Vector2:
	var door: Array = b.get("door", [0, 0])
	var side: int = int(door[0]) if door.size() > 0 else 0
	var off: float = float(door[1]) if door.size() > 1 else 0.0
	var bx := float(b.get("x", 0))
	var bz := float(b.get("z", 0))
	var bw := float(b.get("w", 4))
	var bd := float(b.get("d", 4))
	match side:
		0: return Vector2(bx + off, bz + bd * 0.5)
		1: return Vector2(bx + bw * 0.5, bz + off)
		2: return Vector2(bx + off, bz - bd * 0.5)
	return Vector2(bx - bw * 0.5, bz + off)


func _stamp_rect(cx: float, cz: float, w: float, d: float, v: int) -> void:
	for z in range(int(floor(cz - d * 0.5)), int(ceil(cz + d * 0.5)) + 1):
		for x in range(int(floor(cx - w * 0.5)), int(ceil(cx + w * 0.5)) + 1):
			if x < 0 or z < 0 or x > WORLD or z > WORLD:
				continue
			_blocked[z * GRID + x] = v


func _stamp_circle(cx: float, cz: float, r: float, v: int) -> void:
	for z in range(int(floor(cz - r)), int(ceil(cz + r)) + 1):
		for x in range(int(floor(cx - r)), int(ceil(cx + r)) + 1):
			if x < 0 or z < 0 or x > WORLD or z > WORLD:
				continue
			var dx := float(x) - cx
			var dz := float(z) - cz
			if dx * dx + dz * dz <= r * r:
				_blocked[z * GRID + x] = v


## ---------------------------------------------------------------------------
## Queries
## ---------------------------------------------------------------------------

func in_bounds(x: int, z: int) -> bool:
	return x >= 0 and z >= 0 and x <= WORLD and z <= WORLD


## Height at a grid corner.
func corner_height(x: int, z: int) -> float:
	var cx: int = clampi(x, 0, GRID - 1)
	var cz: int = clampi(z, 0, GRID - 1)
	if _height.is_empty():
		return EmberTerrainDef.height(float(cx), float(cz))
	return _height[cz * GRID + cx]


## Height anywhere, bilinearly interpolated between grid corners so an actor
## walking across a slope rises smoothly and lands on the same surface the
## terrain mesh draws.
func height_at(x: float, z: float) -> float:
	var x0 := int(floor(x))
	var z0 := int(floor(z))
	var tx := x - float(x0)
	var tz := z - float(z0)
	var h00 := corner_height(x0, z0)
	var h10 := corner_height(x0 + 1, z0)
	var h01 := corner_height(x0, z0 + 1)
	var h11 := corner_height(x0 + 1, z0 + 1)
	return lerpf(lerpf(h00, h10, tx), lerpf(h01, h11, tx), tz)


## Ground type of a tile. Appearance only.
func ground_at(x: int, z: int) -> String:
	if x < 0 or z < 0 or x >= WORLD or z >= WORLD or _ground.is_empty():
		return "water"
	return GROUND_NAMES[_ground[z * WORLD + x]]


func is_blocked(x: int, z: int) -> bool:
	if not in_bounds(x, z):
		return true
	if _blocked.is_empty():
		return false
	return _blocked[z * GRID + x] == 1


func walkable_fraction() -> float:
	if _blocked.is_empty():
		return 0.0
	var free := 0
	for i in range(_blocked.size()):
		if _blocked[i] == 0:
			free += 1
	return float(free) / float(_blocked.size())


func home_point() -> Vector2:
	var hp: Dictionary = world.get("homePoint", {})
	return Vector2(float(hp.get("x", 160)), float(hp.get("z", 268)))


func spawn_point() -> Vector2:
	var sp: Dictionary = world.get("spawnPoint", {})
	return Vector2(float(sp.get("x", 160)), float(sp.get("z", 268)))


## World tile coordinates to a Godot position. One tile is one unit, so the
## numbers in data/world.json read directly off the editor's gizmo.
func to_world(x: float, z: float, lift: float = 0.0) -> Vector3:
	return Vector3(x, height_at(x, z) + lift, z)
