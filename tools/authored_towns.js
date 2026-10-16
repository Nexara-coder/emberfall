/* Emberfall - authored settlement layouts.
 *
 * The coordinates used to live in this file as hand-written JavaScript arrays.
 * They now live in data/authored_world.json, because the Godot map editor
 * reads and writes that file - so a building you drag in the Godot viewport
 * and a building you type in by hand end up in the same place, and the Node
 * pipeline below still sees exactly the same data it always did.
 *
 * This file is now only a loader. It exports the same seven objects with the
 * same shape as before, so tools/apply_towns.js is unchanged.
 *
 * Layout convention (unchanged, and the Godot editor obeys it):
 *   door: [side, offsetAlongWall]  side 0=+z (south) 1=+x (east)
 *                                       2=-z (north) 3=-x (west)
 *   Doors face the square or the road, never a neighbour's wall.
 *
 * To edit by hand, edit data/authored_world.json. To edit visually, open
 * godot/ in Godot 4 and use Project > Tools > Emberfall Map.
 *
 * After any edit:
 *   node tools/apply_towns.js
 *   node tools/apply_resources.js
 *   node tools/bake.js
 *   node tools/validate_world.js      # must report 0 errors
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'data', 'authored_world.json');

if (!fs.existsSync(SRC)) {
  throw new Error(
    'data/authored_world.json is missing. If you are upgrading an older copy '
    + 'of the project, restore the previous tools/authored_towns.js and run '
    + 'node tools/extract_authored.js once to create it.'
  );
}

const DOC = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function town(key) {
  const t = DOC.towns && DOC.towns[key];
  if (!t) throw new Error('authored_world.json has no town "' + key + '"');
  /* Normalise the optional collections so apply_towns.js never sees
     undefined, exactly as the old literals never left them out. */
  return {
    name: t.name,
    centre: t.centre,
    radius: t.radius,
    buildings: t.buildings || [],
    props: t.props || [],
    trees: t.trees || [],
    fences: t.fences || [],
    posts: t.posts || {}
  };
}

const OAKHEART = town('OAKHEART');
const ALDERMERE = town('ALDERMERE');
const DUNHOLLOW = town('DUNHOLLOW');
const SALTBROOK = town('SALTBROOK');
const MIREFEN = town('MIREFEN');
const BLIGHTFORT = town('BLIGHTFORT');
const OUTPOSTS = town('OUTPOSTS');

module.exports = { OAKHEART, ALDERMERE, DUNHOLLOW, SALTBROOK, MIREFEN, BLIGHTFORT, OUTPOSTS };
