## Emberfall - one visible creature: the local player, another player, an NPC or
## a monster.
##
## Walks a tile path produced by EmberPath, keeps its feet on
## WorldData.height_at(), and drives whichever animation clips the rigged GLB
## actually contains.
##
## The rig is Y-UP. The characters under assets/characters/ are authored Y-up
## with the hips joint about 0.95 above the origin; the static props in the same
## pack are Z-up. Rotating a character like a prop lays it flat on its back.
## Godot's glTF importer already applies the file's own orientation, so nothing
## here re-orients the rig - and nothing here should start doing so.
class_name EmberActor
extends Node3D

## Tiles per second. The 600ms game tick moves one tile walking, two running,
## which is where these come from.
const WALK_SPEED := 1.0 / 0.6
const RUN_SPEED := 2.0 / 0.6
const TURN_SPEED := 9.0
## How far from the server's position before we stop interpolating and snap.
const SNAP_DIST := 6.0

## Clip names in the delivered rigs, best first. Whichever exists is used.
const CLIPS: Dictionary = {
	"idle": ["Idle", "idle", "IDLE"],
	"walk": ["Walk", "walk", "Walking"],
	"run": ["Run", "run", "Running"],
	"attack": ["MeleeAttack", "Attack", "attack"],
	"woodcut": ["Woodcut", "Chop", "woodcut"],
	"mine": ["Mine", "mine", "Mining"],
	"cast": ["MagicCast", "Cast", "cast"],
	"death": ["Death", "death", "Die"],
}

var actor_name: String = ""
var is_local: bool = false
var running: bool = false
## The grid node the actor last stood on. Grid nodes are at integer
## coordinates, so this is a position, not a tile index.
var tile: Vector2i = Vector2i.ZERO

var _path: Array[Vector2i] = []
var _path_i: int = 0
var _pos: Vector2 = Vector2.ZERO
var _facing: float = 0.0
var _facing_to: float = 0.0
var _anim: AnimationPlayer = null
var _clip_cache: Dictionary = {}
var _current_clip: String = ""
var _model: Node3D = null
var _one_shot_until: float = 0.0


func setup(model_path: String, at: Vector2) -> void:
	_pos = at
	tile = Vector2i(int(round(at.x)), int(round(at.y)))
	_place()
	if model_path != "" and ResourceLoader.exists(model_path):
		var packed := load(model_path) as PackedScene
		if packed != null:
			_model = packed.instantiate() as Node3D
			add_child(_model)
			_anim = _find_anim(_model)
			_resolve_clips()
	if _model == null:
		_model = _placeholder()
		add_child(_model)
	play("idle")


## A plain capsule, so a missing model is obviously a missing model rather than
## an invisible actor you then hunt for.
func _placeholder() -> Node3D:
	var n := Node3D.new()
	var mi := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.32
	cap.height = 1.95
	mi.mesh = cap
	mi.position = Vector3(0, 0.975, 0)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.78, 0.36, 0.34)
	mi.material_override = m
	n.add_child(mi)
	return n


func _find_anim(root: Node) -> AnimationPlayer:
	if root is AnimationPlayer:
		return root
	for c in root.get_children():
		var found := _find_anim(c)
		if found != null:
			return found
	return null


## Map our logical clip names onto whatever the GLB actually ships. The
## delivered rigs' clip coverage is thin (several drive only a handful of the
## 22 joints) - that is an asset problem, recorded in ASSET_AUDIT.md, not
## something to paper over here.
func _resolve_clips() -> void:
	if _anim == null:
		return
	var have := _anim.get_animation_list()
	for logical: String in CLIPS.keys():
		for candidate: String in CLIPS[logical]:
			if have.has(candidate):
				_clip_cache[logical] = candidate
				break


func play(logical: String, one_shot: bool = false) -> void:
	if _anim == null:
		return
	if not _clip_cache.has(logical):
		return
	var clip: String = _clip_cache[logical]
	if clip == _current_clip and not one_shot:
		return
	_current_clip = clip
	_anim.play(clip)
	if one_shot:
		var a := _anim.get_animation(clip)
		var len: float = a.length if a != null else 0.6
		_one_shot_until = _now() + len


func _now() -> float:
	return float(Time.get_ticks_msec()) / 1000.0


## Walk to a tile. Returns false when there is no route.
func walk_to(goal: Vector2i, goal_radius: int = 0) -> bool:
	# EmberPath's nodes are grid corners at integer coordinates, so rounding -
	# not flooring - picks the node the actor is actually standing on.
	var from := Vector2i(int(round(_pos.x)), int(round(_pos.y)))
	var p := EmberPath.find(from, goal, goal_radius)
	if p.is_empty():
		return false
	_path = p
	_path_i = 1 if p.size() > 1 else 0
	return true


func stop() -> void:
	_path.clear()
	_path_i = 0


func is_moving() -> bool:
	return not _path.is_empty() and _path_i < _path.size()


## Server correction. Small differences are walked out; a big one is a teleport
## (a home teleport, a respawn) and snaps.
func server_position(at: Vector2) -> void:
	if _pos.distance_to(at) > SNAP_DIST:
		_pos = at
		stop()
		_place()


func _process(delta: float) -> void:
	_advance(delta)
	_place()
	_face(delta)
	_pick_clip()


func _advance(delta: float) -> void:
	if not is_moving():
		return
	var speed: float = RUN_SPEED if running else WALK_SPEED
	var budget: float = speed * delta
	while budget > 0.0 and _path_i < _path.size():
		var next := _path[_path_i]
		var goal := Vector2(float(next.x), float(next.y))
		var to_go := _pos.distance_to(goal)
		if to_go <= budget or to_go < 0.0001:
			_pos = goal
			tile = next
			_path_i += 1
			budget -= to_go
		else:
			var dir := (goal - _pos) / to_go
			_pos += dir * budget
			_facing_to = atan2(dir.x, dir.y)
			budget = 0.0
	if _path_i >= _path.size():
		stop()


func _place() -> void:
	position = Vector3(_pos.x, WorldData.height_at(_pos.x, _pos.y), _pos.y)


func _face(delta: float) -> void:
	_facing = lerp_angle(_facing, _facing_to, minf(1.0, TURN_SPEED * delta))
	rotation.y = _facing


func face_towards(at: Vector2) -> void:
	var d := at - _pos
	if d.length() > 0.001:
		_facing_to = atan2(d.x, d.y)


func _pick_clip() -> void:
	if _now() < _one_shot_until:
		return
	if is_moving():
		play("run" if running else "walk")
	else:
		play("idle")


func world_pos() -> Vector2:
	return _pos
