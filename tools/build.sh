#!/bin/sh
# Emberfall - the whole world build, in the only order that works.
#
# Run from the project root:   sh tools/build.sh
#
# Note what is NOT here: tools/gen_data.js. That script regenerates the world
# from scratch, including the monster spawn table, and running it now produces a
# world the validator rejects - it puts a level 18 monster in the starting area,
# which breaks the difficulty curve. The authored world in data/ is the source
# of truth; gen_data.js is kept only for reference.
#
# The four steps below are idempotent: running them repeatedly converges on the
# same byte-identical data/world.json.
set -e
cd "$(dirname "$0")/.."

echo "1/4  applying authored settlements"
node tools/apply_towns.js

echo "2/4  applying authored resources"
node tools/apply_resources.js

echo "3/4  baking the build stamp, gamedata.js and the Godot data mirror"
node tools/bake.js

echo "4/4  validating"
node tools/validate_world.js

echo
echo "Done. If the validator reported 0 errors you can deploy."
echo "The Godot client needs a re-export after this - see README_GODOT.md."
