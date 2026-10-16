"""Exercise the ported pathfinder and collision grid on the real world."""

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import astar_mirror as A  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WORLD_JSON = os.path.join(ROOT, "data", "world.json")

world = json.load(open(WORLD_JSON))
print("building the collision grid from the real world data...")
A.build_grid(world)
free = sum(1 for b in A.BLOCKED if b == 0)
total = len(A.BLOCKED)
print("  %d/%d tiles walkable (%.0f%%)" % (free, total, 100.0 * free / total))

fails = 0


def fail(msg):
    global fails
    fails += 1
    if fails <= 15:
        print("  FAIL " + msg)


# --- 1. invariants on every path ------------------------------------------
print("\n1. random routes")
random.seed(20261013)
tried = 0
found = 0
for _ in range(1200):
    a = (random.randrange(A.GRID), random.randrange(A.GRID))
    if A.blocked(a):
        continue
    # keep the goals near enough that a route plausibly exists
    b = (
        max(0, min(A.GRID - 1, a[0] + random.randint(-40, 40))),
        max(0, min(A.GRID - 1, a[1] + random.randint(-40, 40))),
    )
    tried += 1
    p = A.find(a, b)
    if not p:
        continue
    found += 1
    if p[0] != a:
        fail("path does not start at the origin: %s -> %s, got %s" % (a, b, p[0]))
    for i in range(len(p) - 1):
        dx = abs(p[i + 1][0] - p[i][0])
        dz = abs(p[i + 1][1] - p[i][1])
        if dx > 1 or dz > 1 or (dx == 0 and dz == 0):
            fail("non-adjacent step %s -> %s" % (p[i], p[i + 1]))
        if dx == 1 and dz == 1:
            if A.blocked((p[i][0] + (p[i + 1][0] - p[i][0]), p[i][1])) or A.blocked(
                (p[i][0], p[i][1] + (p[i + 1][1] - p[i][1]))
            ):
                fail("diagonal cut a blocked corner at %s" % (p[i],))
    for t in p[:-1]:
        if A.blocked(t):
            fail("path crosses a blocked tile %s" % (t,))
print("   %d routes attempted, %d found" % (tried, found))

# --- 2. optimality against a reference Dijkstra ---------------------------
print("\n2. costs match a plain Dijkstra on the same grid")
import heapq  # noqa: E402


def dijkstra_cost(a, b):
    dist = {a: 0}
    q = [(0, a)]
    while q:
        d, cur = heapq.heappop(q)
        if cur == b:
            return d
        if d > dist.get(cur, 1 << 60):
            continue
        for dx, dz in A.NEIGHBOURS:
            n = (cur[0] + dx, cur[1] + dz)
            if not (0 <= n[0] < A.GRID and 0 <= n[1] < A.GRID):
                continue
            if A.blocked(n) and n != b:
                continue
            if dx != 0 and dz != 0:
                if A.blocked((cur[0] + dx, cur[1])) or A.blocked((cur[0], cur[1] + dz)):
                    continue
            nd = d + (A.COST_DIAG if (dx != 0 and dz != 0) else A.COST_STRAIGHT)
            if nd < dist.get(n, 1 << 60):
                dist[n] = nd
                heapq.heappush(q, (nd, n))
    return None


def path_cost(p):
    c = 0
    for i in range(len(p) - 1):
        dx = abs(p[i + 1][0] - p[i][0])
        dz = abs(p[i + 1][1] - p[i][1])
        c += A.COST_DIAG if (dx == 1 and dz == 1) else A.COST_STRAIGHT
    return c


random.seed(7)
checked = 0
for _ in range(400):
    a = (random.randrange(A.GRID), random.randrange(A.GRID))
    if A.blocked(a):
        continue
    b = (
        max(0, min(A.GRID - 1, a[0] + random.randint(-18, 18))),
        max(0, min(A.GRID - 1, a[1] + random.randint(-18, 18))),
    )
    p = A.find(a, b)
    if not p or p[-1] != b:
        continue
    want = dijkstra_cost(a, b)
    got = path_cost(p)
    checked += 1
    if want is None or got != want:
        fail("cost %s -> %s: A* %s, Dijkstra %s" % (a, b, got, want))
print("   %d routes compared" % checked)

# --- 3. the gameplay cases --------------------------------------------------
print("\n3. the cases the game actually needs")

spawn = world["spawnPoint"]
start = (int(spawn["x"]), int(spawn["z"]))
if A.blocked(start):
    fail("the spawn point itself is blocked at %s" % (start,))

# Can a new player reach a tree to chop, a rock to mine, and the bank?
def nearest(kind, origin, limit=60):
    best, best_d = None, 1 << 60
    for o in world["objects"]:
        if o.get("t") != kind:
            continue
        d = abs(int(o["x"]) - origin[0]) + abs(int(o["z"]) - origin[1])
        if d < best_d:
            best, best_d = o, d
    return best if best_d <= limit else None


for kind in ["tree", "rock", "herb", "fish"]:
    o = nearest(kind, start)
    if o is None:
        print("   (no %s within 60 tiles of spawn)" % kind)
        continue
    goal = (int(o["x"]), int(o["z"]))
    p = A.find(start, goal, 1)
    if not p:
        fail("cannot walk from spawn to the nearest %s at %s" % (kind, goal))
    else:
        print("   spawn -> nearest %-5s at %-10s %d tiles" % (kind, goal, len(p)))

# Every settlement centre must be reachable from spawn on foot.
for area in world.get("authoredAreas", []):
    goal = (int(area["x"]), int(area["z"]))
    p = A.find(start, goal, 3)
    if not p:
        fail("%s is unreachable on foot from the spawn" % area["name"])
    else:
        print("   spawn -> %-12s %4d tiles" % (area["name"], len(p)))

# Every building's door tile must be walkable, or the building cannot be entered.
sealed = []
for b in world["buildings"]:
    dt = A.door_position(b)
    if A.blocked((round(dt[0]), round(dt[1]))):
        sealed.append((b["name"], dt))
print("   %d/%d building doorways walkable" % (len(world["buildings"]) - len(sealed), len(world["buildings"])))
for name, dt in sealed[:8]:
    print("     sealed: %s at %s" % (name, dt))

# A blocked goal must still produce a route to beside it.
tree = nearest("tree", start)
if tree is not None:
    goal = (int(tree["x"]), int(tree["z"]))
    p = A.find(start, goal, 0)
    if not p:
        fail("clicking a blocked tree tile produced no route at all")
    elif p[-1] == goal and A.blocked(goal):
        print("   clicking a tree walks onto its tile (exact-goal mode)")
    else:
        print("   clicking a tree walks to %s, beside the trunk at %s" % (p[-1], goal))

print()
print("failures: %d" % fails)
sys.exit(1 if fails else 0)
