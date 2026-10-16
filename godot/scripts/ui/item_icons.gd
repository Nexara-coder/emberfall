## Emberfall - item icons.
##
## Every one of the 387 items in data/items.json carries an icon triple:
##
##     "icon": ["sword", "#b07a3c", "#7a5228"]
##
## a shape name and two colours. There are 60 distinct shapes. No icon art was
## ever delivered (see ASSET_AUDIT.md), so they are drawn here, the same way
## js/icons.js draws them for the web client - chunky, flat, readable at 32px,
## which is what 2005 inventory icons were.
##
## Each icon is drawn once into an ImageTexture and cached by its triple, so the
## 28 inventory slots and the bank share textures rather than redrawing.
class_name EmberItemIcons
extends RefCounted

const SIZE := 32
## Drawn at 2x and downscaled, so the diagonals are not jagged.
const SS := 2

static var _cache: Dictionary = {}


## Texture for an item dictionary from data/items.json.
static func for_item(item: Dictionary) -> Texture2D:
	var icon: Array = item.get("icon", [])
	var shape: String = String(icon[0]) if icon.size() > 0 else "misc"
	var a: Color = _col(icon[1] if icon.size() > 1 else "#b9a06a")
	var b: Color = _col(icon[2] if icon.size() > 2 else "#6d5a35")
	return get_icon(shape, a, b)


static func get_icon(shape: String, a: Color, b: Color) -> Texture2D:
	var key := shape + "|" + a.to_html(false) + "|" + b.to_html(false)
	if _cache.has(key):
		return _cache[key]
	var img := Image.create(SIZE * SS, SIZE * SS, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	_draw(img, shape, a, b)
	img.resize(SIZE, SIZE, Image.INTERPOLATE_LANCZOS)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


static func _col(v: Variant) -> Color:
	var s := String(v)
	if s.begins_with("#"):
		return Color.from_string(s, Color(0.72, 0.63, 0.42))
	return Color(0.72, 0.63, 0.42)


## ---------------------------------------------------------------------------
## Primitive drawing. Coordinates are 0..1 and scaled to the supersampled image.
## ---------------------------------------------------------------------------

static func _px(img: Image, x: int, y: int, c: Color) -> void:
	if x < 0 or y < 0 or x >= img.get_width() or y >= img.get_height():
		return
	if c.a >= 0.999:
		img.set_pixel(x, y, c)
		return
	var under := img.get_pixel(x, y)
	img.set_pixel(x, y, under.lerp(c, c.a) if under.a > 0.0 else c)


static func _rect(img: Image, x0: float, y0: float, x1: float, y1: float, c: Color) -> void:
	var w := img.get_width()
	var ax := int(round(minf(x0, x1) * float(w)))
	var bx := int(round(maxf(x0, x1) * float(w)))
	var ay := int(round(minf(y0, y1) * float(w)))
	var by := int(round(maxf(y0, y1) * float(w)))
	for y in range(ay, by):
		for x in range(ax, bx):
			_px(img, x, y, c)


## A filled convex polygon, given as 0..1 points.
static func _poly(img: Image, pts: PackedVector2Array, c: Color) -> void:
	if pts.size() < 3:
		return
	var w := float(img.get_width())
	var min_y := 1e9
	var max_y := -1e9
	for p in pts:
		min_y = minf(min_y, p.y * w)
		max_y = maxf(max_y, p.y * w)
	var y0 := int(floor(min_y))
	var y1 := int(ceil(max_y))
	for y in range(y0, y1 + 1):
		var xs: Array[float] = []
		var n := pts.size()
		for i in range(n):
			var p1 := pts[i] * w
			var p2 := pts[(i + 1) % n] * w
			if (p1.y <= float(y) and p2.y > float(y)) or (p2.y <= float(y) and p1.y > float(y)):
				var t: float = (float(y) - p1.y) / (p2.y - p1.y)
				xs.append(p1.x + t * (p2.x - p1.x))
		xs.sort()
		var i2 := 0
		while i2 + 1 < xs.size():
			for x in range(int(round(xs[i2])), int(round(xs[i2 + 1])) + 1):
				_px(img, x, y, c)
			i2 += 2


static func _disc(img: Image, cx: float, cy: float, r: float, c: Color) -> void:
	var w := float(img.get_width())
	var px := cx * w
	var py := cy * w
	var pr := r * w
	for y in range(int(py - pr) - 1, int(py + pr) + 2):
		for x in range(int(px - pr) - 1, int(px + pr) + 2):
			var dx := float(x) + 0.5 - px
			var dy := float(y) + 0.5 - py
			if dx * dx + dy * dy <= pr * pr:
				_px(img, x, y, c)


## ---------------------------------------------------------------------------
## The shapes
## ---------------------------------------------------------------------------

static func _draw(img: Image, shape: String, a: Color, b: Color) -> void:
	match shape:
		"coin":
			_disc(img, 0.38, 0.60, 0.22, b)
			_disc(img, 0.62, 0.44, 0.24, a)
			_disc(img, 0.62, 0.44, 0.15, a.lightened(0.25))
		"dagger", "sword", "scimitar", "longsword", "greatsword":
			var len_f: float = {
				"dagger": 0.42, "sword": 0.56, "scimitar": 0.58,
				"longsword": 0.66, "greatsword": 0.74,
			}.get(shape, 0.56)
			var half := 0.055 if shape != "greatsword" else 0.08
			_poly(img, PackedVector2Array([
				Vector2(0.5 - half, 0.88 - len_f), Vector2(0.5 + half, 0.88 - len_f),
				Vector2(0.5 + half, 0.70), Vector2(0.5, 0.76), Vector2(0.5 - half, 0.70),
			]), a)
			_rect(img, 0.30, 0.70, 0.70, 0.76, b)        # guard
			_rect(img, 0.455, 0.76, 0.545, 0.92, b)      # grip
			_disc(img, 0.5, 0.93, 0.055, b.lightened(0.2))
		"mace", "battleaxe", "hatchet", "pickaxe":
			_rect(img, 0.46, 0.30, 0.54, 0.92, b)
			if shape == "mace":
				_disc(img, 0.5, 0.26, 0.19, a)
			elif shape == "pickaxe":
				_poly(img, PackedVector2Array([
					Vector2(0.14, 0.30), Vector2(0.86, 0.30),
					Vector2(0.70, 0.19), Vector2(0.30, 0.19),
				]), a)
			else:
				_poly(img, PackedVector2Array([
					Vector2(0.50, 0.14), Vector2(0.88, 0.26),
					Vector2(0.88, 0.42), Vector2(0.50, 0.34),
				]), a)
				if shape == "battleaxe":
					_poly(img, PackedVector2Array([
						Vector2(0.50, 0.14), Vector2(0.12, 0.26),
						Vector2(0.12, 0.42), Vector2(0.50, 0.34),
					]), a)
		"bow", "crossbow":
			for i in range(14):
				var t := float(i) / 13.0
				var yy := 0.12 + t * 0.76
				var xx := 0.30 + sin(t * PI) * 0.30
				_disc(img, xx, yy, 0.045, a)
			_rect(img, 0.295, 0.12, 0.315, 0.88, b)
		"arrow":
			_rect(img, 0.47, 0.22, 0.53, 0.90, b)
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.08), Vector2(0.66, 0.30), Vector2(0.34, 0.30),
			]), a)
		"staff", "wand":
			_rect(img, 0.46, 0.22, 0.54, 0.92, b)
			_disc(img, 0.5, 0.18, 0.15, a)
		"helm":
			_poly(img, PackedVector2Array([
				Vector2(0.22, 0.62), Vector2(0.22, 0.38), Vector2(0.36, 0.20),
				Vector2(0.64, 0.20), Vector2(0.78, 0.38), Vector2(0.78, 0.62),
			]), a)
			_rect(img, 0.34, 0.40, 0.66, 0.52, b.darkened(0.35))
		"body":
			_poly(img, PackedVector2Array([
				Vector2(0.24, 0.28), Vector2(0.38, 0.22), Vector2(0.62, 0.22),
				Vector2(0.76, 0.28), Vector2(0.76, 0.80), Vector2(0.24, 0.80),
			]), a)
			_rect(img, 0.44, 0.22, 0.56, 0.52, b)
		"legs":
			_rect(img, 0.26, 0.22, 0.74, 0.44, a)
			_rect(img, 0.28, 0.44, 0.46, 0.86, a)
			_rect(img, 0.54, 0.44, 0.72, 0.86, a)
		"shield":
			_poly(img, PackedVector2Array([
				Vector2(0.22, 0.20), Vector2(0.78, 0.20),
				Vector2(0.72, 0.68), Vector2(0.50, 0.88), Vector2(0.28, 0.68),
			]), a)
			_disc(img, 0.5, 0.46, 0.12, b)
		"gloves":
			_rect(img, 0.28, 0.36, 0.72, 0.74, a)
			_rect(img, 0.28, 0.26, 0.40, 0.40, a)
			_rect(img, 0.44, 0.22, 0.56, 0.40, a)
			_rect(img, 0.60, 0.26, 0.72, 0.40, a)
		"boots":
			_poly(img, PackedVector2Array([
				Vector2(0.32, 0.22), Vector2(0.58, 0.22), Vector2(0.58, 0.62),
				Vector2(0.84, 0.62), Vector2(0.84, 0.82), Vector2(0.32, 0.82),
			]), a)
		"cape":
			_poly(img, PackedVector2Array([
				Vector2(0.34, 0.18), Vector2(0.66, 0.18),
				Vector2(0.82, 0.86), Vector2(0.18, 0.86),
			]), a)
			_rect(img, 0.34, 0.18, 0.66, 0.27, b)
		"ore", "nail":
			_poly(img, PackedVector2Array([
				Vector2(0.26, 0.70), Vector2(0.20, 0.44), Vector2(0.42, 0.26),
				Vector2(0.70, 0.28), Vector2(0.82, 0.56), Vector2(0.60, 0.80),
			]), b)
			_disc(img, 0.42, 0.48, 0.10, a)
			_disc(img, 0.62, 0.60, 0.08, a)
		"bar":
			_poly(img, PackedVector2Array([
				Vector2(0.18, 0.62), Vector2(0.30, 0.42), Vector2(0.82, 0.42),
				Vector2(0.70, 0.62),
			]), a)
			_rect(img, 0.18, 0.62, 0.70, 0.74, b)
		"log", "plank":
			_rect(img, 0.14, 0.38, 0.86, 0.64, b)
			_disc(img, 0.18, 0.51, 0.13, a)
			_disc(img, 0.18, 0.51, 0.06, b.darkened(0.3))
		"fish", "fishcooked":
			_poly(img, PackedVector2Array([
				Vector2(0.18, 0.50), Vector2(0.52, 0.28), Vector2(0.78, 0.50),
				Vector2(0.52, 0.72),
			]), a)
			_poly(img, PackedVector2Array([
				Vector2(0.78, 0.50), Vector2(0.92, 0.34), Vector2(0.92, 0.66),
			]), b)
			_disc(img, 0.38, 0.46, 0.035, Color(0.1, 0.1, 0.1))
		"potion":
			_rect(img, 0.44, 0.16, 0.56, 0.30, b)
			_poly(img, PackedVector2Array([
				Vector2(0.38, 0.30), Vector2(0.62, 0.30),
				Vector2(0.72, 0.60), Vector2(0.72, 0.86), Vector2(0.28, 0.86),
				Vector2(0.28, 0.60),
			]), a)
			_rect(img, 0.30, 0.62, 0.70, 0.84, a.darkened(0.25))
		"herb", "plant", "seed":
			if shape == "seed":
				_disc(img, 0.5, 0.60, 0.16, a)
				_disc(img, 0.5, 0.52, 0.09, b)
			else:
				_rect(img, 0.47, 0.40, 0.53, 0.88, b)
				for s in [-1.0, 1.0]:
					_poly(img, PackedVector2Array([
						Vector2(0.5, 0.46), Vector2(0.5 + s * 0.34, 0.30),
						Vector2(0.5 + s * 0.16, 0.56),
					]), a)
				_poly(img, PackedVector2Array([
					Vector2(0.5, 0.18), Vector2(0.66, 0.40), Vector2(0.34, 0.40),
				]), a)
		"rune":
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.14), Vector2(0.84, 0.50),
				Vector2(0.5, 0.86), Vector2(0.16, 0.50),
			]), a)
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.30), Vector2(0.68, 0.50),
				Vector2(0.5, 0.70), Vector2(0.32, 0.50),
			]), b)
		"bone":
			_rect(img, 0.30, 0.46, 0.70, 0.56, a)
			for cx in [0.28, 0.72]:
				_disc(img, cx, 0.42, 0.11, a)
				_disc(img, cx, 0.60, 0.11, a)
		"food", "bread", "meat":
			_disc(img, 0.5, 0.56, 0.30, a)
			_rect(img, 0.20, 0.56, 0.80, 0.78, a)
			_disc(img, 0.42, 0.48, 0.07, b)
			_disc(img, 0.60, 0.58, 0.06, b)
		"tool":
			_rect(img, 0.44, 0.34, 0.56, 0.90, b)
			_rect(img, 0.26, 0.18, 0.74, 0.36, a)
		"gem":
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.16), Vector2(0.82, 0.42),
				Vector2(0.66, 0.84), Vector2(0.34, 0.84), Vector2(0.18, 0.42),
			]), a)
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.16), Vector2(0.66, 0.84), Vector2(0.34, 0.84),
			]), a.lightened(0.3))
		"key":
			_disc(img, 0.34, 0.34, 0.18, a)
			_disc(img, 0.34, 0.34, 0.08, Color(0, 0, 0, 0))
			_rect(img, 0.42, 0.44, 0.52, 0.88, a)
			_rect(img, 0.52, 0.70, 0.70, 0.78, a)
		"quest", "scroll", "book":
			_rect(img, 0.22, 0.18, 0.78, 0.84, a)
			_rect(img, 0.22, 0.18, 0.34, 0.84, b)
			for i in range(4):
				_rect(img, 0.40, 0.30 + float(i) * 0.12, 0.70, 0.34 + float(i) * 0.12, b)
		"feather":
			_poly(img, PackedVector2Array([
				Vector2(0.5, 0.12), Vector2(0.74, 0.52),
				Vector2(0.5, 0.88), Vector2(0.40, 0.52),
			]), a)
			_rect(img, 0.485, 0.12, 0.515, 0.90, b)
		"cloth", "leather", "hide":
			_poly(img, PackedVector2Array([
				Vector2(0.18, 0.28), Vector2(0.82, 0.22),
				Vector2(0.76, 0.80), Vector2(0.24, 0.84),
			]), a)
			_rect(img, 0.30, 0.40, 0.70, 0.48, b)
		"ring", "amulet", "jewellery":
			_disc(img, 0.5, 0.56, 0.26, a)
			_disc(img, 0.5, 0.56, 0.15, Color(0, 0, 0, 0))
			_disc(img, 0.5, 0.26, 0.11, b)
		_:
			# Anything without a bespoke shape still gets something legible.
			_poly(img, PackedVector2Array([
				Vector2(0.24, 0.24), Vector2(0.76, 0.24),
				Vector2(0.76, 0.80), Vector2(0.24, 0.80),
			]), a)
			_rect(img, 0.34, 0.36, 0.66, 0.46, b)
			_rect(img, 0.34, 0.56, 0.66, 0.66, b)
