/* Emberfall - world validation.
   Checks the authored map data for the mistakes that actually break a game:
   buildings inside each other, blocked doorways, scenery inside walls, NPCs
   standing in collision, unreachable banks and shops. Run it with:

       node tools/validate_world.js

   It exits non-zero when something is wrong, so it can gate a release. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.globalThis = global;
require(path.join(ROOT, 'js/terrain_height.js'));
const T = globalThis.RFTerrain;

const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
const NPCS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/npcs.json'), 'utf8'));
const QUESTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/quests.json'), 'utf8'));

const types = {};
NPCS.npcs.forEach(n => { types[n.key] = n; });

let errors = 0, warnings = 0;
const err = (...a) => { console.log('  ERROR  ', ...a); errors++; };
const warn = (...a) => { console.log('  warn   ', ...a); warnings++; };
const section = (t) => console.log('\n' + t);

/* ---------------------------------------------------------- collision map */
const SIZE = W.size || 384;
const blocked = new Uint8Array((SIZE + 1) * (SIZE + 1));
const idx = (x, z) => z * (SIZE + 1) + x;

function stampRect(cx, cz, w, d, v) {
  for (let z = Math.floor(cz - d / 2); z <= Math.ceil(cz + d / 2); z++) {
    for (let x = Math.floor(cx - w / 2); x <= Math.ceil(cx + w / 2); x++) {
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      blocked[idx(x, z)] = v;
    }
  }
}
function stampCircle(cx, cz, r, v) {
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) blocked[idx(x, z)] = v;
    }
  }
}

/* terrain: water and cliffs */
for (let z = 0; z <= SIZE; z++) {
  for (let x = 0; x <= SIZE; x++) {
    const h = T.height(x, z);
    let b = 0;
    if (h < 0.08) b = 1;
    else {
      const mx = Math.max(
        Math.abs(T.height(x - 1, z) - h), Math.abs(T.height(x + 1, z) - h),
        Math.abs(T.height(x, z - 1) - h), Math.abs(T.height(x, z + 1) - h));
      if (mx > 1.55) b = 1;
    }
    if (b && T.roadDist(x, z) < 2.4 && h >= 0.08) b = 0;
    blocked[idx(x, z)] = b;
  }
}
/* bridges clear the water */
W.objects.filter(o => o.t === 'bridge').forEach(b => {
  const rot = b.rot || 0, sx = Math.sin(rot), cz = Math.cos(rot);
  const len = b.len || 16;
  if (Math.abs(sx) > Math.abs(cz)) stampRect(b.x, b.z, len + 4, 5.0, 0);
  else stampRect(b.x, b.z, 5.0, len + 4, 0);
});
/* Buildings block at their WALLS; the interior floor is walkable, which is
   how the game stamps them. Filling the whole footprint made every shop and
   quest giver look unreachable. */
function stampWalls(b) {
  const x0 = Math.floor(b.x - b.w / 2), x1 = Math.ceil(b.x + b.w / 2);
  const z0 = Math.floor(b.z - b.d / 2), z1 = Math.ceil(b.z + b.d / 2);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      const onEdge = (x === x0 || x === x1 || z === z0 || z === z1);
      if (onEdge) blocked[idx(x, z)] = 1;
    }
  }
}
W.buildings.forEach(stampWalls);
const RADII = { tree: 0.8, rock: 1.1, sign: 0.4, well: 1.3, furnace: 1.6, anvil: 1.1,
  range: 1.2, altar: 1.4, altar_rc: 1.6, bank_booth: 1.2, statue: 1.0, fountain: 1.6 };
W.objects.forEach(o => {
  const r = RADII[o.t];
  if (r) stampCircle(o.x, o.z, r, 1);
});
/* Doorways carved open, using the game's own convention:
   door = [side, offsetAlongWall], side 0=+z 1=+x 2=-z 3=-x */
function doorWorld(b) {
  const side = (b.door && b.door[0]) || 0;
  const off = (b.door && b.door[1]) || 0;
  if (side === 0) return { x: b.x + off, z: b.z + b.d / 2 };
  if (side === 1) return { x: b.x + b.w / 2, z: b.z + off };
  if (side === 2) return { x: b.x + off, z: b.z - b.d / 2 };
  return { x: b.x - b.w / 2, z: b.z + off };
}
W.buildings.forEach(b => {
  const d = doorWorld(b);
  stampCircle(d.x, d.z, 1.8, 0);
});

function isBlocked(x, z) {
  x = Math.floor(x); z = Math.floor(z);
  if (x < 0 || z < 0 || x > SIZE || z > SIZE) return true;
  return !!blocked[idx(x, z)];
}

/* flood fill from the spawn to see what is actually reachable */
const spawn = W.spawnPoint;
const seen = new Uint8Array(blocked.length);
(function flood() {
  const q = [[Math.floor(spawn.x), Math.floor(spawn.z)]];
  seen[idx(q[0][0], q[0][1])] = 1;
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of D) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > SIZE || nz > SIZE) continue;
      const i = idx(nx, nz);
      if (seen[i] || blocked[i]) continue;
      seen[i] = 1;
      q.push([nx, nz]);
    }
  }
})();
function reachable(x, z, slack) {
  slack = slack || 3;
  for (let dz = -slack; dz <= slack; dz++) {
    for (let dx = -slack; dx <= slack; dx++) {
      const nx = Math.floor(x) + dx, nz = Math.floor(z) + dz;
      if (nx < 0 || nz < 0 || nx > SIZE || nz > SIZE) continue;
      if (seen[idx(nx, nz)]) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------ the checks */
section('Buildings');
for (let i = 0; i < W.buildings.length; i++) {
  const a = W.buildings[i];
  if (a.x < 4 || a.z < 4 || a.x > SIZE - 4 || a.z > SIZE - 4) err(a.name, 'is outside the world bounds');
  for (let j = i + 1; j < W.buildings.length; j++) {
    const b = W.buildings[j];
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2) {
      err('"' + a.name + '" overlaps "' + b.name + '" at ' + a.x + ',' + a.z);
    }
  }
  /* footprint must be dry and reasonably level */
  let wet = 0, lo = 99, hi = -99;
  for (let dx = -a.w / 2; dx <= a.w / 2; dx += 1) {
    for (let dz = -a.d / 2; dz <= a.d / 2; dz += 1) {
      const h = T.height(a.x + dx, a.z + dz);
      if (h < 0.45) wet++;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  if (wet) err('"' + a.name + '" stands in water');
  /* Buildings crowding right up to a riverbank is what makes a settlement
     look like it was dropped rather than laid out. Keep a margin. */
  let nearWater = 99;
  for (let dx = -a.w / 2 - 5; dx <= a.w / 2 + 5; dx += 1)
    for (let dz = -a.d / 2 - 5; dz <= a.d / 2 + 5; dz += 1) {
      if (T.height(a.x + dx, a.z + dz) < 0.35) {
        const gx = Math.max(0, Math.abs(dx) - a.w / 2), gz = Math.max(0, Math.abs(dz) - a.d / 2);
        nearWater = Math.min(nearWater, Math.hypot(gx, gz));
      }
    }
  /* A net loft, a harbourmaster and a smugglers' hideout belong on the water;
     they carry a waterfront flag and are exempt. */
  if (nearWater < 3.5 && !a.waterfront) {
    err('"' + a.name + '" is built ' + nearWater.toFixed(1) + ' tiles from open water - too close to the bank');
  }
  if (hi - lo > 1.6) err('"' + a.name + '" stands on ground that drops ' + (hi - lo).toFixed(1) + 'm');
  /* the doorway must be reachable from outside */
  const dw = doorWorld(a);
  if (!reachable(dw.x, dw.z, 2)) {
    err('"' + a.name + '" has an entrance nothing can reach at ' + dw.x.toFixed(0) + ',' + dw.z.toFixed(0));
  }
  /* A building must not be built across a road. */
  let onRoad = 0, tiles = 0;
  for (let dx = -a.w / 2; dx <= a.w / 2; dx += 1)
    for (let dz = -a.d / 2; dz <= a.d / 2; dz += 1) {
      tiles++;
      if (T.roadDist(a.x + dx, a.z + dz) < 2.2) onRoad++;
    }
  if (onRoad && !/Gate/i.test(a.name)) {
    err('"' + a.name + '" is built across a road (' + Math.round(onRoad / tiles * 100) + '% of its footprint)');
  }
  /* And the ground directly in front of its door must be clear - nothing is
     more obviously wrong than a house parked across someone else's entrance. */
  const face = { x: dw.x - a.x, z: dw.z - a.z };
  const flen = Math.hypot(face.x, face.z) || 1;
  for (let step = 1; step <= 4; step++) {
    const px = dw.x + face.x / flen * step;
    const pz = dw.z + face.z / flen * step;
    const blocker = W.buildings.find(b => b !== a &&
      Math.abs(b.x - px) < b.w / 2 && Math.abs(b.z - pz) < b.d / 2);
    if (blocker) {
      err('"' + blocker.name + '" is standing in front of the entrance to "' + a.name + '"');
      break;
    }
    const prop = W.objects.find(o => ['tree', 'rock', 'well', 'statue', 'fountain', 'sign',
      'furnace', 'anvil', 'crate', 'barrel', 'cart', 'brazier', 'standing_stone']
      .includes(o.t) && Math.hypot(o.x - px, o.z - pz) < 1.4);
    if (prop) {
      err('a ' + prop.t + ' is blocking the entrance to "' + a.name + '" at ' +
          prop.x.toFixed(0) + ',' + prop.z.toFixed(0));
      break;
    }
  }
}

section('Bridges');
const bridges = W.objects.filter(o => o.t === 'bridge');
for (let i = 0; i < bridges.length; i++) {
  for (let j = i + 1; j < bridges.length; j++) {
    const d = Math.hypot(bridges[i].x - bridges[j].x, bridges[i].z - bridges[j].z);
    if (d < 26) err('two bridges only ' + d.toFixed(0) + ' tiles apart at ' +
      bridges[i].x.toFixed(0) + ',' + bridges[i].z.toFixed(0) + ' and ' +
      bridges[j].x.toFixed(0) + ',' + bridges[j].z.toFixed(0));
  }
}
console.log('  ' + bridges.length + ' bridges');

section('Scenery');
W.objects.forEach(o => {
  if (o.x < 2 || o.z < 2 || o.x > SIZE - 2 || o.z > SIZE - 2) err('object', o.i, o.t, 'outside world bounds');
  const inside = W.buildings.find(b =>
    Math.abs(b.x - o.x) < b.w / 2 - 0.5 && Math.abs(b.z - o.z) < b.d / 2 - 0.5);
  if (inside && ['tree', 'rock', 'herb', 'flax', 'fish'].includes(o.t)) {
    err(o.t + ' ' + o.i + ' is inside "' + inside.name + '"');
  }
  if (['tree', 'rock'].includes(o.t) && T.roadDist(o.x, o.z) < 1.6) {
    warn(o.t + ' ' + o.i + ' is standing in a road at ' + o.x + ',' + o.z);
  }
  if (o.t === 'fish' && T.height(o.x, o.z) >= 0.45) warn('fishing spot', o.i, 'is on dry land');
  if (o.t !== 'fish' && o.t !== 'bridge' && T.height(o.x, o.z) < 0.3) {
    warn(o.t + ' ' + o.i + ' is standing in water');
  }
});

section('NPCs and monsters');
W.spawns.forEach((sp, i) => {
  const t = types[sp.k];
  if (!t) { err('spawn', i, 'refers to unknown npc', sp.k); return; }
  if (isBlocked(sp.x, sp.z)) warn(t.name, 'spawns inside collision at ' + sp.x + ',' + sp.z);
  if (t.kind !== 'monster' && !reachable(sp.x, sp.z, 3)) {
    err(t.name + ' cannot be reached on foot (' + sp.x + ',' + sp.z + ')');
  }
});

section('Services');
['bank_booth', 'furnace', 'anvil', 'altar', 'range'].forEach(kind => {
  const list = W.objects.filter(o => o.t === kind);
  if (!list.length) { warn('there are no', kind, 'objects in the world'); return; }
  const unreachable = list.filter(o => !reachable(o.x, o.z, 3));
  if (unreachable.length === list.length) err('every', kind, 'is unreachable');
  else if (unreachable.length) warn(unreachable.length + '/' + list.length, kind, 'unreachable');
});
NPCS.shops.forEach(shop => {
  const keeper = NPCS.npcs.find(n => n.shop === shop.id);
  if (!keeper) { err('shop "' + shop.name + '" has no shopkeeper'); return; }
  const sp = W.spawns.find(s => s.k === keeper.key);
  if (!sp) { err('shopkeeper ' + keeper.name + ' is never spawned'); return; }
  if (!reachable(sp.x, sp.z, 3)) err('shop "' + shop.name + '" cannot be reached');
});

section('Quests');
QUESTS.forEach(q => {
  const start = types[q.start];
  if (!start) { err('quest "' + q.name + '" starts with unknown npc', q.start); return; }
  const sp = W.spawns.find(s => s.k === q.start);
  if (!sp) { err('quest "' + q.name + '" start npc ' + start.name + ' is never spawned'); return; }
  if (!reachable(sp.x, sp.z, 3)) err('quest "' + q.name + '" start npc is unreachable');
  q.stages.forEach((st, i) => {
    if (st.t === 'goto' && st.x !== undefined && !reachable(st.x, st.z, 4)) {
      err('quest "' + q.name + '" step ' + (i + 1) + ' sends you somewhere unreachable');
    }
  });
});

section('Difficulty curve');
const bands = {};
W.spawns.forEach(sp => {
  const t = types[sp.k];
  if (!t || t.kind !== 'monster') return;
  const d = Math.hypot(sp.x - spawn.x, sp.z - spawn.z);
  const band = d < 70 ? '  0- 70' : d < 140 ? ' 70-140' : d < 210 ? '140-210' : '210+   ';
  bands[band] = bands[band] || { min: 999, max: 0, n: 0 };
  bands[band].min = Math.min(bands[band].min, t.lvl);
  bands[band].max = Math.max(bands[band].max, t.lvl);
  bands[band].n++;
});
Object.keys(bands).sort().forEach(b => {
  console.log('  ' + b + '  levels ' + bands[b].min + '-' + bands[b].max + ' (' + bands[b].n + ' spawns)');
});
if (bands['  0- 70'] && bands['  0- 70'].max > 14) {
  err('the starting area contains a level ' + bands['  0- 70'].max + ' monster');
}

/* --------------------------------------------------------------- summary */
let walk = 0, total = 0;
for (let z = 2; z < SIZE; z += 2) for (let x = 2; x < SIZE; x += 2) { total++; if (!blocked[idx(x, z)]) walk++; }
console.log('\nWorld: ' + W.buildings.length + ' buildings, ' + W.objects.length + ' objects, ' +
  W.spawns.length + ' spawns, ' + Math.round(walk / total * 100) + '% walkable');
console.log(errors + ' error(s), ' + warnings + ' warning(s)');
process.exit(errors ? 1 : 0);
