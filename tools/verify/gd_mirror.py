"""Python mirror of godot/scripts/terrain_def.gd.

Hand-transcribed FROM THE GDSCRIPT, not from the JavaScript, so that a
transcription error in the GDScript shows up as a mismatch against Node
running the original js/terrain_height.js.

Python ints are arbitrary precision and Python floats are IEEE754 doubles,
exactly like GDScript's int (64-bit two's complement) and float (double), for
every operation used here: &, ^, >> on non-negative values, * within 2^62, and
all float arithmetic. The masking in _imul is what makes the int width
irrelevant.
"""

import math

WORLD = 384
WATER = 0.0
U32 = 0xFFFFFFFF
SIGN_BIT = 0x80000000
TWO_32 = 0x100000000

PADS = [
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

ROADS = [
    [[186.0, 262.0], [206.0, 244.0], [224.0, 224.0], [240.0, 206.0], [250.0, 196.0]],
    [[250.0, 158.0], [244.0, 132.0], [230.0, 104.0], [212.0, 80.0], [202.0, 70.0]],
    [[159.0, 296.0], [154.0, 308.0], [146.0, 318.0], [140.0, 322.0]],
    [[282.0, 194.0], [300.0, 198.0], [316.0, 204.0], [328.0, 208.0]],
    [[134.0, 264.0], [112.0, 244.0], [92.0, 218.0], [74.0, 192.0], [66.0, 180.0]],
    [[160.0, 240.0], [157.0, 226.0], [153.0, 214.0], [150.0, 208.0]],
    [[184.0, 276.0], [194.0, 282.0], [202.0, 285.0]],
    [[148.0, 268.0], [128.0, 270.0], [110.0, 269.0], [100.0, 268.0]],
]

RIVER = [
    [152.0, 52.0], [148.0, 96.0], [156.0, 140.0], [168.0, 186.0],
    [174.0, 232.0], [180.0, 276.0], [186.0, 316.0], [192.0, 352.0],
]

PONDS = [
    {"x": 68.0, "z": 204.0, "r": 13.0, "d": 2.6},
    {"x": 56.0, "z": 196.0, "r": 9.0, "d": 2.2},
    {"x": 80.0, "z": 188.0, "r": 8.0, "d": 2.0},
    {"x": 128.0, "z": 224.0, "r": 7.0, "d": 1.8},
    {"x": 296.0, "z": 232.0, "r": 9.0, "d": 2.2},
]

ISLES = [[176.0, 356.0, 15.0], [118.0, 350.0, 11.0], [214.0, 344.0, 10.0]]


def _imul(a, b):
    sa = a & U32
    sb = b & U32
    if sa >= SIGN_BIT:
        sa -= TWO_32
    if sb >= SIGN_BIT:
        sb -= TWO_32
    return (sa * sb) & U32


def hash3(x, y, s):
    h = _imul(x, 374761393) ^ _imul(y, 668265263) ^ _imul(s, 1442695041)
    h = _imul(h ^ (h >> 13), 1274126177)
    return float((h ^ (h >> 16)) & U32) / 4294967296.0


def vnoise(x, z, s):
    xi = int(math.floor(x))
    zi = int(math.floor(z))
    xf = x - float(xi)
    zf = z - float(zi)
    u = xf * xf * (3.0 - 2.0 * xf)
    v = zf * zf * (3.0 - 2.0 * zf)
    a = hash3(xi, zi, s)
    b = hash3(xi + 1, zi, s)
    c = hash3(xi, zi + 1, s)
    d = hash3(xi + 1, zi + 1, s)
    return (a * (1.0 - u) + b * u) * (1.0 - v) + (c * (1.0 - u) + d * u) * v


def fbm(x, z, oct_, freq, s):
    amp = 1.0
    total = 0.0
    norm = 0.0
    f = freq
    for i in range(oct_):
        total += vnoise(x * f, z * f, s + i * 13) * amp
        norm += amp
        amp *= 0.5
        f *= 2.0
    return total / norm


def _clampf(v, a, b):
    if v < a:
        return a
    if v > b:
        return b
    return v


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def _dist_to_poly(x, z, poly):
    best = 1e9
    for i in range(len(poly) - 1):
        ax, az = poly[i][0], poly[i][1]
        bx, bz = poly[i + 1][0], poly[i + 1][1]
        dx = bx - ax
        dz = bz - az
        ln = dx * dx + dz * dz
        t = 0.0
        if ln > 0.0:
            t = ((x - ax) * dx + (z - az) * dz) / ln
        t = _clampf(t, 0.0, 1.0)
        px = ax + dx * t
        pz = az + dz * t
        d = math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz))
        if d < best:
            best = d
    return best


def road_dist(x, z):
    best = 1e9
    for i in range(len(ROADS)):
        d = _dist_to_poly(x, z, ROADS[i])
        if d < best:
            best = d
    return best


def river_dist(x, z):
    return _dist_to_poly(x, z, RIVER)


def height0(x, z):
    h = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2
    mt = _clampf((118.0 - z) / 96.0, 0.0, 1.0)
    h += mt * mt * (26.0 + 22.0 * fbm(x, z, 3, 0.021, 307))
    edge = min(min(x - 8.0, float(WORLD) - 8.0 - x), float(WORLD) - 26.0 - z)
    if edge < 26.0:
        t = _clampf(1.0 - edge / 26.0, 0.0, 1.0)
        h -= t * t * 34.0
    for pad in PADS:
        pd = math.sqrt((x - pad["x"]) * (x - pad["x"]) + (z - pad["z"]) * (z - pad["z"]))
        pf = 1.0 - _clampf((pd - pad["r"] * 0.62) / (pad["r"] * 0.62), 0.0, 1.0)
        if pf > 0.0:
            pf = _smooth(pf)
            h = h * (1.0 - pf) + pad["h"] * pf
    return h


def height(x, z):
    h = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2
    h += fbm(x, z, 2, 0.061, 211) * 1.6

    mt = _clampf((118.0 - z) / 96.0, 0.0, 1.0)
    h += mt * mt * (26.0 + 22.0 * fbm(x, z, 3, 0.021, 307))

    sd = math.sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
    sw = 1.0 - _clampf((sd - 30.0) / 58.0, 0.0, 1.0)
    if sw > 0.0:
        h = h * (1.0 - 0.85 * sw) + 0.45 * 0.85 * sw

    bd = math.sqrt((x - 324.0) * (x - 324.0) + (z - 212.0) * (z - 212.0))
    bl = 1.0 - _clampf((bd - 26.0) / 62.0, 0.0, 1.0)
    if bl > 0.0:
        h = h * (1.0 - 0.7 * bl) + 5.2 * 0.7 * bl + 2.5 * bl * fbm(x, z, 2, 0.05, 409)

    edge = min(min(x - 8.0, float(WORLD) - 8.0 - x), float(WORLD) - 26.0 - z)
    if edge < 26.0:
        te = _clampf(1.0 - edge / 26.0, 0.0, 1.0)
        h -= te * te * 34.0

    for isle in ISLES:
        dd = math.sqrt((x - isle[0]) * (x - isle[0]) + (z - isle[1]) * (z - isle[1]))
        f = 1.0 - _clampf(dd / isle[2], 0.0, 1.0)
        h += _smooth(f) * 9.5

    for pad in PADS:
        pd = math.sqrt((x - pad["x"]) * (x - pad["x"]) + (z - pad["z"]) * (z - pad["z"]))
        pf = 1.0 - _clampf((pd - pad["r"] * 0.62) / (pad["r"] * 0.62), 0.0, 1.0)
        if pf > 0.0:
            pf = _smooth(pf)
            h = h * (1.0 - pf) + pad["h"] * pf

    for pond in PONDS:
        qd = math.sqrt((x - pond["x"]) * (x - pond["x"]) + (z - pond["z"]) * (z - pond["z"]))
        qf = 1.0 - _clampf(qd / pond["r"], 0.0, 1.0)
        if qf > 0.0:
            qf = _smooth(qf)
            h = h * (1.0 - qf) + (-pond["d"]) * qf

    rd = river_dist(x, z)
    if rd < 14.0:
        rt = 1.0 - _clampf((rd - 3.2) / 10.8, 0.0, 1.0)
        bed = -1.6 + max(0.0, rd - 3.2) * 0.24
        h = h * (1.0 - rt * 0.94) + bed * rt * 0.94

    road = road_dist(x, z)
    if road < 7.0:
        rf = _smooth(1.0 - _clampf(road / 7.0, 0.0, 1.0)) * 0.55
        avg = (
            height0(x - 4.0, z) + height0(x + 4.0, z)
            + height0(x, z - 4.0) + height0(x, z + 4.0)
        ) * 0.25
        h = h * (1.0 - rf) + avg * rf
    return h


def ground(x, z, h=None):
    hh = height(x, z) if h is None else h
    if hh < WATER:
        return "water"
    if hh < 0.55:
        sd2 = math.sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
        if sd2 < 74.0:
            return "muck"
        return "sand"
    if road_dist(x, z) < 2.6:
        return "path"
    if hh > 30.0:
        return "snow"
    if hh > 19.0:
        return "rock"
    sd = math.sqrt((x - 66.0) * (x - 66.0) + (z - 186.0) * (z - 186.0))
    if sd < 70.0:
        return "muck"
    bd = math.sqrt((x - 324.0) * (x - 324.0) + (z - 212.0) * (z - 212.0))
    if bd < 58.0:
        return "blight"
    if river_dist(x, z) < 5.5 and hh < 1.6:
        return "sand"
    return "grass"


def region(x, z):
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
