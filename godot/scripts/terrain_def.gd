## Emberfall - shared terrain definition, ported from js/terrain_height.js.
##
## This is a LITERAL port. The PHP server and the Node authoring tools both
## derive the world from the JavaScript original, so if this file disagrees by
## even one bit the buildings in data/authored_world.json will float above or
## sink into the ground, and the server's collision will not match what the
## player sees.
##
## The whole file is pure maths with no node dependencies so it can be called
## from a @tool script in the editor as well as at runtime.
##
## Two JavaScript details that do NOT port directly and are emulated below:
##
##   Math.imul(a, b)  multiplies as 32-bit SIGNED integers and discards the
##                    high bits. GDScript ints are 64-bit, so a plain a * b
##                    would keep bits JavaScript throws away.
##   h >>> 13         is an UNSIGNED right shift. GDScript's >> is arithmetic,
##                    so a negative value would shift in ones.
##
## Everything here therefore carries hash state as an unsigned 32-bit value
## held in a 64-bit int, and only reinterprets it as signed inside _imul.
class_name EmberTerrainDef
extends RefCounted

const WORLD: int = 384      ## world is WORLD x WORLD tiles
const WATER: float = 0.0    ## sea level

const U32: int = 0xFFFFFFFF
const SIGN_BIT: int = 0x80000000
const TWO_32: int = 0x100000000

## Flattened build pads: settlements sit on level ground.
const PADS: Array = [
	{"n": "oakheart", "x": 160.0, "z": 268.0, "r": 36.0, "h": 2.2},
	{"n": "farmstead", "x": 206.0, "z": 286.0, "r": 24.0, "h": 2.0},
	{"n": "aldermere", "x": 250.0, "z": 190.0, "r": 42.0, "h": 3.0},
	{"n": "dunhollow", "x": 200.0, "z": 62.0, "r": 28.0, "h": 15.0},
	{"n": "saltbrook", "x": 140.0, "z": 322.0, "r": 30.0, "h": 1.2},
	{"n": "mirefen", "x": 62.0, "z": 176.0, "r": 24.0, "h": 0.55},
	{"n": "blightfort", "x": 330.0, "z": 210.0, "r": 26.0, "h": 4.2},
	{"n": "minecamp", "x": 150.0, "z": 206.0, "r": 14.0, "h": 4.0},
	{"n": "shrine", "x": 96.0, "z": 268.0, "r": 12.0, "h": 3.2},
	{"n": "isle", "x": 176.0, "z": 356.0, "r": 14.0, "h": 1.4},
]

## Roads: polylines, carved flat-ish and painted as dirt.
const ROADS: Array = [
	[[186.0, 262.0], [206.0, 244.0], [224.0, 224.0], [240.0, 206.0], [250.0, 196.0]],
	[[250.0, 158.0], [244.0, 132.0], [230.0, 104.0], [212.0, 80.0], [202.0, 70.0]],
	[[159.0, 296.0], [154.0, 308.0], [146.0, 318.0], [140.0, 322.0]],
	[[282.0, 194.0], [300.0, 198.0], [316.0, 204.0], [328.0, 208.0]],
	[[134.0, 264.0], [112.0, 244.0], [92.0, 218.0], [74.0, 192.0], [66.0, 180.0]],
	[[160.0, 240.0], [157.0, 226.0], [153.0, 214.0], [150.0, 208.0]],
	[[184.0, 276.0], [194.0, 282.0], [202.0, 285.0]],
	[[148.0, 268.0], [128.0, 270.0], [110.0, 269.0], [100.0, 268.0]],
]

## River: mountains -> Oakheart -> southern sea.
const RIVER: Array = [
	[152.0, 52.0], [148.0, 96.0], [156.0, 140.0], [168.0, 186.0],
	[174.0, 232.0], [180.0, 276.0], [186.0, 316.0], [192.0, 352.0],
]

## Standing water: swamp pools and inland ponds. Carved after the build pads
## so a pad can never fill one in.
const PONDS: Array = [
	{"x": 68.0, "z": 204.0, "r": 13.0, "d": 2.6},
	{"x": 56.0, "z": 196.0, "r": 9.0, "d": 2.2},
	{"x": 80.0, "z": 188.0, "r": 8.0, "d": 2.0},
	{"x": 128.0, "z": 224.0, "r": 7.0, "d": 1.8},
	{"x": 296.0, "z": 232.0, "r": 9.0, "d": 2.2},
]

## Southern islands, as [x, z, radius].
const ISLES: Array = [[176.0, 356.0, 15.0], [118.0, 350.0, 11.0], [214.0, 344.0, 10.0]]


## JavaScript Math.imul: multiply as 32-bit signed, keep the low 32 bits.
## Takes and returns unsigned 32-bit values held in 64-bit ints.
static func _imul(a: int, b: int) -> int:
	var sa: int = a & U32
	var sb: int = b & U32
	if sa >= SIGN_BIT:
		sa -= TWO_32
	if sb >= SIGN_BIT:
		sb -= TWO_32
	# |sa| and |sb| are both at most 2^31, so the product is at most 2^62 and
	# cannot overflow a 64-bit int before masking.
	return (sa * sb) & U32


## Hash three integer coordinates to a float in [0, 1).
static func hash3(x: int, y: int, s: int) -> float:
	var h: int = _imul(x, 374761393) ^ _imul(y, 668265263) ^ _imul(s, 1442695041)
	h = _imul(h ^ (h >> 13), 1274126177)
	return float((h ^ (h >> 16)) & U32) / 4294967296.0


static func vnoise(x: float, z: float, s: int) -> float:
	var xi: int = int(floor(x))
	var zi: int = int(floor(z))
	var xf: float = x - float(xi)
	var zf: float = z - float(zi)
	var u: float = xf * xf * (3.0 - 2.0 * xf)
	var v: float = zf * zf * (3.0 - 2.0 * zf)
	var a: float = hash3(xi, zi, s)
	var b: float = hash3(xi + 1, zi, s)
	var c: float = hash3(xi, zi + 1, s)
	var d: float = hash3(xi + 1, zi + 1, s)
	return (a * (1.0 - u) + b * u) * (1.0 - v) + (c * (1.0 - u) + d * u) * v


static func fbm(x: float, z: float, oct: int, freq: float, s: int) -> float:
	var amp: float = 1.0
	var sum: float = 0.0
	var norm: float = 0.0
	var f: float = freq
	for i in range(oct):
		sum += vnoise(x * f, z * f, s + i * 13) * amp
		norm += amp
		amp *= 0.5
		f *= 2.0
	return sum / norm


static func _clampf(v: float, a: float, b: float) -> float:
	if v < a:
		return a
	if v > b:
		return b
	return v


static func _smooth(t: float) -> float:
	return t * t * (3.0 - 2.0 * t)


static func _dist_to_poly(x: float, z: float, poly: Array) -> float:
	var best: float = 1e9
	for i in range(poly.size() - 1):
		var ax: float = poly[i][0]
		var az: float = poly[i][1]
		var bx: float = poly[i + 1][0]
		var bz: float = poly[i + 1][1]
		var dx: float = bx - ax
		var dz: float = bz - az
		var ln: float = dx * dx + dz * dz
		var t: float = 0.0
		if ln > 0.0:
			t = ((x - ax) * dx + (z - az) * dz) / ln
		t = _clampf(t, 0.0, 1.0)
		var px: float = ax + dx * t
		var pz: float = az + dz * t
		var d: float = sqrt((x - px) * (x - px) + (z - pz) * (z - pz))
		if d < best:
			best = d
	return best


static func road_dist(x: float, z: float) -> float:
	var best: float = 1e9
	for i in range(ROADS.size()):
		var d: float = _dist_to_poly(x, z, ROADS[i])
		if d < best:
			best = d
	return best


static func river_dist(x: float, z: float) -> float:
	return _dist_to_poly(x, z, RIVER)


## Cheap height without the road smoothing pass. The full height() samples
## this four times to average across a road, so it must not recurse.
static func height0(x: float, z: float) -> float:
	var h: float = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2
	var mt: float = _clampf((118.0 - z) / 96.0, 0.0, 1.0)
	h += mt * mt * (26.0 + 22.0 * fbm(x, z, 3, 0.021, 307))
	var edge: float = minf(minf(x - 8.0, float(WORLD) - 8.0 - x), float(WORLD) - 26.0 - z)
	if edge < 26.0:
		var t: float = _clampf(1.0 - edge / 26.0, 0.0, 1.0)
		h -= t * t * 34.0
	for p in range(PADS.size()):
		var pad: Dictionary = PADS[p]
		var pd: float = sqrt(
			(x - pad["x"]) * (x - pad["x"]) + (z - pad["z"]) * (z - pad["z"])
		)
		var pf: float = 1.0 - _clampf((pd - pad["r"] * 0.62) / (pad["r"] * 0.62), 0.0, 1.0)
		if pf > 0.0:
			pf = _smooth(pf)
			h = h * (1.0 - pf) + pad["h"] * pf
	return h


static func height(x: float, z: float) -> float:
	# rolling base
	var h: float = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2
	h += fbm(x, z, 2, 0.061, 211) * 1.6

	# northern mountain wall
	var mt: float = _clampf((118.0 - z) / 96.0, 0.0, 1.0)
	h += mt * mt * (26.0 + 22.0 * fbm(x, z, 3, 0.021, 307))

	# swamp basin (west)
	var sd: float = sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
	var sw: float = 1.0 - _clampf((sd - 30.0) / 58.0, 0.0, 1.0)
	if sw > 0.0:
		h = h * (1.0 - 0.85 * sw) + 0.45 * 0.85 * sw

	# blighted plateau (east)
	var bd: float = sqrt((x - 324.0) * (x - 324.0) + (z - 212.0) * (z - 212.0))
	var bl: float = 1.0 - _clampf((bd - 26.0) / 62.0, 0.0, 1.0)
	if bl > 0.0:
		h = h * (1.0 - 0.7 * bl) + 5.2 * 0.7 * bl + 2.5 * bl * fbm(x, z, 2, 0.05, 409)

	# sea on south / east / west margins
	var edge: float = minf(minf(x - 8.0, float(WORLD) - 8.0 - x), float(WORLD) - 26.0 - z)
	if edge < 26.0:
		var te: float = _clampf(1.0 - edge / 26.0, 0.0, 1.0)
		h -= te * te * 34.0

	# southern islands
	for i in range(ISLES.size()):
		var isle: Array = ISLES[i]
		var dd: float = sqrt(
			(x - isle[0]) * (x - isle[0]) + (z - isle[1]) * (z - isle[1])
		)
		var f: float = 1.0 - _clampf(dd / isle[2], 0.0, 1.0)
		h += _smooth(f) * 9.5

	# settlement pads first - then water is carved through them, so the river
	# still splits Oakheart instead of being paved over by the village pad.
	for p in range(PADS.size()):
		var pad: Dictionary = PADS[p]
		var pd: float = sqrt(
			(x - pad["x"]) * (x - pad["x"]) + (z - pad["z"]) * (z - pad["z"])
		)
		var pf: float = 1.0 - _clampf((pd - pad["r"] * 0.62) / (pad["r"] * 0.62), 0.0, 1.0)
		if pf > 0.0:
			pf = _smooth(pf)
			h = h * (1.0 - pf) + pad["h"] * pf

	# ponds
	for q in range(PONDS.size()):
		var pond: Dictionary = PONDS[q]
		var qd: float = sqrt(
			(x - pond["x"]) * (x - pond["x"]) + (z - pond["z"]) * (z - pond["z"])
		)
		var qf: float = 1.0 - _clampf(qd / pond["r"], 0.0, 1.0)
		if qf > 0.0:
			qf = _smooth(qf)
			h = h * (1.0 - qf) + (-pond["d"]) * qf

	# river carve
	var rd: float = river_dist(x, z)
	if rd < 14.0:
		var rt: float = 1.0 - _clampf((rd - 3.2) / 10.8, 0.0, 1.0)
		var bed: float = -1.6 + maxf(0.0, rd - 3.2) * 0.24
		h = h * (1.0 - rt * 0.94) + bed * rt * 0.94

	# roads smooth the ground they cross
	var road: float = road_dist(x, z)
	if road < 7.0:
		var rf: float = _smooth(1.0 - _clampf(road / 7.0, 0.0, 1.0)) * 0.55
		var avg: float = (
			height0(x - 4.0, z) + height0(x + 4.0, z)
			+ height0(x, z - 4.0) + height0(x, z + 4.0)
		) * 0.25
		h = h * (1.0 - rf) + avg * rf
	return h


## One of: water, sand, grass, path, dirt, rock, snow, muck, blight
static func ground(x: float, z: float, h: float = INF) -> String:
	var hh: float = h
	if is_inf(hh):
		hh = height(x, z)
	if hh < WATER:
		return "water"
	if hh < 0.55:
		var sd2: float = sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
		if sd2 < 74.0:
			return "muck"
		return "sand"
	if road_dist(x, z) < 2.6:
		return "path"
	if hh > 30.0:
		return "snow"
	if hh > 19.0:
		return "rock"
	var sd: float = sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
	if sd < 70.0:
		return "muck"
	var bd: float = sqrt((x - 324.0) * (x - 324.0) + (z - 212.0) * (z - 212.0))
	if bd < 58.0:
		return "blight"
	if river_dist(x, z) < 5.5 and hh < 1.6:
		return "sand"
	return "grass"


static func region(x: float, z: float) -> String:
	if z < 118.0:
		return "Kragmar Peaks"
	if z > 300.0:
		return "Saltbrook Coast"
	if x < 112.0:
		return "Mirefen"
	if x > 296.0:
		return "The Blightlands"
	if x > 210.0 and z < 240.0:
		return "Aldermere"
	return "Oakheart Vale"
