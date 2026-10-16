## Emberfall map editor - the scene root.
##
## Open scenes/map_editor.tscn in Godot and this builds the whole authored world
## as real, selectable nodes: terrain you can see, a marker for every building,
## prop, tree, fence end, NPC post, resource zone and landmark. Move them with
## the normal gizmo, then press Save in the Emberfall Map dock.
##
## Nothing here invents data. Every marker remembers exactly which entry in
## data/authored_world.json it came from, and saving writes those entries back
## in place - so a save with nothing moved reproduces the file byte for byte.
@tool
class_name EmberMapRoot
extends Node3D

signal rebuilt(summary: Dictionary)

## Marker colours per kind, so a glance tells you what you are looking at.
const KIND_COLOUR: Dictionary = {
	EmberMapMarker.Kind.BUILDING: Color(0.95, 0.72, 0.28),
	EmberMapMarker.Kind.PROP: Color(0.42, 0.74, 0.95),
	EmberMapMarker.Kind.TREE: Color(0.36, 0.78, 0.42),
	EmberMapMarker.Kind.FENCE: Color(0.76, 0.62, 0.42),
	EmberMapMarker.Kind.POST: Color(0.92, 0.42, 0.72),
	EmberMapMarker.Kind.ZONE: Color(0.72, 0.52, 0.95),
	EmberMapMarker.Kind.LANDMARK: Color(0.95, 0.42, 0.34),
}

## Draw the real model for these, so a street reads as a street. Everything
## else gets a coloured post, which is quicker to see and quicker to grab.
@export var show_models: bool = true
## Build the terrain mesh under the markers.
##
## OFF by default, and that default matters. Building terrain here meshes
## 147,456 tiles and a 385x385 collider on the editor's main thread. The first
## version did that on open and the editor sat unresponsive for minutes, which
## is impossible to tell apart from a crash - and makes it look as though
## nothing in the scene can be edited. Markers alone load in a second or two,
## and placing things is what this scene is for. Turn terrain on from the
## Emberfall Map dock when you want the landscape for context.
@export var show_terrain: bool = false

var doc: Dictionary = {}
var markers: Array[EmberMapMarker] = []
var last_error: String = ""

var _terrain: EmberTerrain = null
var _markers_root: Node3D = null


func _ready() -> void:
	if Engine.is_editor_hint() and markers.is_empty():
		rebuild()


## Reload the file and rebuild every node under this one.
func rebuild() -> void:
	last_error = ""
	doc = EmberAuthoredIO.load_doc()
	if doc.is_empty():
		last_error = "could not load authored_world.json"
		rebuilt.emit({"error": last_error})
		return

	for c in get_children():
		remove_child(c)
		c.free()
	markers.clear()
	_terrain = null

	if show_terrain:
		_terrain = EmberTerrain.new()
		_terrain.name = "Terrain"
		add_child(_terrain)
		_own(_terrain)
		_terrain.build()

	_markers_root = Node3D.new()
	_markers_root.name = "Markers"
	add_child(_markers_root)
	_own(_markers_root)

	var counts := {
		"buildings": 0, "props": 0, "trees": 0, "fences": 0,
		"posts": 0, "zones": 0, "landmarks": 0,
	}

	var order: Array = doc.get("townOrder", doc.get("towns", {}).keys())
	for town_key: String in order:
		var town: Dictionary = doc.get("towns", {}).get(town_key, {})
		if town.is_empty():
			continue
		var group := Node3D.new()
		group.name = String(town.get("name", town_key))
		_markers_root.add_child(group)
		_own(group)
		counts["buildings"] += _add_buildings(group, town_key, town)
		counts["props"] += _add_props(group, town_key, town)
		counts["trees"] += _add_trees(group, town_key, town)
		counts["fences"] += _add_fences(group, town_key, town)
		counts["posts"] += _add_posts(group, town_key, town)

	var res_group := Node3D.new()
	res_group.name = "Resources"
	_markers_root.add_child(res_group)
	_own(res_group)
	counts["zones"] = _add_zones(res_group)
	counts["landmarks"] = _add_landmarks(res_group)

	rebuilt.emit(counts)


## Give a node an owner so the editor can select it.
##
## This is load-bearing, not housekeeping. The editor's Scene dock and its 3D
## gizmos only operate on nodes owned by the edited scene root, so a marker
## without an owner is visible and completely un-draggable - which would defeat
## the entire point of this scene.
##
## The cost is that saving map_editor.tscn writes a snapshot of the markers into
## it. That is harmless: rebuild() deletes every child and reloads from
## data/authored_world.json each time the scene is opened, so the JSON is always
## the source of truth and the snapshot is always thrown away. You never need to
## save this scene.
func _own(n: Node) -> void:
	if not Engine.is_editor_hint():
		return
	var root := get_tree().edited_scene_root
	if root == null or root == n:
		return
	n.owner = root


## ---------------------------------------------------------------------------
## Markers
## ---------------------------------------------------------------------------

func _marker(
	parent: Node3D, kind: EmberMapMarker.Kind, town_key: String, index: int,
	at: Vector2, yaw: float, label: String, sub_key: String = ""
) -> EmberMapMarker:
	var m := EmberMapMarker.new()
	m.kind = kind
	m.town_key = town_key
	m.entry_index = index
	m.sub_key = sub_key
	m.label = label
	m.name = _safe_name(label, index)
	parent.add_child(m)
	_own(m)
	m.place(at, yaw)
	markers.append(m)
	return m


## Node names cannot contain . : @ / " % and must not be empty.
func _safe_name(label: String, index: int) -> String:
	var s := label.strip_edges()
	for bad in [".", ":", "@", "/", "\"", "%"]:
		s = s.replace(bad, "")
	s = s.replace(" ", "_")
	if s.is_empty():
		s = "entry"
	return "%s_%d" % [s, index]


## A coloured post plus a floor pad, so the thing is easy to see from the
## editor's usual high angle and easy to click.
func _handle(parent: Node3D, kind: EmberMapMarker.Kind, size: Vector2) -> void:
	var col: Color = KIND_COLOUR.get(kind, Color.WHITE)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = col
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var post := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.18
	cyl.bottom_radius = 0.18
	cyl.height = 3.0
	post.mesh = cyl
	post.position = Vector3(0, 1.5, 0)
	post.material_override = mat
	parent.add_child(post)

	var pad := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(maxf(size.x, 0.8), 0.08, maxf(size.y, 0.8))
	pad.mesh = box
	pad.position = Vector3(0, 0.05, 0)
	var pad_mat := StandardMaterial3D.new()
	pad_mat.albedo_color = Color(col.r, col.g, col.b, 0.35)
	pad_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pad_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pad.material_override = pad_mat
	parent.add_child(pad)


func _add_buildings(group: Node3D, town_key: String, town: Dictionary) -> int:
	var list: Array = town.get("buildings", [])
	for i in range(list.size()):
		var b: Dictionary = list[i]
		var at := Vector2(float(b.get("x", 0)), float(b.get("z", 0)))
		var m := _marker(
			group, EmberMapMarker.Kind.BUILDING, town_key, i, at,
			float(b.get("rot", 0.0)), String(b.get("name", "building"))
		)
		_handle(m, EmberMapMarker.Kind.BUILDING,
			Vector2(float(b.get("w", 8)), float(b.get("d", 8))))
		if show_models:
			var node := EmberProps.make_building(b)
			node.name = "preview"
			m.add_child(node)
		_door_arrow(m, b)
	return list.size()


## A wedge on the door side, because a door facing a neighbour's wall is the
## single most common authoring mistake and it is invisible from above.
func _door_arrow(m: EmberMapMarker, b: Dictionary) -> void:
	var door: Array = b.get("door", [0, 0])
	var side: int = int(door[0]) if door.size() > 0 else 0
	var off: float = float(door[1]) if door.size() > 1 else 0.0
	var w := float(b.get("w", 8))
	var d := float(b.get("d", 8))
	var at := Vector3.ZERO
	match side:
		0: at = Vector3(off, 0.2, d * 0.5 + 1.0)
		1: at = Vector3(w * 0.5 + 1.0, 0.2, off)
		2: at = Vector3(off, 0.2, -d * 0.5 - 1.0)
		_: at = Vector3(-w * 0.5 - 1.0, 0.2, off)
	var mi := MeshInstance3D.new()
	mi.name = "door"
	var box := BoxMesh.new()
	box.size = Vector3(1.4, 0.12, 1.4)
	mi.mesh = box
	mi.position = at
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1.0, 1.0, 0.35)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mi.material_override = mat
	m.add_child(mi)


func _add_props(group: Node3D, town_key: String, town: Dictionary) -> int:
	var list: Array = town.get("props", [])
	for i in range(list.size()):
		var p: Dictionary = list[i]
		var kind: String = String(p.get("kind", p.get("t", "prop")))
		var at := Vector2(float(p.get("x", 0)), float(p.get("z", 0)))
		var m := _marker(group, EmberMapMarker.Kind.PROP, town_key, i, at, 0.0, kind)
		_handle(m, EmberMapMarker.Kind.PROP, Vector2(1.0, 1.0))
		if show_models:
			var node := EmberProps.make_object({"t": kind})
			if node != null:
				node.name = "preview"
				m.add_child(node)
	return list.size()


func _add_trees(group: Node3D, town_key: String, town: Dictionary) -> int:
	var list: Array = town.get("trees", [])
	for i in range(list.size()):
		var t: Dictionary = list[i]
		var at := Vector2(float(t.get("x", 0)), float(t.get("z", 0)))
		var m := _marker(
			group, EmberMapMarker.Kind.TREE, town_key, i, at, 0.0,
			String(t.get("kind", "Tree"))
		)
		_handle(m, EmberMapMarker.Kind.TREE, Vector2(1.0, 1.0))
		if show_models:
			var node := EmberProps.make_object({"t": "tree", "k": String(t.get("kind", "Tree"))})
			if node != null:
				node.name = "preview"
				m.add_child(node)
	return list.size()


## A fence run is a line, so it gets two markers - one per end - and a bar
## between them that follows whichever end you drag.
func _add_fences(group: Node3D, town_key: String, town: Dictionary) -> int:
	var list: Array = town.get("fences", [])
	for i in range(list.size()):
		var f: Dictionary = list[i]
		var a: Array = f.get("from", [0, 0])
		var b: Array = f.get("to", [0, 0])
		var pa := Vector2(float(a[0]), float(a[1]))
		var pb := Vector2(float(b[0]), float(b[1]))
		var ma := _marker(
			group, EmberMapMarker.Kind.FENCE, town_key, i, pa, 0.0, "fence%d_from" % i, "from"
		)
		_handle(ma, EmberMapMarker.Kind.FENCE, Vector2(0.8, 0.8))
		var mb := _marker(
			group, EmberMapMarker.Kind.FENCE, town_key, i, pb, 0.0, "fence%d_to" % i, "to"
		)
		_handle(mb, EmberMapMarker.Kind.FENCE, Vector2(0.8, 0.8))
	return list.size()


func _add_posts(group: Node3D, town_key: String, town: Dictionary) -> int:
	var posts: Dictionary = town.get("posts", {})
	var i := 0
	for key: String in posts.keys():
		var p: Dictionary = posts[key]
		var at := Vector2(float(p.get("x", 0)), float(p.get("z", 0)))
		var m := _marker(group, EmberMapMarker.Kind.POST, town_key, i, at, 0.0, key, key)
		_handle(m, EmberMapMarker.Kind.POST, Vector2(0.9, 0.9))
		i += 1
	return posts.size()


func _add_zones(group: Node3D) -> int:
	var zones: Array = doc.get("resources", {}).get("zones", [])
	for i in range(zones.size()):
		var z: Dictionary = zones[i]
		var at := Vector2(float(z.get("x", 0)), float(z.get("z", 0)))
		var m := _marker(
			group, EmberMapMarker.Kind.ZONE, "", i, at, 0.0,
			String(z.get("name", "zone"))
		)
		var r: float = float(z.get("r", 8.0))
		_handle(m, EmberMapMarker.Kind.ZONE, Vector2(r * 2.0, r * 2.0))
	return zones.size()


func _add_landmarks(group: Node3D) -> int:
	var marks: Array = doc.get("resources", {}).get("landmarks", [])
	for i in range(marks.size()):
		var l: Dictionary = marks[i]
		var at := Vector2(float(l.get("x", 0)), float(l.get("z", 0)))
		var m := _marker(
			group, EmberMapMarker.Kind.LANDMARK, "", i, at, 0.0,
			String(l.get("t", l.get("name", "landmark")))
		)
		_handle(m, EmberMapMarker.Kind.LANDMARK, Vector2(1.2, 1.2))
		if show_models:
			var node := EmberProps.make_object(l)
			if node != null:
				node.name = "preview"
				m.add_child(node)
	return marks.size()


## ---------------------------------------------------------------------------
## Saving
## ---------------------------------------------------------------------------

## Copy every marker's position back into the document and write it out.
## Returns a summary: {moved: n, saved: bool, error: "..."}.
func save() -> Dictionary:
	if doc.is_empty():
		return {"moved": 0, "saved": false, "error": "nothing loaded"}
	var moved := 0
	for m in markers:
		if _apply(m):
			moved += 1
	var err := EmberAuthoredIO.save_doc(doc)
	if err != "":
		return {"moved": moved, "saved": false, "error": err}
	for m in markers:
		m.clear_moved()
	return {"moved": moved, "saved": true, "error": ""}


## Write one marker's position into its entry. Returns true if anything changed.
func _apply(m: EmberMapMarker) -> bool:
	var at := m.tile_position()
	var town: Dictionary = doc.get("towns", {}).get(m.town_key, {})
	match m.kind:
		EmberMapMarker.Kind.BUILDING:
			return _set_xz(_entry(town, "buildings", m.entry_index), at, m.yaw_radians())
		EmberMapMarker.Kind.PROP:
			return _set_xz(_entry(town, "props", m.entry_index), at)
		EmberMapMarker.Kind.TREE:
			return _set_xz(_entry(town, "trees", m.entry_index), at)
		EmberMapMarker.Kind.FENCE:
			var f: Dictionary = _entry(town, "fences", m.entry_index)
			if f.is_empty():
				return false
			var key: String = "from" if m.sub_key == "from" else "to"
			var old: Array = f.get(key, [0, 0])
			if is_equal_approx(float(old[0]), at.x) and is_equal_approx(float(old[1]), at.y):
				return false
			f[key] = [at.x, at.y]
			return true
		EmberMapMarker.Kind.POST:
			var posts: Dictionary = town.get("posts", {})
			if not posts.has(m.sub_key):
				return false
			return _set_xz(posts[m.sub_key], at)
		EmberMapMarker.Kind.ZONE:
			return _set_xz(_res_entry("zones", m.entry_index), at)
		EmberMapMarker.Kind.LANDMARK:
			return _set_xz(_res_entry("landmarks", m.entry_index), at)
	return false


func _entry(town: Dictionary, collection: String, index: int) -> Dictionary:
	var list: Array = town.get(collection, [])
	if index < 0 or index >= list.size():
		return {}
	return list[index]


func _res_entry(collection: String, index: int) -> Dictionary:
	var list: Array = doc.get("resources", {}).get(collection, [])
	if index < 0 or index >= list.size():
		return {}
	return list[index]


## Set x/z (and optionally rot) on an entry, keeping the key order the file
## already has. Returns true if a value actually changed.
func _set_xz(entry: Dictionary, at: Vector2, yaw: float = NAN) -> bool:
	if entry.is_empty():
		return false
	var changed := false
	if not is_equal_approx(float(entry.get("x", 0)), at.x):
		entry["x"] = at.x
		changed = true
	if not is_equal_approx(float(entry.get("z", 0)), at.y):
		entry["z"] = at.y
		changed = true
	if not is_nan(yaw) and not is_equal_approx(float(entry.get("rot", 0.0)), yaw):
		entry["rot"] = yaw
		changed = true
	return changed


## ---------------------------------------------------------------------------
## Adding
## ---------------------------------------------------------------------------

## Add a new entry to a town and rebuild. `what` is "building", "prop" or
## "tree"; `kind` is the prop or tree kind and is ignored for buildings.
func add_entry(town_key: String, what: String, kind: String, at: Vector2) -> String:
	var towns: Dictionary = doc.get("towns", {})
	if not towns.has(town_key):
		return "no town called " + town_key
	var town: Dictionary = towns[town_key]
	match what:
		"building":
			if not town.has("buildings"):
				town["buildings"] = []
			(town["buildings"] as Array).append(EmberAuthoredIO.new_building(at))
		"prop":
			if not town.has("props"):
				town["props"] = []
			(town["props"] as Array).append(EmberAuthoredIO.new_prop(kind, at))
		"tree":
			if not town.has("trees"):
				town["trees"] = []
			(town["trees"] as Array).append(EmberAuthoredIO.new_tree(kind, at))
		_:
			return "cannot add a " + what
	return ""


## Remove whatever a marker points at. Indices shift, so this rebuilds after.
func remove_marker(m: EmberMapMarker) -> String:
	var town: Dictionary = doc.get("towns", {}).get(m.town_key, {})
	match m.kind:
		EmberMapMarker.Kind.BUILDING:
			return _erase(town, "buildings", m.entry_index)
		EmberMapMarker.Kind.PROP:
			return _erase(town, "props", m.entry_index)
		EmberMapMarker.Kind.TREE:
			return _erase(town, "trees", m.entry_index)
		EmberMapMarker.Kind.FENCE:
			return _erase(town, "fences", m.entry_index)
		EmberMapMarker.Kind.POST:
			var posts: Dictionary = town.get("posts", {})
			if posts.has(m.sub_key):
				posts.erase(m.sub_key)
				return ""
			return "no such post"
	return "that kind cannot be removed here - edit data/authored_world.json"


func _erase(town: Dictionary, collection: String, index: int) -> String:
	var list: Array = town.get(collection, [])
	if index < 0 or index >= list.size():
		return "index out of range"
	list.remove_at(index)
	return ""
