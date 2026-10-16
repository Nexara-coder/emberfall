## Emberfall - terrain renderer and collider.
##
## Builds the ground as a grid of chunk meshes plus one HeightMapShape3D for
## collision and mouse picking.
##
## Two things here are the result of specific bugs in the earlier WebGL client
## and are worth keeping:
##
## 1. Vertex colour is blended across the FOUR tiles that meet at each corner,
##    not taken from one tile. Per-tile colour made the ground read as a grid of
##    flat squares, which was the "too blocky / pixely" complaint.
##
## 2. Each ground type gets its own surface with its own texture, and the
##    vertex colour under a textured surface is kept near white so the texture
##    supplies the colour. Multiplying a coloured texture by a same-coloured
##    vertex tint is what turned the roads bright pink.
##
## This is a @tool script so the map editor scene shows real terrain to place
## things on, rather than a flat plane.
@tool
class_name EmberTerrain
extends Node3D

const WORLD: int = EmberTerrainDef.WORLD
const CHUNK: int = 48                      ## tiles per chunk edge; 8x8 chunks
const TEX_DIR := "res://assets/terrain/"

## Texture per ground type. Index matches WorldData.GROUND_NAMES.
const GROUND_TEX: Array[String] = [
	"grass_lush.png",   # grass
	"road_cobble.png",  # path
	"dirt.png",         # dirt
	"sand.png",         # sand
	"rock_ground.png",  # rock
	"snow.png",         # snow
	"swamp.png",        # muck
	"dirt_dark.png",    # blight
	"water.png",        # water
]

## A tint per ground type, applied as vertex colour and blended across tile
## corners. These stay near white - the texture carries the colour, and
## multiplying a coloured texture by a same-coloured tint lands at about a
## quarter brightness, which is what turned the roads pink in the WebGL client.
## They are not so close to white that a MISSING texture looks like ground,
## though: see MISSING_TEX_COLOUR.
const GROUND_TINT: Array[Color] = [
	Color(0.88, 1.00, 0.80),  # grass, a touch green
	Color(1.00, 0.97, 0.92),  # path, neutral
	Color(1.00, 0.94, 0.84),  # dirt
	Color(1.00, 0.98, 0.90),  # sand
	Color(0.94, 0.94, 0.98),  # rock
	Color(1.00, 1.00, 1.00),  # snow
	Color(0.82, 0.92, 0.74),  # muck
	Color(0.92, 0.84, 0.80),  # blight
	Color(0.78, 0.90, 1.00),  # water
]

## The mean colour of each ground texture, measured from the files. Used as the
## material's albedo when its texture does not load, so the world still reads
## correctly - flat-shaded ground is close to the 2005 look anyway - instead of
## defaulting to white and lighting up as a featureless pale plain. The first
## build came back exactly like that and it took pixel analysis of a screenshot
## to establish that the grey was not ground colour at all.
const GROUND_MEAN: Array[Color] = [
	Color(0.306, 0.412, 0.184),  # grass_lush    (78, 105, 47)
	Color(0.400, 0.388, 0.353),  # road_cobble  (102,  99, 90)
	Color(0.435, 0.322, 0.224),  # dirt         (111,  82, 57)
	Color(0.753, 0.639, 0.443),  # sand         (192, 163,113)
	Color(0.341, 0.341, 0.325),  # rock_ground   (87,  87, 83)
	Color(0.812, 0.835, 0.820),  # snow         (207, 213,209)
	Color(0.247, 0.286, 0.165),  # swamp         (63,  73, 42)
	Color(0.278, 0.212, 0.153),  # dirt_dark     (71,  54, 39)
	Color(0.184, 0.435, 0.529),  # water         (47, 111,135)
]

## How many world tiles one repeat of the ground texture covers. At 4 the
## 1024px sheets repeat so often that mipmapping collapses them to their mean
## colour at any distance, which reads as flat untextured ground.
const TEX_TILES: float = 5.0

## Filled in by _make_materials(); one line per ground texture saying whether
## it loaded. main.gd prints this, because a silently missing ground texture is
## indistinguishable from pale ground on screen.
var texture_report: PackedStringArray = PackedStringArray()
var surfaces_built: int = 0
var vertices_built: int = 0

## Editor-only caches.
##
## At runtime WorldData holds the height and ground grids and every lookup is an
## array read. In the editor there is no WorldData, so the first version
## recomputed EmberTerrainDef.height() and .ground() on every single lookup -
## about 3.1 MILLION four-octave noise evaluations just to open the map editor
## scene. That locks the Godot editor's main thread for minutes and is
## indistinguishable from a hang: the scene opens, nothing responds, and there
## is no way to tell anything is editable. These cache the same grids locally,
## so it is one pass of about 295,000 instead.
var _ed_height: PackedFloat32Array = PackedFloat32Array()
var _ed_ground: PackedByteArray = PackedByteArray()

var _materials: Array[StandardMaterial3D] = []
var _chunks: Array[MeshInstance3D] = []
var _body: StaticBody3D = null


func _ready() -> void:
	# In the editor the map-editor scene drives the build explicitly so it can
	# report progress; at runtime main.gd does the same. Nothing is built here
	# on its own, because building 147k tiles inside _ready would stall the
	# first frame with no feedback.
	pass


## Build everything in one go. Blocks for a second or two, which is fine in the
## editor and in tests but not in a browser tab - see build_stepped().
func build() -> void:
	begin()
	for i in range(chunk_total()):
		build_one(i)
	finish()


## How many chunks a stepped build has to get through.
func chunk_total() -> int:
	var per_axis: int = int(ceil(float(WORLD) / float(CHUNK)))
	return per_axis * per_axis


## Stepped build, for a loading screen. Call begin(), then build_one(i) for
## every i up to chunk_total(), then finish(). The collider is built in
## begin() so the ground is solid before the first chunk appears.
func begin() -> void:
	_clear()
	surfaces_built = 0
	vertices_built = 0
	if Engine.is_editor_hint():
		_build_editor_cache()
	_make_materials()
	_build_collider()


## Precompute the grids the editor would otherwise recompute on every lookup.
func _build_editor_cache() -> void:
	var n := WORLD + 1
	_ed_height.resize(n * n)
	for z in range(n):
		var base := z * n
		for x in range(n):
			_ed_height[base + x] = EmberTerrainDef.height(float(x), float(z))
	_ed_ground.resize(WORLD * WORLD)
	for z in range(WORLD):
		var gbase := z * WORLD
		var fz := float(z) + 0.5
		for x in range(WORLD):
			var g := EmberTerrainDef.ground(float(x) + 0.5, fz)
			_ed_ground[gbase + x] = maxi(0, WorldData.GROUND_NAMES.find(g))


func build_one(index: int) -> void:
	var per_axis: int = int(ceil(float(WORLD) / float(CHUNK)))
	var cx: int = (index % per_axis) * CHUNK
	var cz: int = (index / per_axis) * CHUNK
	var mi := _build_chunk(cx, cz)
	if mi == null:
		return
	add_child(mi)
	_chunks.append(mi)
	# Chunks are deliberately NOT given an owner. Owned nodes appear in the
	# editor's Scene dock and get written into the .tscn, and 64 of them listed
	# above the markers is how you lose the things you actually came to move.
	# Nothing selects a terrain chunk on purpose.


func finish() -> void:
	pass


func chunk_count() -> int:
	return _chunks.size()


func _clear() -> void:
	for c in get_children():
		c.queue_free()
	_chunks.clear()
	_materials.clear()
	_body = null


func _make_materials() -> void:
	texture_report.clear()
	for i in range(GROUND_TEX.size()):
		var m := StandardMaterial3D.new()
		var path := TEX_DIR + GROUND_TEX[i]
		var tex: Texture2D = null
		# ResourceLoader.exists() is not enough on its own - it answers about
		# the import record, and a texture can still fail to load. Check the
		# loaded object.
		if ResourceLoader.exists(path):
			tex = load(path) as Texture2D
		if tex != null:
			m.albedo_texture = tex
			m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
			texture_report.append("%s ok" % GROUND_TEX[i])
		else:
			# Fall back to the texture's measured mean colour rather than
			# white, so a failed import degrades to flat-shaded ground instead
			# of a featureless pale plain.
			m.albedo_color = GROUND_MEAN[i]
			push_error("EmberTerrain: ground texture failed to load: " + path)
			texture_report.append("%s MISSING" % GROUND_TEX[i])
		m.vertex_color_use_as_albedo = true
		m.roughness = 0.95
		m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		# Ground types are opaque; water gets a little shine and no transparency
		# so it reads as a surface rather than a hole.
		if i == 8:
			m.roughness = 0.25
			m.metallic = 0.08
		_materials.append(m)


## How many of the nine ground textures actually loaded.
func textures_ok() -> int:
	var n := 0
	for line in texture_report:
		if line.ends_with(" ok"):
			n += 1
	return n


## One HeightMapShape3D for the whole world. This is both the physics floor and
## what the mouse raycasts against for click-to-move, so its samples are the
## SAME corner heights the visual mesh uses. An earlier version sampled tile
## centres here and corners for the mesh; the two surfaces then disagreed by up
## to half a tile of height on every slope, so clicks landed above or below the
## ground and the player floated on banks.
func _build_collider() -> void:
	# WORLD tiles have WORLD + 1 corners along each axis.
	var n := WORLD + 1
	var shape := HeightMapShape3D.new()
	shape.map_width = n
	shape.map_depth = n
	var data := PackedFloat32Array()
	data.resize(n * n)
	for z in range(n):
		var base := z * n
		for x in range(n):
			data[base + x] = _corner_height(x, z)
	shape.map_data = data

	var col := CollisionShape3D.new()
	col.shape = shape
	_body = StaticBody3D.new()
	_body.name = "TerrainBody"
	_body.collision_layer = 1
	_body.collision_mask = 0
	# A HeightMapShape3D of width n puts vertex i at local x = i - (n - 1) / 2.
	# Corner i is at world x = i, so the body sits at (n - 1) / 2 = WORLD / 2.
	var off := float(n - 1) * 0.5
	_body.position = Vector3(off, 0.0, off)
	_body.add_child(col)
	add_child(_body)
	if Engine.is_editor_hint():
		var root := get_tree().edited_scene_root
		if root != null:
			_body.owner = root
			col.owner = root


## Height at a grid CORNER, at integer coordinates. WorldData samples exactly
## these points for its collision grid, and so does tools/validate_world.js, so
## the drawn surface, the physics floor and the server all agree.
func _corner_height(cx: int, cz: int) -> float:
	if Engine.is_editor_hint():
		var n := WORLD + 1
		var ex: int = clampi(cx, 0, n - 1)
		var ez: int = clampi(cz, 0, n - 1)
		if _ed_height.is_empty():
			return EmberTerrainDef.height(float(ex), float(ez))
		return _ed_height[ez * n + ex]
	return WorldData.corner_height(cx, cz)


func _ground_index_at(x: int, z: int) -> int:
	var cx: int = clampi(x, 0, WORLD - 1)
	var cz: int = clampi(z, 0, WORLD - 1)
	if Engine.is_editor_hint():
		if _ed_ground.is_empty():
			return maxi(0, WorldData.GROUND_NAMES.find(
				EmberTerrainDef.ground(float(cx) + 0.5, float(cz) + 0.5)
			))
		return _ed_ground[cz * WORLD + cx]
	return WorldData.GROUND_NAMES.find(WorldData.ground_at(cx, cz))


## Colour at a tile CORNER, averaged over the four tiles that touch it. This is
## what stops the ground reading as a grid of flat squares.
func _corner_colour(cx: int, cz: int) -> Color:
	var r := 0.0
	var g := 0.0
	var b := 0.0
	for dz in [-1, 0]:
		for dx in [-1, 0]:
			var gi := _ground_index_at(cx + dx, cz + dz)
			var t: Color = GROUND_TINT[gi] if gi >= 0 else Color.WHITE
			r += t.r
			g += t.g
			b += t.b
	return Color(r * 0.25, g * 0.25, b * 0.25)


## Build one chunk. Each tile's two triangles go into the surface belonging to
## that tile's ground type, so every surface can carry its own texture.
func _build_chunk(cx: int, cz: int) -> MeshInstance3D:
	var w: int = mini(CHUNK, WORLD - cx)
	var d: int = mini(CHUNK, WORLD - cz)
	if w <= 0 or d <= 0:
		return null

	# Group tiles by ground type first so empty surfaces are never created.
	var by_type: Dictionary = {}
	for z in range(cz, cz + d):
		for x in range(cx, cx + w):
			var gi := _ground_index_at(x, z)
			if gi < 0:
				gi = 0
			if not by_type.has(gi):
				by_type[gi] = []
			by_type[gi].append(Vector2i(x, z))
	if by_type.is_empty():
		return null

	var mesh := ArrayMesh.new()
	var keys: Array = by_type.keys()
	keys.sort()
	for gi: int in keys:
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		# Set the material on the SurfaceTool and let commit() append the
		# surface. The earlier version committed to arrays, added the surface by
		# hand and then set the material by index, which is three places for the
		# indices to drift apart for no benefit.
		st.set_material(_materials[gi])
		for tile: Vector2i in by_type[gi]:
			_emit_tile(st, tile.x, tile.y)
		# No flip. With the front-facing winding in _emit_tile, generate_normals
		# already produces upward normals; asking it to flip pointed them at the
		# ground and lit the whole world by ambient only.
		st.generate_normals()
		# No generate_tangents(). Tangents are only needed for normal and
		# detail maps, which the ground does not use, and generating them on a
		# surface this large is pure cost - and a failure there can leave the
		# committed surface malformed.
		st.commit(mesh)
		surfaces_built += 1
		vertices_built += mesh.surface_get_array_len(mesh.get_surface_count() - 1)

	var mi := MeshInstance3D.new()
	mi.name = "Chunk_%d_%d" % [cx / CHUNK, cz / CHUNK]
	mi.mesh = mesh
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	return mi


## One tile as two triangles. Vertices sit at tile CORNERS, so corner x is the
## integer tile index and the tile centre is index + 0.5 - the same convention
## data/world.json and terrain_def.gd use.
func _emit_tile(st: SurfaceTool, x: int, z: int) -> void:
	var x0 := float(x)
	var x1 := float(x + 1)
	var z0 := float(z)
	var z1 := float(z + 1)

	var h00 := _corner_height(x, z)
	var h10 := _corner_height(x + 1, z)
	var h01 := _corner_height(x, z + 1)
	var h11 := _corner_height(x + 1, z + 1)

	var c00 := _corner_colour(x, z)
	var c10 := _corner_colour(x + 1, z)
	var c01 := _corner_colour(x, z + 1)
	var c11 := _corner_colour(x + 1, z + 1)

	var p00 := Vector3(x0, h00, z0)
	var p10 := Vector3(x1, h10, z0)
	var p01 := Vector3(x0, h01, z1)
	var p11 := Vector3(x1, h11, z1)

	# UVs come from world position, so the texture runs continuously across
	# chunk borders instead of restarting at every chunk.
	var u0 := x0 / TEX_TILES
	var u1 := x1 / TEX_TILES
	var v0 := z0 / TEX_TILES
	var v1 := z1 / TEX_TILES

	# Split the quad along its shorter diagonal, which keeps ridges and banks
	# from developing a visible herringbone.
	# WINDING. Godot treats the opposite winding to the right-hand rule as
	# front-facing, so triangles whose geometric normal points +Y are BACK
	# faces when you look down at them - and the whole ground was being culled.
	# On screen that is indistinguishable from flat ground, because the sky's
	# own ground hemisphere fills in behind it at almost exactly the colour
	# grass would be. It took painting the materials red to prove the surface
	# was never drawn.
	#
	# Every triangle below is therefore wound the other way round, and
	# generate_normals() is called with flip = true in _build_chunk so the
	# normals still point up and the lighting is unchanged.
	if absf(h00 - h11) <= absf(h10 - h01):
		_tri(st, p00, c00, Vector2(u0, v0), p10, c10, Vector2(u1, v0), p11, c11, Vector2(u1, v1))
		_tri(st, p00, c00, Vector2(u0, v0), p11, c11, Vector2(u1, v1), p01, c01, Vector2(u0, v1))
	else:
		_tri(st, p00, c00, Vector2(u0, v0), p10, c10, Vector2(u1, v0), p01, c01, Vector2(u0, v1))
		_tri(st, p10, c10, Vector2(u1, v0), p11, c11, Vector2(u1, v1), p01, c01, Vector2(u0, v1))


func _tri(
	st: SurfaceTool,
	a: Vector3, ca: Color, ua: Vector2,
	b: Vector3, cb: Color, ub: Vector2,
	c: Vector3, cc: Color, uc: Vector2
) -> void:
	st.set_color(ca)
	st.set_uv(ua)
	st.add_vertex(a)
	st.set_color(cb)
	st.set_uv(ub)
	st.add_vertex(b)
	st.set_color(cc)
	st.set_uv(uc)
	st.add_vertex(c)
