"""Python mirror of the deterministic JSON writer in
addons/emberfall_map/authored_io.gd.

The point: when the Godot map editor saves and nothing has been moved, the
file it writes must be byte-identical to what tools/extract_authored.js wrote
with JSON.stringify(doc, null, 2) + '\\n'. Otherwise every save produces a
whole-file diff and real moves become invisible.
"""

import json
import math
import sys

ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def esc(s):
    out = ['"']
    for ch in s:
        if ch in ESCAPES:
            out.append(ESCAPES[ch])
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def num(v):
    """Integral values print without a decimal point, as JSON.stringify does.
    Everything else prints with up to 6 decimals, trailing zeros trimmed."""
    if isinstance(v, bool):
        return "true" if v else "false"
    f = float(v)
    if not math.isfinite(f):
        return "null"
    if f == math.floor(f) and abs(f) < 1e15:
        return str(int(f))
    # Shortest decimal that reads back as the identical double - the same rule
    # JSON.stringify follows. Walk the significant-digit count upward and stop
    # at the first representation that round-trips.
    # GDScript's % operator has no %g, so this walks DECIMAL PLACES with %f
    # instead of significant digits, and stops at the first representation
    # that reads back as the identical double. Trailing zeros are stripped
    # afterwards, which cannot change the value.
    for p in range(1, 21):
        s = ("%." + str(p) + "f") % f
        if float(s) == f:
            return _trim(s)
    return _trim("%.20f" % f)


def _trim(s):
    if "." not in s:
        return s
    s = s.rstrip("0")
    if s.endswith("."):
        s = s[:-1]
    return s


def ser(v, depth=0):
    pad = "  " * depth
    inner = "  " * (depth + 1)
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return num(v)
    if isinstance(v, str):
        return esc(v)
    if isinstance(v, list):
        if not v:
            return "[]"
        parts = [inner + ser(x, depth + 1) for x in v]
        return "[\n" + ",\n".join(parts) + "\n" + pad + "]"
    if isinstance(v, dict):
        if not v:
            return "{}"
        parts = [inner + esc(str(k)) + ": " + ser(x, depth + 1) for k, x in v.items()]
        return "{\n" + ",\n".join(parts) + "\n" + pad + "}"
    raise TypeError(type(v))


if __name__ == "__main__":
    path = sys.argv[1]
    original = open(path, "rb").read()
    doc = json.load(open(path))
    mine = (ser(doc) + "\n").encode()
    if mine == original:
        print("byte-identical: %d bytes" % len(mine))
        sys.exit(0)
    print("DIFFERS: original %d bytes, mine %d bytes" % (len(original), len(mine)))
    ol = original.decode().splitlines()
    ml = mine.decode().splitlines()
    shown = 0
    for i in range(max(len(ol), len(ml))):
        a = ol[i] if i < len(ol) else "<eof>"
        b = ml[i] if i < len(ml) else "<eof>"
        if a != b:
            print("  line %d\n    js: %r\n    gd: %r" % (i + 1, a, b))
            shown += 1
            if shown >= 10:
                break
    sys.exit(1)
