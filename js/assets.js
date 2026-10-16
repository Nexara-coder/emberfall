/* Emberfall - authored asset registry.
   One place that knows every supplied model and texture, loads each exactly
   once, and hands out shared geometry and shared materials. The Z-up
   correction and the scale normalisation happen here and nowhere else, so a
   model can never end up rotated twice or sized differently in two places. */
(function (g) {
  'use strict';
  var THREE = g.THREE;

  var geoCache = {};       // path -> BufferGeometry
  var texCache = {};       // name -> Texture
  var matCache = {};       // key  -> Material
  var ready = false;

  /* Set once at startup: when the host refuses direct access to /assets we
     fetch everything through the PHP front controller instead. Without this
     every texture and model fails silently and the game falls back to its
     built-in shapes, which looks exactly like "you used none of my assets". */
  var viaPhp = false;
  var blockedReason = '';
  function url(rel) {
    return viaPhp ? ('api/index.php?a=asset&f=' + encodeURIComponent(rel)) : ('assets/' + rel);
  }
  function probe() {
    return fetch('assets/materials/Stone/BaseColor.png', { method: 'GET' })
      .then(function (r) {
        if (r.ok) return false;
        viaPhp = true; blockedReason = 'HTTP ' + r.status + ' on /assets/';
        return true;
      })
      .catch(function (e) {
        viaPhp = true; blockedReason = e.message || 'request failed';
        return true;
      });
  }

  var MODELS = 'assets/models/';
  var MATS = 'assets/materials/';
  var HD = 'assets/hd/';

  /* The authored 1024px production textures. These are the real surfaces now;
     the procedural sheets stay as a fallback if the folder is missing. */
  var HD_TEX = {
    grass:   'terrain/grass_lush.png',   grass_dry: 'terrain/grass_dry.png',
    dirt:    'terrain/dirt.png',         dirt_dark: 'terrain/dirt_dark.png',
    road:    'terrain/road_cobble.png',  sand:      'terrain/sand.png',
    rock:    'terrain/rock_ground.png',  snow:      'terrain/snow.png',
    swamp:   'terrain/swamp.png',        water:     'terrain/water.png',
    brick:   'buildings/brick_wall.png', stone:     'buildings/stone_wall.png',
    stonemoss: 'buildings/stone_wall_moss.png',
    plaster: 'buildings/plaster.png',    roof:      'buildings/roof_tiles.png',
    thatch:  'buildings/thatch.png',     planks:    'buildings/wood_planks.png',
    floor:   'buildings/floor_stone.png',
    bark_oak: 'nature/bark_oak.png',     bark_pine: 'nature/bark_pine.png',
    leaves_oak: 'nature/leaves_oak.png', leaves_willow: 'nature/leaves_willow.png'
  };
  /* Exact texture files from the user-supplied AssetsV2.0 pack.  When a
     surface exists there, use THAT file rather than a lookalike generated
     later.  A few legacy-only surfaces (plaster/thatch) still fall back to
     assets/hd because V2 does not contain equivalents. */
  var V2_SURFACE = {
    grass: 'terrain/grass_lush.png', grass_dry: 'terrain/grass_dry.png',
    dirt: 'terrain/dirt.png', dirt_dark: 'terrain/dirt_dark.png',
    road: 'terrain/road_cobble.png', sand: 'terrain/sand.png',
    rock: 'terrain/rock_ground.png', snow: 'terrain/snow.png',
    swamp: 'terrain/swamp.png', water: 'terrain/water.png',
    brick: 'buildings/brick_wall.png', stone: 'buildings/stone_wall.png',
    stonemoss: 'buildings/mossy_stone.png', roof: 'buildings/roof_tiles.png',
    planks: 'buildings/wood_planks.png', floor: 'buildings/floor_stone.png',
    bark_oak: 'nature/bark_oak.png', bark_pine: 'nature/bark_pine.png',
    leaves_oak: 'nature/leaves_oak.png', leaves_willow: 'nature/leaves_willow.png'
  };
  var hdCache = {};

  function hd(name, repeat) {
    var key = 'hd:' + name + '@' + (repeat || 1);
    if (hdCache[key]) return hdCache[key];
    var file = V2_SURFACE[name] || HD_TEX[name];
    if (!file) return null;
    var rel = V2_SURFACE[name] ? ('v2/textures/' + file) : ('hd/' + file);
    var t = new THREE.TextureLoader().load(url(rel));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat || 1, repeat || 1);
    t.anisotropy = 8;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    hdCache[key] = t;
    return t;
  }

  /* The supplied leaf sheets have no alpha, so a canopy made from them would
     be solid again. This composites their colour with the procedural cut-out
     mask, giving HD leaf detail AND a ragged see-through edge. */
  var foliageCache = {};
  function hdFoliage(which, repeat) {
    var key = 'fol:' + which + '@' + (repeat || 1);
    if (foliageCache[key]) return foliageCache[key];
    var S = 512;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    /* start from the procedural mask, which carries the alpha */
    var maskTex = g.RFTextures ? g.RFTextures.pixels('foliage', S) : null;
    var img = ctx.createImageData(S, S);
    if (maskTex) img.data.set(maskTex.data);
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat || 1, repeat || 1);
    tex.anisotropy = 4;
    foliageCache[key] = tex;

    /* when the HD sheet arrives, paint its colour through the mask */
    var src = new Image();
    src.onload = function () {
      try {
        var tmp = document.createElement('canvas');
        tmp.width = tmp.height = S;
        var tctx = tmp.getContext('2d');
        tctx.drawImage(src, 0, 0, S, S);
        var colour = tctx.getImageData(0, 0, S, S);
        var out = ctx.createImageData(S, S);
        for (var i = 0; i < S * S; i++) {
          out.data[i * 4] = colour.data[i * 4];
          out.data[i * 4 + 1] = colour.data[i * 4 + 1];
          out.data[i * 4 + 2] = colour.data[i * 4 + 2];
          out.data[i * 4 + 3] = maskTex ? maskTex.data[i * 4 + 3] : 255;
        }
        ctx.putImageData(out, 0, 0);
        tex.needsUpdate = true;
      } catch (e) {}
    };
    src.src = url(V2_SURFACE[which] ? ('v2/textures/' + V2_SURFACE[which]) : ('hd/' + (HD_TEX[which] || HD_TEX.leaves_oak)));
    return tex;
  }

  /* Every authored model, with the height it should stand at in the world and
     the material it is painted with. Heights are in metres and were measured
     against the player, who is about 1.9m. */
  var CATALOGUE = {
    oak:       { file: 'Nature/Oak_Tree_HD.glb',        height: 6.4, mat: 'Wood' },
    boulder:   { file: 'Nature/Rock_Large.glb',         height: 1.8, mat: 'Stone' },
    well:      { file: 'Props/Stone_Well.glb',          height: 2.6, mat: 'Stone' },
    fence:     { file: 'Props/Fence_Segment.glb',       height: 1.5, mat: 'Wood' },
    barrel:    { file: 'Props/Barrel.glb',              height: 1.2, mat: 'Wood' }
  };

  var MATERIALS = ['Terrain', 'Stone', 'Wood', 'Plaster', 'Roof', 'Metal'];

  /* Measured average colour of each supplied map. A texture already carries
     its own colour, so multiplying it by a tint of the same colour lands at
     roughly a quarter brightness - which is what turned the ground and the
     roofs black. Tints are divided through by these means so the product
     comes out where it was asked to. */
  var MEAN = {
    Terrain: [87, 121, 58], Stone: [105, 103, 97], Wood: [115, 73, 40],
    Plaster: [195, 183, 153], Roof: [112, 51, 37], Metal: [105, 110, 116]
  };

  function balance(name, hex) {
    var m = MEAN[name];
    var c = new THREE.Color(hex);
    if (!m) return c;
    c.r = Math.min(2.4, c.r / Math.max(0.06, m[0] / 255));
    c.g = Math.min(2.4, c.g / Math.max(0.06, m[1] / 255));
    c.b = Math.min(2.4, c.b / Math.max(0.06, m[2] / 255));
    return c;
  }

  /* Same correction, for vertex colours that get multiplied by a map. */
  function balanceRGB(name, rgb255) {
    var m = MEAN[name] || [255, 255, 255];
    return [
      Math.min(2.4, (rgb255[0] / 255) / Math.max(0.06, m[0] / 255)),
      Math.min(2.4, (rgb255[1] / 255) / Math.max(0.06, m[1] / 255)),
      Math.min(2.4, (rgb255[2] / 255) / Math.max(0.06, m[2] / 255))
    ];
  }

  function texture(name, repeat) {
    var key = name + '@' + (repeat || 1);
    if (texCache[key]) return texCache[key];
    var t = new THREE.TextureLoader().load(url('materials/' + name + '/BaseColor.png'));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat || 1, repeat || 1);
    t.anisotropy = 8;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    /* Left in linear space on purpose: the renderer is not configured for an
       sRGB output pass, and tagging these sRGB only darkened them further. */
    texCache[key] = t;
    return t;
  }

  /* Shared materials. A handful of these serve the whole world rather than one
     per object, which is the difference between a smooth frame and a stutter. */
  function material(name, tint, repeat) {
    var key = name + '|' + (tint || '') + '|' + (repeat || 1);
    if (matCache[key]) return matCache[key];
    var m = new THREE.MeshLambertMaterial({
      map: texture(name, repeat),
      color: tint ? balance(name, tint) : new THREE.Color('#ffffff')
    });
    matCache[key] = m;
    return m;
  }

  function geometry(key) {
    return geoCache[key] || null;
  }

  /* A ready-to-place mesh. Geometry and material are shared; only the Object3D
     is new, so placing a thousand fences costs a thousand transforms and
     nothing else. */
  function mesh(key, opts) {
    opts = opts || {};
    var geo = geoCache[key];
    if (!geo) return null;
    var spec = CATALOGUE[key] || {};
    var mat = material(opts.mat || spec.mat || 'Stone', opts.tint, opts.repeat || 1);
    var m = new THREE.Mesh(geo, mat);
    m.userData.assetKey = key;
    return m;
  }

  /* Collision footprint from the model's own bounds, not its triangles. */
  function footprint(key) {
    var geo = geoCache[key];
    if (!geo || !geo.boundingBox) return null;
    var bb = geo.boundingBox;
    return { w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z, h: bb.max.y - bb.min.y };
  }

  function has(key) { return !!geoCache[key]; }

  /* Loads everything up front. Resolves even when individual files are
     missing, so a partial asset folder degrades to procedural models rather
     than stopping the game from starting. */
  /* The rigged adventurers, kept as loaded rigs that can be cloned per actor. */
  var rigs = {};
  /* Returns a FRESH rig each call, so two characters never share a skeleton. */
  function rigged(which) {
    var src = rigs[which];
    if (!src) return null;
    try { return g.RFGlb.cloneRig(src); }
    catch (e) { console.warn('Emberfall: could not clone rig', which, e.message); return null; }
  }

  /* ------------------------------------------------- authored v2 models
     Each model is split into primitives and every primitive gets the texture
     that belongs to that part. The pack names them model__texture.png; which
     primitive is which is decided by height, because the files carry no
     material names - the upper parts of a tree are foliage, the lower are
     bark; the top of a house is roof. */
  var V2 = 'assets/v2/';
  var V2_SPEC = {
    tree_oak:      { file: 'models/trees/tree_oak.glb', height: 6.2,
                     lower: 'tree_oak__bark_oak.png', upper: 'tree_oak__leaves_oak.png', split: 0.42 },
    tree_willow:   { file: 'models/trees/tree_willow.glb', height: 6.0,
                     lower: 'tree_willow__bark_oak.png', upper: 'tree_willow__leaves_willow.png', split: 0.40 },
    tree_pine:     { file: 'models/trees/tree_pine.glb', height: 7.0,
                     lower: 'tree_pine__bark_pine.png', upper: 'tree_pine__leaves_oak.png', split: 0.30 },
    tree_dead:     { file: 'models/trees/tree_dead.glb', height: 5.0,
                     lower: 'tree_dead__bark_oak.png', upper: 'tree_dead__bark_oak.png', split: 1.0 },
    well:          { file: 'models/props/well.glb', height: 2.0,
                     lower: 'well__stone_wall.png', upper: 'well__wood_planks.png', split: 0.55 },
    fence_section: { file: 'models/props/fence_section.glb', height: 1.5,
                     lower: 'fence_section__wood_planks.png', upper: 'fence_section__wood_planks.png', split: 1.0 },
    signpost:      { file: 'models/props/signpost.glb', height: 2.6,
                     lower: 'signpost__wood_planks.png', upper: 'signpost__wood_planks.png', split: 1.0 },
    barrel:        { file: 'models/props/barrel.glb', height: 1.1,
                     lower: 'barrel__wood_planks.png', upper: 'barrel__wood_planks.png', split: 1.0 },
    sword:         { file: 'models/equipment/sword.glb', height: 0.86,
                     lower: 'sword__stone_wall.png', upper: 'sword__stone_wall.png', split: 1.0 },
    axe:           { file: 'models/equipment/axe.glb', height: 0.72,
                     lower: 'axe__wood_planks.png', upper: 'axe__stone_wall.png', split: 0.62 },
    pickaxe:       { file: 'models/equipment/pickaxe.glb', height: 0.76,
                     lower: 'pickaxe__wood_planks.png', upper: 'pickaxe__stone_wall.png', split: 0.58 },
    shield:        { file: 'models/equipment/shield.glb', height: 0.62,
                     lower: 'shield__wood_planks.png', upper: 'shield__wood_planks.png', split: 1.0 },
    house_timber:  { file: 'models/buildings/house_timber.glb', height: 5.0,
                     bands: [[0.20,'house_timber__stone_wall.png'],[0.72,'house_timber__wood_planks.png'],[1.01,'house_timber__roof_tiles.png']] },
    adventurer_base:{ file: 'models/characters/adventurer_base.glb', height: 1.95,
                     lower: 'adventurer_base__wood_planks.png', upper: 'adventurer_base__wood_planks.png', split: 1.0 }
  };
  var v2Parts = {}, v2Tex = {};

  function v2Texture(file) {
    if (v2Tex[file]) return v2Tex[file];
    var t = new THREE.TextureLoader().load(url('v2/textures/models/' + file));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    v2Tex[file] = t;
    return t;
  }

  /* Builds the model as a Group, one mesh per primitive with its own texture. */
  function v2Model(key) {
    var built = v2Parts[key];
    if (!built) return null;
    var grp = new THREE.Group();
    built.forEach(function (rec) {
      grp.add(new THREE.Mesh(rec.geo, rec.mat));
    });
    grp.userData.v2 = key;
    return grp;
  }
  function hasV2(key) { return !!(v2Parts[key] && v2Parts[key].length); }
  /* raw parts, for instancing: [{geo, mat}, ...] */
  function v2PartList(key) { return v2Parts[key] || null; }

  /* which authored model stands in for each tree species */
  var TREE_V2 = { Tree: 'tree_oak', Oak: 'tree_oak', Silverbirch: 'tree_oak',
                  Willow: 'tree_willow', Ironbark: 'tree_pine', Ghostwood: 'tree_dead' };
  function treeModelFor(kind) { return TREE_V2[kind] || 'tree_oak'; }

  function loadV2() {
    var keys = Object.keys(V2_SPEC);
    return Promise.all(keys.map(function (k) {
      var spec = V2_SPEC[k];
      return g.RFGlb.loadParts(url('v2/' + spec.file), { height: spec.height, zUp: true })
        .then(function (parts) {
          var box = new THREE.Box3();
          parts.forEach(function (p2) { box.union(p2.boundingBox); });
          var top = box.max.y, bottom = box.min.y, span = Math.max(0.001, top - bottom);
          v2Parts[k] = parts.map(function (geo) {
            var c = (geo.boundingBox.min.y + geo.boundingBox.max.y) / 2;
            var frac = (c - bottom) / span;
            var file;
            if (spec.bands) {
              file = spec.bands[spec.bands.length - 1][1];
              for (var bi = 0; bi < spec.bands.length; bi++) {
                if (frac <= spec.bands[bi][0]) { file = spec.bands[bi][1]; break; }
              }
            } else file = frac >= spec.split ? spec.upper : spec.lower;
            var isLeaf = /leaves/.test(file);
            var mat = new THREE.MeshLambertMaterial({
              map: v2Texture(file),
              side: isLeaf ? THREE.DoubleSide : THREE.FrontSide
            });
            return { geo: geo, mat: mat };
          });
        })
        .catch(function (e) { console.warn('Emberfall: v2 model ' + k + ' did not load:', e.message); });
    }));
  }

  function loadRigs() {
    var want = { male: 'characters/adventurer_male_rigged.glb',
                 female: 'characters/adventurer_female_rigged.glb' };
    return Promise.all(Object.keys(want).map(function (k) {
      return g.RFGlb.loadRigged(url('models/' + want[k]), { height: 1.95, zUp: false })
        .then(function (r) {
          /* one shared skin texture for both */
          var tex = new THREE.TextureLoader().load(url('hd/adventurer_base.png'));
          tex.anisotropy = 4;
          if (r.mesh && r.mesh.material) r.mesh.material.map = tex;
          rigs[k] = r;
        })
        .catch(function (e) { console.warn('Emberfall: rig ' + k + ' did not load:', e.message); });
    }));
  }

  function loadAll(onProgress) {
    return probe().then(function () { return loadAllInner(onProgress); });
  }

  function loadAllInner(onProgress) {
    var keys = Object.keys(CATALOGUE);
    var done = 0, failed = [];
    return Promise.all(keys.map(function (k) {
      var spec = CATALOGUE[k];
      return g.RFGlb.load(url('models/' + spec.file), { height: spec.height, zUp: true })
        .then(function (geo) { geoCache[k] = geo; })
        .catch(function (e) { failed.push(k + ': ' + e.message); })
        .then(function () {
          done++;
          if (onProgress) onProgress(done / keys.length);
        });
    })).then(function () {
      return loadV2();
    }).then(function () {
      return loadRigs();
    }).then(function () {
      MATERIALS.forEach(function (n) { texture(n, 1); });
      ready = true;
      if (failed.length) console.warn('Emberfall: some assets did not load:', failed);
      return { loaded: Object.keys(geoCache).length, failed: failed,
               viaPhp: viaPhp, blockedReason: blockedReason,
               v2: Object.keys(v2Parts).length, rigs: Object.keys(rigs).length };
    });
  }

  g.RFAssets = {
    loadAll: loadAll, mesh: mesh, geometry: geometry, material: material,
    texture: texture, footprint: footprint, has: has,
    hd: hd, hdFoliage: hdFoliage, HD_TEX: HD_TEX, rigged: rigged,
    v2Model: v2Model, hasV2: hasV2, V2_SPEC: V2_SPEC,
    v2PartList: v2PartList, treeModelFor: treeModelFor,
    balance: balance, balanceRGB: balanceRGB, MEAN: MEAN,
    CATALOGUE: CATALOGUE,
    /* used by the offline renderer to seed the cache without fetch */
    __inject: function (k, geo) { geoCache[k] = geo; ready = true; },
    get ready() { return ready; }
  };
})(window);
