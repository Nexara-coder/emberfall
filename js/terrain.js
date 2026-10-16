/* Emberfall - terrain renderer + collision grid.
   The heightmap is sampled once into a typed array at load time (the raw
   noise function is far too slow to call per-frame), then every gameplay
   query is an O(1) bilinear lookup. Meshes are built per chunk on demand
   and released when the player walks away. */
(function (g) {
  'use strict';
  var THREE = g.THREE, T = g.RFTerrain;

  var N = T.WORLD;              // 384
  var CH = 24;                  // chunk size in tiles
  var NC = N / CH;              // chunks per side
  var VIEW = 108;               // terrain draw distance

  var heights = null;           // Float32Array (N+1)^2
  var grounds = null;           // Uint8Array N^2
  var collide = null;           // Uint8Array N^2   (0 walkable, 1 blocked)
  var GROUND_ID = { water: 0, sand: 1, grass: 2, path: 3, dirt: 4, rock: 5, snow: 6, muck: 7, blight: 8 };
  /* Muted and earthy on purpose. Saturated greens and pure greys are what
     make low-poly worlds read as toy bricks; the 2005 palette sat much
     closer to olive, khaki and slate. */
  var GROUND_COL = {
    0: [0x2c, 0x4e, 0x62], 1: [0xc0, 0xb0, 0x84], 2: [0x62, 0x74, 0x3a], 3: [0x8c, 0x7e, 0x5c],
    4: [0x6b, 0x57, 0x3c], 5: [0x77, 0x74, 0x70], 6: [0xdc, 0xe2, 0xe6], 7: [0x4c, 0x54, 0x33],
    8: [0x5e, 0x52, 0x42]
  };

  function idxH(x, z) { return z * (N + 1) + x; }
  function idxT(x, z) { return z * N + x; }

  /* ---- build the sampled maps, yielding so the loader can paint --------- */
  function buildMaps(onProgress, done) {
    heights = new Float32Array((N + 1) * (N + 1));
    grounds = new Uint8Array(N * N);
    collide = new Uint8Array(N * N);
    var z = 0;
    var ROWS = 12;
    function step() {
      var end = Math.min(N + 1, z + ROWS);
      for (; z < end; z++) {
        for (var x = 0; x <= N; x++) heights[idxH(x, z)] = T.height(x, z);
      }
      if (z <= N) {
        onProgress && onProgress(z / (N + 1) * 0.75);
        setTimeout(step, 0);
      } else {
        // ground types from the sampled heights (tile centres)
        var zz = 0;
        function step2() {
          var e2 = Math.min(N, zz + 24);
          for (; zz < e2; zz++) {
            for (var xx = 0; xx < N; xx++) {
              var h = heights[idxH(xx, zz)];
              grounds[idxT(xx, zz)] = GROUND_ID[T.ground(xx + 0.5, zz + 0.5, h)] || 2;
            }
          }
          if (zz < N) { onProgress && onProgress(0.75 + zz / N * 0.25); setTimeout(step2, 0); }
          else { buildCollision(); onProgress && onProgress(1); done && done(); }
        }
        step2();
      }
    }
    step();
  }

  function buildCollision() {
    for (var z = 0; z < N; z++) {
      for (var x = 0; x < N; x++) {
        var h = heights[idxH(x, z)];
        var blocked = 0;
        if (h < 0.08) blocked = 1;                       // water
        else {
          // slope check against the four neighbours
          var mx = 0;
          if (x > 0) mx = Math.max(mx, Math.abs(heights[idxH(x - 1, z)] - h));
          if (x < N) mx = Math.max(mx, Math.abs(heights[idxH(x + 1, z)] - h));
          if (z > 0) mx = Math.max(mx, Math.abs(heights[idxH(x, z - 1)] - h));
          if (z < N) mx = Math.max(mx, Math.abs(heights[idxH(x, z + 1)] - h));
          if (mx > 1.55) blocked = 1;                    // cliff
        }
        /* A road is a road. Without this the mountain grade above Dunhollow
           counted as a cliff and walled the dwarves off from the rest of the
           world entirely - there was no walking route in. */
        if (blocked && h >= 0.08 && T.roadDist && T.roadDist(x, z) < 2.4) blocked = 0;
        collide[idxT(x, z)] = blocked;
      }
    }
  }

  /* ---- queries ---------------------------------------------------------- */
  function h(x, z) {
    if (!heights) return 0;
    if (x < 0) x = 0; if (z < 0) z = 0;
    if (x > N - 0.001) x = N - 0.001; if (z > N - 0.001) z = N - 0.001;
    var x0 = x | 0, z0 = z | 0, fx = x - x0, fz = z - z0;
    var a = heights[idxH(x0, z0)], b = heights[idxH(x0 + 1, z0)];
    var c = heights[idxH(x0, z0 + 1)], d = heights[idxH(x0 + 1, z0 + 1)];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  function ground(x, z) {
    if (!grounds) return 2;
    var xi = Math.max(0, Math.min(N - 1, x | 0)), zi = Math.max(0, Math.min(N - 1, z | 0));
    return grounds[idxT(xi, zi)];
  }
  function blockedAt(x, z) {
    var xi = x | 0, zi = z | 0;
    if (xi < 0 || zi < 0 || xi >= N || zi >= N) return 1;
    return collide[idxT(xi, zi)];
  }
  function setBlocked(x, z, v) {
    var xi = Math.round(x), zi = Math.round(z);
    if (xi < 0 || zi < 0 || xi >= N || zi >= N) return;
    collide[idxT(xi, zi)] = v;
  }
  /* stamp a filled circle (used for trees, rocks, props) */
  function stampCircle(cx, cz, r, v) {
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
    var z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
      var dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (dx * dx + dz * dz <= r * r) collide[idxT(x, z)] = v;
    }
  }
  /* stamp a line segment of given half-width (walls, fences) */
  function stampLine(x1, z1, x2, z2, halfW, v) {
    var len = Math.hypot(x2 - x1, z2 - z1);
    var steps = Math.max(1, Math.ceil(len * 2));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      stampCircle(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, halfW, v);
    }
  }
  function stampRect(cx, cz, w, d, v) {
    var x0 = Math.max(0, Math.floor(cx - w / 2)), x1 = Math.min(N - 1, Math.ceil(cx + w / 2));
    var z0 = Math.max(0, Math.floor(cz - d / 2)), z1 = Math.min(N - 1, Math.ceil(cz + d / 2));
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) collide[idxT(x, z)] = v;
  }

  /* ---- chunk meshes ------------------------------------------------------ */
  var chunks = {};              // key -> {mesh, cx, cz}
  var group = null;
  var noiseTint = function (x, z) {
    /* A very gentle large-scale variation so open fields are not perfectly
       uniform. It used to swing 0.88-1.12 per tile, which re-drew the tile
       grid in shading even after the colours were blended. */
    var a = T.hash(Math.floor(x / 4), Math.floor(z / 4), 77);
    var b = T.hash(Math.floor(x / 11), Math.floor(z / 11), 91);
    return 0.965 + a * 0.04 + b * 0.03;
  };

  /* When the authored terrain map is in use the tile colour has to be divided
     through by the map's own average, or every tile comes out near black. */
  var balanceCache = {};
  function balanceGround(rgb) {
    var key = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    if (balanceCache[key]) return balanceCache[key];
    var out;
    if (g.RFAssets && g.RFAssets.balanceRGB && usingAuthoredGround()) {
      out = g.RFAssets.balanceRGB('Terrain', rgb);
    } else {
      out = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    }
    balanceCache[key] = out;
    return out;
  }
  function usingAuthoredGround() {
    return !!(g.RFAssets && g.RFAssets.ready && g.RFAssets.texture);
  }

  /* Blends the four tiles meeting at a corner. Cached, because each corner is
     visited by up to four tiles. */
  var cornerCache = null;
  /* With the authored per-type terrain textures the COLOUR comes from the
     texture. The vertex colour must then be close to white with only a
     whisper of variation - leaving the old balanced tint in place multiplied
     the sheets by up to 2.4 and turned the road bright pink. */
  function hdGround() { return false; }

  function cornerColour(x, z) {
    if (!cornerCache) cornerCache = {};
    var key = x + ',' + z;
    var hit = cornerCache[key];
    if (hit) return hit;
    var r = 0, g2 = 0, b = 0, n = 0;
    for (var dx = -1; dx <= 0; dx++) {
      for (var dz = -1; dz <= 0; dz++) {
        var tx = x + dx, tz = z + dz;
        if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
        var base = GROUND_COL[grounds[idxT(tx, tz)]] || GROUND_COL[2];
        var bal = balanceGround(base);
        r += bal[0]; g2 += bal[1]; b += bal[2]; n++;
      }
    }
    if (!n) { var d = balanceGround(GROUND_COL[2]); r = d[0]; g2 = d[1]; b = d[2]; n = 1; }
    var t = noiseTint(x, z);
    var out;
    if (hdGround()) {
      /* texture carries the colour; vertex colour only shades it slightly */
      out = [t, t, t];
    } else {
      out = [r / n * t, g2 / n * t, b / n * t];
    }
    cornerCache[key] = out;
    return out;
  }

  var groundMat = null;
  function groundMaterial() {
    if (groundMat) return groundMat;
    /* One material per ground type, using the authored 1024px terrain sheets,
       drawn as geometry groups. The vertex colours still blend across tile
       corners, so the edge between grass and path is soft rather than a hard
       chequer. */
    var opts = { vertexColors: true, flatShading: false };
    /* Smooth shading on the ground. Flat shading made every tile a visibly
       separate slab, which is most of what "blocky ground" was. The hard
       colour boundaries between grass, dirt and path survive in the vertex
       colours; only the lighting is smoothed. */
    opts.flatShading = false;
    groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    return groundMat;
  }

  /* ground type -> authored texture, at a repeat that keeps the detail fine */
  var GROUND_TEX = {
    0: ['water', 0.18], 1: ['sand', 0.30], 2: ['grass', 0.30], 3: ['road', 0.35],
    4: ['dirt', 0.30], 5: ['rock', 0.28], 6: ['snow', 0.28], 7: ['swamp', 0.28],
    8: ['dirt_dark', 0.28]
  };
  var typeMats = {};
  function groundMaterialFor(gt) {
    /* Safe renderer: terrain colour comes from vertex colours only. */
    if (!typeMats[gt]) typeMats[gt] = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    return typeMats[gt];
  }

  function buildChunk(cx, cz) {
    var tiles = CH * CH;
    /* Tiles are emitted grouped by ground type so each group can carry its own
       texture; within a group the blended corner colours still apply. */
    var byType = {};
    for (var tz0 = 0; tz0 < CH; tz0++) {
      for (var tx0 = 0; tx0 < CH; tx0++) {
        var gx0 = cx * CH + tx0, gz0 = cz * CH + tz0;
        var gtk = grounds[idxT(gx0, gz0)];
        (byType[gtk] = byType[gtk] || []).push([gx0, gz0]);
      }
    }
    var order = Object.keys(byType);
    var pos = new Float32Array(tiles * 18);
    var col = new Float32Array(tiles * 18);
    var uvs = new Float32Array(tiles * 12);
    var p = 0, c = 0, u = 0;
    var groups = [], vertStart = 0;
    for (var oi = 0; oi < order.length; oi++) {
      var list = byType[order[oi]];
      for (var li = 0; li < list.length; li++) {
        var x = list[li][0], z = list[li][1];
        var h00 = heights[idxH(x, z)], h10 = heights[idxH(x + 1, z)];
        var h01 = heights[idxH(x, z + 1)], h11 = heights[idxH(x + 1, z + 1)];
        /* Colour is sampled at each CORNER from the four tiles that meet
           there, so grass fades into dirt and path instead of every tile
           being one flat slab. Painting a single colour across both triangles
           is what made the ground look like pixel art from above. */
        var c00 = cornerColour(x, z), c10 = cornerColour(x + 1, z);
        var c01 = cornerColour(x, z + 1), c11 = cornerColour(x + 1, z + 1);
        // two triangles, wound CCW when viewed from above
        var tri = [
          x, h00, z, x, h01, z + 1, x + 1, h10, z,
          x + 1, h10, z, x, h01, z + 1, x + 1, h11, z + 1
        ];
        var triCol = [c00, c01, c10, c10, c01, c11];
        for (var i = 0; i < 18; i++) pos[p++] = tri[i];
        for (var j = 0; j < 6; j++) { col[c++] = triCol[j][0]; col[c++] = triCol[j][1]; col[c++] = triCol[j][2]; }
        for (var k = 0; k < 18; k += 3) { uvs[u++] = tri[k] * 0.34; uvs[u++] = tri[k + 2] * 0.34; }
      }
      groups.push({ start: vertStart, count: list.length * 6, type: +order[oi] });
      vertStart += list.length * 6;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    var mats = groups.map(function (gr) { return groundMaterialFor(gr.type); });
    groups.forEach(function (gr, i) { geo.addGroup(gr.start, gr.count, i); });
    var mesh = new THREE.Mesh(geo, mats.length ? mats : groundMaterial());
    mesh.receiveShadow = false;
    return mesh;
  }

  function update(px, pz) {
    var pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH);
    var rad = Math.ceil(VIEW / CH);
    var want = {};
    for (var dz = -rad; dz <= rad; dz++) {
      for (var dx = -rad; dx <= rad; dx++) {
        var cx = pcx + dx, cz = pcz + dz;
        if (cx < 0 || cz < 0 || cx >= NC || cz >= NC) continue;
        var ccx = (cx + 0.5) * CH, ccz = (cz + 0.5) * CH;
        if (Math.hypot(ccx - px, ccz - pz) > VIEW + CH) continue;
        var k = cx + ',' + cz;
        want[k] = 1;
        if (!chunks[k]) {
          var mesh = buildChunk(cx, cz);
          group.add(mesh);
          chunks[k] = { mesh: mesh, cx: cx, cz: cz };
        }
      }
    }
    for (var key in chunks) {
      if (!want[key]) {
        group.remove(chunks[key].mesh);
        chunks[key].mesh.geometry.dispose();
        delete chunks[key];
      }
    }
  }

  /* ---- water ------------------------------------------------------------- */
  var water = null, waterGeo = null, waterBase = null;
  function makeWater(scene) {
    var SZ = 230, SEG = 26;
    waterGeo = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG);
    waterGeo.rotateX(-Math.PI / 2);
    waterBase = waterGeo.attributes.position.array.slice();
    var wm = new THREE.MeshLambertMaterial({
      color: 0x2f6f9a, transparent: true, opacity: 0.78, side: THREE.DoubleSide
    });
    water = new THREE.Mesh(waterGeo, wm);
    water.renderOrder = 1;
    scene.add(water);
    // seabed so deep water isn't see-through to the void
    var bed = new THREE.Mesh(new THREE.PlaneGeometry(SZ + 60, SZ + 60),
      new THREE.MeshBasicMaterial({ color: 0x1d3b4a }));
    bed.rotateX(-Math.PI / 2);
    bed.position.y = -7.5;
    scene.add(bed);
    water.bed = bed;
    return water;
  }
  function updateWater(px, pz, t) {
    if (!water) return;
    water.position.set(Math.round(px), -0.06, Math.round(pz));
    water.bed.position.x = water.position.x; water.bed.position.z = water.position.z;
    var a = waterGeo.attributes.position.array;
    for (var i = 0; i < a.length; i += 3) {
      var bx = waterBase[i], bz = waterBase[i + 2];
      a[i + 1] = Math.sin((bx + water.position.x) * 0.18 + t * 1.1) * 0.13
               + Math.cos((bz + water.position.z) * 0.22 - t * 0.9) * 0.11;
    }
    waterGeo.attributes.position.needsUpdate = true;
    waterGeo.computeVertexNormals();
  }

  function init(scene, onProgress, done) {
    group = new THREE.Group();
    scene.add(group);
    makeWater(scene);
    buildMaps(onProgress, done);
  }

  g.RFTerrainMgr = {
    init: init, update: update, updateWater: updateWater,
    h: h, ground: ground, blockedAt: blockedAt, setBlocked: setBlocked,
    stampCircle: stampCircle, stampLine: stampLine, stampRect: stampRect,
    GROUND_ID: GROUND_ID, GROUND_COL: GROUND_COL,
    get grid() { return collide; }, get heights() { return heights; },
    N: N, CH: CH, VIEW: VIEW,
    get group() { return group; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
