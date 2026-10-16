## Emberfall - A* over the tile collision grid.
##
## Godot's own NavigationServer is deliberately not used. The server is
## authoritative about movement and it walks the same tile grid the PHP side
## does, so the client has to agree tile for tile. A navmesh baked off the
## terrain mesh would take slightly different routes and the client would
## constantly be corrected by the server.
##
## Eight-way movement, with diagonals forbidden when either orthogonal
## neighbour is blocked, so an actor never slips through the corner between two
## buildings.
class_name EmberPath
extends RefCounted

## The graph nodes are the CORNERS of the tile grid, at integer coordinates -
## the same points WorldData stamps its collision grid at and the same points
## tools/validate_world.js floods. There are WORLD + 1 of them per axis, and a
## node's coordinates ARE its world position, so a route needs no conversion.
const GRID: int = EmberTerrainDef.WORLD + 1
const MAX_EXPANSIONS: int = 24000

## Straight cost 10, diagonal 14: integer costs keep the heap comparisons exact.
const COST_STRAIGHT: int = 10
const COST_DIAG: int = 14

const NEIGHBOURS: Array[Vector2i] = [
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1),
]


## Find a tile path from `from` to `to`, inclusive of both ends.
## Returns an empty array when no route exists.
##
## `goal_radius` lets an actor path to something it only needs to stand NEXT to,
## which is how you walk up to a tree rather than into it.
static func find(from: Vector2i, to: Vector2i, goal_radius: int = 0) -> Array[Vector2i]:
	var empty: Array[Vector2i] = []
	if not _in_bounds(from) or not _in_bounds(to):
		return empty
	if _reached(from, to, goal_radius):
		var one: Array[Vector2i] = [from]
		return one

	# If the goal tile itself is blocked and no radius was given, aim for the
	# nearest free tile beside it instead of failing outright. Clicking on a
	# tree should walk you to the tree.
	var target := to
	if goal_radius == 0 and _blocked(to):
		var alt := _nearest_free(to)
		if alt == Vector2i(-1, -1):
			return empty
		target = alt

	var g: Dictionary = {}          # Vector2i -> int cost so far
	var came: Dictionary = {}       # Vector2i -> Vector2i
	var closed: Dictionary = {}
	var open := _Heap.new()

	var start_key := _key(from)
	g[start_key] = 0
	open.push(_h(from, target), start_key)

	var expansions := 0
	var found := false
	var end_key := -1

	while not open.is_empty():
		var cur_key: int = open.pop()
		if closed.has(cur_key):
			continue
		closed[cur_key] = true
		var cur := _unkey(cur_key)

		if _reached(cur, target, goal_radius):
			found = true
			end_key = cur_key
			break

		expansions += 1
		if expansions > MAX_EXPANSIONS:
			break

		var cur_g: int = g[cur_key]
		for d in NEIGHBOURS:
			var nx := cur.x + d.x
			var nz := cur.y + d.y
			if nx < 0 or nz < 0 or nx >= GRID or nz >= GRID:
				continue
			var n := Vector2i(nx, nz)
			var n_key := _key(n)
			if closed.has(n_key):
				continue
			var is_diag: bool = d.x != 0 and d.y != 0
			# Only the literal goal tile may be blocked, and only when the
			# caller asked for an exact tile. With a goal_radius the actor
			# stops beside the target, so every tile it stands on is clear.
			if _blocked(n) and not (goal_radius == 0 and n == target):
				continue
			if is_diag:
				# No corner-cutting between two blocked orthogonals.
				if _blocked(Vector2i(cur.x + d.x, cur.y)) or _blocked(Vector2i(cur.x, cur.y + d.y)):
					continue
			var step: int = COST_DIAG if is_diag else COST_STRAIGHT
			var ng: int = cur_g + step
			if g.has(n_key) and ng >= int(g[n_key]):
				continue
			g[n_key] = ng
			came[n_key] = cur_key
			open.push(ng + _h(n, target), n_key)

	if not found:
		return empty

	var out: Array[Vector2i] = []
	var walk: int = end_key
	while true:
		out.push_back(_unkey(walk))
		if walk == start_key:
			break
		if not came.has(walk):
			break
		walk = came[walk]
	out.reverse()
	return out


## Octile distance, scaled to the integer step costs so the heuristic never
## overestimates and A* stays admissible.
static func _h(a: Vector2i, b: Vector2i) -> int:
	var dx: int = absi(a.x - b.x)
	var dz: int = absi(a.y - b.y)
	var lo: int = mini(dx, dz)
	var hi: int = maxi(dx, dz)
	return COST_STRAIGHT * (hi - lo) + COST_DIAG * lo


static func _reached(at: Vector2i, goal: Vector2i, radius: int) -> bool:
	if radius <= 0:
		return at == goal
	return absi(at.x - goal.x) <= radius and absi(at.y - goal.y) <= radius


static func _in_bounds(p: Vector2i) -> bool:
	return p.x >= 0 and p.y >= 0 and p.x < GRID and p.y < GRID


static func _blocked(p: Vector2i) -> bool:
	return WorldData.is_blocked(p.x, p.y)


## Nearest walkable tile to a blocked one, searched in rings so the result is
## the closest and the search is bounded.
static func _nearest_free(centre: Vector2i) -> Vector2i:
	for r in range(1, 9):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if absi(dx) != r and absi(dz) != r:
					continue
				var p := Vector2i(centre.x + dx, centre.y + dz)
				if _in_bounds(p) and not _blocked(p):
					return p
	return Vector2i(-1, -1)


static func _key(p: Vector2i) -> int:
	return p.y * GRID + p.x


static func _unkey(k: int) -> Vector2i:
	return Vector2i(k % GRID, k / GRID)


## A binary min-heap. Godot has no priority queue and sorting an open list on
## every push turns A* across the world into seconds rather than milliseconds.
class _Heap:
	extends RefCounted

	var _pri: PackedInt32Array = PackedInt32Array()
	var _val: PackedInt32Array = PackedInt32Array()

	func is_empty() -> bool:
		return _pri.is_empty()

	func push(pri: int, val: int) -> void:
		_pri.push_back(pri)
		_val.push_back(val)
		var i: int = _pri.size() - 1
		while i > 0:
			var parent: int = (i - 1) / 2
			if _pri[parent] <= _pri[i]:
				break
			_swap(parent, i)
			i = parent

	func pop() -> int:
		var top: int = _val[0]
		var last: int = _pri.size() - 1
		_pri[0] = _pri[last]
		_val[0] = _val[last]
		_pri.remove_at(last)
		_val.remove_at(last)
		var n: int = _pri.size()
		var i := 0
		while true:
			var l: int = i * 2 + 1
			var r: int = l + 1
			var small := i
			if l < n and _pri[l] < _pri[small]:
				small = l
			if r < n and _pri[r] < _pri[small]:
				small = r
			if small == i:
				break
			_swap(small, i)
			i = small
		return top

	func _swap(a: int, b: int) -> void:
		var tp: int = _pri[a]
		var tv: int = _val[a]
		_pri[a] = _pri[b]
		_val[a] = _val[b]
		_pri[b] = tp
		_val[b] = tv
