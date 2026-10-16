/* Applies the authored settlement layouts over the generated world.
   Procedural structures inside an authored radius are removed and replaced by
   the hand-placed ones; natural scenery is cleared from the town footprint and
   the villagers are moved to their posts. Run: node tools/apply_towns.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
global.globalThis = global;
require(path.join(ROOT, 'js/terrain_height.js'));
const T = globalThis.RFTerrain;
const A = require('./authored_towns.js');

const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
const NPCS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/npcs.json'), 'utf8'));
const known = {}; NPCS.npcs.forEach(n => known[n.key] = n);

const towns = [A.OAKHEART, A.ALDERMERE, A.DUNHOLLOW, A.SALTBROOK, A.MIREFEN, A.BLIGHTFORT, A.OUTPOSTS];

/* Everything this pass created last time goes first. Clearing only by radius
   left fence posts just outside the circle behind, so they multiplied on every
   rebuild and the world was never the same twice. */
W.objects = W.objects.filter(o => !o.authored);
/* Every structure in the world comes from the authored data now. Anything the
   old generator left standing outside a town radius is dropped; the ones worth
   keeping have been written into OUTPOSTS. */
W.buildings = [];
let maxId = 0; W.objects.forEach(o => maxId = Math.max(maxId, o.i));
const near = (t, x, z, pad) => Math.hypot(x - t.centre.x, z - t.centre.z) <= t.radius + (pad || 0);

towns.forEach(t => {
  /* 1. clear the procedural version of this settlement */
  const beforeB = W.buildings.length, beforeO = W.objects.length;
  W.buildings = W.buildings.filter(b => !near(t, b.x, b.z));
  W.objects = W.objects.filter(o => !(near(t, o.x, o.z) && o.t !== 'bridge' && o.t !== 'fish'));

  /* 2. place the authored buildings, seated on the highest ground under them */
  t.buildings.forEach(b => {
    let hi = -99;
    for (let dx = -b.w / 2; dx <= b.w / 2; dx += 1)
      for (let dz = -b.d / 2; dz <= b.d / 2; dz += 1)
        hi = Math.max(hi, T.height(b.x + dx, b.z + dz));
    W.buildings.push(Object.assign({}, b, { y: +hi.toFixed(2), id: W.buildings.length + 1, authored: 1 }));
  });

  /* 3. Interior furniture that the game treats as a STATION has to exist as a
        world object too, not just as decoration inside the building: the
        server checks "are you standing near a bank_booth / furnace / anvil /
        range" against the world object list. Clearing the old town removed
        those, which silently broke banking, smelting, smithing and cooking. */
  const STATIONS = ['bank_booth', 'furnace', 'anvil', 'range', 'altar', 'altar_rc',
                    'spinning_wheel', 'pottery_wheel', 'loom', 'stall', 'counter'];
  let stations = 0;
  t.buildings.forEach(b => {
    (b.interior || []).forEach(f => {
      if (STATIONS.indexOf(f[0]) < 0) return;
      const x = +(b.x + f[1]).toFixed(1), z = +(b.z + f[2]).toFixed(1);
      W.objects.push({ i: ++maxId, t: f[0], x, z, y: +T.height(x, z).toFixed(2),
                       rot: f[3] || 0, indoors: 1, authored: 1 });
      stations++;
    });
  });

  /* 4. authored props */
  t.props.forEach(p => {
    const o = { i: ++maxId, x: p.x, z: p.z, y: +T.height(p.x, p.z).toFixed(2),
                t: p.t === 'prop' ? p.kind : p.t, rot: 0, authored: 1 };
    if (p.txt) o.txt = p.txt;
    W.objects.push(o);
  });

  /* Authored trees: placed as part of the town, so the clearing pass that
     removes scattered scenery cannot take them away again. */
  (t.trees || []).forEach(tr => {
    /* trees growing through each other was the complaint; keep them apart */
    if (W.objects.some(o => Math.hypot(o.x - tr.x, o.z - tr.z) < 4.0)) return;
    W.objects.push({ i: ++maxId, t: 'tree', k: tr.kind, x: tr.x, z: tr.z,
                     y: +T.height(tr.x, tr.z).toFixed(2),
                     rot: +((tr.x * 7 + tr.z * 3) % 6.28).toFixed(2),
                     sc: +(0.9 + ((tr.x + tr.z) % 5) / 12).toFixed(2), authored: 1 });
  });

  /* 5. fence runs, one post every 2 units */
  t.fences.forEach(f => {
    const dx = f.to[0] - f.from[0], dz = f.to[1] - f.from[1];
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const x = +(f.from[0] + dx * i / n).toFixed(1);
      const z = +(f.from[1] + dz * i / n).toFixed(1);
      if (T.height(x, z) < 0.5) continue;
      W.objects.push({ i: ++maxId, t: 'fence', x, z, y: +T.height(x, z).toFixed(2),
                       rot: Math.atan2(dx, dz), authored: 1 });
    }
  });

  /* 6. post the villagers, and drop any duplicate spawns of them elsewhere */
  const posted = Object.keys(t.posts);
  W.spawns = W.spawns.filter(s => !(posted.includes(s.k) && near(t, s.x, s.z, 40)));
  posted.forEach(key => {
    if (!known[key]) { console.log('  ! no such npc: ' + key); return; }
    const p = t.posts[key];
    W.spawns.push({ k: key, x: p.x, z: p.z, w: known[key].kind === 'npc' ? 1.5 : 0 });
  });

  console.log(t.name + ': replaced ' + (beforeB - (W.buildings.length - t.buildings.length)) +
    ' procedural buildings with ' + t.buildings.length + ' authored ones, ' +
    'cleared ' + (beforeO - (W.objects.length - t.props.length)) + ' scattered objects, ' +
    'posted ' + posted.length + ' villagers, ' + stations + ' stations');
});

/* Spacing is part of the authored data, not something a solver decides at
   build time. An earlier version nudged buildings apart automatically and
   kept shoving them into each other's doorways; the gaps below are now set
   in tools/authored_towns.js and checked by tools/validate_world.js. */

/* keep the world's home/spawn on the authored square */
W.spawnPoint = { x: A.OAKHEART.centre.x, z: A.OAKHEART.centre.z };
W.homePoint = { n: 'Oakheart', x: A.OAKHEART.centre.x, z: A.OAKHEART.centre.z };
W.authoredAreas = towns.map(t => ({ name: t.name, x: t.centre.x, z: t.centre.z, r: t.radius }));

W.objects.forEach(o => { if (o.t !== 'fish' && o.t !== 'bridge') o.y = +T.height(o.x, o.z).toFixed(2); });
fs.writeFileSync(path.join(ROOT, 'data/world.json'), JSON.stringify(W));
console.log('world: ' + W.buildings.length + ' buildings, ' + W.objects.length + ' objects, ' + W.spawns.length + ' spawns');
