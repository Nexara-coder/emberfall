/* Emberfall - tile pathfinding.
   A* over the terrain collision grid. Diagonals are allowed but never cut a
   corner between two blocked tiles, so characters don't clip through the
   join of two walls. If the goal is unreachable we still walk to the closest
   reachable tile, which is what a click on the far side of a river should do. */
(function (g) {
  'use strict';

  function Heap() { this.a = []; }
  Heap.prototype.push = function (node) {
    var a = this.a; a.push(node);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < n && a[l].f < a[s].f) s = l;
        if (r < n && a[r].f < a[s].f) s = r;
        if (s === i) break;
        var t = a[s]; a[s] = a[i]; a[i] = t; i = s;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  var DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]
  ];

  /* blocked(x,z) -> truthy if the tile cannot be entered.
     opts.maxNodes caps the search so a hopeless click can't stall a frame. */
  function find(sx, sz, gx, gz, blocked, opts) {
    opts = opts || {};
    var MAXN = opts.maxNodes || 9000;
    var N = opts.size || 384;
    sx = Math.floor(sx); sz = Math.floor(sz);
    gx = Math.floor(gx); gz = Math.floor(gz);
    if (sx === gx && sz === gz) return [];
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return null;

    var open = new Heap();
    var gScore = new Map(), came = new Map(), closed = new Set();
    function key(x, z) { return z * N + x; }
    function hEst(x, z) {
      var dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      // octile distance
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    }
    var startK = key(sx, sz);
    gScore.set(startK, 0);
    open.push({ x: sx, z: sz, f: hEst(sx, sz), k: startK });

    var best = { k: startK, h: hEst(sx, sz), x: sx, z: sz };
    var expanded = 0;

    while (open.size()) {
      var cur = open.pop();
      if (closed.has(cur.k)) continue;
      closed.add(cur.k);
      expanded++;
      if (cur.x === gx && cur.z === gz) return rebuild(came, cur.k, N);
      if (expanded > MAXN) break;

      var ch = hEst(cur.x, cur.z);
      if (ch < best.h) best = { k: cur.k, h: ch, x: cur.x, z: cur.z };

      var cg = gScore.get(cur.k);
      for (var i = 0; i < 8; i++) {
        var d = DIRS[i];
        var nx = cur.x + d[0], nz = cur.z + d[1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (blocked(nx, nz)) continue;
        if (d[0] && d[1]) {
          // no squeezing between two diagonal blockers
          if (blocked(cur.x + d[0], cur.z) || blocked(cur.x, cur.z + d[1])) continue;
        }
        var nk = key(nx, nz);
        if (closed.has(nk)) continue;
        var ng = cg + d[2];
        var old = gScore.get(nk);
        if (old === undefined || ng < old) {
          gScore.set(nk, ng);
          came.set(nk, cur.k);
          open.push({ x: nx, z: nz, f: ng + hEst(nx, nz) * 1.001, k: nk });
        }
      }
    }
    // unreachable: walk as close as we got
    if (best.k !== startK) return rebuild(came, best.k, N);
    return null;
  }

  function rebuild(came, endK, N) {
    var out = [], k = endK, guard = 0;
    while (k !== undefined && guard++ < 20000) {
      out.push({ x: (k % N), z: Math.floor(k / N) });
      k = came.get(k);
    }
    out.reverse();
    out.shift();               // drop the tile we're already standing on
    return out;
  }

  /* Trim a tile path into a shorter list of waypoints by dropping any node
     that can be skipped with a clear straight line. Makes movement read as
     smooth walking rather than a staircase. */
  function smooth(path, blocked) {
    if (!path || path.length < 3) return path;
    var out = [path[0]];
    var anchor = 0;
    for (var i = 2; i < path.length; i++) {
      if (!clear(path[anchor].x, path[anchor].z, path[i].x, path[i].z, blocked)) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  function clear(x0, z0, x1, z1, blocked) {
    var dx = x1 - x0, dz = z1 - z0;
    var steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2);
    if (steps === 0) return true;
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var x = Math.floor(x0 + dx * t + 0.5), z = Math.floor(z0 + dz * t + 0.5);
      if (blocked(x, z)) return false;
      // also refuse if either orthogonal neighbour pair is blocked (tight gap)
      if (blocked(Math.floor(x0 + dx * t), z) && blocked(x, Math.floor(z0 + dz * t))) return false;
    }
    return true;
  }

  /* Find the nearest walkable tile to (x,z) - used when a click lands on a
     tree or inside a wall: we walk up to it rather than refusing to move. */
  function nearestOpen(x, z, blocked, maxR) {
    x = Math.floor(x); z = Math.floor(z);
    if (!blocked(x, z)) return { x: x, z: z };
    maxR = maxR || 8;
    for (var r = 1; r <= maxR; r++) {
      for (var dz = -r; dz <= r; dz++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!blocked(x + dx, z + dz)) return { x: x + dx, z: z + dz };
        }
      }
    }
    return null;
  }

  g.RFPath = { find: find, smooth: smooth, clear: clear, nearestOpen: nearestOpen };
})(typeof window !== 'undefined' ? window : globalThis);
