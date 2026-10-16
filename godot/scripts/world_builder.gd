## Emberfall - places everything in data/world.json into the scene.
##
## Scenery that repeats (284 trees, 49 rocks, 26 fence posts) is drawn with
## MultiMeshInstance3D so the whole world is a few dozen draw calls instead of a
## few hundred nodes.
##
## Two traps from the WebGL client that have exact equivalents here:
##
##   * An instanced batch keeps its base mesh's bounds, so the renderer culls
##     the whole batch at once when the origin leaves the frustum - which is why
##     entire forests vanished at certain camera angles. Godot has the same
##     behaviour, so every MultiMeshInstance3D below gets a custom AABB that
##     actually covers its instances.
##
##   * Picking has to work against the instances too. MultiMesh instances carry
##     no colliders, so each pickable object also gets a small Area3D on the
##     picking layer. That is what makes a tree clickable.
@tool
class_name EmberWorldBuilder
extends Node3D

## Object types drawn as instanced batches, keyed by the mesh they share.
const BATCHED: Array[String] = ["tree", "rock", "fence"]

## Pick radius per type, in tiles. Bigger than the mesh so a click near the
## trunk still counts.
const PICK_RADIUS: Dictionary = {
	"tree": 1.1, "rock": 1.0, "fence": 0.5, "fish": 1.4, "herb": 0.7,
}
const DEFAULT_PICK_RADIUS := 0.9

## Collision layers, matching project.godot: 1 terrain, 2 scenery, 3 actors,
## 4 buildings.
const LAYER_SCENERY := 2
const LAYER_BUILDINGS := 8

var batches: Dictionary = {}          ## batch key -> MultiMeshInstance3D
var pickables: Dictionary = {}        ## object id -> Area3D
var buildings: Dictionary = {}        ## building id -> Node3D

var _scenery_root: Node3D = null
var _building_root: Node3D = null
var _pick_root: Node3D = null


func build(world: Dictionary) -> Dictionary:
	_clear()
	_scenery_root = _child("Scenery")
	_building_root = _child("Buildings")
	_pick_root = _child("Pickables")

	var stats := {"batched": 0, "nodes": 0, "buildings": 0, "pickables": 0, "batches": 0}
	var grouped := _group_objects(world.get("objects", []))

	for key: String in grouped.keys():
		var list: Array = grouped[key]
		var parts := key.split("|")
		var kind := parts[0]
		if BATCHED.has(kind):
			if _build_batch(key, kind, parts[1] if parts.size() > 1 else "", list):
				stats["batched"] += list.size()
				stats["batches"] += 1
				continue
		# Not batchable (no mesh resolved, or a one-off type): place real nodes.
		for o: Dictionary in list:
			var n := EmberProps.make_object(o)
			if n == null:
				continue
			_seat(n, o)
			_scenery_root.add_child(n)
			_own(n)
			stats["nodes"] += 1

	for o: Variant in world.get("objects", []):
		if o is Dictionary and _is_pickable(String(o.get("t", ""))):
			_add_pick(o)
			stats["pickables"] += 1

	for b: Variant in world.get("buildings", []):
		if not b is Dictionary:
			continue
		var node := EmberProps.make_building(b)
		node.name = "b%d" % int(b.get("id", 0))
		node.position = Vector3(
			float(b.get("x", 0)), float(b.get("y", 0.0)), float(b.get("z", 0))
		)
		node.rotation.y = float(b.get("rot", 0.0))
		_building_root.add_child(node)
		_own(node)
		buildings[int(b.get("id", 0))] = node
		stats["buildings"] += 1

	return stats


## ---------------------------------------------------------------------------

func _clear() -> void:
	for c in get_children():
		c.queue_free()
	batches.clear()
	pickables.clear()
	buildings.clear()


func _child(n: String) -> Node3D:
	var node := Node3D.new()
	node.name = n
	add_child(node)
	_own(node)
	return node


func _own(n: Node) -> void:
	if Engine.is_editor_hint():
		var root := get_tree().edited_scene_root
		if root != null:
			n.owner = root


## Group by type and sub-kind, so every oak shares one batch and every willow
## another.
func _group_objects(objects: Array) -> Dictionary:
	var out: Dictionary = {}
	for o: Variant in objects:
		if not o is Dictionary:
			continue
		var t := String(o.get("t", ""))
		var k := String(o.get("k", ""))
		var key: String = t + "|" + k
		if not out.has(key):
			out[key] = []
		out[key].append(o)
	return out


## Resolve one shared mesh for a kind by instancing its model once, pulling the
## meshes out, and throwing the instance away. Returns [] when there is no model
## and the caller should fall back to real nodes.
func _collect_meshes(kind: String, sub: String) -> Array:
	var probe: Node3D = EmberProps.make_object({"t": kind, "k": sub})
	if probe == null:
		return []
	var found: Array = []
	_gather(probe, Transform3D.IDENTITY, found)
	probe.free()
	return found


func _gather(n: Node, xform: Transform3D, out: Array) -> void:
	var here := xform
	if n is Node3D:
		here = xform * (n as Node3D).transform
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		if mi.mesh != null:
			var mats: Array = []
			for s in range(mi.mesh.get_surface_count()):
				mats.append(mi.get_active_material(s))
			out.append({"mesh": mi.mesh, "xform": here, "mats": mats})
	for c in n.get_children():
		_gather(c, here, out)


## One MultiMeshInstance3D per (kind, sub-mesh). A model made of two primitives
## - bark and foliage - becomes two batches that move together.
func _build_batch(key: String, kind: String, sub: String, list: Array) -> bool:
	var parts := _collect_meshes(kind, sub)
	if parts.is_empty():
		return false

	var bounds := AABB()
	var first := true
	for o: Dictionary in list:
		var p := Vector3(float(o.get("x", 0)), float(o.get("y", 0.0)), float(o.get("z", 0)))
		if first:
			bounds = AABB(p, Vector3.ZERO)
			first = false
		else:
			bounds = bounds.expand(p)
	# Grow it generously: instances are meshes, not points, and a tight AABB
	# clips the tallest tree in the batch as the camera turns.
	bounds = bounds.grow(14.0)

	var made := 0
	for pi in range(parts.size()):
		var part: Dictionary = parts[pi]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = _mesh_with_mats(part["mesh"], part["mats"])
		mm.instance_count = list.size()
		for i in range(list.size()):
			var o: Dictionary = list[i]
			var sc: float = float(o.get("sc", 1.0))
			var rot: float = float(o.get("rot", 0.0))
			var at := Vector3(
				float(o.get("x", 0)), float(o.get("y", 0.0)), float(o.get("z", 0))
			)
			var basis := Basis(Vector3.UP, rot).scaled(Vector3(sc, sc, sc))
			mm.set_instance_transform(i, Transform3D(basis, at) * part["xform"])

		var mmi := MultiMeshInstance3D.new()
		mmi.name = "%s_%d" % [key.replace("|", "_"), pi]
		mmi.multimesh = mm
		# This is the fix for whole batches vanishing: give the instance a
		# bounding box that covers where the instances actually are.
		mmi.custom_aabb = AABB(bounds.position - global_position, bounds.size)
		mmi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		# NO material_override here. It replaces the material on EVERY surface
		# of the mesh with one material, so a tree whose mesh carries bark on
		# surface 0 and foliage on surface 1 came out entirely bark-coloured -
		# which is why the first build rendered 284 trees as dark solid lumps.
		# The per-surface materials are baked onto the mesh in _mesh_with_mats()
		# instead, because a MultiMesh has no per-surface override.
		_scenery_root.add_child(mmi)
		_own(mmi)
		batches[mmi.name] = mmi
		made += 1
	return made > 0


## A copy of `mesh` with `mats` written onto its surfaces.
##
## A MultiMesh draws every surface of its mesh and offers no per-surface
## material override, so the materials have to live on the mesh itself. The
## glTF importer usually puts them there already, but it can also leave them on
## the MeshInstance3D, in which case the mesh's own surfaces come back null and
## everything draws in Godot's default white. This copies whatever
## get_active_material() reported onto a fresh ArrayMesh so the batch draws the
## same as the single instance would.
func _mesh_with_mats(mesh: Mesh, mats: Array) -> Mesh:
	var out := ArrayMesh.new()
	for i in range(mesh.get_surface_count()):
		out.add_surface_from_arrays(
			Mesh.PRIMITIVE_TRIANGLES, mesh.surface_get_arrays(i)
		)
		if i < mats.size() and mats[i] != null:
			out.surface_set_material(i, mats[i])
	return out


func _is_pickable(t: String) -> bool:
	return t != "" and t != "fence"


## A small sphere on the scenery layer so the object can be clicked. The mesh
## itself is in a MultiMesh and has no collider of its own.
func _add_pick(o: Dictionary) -> void:
	var t := String(o.get("t", ""))
	var r: float = float(PICK_RADIUS.get(t, DEFAULT_PICK_RADIUS))
	var area := Area3D.new()
	area.name = "p%d" % int(o.get("i", 0))
	area.collision_layer = LAYER_SCENERY
	area.collision_mask = 0
	area.input_ray_pickable = true
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = r
	shape.shape = sphere
	shape.position = Vector3(0, r * 0.9, 0)
	area.add_child(shape)
	area.position = Vector3(float(o.get("x", 0)), float(o.get("y", 0.0)), float(o.get("z", 0)))
	# What the click handler needs to know, carried on the node itself.
	area.set_meta("obj", o)
	_pick_root.add_child(area)
	_own(area)
	if Engine.is_editor_hint():
		shape.owner = get_tree().edited_scene_root
	pickables[int(o.get("i", 0))] = area


## Seat an object on the ground. The authored y in world.json is the terrain
## height the Node pipeline computed, so it already matches; this only fills in
## the gap for objects that have no y.
func _seat(n: Node3D, o: Dictionary) -> void:
	var x := float(o.get("x", 0))
	var z := float(o.get("z", 0))
	var y: float = float(o["y"]) if o.has("y") else EmberTerrainDef.height(x, z)
	n.position = Vector3(x, y, z)
	n.rotation.y = float(o.get("rot", 0.0))
	var sc: float = float(o.get("sc", 1.0))
	if not is_equal_approx(sc, 1.0):
		n.scale = Vector3(sc, sc, sc)
