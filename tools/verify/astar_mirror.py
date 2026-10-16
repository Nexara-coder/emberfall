"""Python mirror of godot/scripts/pathfinder.gd, hand-transcribed from the
GDScript, run against the real collision grid derived from the real world data.

The point is to exercise the algorithm - the heap, the diagonal rule, the
path reconstruction, the blocked-goal fallback - on thousands of real routes,
because none of that can be checked by a parser.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gd_mirror as T  # noqa: E402

WORLD = T.WORLD
COST_STRAIGHT = 10
COST_DIAG = 14
MAX_EXPANSIONS = 24000
NEIGHBOURS = [
    (1, 0), (-1, 0), (0, 1), (0, -1),
    (1, 1), (1, -1), (-1, 1), (-1, -1),
]

GRID = WORLD + 1
WATER_LEVEL = 0.08
CLIFF_SLOPE = 1.55
ROAD_WIDTH = 2.4
DOOR_CLEAR = 1.8
OBJECT_RADII = {
    "tree": 0.8, "rock": 1.1, "sign": 0.4, "well": 1.3, "furnace": 1.6,
    "anvil": 1.1, "range": 1.2, "altar": 1.4, "altar_rc": 1.6,
    "bank_booth": 1.2, "statue": 1.0, "fountain": 1.6,
}

HEIGHT = None
BLOCKED = None


def build_grid(world):
    """Mirror of WorldData._stamp_all, which mirrors tools/validate_world.js."""
    global HEIGHT, BLOCKED
    HEIGHT = [0.0] * (GRID * GRID)
    BLOCKED = bytearray(GRID * GRID)
    for z in range(GRID):
        base = z * GRID
        for x in range(GRID):
            HEIGHT[base + x] = T.height(float(x), float(z))

    def h_raw(x, z):
        if 0 <= x < GRID and 0 <= z < GRID:
            return HEIGHT[z * GRID + x]
        return T.height(float(x), float(z))

    for z in range(GRID):
        base = z * GRID
        for x in range(GRID):
            h = HEIGHT[base + x]
            b = 0
            if h < WATER_LEVEL:
                b = 1
            else:
                mx = max(
                    abs(h_raw(x - 1, z) - h), abs(h_raw(x + 1, z) - h),
                    abs(h_raw(x, z - 1) - h), abs(h_raw(x, z + 1) - h),
                )
                if mx > CLIFF_SLOPE:
                    b = 1
            if b == 1 and h >= WATER_LEVEL:
                if T.road_dist(float(x), float(z)) < ROAD_WIDTH:
                    b = 0
            BLOCKED[base + x] = b

    _stamp_bridges(world)
    _stamp_building_walls(world)
    _stamp_objects(world)
    _carve_doorways(world)


def _stamp_rect(cx, cz, w, d, v):
    for z in range(math.floor(cz - d / 2), math.ceil(cz + d / 2) + 1):
        for x in range(math.floor(cx - w / 2), math.ceil(cx + w / 2) + 1):
            if x < 0 or z < 0 or x > WORLD or z > WORLD:
                continue
            BLOCKED[z * GRID + x] = v


def _stamp_circle(cx, cz, r, v):
    for z in range(math.floor(cz - r), math.ceil(cz + r) + 1):
        for x in range(math.floor(cx - r), math.ceil(cx + r) + 1):
            if x < 0 or z < 0 or x > WORLD or z > WORLD:
                continue
            if (x - cx) ** 2 + (z - cz) ** 2 <= r * r:
                BLOCKED[z * GRID + x] = v


def _stamp_bridges(world):
    for o in world.get("objects", []):
        if o.get("t") != "bridge":
            continue
        rot = float(o.get("rot", 0.0))
        sx, cz = math.sin(rot), math.cos(rot)
        ln = float(o.get("len", 16.0))
        if abs(sx) > abs(cz):
            _stamp_rect(float(o["x"]), float(o["z"]), ln + 4.0, 5.0, 0)
        else:
            _stamp_rect(float(o["x"]), float(o["z"]), 5.0, ln + 4.0, 0)


def _stamp_building_walls(world):
    for b in world.get("buildings", []):
        bx, bz = float(b["x"]), float(b["z"])
        bw, bd = float(b["w"]), float(b["d"])
        x0, x1 = math.floor(bx - bw / 2), math.ceil(bx + bw / 2)
        z0, z1 = math.floor(bz - bd / 2), math.ceil(bz + bd / 2)
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                if x < 0 or z < 0 or x > WORLD or z > WORLD:
                    continue
                if x in (x0, x1) or z in (z0, z1):
                    BLOCKED[z * GRID + x] = 1


def _stamp_objects(world):
    for o in world.get("objects", []):
        r = OBJECT_RADII.get(o.get("t"))
        if r:
            _stamp_circle(float(o["x"]), float(o["z"]), r, 1)


def door_position(b):
    door = b.get("door", [0, 0])
    side = int(door[0]) if len(door) > 0 else 0
    off = float(door[1]) if len(door) > 1 else 0.0
    bx, bz = float(b["x"]), float(b["z"])
    bw, bd = float(b["w"]), float(b["d"])
    if side == 0:
        return (bx + off, bz + bd / 2)
    if side == 1:
        return (bx + bw / 2, bz + off)
    if side == 2:
        return (bx + off, bz - bd / 2)
    return (bx - bw / 2, bz + off)


def _carve_doorways(world):
    for b in world.get("buildings", []):
        d = door_position(b)
        _stamp_circle(d[0], d[1], DOOR_CLEAR, 0)


def blocked(p):
    x, z = p
    if not (0 <= x < GRID and 0 <= z < GRID):
        return True
    return BLOCKED[z * GRID + x] == 1


class Heap:
    """Mirror of the binary min-heap in pathfinder.gd."""

    def __init__(self):
        self.pri = []
        self.val = []

    def empty(self):
        return not self.pri

    def push(self, pri, val):
        self.pri.append(pri)
        self.val.append(val)
        i = len(self.pri) - 1
        while i > 0:
            parent = (i - 1) // 2
            if self.pri[parent] <= self.pri[i]:
                break
            self._swap(parent, i)
            i = parent

    def pop(self):
        top = self.val[0]
        last = len(self.pri) - 1
        self.pri[0] = self.pri[last]
        self.val[0] = self.val[last]
        self.pri.pop()
        self.val.pop()
        n = len(self.pri)
        i = 0
        while True:
            l = i * 2 + 1
            r = l + 1
            small = i
            if l < n and self.pri[l] < self.pri[small]:
                small = l
            if r < n and self.pri[r] < self.pri[small]:
                small = r
            if small == i:
                break
            self._swap(small, i)
            i = small
        return top

    def _swap(self, a, b):
        self.pri[a], self.pri[b] = self.pri[b], self.pri[a]
        self.val[a], self.val[b] = self.val[b], self.val[a]


def _h(a, b):
    dx, dz = abs(a[0] - b[0]), abs(a[1] - b[1])
    lo, hi = min(dx, dz), max(dx, dz)
    return COST_STRAIGHT * (hi - lo) + COST_DIAG * lo


def _reached(at, goal, radius):
    if radius <= 0:
        return at == goal
    return abs(at[0] - goal[0]) <= radius and abs(at[1] - goal[1]) <= radius


def _nearest_free(centre):
    for r in range(1, 9):
        for dz in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if abs(dx) != r and abs(dz) != r:
                    continue
                p = (centre[0] + dx, centre[1] + dz)
                if 0 <= p[0] < GRID and 0 <= p[1] < GRID and not blocked(p):
                    return p
    return None


def key(p):
    return p[1] * GRID + p[0]


def unkey(k):
    return (k % GRID, k // GRID)


def find(frm, to, goal_radius=0):
    if not (0 <= frm[0] < GRID and 0 <= frm[1] < GRID):
        return []
    if not (0 <= to[0] < GRID and 0 <= to[1] < GRID):
        return []
    if _reached(frm, to, goal_radius):
        return [frm]

    target = to
    if goal_radius == 0 and blocked(to):
        alt = _nearest_free(to)
        if alt is None:
            return []
        target = alt

    g = {}
    came = {}
    closed = set()
    open_ = Heap()
    start_key = key(frm)
    g[start_key] = 0
    open_.push(_h(frm, target), start_key)

    expansions = 0
    end_key = None

    while not open_.empty():
        cur_key = open_.pop()
        if cur_key in closed:
            continue
        closed.add(cur_key)
        cur = unkey(cur_key)

        if _reached(cur, target, goal_radius):
            end_key = cur_key
            break

        expansions += 1
        if expansions > MAX_EXPANSIONS:
            break

        cur_g = g[cur_key]
        for dx, dz in NEIGHBOURS:
            nx, nz = cur[0] + dx, cur[1] + dz
            if not (0 <= nx < GRID and 0 <= nz < GRID):
                continue
            n = (nx, nz)
            n_key = key(n)
            if n_key in closed:
                continue
            is_diag = dx != 0 and dz != 0
            if blocked(n) and not (goal_radius == 0 and n == target):
                continue
            if is_diag:
                if blocked((cur[0] + dx, cur[1])) or blocked((cur[0], cur[1] + dz)):
                    continue
            step = COST_DIAG if is_diag else COST_STRAIGHT
            ng = cur_g + step
            if n_key in g and ng >= g[n_key]:
                continue
            g[n_key] = ng
            came[n_key] = cur_key
            open_.push(ng + _h(n, target), n_key)

    if end_key is None:
        return []

    out = []
    walk = end_key
    while True:
        out.append(unkey(walk))
        if walk == start_key:
            break
        if walk not in came:
            break
        walk = came[walk]
    out.reverse()
    return out
