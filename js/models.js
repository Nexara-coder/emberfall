/* Emberfall - procedural low-poly model library.
   Everything in the world is built from code at load time: no binary meshes,
   no textures, nothing to 404. Flat-shaded Lambert materials give the
   chunky early-3D look. */
(function (g) {
  'use strict';
  var THREE = g.THREE;

  /* ---- shared material / geometry cache ------------------------------ */
  var matCache = {}, geoCache = {};
  /* Bodies are shaded smoothly. Flat shading on a six-sided cylinder is what
     makes a limb look like a hexagonal post; the same geometry with smooth
     normals and a few more sides reads as an arm. */
  function shadeHex(hex, f) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    var r = Math.round(((n >> 16) & 255) * f), g2 = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g2 + ',' + b + ')';
  }

  /* Foliage material: the leaf sheet with its transparency kept, cut out with
     alphaTest rather than blended, so the crown has a ragged edge and sky
     shows through it. Double-sided, because you see the underside of a canopy
     from below. */
  function foliageMat(color, repeat) {
    var key = 'safeFol|' + color;
    if (matCache[key]) return matCache[key];
    var mm = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color), emissive: new THREE.Color(color).multiplyScalar(0.055), side: THREE.DoubleSide, transparent: false, opacity: 1, flatShading: true
    });
    matCache[key] = mm;
    return mm;
  }

  function bodyMat(color) {
    var key = 'body|' + color;
    if (matCache[key]) return matCache[key];
    var m2 = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color).multiplyScalar(0.045), flatShading: false });
    matCache[key] = m2;
    return m2;
  }

  function mat(color, opts) {
    opts = opts || {};
    var key = color + '|' + (opts.flat ? 1 : 0) + '|' + (opts.op || 1) + '|' + (opts.emissive || '') + '|' + (opts.side || 0);
    if (matCache[key]) return matCache[key];
    var baseColor = new THREE.Color(color);
    var m = new THREE.MeshLambertMaterial({
      color: baseColor,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : baseColor.clone().multiplyScalar(0.035),
      transparent: opts.op !== undefined && opts.op < 1,
      opacity: opts.op === undefined ? 1 : opts.op,
      side: opts.side || THREE.FrontSide,
      flatShading: !!opts.flat
    });
    matCache[key] = m;
    return m;
  }
  /* Colour tinted by a tiling texture. RS2 painted stone, plank and thatch
     onto simple shapes; untinted flat colour is what reads as plastic. */
  function texMat(color, texName, repeat, opts) {
    /* Safe renderer: never attach a texture map.  A bad/black texture must
       not be able to black out otherwise valid geometry. */
    return mat(color, opts || {});
  }

  function box(w, h, d) {
    var k = 'b' + w + '_' + h + '_' + d;
    if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(w, h, d);
    return geoCache[k];
  }
  function cyl(rt, rb, h, seg) {
    var k = 'c' + rt + '_' + rb + '_' + h + '_' + seg;
    if (!geoCache[k]) geoCache[k] = new THREE.CylinderGeometry(rt, rb, h, seg || 7);
    return geoCache[k];
  }
  function cone(r, h, seg) {
    var k = 'n' + r + '_' + h + '_' + seg;
    if (!geoCache[k]) geoCache[k] = new THREE.ConeGeometry(r, h, seg || 7);
    return geoCache[k];
  }
  function sph(r, w, h) {
    var k = 's' + r + '_' + w + '_' + h;
    if (!geoCache[k]) geoCache[k] = new THREE.SphereGeometry(r, w || 7, h || 5);
    return geoCache[k];
  }
  function m(geo, material, x, y, z) {
    var o = new THREE.Mesh(geo, material);
    o.position.set(x || 0, y || 0, z || 0);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }

  /* ==================================================================== */
  /*  CHARACTERS                                                          */
  /* ==================================================================== */
  /* A humanoid is a small hierarchy of boxes with named pivots so the
     animation code can rotate limbs directly. Unit height is about 1.8. */
  function humanoid(app) {
    app = app || {};
    var skin = app.skin || '#e0b892';
    var shirt = app.shirt || '#8a8a4a';
    var legs = app.legs || '#2f7a46';
    var hairC = app.hair || '#3a2a20';
    var boots = app.boots || '#4a3524';
    var root = new THREE.Group();
    var body = new THREE.Group(); root.add(body); root.body = body;

    var torsoMat = bodyMat(shirt);
    var sleeveMat = bodyMat(shadeHex(shirt, 0.86));   // shoulder caps sit darker
    var neckMat  = bodyMat(shadeHex(shirt, 0.72));    // the V of the neckline
    var skinMat  = bodyMat(skin);
    var legMat   = bodyMat(legs);
    var legDark  = bodyMat(shadeHex(legs, 0.80));     // inner-leg seam
    var beltMat  = bodyMat('#7a2f2a');
    var bootMat  = bodyMat(boots);
    var bracerMat = bodyMat('#9aa0aa');
    var slim = app.build === 1 ? 0.90 : 1.0;

    /* The silhouette this is built to: very broad angular shoulders flaring
       out and down over a short torso that narrows hard to a belt, long legs
       that taper from wide hips to the ankle, bare forearms ending in closed
       fists, and a small egg-shaped head. Low polygon counts on purpose -
       the facets are the look, not an accident. */

    // ---- legs: wide at the hip, tapering to the ankle, feet apart --------
    function leg(side) {
      var p = new THREE.Group();
      p.position.set(side * 0.130 * slim, 0.92, 0);
      p.rotation.z = -side * 0.055;                 // a slight outward stance
      var thigh = m(cyl(0.158 * slim, 0.108, 0.46, 8), legMat, 0, -0.23, 0);
      thigh.scale.set(1, 1, 0.86); p.add(thigh);
      var calf = m(cyl(0.105, 0.070, 0.40, 8), legMat, 0, -0.65, 0);
      calf.scale.set(1, 1, 0.86); p.add(calf);
      /* a darker inner face gives the trouser its centre seam */
      var seam = m(box(0.012, 0.84, 0.11), legDark, -side * 0.055, -0.44, 0);
      p.add(seam);
      p.add(m(cyl(0.086, 0.094, 0.24, 8), bootMat, 0, -0.895, 0));
      var foot = m(cyl(0.082, 0.090, 0.24, 8), bootMat, 0, -0.985, 0.065);
      foot.rotation.x = Math.PI / 2; foot.scale.set(1.0, 1.0, 0.55);
      p.add(foot);
      body.add(p);
      return p;
    }
    root.legR = leg(1); root.legL = leg(-1);

    // ---- hips and belt ---------------------------------------------------
    var hips = m(cyl(0.248 * slim, 0.222 * slim, 0.17, 10), legMat, 0, 0.955, 0);
    hips.scale.set(1, 1, 0.82); body.add(hips);
    var belt = m(cyl(0.254 * slim, 0.250 * slim, 0.090, 10), beltMat, 0, 1.055, 0);
    belt.scale.set(1, 1, 0.82); body.add(belt);

    // ---- torso: short, and it narrows hard into the belt -----------------
    var trunk = m(cyl(0.335 * slim, 0.232 * slim, 0.40, 10), torsoMat, 0, 1.30, 0);
    trunk.scale.set(1, 1, 0.74); body.add(trunk); root.torso = trunk;
    var upper = m(cyl(0.348 * slim, 0.335 * slim, 0.13, 10), torsoMat, 0, 1.560, 0);
    upper.scale.set(1, 1, 0.76); body.add(upper);
    /* the V of the neckline, in a darker shade */
    /* Neckline: a shallow darker collar band rather than a separate wedge.
       Every version of the wedge poked through the chest or read as a stray
       dark shard at the shoulder, and the band does the job. */
    var neckBand = m(cyl(0.125, 0.150, 0.05, 10), neckMat, 0, 1.622, 0.012);
    neckBand.scale.set(1, 1, 0.80); body.add(neckBand);

    // ---- shoulder caps: the defining feature -----------------------------
    /* Broad angular caps that flare outward and DOWN over the upper arm,
       rather than round pads sitting on top of the shoulder. */
    [-1, 1].forEach(function (sd) {
      var cap = m(cyl(0.158 * slim, 0.214 * slim, 0.30, 7), sleeveMat,
                  sd * 0.296 * slim, 1.468, 0);
      cap.rotation.z = sd * 0.46;
      cap.scale.set(1, 1, 0.84);
      body.add(cap);
    });

    // ---- neck and head ----------------------------------------------------
    body.add(m(cyl(0.080, 0.098, 0.10, 8), skinMat, 0, 1.645, 0));

    var headG = new THREE.Group(); headG.position.set(0, 1.700, 0);
    body.add(headG); root.head = headG;
    var head = new THREE.Group(); headG.add(head);

    /* an egg: narrow at the chin, widest above the ears */
    var skull = m(sph(0.139, 10, 8), skinMat, 0, 0.112, 0);
    skull.scale.set(1.0, 1.16, 0.96); head.add(skull);
    var jaw = m(cyl(0.092, 0.130, 0.105, 8), skinMat, 0, 0.026, 0.010);
    jaw.scale.set(1, 1, 0.92); head.add(jaw);
    head.add(m(sph(0.034, 8, 7), skinMat, 0, 0.095, 0.132));           // nose
    /* Eyes are dark angular slashes, not whites with pupils, and there is no
       mouth at all - that is what the look is. */
    [-1, 1].forEach(function (sd) {
      var eye = m(box(0.062, 0.030, 0.020), bodyMat('#2b2f33'), sd * 0.062, 0.130, 0.124);
      eye.rotation.z = sd * 0.16;
      head.add(eye);
    });
    head.add(m(sph(0.026, 7, 6), skinMat, -0.140, 0.100, 0.000));      // ears
    head.add(m(sph(0.026, 7, 6), skinMat, 0.140, 0.100, 0.000));

    if (app.hairStyle !== 0) {
      var hm = bodyMat(hairC);
      var cap2 = m(sph(0.158, 10, 8), hm, 0, 0.150, -0.014);
      cap2.scale.set(1.0, 1.02, 1.0); head.add(cap2);
      var brow = m(sph(0.148, 10, 8), skinMat, 0, 0.110, 0.028);
      brow.scale.set(0.98, 0.82, 0.94); head.add(brow);
      if (app.hairStyle === 2 || app.hairStyle === 3) {
        [-1, 1].forEach(function (sd) {
          var fall = m(sph(0.052, 8, 7), hm, sd * 0.122, 0.010, -0.060);
          fall.scale.set(0.75, 2.0, 1.0); head.add(fall);
        });
        var nape = m(sph(0.112, 10, 8), hm, 0, 0.020, -0.086);
        nape.scale.set(1.0, 1.4, 0.62); head.add(nape);
      }
      if (app.hairStyle === 4) {
        cap2.scale.set(0.95, 0.92, 0.95);
        head.add(m(cyl(0.032, 0.044, 0.09, 8), hm, 0, 0.245, -0.030));
        head.add(m(sph(0.050, 9, 7), hm, 0, 0.308, -0.030));
      }
    }
    if (app.beard) {
      /* a short pointed beard hanging off the chin, angular rather than round */
      var bm = bodyMat(app.beardColor || hairC);
      var chin = m(cone(0.098, 0.24, 6), bm, 0, -0.055, 0.055);
      chin.rotation.x = 0.22; head.add(chin);
      head.add(m(box(0.070, 0.026, 0.030), bm, 0, 0.060, 0.120));
    }

    // ---- arms: sleeve, bare forearm, bracer, closed fist -----------------
    function arm(side) {
      var p = new THREE.Group();
      p.position.set(side * 0.340 * slim, 1.462, 0);
      p.rotation.z = -side * 0.085;
      p.rotation.x = 0.05;
      /* upper arm is bare skin below the shoulder cap */
      p.add(m(cyl(0.100, 0.081, 0.32, 8), skinMat, 0, -0.17, 0));
      var fore = new THREE.Group();
      fore.position.set(0, -0.335, 0);
      fore.rotation.x = 0.18;
      fore.add(m(cyl(0.083, 0.072, 0.12, 8), bracerMat, 0, -0.048, 0));   // bracer
      fore.add(m(cyl(0.074, 0.064, 0.23, 8), skinMat, 0, -0.21, 0));      // forearm
      /* a closed fist: chunky, no fingers */
      var fist = m(sph(0.086, 9, 8), skinMat, 0, -0.360, 0.006);
      fist.scale.set(0.92, 1.0, 0.86); fore.add(fist);
      p.add(fore);
      p.foreArm = fore;
      body.add(p);
      return p;
    }
    root.armR = arm(1); root.armL = arm(-1);
    var wm = new THREE.Group(); wm.position.set(0, -0.70, 0.06);
    root.armR.add(wm); root.weaponMount = wm;
    var sm = new THREE.Group(); sm.position.set(0, -0.60, 0.02);
    root.armL.add(sm); root.shieldMount = sm;

    root.appearance = app;
    return root;
  }

  var TIERCOL = {
    bronze: ['#b07a3c', '#7a5228'], iron: ['#8d8d95', '#5b5b63'], steel: ['#c2c8d0', '#7e848c'],
    verdite: ['#5d7fd6', '#33509a'], kaldrite: ['#4f9f5f', '#2d6338'], aetherium: ['#57cdd4', '#2b8085'],
    leather: ['#8d6a3f', '#5b4426'], wizard: ['#4a3f8c', '#2b2456'], wood: ['#8b6239', '#5d4426']
  };

  function weaponModel(wclass, c1, c2) {
    /* Use the actual supplied V2 equipment meshes wherever there is a direct
       match.  These were previously present on disk but never reached this
       runtime path, so players kept seeing the procedural placeholders. */
    var A2 = g.RFAssets;
    var authoredKey = ({ dagger:'sword', sword:'sword', longsword:'sword', scimitar:'sword',
                         greatsword:'sword', battleaxe:'axe', hatchet:'axe', pickaxe:'pickaxe' })[wclass];
    if (authoredKey && A2 && A2.hasV2 && A2.hasV2(authoredKey)) {
      var ag = A2.v2Model(authoredKey);
      var sc = ({ dagger:0.62, sword:1, longsword:1.13, scimitar:0.96,
                  greatsword:1.34, battleaxe:1.08, hatchet:0.82, pickaxe:1 })[wclass] || 1;
      ag.scale.setScalar(sc);
      ag.userData.authoredV2 = authoredKey;
      return ag;
    }
    var gp = new THREE.Group();
    var metal = mat(c1), dark = mat(c2), wood = mat('#6b4a2a');
    switch (wclass) {
      case 'dagger':
        gp.add(m(box(0.06, 0.30, 0.03), metal, 0, 0.20, 0));
        gp.add(m(box(0.14, 0.04, 0.05), dark, 0, 0.04, 0));
        gp.add(m(box(0.05, 0.14, 0.05), wood, 0, -0.05, 0));
        break;
      case 'sword':
        gp.add(m(box(0.07, 0.62, 0.035), metal, 0, 0.40, 0));
        gp.add(m(box(0.22, 0.05, 0.06), dark, 0, 0.07, 0));
        gp.add(m(box(0.06, 0.18, 0.06), wood, 0, -0.04, 0));
        break;
      case 'longsword':
        gp.add(m(box(0.08, 0.86, 0.04), metal, 0, 0.53, 0));
        gp.add(m(box(0.28, 0.06, 0.07), dark, 0, 0.08, 0));
        gp.add(m(box(0.07, 0.20, 0.07), wood, 0, -0.04, 0));
        break;
      case 'scimitar':
        for (var i = 0; i < 5; i++) {
          var t = i / 4;
          gp.add(m(box(0.08 - t * 0.02, 0.17, 0.035), metal, t * t * 0.26, 0.16 + i * 0.16, 0));
        }
        gp.add(m(box(0.20, 0.05, 0.06), dark, 0, 0.07, 0));
        gp.add(m(box(0.06, 0.17, 0.06), wood, 0, -0.04, 0));
        break;
      case 'mace':
        gp.add(m(box(0.06, 0.52, 0.06), dark, 0, 0.28, 0));
        gp.add(m(sph(0.14, 6, 4), metal, 0, 0.58, 0));
        gp.add(m(box(0.06, 0.34, 0.06), wood, 0, 0.02, 0));
        break;
      case 'battleaxe':
        gp.add(m(box(0.06, 0.70, 0.06), wood, 0, 0.34, 0));
        gp.add(m(box(0.10, 0.34, 0.26), metal, 0.14, 0.60, 0));
        gp.add(m(box(0.10, 0.24, 0.18), metal, -0.12, 0.58, 0));
        break;
      case 'greatsword':
        gp.add(m(box(0.11, 1.10, 0.05), metal, 0, 0.68, 0));
        gp.add(m(box(0.36, 0.07, 0.09), dark, 0, 0.10, 0));
        gp.add(m(box(0.08, 0.26, 0.08), wood, 0, -0.06, 0));
        break;
      case 'bow':
        for (var j = 0; j < 7; j++) {
          var a = (j / 6 - 0.5) * 2.1;
          gp.add(m(box(0.05, 0.20, 0.05), mat('#8b6239'), Math.cos(a) * 0.16 - 0.16, Math.sin(a) * 0.55 + 0.35, 0));
        }
        gp.add(m(box(0.012, 1.06, 0.012), mat('#ded6bd'), 0, 0.35, 0));
        break;
      case 'staff':
        gp.add(m(box(0.055, 1.20, 0.055), wood, 0, 0.55, 0));
        gp.add(m(sph(0.11, 6, 5), mat(c1, { emissive: c2 }), 0, 1.22, 0));
        break;
      case 'pickaxe':
        gp.add(m(box(0.055, 0.68, 0.055), wood, 0, 0.32, 0));
        gp.add(m(box(0.52, 0.08, 0.08), metal, 0, 0.62, 0));
        break;
      case 'hatchet':
        gp.add(m(box(0.055, 0.58, 0.055), wood, 0, 0.28, 0));
        gp.add(m(box(0.08, 0.26, 0.22), metal, 0.10, 0.50, 0));
        break;
      default:
        gp.add(m(box(0.07, 0.55, 0.04), metal, 0, 0.34, 0));
    }
    return gp;
  }

  function shieldModel(c1, c2) {
    var A2 = g.RFAssets;
    if (A2 && A2.hasV2 && A2.hasV2('shield')) {
      var sg = A2.v2Model('shield');
      sg.position.y = 0.28;
      sg.rotation.z = 0.1;
      sg.userData.authoredV2 = 'shield';
      return sg;
    }
    var gp = new THREE.Group();
    gp.add(m(box(0.42, 0.54, 0.05), mat(c1), 0, 0, 0));
    gp.add(m(box(0.30, 0.10, 0.03), mat(c2), 0, 0.10, 0.04));
    gp.add(m(cone(0.20, 0.16, 4), mat(c1), 0, -0.34, 0));
    gp.rotation.z = 0.1;
    return gp;
  }

  function helmModel(kind, c1, c2) {
    var gp = new THREE.Group();
    if (kind === 'wizard') {
      gp.add(m(cone(0.30, 0.52, 8), mat(c1), 0, 0.42, 0));
      gp.add(m(cyl(0.34, 0.34, 0.04, 10), mat(c2), 0, 0.18, 0));
    } else if (kind === 'leather') {
      gp.add(m(box(0.38, 0.22, 0.36), mat(c1), 0, 0.22, 0));
    } else {
      gp.add(m(box(0.40, 0.26, 0.38), mat(c1), 0, 0.23, 0));
      gp.add(m(box(0.08, 0.22, 0.06), mat(c2), 0, 0.14, 0.19));   // nose guard
      gp.add(m(box(0.42, 0.05, 0.40), mat(c2), 0, 0.36, 0));
    }
    return gp;
  }

  /* Applies visible equipment. Returns a dispose handle so gear can be swapped. */
  function equipVisuals(actor, eq, itemDB) {
    // clear previous
    if (actor._gear) actor._gear.forEach(function (o) { o.parent && o.parent.remove(o); });
    actor._gear = [];
    var app = actor.appearance || {};

    function tierOf(it) {
      if (!it || !it.tags) return null;
      for (var k in TIERCOL) if (it.tags.indexOf(k) >= 0) return k;
      if (it.tags.indexOf('magic') >= 0) return 'wizard';
      if (it.tags.indexOf('ranged') >= 0) return 'leather';
      return null;
    }
    function add(parent, obj) { parent.add(obj); actor._gear.push(obj); }

    var wi = eq.weapon && itemDB[eq.weapon];
    if (wi) {
      var t = tierOf(wi) || 'wood';
      var col = TIERCOL[t] || TIERCOL.wood;
      var wm = weaponModel(wi.wclass || 'sword', col[0], col[1]);
      if (wi.wclass === 'bow') { wm.rotation.z = Math.PI / 2; wm.rotation.x = 0.2; wm.position.set(0, -0.1, 0); }
      add(actor.weaponMount, wm);
    }
    var si = eq.shield && itemDB[eq.shield];
    if (si) {
      var st = tierOf(si) || 'bronze';
      add(actor.shieldMount, shieldModel(TIERCOL[st][0], TIERCOL[st][1]));
    }
    var hi = eq.head && itemDB[eq.head];
    if (hi) {
      var ht = tierOf(hi) || 'bronze';
      add(actor.head, helmModel(ht === 'wizard' ? 'wizard' : (ht === 'leather' ? 'leather' : 'plate'), TIERCOL[ht][0], TIERCOL[ht][1]));
    }
    // body / legs recolour
    var bi = eq.body && itemDB[eq.body];
    if (bi) {
      var bt = tierOf(bi) || 'bronze', bc = TIERCOL[bt];
      actor.torso.material = mat(bc[0]);
      actor.armR.children[0].material = mat(bc[0]);
      actor.armL.children[0].material = mat(bc[0]);
      add(actor.torso, m(box(0.66, 0.14, 0.34), mat(bc[1]), 0, 0.24, 0));  // pauldrons
    } else {
      actor.torso.material = mat(app.shirt || '#5a7a9a');
      actor.armR.children[0].material = mat(app.shirt || '#5a7a9a');
      actor.armL.children[0].material = mat(app.shirt || '#5a7a9a');
    }
    var li = eq.legs && itemDB[eq.legs];
    var lc = li ? (TIERCOL[tierOf(li) || 'bronze']) : null;
    actor.legR.children[0].material = mat(lc ? lc[0] : (app.legs || '#4a4238'));
    actor.legL.children[0].material = mat(lc ? lc[0] : (app.legs || '#4a4238'));

    var ci = eq.cape && itemDB[eq.cape];
    if (ci) {
      var capeCol = (ci.icon && ci.icon[1]) || '#8a8a92';
      var cape = m(box(0.50, 0.80, 0.04), mat(capeCol, { side: THREE.DoubleSide }), 0, -0.02, -0.19);
      add(actor.torso, cape);
    }
  }

  /* Visible equipment for skeleton-driven player/remote characters.  The
     old equipVisuals() expects procedural limb fields (torso/armR/etc.), so
     calling it on a rig silently discarded every equipped item. */
  function equipRigged(actor, eq, itemDB) {
    if (!actor) return;
    if (actor._gear) actor._gear.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    actor._gear = [];
    function add(parent, obj) { if (!parent || !obj) return; parent.add(obj); actor._gear.push(obj); }
    function tierOf(it) {
      if (!it || !it.tags) return null;
      for (var k in TIERCOL) if (it.tags.indexOf(k) >= 0) return k;
      if (it.tags.indexOf('magic') >= 0) return 'wizard';
      if (it.tags.indexOf('ranged') >= 0) return 'leather';
      return null;
    }
    var wi = eq.weapon && itemDB[eq.weapon];
    if (wi) {
      var wt = tierOf(wi) || 'wood', wc = TIERCOL[wt] || TIERCOL.wood;
      var wm = weaponModel(wi.wclass || 'sword', wc[0], wc[1]);
      if (wi.wclass === 'bow') { wm.rotation.z = Math.PI / 2; wm.rotation.x = 0.2; }
      /* generated and V2 weapons both point along +Y from their handle */
      wm.position.set(0, -0.04, 0.02);
      add(actor.weaponMount, wm);
    }
    var si = eq.shield && itemDB[eq.shield];
    if (si) {
      var st = tierOf(si) || 'bronze', sc = TIERCOL[st] || TIERCOL.bronze;
      var sm = shieldModel(sc[0], sc[1]);
      sm.rotation.y += Math.PI / 2;
      add(actor.shieldMount, sm);
    }
    var hi = eq.head && itemDB[eq.head];
    if (hi && actor.headMount) {
      var ht = tierOf(hi) || 'bronze', hc = TIERCOL[ht] || TIERCOL.bronze;
      var hm = helmModel(ht === 'wizard' ? 'wizard' : (ht === 'leather' ? 'leather' : 'plate'), hc[0], hc[1]);
      hm.position.y = 0.02;
      add(actor.headMount, hm);
    }
    var ci = eq.cape && itemDB[eq.cape];
    if (ci && actor.capeMount) {
      var capeCol = (ci.icon && ci.icon[1]) || '#8a8a92';
      var cape = m(box(0.50, 0.80, 0.04), mat(capeCol, { side: THREE.DoubleSide }), 0, -0.38, 0.12);
      add(actor.capeMount, cape);
    }
  }

  /* --- non-humanoid creatures ------------------------------------------ */
  function creature(spec) {
    var kind = spec.kind || 'humanoid';
    var c1 = spec.c1 || '#888', c2 = spec.c2 || '#555';
    var root = new THREE.Group(), body = new THREE.Group();
    root.add(body); root.body = body;
    /* Smooth-shaded, like the player. Flat-shaded boxes are what made these
       read as crates with legs. */
    var M1 = bodyMat(c1), M2 = bodyMat(c2), Mdark = bodyMat(shadeHex(c2, 0.7));

    if (kind === 'humanoid' || kind === 'skeleton') {
      var h = humanoid({ skin: c1, shirt: c2, legs: c2,
        hair: kind === 'skeleton' ? c1 : '#2a2420', hairStyle: kind === 'skeleton' ? 0 : 1 });
      h.scale.setScalar(spec.sc || 1);
      root.add(h);
      root.body = h.body; root.head = h.head; root.armL = h.armL; root.armR = h.armR;
      root.legL = h.legL; root.legR = h.legR; root.torso = h.torso;
      root.weaponMount = h.weaponMount; root.shieldMount = h.shieldMount;
      root.isHumanoid = true;
      return root;
    }
    var s = spec.sc || 1;

    /* a tapered limb with a joint, reused by everything four-legged */
    function limb(px, py, pz, len, r1, r2, mtl) {
      var p = new THREE.Group();
      p.position.set(px, py, pz);
      p.add(m(cyl(r1, r2, len, 8), mtl, 0, -len / 2, 0));
      p.add(m(sph(r2 * 1.05, 8, 6), mtl, 0, -len, 0));
      body.add(p);
      return p;
    }

    if (kind === 'quad') {
      /* barrel chest, narrower hindquarters, a real neck and a muzzle */
      var trunk = m(sph(0.42, 14, 10), M1, 0, 0.68, 0);
      trunk.scale.set(0.72, 0.66, 1.30);
      body.add(trunk);
      var rump = m(sph(0.30, 12, 9), M1, 0, 0.70, -0.42);
      rump.scale.set(0.78, 0.74, 0.90); body.add(rump);
      var neck = m(cyl(0.15, 0.20, 0.34, 10), M1, 0, 0.82, 0.48);
      neck.rotation.x = -0.55; body.add(neck);
      var headG = new THREE.Group(); headG.position.set(0, 0.95, 0.66);
      var skull = m(sph(0.19, 12, 9), M1, 0, 0, 0);
      skull.scale.set(0.86, 0.86, 1.05); headG.add(skull);
      var muzzle = m(cyl(0.085, 0.115, 0.22, 9), M1, 0, -0.03, 0.20);
      muzzle.rotation.x = Math.PI / 2; headG.add(muzzle);
      headG.add(m(sph(0.045, 7, 6), Mdark, 0, -0.03, 0.31));           // nose
      headG.add(m(cone(0.055, 0.14, 6), M2, -0.11, 0.16, -0.02));      // ears
      headG.add(m(cone(0.055, 0.14, 6), M2, 0.11, 0.16, -0.02));
      headG.add(m(sph(0.028, 7, 6), Mdark, -0.095, 0.05, 0.16));       // eyes
      headG.add(m(sph(0.028, 7, 6), Mdark, 0.095, 0.05, 0.16));
      body.add(headG); root.head = headG;
      root.legFL = limb(-0.20, 0.60, 0.34, 0.40, 0.085, 0.062, M2);
      root.legFR = limb(0.20, 0.60, 0.34, 0.40, 0.085, 0.062, M2);
      root.legBL = limb(-0.21, 0.58, -0.36, 0.38, 0.095, 0.066, M2);
      root.legBR = limb(0.21, 0.58, -0.36, 0.38, 0.095, 0.066, M2);
      var tail = m(cyl(0.045, 0.02, 0.36, 7), M2, 0, 0.76, -0.66);
      tail.rotation.x = 0.9; body.add(tail);

    } else if (kind === 'bird') {
      var bbody = m(sph(0.26, 12, 9), M1, 0, 0.46, 0);
      bbody.scale.set(0.82, 0.92, 1.15); body.add(bbody);
      var bhead = new THREE.Group(); bhead.position.set(0, 0.78, 0.14);
      bhead.add(m(sph(0.135, 10, 8), M1, 0, 0, 0));
      var beak = m(cone(0.055, 0.17, 7), bodyMat('#d8a23c'), 0, 0.0, 0.17);
      beak.rotation.x = Math.PI / 2; bhead.add(beak);
      bhead.add(m(sph(0.024, 7, 6), Mdark, -0.065, 0.04, 0.09));
      bhead.add(m(sph(0.024, 7, 6), Mdark, 0.065, 0.04, 0.09));
      bhead.add(m(cone(0.05, 0.10, 6), bodyMat('#c4453a'), 0, 0.13, 0.02));   // comb
      body.add(bhead); root.head = bhead;
      root.wingL = new THREE.Group(); root.wingL.position.set(-0.20, 0.52, 0);
      var wlm = m(sph(0.20, 9, 7), M2, -0.10, 0, 0);
      wlm.scale.set(0.30, 0.72, 1.05); root.wingL.add(wlm);
      root.wingR = new THREE.Group(); root.wingR.position.set(0.20, 0.52, 0);
      var wrm = m(sph(0.20, 9, 7), M2, 0.10, 0, 0);
      wrm.scale.set(0.30, 0.72, 1.05); root.wingR.add(wrm);
      body.add(root.wingL); body.add(root.wingR);
      root.legFL = limb(-0.09, 0.28, 0.02, 0.22, 0.028, 0.022, bodyMat('#d8a23c'));
      root.legFR = limb(0.09, 0.28, 0.02, 0.22, 0.028, 0.022, bodyMat('#d8a23c'));
      var btail = m(cone(0.16, 0.28, 7), M2, 0, 0.54, -0.30);
      btail.rotation.x = -1.9; body.add(btail);

    } else if (kind === 'spider') {
      var abdomen = m(sph(0.34, 13, 10), M1, 0, 0.42, -0.20);
      abdomen.scale.set(1.0, 0.86, 1.15); body.add(abdomen);
      var cephalo = m(sph(0.22, 11, 9), M2, 0, 0.40, 0.22);
      cephalo.scale.set(1.0, 0.8, 1.0); body.add(cephalo);
      root.head = cephalo;
      for (var e = 0; e < 4; e++) {
        body.add(m(sph(0.035, 7, 6), Mdark, -0.10 + (e % 2) * 0.20, 0.47 - Math.floor(e / 2) * 0.07, 0.36));
      }
      /* eight legs, each a bent pair of tapered sections */
      for (var i = 0; i < 8; i++) {
        var side = i < 4 ? -1 : 1;
        var along = (i % 4) - 1.5;
        var hip = new THREE.Group();
        hip.position.set(side * 0.16, 0.44, along * 0.16);
        hip.rotation.z = side * 0.55;
        hip.rotation.y = along * 0.30;
        var upper = m(cyl(0.035, 0.026, 0.34, 7), M2, 0, -0.17, 0);
        hip.add(upper);
        var knee = new THREE.Group(); knee.position.set(0, -0.33, 0);
        knee.rotation.z = -side * 1.15;
        knee.add(m(cyl(0.026, 0.014, 0.36, 7), M2, 0, -0.18, 0));
        hip.add(knee);
        body.add(hip);
        (root.legs = root.legs || []).push(hip);
      }

    } else if (kind === 'crab') {
      var shell = m(sph(0.44, 13, 10), M1, 0, 0.36, 0);
      shell.scale.set(1.15, 0.52, 0.95); body.add(shell);
      body.add(m(sph(0.045, 7, 6), Mdark, -0.13, 0.52, 0.18));
      body.add(m(sph(0.045, 7, 6), Mdark, 0.13, 0.52, 0.18));
      root.head = shell;
      [-1, 1].forEach(function (sd) {
        var arm = new THREE.Group();
        arm.position.set(sd * 0.44, 0.32, 0.22);
        var carm = m(cyl(0.055, 0.045, 0.26, 8), M2, sd * 0.10, 0, 0.06);
        carm.rotation.z = sd * 1.2; arm.add(carm);
        var claw = m(sph(0.15, 10, 8), M1, sd * 0.26, 0.02, 0.20);
        claw.scale.set(1.0, 0.55, 1.25); arm.add(claw);
        body.add(arm);
        (root.legs = root.legs || []).push(arm);
      });
      for (var ci = 0; ci < 6; ci++) {
        var cs = ci < 3 ? -1 : 1;
        var cp = limb(cs * 0.34, 0.30, ((ci % 3) - 1) * 0.24, 0.26, 0.032, 0.020, M2);
        cp.rotation.z = cs * 0.8;
        (root.legs = root.legs || []).push(cp);
      }

    } else if (kind === 'golem') {
      var gtor = m(cyl(0.40, 0.30, 0.72, 10), M1, 0, 1.00, 0);
      gtor.scale.set(1.0, 1.0, 0.80); body.add(gtor);
      var ghead = m(sph(0.26, 11, 9), M1, 0, 1.44, 0);
      ghead.scale.set(1.1, 0.85, 1.0); body.add(ghead); root.head = ghead;
      body.add(m(sph(0.04, 7, 6), bodyMat('#e0a03c'), -0.10, 1.46, 0.20));
      body.add(m(sph(0.04, 7, 6), bodyMat('#e0a03c'), 0.10, 1.46, 0.20));
      root.armL = limb(-0.44, 1.24, 0, 0.62, 0.14, 0.12, M2);
      root.armR = limb(0.44, 1.24, 0, 0.62, 0.14, 0.12, M2);
      root.legL = limb(-0.18, 0.64, 0, 0.60, 0.15, 0.13, M2);
      root.legR = limb(0.18, 0.64, 0, 0.60, 0.15, 0.13, M2);
      /* chunks of rock on the shoulders give it a heavy silhouette */
      body.add(m(sph(0.19, 9, 7), M2, -0.38, 1.36, 0));
      body.add(m(sph(0.19, 9, 7), M2, 0.38, 1.36, 0));

    } else if (kind === 'blob') {
      var blobBody = m(sph(0.46, 14, 11), M1, 0, 0.44, 0);
      blobBody.scale.set(1.0, 0.82, 1.0); body.add(blobBody);
      var bhd = m(sph(0.30, 11, 9), M1, 0, 0.72, 0);
      bhd.scale.set(0.9, 0.7, 0.9); body.add(bhd); root.head = bhd;
      body.add(m(sph(0.055, 8, 7), Mdark, -0.13, 0.78, 0.22));
      body.add(m(sph(0.055, 8, 7), Mdark, 0.13, 0.78, 0.22));
      /* drips, so it does not read as a beach ball */
      for (var d = 0; d < 5; d++) {
        var ang = d / 5 * 6.2832;
        body.add(m(sph(0.09, 8, 6), M2, Math.cos(ang) * 0.36, 0.16, Math.sin(ang) * 0.36));
      }

    } else if (kind === 'wraith') {
      var hood = m(cone(0.30, 0.52, 10), M1, 0, 1.24, 0);
      body.add(hood);
      body.add(m(sph(0.19, 11, 9), Mdark, 0, 1.10, 0.04));
      root.head = hood;
      body.add(m(sph(0.035, 7, 6), bodyMat('#8fd8e8'), -0.075, 1.12, 0.15));
      body.add(m(sph(0.035, 7, 6), bodyMat('#8fd8e8'), 0.075, 1.12, 0.15));
      /* a robe that tapers to nothing instead of legs */
      var robe = m(cone(0.42, 1.10, 12), M1, 0, 0.55, 0);
      body.add(robe);
      root.armL = limb(-0.30, 1.06, 0, 0.44, 0.055, 0.035, M2);
      root.armR = limb(0.30, 1.06, 0, 0.44, 0.055, 0.035, M2);
      var wm2 = new THREE.Group(); wm2.position.set(0, -0.46, 0.04);
      root.armR.add(wm2); root.weaponMount = wm2;

    } else if (kind === 'drake') {
      var dbody = m(sph(0.46, 14, 10), M1, 0, 0.86, 0);
      dbody.scale.set(0.80, 0.76, 1.45); body.add(dbody);
      var dneck = m(cyl(0.16, 0.24, 0.48, 10), M1, 0, 1.06, 0.50);
      dneck.rotation.x = -0.7; body.add(dneck);
      var dhead = new THREE.Group(); dhead.position.set(0, 1.26, 0.82);
      var dskull = m(sph(0.21, 12, 9), M1, 0, 0, 0);
      dskull.scale.set(0.8, 0.8, 1.25); dhead.add(dskull);
      var dsnout = m(cone(0.10, 0.26, 7), M1, 0, -0.02, 0.26);
      dsnout.rotation.x = Math.PI / 2; dhead.add(dsnout);
      dhead.add(m(cone(0.045, 0.16, 6), M2, -0.10, 0.16, -0.06));   // horns
      dhead.add(m(cone(0.045, 0.16, 6), M2, 0.10, 0.16, -0.06));
      dhead.add(m(sph(0.032, 7, 6), bodyMat('#e0a03c'), -0.10, 0.05, 0.16));
      dhead.add(m(sph(0.032, 7, 6), bodyMat('#e0a03c'), 0.10, 0.05, 0.16));
      body.add(dhead); root.head = dhead;
      root.wingL = new THREE.Group(); root.wingL.position.set(-0.30, 1.06, 0.02);
      var wl = m(sph(0.55, 10, 7), M2, -0.34, 0.10, -0.22);
      wl.scale.set(0.55, 0.16, 0.80); wl.rotation.z = 0.55; wl.rotation.y = 0.5;
      root.wingL.add(wl);
      root.wingR = new THREE.Group(); root.wingR.position.set(0.30, 1.06, 0.02);
      var wr = m(sph(0.55, 10, 7), M2, 0.34, 0.10, -0.22);
      wr.scale.set(0.55, 0.16, 0.80); wr.rotation.z = -0.55; wr.rotation.y = -0.5;
      root.wingR.add(wr);
      body.add(root.wingL); body.add(root.wingR);
      root.legFL = limb(-0.26, 0.74, 0.38, 0.44, 0.09, 0.065, M2);
      root.legFR = limb(0.26, 0.74, 0.38, 0.44, 0.09, 0.065, M2);
      root.legBL = limb(-0.28, 0.72, -0.40, 0.46, 0.10, 0.070, M2);
      root.legBR = limb(0.28, 0.72, -0.40, 0.46, 0.10, 0.070, M2);
      var dtail = new THREE.Group(); dtail.position.set(0, 0.92, -0.62);
      for (var t2 = 0; t2 < 4; t2++) {
        var seg = m(cyl(0.11 - t2 * 0.024, 0.086 - t2 * 0.024, 0.30, 8), M1, 0, 0, -0.15 - t2 * 0.28);
        seg.rotation.x = Math.PI / 2;
        dtail.add(seg);
      }
      body.add(dtail);

    } else {
      /* anything unrecognised still gets something with a head on it */
      body.add(m(sph(0.34, 12, 9), M1, 0, 0.60, 0));
      body.add(m(sph(0.22, 10, 8), M1, 0, 1.00, 0));
      root.head = body.children[1];
    }

    root.scale.setScalar(s);
    return root;
  }

  var TREESPEC = {
    Tree:        { trunk: '#8a7350', leaf: '#6f8f52', h: 3.6, r: 0.20, canopy: 1.9, tiers: 3, family: 'broad' },
    Oak:         { trunk: '#7d6746', leaf: '#7b9a58', h: 4.0, r: 0.30, canopy: 2.5, tiers: 3, family: 'broad-wide' },
    Willow:      { trunk: '#8a7c5e', leaf: '#9db072', h: 3.8, r: 0.26, canopy: 2.3, tiers: 2, family: 'droop' },
    Silverbirch: { trunk: '#d2cfc6', leaf: '#93ab61', h: 3.8, r: 0.18, canopy: 1.8, tiers: 3, family: 'broad' },
    Ironbark:    { trunk: '#6d6152', leaf: '#4f6d48', h: 4.6, r: 0.42, canopy: 2.4, tiers: 4, family: 'conifer' },
    Ghostwood:   { trunk: '#c4d2d6', leaf: '#9fc0c0', h: 4.0, r: 0.24, canopy: 2.0, tiers: 3, family: 'dead' }
  };

  /* Six tree families with genuinely different silhouettes. A brown cylinder
     under a green sphere is what makes a forest read as programmer art, so
     each family gets its own trunk behaviour and its own foliage massing. */
  function treeTrunk(s, seed, gp) {
    var lean = ((seed % 13) - 6) * 0.012;
    var trunk = m(cyl(s.r * 0.72, s.r * 1.45, s.h, 8), texMat(s.trunk, 'bark', 1), 0, s.h / 2, 0);
    trunk.rotation.z = lean;
    gp.add(trunk);
    /* flared roots give the base weight */
    for (var i = 0; i < 4; i++) {
      var a = i / 4 * 6.2832 + (seed % 7) * 0.2;
      var root = m(cone(s.r * 0.50, s.r * 2.1, 4),
        texMat(s.trunk, 'bark', 1), Math.cos(a) * s.r * 0.95, s.r * 0.75, Math.sin(a) * s.r * 0.95);
      root.rotation.x = Math.sin(a) * 0.62;
      root.rotation.z = -Math.cos(a) * 0.62;
      gp.add(root);
    }
    return lean;
  }
  function branch(s, gp, fromY, ang, len, tilt) {
    var b = m(cyl(s.r * 0.16, s.r * 0.30, len, 5), texMat(s.trunk, 'bark', 1), 0, 0, 0);
    var pivot = new THREE.Group();
    pivot.position.set(0, fromY, 0);
    pivot.rotation.y = ang;
    pivot.rotation.z = tilt;
    b.position.y = len / 2;
    pivot.add(b);
    gp.add(pivot);
    return pivot;
  }
  function blob(s, gp, x, y, z, r, squash) {
    var c = m(sph(r, 6, 4), texMat(s.leaf, 'leaf', 2), x, y, z);
    c.scale.set(1, squash || 0.78, 1);
    c.rotation.y = (x + z) * 0.7;
    gp.add(c);
    return c;
  }

  /* Flattens a built group into one geometry, baking each part's colour into
     vertex colours. That lets a six-part tree be drawn as a single instanced
     mesh, so the better silhouettes cost nothing at render time. */
  /* pick: optional filter, so a tree can be merged into an opaque half (trunk,
     limbs) and an alpha-cut half (foliage) - they need different materials and
     cannot share one instanced mesh. */
  function mergeGroup(root, pick) {
    root.updateMatrixWorld(true);
    var pos = [], nor = [], uv = [], col = [], idx = [];
    var base = 0;
    var v = new THREE.Vector3(), n = new THREE.Vector3();
    var nm = new THREE.Matrix3();
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      if (pick && !pick(o)) return;
      var geo = o.geometry;
      var P = geo.attributes.position, N = geo.attributes.normal, T = geo.attributes.uv;
      var c = (o.material && o.material.color) ? o.material.color : { r: 1, g: 1, b: 1 };
      nm.getNormalMatrix(o.matrixWorld);
      for (var i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
        pos.push(v.x, v.y, v.z);
        if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z); }
        else nor.push(0, 1, 0);
        uv.push(T ? T.getX(i) : 0, T ? T.getY(i) : 0);
        col.push(c.r, c.g, c.b);
      }
      if (geo.index) {
        for (var k = 0; k < geo.index.count; k++) idx.push(geo.index.getX(k) + base);
      } else {
        for (var q = 0; q < P.count; q++) idx.push(q + base);
      }
      base += P.count;
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  /* One merged geometry per species, cached. */
  var treeGeoCache = {};
  /* Returns { wood, leaves } - two merged geometries, because the canopy needs
     an alpha-cut material and the trunk must stay solid. */
  function treeGeometry(kind, variant) {
    var key = kind + '#' + (variant || 0);
    if (treeGeoCache[key]) return treeGeoCache[key];
    var built = tree(kind, (variant || 0) * 7 + 3);
    var out = {
      wood: mergeGroup(built, function (o) { return !o.material.transparent; }),
      leaves: mergeGroup(built, function (o) { return !!o.material.transparent; })
    };
    treeGeoCache[key] = out;
    return out;
  }

  function tree(kind, seed) {
    var s = TREESPEC[kind] || TREESPEC.Tree;
    var gp = new THREE.Group();
    seed = seed === undefined ? 1 : (seed | 0);
    var fam = s.family || 'broad';
    treeTrunk(s, seed, gp);

    var barkMat = texMat(s.trunk, 'bark', 1);
    var leafMat = foliageMat(s.leaf, [6, 2]);

    if (fam === 'conifer') {
      var layers = 5;
      for (var i = 0; i < layers; i++) {
        var t = i / (layers - 1);
        var y = s.h * (0.35 + t * 0.72);
        var r = s.canopy * (1 - t * 0.74);
        var c = m(cone(r, s.canopy * 0.85, 7), leafMat, 0, y, 0);
        c.rotation.y = i * 0.4 + seed * 0.1;
        gp.add(c);
      }
    } else if (fam === 'dead') {
      for (var k = 0; k < 5; k++) {
        var a3 = k / 5 * 6.2832 + seed * 0.2;
        var p1 = branch(s, gp, s.h * (0.5 + (k % 3) * 0.15), a3, s.h * 0.42, 0.75);
        var sub = m(cyl(s.r * 0.09, s.r * 0.15, s.h * 0.24, 4), barkMat, 0, s.h * 0.3, 0);
        sub.rotation.z = 0.6;
        p1.add(sub);
      }
    } else {
      /* The canopy this is built to is not a ball on a stick. It is a broad,
         almost flat-topped crown, widest at the rim, with the foliage hanging
         DOWN past that rim in a skirt - closer to a lampshade than a sphere.
         Willows droop further; oaks spread wider. */
      var wide = fam === 'broad-wide' ? 1.05 : (fam === 'droop' ? 0.95 : 0.90);
      var rim = s.canopy * wide;
      /* sit the crown high so the trunk reads beneath it - the canopy was
         swallowing the whole tree */
      var crownY = s.h * 1.16;

      /* thick limbs reaching up into the crown */
      var limbs = fam === 'broad-wide' ? 4 : 3;
      for (var L = 0; L < limbs; L++) {
        var aL = L / limbs * 6.2832 + (seed % 9) * 0.21;
        var lb = branch(s, gp, s.h * (0.52 + (L % 2) * 0.14), aL, s.h * 0.46, 0.62);
        lb.children[0].scale.set(1.5, 1, 1.5);
      }

      /* the crown: a shallow dome with a nearly flat top */
      var crown = m(cyl(rim * 0.58, rim, s.canopy * 0.34, 9), leafMat, 0, crownY, 0);
      crown.rotation.y = seed * 0.17;
      gp.add(crown);
      var lid = m(cone(rim * 0.60, s.canopy * 0.26, 9), leafMat, 0, crownY + s.canopy * 0.29, 0);
      lid.rotation.y = seed * 0.17;
      gp.add(lid);

      /* the skirt: foliage hanging below the rim, which is what gives these
         trees their silhouette from the ground */
      var drop = s.canopy * (fam === 'droop' ? 0.80 : 0.40);
      var skirt = m(cyl(rim, rim * 0.84, drop, 9), leafMat, 0, crownY - s.canopy * 0.17 - drop / 2, 0);
      skirt.rotation.y = seed * 0.17;
      gp.add(skirt);
      /* ragged tips so the rim is not a clean cylinder */
      var tips = 9;
      for (var tI = 0; tI < tips; tI++) {
        var aT = tI / tips * 6.2832 + seed * 0.17;
        var tl = drop * (0.45 + ((tI * 5 + seed) % 5) * 0.12);
        var tip = m(cone(rim * 0.15, tl, 5), leafMat,
          Math.cos(aT) * rim * 0.86,
          crownY - s.canopy * 0.17 - drop - tl * 0.30,
          Math.sin(aT) * rim * 0.86);
        tip.rotation.x = Math.PI;
        gp.add(tip);
      }
    }

    var v = 0.90 + ((seed * 37) % 22) / 100;
    gp.scale.set(v, 0.93 + ((seed * 17) % 20) / 100, v);
    gp.rotation.y = (seed % 360) * 0.0175;
    return gp;
  }


  function stump(kind) {
    var s = TREESPEC[kind] || TREESPEC.Tree;
    var gp = new THREE.Group();
    gp.add(m(cyl(s.r, s.r * 1.1, 0.45, 6), texMat(s.trunk, 'bark', 1), 0, 0.22, 0));
    gp.add(m(cyl(s.r * 0.95, s.r * 0.95, 0.05, 6), mat('#c9a877'), 0, 0.46, 0));
    return gp;
  }

  var ORECOL = {
    'Copper ore': '#c1743a', 'Tin ore': '#b9b9c4', 'Iron ore': '#8a5a46', 'Coal': '#2f2f36',
    'Silver ore': '#d6dce4', 'Gold ore': '#e0c23c', 'Verdite ore': '#5d7fd6',
    'Kaldrite ore': '#4f9f5f', 'Aetherium ore': '#57cdd4'
  };
  function rock(ore, depleted) {
    /* Angular slate boulders with flat faces and a mossy cap, rather than
       grey spheres. The reference rocks are faceted chunks that catch the
       light on each plane - smooth spheres are what read as "very weird". */
    var gp = new THREE.Group();
    var slate = bodyMat('#6f7a84');
    var slateLit = bodyMat('#8a95a0');
    var moss = bodyMat('#5d7040');

    function chunk(rx, ry, rz, px, py, pz, rot, mtl) {
      /* a 5-sided cone squashed flat gives a hard-edged boulder face */
      var c = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 5),
        mtl || slate);
      c.geometry.computeVertexNormals();
      c.material = mtl || slate;
      c.scale.set(rx, ry, rz);
      c.position.set(px, py, pz);
      c.rotation.set(rot[0], rot[1], rot[2]);
      gp.add(c);
      return c;
    }
    var big = chunk(0.86, 0.92, 0.78, 0, 0.36, 0, [0.10, 0.4, 0.06], slate);
    big.material = slate;
    chunk(0.52, 0.62, 0.50, 0.52, 0.24, -0.26, [-0.16, 1.2, 0.22], slateLit);
    chunk(0.40, 0.46, 0.42, -0.46, 0.20, 0.30, [0.20, 2.1, -0.18], slate);
    /* a flat mossy plate on top, as in the reference */
    var capMesh = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), moss);
    capMesh.scale.set(0.46, 0.14, 0.40);
    capMesh.position.set(0.02, 0.74, 0.02);
    capMesh.rotation.set(0.06, 0.5, 0.04);
    gp.add(capMesh);

    if (!depleted && ore && ORECOL[ore]) {
      /* ore shows as angular flecks set into the faces */
      var oc = bodyMat(ORECOL[ore]);
      [[-0.22, 0.52, 0.30, 0.13], [0.26, 0.44, 0.22, 0.10], [0.02, 0.30, -0.44, 0.09]]
        .forEach(function (f, i) {
          var fl = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), oc);
          fl.scale.set(f[3], f[3] * 1.1, f[3]);
          fl.position.set(f[0], f[1], f[2]);
          fl.rotation.set(0.3 + i, 0.7 * i, 0.2);
          gp.add(fl);
        });
    }
    return gp;
  }

  function prop(type, extra) {
    extra = extra || {};
    var gp = new THREE.Group();
    var wood = mat('#7a5a36'), dark = mat('#4a3826'), stone = mat('#8a8a90'), stoneD = mat('#63636b');
    switch (type) {
      case 'sign':
        gp.add(m(box(0.10, 1.30, 0.10), wood, 0, 0.65, 0));
        gp.add(m(box(1.50, 0.60, 0.08), mat('#9a7a4a'), 0, 1.34, 0));
        gp.add(m(box(1.40, 0.06, 0.10), dark, 0, 1.60, 0));
        break;
      case 'well':
        gp.add(m(cyl(0.85, 0.90, 0.80, 10), stone, 0, 0.40, 0));
        gp.add(m(cyl(0.72, 0.72, 0.08, 10), mat('#2a3a4a'), 0, 0.78, 0));
        gp.add(m(box(0.12, 1.50, 0.12), wood, -0.70, 1.15, 0));
        gp.add(m(box(0.12, 1.50, 0.12), wood, 0.70, 1.15, 0));
        gp.add(m(box(2.00, 0.14, 1.10), mat('#6a4a2a'), 0, 1.94, 0));
        break;
      case 'fountain':
        gp.add(m(cyl(1.60, 1.70, 0.50, 12), stone, 0, 0.25, 0));
        gp.add(m(cyl(1.42, 1.42, 0.10, 12), mat('#3f7fd0', { op: 0.8 }), 0, 0.46, 0));
        gp.add(m(cyl(0.22, 0.30, 1.20, 8), stoneD, 0, 1.05, 0));
        gp.add(m(sph(0.34, 7, 5), stone, 0, 1.76, 0));
        break;
      case 'statue':
        gp.add(m(box(1.40, 0.50, 1.40), stoneD, 0, 0.25, 0));
        gp.add(m(box(0.90, 0.30, 0.90), stone, 0, 0.62, 0));
        var st = humanoid({ skin: '#9a9aa2', shirt: '#9a9aa2', legs: '#9a9aa2', hair: '#9a9aa2' });
        st.position.y = 0.78; st.scale.setScalar(1.3); gp.add(st);
        break;
      case 'standing_stone':
        var ss = m(box(0.9, 3.4, 0.6), stoneD, 0, 1.7, 0);
        ss.rotation.z = (Math.random() - 0.5) * 0.12; gp.add(ss);
        break;
      case 'obelisk':
        gp.add(m(box(1.30, 0.40, 1.30), stoneD, 0, 0.20, 0));
        gp.add(m(cyl(0.30, 0.70, 4.60, 4), mat('#4a3a42'), 0, 2.70, 0));
        gp.add(m(sph(0.26, 6, 5), mat('#c4562a', { emissive: '#7a2a10' }), 0, 5.20, 0));
        break;
      case 'ruin_arch':
        gp.add(m(box(0.60, 3.20, 0.60), stoneD, -1.40, 1.60, 0));
        gp.add(m(box(0.60, 2.40, 0.60), stoneD, 1.40, 1.20, 0));
        gp.add(m(box(3.40, 0.50, 0.60), stoneD, 0, 3.40, 0));
        break;
      case 'brazier':
        gp.add(m(cyl(0.10, 0.14, 0.90, 6), dark, 0, 0.45, 0));
        gp.add(m(cyl(0.42, 0.26, 0.34, 8), mat('#5a4a3a'), 0, 1.05, 0));
        var fl = m(cone(0.30, 0.60, 6), mat('#ff8a30', { emissive: '#d04a10' }), 0, 1.45, 0);
        gp.add(fl); gp.flame = fl;
        break;
      case 'candle':
        gp.add(m(cyl(0.06, 0.07, 0.30, 6), mat('#e8e2d0'), 0, 0.15, 0));
        gp.add(m(cone(0.05, 0.12, 5), mat('#ffcc55', { emissive: '#ff9922' }), 0, 0.36, 0));
        break;
      case 'crate':
        gp.add(m(box(0.90, 0.90, 0.90), mat('#8a6a42'), 0, 0.45, 0));
        gp.add(m(box(0.96, 0.10, 0.10), dark, 0, 0.45, 0.44));
        break;
      case 'barrel':
        gp.add(m(cyl(0.42, 0.36, 1.00, 9), mat('#7a5a36'), 0, 0.50, 0));
        gp.add(m(cyl(0.44, 0.44, 0.08, 9), dark, 0, 0.72, 0));
        gp.add(m(cyl(0.44, 0.44, 0.08, 9), dark, 0, 0.28, 0));
        break;
      case 'cart':
        gp.add(m(box(2.20, 0.20, 1.20), mat('#8a6a42'), 0, 0.70, 0));
        gp.add(m(box(2.20, 0.50, 0.10), mat('#8a6a42'), 0, 0.95, 0.60));
        gp.add(m(box(2.20, 0.50, 0.10), mat('#8a6a42'), 0, 0.95, -0.60));
        [[-0.70, 0.70], [-0.70, -0.70], [0.70, 0.70], [0.70, -0.70]].forEach(function (w) {
          var wh = m(cyl(0.46, 0.46, 0.12, 10), dark, w[0], 0.46, w[1]);
          wh.rotation.x = Math.PI / 2; gp.add(wh);
        });
        break;
      case 'anvil':
        gp.add(m(box(0.50, 0.30, 0.40), mat('#4a4a52'), 0, 0.15, 0));
        gp.add(m(box(0.26, 0.26, 0.26), mat('#3a3a42'), 0, 0.42, 0));
        gp.add(m(box(1.10, 0.26, 0.44), mat('#5a5a62'), 0, 0.66, 0));
        gp.add(m(cone(0.18, 0.40, 5), mat('#5a5a62'), 0.62, 0.66, 0));
        break;
      case 'furnace':
        gp.add(m(box(1.80, 1.90, 1.60), mat('#6a5a4a'), 0, 0.95, 0));
        gp.add(m(box(0.80, 0.80, 0.20), mat('#2a1a10'), 0, 0.70, 0.80));
        var fg = m(box(0.66, 0.66, 0.10), mat('#ff8030', { emissive: '#e04010' }), 0, 0.70, 0.86);
        gp.add(fg); gp.flame = fg;
        gp.add(m(cyl(0.30, 0.36, 1.10, 7), mat('#5a4a3a'), 0.55, 2.30, -0.40));
        break;
      case 'range':
        gp.add(m(box(1.60, 1.10, 1.10), mat('#7a6a5a'), 0, 0.55, 0));
        gp.add(m(box(0.90, 0.60, 0.16), mat('#2a1a10'), 0, 0.42, 0.55));
        var rg = m(box(0.74, 0.46, 0.08), mat('#ff9a40', { emissive: '#d05010' }), 0, 0.42, 0.60);
        gp.add(rg); gp.flame = rg;
        gp.add(m(box(1.70, 0.12, 1.20), mat('#4a4a52'), 0, 1.16, 0));
        break;
      case 'fireplace':
        gp.add(m(box(2.00, 2.60, 0.60), mat('#7b7b83'), 0, 1.30, 0));
        gp.add(m(box(1.10, 0.90, 0.40), mat('#221a14'), 0, 0.45, 0.18));
        var ff = m(cone(0.36, 0.70, 6), mat('#ff9a40', { emissive: '#d05010' }), 0, 0.42, 0.26);
        gp.add(ff); gp.flame = ff;
        break;
      case 'bank_booth':
        gp.add(m(box(2.20, 1.10, 0.70), mat('#6a4a2a'), 0, 0.55, 0));
        gp.add(m(box(2.30, 0.12, 0.86), mat('#8a6a3a'), 0, 1.16, 0));
        gp.add(m(box(0.14, 1.90, 0.14), mat('#5a4226'), -1.05, 0.95, 0));
        gp.add(m(box(0.14, 1.90, 0.14), mat('#5a4226'), 1.05, 0.95, 0));
        gp.add(m(box(2.30, 0.16, 0.30), mat('#5a4226'), 0, 1.90, 0));
        break;
      case 'counter':
        gp.add(m(box(3.00, 1.00, 0.70), mat('#7a5a36'), 0, 0.50, 0));
        gp.add(m(box(3.10, 0.10, 0.86), mat('#9a7a4a'), 0, 1.05, 0));
        break;
      case 'stall':
        gp.add(m(box(2.40, 0.90, 1.00), mat('#8a6a42'), 0, 0.45, 0));
        gp.add(m(box(0.10, 1.90, 0.10), wood, -1.10, 0.95, -0.40));
        gp.add(m(box(0.10, 1.90, 0.10), wood, 1.10, 0.95, -0.40));
        var awn = m(box(2.70, 0.12, 1.40), mat(extra.c || '#b04a3a'), 0, 1.95, 0);
        awn.rotation.x = -0.22; gp.add(awn);
        break;
      case 'table':
        gp.add(m(box(1.80, 0.12, 1.00), mat('#8a6a42'), 0, 0.78, 0));
        [[-0.78, 0.40], [0.78, 0.40], [-0.78, -0.40], [0.78, -0.40]].forEach(function (p) {
          gp.add(m(box(0.12, 0.78, 0.12), dark, p[0], 0.39, p[1]));
        });
        break;
      case 'chair':
        gp.add(m(box(0.60, 0.10, 0.60), mat('#8a6a42'), 0, 0.48, 0));
        gp.add(m(box(0.60, 0.70, 0.10), mat('#8a6a42'), 0, 0.82, -0.26));
        [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]].forEach(function (p) {
          gp.add(m(box(0.08, 0.48, 0.08), dark, p[0], 0.24, p[1]));
        });
        break;
      case 'bed':
        gp.add(m(box(1.10, 0.30, 2.10), mat('#6a4a2a'), 0, 0.28, 0));
        gp.add(m(box(1.06, 0.18, 2.00), mat('#b0443a'), 0, 0.50, 0));
        gp.add(m(box(1.00, 0.16, 0.44), mat('#e8e2d0'), 0, 0.60, -0.74));
        gp.add(m(box(1.10, 0.70, 0.12), mat('#5a3a20'), 0, 0.62, -1.02));
        break;
      case 'shelf':
        gp.add(m(box(0.40, 2.00, 1.80), mat('#6a4a2a'), 0, 1.00, 0));
        for (var sh = 0; sh < 3; sh++) gp.add(m(box(0.46, 0.08, 1.86), mat('#8a6a42'), 0, 0.45 + sh * 0.55, 0));
        break;
      case 'pew':
        gp.add(m(box(2.40, 0.12, 0.50), mat('#6a4a2a'), 0, 0.48, 0));
        gp.add(m(box(2.40, 0.60, 0.10), mat('#6a4a2a'), 0, 0.78, -0.22));
        gp.add(m(box(0.12, 0.48, 0.46), dark, -1.10, 0.24, 0));
        gp.add(m(box(0.12, 0.48, 0.46), dark, 1.10, 0.24, 0));
        break;
      case 'altar':
        gp.add(m(box(2.20, 1.00, 1.00), stone, 0, 0.50, 0));
        gp.add(m(box(2.40, 0.14, 1.20), mat('#d8d2c0'), 0, 1.06, 0));
        gp.add(m(box(0.14, 0.70, 0.14), mat('#e0c23c'), 0, 1.48, 0));
        gp.add(m(box(0.50, 0.14, 0.14), mat('#e0c23c'), 0, 1.56, 0));
        break;
      case 'altar_rc':
        gp.add(m(cyl(1.40, 1.70, 0.40, 8), stoneD, 0, 0.20, 0));
        gp.add(m(cyl(0.50, 0.70, 1.50, 6), stone, 0, 1.10, 0));
        var orb = m(sph(0.46, 8, 6), mat(extra.c || '#cfe4ef', { emissive: extra.c || '#88aacc', op: 0.85 }), 0, 2.10, 0);
        gp.add(orb); gp.orb = orb;
        for (var q = 0; q < 4; q++) {
          var an = q / 4 * Math.PI * 2;
          gp.add(m(box(0.30, 1.80, 0.30), stoneD, Math.cos(an) * 2.0, 0.90, Math.sin(an) * 2.0));
        }
        break;
      case 'rift':
        var rf = m(sph(1.30, 9, 7), mat('#7a5fc0', { emissive: '#4a2f90', op: 0.6 }), 0, 1.50, 0);
        rf.scale.set(0.6, 1.3, 0.6); gp.add(rf); gp.orb = rf;
        gp.add(m(cyl(1.50, 1.80, 0.30, 9), stoneD, 0, 0.15, 0));
        break;
      case 'dungeon':
        gp.add(m(box(3.20, 0.60, 3.20), stoneD, 0, 0.30, 0));
        gp.add(m(box(2.20, 0.30, 2.20), mat('#14100e'), 0, 0.62, 0));
        gp.add(m(box(0.50, 2.20, 0.50), stoneD, -1.50, 1.10, -1.50));
        gp.add(m(box(0.50, 2.20, 0.50), stoneD, 1.50, 1.10, -1.50));
        gp.add(m(box(3.60, 0.40, 0.50), stoneD, 0, 2.30, -1.50));
        break;
      case 'patch':
        gp.add(m(box(3.00, 0.16, 3.00), mat('#5a4230'), 0, 0.08, 0));
        for (var rg2 = 0; rg2 < 4; rg2++) gp.add(m(box(2.80, 0.12, 0.22), mat('#4a3626'), 0, 0.18, -1.05 + rg2 * 0.7));
        break;
      case 'spinning_wheel':
        var wh2 = m(cyl(0.70, 0.70, 0.10, 12), wood, 0, 0.90, 0);
        wh2.rotation.x = Math.PI / 2; gp.add(wh2); gp.spin = wh2;
        gp.add(m(box(0.14, 0.90, 0.14), dark, 0, 0.45, 0));
        gp.add(m(box(0.90, 0.12, 0.50), dark, 0, 0.06, 0));
        break;
      case 'pottery_wheel':
        gp.add(m(cyl(0.50, 0.54, 0.12, 10), stone, 0, 0.86, 0));
        gp.add(m(box(0.16, 0.84, 0.16), dark, 0, 0.42, 0));
        gp.add(m(box(0.90, 0.12, 0.90), dark, 0, 0.06, 0));
        break;
      case 'loom':
        gp.add(m(box(1.80, 1.80, 0.20), wood, 0, 0.90, 0));
        gp.add(m(box(0.16, 1.90, 0.60), dark, -0.90, 0.95, 0));
        gp.add(m(box(0.16, 1.90, 0.60), dark, 0.90, 0.95, 0));
        break;
      case 'throne':
        gp.add(m(box(1.40, 0.20, 1.20), mat('#8a6a3a'), 0, 0.70, 0));
        gp.add(m(box(1.40, 1.90, 0.20), mat('#8a6a3a'), 0, 1.50, -0.50));
        gp.add(m(box(0.20, 0.80, 1.20), mat('#8a6a3a'), -0.60, 0.40, 0));
        gp.add(m(box(0.20, 0.80, 1.20), mat('#8a6a3a'), 0.60, 0.40, 0));
        gp.add(m(box(1.20, 0.10, 1.00), mat('#a03a3a'), 0, 0.82, 0.05));
        break;
      case 'flax':
        for (var fx = 0; fx < 7; fx++) {
          var fa = fx / 7 * Math.PI * 2;
          gp.add(m(box(0.06, 0.70, 0.06), mat('#8aa84a'), Math.cos(fa) * 0.24, 0.35, Math.sin(fa) * 0.24));
          gp.add(m(sph(0.09, 5, 4), mat('#6f8fd0'), Math.cos(fa) * 0.24, 0.74, Math.sin(fa) * 0.24));
        }
        break;
      case 'herb':
        for (var hb = 0; hb < 5; hb++) {
          var ha = hb / 5 * Math.PI * 2;
          gp.add(m(box(0.05, 0.40, 0.05), mat('#4a6b3a'), Math.cos(ha) * 0.16, 0.20, Math.sin(ha) * 0.16));
        }
        gp.add(m(sph(0.18, 6, 4), mat(extra.c || '#6f8f4a'), 0, 0.44, 0));
        break;
      case 'hunt':
        gp.add(m(box(0.80, 0.10, 0.80), mat('#6a5a3a'), 0, 0.05, 0));
        gp.add(m(box(0.08, 0.60, 0.08), wood, -0.30, 0.30, -0.30));
        gp.add(m(box(0.08, 0.60, 0.08), wood, 0.30, 0.30, 0.30));
        break;
      case 'fish':
        var ring = m(cyl(0.85, 0.85, 0.06, 14), mat('#bfe0ef', { op: 0.55 }), 0, 0.06, 0);
        gp.add(ring); gp.ring = ring;
        var ring2 = m(cyl(0.50, 0.50, 0.05, 12), mat('#d8f0ff', { op: 0.45 }), 0, 0.10, 0);
        gp.add(ring2); gp.ring2 = ring2;
        break;
      case 'bridge':
        var L = extra.len || 16;
        gp.add(m(box(4.00, 0.24, L), mat('#8a6a42'), 0, 0.10, 0));
        for (var bx = -1; bx <= 1; bx += 2) {
          gp.add(m(box(0.16, 0.90, L), mat('#6a4a2a'), bx * 1.9, 0.60, 0));
          for (var bp = -L / 2 + 1; bp <= L / 2 - 1; bp += 3)
            gp.add(m(box(0.20, 1.10, 0.20), mat('#5a3a20'), bx * 1.9, 0.40, bp));
        }
        break;
      case 'agility':
        if (extra.o === 'log') { var lg = m(cyl(0.44, 0.44, 7.0, 8), mat('#6b4a2a'), 0, 0.44, 0); lg.rotation.x = Math.PI / 2; gp.add(lg); }
        else if (extra.o === 'ropeswing') {
          gp.add(m(box(0.30, 4.40, 0.30), mat('#5d4426'), 0, 2.20, 0));
          gp.add(m(box(0.08, 2.60, 0.08), mat('#c8b88a'), 0, 2.60, 0.90));
        } else if (extra.o === 'stones') {
          for (var sn = 0; sn < 5; sn++) gp.add(m(cyl(0.55, 0.60, 0.40, 7), mat('#7b7b83'), 0, 0.20, -3 + sn * 1.5));
        } else if (extra.o === 'net') {
          gp.add(m(box(4.40, 0.20, 0.20), mat('#5d4426'), 0, 3.20, 0));
          gp.add(m(box(4.20, 3.10, 0.10), mat('#a89a72', { op: 0.85 }), 0, 1.60, 0));
        } else if (extra.o === 'beam') {
          gp.add(m(box(0.40, 0.40, 6.50), mat('#6b4a2a'), 0, 2.20, 0));
          gp.add(m(box(0.50, 2.20, 0.50), mat('#5d4426'), 0, 1.10, -3.0));
          gp.add(m(box(0.50, 2.20, 0.50), mat('#5d4426'), 0, 1.10, 3.0));
        } else {
          gp.add(m(box(5.00, 3.40, 0.60), mat('#8a8a90'), 0, 1.70, 0));
          gp.add(m(box(5.20, 0.30, 0.90), mat('#6a6a72'), 0, 3.50, 0));
        }
        break;
      case 'campfire':
        for (var lo = 0; lo < 5; lo++) {
          var la = lo / 5 * Math.PI * 2;
          var lgm = m(box(0.16, 0.16, 0.90), mat('#5d4426'), Math.cos(la) * 0.22, 0.10, Math.sin(la) * 0.22);
          lgm.rotation.y = la; gp.add(lgm);
        }
        var cf = m(cone(0.38, 0.80, 6), mat('#ff9a30', { emissive: '#d04a10' }), 0, 0.50, 0);
        gp.add(cf); gp.flame = cf;
        break;
      default:
        gp.add(m(box(0.6, 0.6, 0.6), mat('#888'), 0, 0.3, 0));
    }
    return gp;
  }

  /* --- buildings -------------------------------------------------------- */
  /* wallTex / roofTex name the texture painted onto each surface, the way the
     original leaned on a small set of stone, plank, thatch and tile sheets. */
  var STYLE = {
    timber: { wall: '#cfc6a6', beam: '#8a6a44', roof: '#9a6a4e', floor: '#9a7a52',
              wallTex: 'cloth',  roofTex: 'shingle', beamTex: 'plank' },
    stone:  { wall: '#b0aca2', beam: '#8a857a', roof: '#8a8f9a', floor: '#8a867c',
              wallTex: 'brick',  roofTex: 'shingle', beamTex: 'plank' },
    castle: { wall: '#a8a69e', beam: '#8a8880', roof: '#7a808c', floor: '#87847c',
              wallTex: 'brick',  roofTex: 'shingle', beamTex: 'rock' },
    dwarf:  { wall: '#a08e78', beam: '#6a5a44', roof: '#8a6a58', floor: '#7a6a58',
              wallTex: 'rock',   roofTex: 'shingle', beamTex: 'plank' },
    barn:   { wall: '#a8714e', beam: '#8a5a3c', roof: '#b09258', floor: '#8a7a5a',
              wallTex: 'plank',  roofTex: 'thatch',  beamTex: 'plank' },
    hut:    { wall: '#9a8a6c', beam: '#6a5a40', roof: '#b09258', floor: '#6a5a48',
              wallTex: 'plank',  roofTex: 'thatch',  beamTex: 'plank' },
    ruin:   { wall: '#9f9b92', beam: '#77746c', roof: '#6a675f', floor: '#7a766e',
              wallTex: 'rock',   roofTex: 'rock',    beamTex: 'rock' }
  };

  /* Returns { group, roof, walls:[{x1,z1,x2,z2}], doors:[{x,z,...}] } in local space.
     Walls are returned so the collision grid can stamp them. */
  function building(b) {
    var s = STYLE[b.style] || STYLE.timber;
    var gp = new THREE.Group();
    var W = b.w, D = b.d, H = b.style === 'castle' ? 5.2 : (b.style === 'hut' ? 2.8 : 3.4);
    var ruined = b.style === 'ruin';
    /* The authored material set when it is present, the procedural sheets
       when it is not. Doors, interiors and roof fading all depend on this
       geometry, so the shells stay procedural and only their surfaces change. */
    var A = g.RFAssets;
    var wallMat, beamMat, roofMat, floorMat;
    if (A && A.ready) {
      var wallSrc = (b.style === 'stone' || b.style === 'castle' || b.style === 'ruin' || b.style === 'dwarf')
        ? 'Stone' : 'Plaster';
      wallMat = A.material(wallSrc, s.wall, 2);
      beamMat = A.material('Wood', s.beam, 1);
      roofMat = A.material('Roof', s.roof, 3);
      floorMat = A.material('Wood', s.floor, 3);
    } else {
      wallMat = texMat(s.wall, s.wallTex || 'brick', 2);
      beamMat = texMat(s.beam, s.beamTex || 'plank', 1);
      roofMat = texMat(s.roof, s.roofTex || 'shingle', 3);
      floorMat = texMat(s.floor, 'plank', 3);
    }
    var t = 0.35;                     // wall thickness
    var doorW = 2.2;
    var walls = [];

    // floor
    gp.add(m(box(W, 0.16, D), floorMat, 0, 0.08, 0));

    // door side: 0=+z(front) 1=+x 2=-z 3=-x ; b.door=[side, offsetAlongWall]
    var dSide = (b.door && b.door[0]) || 0, dOff = (b.door && b.door[1]) || 0;
    /* The supplied timber-house GLB is now the visible shell for compatible
       homes.  Collision, floor, door interaction and interiors still come
       from the authored building data, so swapping the art cannot change
       pathing or quest access. */
    var useAuthoredShell = !!(A && A.hasV2 && A.hasV2('house_timber') &&
      (b.style === 'timber' || b.style === 'hut') && Math.abs(dOff) < 0.001);

    function wallRun(axis, sign, len, cross) {
      // axis 'x' => wall runs along x at z=sign*cross ; 'z' => along z at x=sign*cross
      var side = axis === 'x' ? (sign > 0 ? 0 : 2) : (sign > 0 ? 1 : 3);
      var hasDoor = side === dSide;
      var segs;
      if (hasDoor) {
        var c = dOff, a = -len / 2, bnd = len / 2;
        segs = [[a, c - doorW / 2], [c + doorW / 2, bnd]];
      } else segs = [[-len / 2, len / 2]];
      segs.forEach(function (sg) {
        var sl = sg[1] - sg[0];
        if (sl <= 0.05) return;
        var mid = (sg[0] + sg[1]) / 2;
        var hh = ruined ? H * (0.35 + Math.random() * 0.5) : H;
        var wm2;
        if (axis === 'x') {
          wm2 = m(box(sl, hh, t), wallMat, mid, hh / 2, sign * (cross - t / 2));
          walls.push({ x1: mid - sl / 2, z1: sign * cross, x2: mid + sl / 2, z2: sign * cross });
        } else {
          wm2 = m(box(t, hh, sl), wallMat, sign * (cross - t / 2), hh / 2, mid);
          walls.push({ x1: sign * cross, z1: mid - sl / 2, x2: sign * cross, z2: mid + sl / 2 });
        }
        if (!useAuthoredShell) gp.add(wm2);
      });
      // door lintel + frame
      if (hasDoor && !ruined) {
        var lh = H - 2.3;
        if (!useAuthoredShell) {
          if (axis === 'x') gp.add(m(box(doorW + 0.3, lh, t), wallMat, dOff, H - lh / 2, sign * (cross - t / 2)));
          else gp.add(m(box(t, lh, doorW + 0.3), wallMat, sign * (cross - t / 2), H - lh / 2, dOff));
        }
      }
    }
    wallRun('x', 1, W, D / 2); wallRun('x', -1, W, D / 2);
    wallRun('z', 1, D, W / 2); wallRun('z', -1, D, W / 2);

    // corner beams
    if (!useAuthoredShell && (b.style === 'timber' || b.style === 'barn' || b.style === 'hut')) {
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (c) {
        gp.add(m(box(0.34, H, 0.34), beamMat, c[0] * (W / 2 - 0.17), H / 2, c[1] * (D / 2 - 0.17)));
      });
      gp.add(m(box(W, 0.26, 0.30), beamMat, 0, H - 0.13, D / 2 - 0.15));
      gp.add(m(box(W, 0.26, 0.30), beamMat, 0, H - 0.13, -D / 2 + 0.15));
    }

    // roof (separate group so it can fade when the player steps inside)
    var roof = new THREE.Group();
    if (useAuthoredShell) {
      var shell = A.v2Model('house_timber');
      var sb = new THREE.Box3().setFromObject(shell);
      var bw = Math.max(0.01, sb.max.x - sb.min.x), bh = Math.max(0.01, sb.max.y - sb.min.y), bd = Math.max(0.01, sb.max.z - sb.min.z);
      var quarterTurn = dSide === 1 || dSide === 3;
      shell.scale.set((quarterTurn ? D : W) / bw, (H + 2.0) / bh, (quarterTurn ? W : D) / bd);
      shell.rotation.y = dSide === 0 ? 0 : (dSide === 1 ? -Math.PI / 2 : (dSide === 2 ? Math.PI : Math.PI / 2));
      shell.userData.authoredV2 = 'house_timber';
      roof.add(shell);
    } else if (!ruined) {
      if (b.style === 'castle') {
        roof.add(m(box(W + 0.6, 0.40, D + 0.6), roofMat, 0, H + 0.2, 0));
        // crenellations
        for (var cx = -W / 2; cx <= W / 2; cx += 1.4) {
          roof.add(m(box(0.6, 0.7, 0.5), roofMat, cx, H + 0.75, D / 2 + 0.05));
          roof.add(m(box(0.6, 0.7, 0.5), roofMat, cx, H + 0.75, -D / 2 - 0.05));
        }
        for (var cz = -D / 2; cz <= D / 2; cz += 1.4) {
          roof.add(m(box(0.5, 0.7, 0.6), roofMat, W / 2 + 0.05, H + 0.75, cz));
          roof.add(m(box(0.5, 0.7, 0.6), roofMat, -W / 2 - 0.05, H + 0.75, cz));
        }
      } else {
        /* The ridge has to run along the building's LONGER side. Building it
           always along X left half the houses with the ridge crossing the
           short way, which is what reads as a roof rotated the wrong way. */
        var swap = D > W;
        var RW = swap ? D : W, RD = swap ? W : D;
        if (swap) roof.rotation.y = Math.PI / 2;
        var rise = Math.max(1.6, Math.min(3.4, RD * 0.62)), slope = Math.atan2(rise, RD / 2);
        var slabLen = Math.sqrt(rise * rise + (RD / 2) * (RD / 2)) + 0.25;
        /* The far slab must fall away toward +Z and the near one toward -Z.
           These two signs were reversed, which turned every gabled roof into a
           valley instead of a ridge. */
        var r1 = m(box(RW + 0.5, 0.20, slabLen), roofMat, 0, H + rise / 2, RD / 4);
        r1.rotation.x = slope; roof.add(r1);
        var r2 = m(box(RW + 0.5, 0.20, slabLen), roofMat, 0, H + rise / 2, -RD / 4);
        r2.rotation.x = -slope; roof.add(r2);
        // gable ends
        /* A gable closes the END of the ridge. These were being built across
           the eave side instead, so the triangle punched straight up through
           the roof - which is what reads as a roof rotated the wrong way.
           The triangle spans the SHORT dimension and stands at x = +/-RW/2. */
        var gshape = new THREE.BufferGeometry();
        var verts = new Float32Array([
          -RD / 2, 0, 0, RD / 2, 0, 0, 0, rise, 0,
          RD / 2, 0, 0, -RD / 2, 0, 0, 0, rise, 0
        ]);
        gshape.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        gshape.computeVertexNormals();
        var g1 = new THREE.Mesh(gshape, wallMat);
        g1.rotation.y = Math.PI / 2; g1.position.set(RW / 2 - 0.05, H - 0.02, 0); roof.add(g1);
        var g2 = new THREE.Mesh(gshape, wallMat);
        g2.rotation.y = Math.PI / 2; g2.position.set(-RW / 2 + 0.05, H - 0.02, 0); roof.add(g2);
        if (b.style === 'timber' || b.style === 'stone') {
          var ch = m(box(0.8, 1.8, 0.8), texMat('#8a7a68', 'brick', 1), RW / 2 - 1.2, H + rise * 0.6, -RD / 4);
          roof.add(ch);
        }
      }
    }
    gp.add(roof);

    // tower
    if (b.tower) {
      var tw = new THREE.Group();
      tw.position.set(W / 2 - 1.6, 0, -D / 2 + 1.6);
      tw.add(m(cyl(1.5, 1.7, H + 3.4, 9), wallMat, 0, (H + 3.4) / 2, 0));
      tw.add(m(cone(2.0, 2.2, 9), roofMat, 0, H + 4.6, 0));
      gp.add(tw);
      walls.push({ x1: W / 2 - 1.6, z1: -D / 2 + 1.6, x2: W / 2 - 1.6, z2: -D / 2 + 1.6, r: 1.6 });
    }

    // door slab (swings)
    var doorG = new THREE.Group();
    if (!ruined) {
      var hinge = new THREE.Group();
      var dm = m(box(doorW - 0.1, 2.25, 0.12), mat('#6a4a2a'), (doorW - 0.1) / 2, 1.12, 0);
      hinge.add(dm);
      hinge.add(m(box(doorW - 0.3, 0.12, 0.16), beamMat, (doorW - 0.1) / 2, 1.8, 0.01));
      if (dSide === 0) { hinge.position.set(dOff - doorW / 2, 0.08, D / 2 - t / 2); }
      else if (dSide === 2) { hinge.position.set(dOff - doorW / 2, 0.08, -D / 2 + t / 2); hinge.rotation.y = Math.PI; hinge.position.x = dOff + doorW / 2; }
      else if (dSide === 1) { hinge.position.set(W / 2 - t / 2, 0.08, dOff + doorW / 2); hinge.rotation.y = -Math.PI / 2; }
      else { hinge.position.set(-W / 2 + t / 2, 0.08, dOff - doorW / 2); hinge.rotation.y = Math.PI / 2; }
      doorG.add(hinge);
      gp.add(doorG);
      gp.doorHinge = hinge;
    }

    // interior furniture
    (b.interior || []).forEach(function (f) {
      var p = prop(f[0], {});
      p.position.set(f[1], 0.16, f[2]);
      p.rotation.y = f[3] || 0;
      gp.add(p);
      if (!gp.props) gp.props = [];
      gp.props.push({ type: f[0], obj: p, x: f[1], z: f[2] });
    });

    gp.roof = roof;
    gp.wallSegs = walls;
    gp.doorSide = dSide; gp.doorOff = dOff; gp.doorW = doorW;
    gp.dims = { w: W, d: D, h: H };
    return gp;
  }

  g.RFModels = {
    mat: mat, texMat: texMat, foliageMat: foliageMat, mergeGroup: mergeGroup, treeGeometry: treeGeometry, box: box, cyl: cyl, cone: cone, sph: sph, mesh: m,
    humanoid: humanoid, creature: creature, equipVisuals: equipVisuals, equipRigged: equipRigged,
    weaponModel: weaponModel, shieldModel: shieldModel, helmModel: helmModel,
    tree: tree, stump: stump, rock: rock, prop: prop, building: building,
    TREESPEC: TREESPEC, TIERCOL: TIERCOL, ORECOL: ORECOL, STYLE: STYLE
  };
})(typeof window !== 'undefined' ? window : globalThis);
