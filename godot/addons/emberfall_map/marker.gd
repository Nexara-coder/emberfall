## Emberfall map editor - one draggable thing.
##
## Every hand-placed entry in data/authored_world.json gets one of these in the
## map editor scene. Select it in the viewport, drag it with the normal Godot
## move gizmo, and it writes its new tile position back into the entry it came
## from. Rotate it and the building turns.
##
## Three things are enforced as you drag, which is most of what makes this
## usable rather than merely possible:
##
##   1. Y is not yours to set. Ground height is derived from terrain_def.gd, the
##      same function the server uses, so the marker snaps itself back onto the
##      ground every time it moves. Dragging something into the air is not a
##      thing the world data can express.
##   2. X and Z snap to the grid the authored data uses - whole tiles for
##      buildings, half tiles for props and trees - so saved coordinates stay
##      the clean numbers a person would have typed.
##   3. Only rotation about Y survives. A building tipped onto its side is not
##      representable either.
@tool
class_name EmberMapMarker
extends Node3D

## Which collection in authored_world.json this came from.
enum Kind { BUILDING, PROP, TREE, FENCE, POST, ZONE, LANDMARK }

const SNAP_BUILDING := 1.0
const SNAP_OTHER := 0.5

@export var kind: Kind = Kind.PROP
@export var town_key: String = ""
## Index into the town's collection, or into resources.zones / .landmarks.
@export var entry_index: int = -1
## For NPC posts, the npc key; for fences, which end this marker is.
@export var sub_key: String = ""
@export var label: String = ""

var _applying: bool = false
var _dirty: bool = false


func _ready() -> void:
	set_notify_transform(true)


func _notification(what: int) -> void:
	if what != NOTIFICATION_TRANSFORM_CHANGED:
		return
	if _applying or not Engine.is_editor_hint():
		return
	_constrain()


## Put the marker back where the world data can actually describe it.
func _constrain() -> void:
	var step: float = SNAP_BUILDING if kind == Kind.BUILDING else SNAP_OTHER
	var sx := snappedf(position.x, step)
	var sz := snappedf(position.z, step)
	sx = clampf(sx, 0.0, float(EmberTerrainDef.WORLD))
	sz = clampf(sz, 0.0, float(EmberTerrainDef.WORLD))
	var sy := EmberTerrainDef.height(sx, sz)

	# Keep only the yaw, and round it to whole degrees so the saved number is
	# readable. A building rotated by 0.017453 radians helps nobody.
	var yaw := snappedf(rad_to_deg(rotation.y), 1.0)

	var want := Vector3(sx, sy, sz)
	if position.is_equal_approx(want) and is_equal_approx(rad_to_deg(rotation.y), yaw) \
			and is_zero_approx(rotation.x) and is_zero_approx(rotation.z):
		return

	_applying = true
	position = want
	rotation = Vector3(0.0, deg_to_rad(yaw), 0.0)
	scale = Vector3.ONE
	_applying = false
	_dirty = true


## Tile position, as the authored data stores it.
func tile_position() -> Vector2:
	var step: float = SNAP_BUILDING if kind == Kind.BUILDING else SNAP_OTHER
	return Vector2(snappedf(position.x, step), snappedf(position.z, step))


## Rotation in radians about Y, rounded the same way _constrain rounds it.
func yaw_radians() -> float:
	return deg_to_rad(snappedf(rad_to_deg(rotation.y), 1.0))


func was_moved() -> bool:
	return _dirty


func clear_moved() -> void:
	_dirty = false


## Place the marker from the data without tripping the move detection.
func place(at: Vector2, yaw: float) -> void:
	_applying = true
	position = Vector3(at.x, EmberTerrainDef.height(at.x, at.y), at.y)
	rotation = Vector3(0.0, yaw, 0.0)
	_applying = false
	_dirty = false
