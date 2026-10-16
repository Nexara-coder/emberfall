## Emberfall map editor - plugin entry point.
##
## Adds the "Emberfall Map" dock to the right-hand side of the editor. The dock
## does the work; this only wires it in and takes it out again cleanly.
@tool
extends EditorPlugin

const DOCK_SCRIPT := preload("res://addons/emberfall_map/dock.gd")

var _dock: Control = null


func _enter_tree() -> void:
	_dock = VBoxContainer.new()
	_dock.set_script(DOCK_SCRIPT)
	_dock.name = "Emberfall Map"
	# RIGHT_BL, not RIGHT_UL. The upper-right slot already holds Inspector,
	# Node and History; adding a fourth tab there overflowed the tab bar, so the
	# dock existed but sat behind the little scroll arrows and was impossible to
	# find. The lower-right slot is empty by default and the dock gets its own
	# visible panel.
	add_control_to_dock(DOCK_SLOT_RIGHT_BL, _dock)


func _exit_tree() -> void:
	if _dock != null:
		remove_control_from_docks(_dock)
		_dock.queue_free()
		_dock = null


func _get_plugin_name() -> String:
	return "Emberfall Map"
