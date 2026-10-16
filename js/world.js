/* Emberfall - builds the scene from data/world.json and owns everything
   static: scenery, buildings, doors, collision stamps and the pick list used
   for click-to-interact. */
(function (g) {
  'use strict';
  var THREE = g.THREE, M = g.RFModels, TM = g.RFTerrainMgr;

  var W = null;                    // world.json
  var scene = null;
  var objectsById = {};            // id -> record
  var interactables = [];
  /* Bridge decks, so walking onto one lifts you out of the river instead of
     leaving you wading along the riverbed underneath it. */
  var bridgeSpans = [];
  var treeCells = {};              // cellKey|kind -> instanced record
  var buildings = [];
  var propObjs = [];
  var signTextures = [];
  var DRAW = 120;                  // scenery draw distance

  var dummy = new THREE.Object3D();

  /* ---- helpers ---------------------------------------------------------- */
  function cellKey(x, z) { return (Math.floor(x / 48)) + '_' + (Math.floor(z / 48)); }

  function makeSignTexture(text) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    var x = c.getContext('2d');
    x.fillStyle = '#9a7a4a'; x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#6a5230'; x.fillRect(0, 0, 256, 6); x.fillRect(0, 90, 256, 6);
    x.fillStyle = '#2e2318';
    x.font = 'bold 21px Georgia, serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    var words = String(text).split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width > 232) { if (cur) lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    lines = lines.slice(0, 3);
    var y0 = 48 - (lines.length - 1) * 13;
    lines.forEach(function (l, i) { x.fillText(l, 128, y0 + i * 26); });
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    signTextures.push(tex);
    return tex;
  }

  /* ---- trees (instanced per map cell + kind) ----------------------------- */
  function buildTrees(list) {
    var groups = {};
    list.forEach(function (o) {
      var k = cellKey(o.x, o.z) + '|' + o.k;
      (groups[k] = groups[k] || []).push(o);
    });
    Object.keys(groups).forEach(function (key) {
      var arr = groups[key];
      var kind = key.split('|')[1];
      var s = M.TREESPEC[kind] || M.TREESPEC.Tree;
      var rec = { objs: arr, parts: [], stumps: null, kind: kind, idx: {}, center: new THREE.Vector3() };

      /* Each species is built once as a full tree - trunk, roots, limbs and
         massed foliage - then merged into a single geometry with its colours
         baked into vertex colours, so it can still be instanced. */
      /* Authored model first: one instanced mesh per part, each keeping the
         texture that belongs to it. */
      var A2 = g.RFAssets;
      if (A2 && A2.hasV2 && A2.treeModelFor && A2.hasV2(A2.treeModelFor(kind))) {
        var partList = A2.v2PartList(A2.treeModelFor(kind));
        partList.forEach(function (part) {
          var im = new THREE.InstancedMesh(part.geo, part.mat, arr.length);
          im.userData.treeRec = rec;
          im.frustumCulled = false;
          rec.parts.push({ mesh: im, y: 0, scale: 1 });
        });
        rec.authored = true;
        rec.v2 = true;
      } else {
      /* Two instanced meshes per species: solid wood, and alpha-cut foliage.
         Merging them into one would have made the canopies solid again in the
         world even though they look right on their own. */
      var famGeo = M.treeGeometry(kind, 0);
      var woodMat = new THREE.MeshLambertMaterial({
        vertexColors: true, flatShading: false,
        map: (g.RFTextures ? g.RFTextures.texture('bark', 1) : null)
      });
      var leafMat2 = new THREE.MeshLambertMaterial({
        vertexColors: true, flatShading: false,
        transparent: true, alphaTest: 0.45, side: THREE.DoubleSide,
        map: (g.RFTextures ? g.RFTextures.texture('foliage', [6, 2]) : null)
      });
      [['wood', woodMat], ['leaves', leafMat2]].forEach(function (pair) {
        var geoPart = famGeo[pair[0]];
        if (!geoPart || !geoPart.attributes.position || !geoPart.attributes.position.count) return;
        var mesh2 = new THREE.InstancedMesh(geoPart, pair[1], arr.length);
        mesh2.userData.treeRec = rec;
        mesh2.frustumCulled = false;
        rec.parts.push({ mesh: mesh2, y: 0, scale: 1 });
      });
      rec.authored = true;
      }

      for (var i = 0; i < (rec.authored ? 0 : s.tiers); i++) {
        var t = s.tiers > 1 ? i / (s.tiers - 1) : 0;
        var r = s.canopy * (1 - t * 0.45);
        var y = s.h * 0.72 + i * (s.canopy * 0.42) + (s.droop ? s.canopy * 0.4 : 0);
        var cgeo = M.cone(r, s.canopy * 0.95, 6);
        var cm = new THREE.InstancedMesh(cgeo, M.texMat(s.leaf, 'leaf', 2), arr.length);
        cm.userData.treeRec = rec;
        rec.parts.push({ mesh: cm, y: y, flip: !!s.droop });
      }
      // stumps share one instanced mesh, hidden until a tree is cut
      var stGeo = M.cyl(s.r, s.r * 1.1, 0.45, 6);
      var stMesh = new THREE.InstancedMesh(stGeo, M.texMat(s.trunk, 'bark', 1), arr.length);
      rec.stumps = stMesh;

      var cx = 0, cz = 0;
      arr.forEach(function (o, idx) {
        rec.idx[o.i] = idx;
        objectsById[o.i] = { data: o, rec: rec, idx: idx, type: 'tree' };
        cx += o.x; cz += o.z;
        setTreeInstance(rec, idx, o, true);
        // stump hidden
        dummy.position.set(o.x, -999, o.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
        dummy.updateMatrix(); stMesh.setMatrixAt(idx, dummy.matrix);
        TM.stampCircle(o.x, o.z, Math.max(0.7, s.r * 2.2), 1);
      });
      rec.center.set(cx / arr.length, 0, cz / arr.length);
      rec.parts.forEach(function (p) {
        p.mesh.instanceMatrix.needsUpdate = true;
        /* Bounds must span the instances, not the base mesh at the origin,
           or the ray test rejects the whole batch before checking any tree. */
        if (p.mesh.computeBoundingSphere) p.mesh.computeBoundingSphere();
        /* An InstancedMesh keeps the bounding sphere of its BASE geometry,
           which sits at the origin. Three.js then frustum-culls the whole
           batch whenever the origin is off screen, so entire stands of trees
           vanish depending on where the camera looks. */
        p.mesh.frustumCulled = false;
        scene.add(p.mesh);
        interactables.push(p.mesh);
      });
      stMesh.instanceMatrix.needsUpdate = true;
      if (stMesh.computeBoundingSphere) stMesh.computeBoundingSphere();
      scene.add(stMesh);
      treeCells[key] = rec;
    });
  }

  function setTreeInstance(rec, idx, o, alive) {
    rec.parts.forEach(function (p) {
      if (!alive) {
        dummy.position.set(o.x, -999, o.z);
        dummy.scale.setScalar(0.0001);
      } else {
        dummy.position.set(o.x, o.y + p.y * (o.sc || 1), o.z);
        dummy.scale.setScalar(o.sc || 1);
      }
      dummy.rotation.set(p.flip ? Math.PI : 0, o.rot || 0, 0);
      dummy.updateMatrix();
      p.mesh.setMatrixAt(idx, dummy.matrix);
      p.mesh.instanceMatrix.needsUpdate = true;
    });
    if (rec.stumps) {
      dummy.rotation.set(0, o.rot || 0, 0);
      dummy.scale.setScalar(o.sc || 1);
      dummy.position.set(o.x, alive ? -999 : o.y + 0.22, o.z);
      dummy.updateMatrix();
      rec.stumps.setMatrixAt(idx, dummy.matrix);
      rec.stumps.instanceMatrix.needsUpdate = true;
    }
  }

  function setTreeState(objId, alive) {
    var r = objectsById[objId];
    if (!r || r.type !== 'tree') return;
    setTreeInstance(r.rec, r.idx, r.data, alive);
    TM.stampCircle(r.data.x, r.data.z, Math.max(0.7, 1.0), alive ? 1 : 0);
  }

  /* ---- rocks, props, scenery --------------------------------------------- */
  /* Swaps in an authored mesh where the pack has one that is better than the
     procedural version. Collision comes from the model's bounding box, not its
     triangles, so nobody gets wedged on a corner. */
  function authored(key, tint, mat) {
    var A = g.RFAssets;
    if (!A || !A.has || !A.has(key)) return null;
    return A.mesh(key, { tint: tint, mat: mat });
  }

  function placeSimple(o) {
    var node = null, collideR = 0;
    switch (o.t) {
      case 'rock':
        var ore = authored('boulder', M.ORECOL[o.ore] || '#9a968c', 'Stone');
        if (ore) {
          node = new THREE.Group();
          node.add(ore);
          var spent = authored('boulder', '#7e7a72', 'Stone');
          node.userData.depletedModel = spent || M.rock(o.ore, true);
        } else {
          node = M.rock(o.ore, false);
          node.userData.depletedModel = M.rock(o.ore, true);
        }
        collideR = 1.1;
        break;
      case 'sign':
        if (g.RFAssets && g.RFAssets.hasV2 && g.RFAssets.hasV2('signpost')) {
          node = g.RFAssets.v2Model('signpost');
          /* Keep the authored post but overlay the dynamic wording the world
             data requires.  A tiny offset prevents z-fighting with its board. */
          var label = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.48),
            new THREE.MeshBasicMaterial({ map: makeSignTexture(o.txt), transparent: true, side: THREE.DoubleSide }));
          label.position.set(0, 1.78, 0.10);
          node.add(label);
        } else {
          node = M.prop('sign');
          var board = node.children[1];
          board.material = new THREE.MeshLambertMaterial({ map: makeSignTexture(o.txt), flatShading: true });
        }
        collideR = 0.4;
        break;
      case 'fish':
        node = M.prop('fish'); collideR = 0; break;
      case 'herb':
        node = M.prop('herb', { c: herbColour(o.h) }); collideR = 0; break;
      case 'flax': node = M.prop('flax'); collideR = 0; break;
      case 'hunt': node = M.prop('hunt'); collideR = 0; break;
      case 'patch': node = M.prop('patch'); collideR = 0; break;
      case 'agility': node = M.prop('agility', o); collideR = 0; break;
      case 'altar_rc': node = M.prop('altar_rc', { c: runeColour(o.rune) }); collideR = 1.6; break;
      case 'rift': node = M.prop('rift'); collideR = 1.6; break;
      case 'bridge':
        node = M.prop('bridge', { len: o.len || 16 });
        node.position.y = 0;
        break;
      case 'well':
        node = (g.RFAssets && g.RFAssets.hasV2 && g.RFAssets.hasV2('well')) ? g.RFAssets.v2Model('well') : M.prop('well', o);
        collideR = 1.1; break;
      case 'barrel':
        node = (g.RFAssets && g.RFAssets.hasV2 && g.RFAssets.hasV2('barrel')) ? g.RFAssets.v2Model('barrel') : M.prop('barrel', o);
        collideR = 0.5; break;
      case 'fence':
        node = (g.RFAssets && g.RFAssets.hasV2 && g.RFAssets.hasV2('fence_section')) ? g.RFAssets.v2Model('fence_section') : M.prop('fence', o);
        collideR = 0.55; break;
      default:
        node = M.prop(o.t, o);
        collideR = ({ statue: 1.4, well: 1.1, fountain: 1.9, obelisk: 1.2, ruin_arch: 1.0,
          brazier: 0.6, cart: 1.4, crate: 0.7, barrel: 0.5, anvil: 0.9, furnace: 1.3,
          range: 1.1, bank_booth: 1.4, dungeon: 1.8, standing_stone: 0.7,
          spinning_wheel: 0.7, pottery_wheel: 0.7, loom: 0.9, altar: 1.3 })[o.t] || 0;
    }
    if (!node) return;
    node.position.set(o.x, o.y, o.z);
    if (o.rot) node.rotation.y = o.rot;
    node.userData.rfObj = o.i;
    scene.add(node);
    interactables.push(node);
    propObjs.push({ node: node, o: o });
    objectsById[o.i] = { data: o, node: node, type: o.t };

    if (o.t === 'bridge') {
      /* The deck mesh is built along its local Z and then rotated, so the
         span direction in the world is (sin rot, cos rot). Clearing a fixed
         axis-aligned rectangle left the corridor at right angles to the
         actual bridge, which is why it could not be crossed. */
      var len = o.len || 16;
      var rot = o.rot || 0;
      var sx = Math.sin(rot), cz = Math.cos(rot);
      var alongX = Math.abs(sx) > Math.abs(cz);
      /* a little longer than the deck so both banks are reachable */
      if (alongX) TM.stampRect(o.x, o.z, len + 4, 5.0, 0);
      else TM.stampRect(o.x, o.z, 5.0, len + 4, 0);
      bridgeSpans.push({
        x: o.x, z: o.z, y: (o.y || 0) + 0.28,
        sx: sx, cz: cz,
        half: len / 2 + 2.0, wide: 2.4
      });
    } else if (collideR > 0) {
      TM.stampCircle(o.x, o.z, collideR, 1);
    }
  }

  function herbColour(name) {
    var map = { Marshleaf: '#6f8f4a', Bitterroot: '#8a7a3a', Redthistle: '#a84a3a', Blueleaf: '#4a6fa8',
      Duskcap: '#6a4a7a', Emberroot: '#c46a2a', Frostvine: '#8fc4d6', Goldenseal: '#d6b83a' };
    return map[name] || '#6f8f4a';
  }
  function runeColour(name) {
    var map = { Air: '#cfe4ef', Water: '#3f7fd0', Earth: '#7a5a34', Fire: '#d2582c', Mind: '#c9c4d8',
      Body: '#c08a6a', Chaos: '#8b2f6a', Nature: '#3f9b52', Cosmic: '#6f5fc0', Law: '#4a7fb5',
      Death: '#4a4a52', Soul: '#d8c86a' };
    return map[name] || '#cfe4ef';
  }

  /* ---- buildings ---------------------------------------------------------- */
  function placeBuilding(b) {
    var node = M.building(b);
    node.position.set(b.x, b.y, b.z);
    node.rotation.y = b.rot || 0;
    node.userData.rfBuilding = b.id;
    scene.add(node);
    interactables.push(node);

    // roof material must be unique per building so we can fade just this one
    var roofMats = [];
    node.roof.traverse(function (o) {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        roofMats.push(o.material);
      }
    });

    var rec = {
      b: b, node: node, roof: node.roof, roofMats: roofMats, roofAlpha: 1,
      doorHinge: node.doorHinge, doorOpen: false, doorT: 0,
      dims: node.dims, props: node.props || []
    };
    buildings.push(rec);

    // stamp wall collision in world space
    var cos = Math.cos(b.rot || 0), sin = Math.sin(b.rot || 0);
    function toWorld(lx, lz) { return [b.x + lx * cos + lz * sin, b.z - lx * sin + lz * cos]; }
    node.wallSegs.forEach(function (w) {
      var a = toWorld(w.x1, w.z1), c = toWorld(w.x2, w.z2);
      if (w.r) TM.stampCircle(a[0], a[1], w.r, 1);
      else TM.stampLine(a[0], a[1], c[0], c[1], 0.55, 1);
    });
    // furniture collision
    (node.props || []).forEach(function (p) {
      var r = ({ table: 1.0, bed: 1.0, counter: 1.5, shelf: 0.9, anvil: 0.8, furnace: 1.2,
        range: 1.0, altar: 1.2, throne: 0.9, stall: 1.2, fireplace: 1.0, pew: 1.1,
        crate: 0.6, barrel: 0.5, brazier: 0.5, obelisk: 1.0, spinning_wheel: 0.6,
        pottery_wheel: 0.6, chair: 0.4, candle: 0 })[p.type];
      if (!r) return;
      var w = toWorld(p.x, p.z);
      TM.stampCircle(w[0], w[1], r, 1);
    });
    // carve the doorway open so pathfinding can enter
    var dw = node.doorW, ds = node.doorSide, doff = node.doorOff;
    var dim = node.dims;
    var dpos;
    if (ds === 0) dpos = toWorld(doff, dim.d / 2);
    else if (ds === 2) dpos = toWorld(doff, -dim.d / 2);
    else if (ds === 1) dpos = toWorld(dim.w / 2, doff);
    else dpos = toWorld(-dim.w / 2, doff);
    TM.stampCircle(dpos[0], dpos[1], dw * 0.42, 0);
    rec.doorWorld = { x: dpos[0], z: dpos[1] };
    return rec;
  }

  /* Is a world point inside this building's footprint? */
  function insideBuilding(rec, x, z) {
    var b = rec.b, d = rec.dims;
    var dx = x - b.x, dz = z - b.z;
    var cos = Math.cos(-(b.rot || 0)), sin = Math.sin(-(b.rot || 0));
    var lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    return Math.abs(lx) < d.w / 2 + 0.2 && Math.abs(lz) < d.d / 2 + 0.2;
  }

  /* ---- build the whole world ---------------------------------------------- */
  function build(sc, worldData) {
    scene = sc; W = worldData;
    var trees = [], others = [];
    W.objects.forEach(function (o) { (o.t === 'tree' ? trees : others).push(o); });
    buildTrees(trees);
    others.forEach(placeSimple);
    W.buildings.forEach(placeBuilding);
    // fence off the map edge so players can't walk into the void
    for (var i = 0; i < TM.N; i++) {
      TM.setBlocked(i, 0, 1); TM.setBlocked(i, TM.N - 1, 1);
      TM.setBlocked(0, i, 1); TM.setBlocked(TM.N - 1, i, 1);
    }
  }

  /* ---- per-frame ---------------------------------------------------------- */
  var insideNow = null;
  function update(px, pz, dt) {
    // scenery distance culling
    for (var k in treeCells) {
      var rec = treeCells[k];
      var vis = Math.hypot(rec.center.x - px, rec.center.z - pz) < DRAW + 40;
      rec.parts.forEach(function (p) { p.mesh.visible = vis; });
      rec.stumps.visible = vis;
    }
    for (var i = 0; i < propObjs.length; i++) {
      var p = propObjs[i];
      p.node.visible = Math.hypot(p.o.x - px, p.o.z - pz) < DRAW;
    }
    // buildings: visibility + roof fade when the player is inside
    var newInside = null;
    for (var b = 0; b < buildings.length; b++) {
      var rec2 = buildings[b];
      var d = Math.hypot(rec2.b.x - px, rec2.b.z - pz);
      rec2.node.visible = d < DRAW + 30;
      if (d < 30 && insideBuilding(rec2, px, pz)) newInside = rec2;
      // roof fade
      var target = (newInside === rec2) ? 0 : 1;
      if (rec2.roofAlpha !== target) {
        var sgn = target > rec2.roofAlpha ? 1 : -1;
        rec2.roofAlpha = Math.max(0, Math.min(1, rec2.roofAlpha + sgn * dt * 4.5));
        for (var mI = 0; mI < rec2.roofMats.length; mI++) rec2.roofMats[mI].opacity = rec2.roofAlpha;
        rec2.roof.visible = rec2.roofAlpha > 0.02;
      }
      // door swing
      if (rec2.doorHinge) {
        var want = rec2.doorOpen ? -1.6 : 0;
        var cu = rec2.doorHinge.rotation.y - (rec2._baseRot === undefined ? (rec2._baseRot = rec2.doorHinge.rotation.y) : rec2._baseRot);
        var nv = cu + (want - cu) * Math.min(1, dt * 8);
        rec2.doorHinge.rotation.y = rec2._baseRot + nv;
      }
    }
    insideNow = newInside;
  }

  function openDoorNear(x, z, open) {
    var best = null, bd = 3.0;
    buildings.forEach(function (r) {
      if (!r.doorWorld) return;
      var d = Math.hypot(r.doorWorld.x - x, r.doorWorld.z - z);
      if (d < bd) { bd = d; best = r; }
    });
    if (best) {
      best.doorOpen = open === undefined ? !best.doorOpen : open;
      return best;
    }
    return null;
  }

  function buildingAt(x, z) {
    for (var i = 0; i < buildings.length; i++) if (insideBuilding(buildings[i], x, z)) return buildings[i];
    return null;
  }

  /* Resolve a raycast hit into a world object id. */
  function resolveHit(hit) {
    var o = hit.object;
    if (o.userData.treeRec && hit.instanceId !== undefined && hit.instanceId !== null) {
      var rec = o.userData.treeRec;
      var data = rec.objs[hit.instanceId];
      return data ? data.i : null;
    }
    var cur = o;
    while (cur) {
      if (cur.userData && cur.userData.rfObj !== undefined) return cur.userData.rfObj;
      cur = cur.parent;
    }
    return null;
  }
  function resolveBuilding(hit) {
    var cur = hit.object;
    while (cur) {
      if (cur.userData && cur.userData.rfBuilding !== undefined) return cur.userData.rfBuilding;
      cur = cur.parent;
    }
    return null;
  }

  function setRockDepleted(objId, depleted) {
    var r = objectsById[objId];
    if (!r || r.type !== 'rock' || !r.node) return;
    // swap the ore nuggets off / on by toggling child visibility past index 1
    for (var i = 2; i < r.node.children.length; i++) r.node.children[i].visible = !depleted;
    r.node.children[0].material = M.mat(depleted ? '#5f5f66' : '#7b7b83');
  }

  /* Deck height at a point, or null if you are not on a bridge. */
  function bridgeHeightAt(x, z) {
    for (var i = 0; i < bridgeSpans.length; i++) {
      var b = bridgeSpans[i];
      var dx = x - b.x, dz = z - b.z;
      var along = dx * b.sx + dz * b.cz;    // along the deck
      var across = dx * b.cz - dz * b.sx;   // across it
      if (Math.abs(along) <= b.half && Math.abs(across) <= b.wide) return b.y;
    }
    return null;
  }

  g.RFWorld = {
    build: build, update: update,
    get objects() { return objectsById; },
    get interactables() { return interactables; },
    get buildings() { return buildings; },
    get inside() { return insideNow; },
    resolveHit: resolveHit, resolveBuilding: resolveBuilding,
    bridgeHeightAt: bridgeHeightAt,
    setTreeState: setTreeState, setRockDepleted: setRockDepleted,
    openDoorNear: openDoorNear, buildingAt: buildingAt,
    herbColour: herbColour, runeColour: runeColour,
    DRAW: DRAW
  };
})(typeof window !== 'undefined' ? window : globalThis);
