## Emberfall - scenery and building meshes.
##
## Every object type in data/world.json has to resolve to something visible.
## Where an authored GLB exists under assets/v2/models/ it is used; where one
## does not, this builds a low-poly stand-in from primitives.
##
## Which types have real models and which are stand-ins is listed in
## MISSING_MODELS below and in ASSET_AUDIT.md. That list is the asset gap, not
## a shortcut taken by the port - 0 of 8 specified buildings and 0 of the
## specified prop set were ever delivered.
##
## Meshes are cached per key, because 284 trees must share four meshes rather
## than build 284 of them.
@tool
class_name EmberProps
extends RefCounted

const V2 := "res://assets/v2/models/"
const TEX := "res://assets/v2/textures/"
const PROPS := "res://assets/props/"

## Object type -> GLB path. These are the authored models actually delivered.
const MODEL_FOR: Dictionary = {
	"barrel": V2 + "props/barrel.glb",
	"crate": PROPS + "Wooden_Crate.glb",
	"fence": V2 + "props/fence_section.glb",
	"sign": V2 + "props/signpost.glb",
	"well": V2 + "props/well.glb",
	"stall": PROPS + "Market_Stall_Base.glb",
	"rock": PROPS + "Rock_Large.glb",
}

## Tree kind -> GLB. Six kinds share four models, distinguished by tint and
## scale, because only four tree models exist.
const TREE_MODEL: Dictionary = {
	"Tree": V2 + "trees/tree_oak.glb",
	"Oak": V2 + "trees/tree_oak.glb",
	"Willow": V2 + "trees/tree_willow.glb",
	"Silverbirch": V2 + "trees/tree_pine.glb",
	"Ironbark": V2 + "trees/tree_pine.glb",
	"Ghostwood": V2 + "trees/tree_dead.glb",
}

const TREE_TINT: Dictionary = {
	"Tree": Color(1.00, 1.00, 1.00),
	"Oak": Color(0.95, 1.00, 0.90),
	"Willow": Color(0.88, 0.98, 0.84),
	"Silverbirch": Color(1.00, 1.00, 0.96),
	"Ironbark": Color(0.80, 0.86, 0.78),
	"Ghostwood": Color(0.78, 0.76, 0.72),
}

const TREE_SCALE: Dictionary = {
	"Tree": 1.00, "Oak": 1.18, "Willow": 1.05,
	"Silverbirch": 0.95, "Ironbark": 1.30, "Ghostwood": 0.90,
}

## Everything here is a primitive stand-in. See ASSET_AUDIT.md.
const MISSING_MODELS: Array[String] = [
	"altar", "altar_rc", "anvil", "agility", "bank_booth", "brazier", "bridge",
	"campfire", "cart", "counter", "dungeon", "fish", "flax", "fountain",
	"furnace", "herb", "hunt", "loom", "obelisk", "patch", "range", "ruin_arch",
	"spinning_wheel", "standing_stone", "statue",
]

## Building style -> [wall texture, roof texture, storeys, roof pitch].
##
## Pitch is the roof's rise as a fraction of the FULL span, so 0.55 on an
## eight-deep house is a 4.4m roof sitting on a 2.9m wall. That is what made the
## first build read as a field of enormous tents. RuneScape roofs are shallow;
## these are now a quarter to a third of the span.
const STYLE: Dictionary = {
	"timber": ["wood_planks.png", "roof_tiles.png", 1, 0.26],
	"stone": ["stone_wall.png", "roof_tiles.png", 1, 0.24],
	"hut": ["wood_planks.png", "roof_tiles.png", 1, 0.34],
	"barn": ["wood_planks.png", "roof_tiles.png", 1, 0.30],
	"castle": ["brick_wall.png", "roof_tiles.png", 2, 0.16],
	"dwarf": ["mossy_stone.png", "roof_tiles.png", 1, 0.20],
	"ruin": ["mossy_stone.png", "", 1, 0.0],
}

## How to texture each v2 model, ported from V2_SPEC in js/assets.js.
##
## This is the piece the first Godot build was missing, and it is why the whole
## world came out grey. EVERY model in assets/v2 ships with a 2x2 pixel grey
## placeholder texture and baseColorFactor [0.4, 0.4, 0.4] - measured from the
## files. They are untextured by design; the real textures are the separate
## sheets in assets/v2/textures/models, and the integrator is expected to apply
## them. Instance one of these GLBs raw and you get a dark grey lump, which is
## exactly what 284 trees, every fence and every barrel looked like.
##
## The assignment is by HEIGHT. Each primitive's bounding-box centre is taken as
## a fraction of the whole model's height; below `split` it gets `lower` (bark,
## stone), above it gets `upper` (foliage, planks). The house uses `bands`
## instead: an ordered list of [top_fraction, texture].
const V2_SPEC: Dictionary = {
	"tree_oak": {
		"lower": "tree_oak__bark_oak.png", "upper": "tree_oak__leaves_oak.png",
		"split": 0.42,
	},
	"tree_willow": {
		"lower": "tree_willow__bark_oak.png", "upper": "tree_willow__leaves_willow.png",
		"split": 0.40,
	},
	"tree_pine": {
		"lower": "tree_pine__bark_pine.png", "upper": "tree_pine__leaves_oak.png",
		"split": 0.30,
	},
	"tree_dead": {
		"lower": "tree_dead__bark_oak.png", "upper": "tree_dead__bark_oak.png",
		"split": 1.0,
	},
	"well": {
		"lower": "well__stone_wall.png", "upper": "well__wood_planks.png", "split": 0.55,
	},
	"fence_section": {
		"lower": "fence_section__wood_planks.png",
		"upper": "fence_section__wood_planks.png", "split": 1.0,
	},
	"signpost": {
		"lower": "signpost__wood_planks.png", "upper": "signpost__wood_planks.png",
		"split": 1.0,
	},
	"barrel": {
		"lower": "barrel__wood_planks.png", "upper": "barrel__wood_planks.png",
		"split": 1.0,
	},
	"sword": {
		"lower": "sword__stone_wall.png", "upper": "sword__stone_wall.png", "split": 1.0,
	},
	"axe": {
		"lower": "axe__wood_planks.png", "upper": "axe__stone_wall.png", "split": 0.62,
	},
	"pickaxe": {
		"lower": "pickaxe__wood_planks.png", "upper": "pickaxe__stone_wall.png",
		"split": 0.58,
	},
	"shield": {
		"lower": "shield__wood_planks.png", "upper": "shield__wood_planks.png",
		"split": 1.0,
	},
	"house_timber": {
		"bands": [
			[0.20, "house_timber__stone_wall.png"],
			[0.72, "house_timber__wood_planks.png"],
			[1.01, "house_timber__roof_tiles.png"],
		],
	},
	"adventurer_base": {
		"lower": "adventurer_base__wood_planks.png",
		"upper": "adventurer_base__wood_planks.png", "split": 1.0,
	},
}

## The older assets/props/*.glb carry NO materials at all, so Godot renders them
## in its default white. One texture each, by eye.
const LEGACY_PROP_TEX: Dictionary = {
	"Wooden_Crate.glb": "buildings/wood_planks.png",
	"Wooden_Bench.glb": "buildings/wood_planks.png",
	"Barrel.glb": "buildings/wood_planks.png",
	"Fence_Segment.glb": "buildings/wood_planks.png",
	"Market_Stall_Base.glb": "buildings/wood_planks.png",
	"Stone_Well.glb": "buildings/stone_wall.png",
	"Rock_Large.glb": "buildings/mossy_stone.png",
	"Oak_Tree_HD.glb": "nature/bark_oak.png",
}

static var _mesh_cache: Dictionary = {}
static var _mat_cache: Dictionary = {}


## ---------------------------------------------------------------------------
## Materials
## ---------------------------------------------------------------------------

## A textured material.
##
## `world_scale` is the key argument. Geometry built here from BoxMesh and
## CylinderMesh carries UVs that run 0..1 across each FACE, so one texture
## repeat stretches over a whole ten-metre wall and the stone blocks come out
## two and a half metres across. Passing a world_scale switches the material to
## world-space triplanar mapping, where the texture repeats every
## 1/world_scale metres no matter how big the face is - so a wall, a floor and a
## chimney all share one texel density.
##
## Models loaded from GLB are the exception: they carry proper authored UVs, and
## triplanar would throw those away. Those keep world_scale at 0.
static func material(
	tex_rel: String, tint: Color = Color.WHITE, cutout: bool = false,
	world_scale: float = 0.0
) -> StandardMaterial3D:
	var key := tex_rel + "|" + str(tint) + "|" + str(cutout) + "|" + str(world_scale)
	if _mat_cache.has(key):
		return _mat_cache[key]
	var m := StandardMaterial3D.new()
	var path := TEX + tex_rel
	if tex_rel != "" and ResourceLoader.exists(path):
		m.albedo_texture = load(path) as Texture2D
	m.albedo_color = tint
	m.roughness = 0.9
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	if world_scale > 0.0:
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3(world_scale, world_scale, world_scale)
	if cutout:
		# Alpha-cut, not blended. A ragged canopy silhouette is the only way
		# foliage reads as leaves rather than a solid lump, and blended alpha
		# sorts wrongly against itself.
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.45
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mat_cache[key] = m
	return m


static func flat_material(col: Color, rough: float = 0.9) -> StandardMaterial3D:
	var key := "flat|" + str(col) + "|" + str(rough)
	if _mat_cache.has(key):
		return _mat_cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	_mat_cache[key] = m
	return m


## ---------------------------------------------------------------------------
## Scenery
## ---------------------------------------------------------------------------

## A Node3D for one world object. Returns null for types that are deliberately
## invisible (fishing spots are a patch of water, not a thing).
static func make_object(o: Dictionary) -> Node3D:
	var t := String(o.get("t", ""))
	if t == "tree":
		return _tree(String(o.get("k", "Tree")))
	if MODEL_FOR.has(t):
		var n := _instance_glb(MODEL_FOR[t])
		if n != null:
			return n
	return _stand_in(t, o)


static func _instance_glb(path: String) -> Node3D:
	if not ResourceLoader.exists(path):
		push_warning("EmberProps: missing model " + path)
		return null
	var packed := load(path) as PackedScene
	if packed == null:
		push_warning("EmberProps: " + path + " did not load as a scene")
		return null
	var node := packed.instantiate() as Node3D
	if node == null:
		return null
	var stem := path.get_file().get_basename()
	if V2_SPEC.has(stem):
		_texture_v2(node, V2_SPEC[stem])
	elif LEGACY_PROP_TEX.has(path.get_file()):
		_texture_flat(node, String(LEGACY_PROP_TEX[path.get_file()]))
	return node


## Apply the per-primitive textures a v2 model needs. See V2_SPEC.
static func _texture_v2(root: Node3D, spec: Dictionary) -> void:
	# Each mesh with its transform RELATIVE TO ROOT. global_transform is not
	# usable here - the model is not in the tree yet - and a mesh's own local
	# transform is not enough, because glTF nests parts under intermediate
	# nodes and the height fraction has to be measured in one shared space.
	var found: Array = []
	_gather_local(root, Transform3D.IDENTITY, found)
	if found.is_empty():
		return

	var meshes: Array[MeshInstance3D] = []
	var boxes: Array[AABB] = []
	var bottom := INF
	var top := -INF
	for entry: Dictionary in found:
		var mi: MeshInstance3D = entry["mi"]
		var box: AABB = (entry["xform"] as Transform3D) * (mi.get_aabb() as AABB)
		meshes.append(mi)
		boxes.append(box)
		bottom = minf(bottom, box.position.y)
		top = maxf(top, box.position.y + box.size.y)
	var span: float = maxf(0.001, top - bottom)

	for i in range(meshes.size()):
		var box: AABB = boxes[i]
		var centre: float = box.position.y + box.size.y * 0.5
		var frac: float = (centre - bottom) / span
		var file := _texture_for_fraction(spec, frac)
		if file == "":
			continue
		var mat := material("models/" + file)
		var leafy: bool = file.contains("leaves")
		if leafy:
			mat = mat.duplicate() as StandardMaterial3D
			mat.cull_mode = BaseMaterial3D.CULL_DISABLED
			_apply_leaf_cutout(mat)
		var mi := meshes[i]
		var surfaces: int = mi.mesh.get_surface_count() if mi.mesh != null else 0
		for s2 in range(surfaces):
			mi.set_surface_override_material(s2, mat)


## Walk the model collecting every MeshInstance3D with its transform relative
## to `root`, without needing the node to be inside the scene tree.
static func _gather_local(n: Node, xform: Transform3D, out: Array) -> void:
	var here := xform
	if n is Node3D and n.get_parent() != null:
		here = xform * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
		out.append({"mi": n, "xform": here})
	for c in n.get_children():
		_gather_local(c, here, out)


static func _texture_for_fraction(spec: Dictionary, frac: float) -> String:
	if spec.has("bands"):
		var bands: Array = spec["bands"]
		for band: Array in bands:
			if frac <= float(band[0]):
				return String(band[1])
		return String((bands[bands.size() - 1] as Array)[1])
	var split: float = float(spec.get("split", 1.0))
	return String(spec["lower"]) if frac < split else String(spec["upper"])


## One texture over every surface of a model that ships without materials.
static func _texture_flat(root: Node3D, tex_rel: String) -> void:
	var mat := material(tex_rel)
	for mi in _all_meshes(root):
		if mi.mesh == null:
			continue
		for s2 in range(mi.mesh.get_surface_count()):
			mi.set_surface_override_material(s2, mat)


static func _tree(kind: String) -> Node3D:
	var path: String = TREE_MODEL.get(kind, TREE_MODEL["Tree"])
	var n := _instance_glb(path)
	if n == null:
		return _stand_in("tree", {})
	var s: float = TREE_SCALE.get(kind, 1.0)
	n.scale = Vector3(s, s, s)
	var tint: Color = TREE_TINT.get(kind, Color.WHITE)
	if tint != Color.WHITE:
		_tint_tree(n, tint)
	return n


## Tint the foliage without tinting the trunk. The authored tree models split
## bark and leaves into separate primitives, so this walks the mesh surfaces
## and only touches the ones whose material name or texture says foliage.
static func _tint_tree(root: Node3D, tint: Color) -> void:
	for mi: MeshInstance3D in _all_meshes(root):
		var mesh := mi.mesh
		if mesh == null:
			continue
		for s in range(mesh.get_surface_count()):
			var base: Material = mi.get_active_material(s)
			if base == null:
				continue
			var name_hint := base.resource_name.to_lower()
			var is_leaf := name_hint.contains("leaf") or name_hint.contains("foliage")
			if not is_leaf and base is StandardMaterial3D:
				var tx: Texture2D = (base as StandardMaterial3D).albedo_texture
				if tx != null and tx.resource_path.to_lower().contains("leaves"):
					is_leaf = true
			if not is_leaf:
				continue
			var dup := base.duplicate() as StandardMaterial3D
			if dup == null:
				continue
			dup.albedo_color = tint
			dup.cull_mode = BaseMaterial3D.CULL_DISABLED
			_apply_leaf_cutout(dup)
			mi.set_surface_override_material(s, dup)


## Alpha-cut a leaf material, but ONLY if its sheet can actually be cut.
##
## The delivered leaf sheets (assets/v2/textures/nature/leaves_*.png) are RGB
## with no alpha channel - measured, not assumed - and they are seamless
## full-coverage leaf tiles rather than leaf cards, so there is no silhouette in
## them to extract either. Thresholding them on greenness cuts 11-15% of pixels
## in a narrow band, which produces speckled holes, not a ragged canopy.
##
## So: if a sheet has real alpha, cut against it. If it does not, leave the
## material opaque. A solid canopy with the right green is far closer to the
## target than a canopy full of noise holes, and the ragged silhouette has to
## come from the mesh or from RGBA sheets - which is asset-audit item 3, still
## outstanding.
static func _apply_leaf_cutout(mat: StandardMaterial3D) -> void:
	var tex: Texture2D = mat.albedo_texture
	if tex == null:
		return
	var key := "hasalpha|" + tex.resource_path
	var known: Variant = _mat_cache.get(key)
	var has_alpha: bool = bool(known) if known != null else _sheet_has_alpha(tex)
	_mat_cache[key] = has_alpha
	if not has_alpha:
		return
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.45


static func _sheet_has_alpha(tex: Texture2D) -> bool:
	var img := tex.get_image()
	if img == null:
		return false
	return img.detect_alpha() != Image.ALPHA_NONE


static func _all_meshes(root: Node) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	if root is MeshInstance3D:
		out.append(root)
	for c in root.get_children():
		out.append_array(_all_meshes(c))
	return out


## ---------------------------------------------------------------------------
## Primitive stand-ins for the object types with no delivered model
## ---------------------------------------------------------------------------

static func _stand_in(t: String, o: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "standin_" + t
	match t:
		"fish":
			return root  # a fishing spot is a place, not an object
		"herb", "flax", "patch":
			_add_box(root, Vector3(0.7, 0.28, 0.7), Vector3(0, 0.14, 0),
				flat_material(Color(0.38, 0.52, 0.26)))
		"hunt":
			_add_box(root, Vector3(0.9, 0.2, 0.9), Vector3(0, 0.1, 0),
				flat_material(Color(0.46, 0.38, 0.26)))
		"anvil":
			_add_box(root, Vector3(0.5, 0.35, 1.0), Vector3(0, 0.78, 0),
				flat_material(Color(0.22, 0.22, 0.24), 0.45))
			_add_box(root, Vector3(0.34, 0.6, 0.34), Vector3(0, 0.3, 0),
				flat_material(Color(0.3, 0.24, 0.18)))
		"furnace", "range":
			_add_box(root, Vector3(1.6, 1.5, 1.4), Vector3(0, 0.75, 0),
				material("buildings/stone_wall.png", Color.WHITE, false, 0.5))
			_add_box(root, Vector3(0.7, 0.5, 0.2), Vector3(0, 0.45, 0.7),
				flat_material(Color(0.9, 0.45, 0.12)))
		"brazier", "campfire":
			_add_cyl(root, 0.42, 0.5, Vector3(0, 0.25, 0),
				flat_material(Color(0.26, 0.24, 0.22)))
			_add_cyl(root, 0.3, 0.3, Vector3(0, 0.6, 0),
				flat_material(Color(0.95, 0.52, 0.14)))
		"altar", "altar_rc":
			_add_box(root, Vector3(2.2, 0.9, 1.1), Vector3(0, 0.45, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
		"counter", "bank_booth":
			_add_box(root, Vector3(2.2, 1.05, 0.7), Vector3(0, 0.52, 0),
				material("buildings/wood_planks.png", Color.WHITE, false, 0.6))
		"spinning_wheel", "loom":
			_add_box(root, Vector3(0.9, 0.9, 0.5), Vector3(0, 0.45, 0),
				material("buildings/wood_planks.png", Color.WHITE, false, 0.6))
		"cart":
			_add_box(root, Vector3(2.4, 0.7, 1.3), Vector3(0, 0.75, 0),
				material("buildings/wood_planks.png", Color.WHITE, false, 0.6))
			_add_cyl(root, 0.45, 0.14, Vector3(-0.8, 0.45, 0.72),
				flat_material(Color(0.3, 0.22, 0.14)))
			_add_cyl(root, 0.45, 0.14, Vector3(0.8, 0.45, 0.72),
				flat_material(Color(0.3, 0.22, 0.14)))
		"standing_stone", "obelisk":
			_add_box(root, Vector3(0.8, 3.2, 0.8), Vector3(0, 1.6, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
		"statue":
			_add_box(root, Vector3(1.2, 0.5, 1.2), Vector3(0, 0.25, 0),
				material("buildings/stone_wall.png", Color.WHITE, false, 0.5))
			_add_box(root, Vector3(0.7, 2.2, 0.5), Vector3(0, 1.6, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
		"fountain":
			_add_cyl(root, 1.8, 0.5, Vector3(0, 0.25, 0),
				material("buildings/stone_wall.png", Color.WHITE, false, 0.5))
			_add_cyl(root, 0.4, 1.4, Vector3(0, 0.95, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
		"ruin_arch":
			_add_box(root, Vector3(0.7, 3.0, 0.7), Vector3(-1.4, 1.5, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
			_add_box(root, Vector3(0.7, 3.0, 0.7), Vector3(1.4, 1.5, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
			_add_box(root, Vector3(3.5, 0.6, 0.7), Vector3(0, 3.2, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
		"dungeon":
			_add_box(root, Vector3(2.6, 0.4, 2.6), Vector3(0, 0.2, 0),
				material("buildings/mossy_stone.png", Color.WHITE, false, 0.5))
			_add_box(root, Vector3(1.6, 0.1, 1.6), Vector3(0, 0.42, 0),
				flat_material(Color(0.05, 0.04, 0.04)))
		"agility":
			_add_box(root, Vector3(2.4, 0.3, 0.6), Vector3(0, 0.4, 0),
				material("buildings/wood_planks.png", Color.WHITE, false, 0.6))
		"bridge":
			_bridge(root, o)
		_:
			_add_box(root, Vector3(0.8, 0.8, 0.8), Vector3(0, 0.4, 0),
				flat_material(Color(0.6, 0.45, 0.3)))
	return root


## A bridge is a deck you walk ONTO, not an object you bump into, so its deck is
## built flat at a fixed height and the walkable corridor is cleared along the
## bridge's own local axis before it is rotated - clearing on a fixed world axis
## is what made the bridges unusable in the WebGL client.
static func _bridge(root: Node3D, o: Dictionary) -> void:
	var span: float = float(o.get("span", 14.0))
	var wide: float = float(o.get("wide", 4.0))
	_add_box(root, Vector3(wide, 0.3, span), Vector3(0, 0.0, 0),
		material("buildings/wood_planks.png", Color.WHITE, false, 0.6))
	for side in [-1.0, 1.0]:
		_add_box(root, Vector3(0.2, 0.9, span), Vector3(side * wide * 0.5, 0.45, 0),
			material("buildings/wood_planks.png", Color.WHITE, false, 0.6))


static func _add_box(parent: Node3D, size: Vector3, at: Vector3, mat: Material) -> MeshInstance3D:
	var key := "box|" + str(size)
	var mesh: BoxMesh
	if _mesh_cache.has(key):
		mesh = _mesh_cache[key]
	else:
		mesh = BoxMesh.new()
		mesh.size = size
		_mesh_cache[key] = mesh
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = at
	mi.material_override = mat
	parent.add_child(mi)
	return mi


static func _add_cyl(
	parent: Node3D, radius: float, h: float, at: Vector3, mat: Material
) -> MeshInstance3D:
	var key := "cyl|%f|%f" % [radius, h]
	var mesh: CylinderMesh
	if _mesh_cache.has(key):
		mesh = _mesh_cache[key]
	else:
		mesh = CylinderMesh.new()
		mesh.top_radius = radius
		mesh.bottom_radius = radius
		mesh.height = h
		mesh.radial_segments = 10
		_mesh_cache[key] = mesh
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = at
	mi.material_override = mat
	parent.add_child(mi)
	return mi


## ---------------------------------------------------------------------------
## Buildings
## ---------------------------------------------------------------------------

## A building from its authored footprint: four walls with a real opening on the
## door side, a floor, and a gable roof as a separately named child so it can be
## hidden when the player walks inside.
##
## The roof's gable triangles close the RIDGE ENDS, not the eave sides. Getting
## that backwards punches the gable up through the roof slope, which is the
## "roofs are flipped / rotation is off" bug, reported three times.
static func make_building(b: Dictionary) -> Node3D:
	var style := String(b.get("style", "timber"))
	var spec: Array = STYLE.get(style, STYLE["timber"])
	var wall_tex := "buildings/" + String(spec[0])
	var roof_tex: String = "buildings/" + String(spec[1]) if String(spec[1]) != "" else ""
	var storeys := int(spec[2])
	var pitch := float(spec[3])

	var w := float(b.get("w", 8))
	var d := float(b.get("d", 8))
	var wall_h := 2.9 * float(storeys)
	var door: Array = b.get("door", [0, 0])
	var door_side: int = int(door[0]) if door.size() > 0 else 0
	var door_off: float = float(door[1]) if door.size() > 1 else 0.0
	var door_w := 1.8

	var root := Node3D.new()
	root.name = "building"

	# One texture repeat every 2m on walls and every 2.5m on floors. Chunky, as
	# 2005 RuneScape is, but a stone block now reads at about half a metre
	# rather than the two and a half metres the face-mapped UVs gave.
	var wall_mat := material(wall_tex, Color.WHITE, false, 0.5)
	var floor_mat := material("buildings/floor_stone.png", Color.WHITE, false, 0.4)

	# floor
	_add_box(root, Vector3(w, 0.2, d), Vector3(0, 0.1, 0), floor_mat)

	# walls: +z, +x, -z, -x. The door side is split into two segments with a
	# gap, which is a real opening in the geometry, not a painted-on door.
	_wall(root, 0, w, d, wall_h, wall_mat, door_side, door_off, door_w)
	_wall(root, 1, w, d, wall_h, wall_mat, door_side, door_off, door_w)
	_wall(root, 2, w, d, wall_h, wall_mat, door_side, door_off, door_w)
	_wall(root, 3, w, d, wall_h, wall_mat, door_side, door_off, door_w)

	if roof_tex != "":
		var roof := _roof(w, d, wall_h, pitch, material(roof_tex), wall_mat)
		roof.name = "roof"
		root.add_child(roof)
	return root


static func _wall(
	root: Node3D, side: int, w: float, d: float, h: float, mat: Material,
	door_side: int, door_off: float, door_w: float
) -> void:
	var along: float = w if (side == 0 or side == 2) else d
	var thick := 0.3
	var centre: Vector3
	var size: Vector3
	match side:
		0: centre = Vector3(0, h * 0.5, d * 0.5); size = Vector3(along, h, thick)
		1: centre = Vector3(w * 0.5, h * 0.5, 0); size = Vector3(thick, h, along)
		2: centre = Vector3(0, h * 0.5, -d * 0.5); size = Vector3(along, h, thick)
		_: centre = Vector3(-w * 0.5, h * 0.5, 0); size = Vector3(thick, h, along)

	if side != door_side:
		_add_box(root, size, centre, mat)
		return

	# Split into two segments either side of the opening, plus a lintel above.
	var gap_a := door_off - door_w * 0.5
	var gap_b := door_off + door_w * 0.5
	var left_len: float = maxf(0.0, gap_a + along * 0.5)
	var right_len: float = maxf(0.0, along * 0.5 - gap_b)
	var door_h := 2.1

	var segments: Array = [
		[left_len, -along * 0.5 + left_len * 0.5],
		[right_len, along * 0.5 - right_len * 0.5],
	]
	for part: Array in segments:
		var ln: float = part[0]
		if ln <= 0.01:
			continue
		var at: float = part[1]
		var c := centre
		var s := size
		if side == 0 or side == 2:
			c.x = at
			s.x = ln
		else:
			c.z = at
			s.z = ln
		_add_box(root, s, c, mat)

	# lintel over the doorway
	if h > door_h + 0.1:
		var lh := h - door_h
		var c2 := centre
		var s2 := size
		c2.y = door_h + lh * 0.5
		if side == 0 or side == 2:
			c2.x = door_off
			s2.x = door_w
		else:
			c2.z = door_off
			s2.z = door_w
		s2.y = lh
		_add_box(root, s2, c2, mat)


## Gable roof over a w x d footprint. The ridge runs along the LONGER axis.
static func _roof(
	w: float, d: float, wall_h: float, pitch: float, roof_mat: Material, gable_mat: Material
) -> Node3D:
	var node := Node3D.new()
	var ridge_along_x: bool = w >= d
	var span: float = d if ridge_along_x else w
	var ridge_len: float = w if ridge_along_x else d
	var rise: float = span * pitch
	var over := 0.3  # eave overhang

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var half_span := span * 0.5 + over
	var half_len := ridge_len * 0.5 + over
	var y0 := wall_h
	var y1 := wall_h + rise
	var slope_len: float = sqrt(half_span * half_span + rise * rise)

	# Two slopes. Built in (len, span) space then mapped onto the right axes.
	for s: float in [-1.0, 1.0]:
		var a := _rv(ridge_along_x, -half_len, s * half_span, y0)
		var b := _rv(ridge_along_x, half_len, s * half_span, y0)
		var c := _rv(ridge_along_x, half_len, 0.0, y1)
		var e := _rv(ridge_along_x, -half_len, 0.0, y1)
		# One texture repeat per metre along both roof axes. At the previous
		# half-repeat-per-metre a roof tile rendered about 0.8m across.
		var u1 := half_len * 2.0
		var v1 := slope_len
		if s < 0.0:
			_quad(st, a, Vector2(0, 0), b, Vector2(u1, 0), c, Vector2(u1, v1), e, Vector2(0, v1))
		else:
			_quad(st, b, Vector2(0, 0), a, Vector2(u1, 0), e, Vector2(u1, v1), c, Vector2(0, v1))
	st.generate_normals()
	st.generate_tangents()
	var slopes := MeshInstance3D.new()
	slopes.name = "slopes"
	slopes.mesh = st.commit()
	slopes.material_override = roof_mat
	node.add_child(slopes)

	# Gable triangles close the RIDGE ENDS - the two faces perpendicular to the
	# ridge. Putting them on the eave sides is the roof bug.
	var gt := SurfaceTool.new()
	gt.begin(Mesh.PRIMITIVE_TRIANGLES)
	for s: float in [-1.0, 1.0]:
		var end_len: float = s * ridge_len * 0.5
		var p1 := _rv(ridge_along_x, end_len, -span * 0.5, y0)
		var p2 := _rv(ridge_along_x, end_len, span * 0.5, y0)
		var p3 := _rv(ridge_along_x, end_len, 0.0, y1)
		if s < 0.0:
			gt.set_uv(Vector2(0, 0)); gt.add_vertex(p1)
			gt.set_uv(Vector2(1, 0)); gt.add_vertex(p2)
			gt.set_uv(Vector2(0.5, 1)); gt.add_vertex(p3)
		else:
			gt.set_uv(Vector2(0, 0)); gt.add_vertex(p2)
			gt.set_uv(Vector2(1, 0)); gt.add_vertex(p1)
			gt.set_uv(Vector2(0.5, 1)); gt.add_vertex(p3)
	gt.generate_normals()
	var gables := MeshInstance3D.new()
	gables.name = "gables"
	gables.mesh = gt.commit()
	gables.material_override = gable_mat
	node.add_child(gables)
	return node


## Map (along-ridge, across-ridge, height) into world space.
static func _rv(ridge_along_x: bool, along: float, across: float, y: float) -> Vector3:
	if ridge_along_x:
		return Vector3(along, y, across)
	return Vector3(across, y, along)


static func _quad(
	st: SurfaceTool, a: Vector3, ua: Vector2, b: Vector3, ub: Vector2,
	c: Vector3, uc: Vector2, d: Vector3, ud: Vector2
) -> void:
	st.set_uv(ua); st.add_vertex(a)
	st.set_uv(ub); st.add_vertex(b)
	st.set_uv(uc); st.add_vertex(c)
	st.set_uv(ua); st.add_vertex(a)
	st.set_uv(uc); st.add_vertex(c)
	st.set_uv(ud); st.add_vertex(d)
