## Emberfall - networking.
##
## Registered as the autoload "Net". Speaks exactly the same protocol as the
## JavaScript client in js/net.js, against the unchanged PHP server:
##
##   POST <api>?a=<action>  with a JSON body and an X-RF-Token header
##
## Shared hosting has no websockets, so this is HTTP: small frequent posts, a
## poll interval that adapts to the measured round trip, and a snapshot buffer
## so other players glide instead of teleporting between updates.
##
## The client may ask, never assert. Every position sent here is a request; the
## server's reply is the truth.
extends Node

## Emitted on every successful sync with the whole reply dictionary.
signal synced(reply: Dictionary)
## Emitted when the server drops our session.
signal kicked(reason: String)
## Emitted after three consecutive failures, with something a person can act on.
signal net_trouble(message: String)
## Emitted once the first load reply has arrived.
signal loaded(reply: Dictionary)

## Candidate API locations, tried in order on the first request. The web export
## normally sits in a play/ subfolder beside the PHP, so ../api comes first.
const API_CANDIDATES: Array[String] = ["../api/index.php", "api/index.php", "/api/index.php"]

const RENDER_DELAY := 0.18        ## seconds behind the newest snapshot
const SNAP_BUFFER := 12
const MIN_INTERVAL := 0.17
const MAX_INTERVAL := 0.65
const MAX_POOL := 6

var api_base: String = ""
var token: String = ""
var connected: bool = false
var server_build: String = ""
var last_rtt: float = 0.12

var _interval: float = 0.2
var _since: int = 0
var _known: Dictionary = {}
var _snaps: Dictionary = {}
var _server_offset: float = 0.0
var _sync_in_flight: bool = false
var _sync_accum: float = 0.0
var _syncing: bool = false
var _failures: int = 0
var _pending := {"x": 0.0, "z": 0.0, "r": 0.0, "anim": "idle"}
var _pool: Array[HTTPRequest] = []


func _ready() -> void:
	api_base = API_CANDIDATES[0]
	_restore_token()
	set_process(true)


func _process(delta: float) -> void:
	if not _syncing or token.is_empty():
		return
	_sync_accum += delta
	if _sync_accum >= _interval and not _sync_in_flight:
		_sync_accum = 0.0
		_do_sync()


## ---------------------------------------------------------------------------
## Transport
## ---------------------------------------------------------------------------

func _take_request() -> HTTPRequest:
	if not _pool.is_empty():
		return _pool.pop_back()
	var r := HTTPRequest.new()
	r.timeout = 15.0
	# The export runs in a browser tab; threads are not available there and
	# HTTPRequest does not need them because the browser does the work.
	r.use_threads = not OS.has_feature("web")
	add_child(r)
	return r


func _give_back(r: HTTPRequest) -> void:
	if _pool.size() < MAX_POOL:
		_pool.append(r)
	else:
		r.queue_free()


## One POST. Awaited by callers, so the game code reads top to bottom instead of
## as a chain of callbacks. Returns {ok: false, error: "..."} on any failure
## rather than throwing, because a network error mid-task must not take the
## client down.
func post(action: String, body: Dictionary = {}) -> Dictionary:
	var headers: PackedStringArray = ["Content-Type: application/json"]
	if not token.is_empty():
		headers.append("X-RF-Token: " + token)
	var url := api_base + "?a=" + action.uri_encode()
	var req := _take_request()
	var err := req.request(url, headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		_give_back(req)
		return {"ok": false, "error": "could not start the request (error %d)" % err}

	var result: Array = await req.request_completed
	_give_back(req)

	var code: int = int(result[1])
	var raw: PackedByteArray = result[3]
	var text := raw.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		return parsed
	return {"ok": false, "error": _describe_bad_reply(code, text)}


## The same diagnosis the JavaScript client gives, because these are the
## failures real shared hosts actually produce and "request failed" sends people
## nowhere.
func _describe_bad_reply(code: int, text: String) -> String:
	var body := text.strip_edges()
	if body.contains("<?php"):
		return ("Your host sent back the PHP source instead of running it. PHP is "
			+ "not enabled for this folder.")
	if body.begins_with("<!DOCTYPE") or body.begins_with("<html"):
		if code == 200:
			return ("The server returned a web page instead of game data. Either PHP "
				+ "is off, or another .htaccess higher up is swallowing the request. "
				+ "Open api/index.php?a=ping directly to see what the host sends.")
		return ("The server returned an error page (HTTP %d). Open api/index.php?a=ping "
			+ "directly in a browser tab to see it.") % code
	match code:
		0:
			return "No reply from the server. Check the site is reachable."
		403:
			return "The server refused access to the API (403). Check permissions: 755 folders, 644 files."
		404:
			return ("Could not find %s (404). Check where the api folder is relative to "
				+ "the exported game.") % api_base
		500:
			return ("The server returned 500 instead of game data. This is usually .htaccess - "
				+ "try removing it and data/store/.htaccess.")
	if body.is_empty():
		return "The server sent an empty reply (HTTP %d). Check health.php." % code
	return "The server replied with something that is not game data (HTTP %d): %s" % [
		code, body.substr(0, 160)
	]


## Find where the PHP actually lives. Called once at startup; cheap, and it
## means the export works whether it sits beside the api folder or inside a
## subfolder of it.
func discover_api() -> bool:
	for candidate in API_CANDIDATES:
		api_base = candidate
		var r := await post("ping")
		if bool(r.get("ok", false)):
			connected = true
			server_build = String(r.get("build", ""))
			return true
	connected = false
	return false


## ---------------------------------------------------------------------------
## Accounts
## ---------------------------------------------------------------------------

func register(user: String, pass_word: String) -> Dictionary:
	var r := await post("register", {"user": user, "pass": pass_word})
	if bool(r.get("ok", false)):
		token = String(r.get("token", ""))
		_store_token()
	return r


func login(user: String, pass_word: String) -> Dictionary:
	var r := await post("login", {"user": user, "pass": pass_word})
	if bool(r.get("ok", false)):
		token = String(r.get("token", ""))
		_store_token()
	return r


func logout() -> void:
	stop_sync()
	if not token.is_empty():
		await post("logout")
	token = ""
	_store_token()


func create_character(appearance: Dictionary) -> Dictionary:
	return await post("create", {"app": appearance})


func load_character() -> Dictionary:
	var r := await post("load")
	if bool(r.get("ok", false)):
		server_build = String(r.get("build", server_build))
		loaded.emit(r)
	return r


func recipes() -> Dictionary:
	return await post("recipes")


func act(op: String, params: Dictionary = {}) -> Dictionary:
	var body := params.duplicate()
	body["op"] = op
	return await post("act", body)


func say(message: String, to: String = "") -> Dictionary:
	return await post("chat", {"m": message, "to": to})


func save_settings(settings: Dictionary) -> Dictionary:
	return await post("save", {"settings": settings})


## ---------------------------------------------------------------------------
## Sync
## ---------------------------------------------------------------------------

func set_local(x: float, z: float, facing: float, anim: String) -> void:
	_pending["x"] = snappedf(x, 0.01)
	_pending["z"] = snappedf(z, 0.01)
	_pending["r"] = snappedf(facing, 0.001)
	_pending["anim"] = anim


func start_sync() -> void:
	_syncing = true
	_sync_accum = _interval


func stop_sync() -> void:
	_syncing = false


func _do_sync() -> void:
	_sync_in_flight = true
	var sent := float(Time.get_ticks_msec()) / 1000.0
	var r := await post("sync", {
		"x": _pending["x"], "z": _pending["z"], "r": _pending["r"],
		"anim": _pending["anim"], "since": _since, "known": _known,
	})
	_sync_in_flight = false

	if not bool(r.get("ok", false)):
		_failures += 1
		_interval = minf(3.0, 0.4 * float(_failures))
		var reason := String(r.get("error", ""))
		if reason.to_lower().contains("session"):
			kicked.emit(reason)
		elif _failures == 3:
			net_trouble.emit(reason)
		return

	_failures = 0
	last_rtt = float(Time.get_ticks_msec()) / 1000.0 - sent
	# Never poll faster than the round trip, or the requests queue up behind
	# each other and the client feels worse the slower the connection is.
	_interval = clampf(last_rtt * 1.15 + 0.09, MIN_INTERVAL, MAX_INTERVAL)
	_server_offset = float(r.get("t", 0.0)) - float(Time.get_ticks_msec()) / 1000.0

	_ingest_players(r.get("players", []))
	for c: Variant in r.get("chat", []):
		if c is Dictionary:
			_since = maxi(_since, int(c.get("t", 0)))
	synced.emit(r)


func _ingest_players(list: Array) -> void:
	var seen: Dictionary = {}
	for p: Variant in list:
		if not p is Dictionary:
			continue
		var id := String(p.get("id", ""))
		if id.is_empty():
			continue
		seen[id] = true
		if p.has("app"):
			_known[id] = p.get("av", 0)
		if not _snaps.has(id):
			_snaps[id] = []
		var buf: Array = _snaps[id]
		var t := float(p.get("t", 0.0))
		if buf.is_empty() or not is_equal_approx(float(buf[-1]["t"]), t):
			buf.append({
				"t": t, "x": float(p.get("x", 0.0)), "z": float(p.get("z", 0.0)),
				"r": float(p.get("r", 0.0)), "anim": String(p.get("a", "idle")),
				"hp": int(p.get("hp", 0)), "mhp": int(p.get("mhp", 0)),
			})
			while buf.size() > SNAP_BUFFER:
				buf.pop_front()
	for id: String in _snaps.keys():
		if not seen.has(id):
			_snaps.erase(id)


## Where should player `id` be drawn right now? Rendered RENDER_DELAY behind the
## newest snapshot and interpolated between the two that straddle that moment,
## which removes the stutter a plain snap-to-latest produces.
func interpolate(id: String) -> Dictionary:
	if not _snaps.has(id):
		return {}
	var buf: Array = _snaps[id]
	if buf.is_empty():
		return {}
	var now := float(Time.get_ticks_msec()) / 1000.0 + _server_offset - RENDER_DELAY
	if buf.size() == 1 or now <= float(buf[0]["t"]):
		return _frame(buf[0], false)
	var last: Dictionary = buf[-1]
	if now >= float(last["t"]):
		# Past the newest packet: hold position rather than guess wildly.
		return _frame(last, false)
	for i in range(buf.size() - 1):
		var a: Dictionary = buf[i]
		var b: Dictionary = buf[i + 1]
		var ta := float(a["t"])
		var tb := float(b["t"])
		if now < ta or now > tb:
			continue
		var span := tb - ta
		var k: float = 0.0 if span <= 0.0 else (now - ta) / span
		var out := {
			"x": lerpf(float(a["x"]), float(b["x"]), k),
			"z": lerpf(float(a["z"]), float(b["z"]), k),
			"r": lerp_angle(float(a["r"]), float(b["r"]), k),
			"anim": String(b["anim"]),
			"hp": int(b["hp"]), "mhp": int(b["mhp"]),
			"moving": absf(float(b["x"]) - float(a["x"])) + absf(float(b["z"]) - float(a["z"])) > 0.01,
		}
		return out
	return _frame(last, false)


func _frame(s: Dictionary, moving: bool) -> Dictionary:
	return {
		"x": float(s["x"]), "z": float(s["z"]), "r": float(s["r"]),
		"anim": String(s["anim"]), "hp": int(s["hp"]), "mhp": int(s["mhp"]),
		"moving": moving,
	}


func known_player_ids() -> Array:
	return _snaps.keys()


## ---------------------------------------------------------------------------
## Token persistence
## ---------------------------------------------------------------------------
## In a browser this lands in the origin's persistent storage, which is the same
## place the JavaScript client's localStorage token went.

func _store_token() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("auth", "token", token)
	cfg.save("user://session.cfg")


func _restore_token() -> void:
	var cfg := ConfigFile.new()
	if cfg.load("user://session.cfg") == OK:
		token = String(cfg.get_value("auth", "token", ""))
