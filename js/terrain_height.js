/* Emberfall - shared terrain definition.
   Loaded by the browser AND by tools/gen_data.js so the generated world
   always agrees with the terrain the client renders. Pure math, no deps. */
(function (g) {
  'use strict';

  var WORLD = 384;        // world is WORLD x WORLD tiles
  var WATER = 0.0;        // sea level

  function hash(x, y, s) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function vnoise(x, z, s) {
    var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    var a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function fbm(x, z, oct, freq, s) {
    var amp = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += vnoise(x * freq, z * freq, s + i * 13) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ---- named places -------------------------------------------------- */
  // Flattened build pads: settlements sit on level ground.
  var PADS = [
    { n: 'oakheart',  x: 160, z: 268, r: 36, h: 2.2 },
    { n: 'farmstead', x: 206, z: 286, r: 24, h: 2.0 },
    { n: 'aldermere', x: 250, z: 190, r: 42, h: 3.0 },
    { n: 'dunhollow', x: 200, z: 62,  r: 28, h: 15.0 },
    { n: 'saltbrook', x: 140, z: 322, r: 30, h: 1.2 },
    { n: 'mirefen',   x: 62,  z: 176, r: 24, h: 0.55 },
    { n: 'blightfort',x: 330, z: 210, r: 26, h: 4.2 },
    { n: 'minecamp',  x: 150, z: 206, r: 14, h: 4.0 },
    { n: 'shrine',    x: 96,  z: 268, r: 12, h: 3.2 },
    { n: 'isle',      x: 176, z: 356, r: 14, h: 1.4 }
  ];

  // Roads: polylines, carved flat-ish and painted as dirt.
  var ROADS = [
    [[186, 262], [206, 244], [224, 224], [240, 206], [250, 196]],          // Oakheart -> Aldermere
    [[250, 158], [244, 132], [230, 104], [212, 80], [202, 70]],            // Aldermere -> Dunhollow
    [[159, 296], [154, 308], [146, 318], [140, 322]],                      // Oakheart -> Saltbrook
    [[282, 194], [300, 198], [316, 204], [328, 208]],                      // Aldermere -> Blightlands
    [[134, 264], [112, 244], [92, 218], [74, 192], [66, 180]],             // Oakheart -> Mirefen
    [[160, 240], [157, 226], [153, 214], [150, 208]],                      // Oakheart -> mining camp
    [[184, 276], [194, 282], [202, 285]],                                  // Oakheart -> farms
    [[148, 268], [128, 270], [110, 269], [100, 268]]                       // Oakheart -> shrine
  ];

  // River: mountains -> Oakheart -> southern sea.
  var RIVER = [[152, 52], [148, 96], [156, 140], [168, 186], [174, 232], [180, 276], [186, 316], [192, 352]];

  // Standing water: swamp pools and inland ponds. Carved after the build pads
  // so a pad can never fill one in.
  var PONDS = [
    { x: 68, z: 204, r: 13, d: 2.6 },
    { x: 56, z: 196, r: 9,  d: 2.2 },
    { x: 80, z: 188, r: 8,  d: 2.0 },
    { x: 128, z: 224, r: 7, d: 1.8 },
    { x: 296, z: 232, r: 9, d: 2.2 }
  ];

  function distToPoly(x, z, poly) {
    var best = 1e9;
    for (var i = 0; i < poly.length - 1; i++) {
      var ax = poly[i][0], az = poly[i][1], bx = poly[i + 1][0], bz = poly[i + 1][1];
      var dx = bx - ax, dz = bz - az;
      var len = dx * dx + dz * dz;
      var t = len > 0 ? ((x - ax) * dx + (z - az) * dz) / len : 0;
      t = clamp(t, 0, 1);
      var px = ax + dx * t, pz = az + dz * t;
      var d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d < best) best = d;
    }
    return best;
  }

  function roadDist(x, z) {
    var best = 1e9;
    for (var i = 0; i < ROADS.length; i++) {
      var d = distToPoly(x, z, ROADS[i]);
      if (d < best) best = d;
    }
    return best;
  }

  function riverDist(x, z) { return distToPoly(x, z, RIVER); }

  /* ---- height -------------------------------------------------------- */
  function height(x, z) {
    // rolling base
    var h = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2;
    h += fbm(x, z, 2, 0.061, 211) * 1.6;

    // northern mountain wall
    var mt = clamp((118 - z) / 96, 0, 1);
    h += mt * mt * (26 + 22 * fbm(x, z, 3, 0.021, 307));

    // swamp basin (west)
    var sd = Math.sqrt((x - 66) * (x - 66) + (z - 186) * (z - 186));
    var sw = 1 - clamp((sd - 30) / 58, 0, 1);
    if (sw > 0) h = h * (1 - 0.85 * sw) + 0.45 * 0.85 * sw;

    // blighted plateau (east)
    var bd = Math.sqrt((x - 324) * (x - 324) + (z - 212) * (z - 212));
    var bl = 1 - clamp((bd - 26) / 62, 0, 1);
    if (bl > 0) h = h * (1 - 0.7 * bl) + 5.2 * 0.7 * bl + 2.5 * bl * fbm(x, z, 2, 0.05, 409);

    // sea on south / east / west margins
    var edge = Math.min(x - 8, WORLD - 8 - x, WORLD - 26 - z);
    if (edge < 26) {
      var t = clamp(1 - edge / 26, 0, 1);
      h -= t * t * 34;
    }

    // southern islands
    var isles = [[176, 356, 15], [118, 350, 11], [214, 344, 10]];
    for (var i = 0; i < isles.length; i++) {
      var dd = Math.sqrt((x - isles[i][0]) * (x - isles[i][0]) + (z - isles[i][1]) * (z - isles[i][1]));
      var f = 1 - clamp(dd / isles[i][2], 0, 1);
      h += smooth(f) * 9.5;
    }

    // settlement pads first - then water is carved through them, so the river
    // still splits Oakheart instead of being paved over by the village pad.
    for (var p = 0; p < PADS.length; p++) {
      var pd = Math.sqrt((x - PADS[p].x) * (x - PADS[p].x) + (z - PADS[p].z) * (z - PADS[p].z));
      var pf = 1 - clamp((pd - PADS[p].r * 0.62) / (PADS[p].r * 0.62), 0, 1);
      if (pf > 0) { pf = smooth(pf); h = h * (1 - pf) + PADS[p].h * pf; }
    }

    // ponds
    for (var q = 0; q < PONDS.length; q++) {
      var qd = Math.sqrt((x - PONDS[q].x) * (x - PONDS[q].x) + (z - PONDS[q].z) * (z - PONDS[q].z));
      var qf = 1 - clamp(qd / PONDS[q].r, 0, 1);
      if (qf > 0) { qf = smooth(qf); h = h * (1 - qf) + (-PONDS[q].d) * qf; }
    }

    // river carve
    var rd = riverDist(x, z);
    if (rd < 14) {
      var rt = 1 - clamp((rd - 3.2) / 10.8, 0, 1);
      var bed = -1.6 + Math.max(0, rd - 3.2) * 0.24;
      h = h * (1 - rt * 0.94) + bed * rt * 0.94;
    }

    // roads smooth the ground they cross
    var road = roadDist(x, z);
    if (road < 7) {
      var rf = smooth(1 - clamp(road / 7, 0, 1)) * 0.55;
      var avg = (height0(x - 4, z) + height0(x + 4, z) + height0(x, z - 4) + height0(x, z + 4)) * 0.25;
      h = h * (1 - rf) + avg * rf;
    }
    return h;
  }

  // cheap version without the road smoothing pass (avoids recursion)
  function height0(x, z) {
    var h = fbm(x, z, 4, 0.017, 101) * 9.0 - 2.2;
    var mt = clamp((118 - z) / 96, 0, 1);
    h += mt * mt * (26 + 22 * fbm(x, z, 3, 0.021, 307));
    var edge = Math.min(x - 8, WORLD - 8 - x, WORLD - 26 - z);
    if (edge < 26) { var t = clamp(1 - edge / 26, 0, 1); h -= t * t * 34; }
    for (var p = 0; p < PADS.length; p++) {
      var pd = Math.sqrt((x - PADS[p].x) * (x - PADS[p].x) + (z - PADS[p].z) * (z - PADS[p].z));
      var pf = 1 - clamp((pd - PADS[p].r * 0.62) / (PADS[p].r * 0.62), 0, 1);
      if (pf > 0) { pf = smooth(pf); h = h * (1 - pf) + PADS[p].h * pf; }
    }
    return h;
  }

  /* ---- biome / ground colour ----------------------------------------- */
  // returns one of: water, sand, grass, path, dirt, rock, snow, muck, blight
  function ground(x, z, h) {
    if (h === undefined) h = height(x, z);
    if (h < WATER) return 'water';
    if (h < 0.55) {
      var sd2 = Math.sqrt((x - 66) * (x - 66) + (z - 186) * (z - 186));
      if (sd2 < 74) return 'muck';
      return 'sand';
    }
    if (roadDist(x, z) < 2.6) return 'path';
    if (h > 30) return 'snow';
    if (h > 19) return 'rock';
    var sd = Math.sqrt((x - 66) * (x - 66) + (z - 186) * (z - 186));
    if (sd < 70) return 'muck';
    var bd = Math.sqrt((x - 324) * (x - 324) + (z - 212) * (z - 212));
    if (bd < 58) return 'blight';
    if (riverDist(x, z) < 5.5 && h < 1.6) return 'sand';
    return 'grass';
  }

  function region(x, z) {
    if (z < 118) return 'Kragmar Peaks';
    if (z > 300) return 'Saltbrook Coast';
    if (x < 112) return 'Mirefen';
    if (x > 296) return 'The Blightlands';
    if (x > 210 && z < 240) return 'Aldermere';
    return 'Oakheart Vale';
  }

  var API = {
    PONDS: PONDS,
    WORLD: WORLD, WATER: WATER,
    hash: hash, vnoise: vnoise, fbm: fbm,
    height: height, ground: ground, region: region,
    roadDist: roadDist, riverDist: riverDist,
    PADS: PADS, ROADS: ROADS, RIVER: RIVER
  };

  g.RFTerrain = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
