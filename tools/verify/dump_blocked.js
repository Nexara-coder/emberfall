/* Dump the validator's collision grid so the GDScript port can be diffed
   against it cell by cell. This re-runs the exact stamping code from
   tools/validate_world.js by requiring the project's own modules. */
'use strict';
const fs = require('fs'), path = require('path');
/* default to the project root, two levels up from this file */
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
global.globalThis = global;
require(path.join(ROOT, 'js/terrain_height.js'));
const T = globalThis.RFTerrain;
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));

const SIZE = W.size || 384;
const blocked = new Uint8Array((SIZE + 1) * (SIZE + 1));
const idx = (x, z) => z * (SIZE + 1) + x;

function stampRect(cx, cz, w, d, v) {
  for (let z = Math.floor(cz - d / 2); z <= Math.ceil(cz + d / 2); z++)
    for (let x = Math.floor(cx - w / 2); x <= Math.ceil(cx + w / 2); x++) {
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      blocked[idx(x, z)] = v;
    }
}
function stampCircle(cx, cz, r, v) {
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) blocked[idx(x, z)] = v;
    }
}
for (let z = 0; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) {
  const h = T.height(x, z);
  let b = 0;
  if (h < 0.08) b = 1;
  else {
    const mx = Math.max(Math.abs(T.height(x - 1, z) - h), Math.abs(T.height(x + 1, z) - h),
      Math.abs(T.height(x, z - 1) - h), Math.abs(T.height(x, z + 1) - h));
    if (mx > 1.55) b = 1;
  }
  if (b && T.roadDist(x, z) < 2.4 && h >= 0.08) b = 0;
  blocked[idx(x, z)] = b;
}
W.objects.filter(o => o.t === 'bridge').forEach(b => {
  const rot = b.rot || 0, sx = Math.sin(rot), cz = Math.cos(rot);
  const len = b.len || 16;
  if (Math.abs(sx) > Math.abs(cz)) stampRect(b.x, b.z, len + 4, 5.0, 0);
  else stampRect(b.x, b.z, 5.0, len + 4, 0);
});
function stampWalls(b) {
  const x0 = Math.floor(b.x - b.w / 2), x1 = Math.ceil(b.x + b.w / 2);
  const z0 = Math.floor(b.z - b.d / 2), z1 = Math.ceil(b.z + b.d / 2);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
    if (x === x0 || x === x1 || z === z0 || z === z1) blocked[idx(x, z)] = 1;
  }
}
W.buildings.forEach(stampWalls);
const RADII = { tree: 0.8, rock: 1.1, sign: 0.4, well: 1.3, furnace: 1.6, anvil: 1.1,
  range: 1.2, altar: 1.4, altar_rc: 1.6, bank_booth: 1.2, statue: 1.0, fountain: 1.6 };
W.objects.forEach(o => { const r = RADII[o.t]; if (r) stampCircle(o.x, o.z, r, 1); });
function doorWorld(b) {
  const side = (b.door && b.door[0]) || 0;
  const off = (b.door && b.door[1]) || 0;
  if (side === 0) return { x: b.x + off, z: b.z + b.d / 2 };
  if (side === 1) return { x: b.x + b.w / 2, z: b.z + off };
  if (side === 2) return { x: b.x + off, z: b.z - b.d / 2 };
  return { x: b.x - b.w / 2, z: b.z + off };
}
W.buildings.forEach(b => { const d = doorWorld(b); stampCircle(d.x, d.z, 1.8, 0); });

let walk = 0, total = 0;
for (let z = 2; z < SIZE; z += 2) for (let x = 2; x < SIZE; x += 2) { total++; if (!blocked[idx(x, z)]) walk++; }
process.stderr.write('validator subsample: ' + Math.round(walk / total * 100) + '% walkable\n');
process.stdout.write(Buffer.from(blocked));
