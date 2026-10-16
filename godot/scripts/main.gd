## Emberfall - the game root.
##
## Owns startup order, mouse picking, and the click-to-move loop. Everything
## authoritative happens on the PHP server; this decides what to ask for.
##
## Click handling is deliberate, because "it takes two or three clicks" was the
## longest-running complaint in the WebGL client and had two separate causes:
##
##   1. One raycaster was shared between picking and camera occlusion. The
##      camera set its length to its own distance and never reset it, so
##      anything past about fifteen units silently could not be clicked. Here
##      picking uses its own ray with PICK_RANGE and the camera never touches
##      it.
##
##   2. The decision was made on the browser's click event plus a drag flag.
##      Here the decision is made on mouse RELEASE, by how far the pointer
##      travelled: under DRAG_SLOP pixels it is a click, over it is a drag.
extends Node3D

const PICK_RANGE := 4000.0
const DRAG_SLOP := 10.0
const HOVER_INTERVAL := 0.06      ## seconds; hover raycasts are throttled
const MARKER_LIFE := 0.6

const LAYER_TERRAIN := 1
const LAYER_SCENERY := 2
const LAYER_ACTORS := 4

const PLAYER_MODEL := "res://assets/characters/adventurer_male_rigged.glb"

## How much work each loading frame does. Higher loads faster but makes the
## progress line jerkier; these are tuned so a frame stays under about 100ms.
const GRID_ROWS_PER_FRAME := 24
const CHUNKS_PER_FRAME := 2

var player: EmberActor = null
var hud: EmberHUD = null
var remote: Dictionary = {}        ## player id -> EmberActor
var hovered: Dictionary = {}       ## the object under the cursor, or empty

var _press_at := Vector2.ZERO
var _pressed := false
var _hover_accum := 0.0
var _marker_until := 0.0
var _booted := false

@onready var terrain: EmberTerrain = $Terrain
@onready var world_builder: EmberWorldBuilder = $World
@onready var cam_rig: Node3D = $CameraRig
@onready var actors_root: Node3D = $Actors
@onready var marker: Node3D = $ClickMarker
@onready var status_label: Label = $UI/Status
@onready var hover_label: Label = $UI/Hover


func _ready() -> void:
	marker.visible = false
	status_label.text = "Loading..."
	_boot()


## Startup, spread across frames.
##
## Everything here is slow enough to matter: about 295,000 noise samples for the
## height and collision grids, then 64 terrain chunks of roughly 4,600 triangles
## each. Doing it in one call takes a couple of seconds on a desktop and much
## longer in a browser, where a blocked frame is a tab that looks hung. So each
## stage yields between slices and reports where it is, and the player sees a
## progress line instead of a white screen.
func _boot() -> void:
	if not WorldData.ready_ok:
		status_label.text = "Could not load the world data: " + WorldData.load_error
		return

	var rows := WorldData.grid_rows()
	var row := 0
	while true:
		var done := WorldData.build_grids_stepped(row, GRID_ROWS_PER_FRAME)
		row += GRID_ROWS_PER_FRAME
		status_label.text = "Mapping the land... %d%%" % int(
			clampf(float(row) / float(rows), 0.0, 1.0) * 100.0
		)
		await get_tree().process_frame
		if done:
			break

	var total := terrain.chunk_total()
	terrain.begin()
	for i in range(total):
		terrain.build_one(i)
		if i % CHUNKS_PER_FRAME == 0:
			status_label.text = "Building the ground... %d%%" % int(
				float(i) / float(total) * 100.0
			)
			await get_tree().process_frame
	terrain.finish()

	status_label.text = "Placing the world..."
	await get_tree().process_frame
	var stats := world_builder.build(WorldData.world)

	var at := WorldData.spawn_point()
	player = EmberActor.new()
	player.name = "LocalPlayer"
	player.is_local = true
	actors_root.add_child(player)
	player.setup(PLAYER_MODEL, at)
	cam_rig.call("set_target", player)

	_build_hud()
	_booted = true
	_report_build(stats)

	await _connect()


## Create the HUD and give it something to show.
##
## When the server is reachable the load reply fills these in. Offline - which
## is how the project runs straight out of the editor - the panel would
## otherwise be 28 empty squares and 23 ones, and it would be impossible to tell
## a working HUD from a broken one. So a small sample of real items and levels
## from data/items.json is shown instead, clearly labelled in the chat box.
func _build_hud() -> void:
	hud = EmberHUD.new()
	hud.name = "HUD"
	add_child(hud)
	hud.slot_clicked.connect(_on_slot_clicked)
	hud.chat_submitted.connect(_on_chat_submitted)
	hud.log_line("[color=#d8c48a]Emberfall[/color] - build %s" % WorldData.build_stamp)
	_show_offline_sample()


## A readable sample drawn from the real item table, so the panel can be judged.
func _show_offline_sample() -> void:
	var picks: Array = []
	var wanted := [
		"Coins", "Bronze sword", "Wooden shield", "Bronze pickaxe", "Bronze axe",
		"Logs", "Oak logs", "Copper ore", "Tin ore", "Iron ore", "Bronze bar",
		"Raw shrimp", "Shrimp", "Trout", "Bread", "Air rune", "Mind rune",
		"Attack potion", "Marshleaf", "Bones", "Feather", "Sapphire",
	]
	var by_name: Dictionary = {}
	for item: Variant in WorldData.items:
		if item is Dictionary:
			by_name[String((item as Dictionary).get("name", ""))] = item
	var counts := [1250, 1, 1, 1, 1, 28, 14, 63, 41, 9, 7, 22, 5, 3, 2, 500, 320, 2, 6, 11, 85, 1]
	for i in range(wanted.size()):
		var item: Dictionary = by_name.get(String(wanted[i]), {})
		if item.is_empty():
			continue
		picks.append({"id": int(item.get("id", 0)), "n": int(counts[i]) if i < counts.size() else 1})
	hud.set_inventory(picks)

	var levels: Dictionary = {}
	var sample := {
		"attack": 14, "strength": 12, "defence": 11, "hitpoints": 15, "ranged": 8,
		"magic": 7, "prayer": 6, "woodcutting": 21, "mining": 19, "fishing": 17,
		"cooking": 16, "smithing": 13, "crafting": 9, "firemaking": 12,
	}
	for s2: String in EmberHUD.SKILLS:
		levels[s2] = int(sample.get(s2, 1))
	hud.set_skills(levels)

	var weapon: Dictionary = by_name.get("Bronze sword", {})
	var shield: Dictionary = by_name.get("Wooden shield", {})
	hud.set_equipment({
		"weapon": int(weapon.get("id", 0)),
		"shield": int(shield.get("id", 0)),
	})
	hud.set_orb("health", "15")
	hud.set_orb("prayer", "6")
	hud.set_orb("run", "100")
	hud.log_line("[color=#8a8a8a]Not connected to the server - showing sample"
		+ " inventory and levels so the panel can be checked.[/color]")


func _on_slot_clicked(index: int, secondary: bool) -> void:
	if index >= hud.inventory.size():
		return
	var entry: Variant = hud.inventory[index]
	if not entry is Dictionary:
		return
	var item: Dictionary = WorldData.item_by_id.get(int((entry as Dictionary).get("id", 0)), {})
	if item.is_empty():
		return
	hud.log_line("You examine the %s. %s" % [
		String(item.get("name", "item")), String(item.get("desc", ""))
	])
	if secondary:
		return
	# The server decides what using an item does; the client only asks.
	if not Net.token.is_empty():
		var reply := await Net.act("use", {"slot": index})
		if not bool(reply.get("ok", false)):
			hud.log_line("[color=#d88]%s[/color]" % String(reply.get("error", "")))


func _on_chat_submitted(text: String) -> void:
	hud.log_line("[color=#ffffff]You:[/color] " + text)
	if not Net.token.is_empty():
		await Net.say(text)


## Say on screen and in the console what actually got built.
##
## This exists because the first build came back as a flat grey plain and
## nothing in the game said why. Working out that every model in assets/v2 ships
## with a 2x2 grey placeholder texture took pixel analysis of a screenshot and
## a hex dump of the GLBs. A render that cannot describe itself costs a whole
## round trip every time something looks wrong, so now it describes itself.
func _report_build(stats: Dictionary) -> void:
	var tex_ok := terrain.textures_ok()
	var tex_total := terrain.texture_report.size()
	status_label.text = (
		"Build %s  |  %d buildings, %d scenery in %d groups"
		+ "  |  ground textures %d/%d  |  %d%% walkable"
	) % [
		WorldData.build_stamp, stats["buildings"], stats["batched"] + stats["nodes"],
		stats["batches"], tex_ok, tex_total,
		int(round(WorldData.walkable_fraction() * 100.0)),
	]
	if tex_ok < tex_total:
		status_label.text += "  |  GROUND TEXTURES MISSING - see the console"

	print("--- Emberfall build report ---")
	print("world build      : ", WorldData.build_stamp)
	print("terrain chunks   : ", terrain.chunk_count())
	print("terrain surfaces : ", terrain.surfaces_built)
	print("terrain vertices : ", terrain.vertices_built)
	print("ground textures  : ", ", ".join(terrain.texture_report))
	print("buildings        : ", stats["buildings"])
	print("scenery batched  : ", stats["batched"], " in ", stats["batches"], " groups")
	print("scenery as nodes : ", stats["nodes"])
	print("pickable objects : ", stats["pickables"])
	print("walkable         : ", snappedf(WorldData.walkable_fraction() * 100.0, 0.1), "%")
	print("------------------------------")


func _connect() -> void:
	if not await Net.discover_api():
		status_label.text += "  |  offline: no reply from the PHP API"
		return
	# A stale export against a newer server is exactly the cache problem the
	# web client had, so say so loudly rather than desyncing quietly.
	if Net.server_build != "" and Net.server_build != WorldData.build_stamp:
		status_label.text += "  |  BUILD MISMATCH: server %s, this export %s - re-export" % [
			Net.server_build, WorldData.build_stamp
		]
		return
	status_label.text += "  |  server ok"
	if not Net.token.is_empty():
		var r := await Net.load_character()
		if bool(r.get("ok", false)):
			Net.start_sync()
			Net.synced.connect(_on_synced)


## ---------------------------------------------------------------------------
## Input
## ---------------------------------------------------------------------------

func _unhandled_input(event: InputEvent) -> void:
	if not _booted:
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_pressed = true
				_press_at = mb.position
			elif _pressed:
				_pressed = false
				if mb.position.distance_to(_press_at) <= DRAG_SLOP:
					_click(mb.position, false)
		elif mb.button_index == MOUSE_BUTTON_RIGHT and not mb.pressed:
			_click(mb.position, true)


func _process(delta: float) -> void:
	if not _booted:
		return
	_hover_accum += delta
	if _hover_accum >= HOVER_INTERVAL:
		_hover_accum = 0.0
		_update_hover(get_viewport().get_mouse_position())
	if _marker_until > 0.0 and _now() > _marker_until:
		marker.visible = false
		_marker_until = 0.0
	if player != null:
		Net.set_local(
			player.world_pos().x, player.world_pos().y,
			player.rotation.y, "walk" if player.is_moving() else "idle"
		)


func _now() -> float:
	return float(Time.get_ticks_msec()) / 1000.0


## One ray, built fresh, with its own length. Returns the first hit on the
## wanted layers or an empty dictionary.
func _raycast(screen: Vector2, layers: int) -> Dictionary:
	var cam: Camera3D = (cam_rig as Node3D).call("camera")
	if cam == null:
		return {}
	var from := cam.project_ray_origin(screen)
	var dir := cam.project_ray_normal(screen)
	var params := PhysicsRayQueryParameters3D.create(from, from + dir * PICK_RANGE)
	params.collide_with_areas = true
	params.collide_with_bodies = true
	params.collision_mask = layers
	return get_world_3d().direct_space_state.intersect_ray(params)


func _click(screen: Vector2, secondary: bool) -> void:
	# Scenery first: clicking a tree should chop the tree, not walk to the
	# ground behind it.
	var hit := _raycast(screen, LAYER_SCENERY | LAYER_ACTORS)
	if not hit.is_empty():
		var collider: Object = hit.get("collider")
		if collider != null and collider.has_meta("obj"):
			_interact(collider.get_meta("obj"), secondary, hit.get("position", Vector3.ZERO))
			return

	var ground := _raycast(screen, LAYER_TERRAIN)
	if ground.is_empty():
		return
	var p: Vector3 = ground["position"]
	# Round, do not floor: EmberPath's nodes sit on integer coordinates.
	var goal := Vector2i(int(round(p.x)), int(round(p.z)))
	_mark(p, Color(0.95, 0.85, 0.2) if secondary else Color(0.9, 0.2, 0.18))
	if player != null:
		if not player.walk_to(goal):
			status_label.text = "No route there."


## An object was clicked. Walk to it, then ask the server to do the thing - the
## client never decides that gathering succeeded.
func _interact(o: Dictionary, secondary: bool, at: Vector3) -> void:
	_mark(at, Color(0.95, 0.85, 0.2) if secondary else Color(0.9, 0.2, 0.18))
	if player == null:
		return
	var goal := Vector2i(int(round(float(o.get("x", 0)))), int(round(float(o.get("z", 0)))))
	player.walk_to(goal, 1)
	player.face_towards(Vector2(float(o.get("x", 0)), float(o.get("z", 0))))
	var op := _op_for(String(o.get("t", "")))
	if op == "":
		return
	var reply := await Net.act(op, {"id": int(o.get("i", 0))})
	if not bool(reply.get("ok", false)):
		status_label.text = String(reply.get("error", "the server refused that"))


## Which server op a world object maps to. Buildings and bridges are not here
## on purpose: you walk onto a bridge and through a door, you do not "use" them.
func _op_for(t: String) -> String:
	match t:
		"tree": return "gather"
		"rock": return "gather"
		"fish": return "gather"
		"herb": return "gather"
		"flax": return "gather"
		"hunt": return "gather"
		"patch": return "farm"
		"furnace": return "make"
		"anvil": return "make"
		"range": return "cook"
		"campfire": return "cook"
		"bank_booth": return "bank"
		"counter": return "shop"
		"stall": return "thieve"
		"altar": return "prayer"
		"altar_rc": return "runecraft"
		"spinning_wheel": return "make"
		"loom": return "make"
		"agility": return "agility"
	return ""


## A flat cross on the ground, not a 3D flag: the flag standing up in the world
## was the thing to replace.
func _mark(at: Vector3, col: Color) -> void:
	marker.position = at + Vector3(0, 0.06, 0)
	for c in marker.get_children():
		if c is MeshInstance3D:
			var m := (c as MeshInstance3D).material_override as StandardMaterial3D
			if m != null:
				m.albedo_color = col
	marker.visible = true
	_marker_until = _now() + MARKER_LIFE


func _update_hover(screen: Vector2) -> void:
	var hit := _raycast(screen, LAYER_SCENERY | LAYER_ACTORS)
	if hit.is_empty():
		hovered = {}
		hover_label.text = ""
		return
	var collider: Object = hit.get("collider")
	if collider == null or not collider.has_meta("obj"):
		hovered = {}
		hover_label.text = ""
		return
	hovered = collider.get_meta("obj")
	hover_label.text = _label_for(hovered)


## What the cursor is over, in words. There being no hover label at all was a
## specific complaint.
func _label_for(o: Dictionary) -> String:
	var t := String(o.get("t", ""))
	var k := String(o.get("k", ""))
	match t:
		"tree": return "Chop down %s" % (k if k != "" else "tree")
		"rock": return "Mine rocks"
		"fish": return "Fish here"
		"herb": return "Pick herb"
		"flax": return "Pick flax"
		"hunt": return "Hunt here"
		"bank_booth": return "Use bank booth"
		"counter": return "Trade with shopkeeper"
		"altar": return "Pray at altar"
		"altar_rc": return "Craft runes"
		"furnace": return "Use furnace"
		"anvil": return "Smith at anvil"
		"range": return "Cook on range"
		"campfire": return "Cook on fire"
		"patch": return "Tend patch"
		"stall": return "Steal from stall"
		"dungeon": return "Enter dungeon"
	return t.capitalize()


## ---------------------------------------------------------------------------
## Other players
## ---------------------------------------------------------------------------

func _on_synced(reply: Dictionary) -> void:
	if player != null and reply.has("me"):
		var me: Dictionary = reply["me"]
		if me.has("x") and me.has("z"):
			player.server_position(Vector2(float(me["x"]), float(me["z"])))

	var seen: Dictionary = {}
	for id: String in Net.known_player_ids():
		seen[id] = true
		var frame := Net.interpolate(id)
		if frame.is_empty():
			continue
		var a: EmberActor = remote.get(id)
		if a == null:
			a = EmberActor.new()
			a.name = "p_" + id
			actors_root.add_child(a)
			a.setup(PLAYER_MODEL, Vector2(float(frame["x"]), float(frame["z"])))
			remote[id] = a
		a.server_position(Vector2(float(frame["x"]), float(frame["z"])))
		a.rotation.y = float(frame["r"])
	for id: String in remote.keys():
		if not seen.has(id):
			(remote[id] as Node).queue_free()
			remote.erase(id)
