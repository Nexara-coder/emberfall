#!/usr/bin/env node
/* Emberfall content generator.
   Run once at build time:  node tools/gen_data.js
   Writes data/*.json which the PHP server and the browser both read.
   Players never need Node - the JSON ships in the package. */
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../js/terrain_height.js');

const OUT = path.join(__dirname, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });

/* deterministic RNG so regenerating gives the same world */
let _s = 1337;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
function rr(a, b) { return a + rnd() * (b - a); }
function ri(a, b) { return Math.floor(rr(a, b + 1)); }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

/* ==================================================================== */
/*  ITEMS                                                                */
/* ==================================================================== */
const items = [];
const byName = {};
let nextId = 1;
function item(o) {
  o.id = nextId++;
  if (!o.desc) o.desc = 'A ' + o.name.toLowerCase() + '.';
  if (o.stack === undefined) o.stack = 0;
  if (o.trade === undefined) o.trade = 1;
  if (o.value === undefined) o.value = 1;
  if (!o.tags) o.tags = [];
  items.push(o); byName[o.name] = o.id;
  return o.id;
}
const ID = n => { if (!byName[n]) throw new Error('unknown item ' + n); return byName[n]; };

item({ name: 'Coins', desc: 'Lovely money.', stack: 1, value: 1, icon: ['coin', '#e0c23c', '#a8861f'], tags: ['currency'] });

/* --- metal tiers ---------------------------------------------------- */
const TIERS = [
  { k: 'bronze',    n: 'Bronze',    lvl: 1,  mul: 1.0, c: '#b07a3c', c2: '#7a5228', ore: null },
  { k: 'iron',      n: 'Iron',      lvl: 1,  mul: 1.5, c: '#8d8d95', c2: '#5b5b63' },
  { k: 'steel',     n: 'Steel',     lvl: 5,  mul: 2.3, c: '#c2c8d0', c2: '#7e848c' },
  { k: 'verdite',   n: 'Verdite',   lvl: 20, mul: 3.3, c: '#5d7fd6', c2: '#33509a' },
  { k: 'kaldrite',  n: 'Kaldrite',  lvl: 30, mul: 4.3, c: '#4f9f5f', c2: '#2d6338' },
  { k: 'aetherium', n: 'Aetherium', lvl: 40, mul: 5.5, c: '#57cdd4', c2: '#2b8085' }
];

const WEAPONS = [
  { k: 'dagger',      n: 'dagger',      a: 4,  s: 3,  spd: 3, v: 12,  two: 0 },
  { k: 'sword',       n: 'sword',       a: 7,  s: 6,  spd: 4, v: 34,  two: 0 },
  { k: 'scimitar',    n: 'scimitar',    a: 9,  s: 8,  spd: 4, v: 52,  two: 0 },
  { k: 'longsword',   n: 'longsword',   a: 11, s: 9,  spd: 5, v: 68,  two: 0 },
  { k: 'mace',        n: 'mace',        a: 7,  s: 9,  spd: 5, v: 44,  two: 0, p: 1 },
  { k: 'battleaxe',   n: 'battleaxe',   a: 12, s: 13, spd: 6, v: 92,  two: 0 },
  { k: 'greatsword',  n: 'greatsword',  a: 15, s: 17, spd: 7, v: 130, two: 1 }
];

const ARMOUR = [
  { k: 'helm',    n: 'helm',       slot: 'head',   d: 4,  v: 26 },
  { k: 'body',    n: 'platebody',  slot: 'body',   d: 13, v: 105 },
  { k: 'legs',    n: 'platelegs',  slot: 'legs',   d: 10, v: 82 },
  { k: 'shield',  n: 'kiteshield', slot: 'shield', d: 9,  v: 70 },
  { k: 'gloves',  n: 'gauntlets',  slot: 'hands',  d: 2,  v: 18 },
  { k: 'boots',   n: 'boots',      slot: 'feet',   d: 2,  v: 18 }
];

const tierItems = {};
TIERS.forEach(t => {
  tierItems[t.k] = {};
  WEAPONS.forEach(w => {
    const nm = t.n + ' ' + w.n;
    const id = item({
      name: nm, desc: 'A ' + t.n.toLowerCase() + ' ' + w.n + '. ' + (w.two ? 'Needs both hands.' : ''),
      value: Math.round(w.v * t.mul), slot: 'weapon', twoh: w.two,
      bonus: { a: Math.round(w.a * t.mul), s: Math.round(w.s * t.mul), d: Math.round(w.a * t.mul * 0.15), p: w.p || 0 },
      speed: w.spd, wclass: w.k,
      req: { attack: t.lvl }, icon: [w.k, t.c, t.c2], tags: ['weapon', 'melee', t.k]
    });
    tierItems[t.k][w.k] = id;
  });
  ARMOUR.forEach(a => {
    const nm = t.n + ' ' + a.n;
    const id = item({
      name: nm, value: Math.round(a.v * t.mul), slot: a.slot,
      bonus: { d: Math.round(a.d * t.mul), a: -Math.round(a.d * t.mul * 0.1) },
      req: { defence: t.lvl }, icon: [a.k, t.c, t.c2], tags: ['armour', t.k]
    });
    tierItems[t.k][a.k] = id;
  });
  // tools + smithable bits
  item({ name: t.n + ' pickaxe', value: Math.round(40 * t.mul), slot: 'weapon', wclass: 'pickaxe', speed: 5,
    bonus: { a: Math.round(3 * t.mul), s: Math.round(4 * t.mul) }, req: { mining: t.lvl }, tool: 'pickaxe', power: t.mul,
    icon: ['pickaxe', t.c, '#6b4a2a'], tags: ['tool'] });
  item({ name: t.n + ' hatchet', value: Math.round(34 * t.mul), slot: 'weapon', wclass: 'hatchet', speed: 5,
    bonus: { a: Math.round(3 * t.mul), s: Math.round(5 * t.mul) }, req: { woodcutting: t.lvl }, tool: 'hatchet', power: t.mul,
    icon: ['hatchet', t.c, '#6b4a2a'], tags: ['tool'] });
  item({ name: t.n + ' arrow', stack: 1, value: Math.max(1, Math.round(3 * t.mul)), slot: 'ammo',
    bonus: { r: Math.round(7 * t.mul) }, req: { ranged: t.lvl }, ammo: 'arrow',
    icon: ['arrow', t.c, '#7a5b32'], tags: ['ammo'] });
  item({ name: t.n + ' bar', value: Math.round(30 * t.mul), icon: ['bar', t.c, t.c2], tags: ['bar', t.k] });
  item({ name: t.n + ' nails', stack: 1, value: Math.round(4 * t.mul), icon: ['nail', t.c, t.c2], tags: ['material'] });
});

/* --- ores, bars, gems ----------------------------------------------- */
const ORES = [
  { n: 'Copper ore', lvl: 1, xp: 17.5, v: 10, c: '#c1743a' },
  { n: 'Tin ore', lvl: 1, xp: 17.5, v: 10, c: '#b9b9c4' },
  { n: 'Iron ore', lvl: 15, xp: 35, v: 28, c: '#8a5a46' },
  { n: 'Coal', lvl: 30, xp: 50, v: 45, c: '#2f2f36' },
  { n: 'Silver ore', lvl: 20, xp: 40, v: 40, c: '#d6dce4' },
  { n: 'Gold ore', lvl: 40, xp: 65, v: 120, c: '#e0c23c' },
  { n: 'Verdite ore', lvl: 55, xp: 80, v: 220, c: '#5d7fd6' },
  { n: 'Kaldrite ore', lvl: 70, xp: 95, v: 400, c: '#4f9f5f' },
  { n: 'Aetherium ore', lvl: 85, xp: 125, v: 900, c: '#57cdd4' }
];
ORES.forEach(o => item({ name: o.n, value: o.v, icon: ['ore', o.c, '#5a5a62'], tags: ['ore'] }));
item({ name: 'Silver bar', value: 90, icon: ['bar', '#d6dce4', '#9aa2ac'], tags: ['bar'] });
item({ name: 'Gold bar', value: 260, icon: ['bar', '#e0c23c', '#a8861f'], tags: ['bar'] });

const GEMS = [
  { n: 'Sapphire', c: '#3a6fd8', v: 900, lvl: 20 },
  { n: 'Emerald', c: '#2fa35a', v: 1400, lvl: 27 },
  { n: 'Ruby', c: '#c8323c', v: 2200, lvl: 34 },
  { n: 'Diamond', c: '#dff2f7', v: 3600, lvl: 43 }
];
GEMS.forEach(g => {
  item({ name: 'Uncut ' + g.n.toLowerCase(), value: Math.round(g.v * 0.7), icon: ['gemraw', g.c, '#6b6b73'], tags: ['gem'] });
  item({ name: g.n, value: g.v, icon: ['gem', g.c, '#ffffff'], tags: ['gem'] });
  item({ name: g.n + ' ring', value: g.v + 400, slot: 'ring', bonus: { d: 2, s: 1 }, icon: ['ring', g.c, '#e0c23c'], tags: ['jewellery'] });
  item({ name: g.n + ' amulet', value: g.v + 700, slot: 'neck', bonus: { a: 3, d: 3, s: 2 }, icon: ['amulet', g.c, '#e0c23c'], tags: ['jewellery'] });
});
item({ name: 'Gold ring', value: 420, slot: 'ring', bonus: {}, icon: ['ring', '#e0c23c', '#a8861f'], tags: ['jewellery'] });
item({ name: 'Gold amulet', value: 640, slot: 'neck', bonus: { d: 1 }, icon: ['amulet', '#e0c23c', '#a8861f'], tags: ['jewellery'] });

/* --- logs & trees ---------------------------------------------------- */
const TREES = [
  { n: 'Logs', tree: 'Tree', lvl: 1, xp: 25, v: 4, c: '#8b6239', fire: 1, fxp: 40 },
  { n: 'Oak logs', tree: 'Oak', lvl: 15, xp: 37.5, v: 20, c: '#a07445', fire: 15, fxp: 60 },
  { n: 'Willow logs', tree: 'Willow', lvl: 30, xp: 67.5, v: 45, c: '#7d8c4e', fire: 30, fxp: 90 },
  { n: 'Silverbirch logs', tree: 'Silverbirch', lvl: 45, xp: 100, v: 110, c: '#cfd4cc', fire: 45, fxp: 135 },
  { n: 'Ironbark logs', tree: 'Ironbark', lvl: 60, xp: 175, v: 280, c: '#6a5a48', fire: 60, fxp: 203 },
  { n: 'Ghostwood logs', tree: 'Ghostwood', lvl: 75, xp: 250, v: 650, c: '#9ec8d6', fire: 75, fxp: 304 }
];
TREES.forEach(t => item({ name: t.n, value: t.v, icon: ['log', t.c, '#5d4426'], tags: ['log'] }));

/* --- bows & arrows --------------------------------------------------- */
const BOWWOOD = [
  { p: '', n: 'Logs', lvl: 1, mul: 1 },
  { p: 'Oak ', n: 'Oak logs', lvl: 20, mul: 1.7 },
  { p: 'Willow ', n: 'Willow logs', lvl: 35, mul: 2.5 },
  { p: 'Silverbirch ', n: 'Silverbirch logs', lvl: 50, mul: 3.4 },
  { p: 'Ironbark ', n: 'Ironbark logs', lvl: 65, mul: 4.4 },
  { p: 'Ghostwood ', n: 'Ghostwood logs', lvl: 80, mul: 5.6 }
];
BOWWOOD.forEach(b => {
  ['shortbow', 'longbow'].forEach(kind => {
    const fast = kind === 'shortbow';
    item({
      name: b.p ? (b.p + kind) : (kind.charAt(0).toUpperCase() + kind.slice(1)),
      value: Math.round((fast ? 40 : 60) * b.mul), slot: 'weapon', twoh: 1, wclass: 'bow', speed: fast ? 4 : 6,
      bonus: { r: Math.round((fast ? 9 : 13) * b.mul) }, req: { ranged: Math.max(1, b.lvl) },
      icon: ['bow', '#8b6239', '#5d4426'], tags: ['weapon', 'ranged']
    });
  });
});
item({ name: 'Bow string', value: 60, icon: ['string', '#ddd6c0', '#9a917a'], tags: ['material'] });
item({ name: 'Feather', stack: 1, value: 2, icon: ['feather', '#f2f0e6', '#b9b5a4'], tags: ['material'] });
item({ name: 'Arrow shaft', stack: 1, value: 1, icon: ['shaft', '#9b7b4d', '#6b5231'], tags: ['material'] });
item({ name: 'Headless arrow', stack: 1, value: 2, icon: ['shaft', '#9b7b4d', '#f2f0e6'], tags: ['material'] });

/* --- runes & staves --------------------------------------------------- */
const RUNES = [
  { n: 'Air', c: '#cfe4ef', v: 4, lvl: 1, xp: 5 },
  { n: 'Water', c: '#3f7fd0', v: 4, lvl: 5, xp: 6 },
  { n: 'Earth', c: '#7a5a34', v: 4, lvl: 9, xp: 6.5 },
  { n: 'Fire', c: '#d2582c', v: 5, lvl: 14, xp: 7 },
  { n: 'Mind', c: '#c9c4d8', v: 3, lvl: 2, xp: 5.5 },
  { n: 'Body', c: '#c08a6a', v: 3, lvl: 20, xp: 7.5 },
  { n: 'Chaos', c: '#8b2f6a', v: 90, lvl: 35, xp: 8.5 },
  { n: 'Nature', c: '#3f9b52', v: 210, lvl: 44, xp: 9 },
  { n: 'Cosmic', c: '#6f5fc0', v: 160, lvl: 27, xp: 8 },
  { n: 'Law', c: '#4a7fb5', v: 240, lvl: 54, xp: 9.5 },
  { n: 'Death', c: '#4a4a52', v: 300, lvl: 65, xp: 10 },
  { n: 'Soul', c: '#d8c86a', v: 420, lvl: 78, xp: 10.5 }
];
RUNES.forEach(r => item({ name: r.n + ' rune', stack: 1, value: r.v, icon: ['rune', r.c, '#4b4636'], tags: ['rune'] }));
item({ name: 'Rune essence', stack: 1, value: 12, icon: ['ore', '#cfc9b8', '#8a8574'], tags: ['material'] });
item({ name: 'Pure essence', stack: 1, value: 22, icon: ['ore', '#efeade', '#a8a08c'], tags: ['material'] });

const STAVES = [
  { n: 'Wizard staff', v: 200, m: 10, lvl: 1, c: '#8b6239' },
  { n: 'Air staff', v: 900, m: 14, lvl: 15, c: '#cfe4ef' },
  { n: 'Water staff', v: 950, m: 14, lvl: 15, c: '#3f7fd0' },
  { n: 'Earth staff', v: 950, m: 14, lvl: 15, c: '#7a5a34' },
  { n: 'Fire staff', v: 1000, m: 15, lvl: 20, c: '#d2582c' },
  { n: 'Runeward staff', v: 5200, m: 24, lvl: 45, c: '#57cdd4' }
];
STAVES.forEach(s => item({
  name: s.n, value: s.v, slot: 'weapon', twoh: 1, wclass: 'staff', speed: 5,
  bonus: { m: s.m, a: 4, s: 3, d: 4 }, req: { magic: s.lvl },
  icon: ['staff', s.c, '#6b4a2a'], tags: ['weapon', 'magic']
}));
[['Wizard hat', 'head', 3, 300], ['Wizard robe top', 'body', 6, 600], ['Wizard robe skirt', 'legs', 5, 480],
 ['Mystic hood', 'head', 7, 1800], ['Mystic robe top', 'body', 12, 4200], ['Mystic robe skirt', 'legs', 10, 3400]]
  .forEach(r => item({
    name: r[0], slot: r[1], value: r[3], bonus: { m: r[2], d: Math.round(r[2] * 0.4) },
    req: { magic: r[3] > 1000 ? 40 : 1 }, icon: ['robe', '#4a3f8c', '#2b2456'], tags: ['armour', 'magic']
  }));

/* --- leather / crafting ---------------------------------------------- */
item({ name: 'Cowhide', value: 60, icon: ['hide', '#a98457', '#6d5335'], tags: ['material'] });
item({ name: 'Leather', value: 90, icon: ['hide', '#8d6a3f', '#5b4426'], tags: ['material'] });
item({ name: 'Hard leather', value: 160, icon: ['hide', '#6d4f2c', '#42301a'], tags: ['material'] });
item({ name: 'Blighted hide', value: 420, icon: ['hide', '#5a6b4a', '#33402b'], tags: ['material'] });
[['Leather gloves', 'hands', 1, 30, 1, 13.8], ['Leather boots', 'feet', 2, 40, 7, 16.2],
 ['Leather cowl', 'head', 3, 50, 9, 18.5], ['Leather body', 'body', 8, 120, 14, 25],
 ['Leather chaps', 'legs', 6, 90, 18, 27], ['Hard leather body', 'body', 14, 260, 28, 35]]
  .forEach(l => item({
    name: l[0], slot: l[1], value: l[3], bonus: { d: l[2], r: Math.round(l[2] * 0.6) },
    req: { defence: 1 }, craft: { lvl: l[4], xp: l[5] }, icon: ['leather', '#8d6a3f', '#5b4426'], tags: ['armour', 'ranged']
  }));
item({ name: 'Ball of wool', value: 20, icon: ['string', '#e8e2d0', '#b0a88e'], tags: ['material'] });
item({ name: 'Flax', value: 8, icon: ['plant', '#b9c46a', '#7d8a3e'], tags: ['material'] });
item({ name: 'Wool', value: 12, icon: ['plant', '#efe9d8', '#bcb49c'], tags: ['material'] });
item({ name: 'Soft clay', value: 30, icon: ['ore', '#b1a48c', '#7d7360'], tags: ['material'] });
item({ name: 'Unfired pot', value: 12, icon: ['pot', '#b1a48c', '#7d7360'], tags: ['material'] });
item({ name: 'Pot', value: 16, icon: ['pot', '#a8926f', '#6f6046'], tags: ['material'] });
item({ name: 'Bucket', value: 10, icon: ['bucket', '#8d8d95', '#5b5b63'], tags: ['tool'] });
item({ name: 'Bucket of water', value: 14, icon: ['bucket', '#3f7fd0', '#5b5b63'], tags: ['tool'] });
item({ name: 'Jug', value: 8, icon: ['pot', '#cfc7b0', '#8f8874'], tags: ['material'] });
item({ name: 'Vial', value: 10, icon: ['vial', '#cfe4ef', '#8fa3ad'], tags: ['material'] });
item({ name: 'Vial of water', value: 12, icon: ['vial', '#3f7fd0', '#8fa3ad'], tags: ['material'] });

/* --- fishing & food --------------------------------------------------- */
const FISH = [
  { n: 'Shrimp', lvl: 1, xp: 10, cook: 1, cxp: 30, heal: 3, v: 8, tool: 'net', c: '#e2a07a' },
  { n: 'Sardine', lvl: 5, xp: 20, cook: 1, cxp: 40, heal: 4, v: 12, tool: 'rod', c: '#b9c2cc' },
  { n: 'Herring', lvl: 10, xp: 30, cook: 5, cxp: 50, heal: 5, v: 18, tool: 'rod', c: '#9fb4c4' },
  { n: 'Trout', lvl: 20, xp: 50, cook: 15, cxp: 70, heal: 7, v: 30, tool: 'fly', c: '#c0a67a' },
  { n: 'Pike', lvl: 25, xp: 60, cook: 20, cxp: 80, heal: 8, v: 40, tool: 'rod', c: '#7f8f5a' },
  { n: 'Salmon', lvl: 30, xp: 70, cook: 25, cxp: 90, heal: 9, v: 55, tool: 'fly', c: '#e08a6a' },
  { n: 'Lobster', lvl: 40, xp: 90, cook: 40, cxp: 120, heal: 12, v: 130, tool: 'pot', c: '#c4452f' },
  { n: 'Bass', lvl: 46, xp: 100, cook: 43, cxp: 130, heal: 13, v: 170, tool: 'net', c: '#6f8fa8' },
  { n: 'Spearfish', lvl: 50, xp: 100, cook: 45, cxp: 140, heal: 14, v: 220, tool: 'harpoon', c: '#8fa8c4' },
  { n: 'Direfin', lvl: 76, xp: 110, cook: 80, cxp: 210, heal: 20, v: 620, tool: 'harpoon', c: '#5a6b7a' }
];
FISH.forEach(f => {
  item({ name: 'Raw ' + f.n.toLowerCase(), value: f.v, icon: ['fish', f.c, '#6b6b73'], tags: ['raw'] });
  item({ name: f.n, value: Math.round(f.v * 1.4), eat: f.heal, icon: ['fishcooked', f.c, '#c98a3c'], tags: ['food'] });
  item({ name: 'Burnt ' + f.n.toLowerCase(), value: 1, trade: 0, icon: ['fish', '#3a3a3a', '#222'], tags: ['junk'] });
});
[['Small fishing net', 'net', 20], ['Fishing rod', 'rod', 30], ['Fly fishing rod', 'fly', 45],
 ['Lobster pot', 'pot', 40], ['Harpoon', 'harpoon', 70]]
  .forEach(t => item({ name: t[0], value: t[2], tool: 'fish', fishTool: t[1], icon: ['net', '#9b8f6f', '#6b6242'], tags: ['tool'] }));

item({ name: 'Grain', value: 6, icon: ['plant', '#d6c06a', '#a0893c'], tags: ['material'] });
item({ name: 'Pot of flour', value: 24, icon: ['pot', '#efe9d8', '#8f8874'], tags: ['material'] });
item({ name: 'Bread dough', value: 12, icon: ['bread', '#e2d3ad', '#b09a6a'], tags: ['material'] });
item({ name: 'Bread', value: 26, eat: 5, icon: ['bread', '#c99a54', '#8a6634'], tags: ['food'] });
item({ name: 'Burnt bread', value: 1, trade: 0, icon: ['bread', '#3a3a3a', '#222'], tags: ['junk'] });
item({ name: 'Stew', value: 70, eat: 11, icon: ['bowl', '#b06a3c', '#7a4726'], tags: ['food'] });
item({ name: 'Meat pie', value: 90, eat: 12, icon: ['pie', '#d6b070', '#9a7a42'], tags: ['food'] });
item({ name: 'Cake', value: 120, eat: 12, icon: ['cake', '#f0e2c0', '#d07a9a'], tags: ['food'] });
item({ name: 'Raw beef', value: 10, icon: ['meat', '#c4564c', '#8a3c34'], tags: ['raw'] });
item({ name: 'Cooked beef', value: 20, eat: 3, icon: ['meat', '#a06a42', '#6e472a'], tags: ['food'] });
item({ name: 'Raw chicken', value: 8, icon: ['meat', '#e0b89a', '#a8866c'], tags: ['raw'] });
item({ name: 'Cooked chicken', value: 18, eat: 3, icon: ['meat', '#c9955a', '#8f6a3c'], tags: ['food'] });
item({ name: 'Burnt meat', value: 1, trade: 0, icon: ['meat', '#3a3a3a', '#222'], tags: ['junk'] });

/* --- farming ---------------------------------------------------------- */
const CROPS = [
  { n: 'Potato', lvl: 1, xp: 9, grow: 240, seedv: 4, cropv: 8 },
  { n: 'Onion', lvl: 5, xp: 11, grow: 260, seedv: 6, cropv: 12 },
  { n: 'Cabbage', lvl: 7, xp: 12, grow: 280, seedv: 8, cropv: 14 },
  { n: 'Wheat', lvl: 12, xp: 16, grow: 320, seedv: 10, cropv: 16 },
  { n: 'Tomato', lvl: 16, xp: 19, grow: 360, seedv: 14, cropv: 22 },
  { n: 'Sweetcorn', lvl: 20, xp: 24, grow: 420, seedv: 20, cropv: 30 },
  { n: 'Strawberry', lvl: 31, xp: 34, grow: 520, seedv: 40, cropv: 60 },
  { n: 'Watermelon', lvl: 47, xp: 55, grow: 700, seedv: 90, cropv: 140 }
];
CROPS.forEach(c => {
  item({ name: c.n + ' seed', stack: 1, value: c.seedv, icon: ['seed', '#9a8a5a', '#6b6042'], tags: ['seed'] });
  item({ name: c.n, value: c.cropv, eat: Math.max(1, Math.round(c.xp / 8)), icon: ['plant', '#6fa04a', '#487030'], tags: ['food', 'crop'] });
});

/* --- herblore --------------------------------------------------------- */
const HERBS = [
  { n: 'Marshleaf', lvl: 3, xp: 2.5, c: '#6f8f4a' },
  { n: 'Bitterroot', lvl: 5, xp: 3.8, c: '#8a7a3a' },
  { n: 'Redthistle', lvl: 11, xp: 5, c: '#a84a3a' },
  { n: 'Blueleaf', lvl: 20, xp: 6.3, c: '#4a6fa8' },
  { n: 'Duskcap', lvl: 25, xp: 7.5, c: '#6a4a7a' },
  { n: 'Emberroot', lvl: 40, xp: 8.8, c: '#c46a2a' },
  { n: 'Frostvine', lvl: 48, xp: 10, c: '#8fc4d6' },
  { n: 'Goldenseal', lvl: 65, xp: 12.5, c: '#d6b83a' }
];
HERBS.forEach(h => {
  item({ name: 'Grimy ' + h.n.toLowerCase(), value: 20, icon: ['herb', '#5a6b3a', '#3a4426'], tags: ['herb'] });
  item({ name: h.n, value: 40, icon: ['herb', h.c, '#3a4426'], tags: ['herb'] });
  item({ name: h.n + ' seed', stack: 1, value: 60, icon: ['seed', h.c, '#4a4432'], tags: ['seed', 'herbseed'] });
});
item({ name: 'Newt eye', stack: 1, value: 30, icon: ['eye', '#d0d8c0', '#5a6b3a'], tags: ['secondary'] });
item({ name: 'Bloodroot', stack: 1, value: 90, icon: ['herb', '#a8324a', '#63202e'], tags: ['secondary'] });
item({ name: 'Ashen dust', stack: 1, value: 60, icon: ['dust', '#8a8a92', '#55555c'], tags: ['secondary'] });
item({ name: 'Crushed shell', stack: 1, value: 45, icon: ['dust', '#e0d8c0', '#a8a08c'], tags: ['secondary'] });
item({ name: 'Wyrm scale', stack: 1, value: 260, icon: ['scale', '#4f9f5f', '#2d6338'], tags: ['secondary'] });

const POTIONS = [
  { n: 'Attack potion', lvl: 3, xp: 25, herb: 'Marshleaf', sec: 'Newt eye', eff: { skill: 'attack', boost: 3 }, v: 130 },
  { n: 'Strength potion', lvl: 12, xp: 50, herb: 'Redthistle', sec: 'Bloodroot', eff: { skill: 'strength', boost: 3 }, v: 220 },
  { n: 'Defence potion', lvl: 30, xp: 75, herb: 'Blueleaf', sec: 'Crushed shell', eff: { skill: 'defence', boost: 4 }, v: 300 },
  { n: 'Restore potion', lvl: 22, xp: 62.5, herb: 'Bitterroot', sec: 'Ashen dust', eff: { restore: 1 }, v: 260 },
  { n: 'Antipoison', lvl: 5, xp: 37.5, herb: 'Marshleaf', sec: 'Crushed shell', eff: { cure: 1 }, v: 180 },
  { n: 'Prayer potion', lvl: 38, xp: 87.5, herb: 'Duskcap', sec: 'Ashen dust', eff: { prayer: 12 }, v: 480 },
  { n: 'Ranging potion', lvl: 45, xp: 100, herb: 'Emberroot', sec: 'Wyrm scale', eff: { skill: 'ranged', boost: 4 }, v: 560 },
  { n: 'Magic potion', lvl: 50, xp: 112.5, herb: 'Frostvine', sec: 'Wyrm scale', eff: { skill: 'magic', boost: 4 }, v: 640 },
  { n: 'Super attack', lvl: 55, xp: 125, herb: 'Goldenseal', sec: 'Newt eye', eff: { skill: 'attack', boost: 6 }, v: 900 },
  { n: 'Super strength', lvl: 62, xp: 137.5, herb: 'Goldenseal', sec: 'Bloodroot', eff: { skill: 'strength', boost: 6 }, v: 1100 }
];
POTIONS.forEach(p => {
  item({ name: p.n, value: p.v, drink: p.eff, icon: ['potion', '#c4453a', '#8fa3ad'], tags: ['potion'] });
  item({ name: 'Unfinished ' + p.n.toLowerCase(), value: Math.round(p.v * 0.4), icon: ['potion', '#8a9a6a', '#8fa3ad'], tags: ['potion'] });
});

/* --- bones, prayer, misc drops --------------------------------------- */
item({ name: 'Bones', value: 2, bury: 4.5, icon: ['bone', '#e8e2cf', '#b0a88e'], tags: ['bone'] });
item({ name: 'Big bones', value: 12, bury: 15, icon: ['bone', '#ded6bd', '#a49b80'], tags: ['bone'] });
item({ name: 'Blighted bones', value: 40, bury: 30, icon: ['bone', '#b8c4a8', '#7a8a6a'], tags: ['bone'] });
item({ name: 'Drake bones', value: 120, bury: 72, icon: ['bone', '#cfd8c0', '#8a9478'], tags: ['bone'] });
item({ name: 'Goblin ear', stack: 1, value: 15, icon: ['misc', '#7f9a5a', '#4f6238'], tags: ['drop'] });
item({ name: 'Wolf pelt', value: 70, icon: ['hide', '#8a8478', '#57534a'], tags: ['drop'] });
item({ name: 'Spider silk', stack: 1, value: 40, icon: ['string', '#e8e8ee', '#b0b0bb'], tags: ['drop'] });
item({ name: 'Ash', stack: 1, value: 6, icon: ['dust', '#6a6a72', '#3f3f45'], tags: ['drop'] });
item({ name: 'Tattered cloth', value: 25, icon: ['cloth', '#9a8f78', '#5f5848'], tags: ['drop'] });

/* --- tools & utility --------------------------------------------------- */
[['Tinderbox', 'tinderbox', 12], ['Hammer', 'hammer', 15], ['Chisel', 'chisel', 15], ['Needle', 'needle', 6],
 ['Knife', 'knife', 10], ['Spade', 'spade', 20], ['Seed dibber', 'dibber', 25], ['Rake', 'rake', 20],
 ['Watering can', 'can', 30], ['Bird snare', 'snare', 28], ['Mortar and pestle', 'pestle', 22],
 ['Rope', 'rope', 30], ['Candle', 'candle', 8], ['Lockpick', 'lockpick', 60], ['Glassblowing pipe', 'pipe', 26]]
  .forEach(t => item({ name: t[0], value: t[2], tool: t[1], icon: ['tool', '#9b8f6f', '#6b6242'], tags: ['tool'] }));
item({ name: 'Thread', stack: 1, value: 3, icon: ['string', '#e8e2d0', '#b0a88e'], tags: ['material'] });
item({ name: 'Molten glass', value: 40, icon: ['gem', '#cfe4ef', '#8fa3ad'], tags: ['material'] });
item({ name: 'Bucket of sand', value: 24, icon: ['bucket', '#d8c89a', '#5b5b63'], tags: ['material'] });
item({ name: 'Beer', value: 12, eat: 1, icon: ['jug', '#c9963c', '#8a6626'], tags: ['food'] });
item({ name: 'Dungeon key', value: 0, trade: 0, icon: ['key', '#c2c8d0', '#7e848c'], tags: ['key'] });

/* --- capes / misc equipment -------------------------------------------- */
[['Grey cape', '#8a8a92'], ['Red cape', '#a8323c'], ['Blue cape', '#3a5fa8'], ['Green cape', '#3f8f4a'],
 ['Gold cape', '#d6b83a'], ['Black cape', '#2f2f36']].forEach(c => item({
  name: c[0], slot: 'cape', value: 60, bonus: { d: 1 }, icon: ['cape', c[1], '#4b4636'], tags: ['armour']
}));
item({ name: 'Ash Warden cape', slot: 'cape', value: 30000, trade: 0, bonus: { d: 9, s: 4, a: 4 }, icon: ['cape', '#c4562a', '#6b2a12'], tags: ['armour', 'rare'] });
item({ name: 'Amulet of the Vale', slot: 'neck', value: 12000, trade: 0, bonus: { a: 10, s: 8, d: 6 }, icon: ['amulet', '#57cdd4', '#e0c23c'], tags: ['jewellery', 'rare'] });

/* --- quest items -------------------------------------------------------- */
const QITEMS = ['Warden\'s seal', 'Rusty cellar key', 'Fisherman\'s pipe', 'Goblin war banner', 'Smith\'s tongs',
  'Blessed seedling', 'Barnacled crate', 'Ledger page A', 'Ledger page B', 'Ledger page C', 'Aldermere signet',
  'Drowned crown', 'Dwarven charter', 'Frostforge ember', 'Mirefen lantern', 'Bog-witch\'s tooth',
  'Alchemist\'s ledger', 'Stolen purse', 'Watcher\'s lens', 'Old Circle tablet', 'Fletcher\'s pattern',
  'Crown of Grothak', 'Ashen sigil', 'Traveller\'s journal', 'Pilgrim\'s token', 'Sealed letter',
  'Cracked hourglass', 'Silver bell', 'Herbalist\'s note', 'Miner\'s tally'];
QITEMS.forEach(q => item({ name: q, value: 0, trade: 0, quest: 1, icon: ['quest', '#d6c07a', '#8a7442'], tags: ['quest'] }));

/* ==================================================================== */
/*  NPCS & MONSTERS                                                      */
/* ==================================================================== */
const npcs = [];
const npcByKey = {};
function npc(o) {
  o.key = o.key || o.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  npcByKey[o.key] = o;
  npcs.push(o);
  return o.key;
}
function drops(list) { return list.map(d => ({ item: ID(d[0]), min: d[1], max: d[2], w: d[3] })); }

/* monsters: key, name, level, hp, maxhit, att(accuracy), def, xp handled by server */
const MONSTERS = [
  { name: 'Chicken', lvl: 1, hp: 3, hit: 1, att: 1, def: 1, aggro: 0, resp: 25, model: { kind: 'bird', c1: '#efe6d0', c2: '#c4452f', sc: 0.45 },
    drop: [['Raw chicken', 1, 1, 60], ['Feather', 5, 15, 100], ['Bones', 1, 1, 100]] },
  { name: 'Cow', lvl: 2, hp: 8, hit: 1, att: 1, def: 2, aggro: 0, resp: 30, model: { kind: 'quad', c1: '#e8e2d4', c2: '#6b4a2a', sc: 1.0 },
    drop: [['Raw beef', 1, 1, 100], ['Cowhide', 1, 1, 100], ['Bones', 1, 1, 100]] },
  { name: 'Giant rat', lvl: 3, hp: 5, hit: 2, att: 3, def: 2, aggro: 0, resp: 22, model: { kind: 'quad', c1: '#6b5a4a', c2: '#3f352b', sc: 0.5 },
    drop: [['Bones', 1, 1, 100], ['Raw beef', 1, 1, 25]] },
  { name: 'Forest spider', lvl: 9, hp: 12, hit: 3, att: 8, def: 7, aggro: 1, resp: 26, model: { kind: 'spider', c1: '#3f3a30', c2: '#8a2a2a', sc: 0.6 },
    drop: [['Spider silk', 1, 2, 70], ['Bones', 1, 1, 40]] },
  { name: 'Goblin', lvl: 5, hp: 9, hit: 2, att: 5, def: 4, aggro: 1, resp: 24, model: { kind: 'humanoid', c1: '#6f9a4a', c2: '#7a4a2a', sc: 0.85, weap: 'Bronze dagger' },
    drop: [['Bones', 1, 1, 100], ['Coins', 5, 30, 80], ['Goblin ear', 1, 1, 40], ['Bronze dagger', 1, 1, 12]] },
  { name: 'Goblin brute', lvl: 13, hp: 22, hit: 5, att: 13, def: 11, aggro: 1, resp: 30, model: { kind: 'humanoid', c1: '#5f8a3a', c2: '#5a3a20', sc: 1.05, weap: 'Iron battleaxe' },
    drop: [['Bones', 1, 1, 100], ['Coins', 20, 90, 90], ['Goblin ear', 1, 2, 50], ['Iron scimitar', 1, 1, 10]] },
  { name: 'Bandit scout', lvl: 16, hp: 26, hit: 5, att: 17, def: 15, aggro: 1, resp: 32, model: { kind: 'humanoid', c1: '#c9a88a', c2: '#4a4238', sc: 1.0, weap: 'Iron sword' },
    drop: [['Coins', 40, 180, 100], ['Bones', 1, 1, 100], ['Iron sword', 1, 1, 12], ['Lockpick', 1, 1, 8]] },
  { name: 'Cave crawler', lvl: 21, hp: 30, hit: 6, att: 22, def: 20, aggro: 1, resp: 30, model: { kind: 'spider', c1: '#5a6b4a', c2: '#2f3a26', sc: 0.8 },
    drop: [['Bones', 1, 1, 100], ['Coins', 20, 120, 70], ['Grimy marshleaf', 1, 1, 25]] },
  { name: 'Mountain wolf', lvl: 24, hp: 34, hit: 7, att: 26, def: 21, aggro: 1, resp: 28, model: { kind: 'quad', c1: '#7a7468', c2: '#45413a', sc: 0.85 },
    drop: [['Bones', 1, 1, 100], ['Wolf pelt', 1, 1, 60], ['Raw beef', 1, 2, 40]] },
  { name: 'Rock golem', lvl: 34, hp: 48, hit: 8, att: 34, def: 42, aggro: 0, resp: 40, model: { kind: 'golem', c1: '#7b7b83', c2: '#4a4a52', sc: 1.25 },
    drop: [['Iron ore', 1, 3, 70], ['Coal', 1, 3, 55], ['Uncut sapphire', 1, 1, 10], ['Silver ore', 1, 2, 20]] },
  { name: 'Hobgrim', lvl: 29, hp: 40, hit: 7, att: 30, def: 28, aggro: 1, resp: 32, model: { kind: 'humanoid', c1: '#8a9a4a', c2: '#4a3a2a', sc: 1.15, weap: 'Steel mace' },
    drop: [['Bones', 1, 1, 100], ['Coins', 60, 260, 95], ['Steel mace', 1, 1, 9], ['Chaos rune', 3, 9, 22]] },
  { name: 'Crag giant', lvl: 44, hp: 60, hit: 10, att: 44, def: 38, aggro: 1, resp: 45, model: { kind: 'humanoid', c1: '#b09a7a', c2: '#6a5a3a', sc: 1.6, weap: 'Steel battleaxe' },
    drop: [['Big bones', 1, 1, 100], ['Coins', 100, 420, 95], ['Verdite bar', 1, 1, 12], ['Uncut ruby', 1, 1, 7]] },
  { name: 'Marsh zombie', lvl: 19, hp: 28, hit: 5, att: 19, def: 17, aggro: 1, resp: 28, model: { kind: 'humanoid', c1: '#6a7a5a', c2: '#3a4432', sc: 1.0 },
    drop: [['Bones', 1, 1, 100], ['Tattered cloth', 1, 1, 45], ['Coins', 15, 80, 60]] },
  { name: 'Skeleton', lvl: 26, hp: 32, hit: 6, att: 26, def: 24, aggro: 1, resp: 28, model: { kind: 'skeleton', c1: '#ded6bd', c2: '#9a9078', sc: 1.0, weap: 'Iron scimitar' },
    drop: [['Bones', 1, 1, 100], ['Coins', 30, 150, 80], ['Iron scimitar', 1, 1, 10]] },
  { name: 'Bog lurker', lvl: 38, hp: 52, hit: 9, att: 38, def: 34, aggro: 1, resp: 36, model: { kind: 'blob', c1: '#4a5f3a', c2: '#2a3624', sc: 1.2 },
    drop: [['Bones', 1, 1, 60], ['Grimy blueleaf', 1, 2, 30], ['Coins', 80, 300, 85], ['Nature rune', 2, 8, 20]] },
  { name: 'Mire wraith', lvl: 52, hp: 66, hit: 11, att: 54, def: 46, aggro: 1, resp: 44, model: { kind: 'wraith', c1: '#6a6f8a', c2: '#33364a', sc: 1.25 },
    drop: [['Blighted bones', 1, 1, 100], ['Coins', 150, 600, 95], ['Death rune', 2, 8, 25], ['Duskcap', 1, 2, 20]] },
  { name: 'Grave knight', lvl: 68, hp: 88, hit: 14, att: 70, def: 66, aggro: 1, resp: 55, model: { kind: 'humanoid', c1: '#5a5f6a', c2: '#2f333c', sc: 1.15, weap: 'Verdite longsword' },
    drop: [['Blighted bones', 1, 1, 100], ['Coins', 300, 1200, 95], ['Verdite platebody', 1, 1, 6], ['Law rune', 4, 12, 22]] },
  { name: 'Pirate deckhand', lvl: 23, hp: 32, hit: 6, att: 23, def: 21, aggro: 1, resp: 30, model: { kind: 'humanoid', c1: '#c9a88a', c2: '#7a2a2a', sc: 1.0, weap: 'Steel scimitar' },
    drop: [['Coins', 50, 260, 100], ['Bones', 1, 1, 100], ['Raw herring', 1, 3, 30]] },
  { name: 'Giant crab', lvl: 18, hp: 26, hit: 5, att: 18, def: 22, aggro: 0, resp: 26, model: { kind: 'crab', c1: '#c4452f', c2: '#7a2a1c', sc: 0.9 },
    drop: [['Crushed shell', 1, 3, 80], ['Raw lobster', 1, 1, 20], ['Bones', 1, 1, 40]] },
  { name: 'Gloom bat', lvl: 14, hp: 18, hit: 4, att: 14, def: 10, aggro: 1, resp: 22, model: { kind: 'bird', c1: '#3a3440', c2: '#6a2a3a', sc: 0.55 },
    drop: [['Bones', 1, 1, 100], ['Coins', 10, 60, 60]] },
  { name: 'Blight hound', lvl: 41, hp: 54, hit: 10, att: 42, def: 36, aggro: 1, resp: 34, model: { kind: 'quad', c1: '#5a6b4a', c2: '#2f3a26', sc: 0.95 },
    drop: [['Blighted bones', 1, 1, 100], ['Blighted hide', 1, 1, 40], ['Coins', 90, 380, 90]] },
  { name: 'Corrupted knight', lvl: 74, hp: 96, hit: 15, att: 76, def: 74, aggro: 1, resp: 55, model: { kind: 'humanoid', c1: '#4a4a52', c2: '#7a2a2a', sc: 1.1, weap: 'Kaldrite longsword' },
    drop: [['Blighted bones', 1, 1, 100], ['Coins', 400, 1600, 95], ['Kaldrite platelegs', 1, 1, 5], ['Death rune', 5, 15, 25]] },
  { name: 'Blight shaman', lvl: 58, hp: 72, hit: 13, att: 58, def: 48, aggro: 1, resp: 48, model: { kind: 'humanoid', c1: '#7a6a8a', c2: '#3a2a4a', sc: 1.05, weap: 'Fire staff' },
    drop: [['Blighted bones', 1, 1, 100], ['Chaos rune', 5, 20, 60], ['Coins', 200, 900, 95], ['Duskcap', 1, 3, 30]] },
  { name: 'Verdant drake', lvl: 88, hp: 130, hit: 18, att: 90, def: 84, aggro: 1, resp: 75, model: { kind: 'drake', c1: '#3f7f3a', c2: '#22521f', sc: 1.8 },
    drop: [['Drake bones', 1, 1, 100], ['Wyrm scale', 2, 6, 80], ['Coins', 600, 2400, 95], ['Nature rune', 8, 25, 40], ['Uncut diamond', 1, 1, 8]] },
  { name: 'Ice troll', lvl: 63, hp: 80, hit: 13, att: 62, def: 58, aggro: 1, resp: 50, model: { kind: 'humanoid', c1: '#a8c4d6', c2: '#4a6a7a', sc: 1.55, weap: 'Verdite battleaxe' },
    drop: [['Big bones', 1, 1, 100], ['Coins', 200, 900, 95], ['Frostvine', 1, 2, 25], ['Coal', 2, 6, 40]] },
  { name: 'Kragmar ogre', lvl: 49, hp: 66, hit: 11, att: 48, def: 44, aggro: 1, resp: 42, model: { kind: 'humanoid', c1: '#9a8a5a', c2: '#5a4a2a', sc: 1.7, weap: 'Steel greatsword' },
    drop: [['Big bones', 1, 1, 100], ['Coins', 120, 540, 95], ['Uncut emerald', 1, 1, 9]] },
  /* bosses */
  { name: 'Grothak the Goblin King', lvl: 47, hp: 120, hit: 12, att: 50, def: 44, aggro: 1, resp: 180, boss: 1,
    model: { kind: 'humanoid', c1: '#4f8a2a', c2: '#8a6a1a', sc: 1.5, weap: 'Steel greatsword' },
    drop: [['Crown of Grothak', 1, 1, 100], ['Coins', 500, 1500, 100], ['Kaldrite scimitar', 1, 1, 30]] },
  { name: 'The Drowned Captain', lvl: 62, hp: 160, hit: 14, att: 64, def: 58, aggro: 1, resp: 200, boss: 1,
    model: { kind: 'humanoid', c1: '#6a8a8a', c2: '#2a3a4a', sc: 1.35, weap: 'Verdite scimitar' },
    drop: [['Drowned crown', 1, 1, 100], ['Coins', 900, 2600, 100], ['Uncut diamond', 1, 2, 40]] },
  { name: 'Mother of Mires', lvl: 79, hp: 210, hit: 17, att: 82, def: 72, aggro: 1, resp: 240, boss: 1,
    model: { kind: 'spider', c1: '#4a5f3a', c2: '#7a2a3a', sc: 1.9 },
    drop: [['Bog-witch\'s tooth', 1, 1, 100], ['Coins', 1200, 3600, 100], ['Spider silk', 10, 30, 80], ['Amulet of the Vale', 1, 1, 12]] },
  { name: 'Warden of Ash', lvl: 104, hp: 320, hit: 22, att: 112, def: 104, aggro: 1, resp: 300, boss: 1,
    model: { kind: 'golem', c1: '#5a3428', c2: '#c4562a', sc: 2.1 },
    drop: [['Ashen sigil', 1, 1, 100], ['Coins', 2500, 7000, 100], ['Ash Warden cape', 1, 1, 25], ['Aetherium greatsword', 1, 1, 8]] }
];
MONSTERS.forEach(m => npc({
  key: m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: m.name, kind: 'monster',
  lvl: m.lvl, hp: m.hp, hit: m.hit, att: m.att, def: m.def, aggro: m.aggro, resp: m.resp,
  boss: m.boss || 0, model: m.model, drops: drops(m.drop)
}));

/* --- friendly NPCs, shops, dialogue ------------------------------------ */
function shop(id, name, stock, buyMul, sellMul) {
  return { id: id, name: name, stock: stock.map(s => ({ item: ID(s[0]), qty: s[1], restock: s[1] })), buyMul: buyMul || 1.0, sellMul: sellMul || 0.45 };
}
const shops = [];
function mkShop(o) { shops.push(o); return o.id; }

mkShop(shop('oakheart_general', 'Oakheart General Store', [
  ['Tinderbox', 20], ['Hammer', 15], ['Chisel', 10], ['Knife', 15], ['Needle', 20], ['Thread', 200],
  ['Pot', 25], ['Bucket', 25], ['Jug', 20], ['Rope', 10], ['Spade', 10], ['Vial', 40], ['Candle', 20]
]));
mkShop(shop('oakheart_axes', 'Fellstock Woodcutters', [
  ['Bronze hatchet', 10], ['Iron hatchet', 8], ['Steel hatchet', 5], ['Verdite hatchet', 2],
  ['Small fishing net', 10], ['Fishing rod', 10], ['Fly fishing rod', 6], ['Lobster pot', 5], ['Harpoon', 4], ['Feather', 1000]
]));
mkShop(shop('oakheart_food', 'The Amber Hearth Kitchen', [
  ['Bread', 30], ['Cooked chicken', 20], ['Cooked beef', 20], ['Stew', 10], ['Beer', 40], ['Meat pie', 8]
]));
mkShop(shop('aldermere_arms', 'Aldermere Armoury', [
  ['Bronze sword', 10], ['Iron sword', 10], ['Steel sword', 6], ['Bronze scimitar', 8], ['Iron scimitar', 8],
  ['Steel scimitar', 5], ['Bronze longsword', 6], ['Iron longsword', 5], ['Steel longsword', 4],
  ['Bronze kiteshield', 8], ['Iron kiteshield', 6], ['Steel kiteshield', 4], ['Bronze helm', 8], ['Iron helm', 6], ['Steel helm', 4]
]));
mkShop(shop('aldermere_plate', 'Coldiron Platemail', [
  ['Bronze platebody', 6], ['Iron platebody', 5], ['Steel platebody', 4], ['Verdite platebody', 2],
  ['Bronze platelegs', 6], ['Iron platelegs', 5], ['Steel platelegs', 4], ['Verdite platelegs', 2],
  ['Bronze gauntlets', 10], ['Iron gauntlets', 8], ['Steel gauntlets', 6], ['Bronze boots', 10], ['Iron boots', 8], ['Steel boots', 6]
]));
mkShop(shop('aldermere_magic', 'The Kindled Sigil', [
  ['Air rune', 3000], ['Water rune', 3000], ['Earth rune', 3000], ['Fire rune', 3000], ['Mind rune', 2000],
  ['Body rune', 1500], ['Chaos rune', 300], ['Cosmic rune', 250], ['Nature rune', 150], ['Law rune', 100],
  ['Wizard staff', 10], ['Wizard hat', 8], ['Wizard robe top', 8], ['Wizard robe skirt', 8], ['Air staff', 3], ['Fire staff', 3]
]));
mkShop(shop('aldermere_range', 'The Long Shot', [
  ['Shortbow', 12], ['Longbow', 10], ['Oak shortbow', 8], ['Oak longbow', 6], ['Willow shortbow', 4],
  ['Bronze arrow', 2000], ['Iron arrow', 1500], ['Steel arrow', 800], ['Verdite arrow', 300],
  ['Leather body', 10], ['Leather chaps', 10], ['Leather cowl', 10], ['Leather gloves', 15], ['Leather boots', 15], ['Bow string', 200]
]));
mkShop(shop('aldermere_gems', 'Facet & Filigree', [
  ['Gold ring', 8], ['Gold amulet', 6], ['Sapphire ring', 4], ['Sapphire amulet', 3], ['Emerald ring', 2],
  ['Chisel', 20], ['Glassblowing pipe', 10], ['Ball of wool', 100], ['Molten glass', 30]
]));
mkShop(shop('dunhollow_mining', 'Dunhollow Pick & Pail', [
  ['Bronze pickaxe', 12], ['Iron pickaxe', 10], ['Steel pickaxe', 8], ['Verdite pickaxe', 4], ['Kaldrite pickaxe', 2],
  ['Hammer', 25], ['Bucket', 30], ['Coal', 100], ['Iron ore', 60], ['Tin ore', 80], ['Copper ore', 80]
]));
mkShop(shop('saltbrook_fish', 'Saltbrook Fishmonger', [
  ['Raw shrimp', 60], ['Raw sardine', 50], ['Raw herring', 40], ['Raw trout', 30], ['Raw salmon', 20],
  ['Raw lobster', 10], ['Small fishing net', 15], ['Harpoon', 8], ['Lobster pot', 10]
]));
mkShop(shop('mirefen_herbs', 'The Crooked Mortar', [
  ['Vial', 100], ['Vial of water', 60], ['Mortar and pestle', 10], ['Newt eye', 200], ['Bloodroot', 120],
  ['Ashen dust', 150], ['Crushed shell', 150], ['Grimy marshleaf', 30], ['Grimy bitterroot', 20], ['Antipoison', 10]
]));
mkShop(shop('farm_seeds', 'Greenfurrow Seeds', [
  ['Potato seed', 200], ['Onion seed', 160], ['Cabbage seed', 140], ['Wheat seed', 120], ['Tomato seed', 80],
  ['Sweetcorn seed', 40], ['Strawberry seed', 15], ['Seed dibber', 20], ['Rake', 20], ['Watering can', 20], ['Spade', 20]
]));

/* dialogue helper: nodes {id, text, opts:[{t:label, go:nodeId|null, act:...}]} */
function dlg(nodes) { return nodes; }

const FRIENDLY = [
  { key: 'elder_maren', name: 'Elder Maren', role: 'Village Elder', x: 160, z: 262, model: { c1: '#e8c9a8', c2: '#6a4a8a', sc: 1.0, hair: '#d8d4cc' },
    dialogue: dlg([
      { id: 0, text: "Welcome to Oakheart, traveller. You have the look of someone who's walked a long road.", opts: [
        { t: 'Where am I?', go: 1 }, { t: 'Do you have work for me?', quest: 'welcome' }, { t: 'Nothing, thanks.', go: null }] },
      { id: 1, text: "Oakheart Vale. Farms to the east, forest north, the river cuts us in two. Aldermere lies up the northeast road.", opts: [
        { t: 'Thank you.', go: null }] }
    ]) },
  { key: 'banker_orwen', name: 'Banker Orwen', role: 'Banker', x: 168, z: 258, bank: 1, model: { c1: '#e0b892', c2: '#2f3a5a', sc: 1.0, hair: '#3a3028' },
    dialogue: dlg([{ id: 0, text: "Good day. Would you like to access your account?", opts: [{ t: 'Yes please.', act: 'bank' }, { t: 'No thank you.', go: null }] }]) },
  { key: 'banker_hild', name: 'Banker Hild', role: 'Banker', x: 250, z: 182, bank: 1, model: { c1: '#d8a878', c2: '#2f3a5a', sc: 0.98, hair: '#6a4a2a' },
    dialogue: dlg([{ id: 0, text: "Aldermere Central Bank. Your valuables are safe with us.", opts: [{ t: 'Open my bank.', act: 'bank' }, { t: 'Later.', go: null }] }]) },
  { key: 'banker_dorn', name: 'Banker Dorn', role: 'Banker', x: 140, z: 318, bank: 1, model: { c1: '#c99a6a', c2: '#2f3a5a', sc: 0.95, hair: '#2a2420' },
    dialogue: dlg([{ id: 0, text: "Saltbrook branch. Salt gets everywhere, but your coins stay dry.", opts: [{ t: 'Open my bank.', act: 'bank' }, { t: 'Later.', go: null }] }]) },
  { key: 'banker_brack', name: 'Banker Brack', role: 'Banker', x: 200, z: 58, bank: 1, model: { c1: '#d0a070', c2: '#3a3a5a', sc: 0.8, hair: '#8a4a2a', beard: '#8a4a2a' },
    dialogue: dlg([{ id: 0, text: "Deep vaults, deeper interest rates. What'll it be?", opts: [{ t: 'Open my bank.', act: 'bank' }, { t: 'Nothing.', go: null }] }]) },
  { key: 'shopkeep_bess', name: 'Bess Turnwell', role: 'Shopkeeper', x: 154, z: 272, shop: 'oakheart_general', model: { c1: '#e8c9a8', c2: '#7a5a3a', sc: 0.95, hair: '#b07a3c' },
    dialogue: dlg([{ id: 0, text: "Rope, pots, tinderboxes - everything a hero forgets to pack.", opts: [{ t: 'Let me see your stock.', act: 'shop' }, { t: 'Just browsing.', go: null }] }]) },
  { key: 'fellstock', name: 'Harl Fellstock', role: 'Woodcutter', x: 148, z: 276, shop: 'oakheart_axes', model: { c1: '#c99a6a', c2: '#4a5f2a', sc: 1.05, hair: '#5a4a2a', beard: '#5a4a2a' },
    dialogue: dlg([
      { id: 0, text: "Axes, nets, rods. If it takes something out of the ground or the water, I sell it.", opts: [
        { t: 'Show me your wares.', act: 'shop' }, { t: 'Any advice on woodcutting?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Start on plain trees. Oaks at fifteen, willows at thirty. A better hatchet cuts faster - don't swing bronze at an ironbark.", opts: [{ t: 'Thanks.', go: null }] }
    ]) },
  { key: 'innkeep_pell', name: 'Pell Ashcroft', role: 'Innkeeper', x: 172, z: 276, shop: 'oakheart_food', model: { c1: '#e0b892', c2: '#6a3a2a', sc: 1.0, hair: '#3a2a20' },
    dialogue: dlg([
      { id: 0, text: "Amber Hearth Inn. Hot food, cold beer, and a rat problem I'd rather not discuss.", opts: [
        { t: 'Buy food.', act: 'shop' }, { t: 'Tell me about the rats.', quest: 'cellar' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'smith_dura', name: 'Dura Coldiron', role: 'Blacksmith', x: 166, z: 280, model: { c1: '#c08a5a', c2: '#3a3028', sc: 1.05, hair: '#2a2420' },
    dialogue: dlg([
      { id: 0, text: "Furnace is hot, anvil's free. Ore goes in, something useful comes out - usually.", opts: [
        { t: 'Teach me smithing.', go: 1 }, { t: 'Got any work?', quest: 'apprentice' }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Smelt ore at a furnace into bars. Take bars to an anvil with a hammer and you can beat them into gear. Copper and tin make bronze.", opts: [{ t: 'Understood.', go: null }] }
    ]) },
  { key: 'guard_tomas', name: 'Guard Tomas', role: 'Guard', x: 170, z: 263, model: { c1: '#d8a878', c2: '#5a5f6a', sc: 1.05, weap: 'Iron longsword' },
    dialogue: dlg([
      { id: 0, text: "Move along - or don't. Quiet day either way.", opts: [{ t: 'Any trouble about?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Goblins in the western scrub, spiders in the deep wood. Don't wander east past the Blightfort unless you're tired of living.", opts: [{ t: 'Noted.', go: null }] }
    ]) },
  { key: 'farmer_oswin', name: 'Farmer Oswin', role: 'Farmer', x: 204, z: 282, shop: 'farm_seeds', model: { c1: '#d8b088', c2: '#6a5a2a', sc: 1.0, hair: '#8a7a4a' },
    dialogue: dlg([
      { id: 0, text: "Seeds, soil, patience. That's the whole trade.", opts: [
        { t: 'Buy seeds.', act: 'shop' }, { t: 'Can you teach me farming?', quest: 'seeds' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'fisher_nell', name: 'Nell Quay', role: 'Fisherwoman', x: 138, z: 326, shop: 'saltbrook_fish', model: { c1: '#c99a6a', c2: '#2a5a6a', sc: 0.98, hair: '#5a4a3a' },
    dialogue: dlg([
      { id: 0, text: "Tide's good today. Nets on the left, rods on the right.", opts: [
        { t: 'Show me your stock.', act: 'shop' }, { t: 'Heard anything strange?', quest: 'crate' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'captain_rell', name: 'Captain Rell', role: 'Harbourmaster', x: 146, z: 330, model: { c1: '#b88a5a', c2: '#3a4a6a', sc: 1.05, hair: '#4a4038', beard: '#4a4038' },
    dialogue: dlg([
      { id: 0, text: "Harbourmaster Rell. I keep the ledger and the peace, mostly in that order.", opts: [
        { t: 'Tell me about the wreck.', quest: 'crown' }, { t: 'Where do the islands lie?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "South across the shallows. Three of them. Pirates use the big one - the Drowned Captain's crew, they call themselves.", opts: [{ t: 'Thanks.', go: null }] }
    ]) },
  { key: 'lorekeeper_venn', name: 'Lorekeeper Venn', role: 'Scholar', x: 246, z: 196, model: { c1: '#e0c0a0', c2: '#3a2a5a', sc: 1.0, hair: '#d8d4cc' },
    dialogue: dlg([
      { id: 0, text: "Aldermere's archive. Every debt, every deed, every lie written down twice.", opts: [
        { t: 'I heard pages went missing.', quest: 'ledger' }, { t: 'Tell me of the Warden.', quest: 'ashes' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'armourer_kest', name: 'Kest Coldiron', role: 'Armourer', x: 258, z: 186, shop: 'aldermere_plate', model: { c1: '#c08a5a', c2: '#4a4a52', sc: 1.1, beard: '#3a3028' },
    dialogue: dlg([{ id: 0, text: "Plate for those who intend to come back.", opts: [{ t: 'Show me your stock.', act: 'shop' }, { t: 'Goodbye.', go: null }] }]) },
  { key: 'weapon_sarn', name: 'Sarn the Edge', role: 'Weaponsmith', x: 256, z: 194, shop: 'aldermere_arms', model: { c1: '#b88a5a', c2: '#5a2a2a', sc: 1.05, hair: '#2a2420' },
    dialogue: dlg([{ id: 0, text: "Sharp things. Reasonably priced.", opts: [{ t: 'Show me your stock.', act: 'shop' }, { t: 'Goodbye.', go: null }] }]) },
  { key: 'mage_ilvara', name: 'Ilvara Sootveil', role: 'Mage', x: 240, z: 178, shop: 'aldermere_magic', model: { c1: '#e8c9a8', c2: '#4a3f8c', sc: 0.98, hair: '#2a2a3a' },
    dialogue: dlg([
      { id: 0, text: "Runes, robes, and unsolicited advice.", opts: [
        { t: 'Show me your stock.', act: 'shop' }, { t: 'How does magic work here?', go: 1 },
        { t: 'I want to learn runecrafting.', quest: 'circle' }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Carry the runes a spell demands and cast from the Magic tab. Elemental staves supply their own element - a fire staff means never buying fire runes again.", opts: [{ t: 'Thank you.', go: null }] }
    ]) },
  { key: 'fletcher_arn', name: 'Arn Yewbend', role: 'Fletcher', x: 262, z: 200, shop: 'aldermere_range', model: { c1: '#d8b088', c2: '#3a5a2a', sc: 1.0, hair: '#6a5a3a' },
    dialogue: dlg([
      { id: 0, text: "Bows, strings, arrows. I can teach the trade if you've a knife and patience.", opts: [
        { t: 'Show me your stock.', act: 'shop' }, { t: 'Teach me fletching.', quest: 'fletching' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'jeweller_pia', name: 'Pia Facet', role: 'Jeweller', x: 244, z: 204, shop: 'aldermere_gems', model: { c1: '#e0b892', c2: '#6a3a5a', sc: 0.95, hair: '#c4a04a' },
    dialogue: dlg([{ id: 0, text: "Cut stones, set rings, no questions about where the rough came from.", opts: [{ t: 'Show me your stock.', act: 'shop' }, { t: 'Goodbye.', go: null }] }]) },
  { key: 'priest_aldo', name: 'Brother Aldo', role: 'Priest', x: 96, z: 266, model: { c1: '#e0c0a0', c2: '#e8e2d0', sc: 1.0, hair: '#c8c4bc' },
    dialogue: dlg([
      { id: 0, text: "Peace of the Vale to you. Bury bones here and the earth remembers the kindness.", opts: [
        { t: 'Tell me about Prayer.', go: 1 }, { t: 'I seek a pilgrim\'s task.', quest: 'pilgrim' }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Bury bones for prayer experience. Prayers drain while active - recharge at any altar.", opts: [{ t: 'Thank you, brother.', go: null }] }
    ]) },
  { key: 'slayer_vex', name: 'Vex Harrowgate', role: 'Slayer Master', x: 236, z: 206, slayer: 1, model: { c1: '#a87a5a', c2: '#3a3028', sc: 1.05, hair: '#2a2420', weap: 'Steel battleaxe' },
    dialogue: dlg([
      { id: 0, text: "You want something to kill, and I want it killed. Convenient.", opts: [
        { t: 'Give me an assignment.', act: 'slayer_assign' }, { t: 'How am I doing?', act: 'slayer_check' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'thief_kito', name: 'Kito Sly', role: 'Thief', x: 232, z: 198, model: { c1: '#c99a6a', c2: '#2a2a2a', sc: 0.95, hair: '#1a1a1a' },
    dialogue: dlg([
      { id: 0, text: "Keep your voice down. And your hand on your purse.", opts: [
        { t: 'Teach me thieving.', quest: 'thief' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'dwarf_borin', name: 'Borin Deepvein', role: 'Mining Foreman', x: 196, z: 66, shop: 'dunhollow_mining', model: { c1: '#d0a070', c2: '#6a4a2a', sc: 0.78, beard: '#a85a2a', hair: '#a85a2a' },
    dialogue: dlg([
      { id: 0, text: "Dunhollow. Mind your head and your manners.", opts: [
        { t: 'Show me your stock.', act: 'shop' }, { t: 'Need a hand in the mine?', quest: 'descent' },
        { t: 'What lies deeper?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Aetherium, if you believe the old songs. Ice trolls, if you believe me.", opts: [{ t: 'Charming.', go: null }] }
    ]) },
  { key: 'dwarf_hega', name: 'Hega Frostforge', role: 'Master Smith', x: 206, z: 58, model: { c1: '#d0a070', c2: '#5a3a2a', sc: 0.8, hair: '#c8c4bc', beard: '#c8c4bc' },
    dialogue: dlg([
      { id: 0, text: "The great forge has been cold for eleven years. Don't ask.", opts: [
        { t: "I'm asking.", quest: 'forge' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'witch_morra', name: 'Morra Blackfen', role: 'Herbalist', x: 60, z: 172, shop: 'mirefen_herbs', model: { c1: '#c8b8a8', c2: '#3a4a3a', sc: 0.98, hair: '#2a2a2a' },
    dialogue: dlg([
      { id: 0, text: "Mind the bog. It keeps what it takes.", opts: [
        { t: 'Show me your stock.', act: 'shop' }, { t: 'Teach me herblore.', quest: 'alchemist' },
        { t: 'What haunts these ruins?', quest: 'whispers' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'watcher_sil', name: 'Sil the Watcher', role: 'Scout', x: 300, z: 200, model: { c1: '#b88a5a', c2: '#3a4a3a', sc: 1.0, hair: '#4a3a2a', weap: 'Oak longbow' },
    dialogue: dlg([
      { id: 0, text: "Past this ridge the land turns. Nothing out there wants to talk.", opts: [
        { t: 'What is the tower for?', quest: 'watcher' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'hunter_jaro', name: 'Jaro Snare', role: 'Hunter', x: 150, z: 212, model: { c1: '#a87a5a', c2: '#4a5f2a', sc: 1.0, hair: '#3a3028' },
    dialogue: dlg([
      { id: 0, text: "Traps take patience. Everything worth catching does.", opts: [
        { t: 'How do I hunt?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Set a bird snare at a hunting ground and wait. Check it before something else does.", opts: [{ t: 'Right.', go: null }] }
    ]) },
  { key: 'miner_gwen', name: 'Gwen Tally', role: 'Miner', x: 152, z: 204, model: { c1: '#d8b088', c2: '#5a4a3a', sc: 0.98, hair: '#6a4a2a' },
    dialogue: dlg([
      { id: 0, text: "Copper and tin here. Iron further in. Bring a pickaxe you can actually lift.", opts: [
        { t: 'Any work?', quest: 'tally' }, { t: 'Goodbye.', go: null }] }
    ]) },
  { key: 'agility_nim', name: 'Nim Featherstep', role: 'Agility Trainer', x: 218, z: 244, model: { c1: '#e0b892', c2: '#5a3a6a', sc: 0.95, hair: '#3a2a2a' },
    dialogue: dlg([
      { id: 0, text: "The course starts at the log and ends at the wall. Try not to land on the rocks.", opts: [
        { t: 'Tell me about agility.', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Every obstacle gives experience. Finish a full lap for a bonus.", opts: [{ t: 'Understood.', go: null }] }
    ]) },
  { key: 'villager_tam', name: 'Tam', role: 'Villager', x: 162, z: 274, wander: 6, model: { c1: '#d8b088', c2: '#6a5a4a', sc: 0.98, hair: '#4a3a2a' },
    dialogue: dlg([{ id: 0, text: "Lovely weather. Ignore the screaming from the east, it's mostly wind.", opts: [{ t: 'Right...', go: null }] }]) },
  { key: 'villager_rosa', name: 'Rosa', role: 'Villager', x: 156, z: 264, wander: 6, model: { c1: '#e8c9a8', c2: '#7a4a5a', sc: 0.95, hair: '#8a5a2a' },
    dialogue: dlg([{ id: 0, text: "My cousin went to the Blightlands to make his fortune. We use his room for storage now.", opts: [{ t: 'Sorry to hear it.', go: null }] }]) },
  { key: 'villager_hob', name: 'Old Hob', role: 'Villager', x: 167, z: 273, wander: 4, model: { c1: '#d0a880', c2: '#4a4238', sc: 0.95, hair: '#d8d4cc', beard: '#d8d4cc' },
    dialogue: dlg([
      { id: 0, text: "Eh? Speak up. I've been to every corner of this realm, you know.", opts: [
        { t: 'Every corner?', quest: 'longroad' }, { t: 'Never mind.', go: null }] }
    ]) },
  { key: 'traveller_esk', name: 'Esk the Traveller', role: 'Wanderer', x: 224, z: 228, wander: 10, model: { c1: '#b88a5a', c2: '#5a4a6a', sc: 1.0, hair: '#2a2420' },
    dialogue: dlg([{ id: 0, text: "Roads are safer than they look. The shortcuts aren't.", opts: [{ t: 'Safe travels.', go: null }] }]) },
  { key: 'guard_mera', name: 'Guard Mera', role: 'City Guard', x: 254, z: 176, model: { c1: '#c99a6a', c2: '#5a5f6a', sc: 1.0, weap: 'Steel longsword' },
    dialogue: dlg([{ id: 0, text: "Aldermere keeps the peace. Loudly, if it has to.", opts: [{ t: 'Understood.', go: null }] }]) },
  { key: 'guard_owan', name: 'Guard Owan', role: 'City Guard', x: 264, z: 190, model: { c1: '#b88a5a', c2: '#5a5f6a', sc: 1.05, weap: 'Steel longsword' },
    dialogue: dlg([{ id: 0, text: "The castle's open to visitors. The vault isn't.", opts: [{ t: 'Fair enough.', go: null }] }]) },
  { key: 'cook_mabel', name: 'Cook Mabel', role: 'Cook', x: 252, z: 200, model: { c1: '#e0b892', c2: '#e8e2d0', sc: 0.98, hair: '#8a6a4a' },
    dialogue: dlg([
      { id: 0, text: "Range is over there. Burn it and I'll say nothing. I'll think plenty.", opts: [
        { t: 'Any cooking tips?', go: 1 }, { t: 'Goodbye.', go: null }] },
      { id: 1, text: "Higher cooking level, less burning. A range burns less than an open fire.", opts: [{ t: 'Thanks.', go: null }] }
    ]) }
];
FRIENDLY.forEach(f => npc(Object.assign({ kind: 'npc', lvl: 0, hp: 10, wander: f.wander || 0 }, f)));

/* ==================================================================== */
/*  QUESTS                                                               */
/* ==================================================================== */
/* stage types: talk | kill | collect | goto | riddle | skill */
const quests = [
  { id: 'welcome', name: 'A Warm Welcome', diff: 'Novice', qp: 1, start: 'elder_maren',
    req: {}, desc: 'Elder Maren wants to see whether a newcomer can feed themselves.',
    stages: [
      { t: 'talk', npc: 'elder_maren', j: 'Elder Maren asked me to prove I can live off the Vale. I should chop a log, light it, and cook something on it.' },
      { t: 'collect', item: 'Logs', n: 1, j: 'I need to chop some logs from a tree near the village.' },
      { t: 'collect', item: 'Raw shrimp', n: 1, j: 'Now I need to catch a shrimp at the river or coast with a small fishing net.' },
      { t: 'collect', item: 'Shrimp', n: 1, j: 'I should cook the shrimp on a fire or range.' },
      { t: 'talk', npc: 'elder_maren', j: 'Time to show Elder Maren what I have managed.' }
    ],
    rew: { xp: { woodcutting: 120, fishing: 120, cooking: 120, firemaking: 80 }, items: [['Coins', 200], ['Bronze hatchet', 1], ['Small fishing net', 1], ['Tinderbox', 1]] } },

  { id: 'cellar', name: 'Rats in the Cellar', diff: 'Novice', qp: 1, start: 'innkeep_pell',
    req: {}, desc: 'Something is eating the Amber Hearth\'s winter stores.',
    stages: [
      { t: 'talk', npc: 'innkeep_pell', j: 'Pell Ashcroft says giant rats have taken the inn cellar. He gave me the key.' },
      { t: 'kill', npc: 'giant_rat', n: 6, j: 'I need to clear out six giant rats.' },
      { t: 'talk', npc: 'innkeep_pell', j: 'The cellar is clear. I should tell Pell.' }
    ],
    rew: { xp: { attack: 200, hitpoints: 150 }, items: [['Coins', 350], ['Stew', 5]] } },

  { id: 'apprentice', name: 'The Blacksmith\'s Apprentice', diff: 'Novice', qp: 1, start: 'smith_dura',
    req: { skills: { mining: 1 } }, desc: 'Dura Coldiron needs stock and has no patience for excuses.',
    stages: [
      { t: 'talk', npc: 'smith_dura', j: 'Dura wants five bronze daggers made from scratch.' },
      { t: 'collect', item: 'Bronze dagger', n: 5, j: 'I need to smelt bronze bars from copper and tin, then smith five bronze daggers.' },
      { t: 'talk', npc: 'smith_dura', j: 'I should bring the daggers to Dura.' }
    ],
    rew: { xp: { smithing: 450, mining: 250 }, items: [['Coins', 400], ['Hammer', 1], ['Steel bar', 3]] } },

  { id: 'missing', name: 'The Missing Fisherman', diff: 'Novice', qp: 1, start: 'villager_rosa',
    req: {}, desc: 'A fisherman walked out at dawn and never came back.',
    stages: [
      { t: 'talk', npc: 'villager_rosa', j: 'Rosa says a fisherman is missing somewhere along the southern coast.' },
      { t: 'goto', x: 118, z: 312, r: 7, j: 'I should search the rocky coast west of Saltbrook.' },
      { t: 'collect', item: 'Fisherman\'s pipe', n: 1, j: 'I found his pipe on the rocks. I should pick it up.' },
      { t: 'talk', npc: 'fisher_nell', j: 'Nell Quay in Saltbrook should see this.' }
    ],
    rew: { xp: { fishing: 300, hitpoints: 100 }, items: [['Coins', 300], ['Fishing rod', 1]] } },

  { id: 'goblins', name: 'Banner of the Broken Tooth', diff: 'Novice', qp: 2, start: 'guard_tomas',
    req: {}, desc: 'The goblins west of Oakheart have grown bold enough to plant a flag.',
    stages: [
      { t: 'talk', npc: 'guard_tomas', j: 'Guard Tomas wants the goblin war banner taken down.' },
      { t: 'kill', npc: 'goblin', n: 8, j: 'I should thin out the goblin camp - eight of them.' },
      { t: 'collect', item: 'Goblin war banner', n: 1, j: 'The banner is somewhere in the camp.' },
      { t: 'talk', npc: 'guard_tomas', j: 'I should return the banner to Tomas.' }
    ],
    rew: { xp: { attack: 500, strength: 500, defence: 300 }, items: [['Coins', 600], ['Iron scimitar', 1]] } },

  { id: 'seeds', name: 'Seeds of Doubt', diff: 'Novice', qp: 1, start: 'farmer_oswin',
    req: {}, desc: 'Oswin insists anyone can farm. Prove him right.',
    stages: [
      { t: 'talk', npc: 'farmer_oswin', j: 'Oswin gave me potato seeds and a dibber. I should plant them in his allotment.' },
      { t: 'collect', item: 'Potato', n: 3, j: 'I need to grow and harvest three potatoes.' },
      { t: 'talk', npc: 'farmer_oswin', j: 'I should bring the potatoes back to Oswin.' }
    ],
    rew: { xp: { farming: 400 }, items: [['Coins', 250], ['Seed dibber', 1], ['Rake', 1], ['Onion seed', 5]] } },

  { id: 'crate', name: 'The Barnacled Crate', diff: 'Intermediate', qp: 2, start: 'fisher_nell',
    req: { skills: { fishing: 15 } }, desc: 'Something heavy keeps fouling the Saltbrook nets.',
    stages: [
      { t: 'talk', npc: 'fisher_nell', j: 'Nell says a crate keeps tangling the nets off the point.' },
      { t: 'goto', x: 152, z: 336, r: 6, j: 'I should search the water off the southern point.' },
      { t: 'collect', item: 'Barnacled crate', n: 1, j: 'I need to haul up the crate.' },
      { t: 'talk', npc: 'captain_rell', j: 'Captain Rell should see what was inside.' }
    ],
    rew: { xp: { fishing: 900, strength: 300 }, items: [['Coins', 900], ['Uncut sapphire', 2]] } },

  { id: 'ledger', name: 'The Aldermere Ledger', diff: 'Intermediate', qp: 2, start: 'lorekeeper_venn',
    req: {}, desc: 'Three pages are missing from the city record, and the thief left a riddle.',
    stages: [
      { t: 'talk', npc: 'lorekeeper_venn', j: 'Venn is missing three ledger pages. They were scattered across the realm.' },
      { t: 'collect', item: 'Ledger page A', n: 1, j: 'One page is said to be in the Oakheart inn.' },
      { t: 'collect', item: 'Ledger page B', n: 1, j: 'A second page is in the Mirefen ruins.' },
      { t: 'collect', item: 'Ledger page C', n: 1, j: 'The last page is somewhere in Dunhollow.' },
      { t: 'riddle', q: 'The thief left a note: "I am kept full to be useful, emptied to be moved, and buried to be safe. What am I?"',
        a: ['bank', 'a bank', 'the bank', 'vault'], j: 'Venn read the thief\'s riddle aloud. I need to answer it.' },
      { t: 'talk', npc: 'lorekeeper_venn', j: 'I should tell Venn what I worked out.' }
    ],
    rew: { xp: { thieving: 700, magic: 400 }, items: [['Coins', 1200], ['Aldermere signet', 1]] } },

  { id: 'thief', name: 'A Light Touch', diff: 'Intermediate', qp: 2, start: 'thief_kito',
    req: { skills: { thieving: 5 } }, desc: 'Kito Sly measures trust in stolen purses.',
    stages: [
      { t: 'talk', npc: 'thief_kito', j: 'Kito wants proof I can pick a pocket without being caught.' },
      { t: 'collect', item: 'Stolen purse', n: 3, j: 'I need three purses lifted from Aldermere citizens.' },
      { t: 'talk', npc: 'thief_kito', j: 'Time to hand the purses over.' }
    ],
    rew: { xp: { thieving: 1400, agility: 400 }, items: [['Coins', 800], ['Lockpick', 1]] } },

  { id: 'alchemist', name: 'The Alchemist\'s Debt', diff: 'Intermediate', qp: 2, start: 'witch_morra',
    req: { skills: { herblore: 1 } }, desc: 'Morra Blackfen pays her debts in knowledge, eventually.',
    stages: [
      { t: 'talk', npc: 'witch_morra', j: 'Morra will teach herblore if I clean and brew for her.' },
      { t: 'collect', item: 'Marshleaf', n: 4, j: 'I need four clean marshleaf.' },
      { t: 'collect', item: 'Attack potion', n: 2, j: 'Now I must brew two attack potions.' },
      { t: 'talk', npc: 'witch_morra', j: 'I should deliver the potions to Morra.' }
    ],
    rew: { xp: { herblore: 1100 }, items: [['Coins', 700], ['Mortar and pestle', 1], ['Vial of water', 10]] } },

  { id: 'fletching', name: 'Feathers and Patience', diff: 'Novice', qp: 1, start: 'fletcher_arn',
    req: {}, desc: 'Arn Yewbend will trade a pattern for proof of steady hands.',
    stages: [
      { t: 'talk', npc: 'fletcher_arn', j: 'Arn wants a shortbow and thirty arrows, all my own work.' },
      { t: 'collect', item: 'Shortbow', n: 1, j: 'I need to fletch a shortbow from logs and string it.' },
      { t: 'collect', item: 'Bronze arrow', n: 30, j: 'I need thirty bronze arrows.' },
      { t: 'talk', npc: 'fletcher_arn', j: 'I should show Arn my work.' }
    ],
    rew: { xp: { fletching: 800, ranged: 400 }, items: [['Coins', 400], ['Oak longbow', 1], ['Iron arrow', 100]] } },

  { id: 'tally', name: 'The Miner\'s Tally', diff: 'Novice', qp: 1, start: 'miner_gwen',
    req: {}, desc: 'Gwen Tally lost count, and the foreman is coming.',
    stages: [
      { t: 'talk', npc: 'miner_gwen', j: 'Gwen needs ore to balance her tally before inspection.' },
      { t: 'collect', item: 'Copper ore', n: 8, j: 'I need eight copper ore.' },
      { t: 'collect', item: 'Tin ore', n: 8, j: 'And eight tin ore.' },
      { t: 'talk', npc: 'miner_gwen', j: 'I should hand the ore to Gwen.' }
    ],
    rew: { xp: { mining: 600, smithing: 200 }, items: [['Coins', 350], ['Iron pickaxe', 1]] } },

  { id: 'descent', name: 'Dunhollow Descent', diff: 'Intermediate', qp: 2, start: 'dwarf_borin',
    req: { skills: { mining: 20 } }, desc: 'The lower seam collapsed and something came up through the gap.',
    stages: [
      { t: 'talk', npc: 'dwarf_borin', j: 'Borin needs the lower seam cleared of whatever crawled in.' },
      { t: 'kill', npc: 'cave_crawler', n: 6, j: 'I should kill six cave crawlers in the deep mine.' },
      { t: 'collect', item: 'Coal', n: 10, j: 'Borin also wants ten coal hauled up as proof the seam is workable.' },
      { t: 'talk', npc: 'dwarf_borin', j: 'Time to report to Borin.' }
    ],
    rew: { xp: { mining: 1800, defence: 600 }, items: [['Coins', 1400], ['Steel pickaxe', 1], ['Dwarven charter', 1]] } },

  { id: 'forge', name: 'The Frozen Forge', diff: 'Experienced', qp: 3, start: 'dwarf_hega',
    req: { quests: ['descent'], skills: { smithing: 30 } }, desc: 'Hega Frostforge needs a living ember from the ice.',
    stages: [
      { t: 'talk', npc: 'dwarf_hega', j: 'Hega needs an ember from the ice caves to relight the great forge.' },
      { t: 'kill', npc: 'ice_troll', n: 3, j: 'Ice trolls guard the upper caves. Three should clear a path.' },
      { t: 'collect', item: 'Frostforge ember', n: 1, j: 'I need to recover the Frostforge ember.' },
      { t: 'talk', npc: 'dwarf_hega', j: 'I should bring the ember back to Hega.' }
    ],
    rew: { xp: { smithing: 3200, mining: 1200, strength: 800 }, items: [['Coins', 3000], ['Kaldrite bar', 3]] } },

  { id: 'whispers', name: 'Whispers in Mirefen', diff: 'Experienced', qp: 3, start: 'witch_morra',
    req: { quests: ['alchemist'] }, desc: 'The ruins have started speaking at night, and answering back.',
    stages: [
      { t: 'talk', npc: 'witch_morra', j: 'Morra gave me a lantern and told me to walk the ruins at night.' },
      { t: 'goto', x: 54, z: 190, r: 6, j: 'I should reach the heart of the Mirefen ruins.' },
      { t: 'kill', npc: 'marsh_zombie', n: 10, j: 'The dead rose. I need to put ten of them back down.' },
      { t: 'kill', npc: 'mire_wraith', n: 3, j: 'Three wraiths are holding the ruin. They must go.' },
      { t: 'talk', npc: 'witch_morra', j: 'Morra needs to hear what I found.' }
    ],
    rew: { xp: { prayer: 1600, magic: 1200, defence: 900 }, items: [['Coins', 2400], ['Mirefen lantern', 1], ['Duskcap', 6]] } },

  { id: 'circle', name: 'Runes of the Old Circle', diff: 'Experienced', qp: 3, start: 'mage_ilvara',
    req: { skills: { magic: 20 } }, desc: 'The standing stones north of Oakheart still hum.',
    stages: [
      { t: 'talk', npc: 'mage_ilvara', j: 'Ilvara wants the old stone circle surveyed.' },
      { t: 'goto', x: 134, z: 196, r: 6, j: 'I should find the standing stones northwest of Oakheart.' },
      { t: 'collect', item: 'Old Circle tablet', n: 1, j: 'A tablet lies at the centre of the circle.' },
      { t: 'collect', item: 'Air rune', n: 25, j: 'Ilvara wants twenty-five air runes crafted at the circle.' },
      { t: 'talk', npc: 'mage_ilvara', j: 'I should bring the tablet and runes to Ilvara.' }
    ],
    rew: { xp: { runecraft: 2200, magic: 1400 }, items: [['Coins', 1800], ['Wizard staff', 1], ['Mind rune', 200]] } },

  { id: 'watcher', name: 'The Watcher\'s Tower', diff: 'Experienced', qp: 3, start: 'watcher_sil',
    req: { skills: { agility: 20 } }, desc: 'The lens that watches the Blightlands has gone dark.',
    stages: [
      { t: 'talk', npc: 'watcher_sil', j: 'Sil needs the tower lens recovered. The stair is gone - I will have to climb.' },
      { t: 'goto', x: 306, z: 186, r: 6, j: 'I should reach the ruined watchtower.' },
      { t: 'collect', item: 'Watcher\'s lens', n: 1, j: 'The lens is at the top of the tower.' },
      { t: 'kill', npc: 'blight_hound', n: 6, j: 'Blight hounds have the tower surrounded. Six of them.' },
      { t: 'talk', npc: 'watcher_sil', j: 'I should return the lens to Sil.' }
    ],
    rew: { xp: { agility: 2400, ranged: 1200 }, items: [['Coins', 2200], ['Willow longbow', 1], ['Steel arrow', 300]] } },

  { id: 'pilgrim', name: 'The Pilgrim\'s Token', diff: 'Intermediate', qp: 2, start: 'priest_aldo',
    req: {}, desc: 'Brother Aldo asks for bones returned to the earth and a shrine relit.',
    stages: [
      { t: 'talk', npc: 'priest_aldo', j: 'Aldo asked me to bury bones and relight the roadside shrine.' },
      { t: 'collect', item: 'Bones', n: 15, j: 'I need fifteen bones for the rites.' },
      { t: 'goto', x: 112, z: 252, r: 6, j: 'The roadside shrine lies between Oakheart and Mirefen.' },
      { t: 'talk', npc: 'priest_aldo', j: 'The shrine is lit. I should tell Aldo.' }
    ],
    rew: { xp: { prayer: 1200 }, items: [['Coins', 700], ['Pilgrim\'s token', 1], ['Big bones', 5]] } },

  { id: 'crown', name: 'Crown of the Deep', diff: 'Experienced', qp: 4, start: 'captain_rell',
    req: { quests: ['crate'], skills: { attack: 30 } }, desc: 'The Drowned Captain has been collecting crowns. And crews.',
    stages: [
      { t: 'talk', npc: 'captain_rell', j: 'Rell wants the Drowned Captain dealt with. The pirates hold the southern isle.' },
      { t: 'kill', npc: 'pirate_deckhand', n: 10, j: 'I should clear ten deckhands from the isle.' },
      { t: 'kill', npc: 'the_drowned_captain', n: 1, j: 'Now for the Drowned Captain himself.' },
      { t: 'collect', item: 'Drowned crown', n: 1, j: 'I should take the crown as proof.' },
      { t: 'talk', npc: 'captain_rell', j: 'Rell is waiting at the harbour.' }
    ],
    rew: { xp: { attack: 3000, strength: 3000, hitpoints: 2000 }, items: [['Coins', 5000], ['Verdite scimitar', 1]] } },

  { id: 'goblinking', name: 'The Crown of Grothak', diff: 'Experienced', qp: 4, start: 'guard_tomas',
    req: { quests: ['goblins'], skills: { attack: 25 } }, desc: 'Killing the banner-bearers only made them elect a king.',
    stages: [
      { t: 'talk', npc: 'guard_tomas', j: 'The goblins crowned a king. Tomas wants him gone.' },
      { t: 'kill', npc: 'goblin_brute', n: 8, j: 'His brutes stand between me and the throne - eight of them.' },
      { t: 'kill', npc: 'grothak_the_goblin_king', n: 1, j: 'Time to face Grothak.' },
      { t: 'talk', npc: 'elder_maren', j: 'Elder Maren should hear that the Vale is safe.' }
    ],
    rew: { xp: { attack: 2600, strength: 2600, defence: 1800 }, items: [['Coins', 4000], ['Kaldrite scimitar', 1]] } },

  { id: 'mother', name: 'Mother of Mires', diff: 'Master', qp: 5, start: 'witch_morra',
    req: { quests: ['whispers'], skills: { attack: 40, defence: 40 } }, desc: 'Something under the bog has been laying eggs for a very long time.',
    stages: [
      { t: 'talk', npc: 'witch_morra', j: 'Morra says the whispers came from something beneath the bog.' },
      { t: 'kill', npc: 'bog_lurker', n: 12, j: 'Her brood must be thinned first - twelve lurkers.' },
      { t: 'kill', npc: 'mother_of_mires', n: 1, j: 'Now to face the Mother of Mires.' },
      { t: 'talk', npc: 'witch_morra', j: 'Morra will want the tooth.' }
    ],
    rew: { xp: { attack: 5000, defence: 5000, hitpoints: 3000, herblore: 1500 }, items: [['Coins', 9000], ['Kaldrite platebody', 1]] } },

  { id: 'ashes', name: 'Ashes of the Warden', diff: 'Master', qp: 6, start: 'lorekeeper_venn',
    req: { quests: ['ledger', 'mother'], skills: { attack: 50, defence: 45, hitpoints: 50 } },
    desc: 'The thing that burned the Blightlands is still standing in the middle of them.',
    stages: [
      { t: 'talk', npc: 'lorekeeper_venn', j: 'Venn believes the Warden of Ash can be unmade with its own sigil.' },
      { t: 'kill', npc: 'corrupted_knight', n: 10, j: 'Ten corrupted knights guard the approach.' },
      { t: 'kill', npc: 'blight_shaman', n: 6, j: 'Six shamans maintain the ward around the Warden.' },
      { t: 'goto', x: 336, z: 216, r: 7, j: 'The Warden stands at the heart of the Blightfort.' },
      { t: 'kill', npc: 'warden_of_ash', n: 1, j: 'Now I must destroy the Warden of Ash.' },
      { t: 'talk', npc: 'lorekeeper_venn', j: 'Venn is waiting in the Aldermere archive.' }
    ],
    rew: { xp: { attack: 12000, strength: 12000, defence: 12000, hitpoints: 8000, prayer: 4000 },
      items: [['Coins', 25000], ['Aetherium longsword', 1], ['Amulet of the Vale', 1]] } },

  { id: 'longroad', name: 'The Long Road Home', diff: 'Master', qp: 4, start: 'villager_hob',
    req: { qp: 12 }, desc: 'Old Hob claims to have seen every corner of the realm. Prove you have too.',
    stages: [
      { t: 'talk', npc: 'villager_hob', j: 'Hob wants me to stand in all six regions and bring back his journal.' },
      { t: 'goto', x: 200, z: 62, r: 12, j: 'First: Dunhollow, high in the Kragmar Peaks.' },
      { t: 'goto', x: 62, z: 176, r: 12, j: 'Second: the Mirefen ruins in the western bog.' },
      { t: 'goto', x: 140, z: 322, r: 12, j: 'Third: the harbour at Saltbrook.' },
      { t: 'goto', x: 250, z: 190, r: 14, j: 'Fourth: the city of Aldermere.' },
      { t: 'goto', x: 330, z: 210, r: 12, j: 'Fifth: the Blightfort in the east.' },
      { t: 'collect', item: 'Traveller\'s journal', n: 1, j: 'Hob left his journal somewhere on the road. I should find it.' },
      { t: 'talk', npc: 'villager_hob', j: 'Back to Old Hob in Oakheart.' }
    ],
    rew: { xp: { agility: 4000, hitpoints: 2000, woodcutting: 1500, mining: 1500 },
      items: [['Coins', 6000], ['Gold cape', 1]] } }
];

/* ==================================================================== */
/*  WORLD OBJECTS                                                        */
/* ==================================================================== */
const objects = [];
let objId = 1;
function obj(type, x, z, extra) {
  const o = Object.assign({ i: objId++, t: type, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }, extra || {});
  o.y = Math.round(T.height(o.x, o.z) * 100) / 100;
  objects.push(o);
  return o;
}
function ok(x, z, minH, maxSlope) {
  if (x < 6 || z < 6 || x > T.WORLD - 6 || z > T.WORLD - 6) return false;
  const h = T.height(x, z);
  if (h < (minH === undefined ? 0.6 : minH)) return false;
  const s = Math.max(
    Math.abs(T.height(x + 1.5, z) - h), Math.abs(T.height(x - 1.5, z) - h),
    Math.abs(T.height(x, z + 1.5) - h), Math.abs(T.height(x, z - 1.5) - h));
  if (s > (maxSlope === undefined ? 1.8 : maxSlope)) return false;
  if (T.roadDist(x, z) < 3.0) return false;
  return true;
}
function nearPad(x, z, name, mul) {
  const p = T.PADS.find(p => p.n === name);
  if (!p) return false;
  const d = Math.hypot(x - p.x, z - p.z);
  return d < p.r * (mul || 1);
}
function inAnyPad(x, z, mul) { return T.PADS.some(p => Math.hypot(x - p.x, z - p.z) < p.r * (mul || 0.75)); }

/* --- trees ------------------------------------------------------------- */
function scatterTrees(cx, cz, radius, count, kinds, minH) {
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 40) {
    tries++;
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!ok(x, z, minH === undefined ? 0.7 : minH, 2.2)) continue;
    if (inAnyPad(x, z, 0.66)) continue;
    if (T.riverDist(x, z) < 5) continue;
    const kind = pick(kinds);
    obj('tree', x, z, { k: kind, rot: Math.round(rnd() * 628) / 100, sc: Math.round((0.85 + rnd() * 0.45) * 100) / 100 });
    placed++;
  }
  return placed;
}
// Oakheart woods (north & around village)
scatterTrees(158, 230, 40, 150, ['Tree', 'Tree', 'Tree', 'Oak']);
scatterTrees(196, 244, 34, 90, ['Tree', 'Oak', 'Oak', 'Willow']);
scatterTrees(128, 288, 30, 80, ['Tree', 'Tree', 'Oak']);
scatterTrees(178, 300, 26, 60, ['Tree', 'Willow', 'Oak']);
// Willow riverbank
scatterTrees(176, 250, 16, 30, ['Willow']);
scatterTrees(184, 300, 14, 24, ['Willow']);
// Northern conifer belt
scatterTrees(160, 150, 46, 110, ['Tree', 'Oak', 'Silverbirch']);
scatterTrees(240, 140, 40, 90, ['Oak', 'Silverbirch', 'Silverbirch']);
// Deep forest: high level trees
scatterTrees(120, 170, 26, 44, ['Willow', 'Silverbirch']);
scatterTrees(268, 138, 22, 36, ['Silverbirch', 'Ironbark']);
scatterTrees(300, 150, 20, 28, ['Ironbark']);
scatterTrees(226, 96, 18, 22, ['Ironbark', 'Ghostwood']);
scatterTrees(96, 208, 18, 24, ['Ghostwood', 'Willow']);
// Swamp + blight sparse
scatterTrees(70, 196, 34, 46, ['Willow', 'Willow', 'Ghostwood'], 0.35);
scatterTrees(320, 214, 34, 40, ['Ironbark', 'Ghostwood']);
// Coast
scatterTrees(150, 300, 28, 40, ['Tree', 'Oak']);
scatterTrees(214, 306, 24, 34, ['Tree', 'Willow']);

/* --- mining sites ------------------------------------------------------ */
function mine(cx, cz, r, list) {
  list.forEach(entry => {
    const [oreName, n] = entry;
    let placed = 0, tries = 0;
    while (placed < n && tries < n * 60) {
      tries++;
      const a = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * r;
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
      if (!ok(x, z, 0.6, 4.0)) continue;
      obj('rock', x, z, { ore: oreName, rot: Math.round(rnd() * 628) / 100 });
      placed++;
    }
  });
}
mine(150, 206, 11, [['Copper ore', 7], ['Tin ore', 7], ['Iron ore', 4]]);                       // beginner camp
mine(120, 218, 9,  [['Copper ore', 4], ['Tin ore', 4], ['Iron ore', 4], ['Coal', 3]]);
mine(198, 74, 14,  [['Iron ore', 8], ['Coal', 8], ['Silver ore', 4], ['Gold ore', 3]]);          // Dunhollow
mine(214, 50, 12,  [['Coal', 8], ['Verdite ore', 6], ['Gold ore', 3]]);
mine(178, 44, 11,  [['Verdite ore', 5], ['Kaldrite ore', 5], ['Coal', 5]]);
mine(238, 46, 10,  [['Kaldrite ore', 5], ['Aetherium ore', 3], ['Coal', 4]]);                    // deep peaks
mine(290, 226, 12, [['Iron ore', 5], ['Coal', 6], ['Kaldrite ore', 4]]);                        // blight quarry
mine(88, 234, 9,   [['Clay', 0], ['Iron ore', 5], ['Coal', 4]].filter(e => e[1] > 0));
mine(160, 330, 8,  [['Copper ore', 4], ['Tin ore', 4], ['Iron ore', 3]]);                       // coastal

/* --- fishing spots ----------------------------------------------------- */
/* A fishing spot must sit in water (h<0) but within wading distance of walkable
   shore, otherwise the player can never reach it. Spiral out until both hold. */
function shoreNearby(x, z) {
  for (let a = 0; a < 16; a++) {
    const ang = a / 16 * Math.PI * 2;
    for (let d = 1; d <= 4; d += 0.5) {
      if (T.height(x + Math.cos(ang) * d, z + Math.sin(ang) * d) > 0.35) return true;
    }
  }
  return false;
}
function fishSpot(x, z, kinds) {
  let bx = x, bz = z, found = false;
  if (T.height(x, z) < -0.15 && shoreNearby(x, z)) found = true;
  for (let r = 1; r <= 14 && !found; r += 1) {
    for (let a = 0; a < 24 && !found; a++) {
      const ang = a / 24 * Math.PI * 2;
      const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
      if (nx < 4 || nz < 4 || nx > T.WORLD - 4 || nz > T.WORLD - 4) continue;
      if (T.height(nx, nz) < -0.15 && T.height(nx, nz) > -6 && shoreNearby(nx, nz)) {
        bx = nx; bz = nz; found = true;
      }
    }
  }
  if (!found) { console.warn('  ! no water found for fishing spot near ' + x + ',' + z); return; }
  obj('fish', bx, bz, { f: kinds });
}
// river (Oakheart)
[[170, 252], [172, 258], [176, 264], [178, 272], [180, 282], [182, 292]].forEach(p => fishSpot(p[0], p[1], ['Shrimp', 'Sardine']));
[[166, 196], [164, 182], [158, 158], [155, 140]].forEach(p => fishSpot(p[0], p[1], ['Trout', 'Salmon']));
// Saltbrook harbour
[[136, 334], [142, 336], [148, 334], [130, 330], [154, 338]].forEach(p => fishSpot(p[0], p[1], ['Shrimp', 'Sardine', 'Herring']));
[[132, 342], [144, 344], [156, 342]].forEach(p => fishSpot(p[0], p[1], ['Lobster', 'Bass']));
[[124, 346], [164, 348], [150, 350]].forEach(p => fishSpot(p[0], p[1], ['Spearfish', 'Direfin']));
// islands
[[176, 344], [184, 350], [118, 340], [214, 336]].forEach(p => fishSpot(p[0], p[1], ['Lobster', 'Spearfish', 'Direfin']));
// swamp
[[72, 202], [66, 208], [58, 198]].forEach(p => fishSpot(p[0], p[1], ['Pike', 'Herring']));

/* --- herbs, flax, hunting, agility ------------------------------------- */
function scatter(type, cx, cz, r, n, extra, minH) {
  let placed = 0, tries = 0;
  while (placed < n && tries < n * 50) {
    tries++;
    const a = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * r;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    if (!ok(x, z, minH === undefined ? 0.7 : minH, 2.0)) continue;
    obj(type, x, z, typeof extra === 'function' ? extra() : extra);
    placed++;
  }
}
scatter('herb', 68, 190, 30, 26, () => ({ h: pick(['Marshleaf', 'Bitterroot', 'Redthistle', 'Blueleaf', 'Duskcap']) }), 0.35);
scatter('herb', 320, 210, 26, 18, () => ({ h: pick(['Duskcap', 'Emberroot', 'Goldenseal', 'Blueleaf']) }));
scatter('herb', 160, 236, 24, 14, () => ({ h: pick(['Marshleaf', 'Bitterroot', 'Redthistle']) }));
scatter('herb', 196, 84, 20, 12, () => ({ h: pick(['Frostvine', 'Blueleaf', 'Duskcap']) }));
scatter('flax', 192, 268, 12, 14, {});
scatter('flax', 210, 296, 10, 10, {});
scatter('hunt', 148, 216, 14, 8, { g: 'bird' });
scatter('hunt', 288, 180, 12, 6, { g: 'bird' });

/* agility course near Oakheart-Aldermere road */
const AG = [
  { o: 'log', x: 216, z: 248, lvl: 1, xp: 12 },
  { o: 'ropeswing', x: 222, z: 242, lvl: 5, xp: 18 },
  { o: 'stones', x: 228, z: 238, lvl: 10, xp: 22 },
  { o: 'net', x: 232, z: 232, lvl: 15, xp: 28 },
  { o: 'beam', x: 228, z: 226, lvl: 20, xp: 34 },
  { o: 'wall', x: 220, z: 228, lvl: 25, xp: 42 }
];
AG.forEach((a, idx) => obj('agility', a.x, a.z, { o: a.o, lvl: a.lvl, xp: a.xp, ord: idx, course: 'oakvale' }));

/* farming patches */
[[202, 278], [206, 278], [210, 278], [202, 282], [206, 282], [210, 282]].forEach(p => obj('patch', p[0], p[1], { kind: 'allotment' }));
[[200, 288], [204, 288]].forEach(p => obj('patch', p[0], p[1], { kind: 'herb' }));
[[64, 180], [68, 180]].forEach(p => obj('patch', p[0], p[1], { kind: 'herb' }));

/* runecraft altars */
obj('altar_rc', 134, 196, { rune: 'Air' });
obj('altar_rc', 108, 230, { rune: 'Mind' });
obj('altar_rc', 88, 196, { rune: 'Water' });
obj('altar_rc', 214, 122, { rune: 'Earth' });
obj('altar_rc', 306, 236, { rune: 'Fire' });
obj('altar_rc', 262, 118, { rune: 'Body' });
obj('altar_rc', 340, 190, { rune: 'Chaos' });
obj('altar_rc', 92, 156, { rune: 'Nature' });
obj('rift', 250, 206, {});  // essence mine access in Aldermere

/* prayer altars */
obj('altar', 96, 268, {});
obj('altar', 250, 200, {});
obj('altar', 200, 56, {});

/* --- signs & landmarks -------------------------------------------------- */
const SIGNS = [
  [172, 262, 'Oakheart Village'], [190, 256, 'Aldermere  -  northeast'], [156, 292, 'Saltbrook  -  south'],
  [148, 258, 'Mirefen  -  west (bring a light)'], [158, 236, 'Mining Camp  -  north'],
  [196, 280, 'Greenfurrow Farms'], [244, 212, 'Aldermere City  -  keep to the road'],
  [252, 152, 'Kragmar Peaks  -  north'], [284, 196, 'THE BLIGHTLANDS  -  turn back'],
  [206, 78, 'Dunhollow Deep'], [142, 314, 'Saltbrook Harbour'], [96, 214, 'Mirefen  -  no bottom, no mercy'],
  [216, 252, 'Oakvale Agility Course'], [134, 200, 'The Old Circle'], [306, 192, 'Watcher\'s Tower (ruined)'],
  [176, 350, 'Gullstone Isle'], [110, 258, 'Wayside Shrine'], [230, 232, 'Aldermere  -  2 miles'],
  [162, 214, 'Copper & Tin  -  novice seam'], [186, 46, 'Danger: deep seam'],
  [330, 200, 'Blightfort  -  abandon hope'], [122, 232, 'Old Quarry'], [214, 312, 'Eastern Sands'],
  [60, 164, 'Blackfen Hut'], [268, 128, 'Ironbark Stand']
];
SIGNS.forEach(s => obj('sign', s[0], s[1], { txt: s[2] }));

const LANDMARKS = [
  ['statue', 160, 266], ['well', 164, 270], ['well', 250, 192], ['fountain', 248, 188],
  ['standing_stone', 132, 194], ['standing_stone', 136, 194], ['standing_stone', 134, 191],
  ['standing_stone', 134, 199], ['obelisk', 330, 206], ['ruin_arch', 58, 182], ['ruin_arch', 66, 188],
  ['brazier', 330, 214], ['brazier', 326, 210], ['cart', 202, 284], ['cart', 152, 274],
  ['crate', 146, 328], ['crate', 148, 330], ['barrel', 144, 330], ['barrel', 170, 278],
  ['anvil', 166, 282], ['anvil', 258, 192], ['anvil', 204, 60], ['furnace', 168, 282],
  ['furnace', 260, 194], ['furnace', 206, 62], ['range', 172, 278], ['range', 252, 202],
  ['range', 142, 324], ['bank_booth', 168, 257], ['bank_booth', 170, 257], ['bank_booth', 250, 181],
  ['bank_booth', 252, 181], ['bank_booth', 140, 317], ['bank_booth', 200, 57],
  ['spinning_wheel', 246, 200], ['pottery_wheel', 246, 202], ['loom', 244, 200]
];
LANDMARKS.forEach(l => obj(l[0], l[1], l[2], {}));

/* bridges over the river: solve for the river centre at each crossing z so the
   deck actually spans the water instead of sitting on the bank */
function riverCentreX(z) {
  let bx = 0, best = 1e9;
  for (let x = 0; x < T.WORLD; x += 0.25) {
    const d = T.riverDist(x, z);
    if (d < best) { best = d; bx = x; }
  }
  return Math.round(bx * 10) / 10;
}
[266, 196, 288].forEach(z => obj('bridge', riverCentreX(z), z, { rot: Math.PI / 2, len: 18 }));

/* dungeon entrances */
obj('dungeon', 316, 232, { name: 'Hollow Descent' });
obj('dungeon', 196, 82, { name: 'Dunhollow Deep' });
obj('dungeon', 56, 196, { name: 'Mirefen Crypt' });

/* --- buildings ---------------------------------------------------------- */
const buildings = [];
let bId = 1;
function bld(o) {
  o.id = bId++;
  o.y = Math.round(T.height(o.x, o.z) * 100) / 100;
  if (o.rot === undefined) o.rot = 0;
  if (!o.style) o.style = 'timber';
  if (!o.interior) o.interior = [];
  buildings.push(o);
  return o;
}
/* Oakheart */
bld({ name: 'Oakheart Bank', x: 168, z: 256, w: 10, d: 8, style: 'stone', door: [0, 0], rot: 0,
  interior: [['counter', 0, 1.5, 0], ['crate', -3, -2, 0], ['crate', 3, -2, 0]] });
bld({ name: 'Amber Hearth Inn', x: 172, z: 277, w: 12, d: 10, style: 'timber', door: [2, 0],
  interior: [['table', -2, -1, 0], ['table', 2, 1, 0], ['chair', -2, 1, 0], ['chair', 2, -1, 0],
             ['barrel', -4, -3, 0], ['barrel', -4, -1.5, 0], ['fireplace', 0, -4, 0]] });
bld({ name: 'General Store', x: 154, z: 272, w: 9, d: 8, style: 'timber', door: [2, 0],
  interior: [['counter', 0, 1.2, 0], ['crate', -3, -2, 0], ['barrel', 3, -2, 0], ['shelf', -3.5, 0, 0]] });
bld({ name: 'Fellstock Supplies', x: 147, z: 278, w: 8, d: 7, style: 'timber', door: [2, 0],
  interior: [['counter', 0, 1, 0], ['crate', -2.5, -1.5, 0]] });
bld({ name: 'Coldiron Smithy', x: 166, z: 282, w: 10, d: 9, style: 'stone', door: [2, 0],
  interior: [['anvil', -2, 0, 0], ['furnace', 2.5, -2, 0], ['barrel', -3, -3, 0]] });
bld({ name: 'Elder\'s House', x: 159, z: 259, w: 8, d: 7, style: 'timber', door: [2, 0],
  interior: [['table', 0, -1, 0], ['chair', 0, 1, 0], ['shelf', -3, 0, 0]] });
bld({ name: 'Cottage', x: 150, z: 262, w: 7, d: 6, style: 'timber', door: [2, 0], interior: [['bed', -2, -1.5, 0], ['table', 1.5, 1, 0]] });
bld({ name: 'Cottage', x: 187, z: 259, w: 7, d: 6, style: 'timber', door: [0, 0], interior: [['bed', 2, -1.5, 0], ['chair', -1.5, 1, 0]] });
bld({ name: 'Cottage', x: 190, z: 290, w: 7, d: 6, style: 'timber', door: [2, 0], interior: [['bed', -2, 1.5, 0], ['table', 1, -1, 0]] });
bld({ name: 'Cottage', x: 146, z: 266, w: 7, d: 6, style: 'timber', door: [1, 0], interior: [['bed', 0, -1.5, 0]] });
/* Wayside shrine + chapel */
bld({ name: 'Wayside Chapel', x: 96, z: 266, w: 10, d: 14, style: 'stone', door: [2, 0],
  interior: [['altar', 0, -5, 0], ['pew', -2, 0, 0], ['pew', 2, 0, 0], ['pew', -2, 2, 0], ['pew', 2, 2, 0], ['candle', 0, -3, 0]] });
/* Farms */
bld({ name: 'Greenfurrow Farmhouse', x: 206, z: 288, w: 10, d: 8, style: 'timber', door: [2, 0],
  interior: [['table', 0, -1, 0], ['chair', 0, 1, 0], ['crate', -3.5, -2, 0]] });
bld({ name: 'Barn', x: 214, z: 282, w: 12, d: 10, style: 'barn', door: [2, 0],
  interior: [['crate', -3, -2, 0], ['crate', -3, 0, 0], ['barrel', 3, -2, 0]] });
bld({ name: 'Seed Shed', x: 198, z: 292, w: 6, d: 6, style: 'timber', door: [2, 0], interior: [['counter', 0, 1, 0]] });
/* Aldermere */
bld({ name: 'Aldermere Bank', x: 250, z: 179, w: 16, d: 11, style: 'stone', door: [2, 0],
  interior: [['counter', -3, 2, 0], ['counter', 3, 2, 0], ['crate', -6, -3, 0], ['crate', 6, -3, 0]] });
bld({ name: 'Aldermere Keep', x: 268, z: 174, w: 22, d: 18, style: 'castle', door: [2, 0], tower: 1,
  interior: [['throne', 0, -6, 0], ['table', -5, 0, 0], ['table', 5, 0, 0], ['brazier', -7, -5, 0], ['brazier', 7, -5, 0]] });
bld({ name: 'Aldermere Armoury', x: 258, z: 186, w: 11, d: 9, style: 'stone', door: [2, 0],
  interior: [['counter', 0, 1.5, 0], ['anvil', -3, -2, 0], ['crate', 3.5, -2, 0]] });
bld({ name: 'Sarn\'s Weapons', x: 256, z: 196, w: 10, d: 8, style: 'stone', door: [0, 0],
  interior: [['counter', 0, 1.2, 0], ['shelf', -3.5, -1, 0]] });
bld({ name: 'The Kindled Sigil', x: 240, z: 176, w: 10, d: 9, style: 'stone', door: [2, 0], tower: 1,
  interior: [['counter', 0, 1.5, 0], ['shelf', -3.5, -1, 0], ['candle', 3, -2, 0]] });
bld({ name: 'The Long Shot', x: 262, z: 202, w: 9, d: 8, style: 'timber', door: [2, 0], interior: [['counter', 0, 1.2, 0]] });
bld({ name: 'Facet & Filigree', x: 244, z: 206, w: 8, d: 7, style: 'stone', door: [2, 0],
  interior: [['counter', 0, 1, 0], ['spinning_wheel', -2.5, -1.5, 0]] });
bld({ name: 'Aldermere Archive', x: 246, z: 198, w: 12, d: 10, style: 'stone', door: [0, 0],
  interior: [['shelf', -4, -2, 0], ['shelf', -4, 0, 0], ['shelf', 4, -2, 0], ['table', 0, 0, 0], ['chair', 0, 2, 0]] });
bld({ name: 'Aldermere Kitchen', x: 252, z: 204, w: 9, d: 8, style: 'stone', door: [2, 0],
  interior: [['range', 0, -2, 0], ['table', 0, 1, 0], ['barrel', -3, 1, 0]] });
bld({ name: 'Market Hall', x: 236, z: 194, w: 14, d: 10, style: 'timber', door: [2, 0],
  interior: [['stall', -4, 0, 0], ['stall', 0, 0, 0], ['stall', 4, 0, 0], ['crate', -6, -3, 0]] });
bld({ name: 'Guard House', x: 264, z: 192, w: 8, d: 7, style: 'stone', door: [2, 0], interior: [['table', 0, -1, 0], ['bed', -2.5, 1.5, 0]] });
bld({ name: 'Townhouse', x: 232, z: 186, w: 8, d: 7, style: 'stone', door: [2, 0], interior: [['bed', -2, -1.5, 0], ['table', 1.5, 1, 0]] });
bld({ name: 'Townhouse', x: 232, z: 204, w: 8, d: 7, style: 'stone', door: [0, 0], interior: [['bed', 2, -1.5, 0]] });
bld({ name: 'Townhouse', x: 264, z: 206, w: 8, d: 7, style: 'stone', door: [2, 0], interior: [['bed', -2, -1.5, 0]] });
/* Dunhollow */
bld({ name: 'Dunhollow Hall', x: 200, z: 60, w: 16, d: 12, style: 'dwarf', door: [2, 0],
  interior: [['counter', -4, 2, 0], ['table', 3, 0, 0], ['brazier', -6, -4, 0], ['brazier', 6, -4, 0]] });
bld({ name: 'Pick & Pail', x: 194, z: 68, w: 9, d: 8, style: 'dwarf', door: [2, 0], interior: [['counter', 0, 1.2, 0], ['crate', -3, -2, 0]] });
bld({ name: 'Frostforge', x: 206, z: 60, w: 12, d: 10, style: 'dwarf', door: [0, 0],
  interior: [['anvil', -2, 0, 0], ['furnace', 3, -2, 0], ['barrel', -4, -3, 0]] });
bld({ name: 'Miner\'s Lodge', x: 190, z: 58, w: 9, d: 8, style: 'dwarf', door: [2, 0], interior: [['bed', -2.5, -1.5, 0], ['bed', 2.5, -1.5, 0], ['table', 0, 1.5, 0]] });
/* Saltbrook */
bld({ name: 'Saltbrook Bank', x: 140, z: 316, w: 10, d: 8, style: 'stone', door: [2, 0], interior: [['counter', 0, 1.5, 0]] });
bld({ name: 'Fishmonger', x: 138, z: 327, w: 9, d: 7, style: 'timber', door: [0, 0], interior: [['counter', 0, 1.2, 0], ['barrel', -3, -1.5, 0]] });
bld({ name: 'Harbourmaster\'s Office', x: 147, z: 329, w: 9, d: 8, style: 'timber', door: [2, 0], interior: [['table', 0, -1, 0], ['chair', 0, 1, 0], ['shelf', -3, 0, 0]] });
bld({ name: 'Salt Cottage', x: 132, z: 320, w: 7, d: 6, style: 'timber', door: [2, 0], interior: [['bed', -2, -1.5, 0]] });
bld({ name: 'Salt Cottage', x: 150, z: 318, w: 7, d: 6, style: 'timber', door: [2, 0], interior: [['bed', -2, -1.5, 0]] });
bld({ name: 'Net Loft', x: 144, z: 324, w: 8, d: 7, style: 'timber', door: [1, 0], interior: [['crate', -2, -1.5, 0], ['range', 2, -1.5, 0]] });
/* Mirefen */
bld({ name: 'Blackfen Hut', x: 60, z: 170, w: 8, d: 7, style: 'hut', door: [2, 0],
  interior: [['counter', 0, 1.2, 0], ['shelf', -3, -1, 0], ['candle', 2.5, -2, 0]] });
bld({ name: 'Ruined Hall', x: 56, z: 188, w: 14, d: 11, style: 'ruin', door: [2, 0], interior: [['altar', 0, -4, 0], ['brazier', -4, -2, 0]] });
bld({ name: 'Sunken House', x: 72, z: 178, w: 8, d: 7, style: 'ruin', door: [2, 0], interior: [['crate', -2, -1.5, 0]] });
/* Blightlands */
bld({ name: 'Blightfort Gate', x: 330, z: 202, w: 18, d: 8, style: 'castle', door: [2, 0], interior: [['brazier', -6, 0, 0], ['brazier', 6, 0, 0]] });
bld({ name: 'Warden\'s Hall', x: 336, z: 218, w: 20, d: 16, style: 'castle', door: [0, 0], tower: 1,
  interior: [['obelisk', 0, -5, 0], ['brazier', -6, -3, 0], ['brazier', 6, -3, 0]] });
bld({ name: 'Watchtower (ruined)', x: 306, z: 186, w: 8, d: 8, style: 'ruin', door: [2, 0], tower: 1, interior: [['crate', -2, -2, 0]] });
/* Mining camp */
bld({ name: 'Mining Camp Shed', x: 152, z: 202, w: 8, d: 7, style: 'timber', door: [2, 0], interior: [['crate', -2, -1.5, 0], ['range', 2, -1.5, 0]] });
/* Gullstone Isle */
bld({ name: 'Pirate Hideout', x: 176, z: 354, w: 12, d: 10, style: 'timber', door: [2, 0],
  interior: [['table', 0, -1, 0], ['barrel', -4, -2, 0], ['crate', 4, -2, 0], ['chair', 0, 1.5, 0]] });

/* --- NPC spawn placement ------------------------------------------------ */
const spawns = [];
function spawn(key, x, z, extra) {
  spawns.push(Object.assign({ k: key, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }, extra || {}));
}
npcs.filter(n => n.kind === 'npc').forEach(n => spawn(n.key, n.x, n.z, { w: n.wander || 0 }));

function spawnGroup(key, cx, cz, r, n) {
  let placed = 0, tries = 0;
  while (placed < n && tries < n * 50) {
    tries++;
    const a = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * r;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    if (!ok(x, z, 0.5, 2.4)) continue;
    spawn(key, x, z, { w: 5 });
    placed++;
  }
}
spawnGroup('chicken', 208, 292, 8, 8);
spawnGroup('cow', 216, 286, 9, 10);
spawnGroup('cow', 196, 294, 8, 6);
spawnGroup('giant_rat', 172, 288, 14, 10);
spawnGroup('giant_rat', 140, 296, 12, 8);
spawnGroup('goblin', 130, 276, 14, 14);
spawnGroup('goblin', 118, 262, 12, 10);
spawnGroup('goblin_brute', 122, 250, 10, 8);
spawnGroup('grothak_the_goblin_king', 116, 248, 3, 1);
spawnGroup('forest_spider', 158, 232, 16, 12);
spawnGroup('forest_spider', 196, 240, 12, 8);
spawnGroup('bandit_scout', 206, 250, 12, 8);
spawnGroup('gloom_bat', 150, 210, 12, 8);
spawnGroup('cave_crawler', 196, 80, 14, 12);
spawnGroup('mountain_wolf', 168, 130, 18, 12);
spawnGroup('mountain_wolf', 230, 120, 16, 10);
spawnGroup('rock_golem', 206, 52, 14, 8);
spawnGroup('hobgrim', 240, 132, 14, 10);
spawnGroup('kragmar_ogre', 176, 48, 14, 8);
spawnGroup('ice_troll', 220, 40, 16, 8);
spawnGroup('crag_giant', 250, 60, 16, 8);
spawnGroup('marsh_zombie', 66, 196, 20, 16);
spawnGroup('skeleton', 56, 184, 14, 12);
spawnGroup('bog_lurker', 78, 206, 16, 10);
spawnGroup('mire_wraith', 52, 200, 12, 8);
spawnGroup('grave_knight', 60, 214, 12, 6);
spawnGroup('mother_of_mires', 50, 206, 4, 1);
spawnGroup('giant_crab', 128, 336, 14, 10);
spawnGroup('pirate_deckhand', 176, 352, 12, 12);
spawnGroup('the_drowned_captain', 178, 358, 3, 1);
spawnGroup('blight_hound', 306, 200, 18, 14);
spawnGroup('blight_hound', 320, 228, 14, 8);
spawnGroup('blight_shaman', 322, 206, 14, 10);
spawnGroup('corrupted_knight', 332, 210, 14, 12);
spawnGroup('verdant_drake', 348, 236, 12, 5);
spawnGroup('warden_of_ash', 336, 218, 3, 1);

/* ==================================================================== */
/*  SPELLS & PRAYERS                                                     */
/* ==================================================================== */
function rune(n, c) { return { item: ID(n + ' rune'), n: c }; }
const spells = [
  { id: 'wind_strike',  name: 'Wind Strike',  lvl: 1,  xp: 5.5,  dmg: 2,  el: 'air',   runes: [rune('Air', 1), rune('Mind', 1)] },
  { id: 'confuse',      name: 'Confuse',      lvl: 3,  xp: 13,   dmg: 0,  el: 'air',   debuff: { skill: 'attack', pct: 5 }, runes: [rune('Water', 3), rune('Earth', 2), rune('Body', 1)] },
  { id: 'water_strike', name: 'Water Strike', lvl: 5,  xp: 7.5,  dmg: 4,  el: 'water', runes: [rune('Water', 1), rune('Air', 1), rune('Mind', 1)] },
  { id: 'earth_strike', name: 'Earth Strike', lvl: 9,  xp: 9.5,  dmg: 6,  el: 'earth', runes: [rune('Earth', 2), rune('Air', 1), rune('Mind', 1)] },
  { id: 'fire_strike',  name: 'Fire Strike',  lvl: 13, xp: 11.5, dmg: 8,  el: 'fire',  runes: [rune('Fire', 3), rune('Air', 2), rune('Mind', 1)] },
  { id: 'wind_bolt',    name: 'Wind Bolt',    lvl: 17, xp: 13.5, dmg: 9,  el: 'air',   runes: [rune('Air', 2), rune('Chaos', 1)] },
  { id: 'low_alchemy',  name: 'Low Alchemy',  lvl: 21, xp: 31,   dmg: 0,  el: 'fire',  alch: 0.4, runes: [rune('Fire', 3), rune('Nature', 1)] },
  { id: 'water_bolt',   name: 'Water Bolt',   lvl: 23, xp: 16.5, dmg: 10, el: 'water', runes: [rune('Water', 2), rune('Air', 2), rune('Chaos', 1)] },
  { id: 'tele_oakheart', name: 'Teleport: Oakheart', lvl: 25, xp: 35, dmg: 0, el: 'air', tele: { x: 162, z: 268 }, runes: [rune('Air', 3), rune('Fire', 1), rune('Law', 1)] },
  { id: 'earth_bolt',   name: 'Earth Bolt',   lvl: 29, xp: 19.5, dmg: 11, el: 'earth', runes: [rune('Earth', 3), rune('Air', 2), rune('Chaos', 1)] },
  { id: 'fire_bolt',    name: 'Fire Bolt',    lvl: 35, xp: 22.5, dmg: 12, el: 'fire',  runes: [rune('Fire', 4), rune('Air', 3), rune('Chaos', 1)] },
  { id: 'wind_blast',   name: 'Wind Blast',   lvl: 41, xp: 25.5, dmg: 13, el: 'air',   runes: [rune('Air', 3), rune('Death', 1)] },
  { id: 'tele_aldermere', name: 'Teleport: Aldermere', lvl: 45, xp: 43, dmg: 0, el: 'air', tele: { x: 250, z: 192 }, runes: [rune('Air', 3), rune('Water', 1), rune('Law', 1)] },
  { id: 'water_blast',  name: 'Water Blast',  lvl: 47, xp: 28.5, dmg: 14, el: 'water', runes: [rune('Water', 3), rune('Air', 3), rune('Death', 1)] },
  { id: 'earth_blast',  name: 'Earth Blast',  lvl: 53, xp: 31.5, dmg: 15, el: 'earth', runes: [rune('Earth', 4), rune('Air', 3), rune('Death', 1)] },
  { id: 'high_alchemy', name: 'High Alchemy', lvl: 55, xp: 65,   dmg: 0,  el: 'fire',  alch: 0.75, runes: [rune('Fire', 5), rune('Nature', 1)] },
  { id: 'fire_blast',   name: 'Fire Blast',   lvl: 59, xp: 34.5, dmg: 16, el: 'fire',  runes: [rune('Fire', 5), rune('Air', 4), rune('Death', 1)] },
  { id: 'tele_saltbrook', name: 'Teleport: Saltbrook', lvl: 61, xp: 48, dmg: 0, el: 'air', tele: { x: 142, z: 320 }, runes: [rune('Air', 3), rune('Earth', 1), rune('Law', 1)] }
];

const prayers = [
  { id: 'thick_skin',   name: 'Thick Skin',        lvl: 1,  drain: 0.20, eff: { defence: 5 } },
  { id: 'burst_str',    name: 'Burst of Strength', lvl: 4,  drain: 0.20, eff: { strength: 5 } },
  { id: 'clarity',      name: 'Clarity of Thought', lvl: 7, drain: 0.20, eff: { attack: 5 } },
  { id: 'sharp_eye',    name: 'Sharp Eye',         lvl: 8,  drain: 0.20, eff: { ranged: 5 } },
  { id: 'mystic_will',  name: 'Mystic Will',       lvl: 9,  drain: 0.20, eff: { magic: 5 } },
  { id: 'rock_skin',    name: 'Rock Skin',         lvl: 10, drain: 0.40, eff: { defence: 10 } },
  { id: 'super_str',    name: 'Superhuman Strength', lvl: 13, drain: 0.40, eff: { strength: 10 } },
  { id: 'improved_ref', name: 'Improved Reflexes', lvl: 16, drain: 0.40, eff: { attack: 10 } },
  { id: 'protect_item', name: 'Protect Item',      lvl: 25, drain: 0.28, eff: { keepItem: 1 } },
  { id: 'steel_skin',   name: 'Steel Skin',        lvl: 28, drain: 0.80, eff: { defence: 15 } },
  { id: 'ult_str',      name: 'Ultimate Strength', lvl: 31, drain: 0.80, eff: { strength: 15 } },
  { id: 'incred_ref',   name: 'Incredible Reflexes', lvl: 34, drain: 0.80, eff: { attack: 15 } },
  { id: 'prot_magic',   name: 'Protect from Magic', lvl: 37, drain: 1.20, eff: { protect: 'magic' } },
  { id: 'prot_missiles', name: 'Protect from Missiles', lvl: 40, drain: 1.20, eff: { protect: 'ranged' } },
  { id: 'prot_melee',   name: 'Protect from Melee', lvl: 43, drain: 1.20, eff: { protect: 'melee' } }
];

/* ==================================================================== */
/*  WRITE                                                                */
/* ==================================================================== */
const world = {
  size: T.WORLD, water: T.WATER,
  regions: [
    { n: 'Oakheart Vale', x: 160, z: 268 }, { n: 'Aldermere', x: 250, z: 190 },
    { n: 'Kragmar Peaks', x: 200, z: 62 }, { n: 'Mirefen', x: 62, z: 176 },
    { n: 'Saltbrook Coast', x: 140, z: 322 }, { n: 'The Blightlands', x: 330, z: 210 }
  ],
  spawnPoint: { x: 162, z: 268 },
  respawnPoints: [{ n: 'Oakheart', x: 162, z: 268 }, { n: 'Aldermere', x: 250, z: 190 }, { n: 'Saltbrook', x: 140, z: 320 }],
  objects: objects, buildings: buildings, spawns: spawns,
  trees: TREES, ores: ORES, fish: FISH, crops: CROPS, herbs: HERBS, potions: POTIONS,
  runes: RUNES, tiers: TIERS, weapons: WEAPONS, armour: ARMOUR, gems: GEMS, bowwood: BOWWOOD
};

function w(f, o) {
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(o));
  const kb = (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1);
  console.log('  ' + f.padEnd(16) + kb + ' KB');
}
console.log('Emberfall content generation');
w('items.json', items);
w('npcs.json', { npcs: npcs, shops: shops });
w('quests.json', quests);
w('magic.json', { spells: spells, prayers: prayers });
w('world.json', world);
console.log('\n  items      ' + items.length);
console.log('  npc types  ' + npcs.length + ' (' + npcs.filter(n => n.kind === 'monster').length + ' monsters)');
console.log('  shops      ' + shops.length);
console.log('  spells     ' + spells.length + ', prayers ' + prayers.length);
console.log('  quests     ' + quests.length + ' (' + quests.reduce((a, q) => a + q.stages.length, 0) + ' stages)');
console.log('  objects    ' + objects.length);
console.log('  buildings  ' + buildings.length);
console.log('  spawns     ' + spawns.length);
