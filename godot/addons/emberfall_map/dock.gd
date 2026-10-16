## Emberfall map editor - the dock.
##
## Built in code rather than as a .tscn so there is no scene file to get out of
## step with the script, and so the whole plugin is readable in one place.
##
## What it does: reload the authored world, report what is in it, save moved
## markers back to data/authored_world.json, add new entries, and jump the
## editor camera to a settlement. It also runs the Node validator if Node is on
## PATH, because a map edit that breaks the validator should be caught here
## rather than three steps later.
@tool
extends VBoxContainer

const TOWN_LABELS: Dictionary = {
	"OAKHEART": "Oakheart", "ALDERMERE": "Aldermere", "DUNHOLLOW": "Dunhollow",
	"SALTBROOK": "Saltbrook", "MIREFEN": "Mirefen", "BLIGHTFORT": "Blightfort",
	"OUTPOSTS": "Outposts",
}

const PROP_KINDS: Array[String] = [
	"well", "barrel", "crate", "sign", "stall", "cart", "brazier", "campfire",
	"standing_stone", "statue", "fountain", "anvil", "furnace", "range",
	"counter", "bank_booth", "altar", "altar_rc", "spinning_wheel", "loom",
]
const TREE_KINDS: Array[String] = [
	"Tree", "Oak", "Willow", "Silverbirch", "Ironbark", "Ghostwood",
]

var map_root: EmberMapRoot = null

var _status: RichTextLabel
var _town: OptionButton
var _what: OptionButton
var _kind: OptionButton
var _at_x: SpinBox
var _at_z: SpinBox
var _validate_out: RichTextLabel


func _ready() -> void:
	name = "Emberfall Map"
	_build_ui()
	_say("[b]Emberfall map editor[/b]\nOpen [code]scenes/map_editor.tscn[/code], then press Reload.")


func _build_ui() -> void:
	add_theme_constant_override("separation", 6)

	_status = RichTextLabel.new()
	_status.bbcode_enabled = true
	_status.fit_content = true
	_status.custom_minimum_size = Vector2(0, 110)
	add_child(_status)

	add_child(_hsep())

	var row := HBoxContainer.new()
	add_child(row)
	row.add_child(_button("Reload from JSON", _on_reload))
	row.add_child(_button("Save to JSON", _on_save))

	var row2 := HBoxContainer.new()
	add_child(row2)
	row2.add_child(_button("Run validator", _on_validate))
	row2.add_child(_button("Toggle models", _on_toggle_models))

	add_child(_hsep())

	var jump := HBoxContainer.new()
	add_child(jump)
	var jump_label := Label.new()
	jump_label.text = "Go to"
	jump.add_child(jump_label)
	_town = OptionButton.new()
	for key: String in TOWN_LABELS.keys():
		_town.add_item(String(TOWN_LABELS[key]))
		_town.set_item_metadata(_town.item_count - 1, key)
	jump.add_child(_town)
	jump.add_child(_button("Jump", _on_jump))

	add_child(_hsep())

	var add_label := Label.new()
	add_label.text = "Add to the selected settlement"
	add_child(add_label)

	var add_row := HBoxContainer.new()
	add_child(add_row)
	_what = OptionButton.new()
	for w in ["building", "prop", "tree"]:
		_what.add_item(w)
	_what.item_selected.connect(_on_what_changed)
	add_row.add_child(_what)
	_kind = OptionButton.new()
	add_row.add_child(_kind)
	_refresh_kinds()

	var at_row := HBoxContainer.new()
	add_child(at_row)
	var lx := Label.new()
	lx.text = "x"
	at_row.add_child(lx)
	_at_x = _spin()
	at_row.add_child(_at_x)
	var lz := Label.new()
	lz.text = "z"
	at_row.add_child(lz)
	_at_z = _spin()
	at_row.add_child(_at_z)
	at_row.add_child(_button("Add", _on_add))

	add_child(_button("Delete selected marker", _on_delete))

	add_child(_hsep())

	_validate_out = RichTextLabel.new()
	_validate_out.bbcode_enabled = true
	_validate_out.fit_content = true
	_validate_out.custom_minimum_size = Vector2(0, 150)
	_validate_out.selection_enabled = true
	add_child(_validate_out)


func _spin() -> SpinBox:
	var s := SpinBox.new()
	s.min_value = 0
	s.max_value = EmberTerrainDef.WORLD
	s.step = 0.5
	s.value = 160
	s.custom_minimum_size = Vector2(80, 0)
	return s


func _button(text: String, handler: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(handler)
	return b


func _hsep() -> HSeparator:
	return HSeparator.new()


func _say(text: String) -> void:
	_status.text = text


## ---------------------------------------------------------------------------
## Finding the map scene
## ---------------------------------------------------------------------------

## The dock does not keep a reference across scene changes, because the editor
## frees the scene out from under it. It looks the root up each time instead.
func _find_root() -> EmberMapRoot:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return null
	var root := tree.edited_scene_root
	if root is EmberMapRoot:
		return root
	if root != null:
		for c in root.get_children():
			if c is EmberMapRoot:
				return c
	return null


func _require_root() -> EmberMapRoot:
	var r := _find_root()
	if r == null:
		_say("[color=#d88]No map scene open.[/color]\nOpen [code]scenes/map_editor.tscn[/code] first.")
	return r


## ---------------------------------------------------------------------------
## Actions
## ---------------------------------------------------------------------------

func _on_reload() -> void:
	var r := _require_root()
	if r == null:
		return
	r.rebuild()
	_report(r)


func _report(r: EmberMapRoot) -> void:
	if r.last_error != "":
		_say("[color=#d88]%s[/color]" % r.last_error)
		return
	var counts := {
		"buildings": 0, "props": 0, "trees": 0, "fences": 0,
		"posts": 0, "zones": 0, "landmarks": 0,
	}
	for m in r.markers:
		match m.kind:
			EmberMapMarker.Kind.BUILDING: counts["buildings"] += 1
			EmberMapMarker.Kind.PROP: counts["props"] += 1
			EmberMapMarker.Kind.TREE: counts["trees"] += 1
			EmberMapMarker.Kind.FENCE: counts["fences"] += 1
			EmberMapMarker.Kind.POST: counts["posts"] += 1
			EmberMapMarker.Kind.ZONE: counts["zones"] += 1
			EmberMapMarker.Kind.LANDMARK: counts["landmarks"] += 1
	_say(
		"[b]Loaded[/b] %s\n%d buildings, %d props, %d trees, %d fence ends,\n"
		% [EmberAuthoredIO.source_description().get_file(), counts["buildings"],
			counts["props"], counts["trees"], counts["fences"]]
		+ "%d npc posts, %d zones, %d landmarks\n" % [
			counts["posts"], counts["zones"], counts["landmarks"]]
		+ "[i]Drag markers with the move gizmo, then Save.[/i]"
	)


func _on_save() -> void:
	var r := _require_root()
	if r == null:
		return
	var result := r.save()
	if not bool(result["saved"]):
		_say("[color=#d88]Not saved: %s[/color]" % result["error"])
		return
	# Godot caches res:// files; tell the editor the mirror changed so a
	# reload does not read a stale copy.
	EditorInterface.get_resource_filesystem().scan()
	_say(
		"[color=#8d8]Saved.[/color] %d entr%s moved.\n" % [
			result["moved"], "y" if int(result["moved"]) == 1 else "ies"]
		+ "Now run:\n[code]node tools/apply_towns.js\nnode tools/apply_resources.js\n"
		+ "node tools/bake.js\nnode tools/validate_world.js[/code]"
	)


func _on_toggle_models() -> void:
	var r := _require_root()
	if r == null:
		return
	r.show_models = not r.show_models
	r.rebuild()
	_say("Models %s. Rebuilt." % ("on" if r.show_models else "off"))


func _on_jump() -> void:
	var r := _require_root()
	if r == null:
		return
	var key := String(_town.get_item_metadata(_town.selected))
	var town: Dictionary = r.doc.get("towns", {}).get(key, {})
	if town.is_empty():
		_say("[color=#d88]No settlement called %s in the file.[/color]" % key)
		return
	var centre: Dictionary = town.get("centre", {})
	var x := float(centre.get("x", 160))
	var z := float(centre.get("z", 268))
	_at_x.value = x
	_at_z.value = z
	# There is no API to move the editor camera directly, so this selects the
	# nearest marker instead and the editor frames it with the usual F key.
	var best: EmberMapMarker = null
	var best_d := INF
	for m in r.markers:
		if m.town_key != key:
			continue
		var d := m.tile_position().distance_to(Vector2(x, z))
		if d < best_d:
			best_d = d
			best = m
	if best == null:
		_say("Settlement %s has no markers." % key)
		return
	EditorInterface.get_selection().clear()
	EditorInterface.get_selection().add_node(best)
	_say("Selected [b]%s[/b] in %s. Press F in the viewport to frame it." % [best.label, key])


func _on_what_changed(_index: int) -> void:
	_refresh_kinds()


func _refresh_kinds() -> void:
	_kind.clear()
	var what := _what.get_item_text(_what.selected) if _what.selected >= 0 else "prop"
	match what:
		"prop":
			for k in PROP_KINDS:
				_kind.add_item(k)
		"tree":
			for k in TREE_KINDS:
				_kind.add_item(k)
		_:
			_kind.add_item("(n/a)")


func _on_add() -> void:
	var r := _require_root()
	if r == null:
		return
	var key := String(_town.get_item_metadata(_town.selected))
	var what := _what.get_item_text(_what.selected)
	var kind := _kind.get_item_text(_kind.selected) if _kind.selected >= 0 else ""
	var at := Vector2(float(_at_x.value), float(_at_z.value))
	var err := r.add_entry(key, what, kind, at)
	if err != "":
		_say("[color=#d88]%s[/color]" % err)
		return
	var result := r.save()
	r.rebuild()
	if bool(result["saved"]):
		_say("Added a %s at %.1f, %.1f in %s and saved." % [what, at.x, at.y, key])
	else:
		_say("[color=#d88]Added, but not saved: %s[/color]" % result["error"])


func _on_delete() -> void:
	var r := _require_root()
	if r == null:
		return
	var selected := EditorInterface.get_selection().get_selected_nodes()
	var target: EmberMapMarker = null
	for n in selected:
		if n is EmberMapMarker:
			target = n
			break
	if target == null:
		_say("[color=#d88]Select a marker in the viewport first.[/color]")
		return
	var what := target.label
	var err := r.remove_marker(target)
	if err != "":
		_say("[color=#d88]%s[/color]" % err)
		return
	var result := r.save()
	r.rebuild()
	if bool(result["saved"]):
		_say("Removed [b]%s[/b] and saved." % what)
	else:
		_say("[color=#d88]Removed, but not saved: %s[/color]" % result["error"])


## Run the Node validator and show its output. If Node is not on PATH this says
## so rather than pretending the world is fine.
func _on_validate() -> void:
	var project_dir := ProjectSettings.globalize_path("res://")
	var root_dir := project_dir.path_join("..").simplify_path()
	var script := root_dir.path_join("tools/validate_world.js")
	if not FileAccess.file_exists(script):
		_validate_out.text = "[color=#d88]tools/validate_world.js not found at %s[/color]" % script
		return
	var out: Array = []
	var code := OS.execute("node", [script], out, true, false)
	if code < 0:
		_validate_out.text = (
			"[color=#d88]Could not run node.[/color] Install Node.js, or run "
			+ "[code]node tools/validate_world.js[/code] in a terminal."
		)
		return
	var text := "\n".join(out.map(func(l: Variant) -> String: return String(l)))
	var tail := text.split("\n")
	var keep: PackedStringArray = PackedStringArray()
	for line: String in tail:
		if line.contains("ERROR") or line.contains("error(s)") or line.contains("World:"):
			keep.append(line)
	if keep.is_empty():
		keep.append("validator produced no summary - full output in the console")
		print(text)
	var joined := "\n".join(keep)
	if joined.contains("0 error(s)"):
		_validate_out.text = "[color=#8d8]%s[/color]" % joined
	else:
		_validate_out.text = "[color=#d88]%s[/color]" % joined
