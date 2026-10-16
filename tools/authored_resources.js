/* Emberfall - authored natural resources.
 *
 * As with the settlements, the coordinates now live in
 * data/authored_world.json so the Godot map editor and the Node pipeline share
 * one source of truth. This file is a loader and exports the same two arrays
 * it always did, so tools/apply_resources.js is unchanged.
 *
 * ZONES     - named resource areas (forests, mines, herb beds, fishing grounds)
 * LANDMARKS - one-off placements that are not part of a zone
 *
 * Edit data/authored_world.json by hand, or open godot/ in Godot 4 and use
 * Project > Tools > Emberfall Map.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'data', 'authored_world.json');

if (!fs.existsSync(SRC)) {
  throw new Error(
    'data/authored_world.json is missing. If you are upgrading an older copy '
    + 'of the project, restore the previous tools/authored_resources.js and '
    + 'run node tools/extract_authored.js once to create it.'
  );
}

const DOC = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const R = DOC.resources || {};

const ZONES = R.zones || [];
const LANDMARKS = R.landmarks || [];

module.exports = { ZONES, LANDMARKS };
