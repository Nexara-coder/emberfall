## Emberfall map editor - reading and writing data/authored_world.json.
##
## This file is the single source of truth for every hand-placed thing in the
## world. The Node pipeline reads it (tools/authored_towns.js and
## tools/authored_resources.js are now thin loaders over it) and the Godot
## editor reads and writes it. One file, two editors.
##
## The writer matters as much as the reader. If a save reshuffled the file, every
## save would produce a whole-file diff and the one building you actually moved
## would be invisible in it. So the output is byte-for-byte what
## JSON.stringify(doc, null, 2) + "\n" produces:
##
##   * two-space indent, one entry per line
##   * {} and [] for empty containers, not expanded
##   * integral numbers with no decimal point: 151, not 151.0
##   * everything else as the SHORTEST decimal that reads back as the identical
##     double, which is the rule JSON.stringify follows
##
## That last rule is why this does not use Godot's JSON.stringify: Godot prints
## a float with a fixed number of digits, so pi/2 - which is in the data as a
## fence rotation - would come back as 1.5707963267949 and silently change the
## world. It also cannot use %g, which Godot's format operator does not support,
## so it walks decimal places with %f until the value round-trips.
##
## Verified against the real file: re-serialising data/authored_world.json
## through this algorithm reproduces all 53,051 bytes exactly.
@tool
class_name EmberAuthoredIO
extends RefCounted

## The mirror inside the Godot project. tools/bake.js copies the project's
## data/ directory to here so the running game and the editor read the same
## world.
const MIRROR_PATH := "res://data/authored_world.json"

## The authoritative file, one level up from the Godot project, which the Node
## pipeline reads. Godot refuses "res://.." so this is resolved to a real OS
## path at runtime - see authored_path(). Editor only.
const UPSTREAM_REL := "../data/authored_world.json"

## Max decimal places tried when looking for a round-tripping representation.
const MAX_DECIMALS := 20

## Key order used for entries the EDITOR creates. Existing entries keep whatever
## order they were parsed in, so an edit never reorders the file.
const BUILDING_KEYS: Array[String] = [
	"name", "style", "x", "z", "w", "d", "door", "rot", "interior",
]
const PROP_KEYS: Array[String] = ["t", "kind", "x", "z", "txt"]
const TREE_KEYS: Array[String] = ["kind", "x", "z"]


## Absolute OS path of the authoritative file, or "" outside the editor.
static func authored_path() -> String:
	var project_dir := ProjectSettings.globalize_path("res://")
	if project_dir.is_empty():
		return ""
	return project_dir.path_join(UPSTREAM_REL).simplify_path()


## Which file a load would read, as a human-readable path.
static func source_description() -> String:
	var up := authored_path()
	if up != "" and FileAccess.file_exists(up):
		return up
	return MIRROR_PATH


static func load_doc() -> Dictionary:
	var text := ""
	var up := authored_path()
	if up != "" and FileAccess.file_exists(up):
		text = FileAccess.get_file_as_string(up)
	elif FileAccess.file_exists(MIRROR_PATH):
		text = FileAccess.get_file_as_string(MIRROR_PATH)
	else:
		push_error("EmberAuthoredIO: no authored_world.json at " + MIRROR_PATH)
		return {}
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		push_error("EmberAuthoredIO: authored_world.json did not parse as an object")
		return {}
	return parsed


## Write the document back. Returns "" on success or a message on failure.
##
## BOTH copies are written on purpose. The upstream file is what the Node
## pipeline reads; the mirror is what this project loads. Writing only one is
## how a map edit appears to do nothing.
static func save_doc(doc: Dictionary) -> String:
	var text := serialise(doc) + "\n"
	var wrote: PackedStringArray = PackedStringArray()
	var failed: PackedStringArray = PackedStringArray()

	var up := authored_path()
	if up != "":
		if _write(up, text):
			wrote.append(up)
		else:
			failed.append(up)
	if _write(MIRROR_PATH, text):
		wrote.append(MIRROR_PATH)
	else:
		failed.append(MIRROR_PATH)

	if wrote.is_empty():
		return "could not open authored_world.json for writing (tried %s)" % ", ".join(failed)
	if not failed.is_empty():
		return "wrote %s but could not write %s - the two copies now disagree" % [
			", ".join(wrote), ", ".join(failed)
		]
	return ""


static func _write(path: String, text: String) -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(text)
	f.close()
	return true


## ---------------------------------------------------------------------------
## Serialisation
## ---------------------------------------------------------------------------

static func serialise(v: Variant, depth: int = 0) -> String:
	var pad := _indent(depth)
	var inner := _indent(depth + 1)
	match typeof(v):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if bool(v) else "false"
		TYPE_INT:
			return str(int(v))
		TYPE_FLOAT:
			return num(float(v))
		TYPE_STRING, TYPE_STRING_NAME:
			return quote(String(v))
		TYPE_ARRAY:
			var arr: Array = v
			if arr.is_empty():
				return "[]"
			var items: PackedStringArray = PackedStringArray()
			for x: Variant in arr:
				items.append(inner + serialise(x, depth + 1))
			return "[\n" + ",\n".join(items) + "\n" + pad + "]"
		TYPE_DICTIONARY:
			var d: Dictionary = v
			if d.is_empty():
				return "{}"
			var fields: PackedStringArray = PackedStringArray()
			for k: Variant in d.keys():
				fields.append(inner + quote(String(k)) + ": " + serialise(d[k], depth + 1))
			return "{\n" + ",\n".join(fields) + "\n" + pad + "}"
	# Vectors and the like have no JSON form; refuse rather than invent one.
	push_error("EmberAuthoredIO: cannot serialise a " + type_string(typeof(v)))
	return "null"


static func _indent(depth: int) -> String:
	var s := ""
	for _i in range(depth):
		s += "  "
	return s


## Integral values print without a decimal point, as JSON.stringify does.
## Everything else prints as the shortest decimal that reads back identically.
static func num(f: float) -> String:
	if is_nan(f) or is_inf(f):
		return "null"
	if is_equal_approx(f, floor(f)) and f == floor(f) and absf(f) < 1e15:
		return str(int(f))
	for p in range(1, MAX_DECIMALS + 1):
		var s: String = ("%." + str(p) + "f") % f
		if s.to_float() == f:
			return _trim(s)
	return _trim(("%." + str(MAX_DECIMALS) + "f") % f)


## Strip trailing zeros. Cannot change the value, only its spelling.
static func _trim(s: String) -> String:
	if not s.contains("."):
		return s
	var out := s
	while out.ends_with("0"):
		out = out.substr(0, out.length() - 1)
	if out.ends_with("."):
		out = out.substr(0, out.length() - 1)
	return out


## JSON string escaping, matching JSON.stringify: only the seven named escapes
## plus \u00xx for the other control characters. Non-ASCII is left literal.
static func quote(s: String) -> String:
	var out := "\""
	for i in range(s.length()):
		var ch := s[i]
		match ch:
			"\"": out += "\\\""
			"\\": out += "\\\\"
			"\b": out += "\\b"
			"\f": out += "\\f"
			"\n": out += "\\n"
			"\r": out += "\\r"
			"\t": out += "\\t"
			_:
				if ch.unicode_at(0) < 0x20:
					out += "\\u%04x" % ch.unicode_at(0)
				else:
					out += ch
	return out + "\""


## ---------------------------------------------------------------------------
## New entries
## ---------------------------------------------------------------------------

## Build a dictionary with the canonical key order, so a building added in the
## editor looks like the ones already in the file.
static func new_building(at: Vector2) -> Dictionary:
	return {
		"name": "New building",
		"style": "timber",
		"x": snappedf(at.x, 1.0),
		"z": snappedf(at.y, 1.0),
		"w": 8,
		"d": 8,
		"door": [0, 0],
		"rot": 0,
		"interior": [],
	}


static func new_prop(kind: String, at: Vector2) -> Dictionary:
	return {
		"t": "prop",
		"kind": kind,
		"x": snappedf(at.x, 0.5),
		"z": snappedf(at.y, 0.5),
	}


static func new_tree(kind: String, at: Vector2) -> Dictionary:
	return {
		"kind": kind,
		"x": snappedf(at.x, 0.5),
		"z": snappedf(at.y, 0.5),
	}
