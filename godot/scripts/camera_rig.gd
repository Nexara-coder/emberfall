## Emberfall - the camera.
##
## 2005 RuneScape camera, and nothing else: it orbits a target, the ARROW KEYS
## rotate and pitch it, the mouse wheel zooms, and middle-drag orbits. There is
## deliberately no WASD and no free-look - movement is point-and-click only.
##
## Arrow keys are read with Input.is_physical_key_pressed rather than through an
## input map, so the bindings cannot be wrong in project.godot and cannot be
## remapped out from under the player by accident. Left/right rotate, up/down
## pitch, and up means "look down from higher" - the inverted-arrow-keys
## complaint came from pitching the other way.
extends Node3D

const YAW_SPEED := 2.4           ## radians per second
const PITCH_SPEED := 1.4
const PITCH_MIN := 0.22          ## radians above the horizon
const PITCH_MAX := 1.32
const DIST_MIN := 6.0
const DIST_MAX := 42.0
const ZOOM_STEP := 2.6
const EASE := 10.0               ## how fast the camera catches its target
const MOUSE_ORBIT := 0.006

@export var target_path: NodePath
@export var height_offset: float = 1.1

var yaw: float = 0.0
var pitch: float = 0.72
var distance: float = 17.0

var _yaw_to: float = 0.0
var _pitch_to: float = 0.72
var _dist_to: float = 17.0
var _orbiting: bool = false
var _cam: Camera3D = null
var _target: Node3D = null
## Where the rig is actually looking, eased toward the target so the camera
## does not snap when the player is corrected by the server.
var _look: Vector3 = Vector3.ZERO
var _look_set: bool = false


func _ready() -> void:
	_cam = get_node_or_null("Camera3D") as Camera3D
	if _cam == null:
		_cam = Camera3D.new()
		_cam.name = "Camera3D"
		add_child(_cam)
	_cam.far = 900.0
	_cam.near = 0.1
	_cam.fov = 62.0
	if not target_path.is_empty():
		_target = get_node_or_null(target_path) as Node3D


func set_target(n: Node3D) -> void:
	_target = n
	_look_set = false


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_dist_to = clampf(_dist_to - ZOOM_STEP, DIST_MIN, DIST_MAX)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_dist_to = clampf(_dist_to + ZOOM_STEP, DIST_MIN, DIST_MAX)
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_orbiting = mb.pressed
	elif event is InputEventMouseMotion and _orbiting:
		var mm := event as InputEventMouseMotion
		_yaw_to -= mm.relative.x * MOUSE_ORBIT
		_pitch_to = clampf(_pitch_to + mm.relative.y * MOUSE_ORBIT, PITCH_MIN, PITCH_MAX)


func _process(delta: float) -> void:
	_read_keys(delta)

	yaw = lerp_angle(yaw, _yaw_to, minf(1.0, EASE * delta))
	pitch = lerpf(pitch, _pitch_to, minf(1.0, EASE * delta))
	distance = lerpf(distance, _dist_to, minf(1.0, EASE * delta))

	if _target != null:
		var want := _target.global_position + Vector3(0.0, height_offset, 0.0)
		if not _look_set:
			_look = want
			_look_set = true
		else:
			_look = _look.lerp(want, minf(1.0, EASE * delta))

	global_position = _look

	var offset := Vector3(
		sin(yaw) * cos(pitch),
		sin(pitch),
		cos(yaw) * cos(pitch)
	) * distance
	_cam.global_position = _look + offset
	_cam.look_at(_look, Vector3.UP)


func _read_keys(delta: float) -> void:
	if Input.is_physical_key_pressed(KEY_LEFT):
		_yaw_to -= YAW_SPEED * delta
	if Input.is_physical_key_pressed(KEY_RIGHT):
		_yaw_to += YAW_SPEED * delta
	# Up arrow raises the camera and looks further down, which is what players
	# expect from "up". Swapping these is the inverted-arrows bug.
	if Input.is_physical_key_pressed(KEY_UP):
		_pitch_to = clampf(_pitch_to + PITCH_SPEED * delta, PITCH_MIN, PITCH_MAX)
	if Input.is_physical_key_pressed(KEY_DOWN):
		_pitch_to = clampf(_pitch_to - PITCH_SPEED * delta, PITCH_MIN, PITCH_MAX)


## The camera's own ray, used for nothing but occlusion. Picking uses a separate
## ray in main.gd with an unlimited length: sharing one ray meant the camera set
## its length to its own distance and anything past about fifteen units silently
## could not be clicked.
func camera() -> Camera3D:
	return _cam
