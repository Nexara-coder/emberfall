/* Replaces every scattered natural resource with the authored zones.
   Deterministic: no Math.random anywhere, so the same data always yields the
   same world. Run: node tools/apply_resources.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
global.globalThis = global;
require(path.join(ROOT, 'js/terrain_height.js'));
const T = globalThis.RFTerrain;
const { ZONES, LANDMARKS } = require('./authored_resources.js');

const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));

/* stable hash of a tile, used for jitter and thinning - never a RNG */
function h2(x, z, salt) {
  let n = (Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const NATURAL = ['tree', 'rock', 'herb', 'flax', 'hunt', 'fish'];
/* fixtures placed one by one, rather than by zone */
const FIXTURES = ['agility', 'altar', 'altar_rc', 'bridge', 'dungeon', 'loom',
                  'patch', 'sign', 'standing_stone'];
const before = {};
W.objects.forEach(o => { if (NATURAL.includes(o.t)) before[o.t] = (before[o.t] || 0) + 1; });

/* keep everything authored by the town pass, drop all scattered nature */
W.objects = W.objects.filter(o =>
  (!NATURAL.includes(o.t) || o.authored) &&
  (!FIXTURES.includes(o.t) || o.authored));

let maxId = 0;
W.objects.forEach(o => maxId = Math.max(maxId, o.i));

const towns = W.authoredAreas || [];
function inTown(x, z) {
  /* Only the town proper is off limits. Woodland is supposed to come right up
     to the edge of a settlement; excluding a wide ring left the map bald. */
  return towns.some(t => Math.hypot(x - t.x, z - t.z) < t.r * 0.70);
}
function occupied(x, z, gap) {
  if (W.buildings.some(b => Math.abs(b.x - x) < b.w / 2 + 2.5 && Math.abs(b.z - z) < b.d / 2 + 2.5)) return true;
  return W.objects.some(o => Math.hypot(o.x - x, o.z - z) < gap);
}
/* Marsh zones pass a lower threshold: the swamp floor sits between 0.35 and
   0.7, which is walkable but was being rejected as if it were open water. */
function landOk(x, z, minH) {
  if (x < 6 || z < 6 || x > 378 || z > 378) return false;
  if (T.height(x, z) < (minH === undefined ? 0.7 : minH)) return false;
  if (T.roadDist(x, z) < 3.0) return false;
  return true;
}

/* Walks a zone's lattice and calls place() for each accepted point. */
function lattice(zone, fn) {
  const step = zone.spacing;
  let placed = 0;
  for (let dz = -zone.r; dz <= zone.r; dz += step) {
    for (let dx = -zone.r; dx <= zone.r; dx += step) {
      if (dx * dx + dz * dz > zone.r * zone.r) continue;
      const bx = zone.x + dx, bz = zone.z + dz;
      /* thin the lattice by density, deterministically */
      if (h2(Math.round(bx), Math.round(bz), 11) > zone.density) continue;
      /* nudge off the grid so it does not read as rows of crops */
      const jx = (h2(Math.round(bx), Math.round(bz), 23) - 0.5) * step * 0.7;
      const jz = (h2(Math.round(bx), Math.round(bz), 37) - 0.5) * step * 0.7;
      const x = +(bx + jx).toFixed(1), z = +(bz + jz).toFixed(1);
      if (fn(x, z, h2(Math.round(x), Math.round(z), 53))) placed++;
    }
  }
  return placed;
}

/* Fishing spots have to sit in water next to a bank you can stand on. */
/* A fishing spot has to be in water with a bank you can stand on nearby. The
   swamp's banks sit around 0.5, so demanding 0.6 within 4 tiles rejected the
   whole of Mirefen and most of the Saltbrook shoreline. */
function waterSpot(x, z) {
  if (T.height(x, z) >= 0.35) return null;
  for (let r = 1; r <= 6; r++) {
    for (let a = 0; a < 12; a++) {
      const ang = a / 12 * Math.PI * 2;
      const sx = x + Math.cos(ang) * r, sz = z + Math.sin(ang) * r;
      if (T.height(sx, sz) > 0.45) return { x: +x.toFixed(1), z: +z.toFixed(1) };
    }
  }
  return null;
}

/* the explicit one-off fixtures go down first, so zones flow around them */
LANDMARKS.forEach(f => {
  const o = Object.assign({}, f, {
    i: ++maxId,
    y: f.t === 'bridge' ? (f.y !== undefined ? f.y : 0) : +T.height(f.x, f.z).toFixed(2),
    landmark: 1
  });
  if (f.t === 'bridge') {
    /* bridge decks sit above the waterline, sampled from the banks */
    let bank = -99;
    for (let d = 4; d <= 12; d++) bank = Math.max(bank, T.height(f.x - d, f.z), T.height(f.x + d, f.z));
    o.y = +Math.max(0.55, bank * 0.75).toFixed(2);
  }
  W.objects.push(o);
});

const report = [];
ZONES.forEach(zone => {
  let n = 0;
  if (zone.kind === 'forest') {
    n = lattice(zone, (x, z, r) => {
      if (inTown(x, z) || !landOk(x, z, zone.minH) || occupied(x, z, 3.7)) return false;
      const k = zone.species[Math.floor(r * zone.species.length) % zone.species.length];
      W.objects.push({ i: ++maxId, t: 'tree', k, x, z, y: +T.height(x, z).toFixed(2),
        rot: +(r * 6.28).toFixed(2), sc: +(0.88 + r * 0.36).toFixed(2), zone: zone.name });
      return true;
    });
  } else if (zone.kind === 'mine') {
    n = lattice(zone, (x, z, r) => {
      if (inTown(x, z) || !landOk(x, z, zone.minH) || occupied(x, z, 3.0)) return false;
      const ore = zone.ores[Math.floor(r * zone.ores.length) % zone.ores.length];
      W.objects.push({ i: ++maxId, t: 'rock', ore, x, z, y: +T.height(x, z).toFixed(2),
        rot: +(r * 6.28).toFixed(2), zone: zone.name });
      return true;
    });
  } else if (zone.kind === 'herbs') {
    n = lattice(zone, (x, z, r) => {
      if (inTown(x, z) || !landOk(x, z, zone.minH) || occupied(x, z, 2.6)) return false;
      const hb = zone.herbs[Math.floor(r * zone.herbs.length) % zone.herbs.length];
      W.objects.push({ i: ++maxId, t: 'herb', h: hb, x, z, y: +T.height(x, z).toFixed(2), zone: zone.name });
      return true;
    });
  } else if (zone.kind === 'flax') {
    n = lattice(zone, (x, z) => {
      if (inTown(x, z) || !landOk(x, z, zone.minH) || occupied(x, z, 2.0)) return false;
      W.objects.push({ i: ++maxId, t: 'flax', x, z, y: +T.height(x, z).toFixed(2), zone: zone.name });
      return true;
    });
  } else if (zone.kind === 'hunting') {
    n = lattice(zone, (x, z) => {
      if (inTown(x, z) || !landOk(x, z, zone.minH) || occupied(x, z, 3.5)) return false;
      W.objects.push({ i: ++maxId, t: 'hunt', g: 'bird', x, z, y: +T.height(x, z).toFixed(2), zone: zone.name });
      return true;
    });
  } else if (zone.kind === 'fishing') {
    n = lattice(zone, (x, z, r) => {
      const spot = waterSpot(x, z);
      if (!spot) return false;
      if (occupied(spot.x, spot.z, 3.4)) return false;
      W.objects.push({ i: ++maxId, t: 'fish', f: zone.fish.slice(), x: spot.x, z: spot.z,
        y: 0, zone: zone.name });
      return true;
    });
  }
  report.push({ name: zone.name, kind: zone.kind, n });
});

/* Renumber every object in a stable order so the pipeline is idempotent:
   running the build twice must produce a byte-identical world, otherwise
   "authored" is only half true. */
W.objects.sort((a, b) =>
  (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) ||
  (a.x - b.x) || (a.z - b.z) ||
  ((a.k || a.ore || a.h || '') < (b.k || b.ore || b.h || '') ? -1 : 1));
W.objects.forEach((o, i) => { o.i = i + 1; });

fs.writeFileSync(path.join(ROOT, 'data/world.json'), JSON.stringify(W));

const after = {};
W.objects.forEach(o => { if (NATURAL.includes(o.t)) after[o.t] = (after[o.t] || 0) + 1; });
console.log('zone'.padEnd(26) + 'kind'.padEnd(10) + 'nodes');
report.forEach(r => console.log('  ' + r.name.padEnd(24) + r.kind.padEnd(10) + r.n));
console.log('\nbefore:', JSON.stringify(before));
console.log('after :', JSON.stringify(after));
console.log('landmarks placed:', LANDMARKS.length);
const unauthored = W.objects.filter(o => !o.zone && !o.authored && !o.landmark);
console.log('total world objects:', W.objects.length,
  '| still unauthored:', unauthored.length);
