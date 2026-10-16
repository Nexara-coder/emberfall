/* One-shot migration: lift the authored world out of the hand-written
   JavaScript arrays into data/authored_world.json, so the Godot map editor
   can read and write it.
 *
 * Run once from the project root:
 *     node tools/extract_authored.js
 *
 * It reads the ORIGINAL tools/authored_towns.js and tools/authored_resources.js
 * (whatever they currently contain) and writes data/authored_world.json. After
 * that the two .js files are replaced by thin loaders that read the JSON back,
 * so there is exactly one source of truth and the Node pipeline keeps working
 * unchanged.
 *
 * Key order is preserved as written so the JSON diffs cleanly in git.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const T_SRC = path.join(ROOT, 'tools/authored_towns.js');
const R_SRC = path.join(ROOT, 'tools/authored_resources.js');
const OUT = path.join(ROOT, 'data/authored_world.json');

if (!fs.existsSync(T_SRC) || !fs.existsSync(R_SRC)) {
  console.error('authored_towns.js / authored_resources.js not found - run from the project root');
  process.exit(1);
}

const A = require(T_SRC);
const R = require(R_SRC);

/* The town order matters: apply_towns.js applies them in this order and later
   towns clear scenery from earlier ones. */
const TOWN_ORDER = ['OAKHEART', 'ALDERMERE', 'DUNHOLLOW', 'SALTBROOK',
                    'MIREFEN', 'BLIGHTFORT', 'OUTPOSTS'];

const doc = {
  /* Bump when the shape of this file changes. */
  schema: 1,
  /* Written for humans and for the Godot editor plugin; both read the same
     file, and Godot writes it back with the same key order. */
  note: 'Authored world data. Edited either by hand or in the Godot editor '
      + '(Project > Emberfall Map). After editing run: '
      + 'node tools/apply_towns.js && node tools/apply_resources.js '
      + '&& node tools/bake.js && node tools/validate_world.js',
  townOrder: TOWN_ORDER,
  towns: {},
  resources: { zones: R.ZONES, landmarks: R.LANDMARKS }
};

TOWN_ORDER.forEach(function (key) {
  const t = A[key];
  if (!t) { console.error('missing town export: ' + key); process.exit(1); }
  doc.towns[key] = {
    name: t.name,
    centre: t.centre,
    radius: t.radius,
    buildings: t.buildings || [],
    props: t.props || [],
    trees: t.trees || [],
    fences: t.fences || [],
    posts: t.posts || {}
  };
});

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

let nb = 0, np = 0, nt = 0, nf = 0, nposts = 0;
TOWN_ORDER.forEach(function (k) {
  const t = doc.towns[k];
  nb += t.buildings.length; np += t.props.length;
  nt += t.trees.length; nf += t.fences.length;
  nposts += Object.keys(t.posts).length;
});
console.log('wrote data/authored_world.json');
console.log('  towns      ' + TOWN_ORDER.length);
console.log('  buildings  ' + nb);
console.log('  props      ' + np);
console.log('  trees      ' + nt);
console.log('  fence runs ' + nf);
console.log('  npc posts  ' + nposts);
console.log('  zones      ' + doc.resources.zones.length);
console.log('  landmarks  ' + doc.resources.landmarks.length);
