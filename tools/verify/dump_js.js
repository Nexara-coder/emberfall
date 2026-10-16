/* Dump reference terrain values from the ORIGINAL js/terrain_height.js so the
   GDScript port can be checked against them bit for bit.

   Floats are printed with Number.prototype.toString(), which emits the
   shortest decimal that round-trips to the same double, so Python's repr()
   of the same double produces an identical string. Any difference in the
   printed value is therefore a real difference in the double. */
'use strict';
const path = require('path');
const T = require(path.resolve(process.argv[2]
  || path.join(__dirname, '..', '..', 'js', 'terrain_height.js')));

const out = [];

// 1. hash3 over a spread of integer coords including negatives and the
//    extremes where the 32-bit wrap matters.
const hs = [];
for (let i = 0; i < 4000; i++) {
  const x = ((i * 7919) % 100000) - 50000;
  const y = ((i * 104729) % 100000) - 50000;
  const s = 101 + (i % 7) * 13;
  hs.push(T.hash(x, y, s));
}
// plus explicit edge cases
[[0,0,0],[-1,-1,-1],[2147483647,2147483647,2147483647],
 [-2147483648,-2147483648,-2147483648],[1,0,0],[0,1,0],[0,0,1],
 [65535,65536,1442695041],[374761393,668265263,1274126177]].forEach(function (c) {
  hs.push(T.hash(c[0], c[1], c[2]));
});
out.push({ k: 'hash', v: hs });

// 2. height / height0 / ground / region / roadDist / riverDist over a grid
//    that covers every branch: mountains, swamp, blight, sea margin, islands,
//    pads, ponds, river, roads.
const pts = [];
for (let z = 0; z < 384; z += 7) {
  for (let x = 0; x < 384; x += 7) pts.push([x + 0.5, z + 0.5]);
}
// and fractional samples on the interesting features
const feats = [
  [160, 268], [157.25, 268.75], [206, 286], [250, 190], [200, 62], [140, 322],
  [62, 176], [330, 210], [150, 206], [96, 268], [176, 356], [68, 204], [56, 196],
  [80, 188], [128, 224], [296, 232], [152, 52], [192, 352], [186, 262], [250, 196],
  [8, 8], [376, 376], [0, 0], [383, 383], [118, 350], [214, 344], [324, 212],
  [66, 186], [112, 118], [296, 300], [210, 240]
];
for (const f of feats) {
  for (const dx of [0, 0.37, -0.63, 1.5]) {
    for (const dz of [0, 0.37, -0.63, 1.5]) pts.push([f[0] + dx, f[1] + dz]);
  }
}
const rows = pts.map(function (p) {
  const h = T.height(p[0], p[1]);
  return [p[0], p[1], h, T.height(p[0], p[1]), T.ground(p[0], p[1], h),
          T.region(p[0], p[1]), T.roadDist(p[0], p[1]), T.riverDist(p[0], p[1])];
});
out.push({ k: 'pts', v: rows });

// 3. fbm and vnoise directly, including negative inputs
const fb = [];
for (let i = 0; i < 1500; i++) {
  const x = ((i * 13.7) % 500) - 60;
  const z = ((i * 29.3) % 500) - 60;
  fb.push([T.vnoise(x, z, 101), T.fbm(x, z, 4, 0.017, 101),
           T.fbm(x, z, 3, 0.021, 307), T.fbm(x, z, 2, 0.061, 211),
           T.fbm(x, z, 2, 0.05, 409)]);
}
out.push({ k: 'fbm', v: fb });

process.stdout.write(JSON.stringify(out));
