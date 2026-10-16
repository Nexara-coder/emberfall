## Emberfall - the game HUD.
##
## The 2005 RuneScape layout: a side panel on the right with nine tabs, a
## 4 x 7 inventory, a chat box along the bottom, and the status orbs. Built from
## the authored art in assets/ui - frames, tab icons, slots, buttons and orbs -
## which has been sitting unused since it was delivered.
##
## Built in code rather than as a .tscn on purpose. A HUD this size is mostly
## repetition over data (28 slots, 23 skills, 9 tabs), and a scene file would be
## a thousand lines of generated nodes that nobody can read or diff.
##
## State comes from the server. Everything here renders whatever it is handed
## and asks the server to act; nothing in this file decides that a trade
## happened or that an item was consumed.
class_name EmberHUD
extends CanvasLayer

signal tab_changed(tab: String)
signal slot_clicked(index: int, secondary: bool)
signal chat_submitted(text: String)

const UI := "res://assets/ui/"
const PANEL_W := 232
const SLOT := 48
const COLS := 4
const ROWS := 7

## Tab order, matching the art in assets/ui/Tabs.
const TABS: Array[String] = [
	"combat", "skills", "quests", "inventory", "equipment",
	"prayer", "magic", "friends", "settings",
]

## The 23 skills, in the order the panel lists them.
const SKILLS: Array[String] = [
	"attack", "hitpoints", "mining",
	"strength", "agility", "smithing",
	"defence", "herblore", "fishing",
	"ranged", "thieving", "cooking",
	"prayer", "crafting", "firemaking",
	"magic", "fletching", "woodcutting",
	"runecraft", "slayer", "farming",
	"construction", "hunter",
]

## Equipment slots and where they sit in the paper-doll grid.
const EQUIP_SLOTS: Array = [
	["head", 1, 0], ["cape", 0, 1], ["neck", 1, 1], ["ammo", 2, 1],
	["weapon", 0, 2], ["body", 1, 2], ["shield", 2, 2],
	["legs", 1, 3],
	["gloves", 0, 4], ["boots", 1, 4], ["ring", 2, 4],
]

var current_tab: String = "inventory"
var inventory: Array = []
var equipment: Dictionary = {}
var skills: Dictionary = {}

var _panel: Control
var _tab_bar: GridContainer
var _pages: Dictionary = {}
var _slot_nodes: Array[Control] = []
var _equip_nodes: Dictionary = {}
var _skill_rows: Dictionary = {}
var _chat_log: RichTextLabel
var _chat_entry: LineEdit
var _orbs: Dictionary = {}
var _tab_buttons: Dictionary = {}
var _tooltip: Label


func _ready() -> void:
	layer = 10
	_build()
	show_tab("inventory")


## ---------------------------------------------------------------------------
## Construction
## ---------------------------------------------------------------------------

func _tex(rel: String) -> Texture2D:
	var path := UI + rel
	if ResourceLoader.exists(path):
		return load(path) as Texture2D
	return null


func _build() -> void:
	var root := Control.new()
	root.name = "HUDRoot"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	_build_side_panel(root)
	_build_chat(root)
	_build_orbs(root)

	_tooltip = Label.new()
	_tooltip.add_theme_color_override("font_color", Color(1, 0.95, 0.75))
	_tooltip.add_theme_font_size_override("font_size", 13)
	_tooltip.visible = false
	_tooltip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_tooltip)


func _build_side_panel(root: Control) -> void:
	_panel = Control.new()
	_panel.name = "SidePanel"
	_panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	_panel.offset_left = -float(PANEL_W)
	_panel.offset_right = 0.0
	_panel.offset_top = 0.0
	_panel.offset_bottom = 0.0
	root.add_child(_panel)

	var bg := TextureRect.new()
	bg.texture = _tex("Frames/side_panel.png")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.stretch_mode = TextureRect.STRETCH_SCALE
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if bg.texture == null:
		var plate := ColorRect.new()
		plate.color = Color(0.17, 0.14, 0.11, 0.95)
		plate.set_anchors_preset(Control.PRESET_FULL_RECT)
		plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_panel.add_child(plate)
	else:
		_panel.add_child(bg)

	# Tab strip, in TWO rows of five. Nine tabs in a single row across a 232px
	# panel left each button 24px wide and the icons unreadable; RuneScape used
	# two rows for the same reason.
	_tab_bar = GridContainer.new()
	_tab_bar.columns = 5
	_tab_bar.add_theme_constant_override("h_separation", 2)
	_tab_bar.add_theme_constant_override("v_separation", 2)
	_tab_bar.position = Vector2(8, 6)
	_panel.add_child(_tab_bar)
	for t in TABS:
		var b := TextureButton.new()
		b.texture_normal = _tex("Tabs/%s_normal.png" % t)
		b.texture_hover = _tex("Tabs/%s_hover.png" % t)
		b.texture_pressed = _tex("Tabs/%s_active.png" % t)
		b.ignore_texture_size = true
		b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		b.custom_minimum_size = Vector2(40, 34)
		b.tooltip_text = t.capitalize()
		b.pressed.connect(show_tab.bind(t))
		_tab_bar.add_child(b)
		_tab_buttons[t] = b

	# page area
	var pages := Control.new()
	pages.name = "Pages"
	pages.set_anchors_preset(Control.PRESET_FULL_RECT)
	pages.offset_top = 82.0
	pages.offset_left = 6.0
	pages.offset_right = -6.0
	pages.offset_bottom = -6.0
	_panel.add_child(pages)

	_pages["inventory"] = _page_inventory()
	_pages["skills"] = _page_skills()
	_pages["equipment"] = _page_equipment()
	for t in TABS:
		if not _pages.has(t):
			_pages[t] = _page_placeholder(t)
	for t: String in _pages.keys():
		var p: Control = _pages[t]
		p.set_anchors_preset(Control.PRESET_FULL_RECT)
		p.visible = false
		pages.add_child(p)


func _page_inventory() -> Control:
	var page := Control.new()
	page.name = "InventoryPage"

	var frame := TextureRect.new()
	frame.texture = _tex("Frames/inventory_frame_4x7.png")
	frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	frame.stretch_mode = TextureRect.STRETCH_SCALE
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if frame.texture != null:
		page.add_child(frame)

	var grid := GridContainer.new()
	grid.columns = COLS
	grid.position = Vector2(8, 8)
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	page.add_child(grid)

	var slot_tex := _tex("Slots/slot_normal.png")
	var hover_tex := _tex("Slots/slot_hover.png")
	for i in range(COLS * ROWS):
		var cell := TextureButton.new()
		cell.texture_normal = slot_tex
		cell.texture_hover = hover_tex
		cell.ignore_texture_size = true
		cell.stretch_mode = TextureButton.STRETCH_SCALE
		cell.custom_minimum_size = Vector2(SLOT, SLOT)

		var icon := TextureRect.new()
		icon.name = "icon"
		icon.set_anchors_preset(Control.PRESET_FULL_RECT)
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cell.add_child(icon)

		var count := Label.new()
		count.name = "count"
		count.add_theme_font_size_override("font_size", 12)
		count.add_theme_color_override("font_color", Color(1, 0.94, 0.45))
		count.position = Vector2(3, 1)
		count.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cell.add_child(count)

		var idx := i
		cell.pressed.connect(func() -> void: slot_clicked.emit(idx, false))
		cell.mouse_entered.connect(_on_slot_hover.bind(idx))
		cell.mouse_exited.connect(_hide_tooltip)
		grid.add_child(cell)
		_slot_nodes.append(cell)
	return page


func _page_equipment() -> Control:
	var page := Control.new()
	page.name = "EquipmentPage"
	var slot_tex := _tex("Slots/slot_normal.png")
	for entry: Array in EQUIP_SLOTS:
		var key := String(entry[0])
		var cell := TextureButton.new()
		cell.texture_normal = slot_tex
		cell.ignore_texture_size = true
		cell.stretch_mode = TextureButton.STRETCH_SCALE
		cell.custom_minimum_size = Vector2(SLOT, SLOT)
		cell.position = Vector2(
			30.0 + float(int(entry[1])) * float(SLOT + 10),
			8.0 + float(int(entry[2])) * float(SLOT + 8)
		)
		cell.size = Vector2(SLOT, SLOT)
		cell.tooltip_text = key.capitalize()

		var icon := TextureRect.new()
		icon.name = "icon"
		icon.set_anchors_preset(Control.PRESET_FULL_RECT)
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cell.add_child(icon)

		page.add_child(cell)
		_equip_nodes[key] = cell
	return page


func _page_skills() -> Control:
	var page := Control.new()
	page.name = "SkillsPage"
	var grid := GridContainer.new()
	grid.columns = 3
	grid.position = Vector2(4, 6)
	grid.add_theme_constant_override("h_separation", 3)
	grid.add_theme_constant_override("v_separation", 3)
	page.add_child(grid)

	for s in SKILLS:
		var cell := PanelContainer.new()
		cell.custom_minimum_size = Vector2(72, 30)
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0.25, 0.20, 0.13, 0.92)
		style.border_color = Color(0.40, 0.33, 0.21)
		style.set_border_width_all(1)
		cell.add_theme_stylebox_override("panel", style)

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 2)
		cell.add_child(row)

		var name_lbl := Label.new()
		name_lbl.text = s.substr(0, 3).to_upper()
		name_lbl.add_theme_font_size_override("font_size", 11)
		name_lbl.add_theme_color_override("font_color", Color(0.85, 0.78, 0.58))
		row.add_child(name_lbl)

		var lvl := Label.new()
		lvl.name = "level"
		lvl.text = "1"
		lvl.add_theme_font_size_override("font_size", 13)
		lvl.add_theme_color_override("font_color", Color(1, 0.94, 0.45))
		row.add_child(lvl)

		cell.tooltip_text = s.capitalize()
		grid.add_child(cell)
		_skill_rows[s] = lvl

	var total := Label.new()
	total.name = "total"
	total.position = Vector2(6, 6 + 8 * 33)
	total.add_theme_font_size_override("font_size", 13)
	total.add_theme_color_override("font_color", Color(1, 0.94, 0.45))
	total.text = "Total level: 23"
	page.add_child(total)
	return page


func _page_placeholder(tab: String) -> Control:
	var page := Control.new()
	page.name = tab.capitalize() + "Page"
	var l := Label.new()
	l.text = tab.capitalize() + "\n\nNot built yet."
	l.add_theme_color_override("font_color", Color(0.72, 0.66, 0.52))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.set_anchors_preset(Control.PRESET_CENTER)
	page.add_child(l)
	return page


func _build_chat(root: Control) -> void:
	var box := Control.new()
	box.name = "Chat"
	box.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	box.offset_top = -168.0
	box.offset_left = 0.0
	box.offset_right = -float(PANEL_W)
	box.offset_bottom = 0.0
	root.add_child(box)

	var frame := TextureRect.new()
	frame.texture = _tex("Frames/chat_frame.png")
	frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	frame.stretch_mode = TextureRect.STRETCH_SCALE
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if frame.texture == null:
		var plate := ColorRect.new()
		plate.color = Color(0.13, 0.11, 0.09, 0.88)
		plate.set_anchors_preset(Control.PRESET_FULL_RECT)
		plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(plate)
	else:
		box.add_child(frame)

	_chat_log = RichTextLabel.new()
	_chat_log.bbcode_enabled = true
	_chat_log.scroll_following = true
	_chat_log.set_anchors_preset(Control.PRESET_FULL_RECT)
	_chat_log.offset_left = 12.0
	_chat_log.offset_right = -12.0
	_chat_log.offset_top = 10.0
	_chat_log.offset_bottom = -34.0
	_chat_log.mouse_filter = Control.MOUSE_FILTER_PASS
	box.add_child(_chat_log)

	_chat_entry = LineEdit.new()
	_chat_entry.placeholder_text = "Press Enter to chat"
	_chat_entry.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_chat_entry.offset_left = 12.0
	_chat_entry.offset_right = -12.0
	_chat_entry.offset_top = -30.0
	_chat_entry.offset_bottom = -6.0
	_chat_entry.text_submitted.connect(_on_chat_submitted)
	box.add_child(_chat_entry)


func _build_orbs(root: Control) -> void:
	var strip := VBoxContainer.new()
	strip.name = "Orbs"
	# Below the build/status line, which it used to sit on top of.
	strip.position = Vector2(12, 52)
	strip.add_theme_constant_override("separation", 4)
	root.add_child(strip)
	for spec: Array in [
		["health", "Orbs/health_orb.png", Color(0.85, 0.25, 0.2)],
		["prayer", "Orbs/prayer_orb.png", Color(0.55, 0.75, 0.95)],
		["run", "Orbs/run_orb.png", Color(0.95, 0.82, 0.35)],
	]:
		var holder := Control.new()
		holder.custom_minimum_size = Vector2(52, 52)
		var art := TextureRect.new()
		art.texture = _tex(String(spec[1]))
		art.set_anchors_preset(Control.PRESET_FULL_RECT)
		art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		art.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(art)
		var val := Label.new()
		val.name = "value"
		val.text = "-"
		val.add_theme_font_size_override("font_size", 14)
		val.add_theme_color_override("font_color", Color(1, 1, 1))
		val.set_anchors_preset(Control.PRESET_CENTER)
		val.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(val)
		strip.add_child(holder)
		_orbs[String(spec[0])] = val


## ---------------------------------------------------------------------------
## State
## ---------------------------------------------------------------------------

func show_tab(tab: String) -> void:
	if not _pages.has(tab):
		return
	current_tab = tab
	for t: String in _pages.keys():
		(_pages[t] as Control).visible = (t == tab)
	tab_changed.emit(tab)


## `items` is the server's inventory array: entries of {id, n} or null/empty.
func set_inventory(items: Array) -> void:
	inventory = items
	for i in range(_slot_nodes.size()):
		var cell := _slot_nodes[i]
		var icon := cell.get_node("icon") as TextureRect
		var count := cell.get_node("count") as Label
		var entry: Variant = items[i] if i < items.size() else null
		if entry == null or not entry is Dictionary or int((entry as Dictionary).get("id", 0)) <= 0:
			icon.texture = null
			count.text = ""
			continue
		var e: Dictionary = entry
		var item: Dictionary = WorldData.item_by_id.get(int(e.get("id", 0)), {})
		icon.texture = EmberItemIcons.for_item(item) if not item.is_empty() else null
		var n: int = int(e.get("n", 1))
		count.text = _short(n) if n > 1 else ""


func set_equipment(worn: Dictionary) -> void:
	equipment = worn
	for key: String in _equip_nodes.keys():
		var cell: Control = _equip_nodes[key]
		var icon := cell.get_node("icon") as TextureRect
		var id: int = int(worn.get(key, 0))
		if id <= 0:
			icon.texture = null
			continue
		var item: Dictionary = WorldData.item_by_id.get(id, {})
		icon.texture = EmberItemIcons.for_item(item) if not item.is_empty() else null


func set_skills(levels: Dictionary) -> void:
	skills = levels
	var total := 0
	for s: String in _skill_rows.keys():
		var lvl: int = int(levels.get(s, 1))
		(_skill_rows[s] as Label).text = str(lvl)
		total += lvl
	var page: Control = _pages.get("skills")
	if page != null:
		var t := page.get_node_or_null("total") as Label
		if t != null:
			t.text = "Total level: %d" % total


func set_orb(which: String, value: String) -> void:
	if _orbs.has(which):
		(_orbs[which] as Label).text = value


func log_line(text: String) -> void:
	if _chat_log != null:
		_chat_log.append_text(text + "\n")


## 2005 shorthand: 15000 shows as 15K, 1500000 as 1.5M.
func _short(n: int) -> String:
	if n >= 10000000:
		return "%dM" % (n / 1000000)
	if n >= 100000:
		return "%dK" % (n / 1000)
	if n >= 10000:
		return "%dK" % (n / 1000)
	return str(n)


func _on_chat_submitted(text: String) -> void:
	if text.strip_edges().is_empty():
		return
	chat_submitted.emit(text)
	_chat_entry.clear()


func _on_slot_hover(index: int) -> void:
	if index >= inventory.size():
		return
	var entry: Variant = inventory[index]
	if not entry is Dictionary:
		return
	var item: Dictionary = WorldData.item_by_id.get(int((entry as Dictionary).get("id", 0)), {})
	if item.is_empty():
		return
	_tooltip.text = String(item.get("name", ""))
	_tooltip.position = _slot_nodes[index].global_position + Vector2(-8, -20)
	_tooltip.visible = true


func _hide_tooltip() -> void:
	_tooltip.visible = false
