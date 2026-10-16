/* Emberfall - the game itself.
   Screens, the 3D scene, the third-person camera, click-to-move with A*, and
   the loop that ties the server's word about the world to what you see. */
(function (g) {
  'use strict';

  /* The rig files are authored Y-up.  They are loaded without the static
     asset pack's Z-up correction, and actors advance their AnimationMixer in
     entities.js.  Keep this enabled: the procedural humanoid is fallback only. */
  g.RF_USE_RIG = false; // V21 safe-render: procedural characters only
  var THREE = g.THREE;

  var D = { items: {}, itemList: [], quests: [], npcs: {}, shops: {}, world: null,
            spells: [], prayers: [], recipes: null };
  var P = null;                 // player snapshot
  var myAid = 0;
  var scene, camera, renderer, sun, hemi, skyDome = null;
  var raycaster = new THREE.Raycaster();
  /* A separate one for camera occlusion. Sharing it meant the camera's
     short 'far' clamp leaked into picking, so anything beyond about 15
     units silently could not be clicked - which is why interacting often
     took two or three goes. */
  // (picking raycaster declared above)
  var camRay = new THREE.Raycaster();         // camera occlusion, kept separate
  var mouse = new THREE.Vector2();
  var clock = null;
  var running = false;

  /* camera state */
  var camYaw = 0.6, camPitch = 0.72, camDist = 15;
  /* Arrow keys drive targets; the camera eases toward them each frame so
     rotation and pitch feel smooth rather than stepped. */
  var camYawTarget = 0.6, camPitchTarget = 0.72, camDistTarget = 15;
  var camKeys = { arrowleft: 0, arrowright: 0, arrowup: 0, arrowdown: 0 };
  var camTarget = new THREE.Vector3();

  /* movement */
  var path = [];                 // list of {x,z}
  var moveTarget = null;
  var WALK_SPEED = 4.6;          // tiles per second (1 tile per 600ms tick)
  var RUN_SPEED = 9.2;           // twice walking, as in the classic engine
  var SPEED = WALK_SPEED;
  var running_on = false;        // run toggle
  var runEnergy = 100;           // 0-100, drains while running
  var localX = 0, localZ = 0, localR = 0;
  var moving = false;

  /* interaction */
  var interactTarget = null;     // {kind, id, x, z, range, fn}
  var combatTarget = null;       // spawn index
  var lastAttack = 0;
  var gatherTimer = 0;
  var fires = [];                // local fire objects {x,z,node,until}
  var groundNodes = {};          // gid -> {node, data}
  var groundGroup = null;
  var destMark = null;           // where you clicked, drawn on the minimap
  var nameplates = {};
  var hoverLabel = '';

  /* -------------------------------------------------------------- screens */
  function show(id) {
    ['screen-title', 'screen-char', 'screen-load', 'screen-game'].forEach(function (s) {
      document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
    });
  }

  /* ================================================================ TITLE */
  function initTitle() {
    var bl = document.getElementById('btnShowLogin');
    var br = document.getElementById('btnShowRegister');
    var fl = document.getElementById('formLogin');
    var fr = document.getElementById('formRegister');
    var tb = document.querySelector('.title-buttons');
    function reset() { fl.style.display = 'none'; fr.style.display = 'none'; tb.style.display = 'flex'; }
    bl.onclick = function () { tb.style.display = 'none'; fl.style.display = 'block'; document.getElementById('loginUser').focus(); startAudio(); };
    br.onclick = function () { tb.style.display = 'none'; fr.style.display = 'block'; document.getElementById('regUser').focus(); startAudio(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (b) { b.onclick = reset; });

    document.getElementById('btnLogin').onclick = doLogin;
    document.getElementById('btnRegister').onclick = doRegister;
    document.getElementById('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    document.getElementById('regPass2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doRegister(); });

    titleBackdrop();
    serverSelfCheck();
    showBuildTag();

    /* already signed in from last time? */
    if (g.RFNet.restoreToken()) {
      g.RFNet.load().then(function (r) {
        if (r.ok) { P = r.player; myAid = r.aid || 0; afterLogin(!P.app); }
      }).catch(function () {});
    }
  }

  /* Before anyone types a password, confirm the API is actually reachable and
     speaking JSON. Failing here with a clear banner beats failing at login. */
  function serverSelfCheck() {
    if (location.protocol === 'file:') {
      titleError('This page was opened directly from your hard drive (file://). '
        + 'Emberfall needs a PHP web server. Upload the files to your host '
        + 'and open them over http:// or https://.');
      return;
    }
    g.RFNet.post('ping', {}).then(function (r) {
      if (!r || !r.ok) { titleError('The server answered, but not correctly: '
        + ((r && r.error) || 'no reply') + ' - open health.php for details.'); return; }
      if (!r.writable) {
        titleError('The server is running, but data/store is not writable, so no '
          + 'character can be saved. Set that folder to 755 (or 777 on strict hosts).');
      }
    }).catch(function (e) {
      titleError(e.message);
    });
  }
  /* Compares the world the browser loaded against the one the server is
     running and says so plainly. */
  function showBuildTag() {
    var tag = document.getElementById('buildTag');
    if (!tag) return;
    var local = (g.RFDATA && g.RFDATA.world && g.RFDATA.world.build) || 'unknown';
    tag.textContent = 'build ' + local;
    g.RFNet.post('ping', {}).then(function (r) {
      if (!r || !r.ok || !r.build) return;
      if (r.build === local) { tag.textContent = 'build ' + local + ' \u2713'; return; }
      tag.className = 'stale';
      tag.textContent = 'browser build ' + local + ' but server is ' + r.build +
        ' - hard refresh (Ctrl+F5)';
    }).catch(function () {});
  }

  function titleError(msg) {
    var wrap = document.querySelector('.title-wrap');
    if (!wrap || document.getElementById('titleErr')) return;
    var d = document.createElement('div');
    d.id = 'titleErr';
    d.className = 'parchment';
    d.style.cssText = 'max-width:620px;margin-top:10px;color:#7a1f14;font-size:14px;line-height:1.5';
    d.innerHTML = '<b>The game cannot reach its server.</b><br>' + msg
      + '<br><br><a href="health.php" style="color:#6a4f1c"><b>Open health.php &rarr;</b></a>'
      + ' &nbsp; <a href="api/index.php?a=ping" style="color:#6a4f1c"><b>Open the API ping &rarr;</b></a>';
    wrap.appendChild(d);
  }

  function startAudio() {
    g.RFAudio.resume();
    g.RFAudio.startMusic('town');
  }

  function doLogin() {
    var u = document.getElementById('loginUser').value.trim();
    var p = document.getElementById('loginPass').value;
    var err = document.getElementById('loginErr');
    err.textContent = '';
    if (!u || !p) { err.textContent = 'Fill in both fields.'; return; }
    err.textContent = 'Checking...';
    g.RFNet.login(u, p).then(function (r) {
      if (!r.ok) { err.textContent = r.error; return; }
      err.textContent = '';
      afterLogin(r.needChar);
    }).catch(function (e) { err.textContent = 'Cannot reach the server: ' + e.message; });
  }
  function doRegister() {
    var u = document.getElementById('regUser').value.trim();
    var p = document.getElementById('regPass').value;
    var p2 = document.getElementById('regPass2').value;
    var err = document.getElementById('regErr');
    err.textContent = '';
    if (p !== p2) { err.textContent = 'The two passwords do not match.'; return; }
    if (p.length < 6) { err.textContent = 'Use at least six characters.'; return; }
    err.textContent = 'Creating...';
    g.RFNet.register(u, p).then(function (r) {
      if (!r.ok) { err.textContent = r.error; return; }
      err.textContent = '';
      afterLogin(true);
    }).catch(function (e) { err.textContent = 'Cannot reach the server: ' + e.message; });
  }

  function afterLogin(needChar) {
    startAudio();
    if (needChar) { show('screen-char'); initCharCreation(); }
    else { show('screen-load'); boot(); }
  }

  /* A slowly drifting low-poly hill behind the title. */
  var titleRen = null, titleRunning = true;
  function titleBackdrop() {
    var cv = document.getElementById('titleCanvas');
    var r, s, c;
    try {
      r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    } catch (e) { return; }
    titleRen = r;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    s = new THREE.Scene();
    s.fog = new THREE.Fog(0x1a1510, 30, 130);
    c = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
    c.position.set(0, 9, 26);
    c.lookAt(0, 4, 0);
    s.add(new THREE.HemisphereLight(0x8899bb, 0x3a3020, 1.1));
    var dl = new THREE.DirectionalLight(0xffd9a0, 0.9);
    dl.position.set(-20, 30, 12);
    s.add(dl);

    var geo = new THREE.PlaneGeometry(220, 220, 40, 40);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, Math.sin(x * 0.07) * 2.4 + Math.cos(z * 0.06) * 2.1 + Math.sin((x + z) * 0.13) * 0.8 - 3);
    }
    geo.computeVertexNormals();
    s.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3f5c2c, flatShading: true })));

    var M = g.RFModels;
    for (var t = 0; t < 26; t++) {
      var kinds = ['Tree', 'Oak', 'Willow'];
      var tr = M.tree(kinds[t % 3]);
      tr.position.set(-70 + Math.random() * 140, -2.4, -60 + Math.random() * 60);
      tr.scale.setScalar(0.8 + Math.random() * 0.6);
      s.add(tr);
    }
    var keep = M.building({ name: 'Keep', x: 0, z: -30, w: 16, d: 12, style: 'castle',
      door: [0, 0], rot: 0, interior: [] });
    keep.position.set(-6, -2.6, -34);
    s.add(keep);

    /* A red cross flashes where you clicked, so a click always feels answered
     even when the thing you clicked is out of reach. */
  /* Flash, a rising shimmer and a sound, so a teleport reads as a spell. */
  function playTeleport() {
    var f = document.getElementById('teleFlash');
    if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    g.RFAudio.play('teleport');
    var me = g.RFEntities.local;
    if (me) me.swing();
  }

  function markClick(cx, cy, kind) {
    var host = document.getElementById('viewport');
    var r = host.getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'click-x' + (kind === 'none' ? ' dead' : '');
    d.style.left = (cx - r.left) + 'px';
    d.style.top = (cy - r.top) + 'px';
    host.appendChild(d);
    setTimeout(function () { d.remove(); }, 420);
  }

  /* ---- collision debug overlay (toggle with the ` key) ------------------
     green walkable, red blocked, blue water, cyan the current path,
     yellow the tile the interaction router picked. */
  var debugGrid = null, debugOn = false;
  function toggleCollisionDebug() {
    debugOn = !debugOn;
    if (!debugOn) {
      if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); debugGrid = null; }
      g.RFUI.chat('Collision overlay off.', 'c-game');
      return;
    }
    g.RFUI.chat('Collision overlay on. Green walkable, red blocked, blue water, cyan your path.', 'c-game');
    rebuildCollisionDebug();
  }
  function disposeGroup(grp) {
    grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  }
  function rebuildCollisionDebug() {
    if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); }
    debugGrid = new THREE.Group();
    var TM = g.RFTerrainMgr;
    var R = 26;
    var cx = Math.floor(localX), cz = Math.floor(localZ);
    var quad = new THREE.PlaneGeometry(0.92, 0.92);
    quad.rotateX(-Math.PI / 2);
    var mats = {
      walk: new THREE.MeshBasicMaterial({ color: 0x2fbf4a, transparent: true, opacity: 0.22 }),
      block: new THREE.MeshBasicMaterial({ color: 0xd03a2a, transparent: true, opacity: 0.34 }),
      water: new THREE.MeshBasicMaterial({ color: 0x2f6ed0, transparent: true, opacity: 0.30 }),
      path: new THREE.MeshBasicMaterial({ color: 0x30d8d8, transparent: true, opacity: 0.55 }),
      spot: new THREE.MeshBasicMaterial({ color: 0xe8d23a, transparent: true, opacity: 0.6 })
    };
    var onPath = {};
    path.forEach(function (p2) { onPath[Math.floor(p2.x) + ',' + Math.floor(p2.z)] = 1; });
    for (var dz = -R; dz <= R; dz++) {
      for (var dx = -R; dx <= R; dx++) {
        var x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0) continue;
        var key = x + ',' + z;
        var m;
        if (onPath[key]) m = mats.path;
        else if (TM.h(x + 0.5, z + 0.5) < 0.08) m = mats.water;
        else m = TM.blockedAt(x, z) ? mats.block : mats.walk;
        var q = new THREE.Mesh(quad, m);
        q.position.set(x + 0.5, TM.h(x + 0.5, z + 0.5) + 0.06, z + 0.5);
        debugGrid.add(q);
      }
    }
    if (interactTarget) {
      var st = interactionTile(interactTarget.x, interactTarget.z);
      if (st) {
        var q2 = new THREE.Mesh(quad, mats.spot);
        q2.position.set(st.x, g.RFTerrainMgr.h(st.x, st.z) + 0.09, st.z);
        debugGrid.add(q2);
      }
    }
    scene.add(debugGrid);
  }

  function resize() {
      var w = cv.clientWidth || window.innerWidth, h = cv.clientHeight || window.innerHeight;
      r.setSize(w, h, false);
      c.aspect = w / h; c.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();
    var a = 0;
    (function loop() {
      if (!titleRunning) return;
      if (document.getElementById('screen-title').style.display === 'none') { requestAnimationFrame(loop); return; }
      a += 0.0012;
      c.position.set(Math.sin(a) * 30, 10, Math.cos(a) * 30 + 4);
      c.lookAt(0, 2, -20);
      r.render(s, c);
      requestAnimationFrame(loop);
    })();
  }

  /* ==================================================== CHARACTER CREATION */
  var charApp = { build: 0, skin: '#e0b892', hair: '#3a2a20', hairStyle: 1, beard: 0,
                  beardColor: '#3a2a20', shirt: '#5a7a9a', legs: '#4a4238', boots: '#3a2f26' };
  var charScene, charCam, charRen, charModel, charSpin = 0, charInit = false;

  var SKINS = ['#f2d7bd', '#e0b892', '#c99568', '#a3704a', '#7a4f30', '#553524'];
  var HAIRS = ['#2a2018', '#5a3a20', '#8b5a2b', '#c9a13c', '#d8d4cc', '#8f3a2a', '#3a4a6a'];
  var SHIRTS = ['#5a7a9a', '#7a4a4a', '#4a6b3a', '#6a4a7a', '#8a7a3a', '#3a3a4a', '#a86a3a', '#d0cabb'];
  var LEGS = ['#4a4238', '#3a3a4a', '#5a4a3a', '#2f3a2f', '#6a5a4a', '#33303a'];
  var BOOTS = ['#3a2f26', '#2a2420', '#5a4430', '#6b6b63'];

  function initCharCreation() {
    if (charInit) { charRen && charRen.setAnimationLoop(charLoop); return; }
    charInit = true;
    var host = document.getElementById('charViewport');
    try { charRen = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { charRen = new THREE.WebGLRenderer(); }
    charRen.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(charRen.domElement);
    charScene = new THREE.Scene();
    charCam = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    /* Framed on the whole figure, slightly above the belt, so the head is not
       seen from underneath - that steep angle was what made it look as though
       the head was on the wrong way round. */
    charCam.position.set(0, 1.45, 4.9);
    charCam.lookAt(0, 1.02, 0);
    charScene.add(new THREE.HemisphereLight(0xcfd8e8, 0x4a4030, 1.25));
    var dl = new THREE.DirectionalLight(0xffe8c0, 1.0);
    dl.position.set(3, 6, 5);
    charScene.add(dl);
    var floor = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 20),
      new THREE.MeshLambertMaterial({ color: 0x5a4a34, flatShading: true }));
    floor.position.y = -0.09;
    charScene.add(floor);

    swatchRow('optBuild', [['Sturdy', 0], ['Slight', 1]], 'build', true);
    swatchRow('optSkin', SKINS, 'skin');
    swatchRow('optHairStyle', [['Bald', 0], ['Short', 1], ['Long', 2], ['Braids', 3], ['Topknot', 4]], 'hairStyle', true);
    swatchRow('optHair', HAIRS, 'hair');
    swatchRow('optBeard', [['None', 0], ['Beard', 1]], 'beard', true);
    swatchRow('optShirt', SHIRTS, 'shirt');
    swatchRow('optLegs', LEGS, 'legs');
    swatchRow('optBoots', BOOTS, 'boots');

    document.getElementById('spinL').onclick = function () { charSpin -= 0.6; };
    document.getElementById('spinR').onclick = function () { charSpin += 0.6; };
    document.getElementById('btnCharDone').onclick = finishCharacter;

    rebuildCharModel();
    /* A red cross flashes where you clicked, so a click always feels answered
     even when the thing you clicked is out of reach. */
  /* Flash, a rising shimmer and a sound, so a teleport reads as a spell. */
  function playTeleport() {
    var f = document.getElementById('teleFlash');
    if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    g.RFAudio.play('teleport');
    var me = g.RFEntities.local;
    if (me) me.swing();
  }

  function markClick(cx, cy, kind) {
    var host = document.getElementById('viewport');
    var r = host.getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'click-x' + (kind === 'none' ? ' dead' : '');
    d.style.left = (cx - r.left) + 'px';
    d.style.top = (cy - r.top) + 'px';
    host.appendChild(d);
    setTimeout(function () { d.remove(); }, 420);
  }

  /* ---- collision debug overlay (toggle with the ` key) ------------------
     green walkable, red blocked, blue water, cyan the current path,
     yellow the tile the interaction router picked. */
  var debugGrid = null, debugOn = false;
  function toggleCollisionDebug() {
    debugOn = !debugOn;
    if (!debugOn) {
      if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); debugGrid = null; }
      g.RFUI.chat('Collision overlay off.', 'c-game');
      return;
    }
    g.RFUI.chat('Collision overlay on. Green walkable, red blocked, blue water, cyan your path.', 'c-game');
    rebuildCollisionDebug();
  }
  function disposeGroup(grp) {
    grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  }
  function rebuildCollisionDebug() {
    if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); }
    debugGrid = new THREE.Group();
    var TM = g.RFTerrainMgr;
    var R = 26;
    var cx = Math.floor(localX), cz = Math.floor(localZ);
    var quad = new THREE.PlaneGeometry(0.92, 0.92);
    quad.rotateX(-Math.PI / 2);
    var mats = {
      walk: new THREE.MeshBasicMaterial({ color: 0x2fbf4a, transparent: true, opacity: 0.22 }),
      block: new THREE.MeshBasicMaterial({ color: 0xd03a2a, transparent: true, opacity: 0.34 }),
      water: new THREE.MeshBasicMaterial({ color: 0x2f6ed0, transparent: true, opacity: 0.30 }),
      path: new THREE.MeshBasicMaterial({ color: 0x30d8d8, transparent: true, opacity: 0.55 }),
      spot: new THREE.MeshBasicMaterial({ color: 0xe8d23a, transparent: true, opacity: 0.6 })
    };
    var onPath = {};
    path.forEach(function (p2) { onPath[Math.floor(p2.x) + ',' + Math.floor(p2.z)] = 1; });
    for (var dz = -R; dz <= R; dz++) {
      for (var dx = -R; dx <= R; dx++) {
        var x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0) continue;
        var key = x + ',' + z;
        var m;
        if (onPath[key]) m = mats.path;
        else if (TM.h(x + 0.5, z + 0.5) < 0.08) m = mats.water;
        else m = TM.blockedAt(x, z) ? mats.block : mats.walk;
        var q = new THREE.Mesh(quad, m);
        q.position.set(x + 0.5, TM.h(x + 0.5, z + 0.5) + 0.06, z + 0.5);
        debugGrid.add(q);
      }
    }
    if (interactTarget) {
      var st = interactionTile(interactTarget.x, interactTarget.z);
      if (st) {
        var q2 = new THREE.Mesh(quad, mats.spot);
        q2.position.set(st.x, g.RFTerrainMgr.h(st.x, st.z) + 0.09, st.z);
        debugGrid.add(q2);
      }
    }
    scene.add(debugGrid);
  }

  function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      charRen.setSize(w, h, false);
      charCam.aspect = w / h; charCam.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();
    charRen.setAnimationLoop(charLoop);
  }
  function charLoop() {
    if (!charModel) return;
    charSpin += 0.004;
    /* face the camera squarely by default */
    charModel.rotation.y = charSpin;
    if (charModel.head) charModel.head.rotation.set(0, 0, 0);
    charRen.render(charScene, charCam);
  }
  function swatchRow(id, values, key, isText) {
    var host = document.getElementById(id);
    host.innerHTML = '';
    values.forEach(function (v) {
      var label = isText ? v[0] : null;
      var val = isText ? v[1] : v;
      var d = document.createElement('div');
      d.className = 'sw' + (isText ? ' text' : '') + (charApp[key] === val ? ' sel' : '');
      if (isText) d.textContent = label; else d.style.background = val;
      d.onclick = function () {
        charApp[key] = val;
        if (key === 'hair') charApp.beardColor = val;
        Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('sel'); });
        d.classList.add('sel');
        rebuildCharModel();
        g.RFAudio.play('click');
      };
      host.appendChild(d);
    });
  }
  function rebuildCharModel() {
    if (charModel) charScene.remove(charModel);
    charModel = g.RFModels.humanoid(charApp);
    charModel.position.y = 0;
    charScene.add(charModel);
  }
  function finishCharacter() {
    var nm = document.getElementById('charName').value.trim();
    var err = document.getElementById('charErr');
    err.textContent = 'Saving...';
    g.RFNet.createCharacter(charApp).then(function (r) {
      if (!r.ok) { err.textContent = r.error; return; }
      charRen && charRen.setAnimationLoop(null);
      show('screen-load');
      boot();
    }).catch(function (e) { err.textContent = e.message; });
  }

  /* ============================================================== LOADING */
  /* iOS Safari allows only a handful of live WebGL contexts and will fail
     outright rather than evicting one, so hand back the title and
     character-creation renderers before the world asks for its own. */
  function releaseOtherContexts() {
    titleRunning = false;
    [titleRen, charRen].forEach(function (r) {
      if (!r) return;
      try {
        r.setAnimationLoop && r.setAnimationLoop(null);
        var ext = r.getContext && r.getContext().getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        r.dispose && r.dispose();
      } catch (e) {}
    });
    titleRen = null;
    charRen = null;
  }

  function setLoad(pct, text) {
    document.getElementById('loadFill').style.width = Math.round(pct) + '%';
    if (text) document.getElementById('loadText').textContent = text;
  }

  /* Floating XP drops, driven by diffing the server's skill table against the
     last one we held. Previously the viewport showed the item you picked up,
     not the experience you earned. */
  var lastSkills = null;
  function showXpGains(newP) {
    if (!newP || !newP.skills) return;
    if (lastSkills) {
      for (var k in newP.skills) {
        var was = lastSkills[k] ? lastSkills[k].x : 0;
        var now = newP.skills[k].x;
        if (now > was) g.RFUI.xpDrop(k.charAt(0).toUpperCase() + k.slice(1), now - was);
      }
    }
    lastSkills = {};
    for (var j in newP.skills) lastSkills[j] = { x: newP.skills[j].x };
  }

  var pendingWarnings = [];
  var stage = 'starting up';
  var DATA_VERSION = 'rf2-aab730f4d4c4';
  /* One place to report a failed start, with everything needed to diagnose it
     gathered into a block the player can copy and send on. */
  function showLoadFailure(atStage, detail, err) {
    setLoad(100, 'Failed while ' + atStage + '. ' + detail);
    var t = document.getElementById('loadText');
    t.style.color = '#e0705a';
    t.style.maxWidth = '640px';
    t.style.margin = '0 auto';
    t.style.textAlign = 'center';
    if (document.getElementById('diagBox')) return;

    var box = document.createElement('div');
    box.id = 'diagBox';
    box.style.cssText = 'margin-top:16px;text-align:center';
    box.innerHTML = '<a href="health.php" style="color:#e0c23c">Open health.php &rarr;</a>'
      + ' &nbsp;&nbsp; <a href="api/index.php?a=ping" style="color:#e0c23c">Open the API ping &rarr;</a>';
    var btn = document.createElement('button');
    btn.className = 'stone-btn small';
    btn.style.marginTop = '12px';
    btn.textContent = 'Copy diagnostics';
    var pre = document.createElement('textarea');
    pre.readOnly = true;
    pre.style.cssText = 'display:none;width:min(620px,90vw);height:170px;margin-top:10px;'
      + 'background:#120e09;color:#cbbd9a;border:2px solid #6a5535;font-size:11px;padding:8px';
    btn.onclick = function () {
      gatherDiagnostics(atStage, detail, err).then(function (txt) {
        pre.value = txt;
        pre.style.display = 'block';
        pre.select();
        try { document.execCommand('copy'); } catch (e2) {}
        btn.textContent = 'Copied - paste this to whoever is helping you';
      });
    };
    box.appendChild(document.createElement('br'));
    box.appendChild(btn);
    box.appendChild(pre);
    t.parentNode.appendChild(box);
  }

  function gatherDiagnostics(atStage, detail, err) {
    var lines = [];
    function add(k, v) { lines.push(k + ': ' + v); }
    add('Emberfall', 'build ' + DATA_VERSION);
    add('failed at', atStage);
    add('error', detail);
    if (err && err.stack) add('stack', String(err.stack).split('\n').slice(0, 3).join(' | '));
    add('page', location.href);
    add('browser', navigator.userAgent);
    add('embedded data', g.RFDATA ? ('present, ' + (g.RFDATA.items ? g.RFDATA.items.length : 0) + ' items') : 'MISSING - js/gamedata.js did not load');
    add('three.js', window.THREE ? 'loaded' : 'MISSING');
    add('WebGL', window.WebGLRenderingContext ? 'available' : 'unavailable');
    ['RFTerrain', 'RFModels', 'RFTerrainMgr', 'RFPath', 'RFWorld', 'RFIcons', 'RFAudio', 'RFNet', 'RFEntities', 'RFUI']
      .forEach(function (k) { if (!g[k]) lines.push('missing module: ' + k); });

    var probes = [
      ['api ping', 'api/index.php?a=ping'],
      ['js/gamedata.js', 'js/gamedata.js'],
      ['data/items.json', 'data/items.json']
    ];
    return Promise.all(probes.map(function (p) {
      return fetch(p[1]).then(function (r) {
        return r.text().then(function (txt) {
          return p[0] + ': HTTP ' + r.status + ' -> ' + txt.slice(0, 90).replace(/\s+/g, ' ');
        });
      }).catch(function (e2) { return p[0] + ': request failed - ' + e2.message; });
    })).then(function (res) {
      return lines.concat(res).join('\n');
    });
  }

  function boot() {
    setLoad(4, 'Fetching the ledger...');
    stage = 'contacting the server';
    /* Game data comes from PHP in a single reply. Fetching data/*.json
       directly is faster but plenty of hosts refuse web access to a data
       folder, and PHP can always read the files, so that is the primary
       route and the static files are only a fallback. */
    function getJson(path) {
      stage = 'loading ' + path;
      return fetch(path + '?v=2').then(function (r) {
        return r.text().then(function (txt) {
          if (!r.ok) throw new Error(path + ' could not be loaded (HTTP ' + r.status + ')');
          try { return JSON.parse(txt); }
          catch (e) { throw new Error(path + ' did not contain game data'); }
        });
      });
    }

    function loadGameData() {
      /* First choice: the copy that shipped inside js/gamedata.js. No request,
         nothing to block, nothing to parse.

         But a browser will happily hand back yesterday's copy from cache, and
         a stale world against a fresh server drops you inside a building or
         off the edge of the map with nowhere to walk. So the server states
         which world it is running and anything else is refetched. */
      var serverBuild = (serverLoad && serverLoad.build) || '';
      if (g.RFDATA && g.RFDATA.items && g.RFDATA.world) {
        var localBuild = g.RFDATA.world.build || '';
        if (!serverBuild || localBuild === serverBuild) {
          stage = 'reading the embedded world';
          return Promise.resolve(g.RFDATA);
        }
        pendingWarnings.push('Your browser had an out-of-date copy of the world '
          + '(' + (localBuild || 'unstamped') + ' vs ' + serverBuild + '); a fresh copy was downloaded.');
        try { localStorage.removeItem('rf2data'); } catch (e) {}
      }
      stage = 'downloading the world';
      var cached = serverBuild ? null : readCachedData();
      if (cached) return Promise.resolve(cached);
      return g.RFNet.post('gamedata', {}).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'the server sent no game data');
        writeCachedData(r.v, r.data);
        return r.data;
      }).catch(function (viaPhp) {
        /* Last resort: try the raw files, in case PHP is memory-limited. */
        stage = 'downloading the world (direct)';
        return Promise.all([
          getJson('data/items.json'), getJson('data/npcs.json'),
          getJson('data/quests.json'), getJson('data/world.json'),
          getJson('data/magic.json')
        ]).then(function (a) {
          return { items: a[0], npcs: a[1], quests: a[2], world: a[3], magic: a[4] };
        }).catch(function (direct) {
          throw new Error('The game data could not be loaded. Through PHP: '
            + viaPhp.message + '. Directly: ' + direct.message
            + '. Open health.php - it checks both routes.');
        });
      });
    }

    /* Keep a copy in the browser so a second visit starts almost instantly.
       Wrapped because Safari private browsing refuses storage outright. */
    function readCachedData() {
      try {
        var v = localStorage.getItem('rf2dataV');
        var blob = localStorage.getItem('rf2data');
        if (!v || !blob || v !== DATA_VERSION) return null;
        return JSON.parse(blob);
      } catch (e) { return null; }
    }
    function writeCachedData(v, data) {
      try {
        localStorage.setItem('rf2dataV', DATA_VERSION);
        localStorage.setItem('rf2data', JSON.stringify(data));
      } catch (e) { /* quota or private mode: not important */ }
    }

    var serverLoad = null;
    g.RFNet.load().then(function (me) {
      serverLoad = me;
      return Promise.all([loadGameData(), Promise.resolve(me), g.RFNet.recipes()]);
    }).then(function (res) {
      var gd = res[0];
      stage = 'unpacking the world';
      D.itemList = gd.items;
      D.itemList.forEach(function (it) { D.items[it.id] = it; });
      gd.npcs.npcs.forEach(function (n) { D.npcs[n.key] = n; });
      gd.npcs.shops.forEach(function (sh) { D.shops[sh.id] = sh; });
      D.quests = gd.quests;
      D.world = gd.world;
      D.spells = gd.magic.spells;
      D.prayers = gd.magic.prayers;
      if (!res[1].ok) throw new Error(res[1].error || 'Could not load your character.');
      P = res[1].player;
      myAid = res[1].aid || 0;
      D.recipes = res[2].ok ? res[2].recipes : { smelt: [], smith: [], craft: [], fletch: [], herb: [] };
      setLoad(18, 'Raising the land...');
      stage = 'starting the 3D view';
      buildScene();
    }).catch(function (e) {
      var detail = (e && e.name ? e.name + ': ' : '') + ((e && e.message) || String(e));
      showLoadFailure(stage, detail, e);
    });
  }

  function buildScene() {
    var host = document.getElementById('viewport');
    releaseOtherContexts();

    if (!window.WebGLRenderingContext) {
      throw new Error('This browser has no WebGL support, which Emberfall needs '
        + 'to draw the world. On iPhone, check Settings > Safari > Advanced > '
        + 'Experimental Features and make sure WebGL is on.');
    }
    /* Ask for the plain renderer first. powerPreference and similar options are
       rejected by some WebKit builds, and a rejected option throws rather than
       being ignored, so they are applied only if they are understood. */
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e1) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      } catch (e2) {
        throw new Error('Could not open a WebGL view (' + (e2.message || e2) + '). '
          + 'Close other tabs using 3D and reload.');
      }
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x87b9e8, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;
    host.insertBefore(renderer.domElement, host.firstChild);

    scene = new THREE.Scene();
    /* Terrain is only drawn to 108 units, so the fog has to close in before
       that or you can see the world simply stop. */
    scene.fog = new THREE.Fog(0x9dbfdd, 46, 102);
    camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);

    /* Two soft lights rather than one bright one: flat-shaded low-poly work
       washes out badly if the total intensity climbs much above one. */
    hemi = new THREE.HemisphereLight(0xd7e9fb, 0x4f4633, 0.88);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffe5b5, 1.35);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048; sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 180;
    sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    skyDome = makeSky();
    scene.add(skyDome);

    /* V21 SAFE-RENDER MODE.
       Do not make world startup depend on PNG/GLB/canvas texture loading.
       Several previous builds could successfully create the WebGL context but
       still multiply every material by a black texture.  The playable world is
       now built from explicit-colour procedural geometry first. */
    stage = 'starting safe renderer';
    pendingWarnings.push('Enhanced safe renderer active: lit procedural world with shadows; external texture/model loading remains non-blocking.');
    setLoad(24, 'Starting enhanced renderer...');
    buildTerrainAndWorld();
  }

  function buildTerrainAndWorld() {
    g.RFTerrainMgr.init(scene, function (pct) {
      setLoad(30 + pct * 0.4, 'Raising the land... ' + Math.round(pct) + '%');
    }, function () {
      setLoad(70, 'Planting forests and laying roads...');
      setTimeout(function () {
        g.RFWorld.build(scene, D.world);
        setLoad(86, 'Waking the locals...');
        setTimeout(startGame, 30);
      }, 20);
    });
  }

  /* A big inverted dome with a vertical gradient. Cheap, and it stops the
     background reading as a flat blue wall. */
  function makeSky() {
    var geo = new THREE.SphereGeometry(300, 16, 12);
    var pos = geo.attributes.position;
    var col = new Float32Array(pos.count * 3);
    var top = [0.42, 0.60, 0.86], bottom = [0.78, 0.86, 0.92];
    for (var i = 0; i < pos.count; i++) {
      var t = Math.max(0, Math.min(1, (pos.getY(i) / 300) * 1.6 + 0.35));
      col[i * 3] = bottom[0] + (top[0] - bottom[0]) * t;
      col[i * 3 + 1] = bottom[1] + (top[1] - bottom[1]) * t;
      col[i * 3 + 2] = bottom[2] + (top[2] - bottom[2]) * t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    sky.renderOrder = -1;
    return sky;
  }

  function startGame() {
    g.RFEntities.init(scene, {
      itemDB: D.items,
      npcTypes: (function () { var o = {}; for (var k in D.npcs) o[k] = D.npcs[k]; return o; })(),
      spawns: D.world.spawns
    });

    g.RFUI.init({
      items: D.items, quests: D.quests, npcs: D.npcs, shops: D.shops,
      world: D.world, spells: D.spells, prayers: D.prayers, recipes: D.recipes
    }, {
      myAid: function () { return myAid; },
      xpGains: function (np) { showXpGains(np); },
      teleportEffect: function () { playTeleport(); },
      logout: function () { g.RFNet.logout().then(function () { location.reload(); }); },
      teleport: function (x, z) {
        localX = x; localZ = z;
        path = []; moveTarget = null; interactTarget = null; combatTarget = null; pendingTake = null;
        g.RFNet.setLocal(localX, localZ, localR, 'idle');
        g.RFNet.forceSync();
      },
      equipmentChanged: function () {
        var a = g.RFEntities.local;
        if (a) a.setEquipment(P.eq || {}, D.items);
      },
      cook: function (slot) { tryCook(slot); },
      useOnItem: function (a, b) { useItemOnItem(a, b); },
      alchemy: function (spellId) { pendingAlch = spellId; },
      follow: function (id) { followId = id; },
      fireLit: function (x, z) { addFire(x, z); },
      setDetail: function (v) { renderer.setPixelRatio(v ? Math.min(2, window.devicePixelRatio || 1) : 1); },
      setShadows: function () {}
    });

    localX = P.x; localZ = P.z; localR = P.r || 0;
    /* Last line of defence: if the saved position is off the map or inside
       something solid, walk it out to the nearest open tile rather than
       leaving the player stuck against the world edge. */
    var TMc = g.RFTerrainMgr;
    var size = D.world.size || 384;
    function noExit(tx, tz) {
      if (TMc.blockedAt(tx, tz)) return true;
      var exits = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var ei = 0; ei < exits.length; ei++) {
        if (!TMc.blockedAt(tx + exits[ei][0], tz + exits[ei][1])) return false;
      }
      return true;
    }
    var lost = !isFinite(localX) || !isFinite(localZ) ||
               localX < 2 || localZ < 2 || localX > size - 2 || localZ > size - 2 ||
               noExit(Math.floor(localX), Math.floor(localZ));
    if (lost) {
      var open = g.RFPath.nearestOpen(Math.floor(localX), Math.floor(localZ), noExit, 14);
      var home = D.world.homePoint || D.world.spawnPoint;
      if (!open) open = g.RFPath.nearestOpen(Math.floor(home.x), Math.floor(home.z), noExit, 20)
                     || { x: home.x, z: home.z };
      localX = open.x + 0.5; localZ = open.z + 0.5;
      pendingWarnings.push('You were stuck in scenery, so you have been moved to clear ground.');
      g.RFNet.setLocal(localX, localZ, localR, 'idle');
      g.RFNet.forceSync();
    }
    /* makeLocal reads P, not localX/localZ.  Keep the player object in sync
       with the repaired position or the visible actor spawns back inside the
       collision we just escaped. */
    P.x = localX; P.z = localZ; P.r = localR;
    g.RFEntities.makeLocal(P);
    g.RFUI.setPlayer(P);

    g.RFUI.chat('<b>Welcome to Emberfall.</b>', 'c-sys');
    pendingWarnings.forEach(function (msg) { g.RFUI.chat(msg, 'c-warn'); });
    pendingWarnings.length = 0;
    g.RFUI.chat('Click the ground to walk. Click a tree, rock, person or monster to interact.', 'c-game');
    g.RFUI.chat('Your progress saves on the server, so you can close this tab and come back.', 'c-game');

    wireInput();
    g.RFNet.on('sync', onSync);
    g.RFNet.on('kicked', function (m) { g.RFUI.chat(m, 'c-warn'); setTimeout(function () { location.reload(); }, 2500); });
    g.RFNet.on('netTrouble', function () { g.RFUI.chat('The connection is struggling. Still trying...', 'c-warn'); });
    g.RFNet.startSync();

    setLoad(100, 'Ready.');
    show('screen-game');
    resize();
    clock = new THREE.Clock();
    running = true;
    renderer.setAnimationLoop(frame);
    g.RFAudio.startMusic('town');
  }

  /* ================================================================ INPUT */
  var pendingAlch = null;
  var followId = null;
  var dragged = false;   // kept so a stray drag does not fire a click

  function wireInput() {
    var dom = renderer.domElement;
    /* Clicks are decided on mouseup by how far the pointer travelled, not by
       the browser's click event plus a drag flag. The old arrangement quietly
       swallowed a click whenever the mouse twitched, which is why it took
       two or three goes to interact with anything. */
    var downAt = null, downBtn = 0;
    /* Middle mouse drag orbits the camera, as an alternative to the arrow
       keys. Right mouse stays reserved for the context menu. */
    var midDrag = null;
    /* Pointer capture, so a click still counts when the button is released a
       few pixels outside the canvas or over an overlay - that was losing
       clicks and making it feel like the mouse was ignored. */
    dom.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button === 1) return;
      try { dom.setPointerCapture(e.pointerId); } catch (err) {}
    });
    dom.addEventListener('mousedown', function (e) {
      g.RFAudio.resume();
      if (e.button === 1) {
        midDrag = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      downBtn = e.button;
      /* Right mouse is for context menus only. Camera rotation lives on the
         arrow keys, which is the control scheme this game is modelled on. */
    });
    /* listen on the window, not the canvas: releasing off-canvas still counts */
    window.addEventListener('mouseup', function (e) {
      if (!downAt) return;
      var moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      var quick = performance.now() - downAt.t < 1200;
      downAt = null;
      if (moved > 10 || !quick) { dragged = false; return; }
      dragged = false;
      /* Yellow for an ordinary click; red only when the click landed on
         something interactable - a tree, a rock, an NPC, a door. */
      var did = onClick(e, e.button === 2);
      markClick(e.clientX, e.clientY, did === 'target' ? 'action' : 'none');
    });
    var lastHoverAt = 0;
    window.addEventListener('mousemove', function (e) {
      if (midDrag) {
        camYawTarget += (e.clientX - midDrag.x) * 0.007;
        camPitchTarget = Math.max(0.16, Math.min(1.38, camPitchTarget - (e.clientY - midDrag.y) * 0.005));
        midDrag = { x: e.clientX, y: e.clientY };
        return;
      }
      /* a full raycast on every mouse move was costing frames */
      var now = performance.now();
      if (now - lastHoverAt < 60) return;
      lastHoverAt = now;
      hoverPick(e);
    });
    window.addEventListener('mouseup', function (e) { if (e.button === 1) midDrag = null; });
    dom.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });

    dom.addEventListener('click', function (e) { e.preventDefault(); });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      camDistTarget = Math.max(4, Math.min(34, camDistTarget + Math.sign(e.deltaY) * 1.8));
    }, { passive: false });

    /* touch: one finger walks, two fingers orbit and pinch */
    var touchStart = null, pinch = 0;
    dom.addEventListener('touchstart', function (e) {
      g.RFAudio.resume();
      if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      else if (e.touches.length === 2) {
        pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        touchStart = null;
      }
    }, { passive: true });
    dom.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        camDistTarget = Math.max(4, Math.min(34, camDistTarget - (d - pinch) * 0.05));
        pinch = d;
        e.preventDefault();
      } else if (e.touches.length === 1 && touchStart) {
        var dx = e.touches[0].clientX - touchStart.x;
        if (Math.abs(dx) > 26) {
          camYawTarget -= dx * 0.004;
          touchStart.x = e.touches[0].clientX;
          touchStart.moved = true;
        }
      }
    }, { passive: false });
    dom.addEventListener('touchend', function (e) {
      if (touchStart && !touchStart.moved && Date.now() - touchStart.t < 400) {
        var t = e.changedTouches[0];
        onClick({ clientX: t.clientX, clientY: t.clientY }, false);
      }
      touchStart = null;
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (document.activeElement === document.getElementById('chatInput')) return;
      if (e.key === 'Enter') { document.getElementById('chatInput').focus(); e.preventDefault(); return; }
      if (e.key === 'Escape') { g.RFUI.closeDialogue(); g.RFUI.hideCtx(); ['bankWindow','shopWindow','makeWindow'].forEach(g.RFUI.closeWindow); return; }
      var k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') {
        camKeys[k] = 1;
        e.preventDefault();
        return;
      }
      var tabKeys = { '1': 'combat', '2': 'stats', '3': 'quests', '4': 'inventory', '5': 'equipment',
                      '6': 'prayer', '7': 'magic', '8': 'friends', '9': 'players', '0': 'options' };
      if (tabKeys[e.key]) g.RFUI.setTab(tabKeys[e.key]);
      if (e.key === '`' || e.key === '~') toggleCollisionDebug();
    });

    window.addEventListener('keyup', function (e) {
      var k = e.key.toLowerCase();
      if (camKeys[k] !== undefined) camKeys[k] = 0;
    });
    window.addEventListener('blur', function () {
      for (var k in camKeys) camKeys[k] = 0;
    });

    document.getElementById('compass').onclick = function () { camYawTarget = 0; };
    document.getElementById('orbRun').onclick = toggleRun;

    /* the minimap walks you there too, exactly like the classic client */
    var mm = document.getElementById('minimap');
    mm.addEventListener('click', function (e) {
      var r = mm.getBoundingClientRect();
      var half = r.width / 2;
      var lx = (e.clientX - r.left) - half, ly = (e.clientY - r.top) - half;
      if (Math.hypot(lx, ly) > half) return;
      var perPx = (46 / g.RFUI.minimapZoom * 2) / mm.width;
      var scale = mm.width / r.width;
      walkTo(localX + lx * scale * perPx, localZ + ly * scale * perPx);
      combatTarget = null; interactTarget = null;
      g.RFAudio.play('click');
    });
    mm.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-mz]'), function (b) {
      b.onclick = function () { g.RFUI.zoomMinimap(+b.dataset.mz); };
    });
    document.getElementById('btnRespawn').onclick = function () {
      g.RFUI.doAct('respawn', {}).then(function (r) {
        if (!r || !r.ok) return;
        /* trust the server's coordinates outright; the client's own idea of
           where it is was what left people standing where they died */
        var to = r.tele || (r.p ? { x: r.p.x, z: r.p.z } : null);
        if (to) {
          localX = to.x; localZ = to.z;
          path = []; moveTarget = null; interactTarget = null; combatTarget = null;
          g.RFNet.setLocal(localX, localZ, localR, 'idle');
          g.RFNet.forceSync();
        }
        document.getElementById('deathOverlay').classList.remove('on');
      });
    };
    window.addEventListener('resize', resize);
    window.addEventListener('beforeunload', function () { g.RFNet.saveSettings(P.settings || {}); });
  }

  /* A red cross flashes where you clicked, so a click always feels answered
     even when the thing you clicked is out of reach. */
  /* Flash, a rising shimmer and a sound, so a teleport reads as a spell. */
  function playTeleport() {
    var f = document.getElementById('teleFlash');
    if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    g.RFAudio.play('teleport');
    var me = g.RFEntities.local;
    if (me) me.swing();
  }

  function markClick(cx, cy, kind) {
    var host = document.getElementById('viewport');
    var r = host.getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'click-x' + (kind === 'none' ? ' dead' : '');
    d.style.left = (cx - r.left) + 'px';
    d.style.top = (cy - r.top) + 'px';
    host.appendChild(d);
    setTimeout(function () { d.remove(); }, 420);
  }

  /* ---- collision debug overlay (toggle with the ` key) ------------------
     green walkable, red blocked, blue water, cyan the current path,
     yellow the tile the interaction router picked. */
  var debugGrid = null, debugOn = false;
  function toggleCollisionDebug() {
    debugOn = !debugOn;
    if (!debugOn) {
      if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); debugGrid = null; }
      g.RFUI.chat('Collision overlay off.', 'c-game');
      return;
    }
    g.RFUI.chat('Collision overlay on. Green walkable, red blocked, blue water, cyan your path.', 'c-game');
    rebuildCollisionDebug();
  }
  function disposeGroup(grp) {
    grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  }
  function rebuildCollisionDebug() {
    if (debugGrid) { scene.remove(debugGrid); disposeGroup(debugGrid); }
    debugGrid = new THREE.Group();
    var TM = g.RFTerrainMgr;
    var R = 26;
    var cx = Math.floor(localX), cz = Math.floor(localZ);
    var quad = new THREE.PlaneGeometry(0.92, 0.92);
    quad.rotateX(-Math.PI / 2);
    var mats = {
      walk: new THREE.MeshBasicMaterial({ color: 0x2fbf4a, transparent: true, opacity: 0.22 }),
      block: new THREE.MeshBasicMaterial({ color: 0xd03a2a, transparent: true, opacity: 0.34 }),
      water: new THREE.MeshBasicMaterial({ color: 0x2f6ed0, transparent: true, opacity: 0.30 }),
      path: new THREE.MeshBasicMaterial({ color: 0x30d8d8, transparent: true, opacity: 0.55 }),
      spot: new THREE.MeshBasicMaterial({ color: 0xe8d23a, transparent: true, opacity: 0.6 })
    };
    var onPath = {};
    path.forEach(function (p2) { onPath[Math.floor(p2.x) + ',' + Math.floor(p2.z)] = 1; });
    for (var dz = -R; dz <= R; dz++) {
      for (var dx = -R; dx <= R; dx++) {
        var x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0) continue;
        var key = x + ',' + z;
        var m;
        if (onPath[key]) m = mats.path;
        else if (TM.h(x + 0.5, z + 0.5) < 0.08) m = mats.water;
        else m = TM.blockedAt(x, z) ? mats.block : mats.walk;
        var q = new THREE.Mesh(quad, m);
        q.position.set(x + 0.5, TM.h(x + 0.5, z + 0.5) + 0.06, z + 0.5);
        debugGrid.add(q);
      }
    }
    if (interactTarget) {
      var st = interactionTile(interactTarget.x, interactTarget.z);
      if (st) {
        var q2 = new THREE.Mesh(quad, mats.spot);
        q2.position.set(st.x, g.RFTerrainMgr.h(st.x, st.z) + 0.09, st.z);
        debugGrid.add(q2);
      }
    }
    scene.add(debugGrid);
  }

  function resize() {
    if (!renderer) return;
    var host = document.getElementById('viewport');
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function screenRay(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    raycaster.near = 0;
    raycaster.far = Infinity;   // occlusion used to leave this clamped to the camera distance
    return raycaster;
  }

  /* What is under the cursor? Actors first, then scenery, then the ground. */
  function pick(e) {
    var ray = screenRay(e);
    var actors = g.RFEntities.allNpcNodes().concat(g.RFEntities.allPlayerNodes());
    var hitA = ray.intersectObjects(actors, true);
    if (hitA.length) {
      var a = g.RFEntities.resolveActor(hitA[0].object);
      if (a) return { kind: 'actor', actor: a, point: hitA[0].point };
    }
    if (groundGroup && groundGroup.children.length) {
      var hitG = ray.intersectObjects(groundGroup.children, true);
      if (hitG.length) {
        var n = hitG[0].object;
        while (n && !n.userData.groundItem) n = n.parent;
        if (n) return { kind: 'grounditem', rec: n.userData.groundItem, point: hitG[0].point };
      }
    }
    var hitO = ray.intersectObjects(g.RFWorld.interactables, true);
    if (hitO.length) {
      var oid = g.RFWorld.resolveHit(hitO[0]);
      if (oid !== null && oid !== undefined) {
        var od = objById(oid);
        if (od) return { kind: 'object', obj: od, point: hitO[0].point };
      }
      var bid = g.RFWorld.resolveBuilding(hitO[0]);
      if (bid !== null && bid !== undefined) return { kind: 'building', bid: bid, point: hitO[0].point };
    }
    var hitT = ray.intersectObjects([g.RFTerrainMgr.group], true);
    if (hitT.length) return { kind: 'ground', point: hitT[0].point };
    return null;
  }

  var objIndex = null;
  function objById(id) {
    if (!objIndex) {
      objIndex = {};
      D.world.objects.forEach(function (o) { objIndex[o.i] = o; });
    }
    return objIndex[id] || null;
  }

  function hoverPick(e) {
    if (!running) return;
    var p = pick(e);
    var label = '';
    if (p) {
      if (p.kind === 'grounditem') {
        var gi = D.items[p.rec.id];
        label = 'Take ' + (gi ? gi.name : 'item') + (p.rec.n > 1 ? ' x' + p.rec.n : '');
      } else if (p.kind === 'actor') {
        var a = p.actor;
        label = (a.hostile ? 'Attack ' : 'Talk to ') + a.name + (a.combatLevel ? ' (level ' + a.combatLevel + ')' : '');
        if (a.kind === 'remote') label = 'Trade with ' + a.name;
      } else if (p.kind === 'object') {
        label = objectVerb(p.obj) + ' ' + objectName(p.obj);
      } else if (p.kind === 'building') {
        var b = D.world.buildings[p.bid];
        label = b ? 'Enter ' + b.name : '';
      } else label = 'Walk here';
    }
    if (label !== hoverLabel) { hoverLabel = label; g.RFUI.hoverEl.textContent = label; }
  }

  function objectName(o) {
    switch (o.t) {
      case 'tree': return o.k === 'Tree' ? 'tree' : o.k.toLowerCase() + ' tree';
      case 'rock': return (o.ore || 'rock').toLowerCase() + ' rock';
      case 'fish': return 'fishing spot';
      case 'herb': return (o.h || 'herb').toLowerCase();
      case 'flax': return 'flax';
      case 'hunt': return 'bird snare';
      case 'sign': return 'signpost';
      case 'bank_booth': return 'bank booth';
      case 'altar_rc': return (o.rune || '') + ' altar';
      case 'altar': return 'altar';
      case 'furnace': return 'furnace';
      case 'anvil': return 'anvil';
      case 'range': return 'cooking range';
      case 'spinning_wheel': return 'spinning wheel';
      case 'pottery_wheel': return "potter's wheel";
      case 'loom': return 'loom';
      case 'patch': return o.kind === 'herb' ? 'herb patch' : 'allotment';
      case 'agility': return o.o.replace('_', ' ');
      case 'dungeon': return o.name || 'dungeon entrance';
      case 'rift': return 'essence rift';
      default: return o.t.replace('_', ' ');
    }
  }
  /* Scenery you walk on or through rather than interact with. */
  var WALKABLE = { bridge: 1, fence: 1, bench: 1, table: 1, chair: 1, pew: 1, statue: 1, fountain: 1 };

  function objectVerb(o) {
    if (WALKABLE[o.t]) return 'Walk to';
    switch (o.t) {
      case 'tree': return 'Chop down';
      case 'rock': case 'rift': return 'Mine';
      case 'fish': return 'Fish';
      case 'herb': case 'flax': return 'Pick';
      case 'hunt': return 'Check';
      case 'sign': return 'Read';
      case 'bank_booth': return 'Use';
      case 'altar_rc': return 'Craft at';
      case 'altar': return 'Pray at';
      case 'furnace': return 'Smelt at';
      case 'anvil': return 'Smith at';
      case 'range': return 'Cook on';
      case 'patch': return 'Tend';
      case 'agility': return 'Cross';
      case 'dungeon': return 'Enter';
      default: return 'Use';
    }
  }

  /* ------------------------------------------------------------- clicking */
  function onClick(e, right) {
    if (!running) return false;
    g.RFUI.hideCtx();
    var p = pick(e);
    if (!p) return false;

    if (p.kind === 'ground') {
      if (right) return false;
      walkTo(p.point.x, p.point.z);
      interactTarget = null;
      combatTarget = null;
      g.RFAudio.play('click');
      return 'walk';                  // a move, not an interaction
    }
    if (p.kind === 'building') {
      var b = D.world.buildings[p.bid];
      if (!b) return false;
      walkTo(b.x, b.z);
      return 'target';
    }
    if (p.kind === 'actor') {
      var a = p.actor;
      if (right) { actorMenu(e, a); return 'target'; }
      if (a.hostile) { engage(a); return 'target'; }
      if (a.kind === 'remote') { walkTo(a.x, a.z); return 'target'; }
      approachNpc(a);
      return 'target';
    }
    if (p.kind === 'grounditem') {
      var it0 = D.items[p.rec.id];
      var label = (it0 ? it0.name : 'item') + (p.rec.n > 1 ? ' x' + p.rec.n : '');
      if (right) {
        g.RFUI.showCtx(e.clientX, e.clientY, label, [
          ['Take ' + label, function () { takeGroundItem(p.rec); }],
          ['Walk here', function () { walkTo(p.rec.x, p.rec.z); }],
          ['Examine ' + label, function () {
            g.RFUI.chat((it0 && it0.desc) ? it0.desc : 'It is lying on the ground.', 'c-game');
          }]
        ]);
        return 'target';
      }
      takeGroundItem(p.rec);
      return 'target';
    }
    if (p.kind === 'object') {
      if (right) { objectMenu(e, p.obj); return 'target'; }
      if (WALKABLE[p.obj.t]) {
        /* walk onto it at the point you clicked, not to its centre */
        walkTo(p.point.x, p.point.z);
        interactTarget = null; combatTarget = null;
        g.RFAudio.play('click');
        return 'walk';
      }
      approachObject(p.obj);
      return 'target';
    }
    return false;
  }

  function actorMenu(e, a) {
    var opts = [];
    if (a.hostile) {
      opts.push(['Attack ' + a.name + ' (level ' + a.combatLevel + ')', function () { engage(a); }]);
    } else if (a.kind === 'remote') {
      opts.push(['Follow ' + a.name, function () { followId = a.id; }]);
      opts.push(['Trade with ' + a.name, function () { g.RFUI.doAct('trade_offer', { to: a.id }); }]);
      opts.push(['Message ' + a.name, function () {
        document.getElementById('chatInput').value = '/tell ' + a.name + ' ';
        document.getElementById('chatInput').focus();
      }]);
    } else {
      opts.push(['Talk-to ' + a.name, function () { approachNpc(a); }]);
      if (a.type && a.type.shop) opts.push(['Trade with ' + a.name, function () { approachNpc(a, 'shop'); }]);
      if (a.type && a.type.bank) opts.push(['Bank ' + a.name, function () { approachNpc(a, 'bank'); }]);
      opts.push(['Pickpocket ' + a.name, function () { approachNpc(a, 'thieve'); }]);
    }
    opts.push(['Walk here', function () { walkTo(a.x, a.z); }]);
    opts.push(['Examine ' + a.name, function () {
      var t = a.type;
      g.RFUI.chat(a.name + ': ' + (t && t.role ? t.role + '.' : (a.hostile ? 'It looks dangerous.' : 'A local.')), 'c-game');
    }]);
    g.RFUI.showCtx(e.clientX, e.clientY, a.name, opts);
  }

  function objectMenu(e, o) {
    if (WALKABLE[o.t]) {
      g.RFUI.showCtx(e.clientX, e.clientY, objectName(o), [
        ['Walk here', function () { walkTo(o.x, o.z); }],
        ['Examine', function () { g.RFUI.chat(examineObject(o), 'c-game'); }]
      ]);
      return;
    }
    var opts = [[objectVerb(o) + ' ' + objectName(o), function () { approachObject(o); }]];
    if (o.t === 'patch') {
      opts = [['Check', function () { approachObject(o, 'check'); }],
              ['Plant seed', function () { approachObject(o, 'plant'); }],
              ['Harvest', function () { approachObject(o, 'harvest'); }]];
    }
    if (o.t === 'furnace') opts.push(['Craft jewellery', function () { approachObject(o, 'craftfurnace'); }]);
    opts.push(['Walk here', function () { walkTo(o.x, o.z); }]);
    opts.push(['Examine ' + objectName(o), function () { g.RFUI.chat(examineObject(o), 'c-game'); }]);
    g.RFUI.showCtx(e.clientX, e.clientY, objectName(o), opts);
  }
  function examineObject(o) {
    if (o.t === 'sign') return 'The sign reads: "' + o.txt + '".';
    if (o.t === 'tree') return 'A ' + objectName(o) + '. Good for logs.';
    if (o.t === 'rock') return 'A rock with a seam of ' + (o.ore || 'something') + '.';
    if (o.t === 'dungeon') return o.name + '. Something breathes down there.';
    return 'A ' + objectName(o) + '.';
  }

  /* --------------------------------------------------------- interaction */
  /* The tile you should stand on to use something: an open tile next to it,
     never the tile the object occupies. Clicking a tree used to route you
     into the tree, which A* then refused, so nothing happened. */
  function interactionTile(tx, tz) {
    var TM = g.RFTerrainMgr;
    var best = null, bd = 1e9;
    var gx = Math.floor(tx), gz = Math.floor(tz);
    for (var r = 1; r <= 4 && !best; r++) {
      for (var dx = -r; dx <= r; dx++) {
        for (var dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          var x = gx + dx, z = gz + dz;
          if (TM.blockedAt(x, z)) continue;
          /* prefer a tile we can actually reach from where we stand */
          var d = Math.hypot(x + 0.5 - localX, z + 0.5 - localZ);
          if (d < bd) { bd = d; best = { x: x + 0.5, z: z + 0.5 }; }
        }
      }
    }
    return best;
  }

  function approachTarget(kind, payload, tx, tz, mode, range) {
    combatTarget = null;
    var t = { kind: kind, mode: mode, x: tx, z: tz, range: range };
    if (kind === 'object') t.obj = payload; else t.actor = payload;
    interactTarget = t;
    var stand = interactionTile(tx, tz);
    if (stand) walkTo(stand.x, stand.z);
    else walkTo(tx, tz, 2.2);
  }

  function approachObject(o, mode) {
    approachTarget('object', o, o.x, o.z, mode || 'default', 4.2);
  }
  function approachNpc(a, mode) {
    approachTarget('npc', a, a.x, a.z, mode || 'talk', 4.0);
  }
  function engage(a) {
    interactTarget = null;
    combatTarget = a.spawnIndex;
    var w = D.items[P.eq.weapon];
    var ranged = w && (w.wclass === 'bow' || (w.wclass === 'staff' && P.autocast));
    walkTo(a.x, a.z, ranged ? 7 : 1.6);
  }

  function runInteraction() {
    if (!interactTarget) return;
    var t = interactTarget;
    var tx = t.kind === 'npc' ? t.actor.x : t.x;
    var tz = t.kind === 'npc' ? t.actor.z : t.z;
    if (Math.hypot(localX - tx, localZ - tz) > t.range) return;
    path = [];
    var done = true;

    localR = Math.atan2(tx - localX, tz - localZ);
    if (t.kind === 'npc') {
      var a = t.actor;
      if (t.mode === 'shop' && a.type.shop) g.RFUI.openShop(a.type.shop);
      else if (t.mode === 'bank') g.RFUI.openBank();
      else if (t.mode === 'thieve') {
        g.RFUI.doAct('thieve', { npc: a.key });
        g.RFEntities.local.gatherSwing(o.t);
      } else {
        /* let the server run any quest business first, then show the tree */
        g.RFUI.doAct('dialogue', { npc: a.key }).then(function (r) {
          if (r && r.completed) g.RFAudio.play('quest');
          g.RFUI.openDialogue(a.key, 0);
        });
      }
    } else {
      var o = t.obj;
      done = objectAction(o, t.mode);
    }
    if (done) interactTarget = null;
  }

  function objectAction(o, mode) {
    if (WALKABLE[o.t]) {
      /* stepping onto a bridge is just walking; there is nothing to "use" */
      return true;
    }
    switch (o.t) {
      case 'tree': case 'rock': case 'fish': case 'herb': case 'flax': case 'hunt': case 'rift':
        startGathering(o);
        return true;
      case 'rift':
        startGathering(o);
        return true;
      case 'sign':
        g.RFUI.chat('The sign reads: "' + o.txt + '".', 'c-game');
        return true;
      case 'bank_booth':
        g.RFUI.openBank();
        return true;
      case 'anvil':
        g.RFUI.openMake('smith', null, 0, 'Smithing');
        return true;
      case 'furnace':
        g.RFUI.openMake(mode === 'craftfurnace' ? 'craft' : 'smelt', mode === 'craftfurnace' ? 'furnace' : null, 0);
        return true;
      case 'spinning_wheel':
        g.RFUI.openMake('craft', 'wheel', 0, 'Spinning');
        return true;
      case 'pottery_wheel':
        g.RFUI.openMake('craft', 'potter', 0, 'Pottery');
        return true;
      case 'loom':
        g.RFUI.openMake('craft', 'wheel', 0, 'Weaving');
        return true;
      case 'range':
        openCookMenu(true);
        return true;
      case 'altar':
        g.RFUI.doAct('recharge', {}).then(function (r) { if (r && r.ok) g.RFAudio.play('quest'); });
        return true;
      case 'altar_rc':
        g.RFUI.doAct('runecraft', { oi: o.i });
        g.RFAudio.play('magic');
        return true;
      case 'agility':
        g.RFUI.doAct('agility', { oi: o.i }).then(function (r) {
          if (r && r.ok) {
            /* hop to the far side of the obstacle */
            var nxt = nextObstacle(o);
            if (nxt) { localX = o.x + (nxt.x - o.x) * 0.34; localZ = o.z + (nxt.z - o.z) * 0.34; }
            g.RFAudio.play('step');
          }
        });
        return true;
      case 'patch':
        return patchAction(o, mode);
      case 'dungeon':
        g.RFUI.chat('The stair drops into the dark. ' + (o.name || 'Something') + ' waits below, but the way is barred for now.', 'c-game');
        return true;
    }
    g.RFUI.chat('Nothing happens.', 'c-game');
    return true;
  }
  function nextObstacle(o) {
    var best = null;
    D.world.objects.forEach(function (x) {
      if (x.t === 'agility' && x.course === o.course && x.ord === o.ord + 1) best = x;
    });
    return best;
  }

  function patchAction(o, mode) {
    if (mode === 'plant') {
      var seeds = [];
      P.inv.forEach(function (s, i) {
        if (!s) return;
        var it = D.items[s.id];
        if (it && (it.tags || []).indexOf('seed') >= 0) seeds.push([it.name, it.id]);
      });
      if (!seeds.length) { g.RFUI.chat('You have no seeds.', 'c-warn'); return true; }
      g.RFUI.showCtx(window.innerWidth / 2, window.innerHeight / 2, 'Plant what?',
        seeds.slice(0, 12).map(function (s) {
          return [s[0], function () { g.RFUI.doAct('farm', { oi: o.i, sub: 'plant', id: s[1] }); }];
        }));
      return true;
    }
    if (mode === 'harvest') { g.RFUI.doAct('farm', { oi: o.i, sub: 'harvest' }); return true; }
    var st = P.farm && P.farm[o.i];
    if (!st) g.RFUI.chat('The patch is empty. Right-click to plant a seed.', 'c-game');
    else {
      var left = st.ready - Math.floor(Date.now() / 1000);
      g.RFUI.chat(left > 0
        ? st.crop + ' is growing here. About ' + Math.ceil(left / 60) + ' minute(s) to go.'
        : st.crop + ' is ready to harvest.', 'c-game');
    }
    return true;
  }

  function openCookMenu(onRange) {
    var raw = [];
    P.inv.forEach(function (s, i) {
      if (!s) return;
      var it = D.items[s.id];
      if (it && (it.tags || []).indexOf('raw') >= 0) raw.push([it.name, i]);
    });
    if (!raw.length) { g.RFUI.chat('You have nothing raw to cook.', 'c-game'); return; }
    g.RFUI.showCtx(window.innerWidth / 2, window.innerHeight / 2, 'Cook what?',
      raw.slice(0, 12).map(function (r) {
        return [r[0], function () { cookLoop(r[1], onRange); }];
      }));
  }
  function cookLoop(slot, onRange) {
    g.RFUI.doAct('cook', { slot: slot, range: onRange ? 1 : 0 }).then(function (r) {
      g.RFAudio.play('cook');
      if (r && r.ok) {
        g.RFEntities.local.gatherSwing(o.t);
        /* keep going while the same raw food remains */
        var s = P.inv[slot];
        if (s && (D.items[s.id].tags || []).indexOf('raw') >= 0) setTimeout(function () { cookLoop(slot, onRange); }, 900);
      }
    });
  }
  function tryCook(slot) {
    var near = nearestOf(['range'], 4.5);
    if (near) return cookLoop(slot, true);
    if (fires.some(function (f) { return Math.hypot(f.x - localX, f.z - localZ) < 3; })) return cookLoop(slot, false);
    g.RFUI.chat('You need a fire or a range to cook on.', 'c-warn');
  }
  function nearestOf(types, range) {
    var best = null, bd = range;
    D.world.objects.forEach(function (o) {
      if (types.indexOf(o.t) < 0) return;
      var d = Math.hypot(o.x - localX, o.z - localZ);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }

  function useItemOnItem(a, b) {
    var ia = D.items[P.inv[a] && P.inv[a].id];
    var ib = D.items[P.inv[b] && P.inv[b].id];
    if (!ia || !ib) return;
    if (pendingAlch) { pendingAlch = null; }
    /* knife on logs, tinderbox on logs, herb on vial, and so on all resolve
       through the recipe book: find a recipe that uses both */
    var books = ['fletch', 'herb', 'craft', 'smith', 'smelt'];
    for (var k = 0; k < books.length; k++) {
      var list = D.recipes[books[k]] || [];
      for (var i = 0; i < list.length; i++) {
        var need = list[i].in.map(function (x) { return x.id; });
        if (need.indexOf(ia.id) >= 0 && need.indexOf(ib.id) >= 0) {
          return g.RFUI.doAct('make', { book: books[k], i: i, n: 1 });
        }
      }
    }
    if (ia.tool === 'tinderbox' && (ib.tags || []).indexOf('log') >= 0) return g.RFUI.doAct('fire', { slot: b });
    if (ib.tool === 'tinderbox' && (ia.tags || []).indexOf('log') >= 0) return g.RFUI.doAct('fire', { slot: a });
    if (ia.tool === 'knife' && (ib.tags || []).indexOf('log') >= 0) return g.RFUI.openMake('fletch', 'knife', ib.id);
    if (ib.tool === 'knife' && (ia.tags || []).indexOf('log') >= 0) return g.RFUI.openMake('fletch', 'knife', ia.id);
    g.RFUI.chat('Nothing interesting happens.', 'c-game');
  }

  /* ------------------------------------------------------------ gathering */
  var gatherObj = null;
  function startGathering(o) {
    gatherObj = o;
    gatherTimer = 0;
    localR = Math.atan2(o.x - localX, o.z - localZ);
  }
  function stopGathering() { gatherObj = null; }

  function tickGather(dt) {
    if (!gatherObj) return;
    if (Math.hypot(localX - gatherObj.x, localZ - gatherObj.z) > 5.5) { stopGathering(); return; }
    gatherTimer -= dt;
    if (gatherTimer > 0) return;
    gatherTimer = 1.15;
    var o = gatherObj;
    g.RFEntities.local.gatherSwing();
    g.RFAudio.play(o.t === 'tree' ? 'chop' : o.t === 'rock' ? 'mine' : o.t === 'fish' ? 'fish' : 'step');
    g.RFNet.act('gather', { oi: o.i }).then(function (r) {
      if (!r) return;
      if (r.p) { showXpGains(r.p); P = r.p; g.RFUI.setPlayer(P); }
      (r.notes || []).forEach(function (n) { g.RFUI.chat(n, 'c-sys'); });
      if (r.levels && r.levels.length) g.RFUI.levelUp(r.levels);
      if (!r.ok) {
        if (r.error === 'depleted') { g.RFUI.chat('There is nothing left here.', 'c-game'); stopGathering(); }
        else if (r.error) { g.RFUI.chat(r.error, 'c-warn'); stopGathering(); }
        return;
      }
      if (r.gained) {
        var it = D.items[r.gained.id];
        if (it) g.RFUI.chat('You get ' + (r.gained.n > 1 ? r.gained.n + ' x ' : '') + it.name + '.', 'c-good');
        g.RFAudio.play('item');
      }
      /* Keep swinging: a tree is worth several logs. It only comes down when
         the server says its last log has been taken. */
      if (r.felled && o.t === 'tree') {
        g.RFWorld.setTreeState(o.i, false);
        depletedLocal[o.i] = 1;
        g.RFAudio.play('treefall');
        stopGathering();
      } else if (r.felled && o.t === 'rock') {
        g.RFWorld.setRockDepleted(o.i, true);
        depletedLocal[o.i] = 1;
        stopGathering();
      } else if (r.felled) {
        stopGathering();
      }
    });
  }

  /* --------------------------------------------------------------- combat */
  function tickCombat(dt) {
    if (combatTarget === null || combatTarget === undefined) return;
    var a = g.RFEntities.npcAt(combatTarget);
    if (!a || a.dead) { combatTarget = null; return; }
    var d = Math.hypot(localX - a.x, localZ - a.z);
    var w = D.items[P.eq.weapon];
    var ranged = w && (w.wclass === 'bow' || (w.wclass === 'staff' && P.autocast));
    var reach = ranged ? 9 : 2.2;
    if (d > reach) { walkTo(a.x, a.z, reach * 0.8); return; }
    path = [];
    localR = Math.atan2(a.x - localX, a.z - localZ);
    var now = performance.now() / 1000;
    var speed = w && w.speed ? Math.max(1.4, w.speed * 0.6) : 2.4;
    if (now - lastAttack < speed) return;
    lastAttack = now;
    g.RFEntities.local.swing();
    g.RFAudio.play(ranged ? (w.wclass === 'bow' ? 'bow' : 'magic') : 'hit');

    g.RFNet.act('attack', { si: combatTarget }).then(function (r) {
      if (!r) return;
      if (r.p) { showXpGains(r.p); P = r.p; g.RFUI.setPlayer(P); }
      (r.notes || []).forEach(function (n) { g.RFUI.chat(n, 'c-sys'); });
      if (r.levels && r.levels.length) g.RFUI.levelUp(r.levels);
      if (!r.ok) {
        if (r.error && r.error !== 'wait') { g.RFUI.chat(r.error, 'c-warn'); combatTarget = null; }
        return;
      }
      if (r.result) {
        splatAt(a, r.result.dmg, r.result.hit ? 'hit' : 'miss');
        a.hp = r.npc ? r.npc.hp : a.hp;
        if (!r.result.hit) g.RFAudio.play('miss');
      }
      if (r.npc && r.npc.died) {
        a.die();
        g.RFAudio.play('die');
        combatTarget = null;
      }
      if (r.back && r.back.dmg !== undefined) {
        autoRetaliateFrom = combatTarget;
        splatAt(g.RFEntities.local, r.back.dmg, r.back.hit ? 'hit' : 'miss');
        if (r.back.dmg > 0) g.RFAudio.play('hurt');
      }
      (r.drops || []).forEach(function (d2) {
        var it = D.items[d2[0]];
        if (it) g.RFUI.chat('You collect ' + (d2[1] > 1 ? d2[1] + ' x ' : '') + it.name + '.', 'c-good');
      });
      if (r.dead) {
        document.getElementById('deathOverlay').classList.add('on');
        combatTarget = null;
      }
    });
  }

  function splatAt(actor, value, type) {
    var v = new THREE.Vector3(actor.x, g.RFTerrainMgr.h(actor.x, actor.z) + 1.5, actor.z);
    v.project(camera);
    var rect = renderer.domElement.getBoundingClientRect();
    var sx = (v.x * 0.5 + 0.5) * rect.width;
    var sy = (-v.y * 0.5 + 0.5) * rect.height;
    g.RFUI.splat(sx, sy, value, type);
  }

  /* ------------------------------------------------------------- movement */
  function walkTo(wx, wz, stopShort) {
    var TM = g.RFTerrainMgr;
    var sx = Math.floor(localX), sz = Math.floor(localZ);
    var gx = Math.floor(wx), gz = Math.floor(wz);
    if (TM.blockedAt(gx, gz)) {
      var open = g.RFPath.nearestOpen(gx, gz, TM.blockedAt, 6);
      if (open) { gx = open.x; gz = open.z; }
    }
    var found = g.RFPath.find(sx, sz, gx, gz, TM.blockedAt, { maxNodes: 9000 });
    if (!found || !found.length) { path = []; return; }
    var sm = g.RFPath.smooth(found, TM.blockedAt);
    path = sm.map(function (p) { return { x: p.x + 0.5, z: p.z + 0.5 }; });
    if (stopShort && path.length) {
      /* drop the final steps so we stop next to the target rather than on it */
      while (path.length > 1) {
        var last = path[path.length - 1];
        if (Math.hypot(last.x - wx, last.z - wz) < stopShort) path.pop();
        else break;
      }
    }
    stopGathering();
    if (path.length) { destMark = { x: path[path.length - 1].x, z: path[path.length - 1].z }; }
    else destMark = null;
  }

  function hideDestFlag() { destMark = null; }

  function tickMove(dt) {
    moving = false;
    if (followId !== null) {
      var fa = g.RFEntities.players[followId];
      if (fa) {
        if (Math.hypot(fa.x - localX, fa.z - localZ) > 3) walkTo(fa.x, fa.z, 2);
      } else followId = null;
    }
    if (!path.length) {
      hideDestFlag();
      regenRun(dt);
      /* Standing still still has to resolve a pending interaction. Clicking a
         tree you are already next to leaves no path to walk, and this used to
         return before the interaction ever fired. */
      if (pendingTake && Math.hypot(localX - pendingTake.x, localZ - pendingTake.z) <= 2.4) doTake(pendingTake);
      runInteraction();
      return;
    }
    SPEED = (running_on && runEnergy > 0) ? RUN_SPEED : WALK_SPEED;
    var step = SPEED * dt;
    while (step > 0 && path.length) {
      var t = path[0];
      var dx = t.x - localX, dz = t.z - localZ;
      var d = Math.hypot(dx, dz);
      if (d < 0.06) { path.shift(); continue; }
      var use = Math.min(step, d);
      localX += dx / d * use;
      localZ += dz / d * use;
      step -= use;
      localR = Math.atan2(dx, dz);
      moving = true;
    }
    if (moving) {
      footstepTimer -= dt;
      if (footstepTimer <= 0) { footstepTimer = running_on && runEnergy > 0 ? 0.22 : 0.34; g.RFAudio.play('step'); }
      if (running_on && runEnergy > 0) {
        runEnergy = Math.max(0, runEnergy - dt * 5.2);
        if (runEnergy <= 0) { running_on = false; g.RFUI.chat('You are out of breath.', 'c-warn'); }
      } else regenRun(dt * 0.35);
    } else regenRun(dt);
    if (!path.length) {
      hideDestFlag();
      if (pendingTake && Math.hypot(localX - pendingTake.x, localZ - pendingTake.z) <= 2.4) doTake(pendingTake);
      else pendingTake = null;
      runInteraction();
    }
  }
  var footstepTimer = 0;

  /* Run energy comes back faster the higher your Agility, as in the original. */
  function regenRun(dt) {
    if (runEnergy >= 100) return;
    var agi = P ? g.RFUI.skillLevel('agility') : 1;
    runEnergy = Math.min(100, runEnergy + dt * (1.6 + agi * 0.045));
  }
  function toggleRun() {
    if (!running_on && runEnergy < 1) { g.RFUI.chat('You are too tired to run.', 'c-warn'); return; }
    running_on = !running_on;
    document.getElementById('orbRun').classList.toggle('running', running_on);
    g.RFAudio.play('click');
  }
  function updateOrbs() {
    if (!P) return;
    setOrb('orbHp', P.hp, P.maxhp);
    setOrb('orbPray', P.pray, P.maxpray);
    setOrb('orbRun', Math.round(runEnergy), 100);
  }
  function setOrb(id, val, max) {
    var o = document.getElementById(id);
    if (!o) return;
    o.querySelector('.orb-fill').style.height = Math.max(0, Math.min(100, val / Math.max(1, max) * 100)) + '%';
    o.querySelector('b').textContent = val;
  }

  /* ---------------------------------------------------------------- fires */
  /* Loot lying on the floor. Small, flat, slowly turning so it catches the
     eye from the game camera, and tinted by the item's own icon colours. */
  function groundItemNode(rec) {
    var it = D.items[rec.id];
    var c1 = (it && it.icon && it.icon[1]) || '#c8b070';
    var c2 = (it && it.icon && it.icon[2]) || '#6b5c3f';
    var grp = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.42),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(c1), flatShading: true }));
    body.position.y = 0.09;
    grp.add(body);
    var band = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.05, 0.18),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(c2), flatShading: true }));
    band.position.y = 0.15;
    grp.add(band);
    grp.userData.groundItem = rec;
    return grp;
  }

  function syncGroundItems(list) {
    if (!groundGroup) { groundGroup = new THREE.Group(); scene.add(groundGroup); }
    var seen = {};
    (list || []).forEach(function (rec) {
      seen[rec.g] = 1;
      var e = groundNodes[rec.g];
      if (!e) {
        var node = groundItemNode(rec);
        node.position.set(rec.x, g.RFTerrainMgr.h(rec.x, rec.z) + 0.04, rec.z);
        groundGroup.add(node);
        groundNodes[rec.g] = { node: node, data: rec };
      } else {
        e.data = rec;
      }
    });
    Object.keys(groundNodes).forEach(function (gid) {
      if (seen[gid]) return;
      groundGroup.remove(groundNodes[gid].node);
      delete groundNodes[gid];
    });
  }

  function nearestGroundItem(x, z, maxd) {
    var best = null, bd = maxd || 2.0;
    for (var gid in groundNodes) {
      var d = groundNodes[gid].data;
      var dist = Math.hypot(d.x - x, d.z - z);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  function takeGroundItem(rec) {
    pendingTake = rec;
    var stand = interactionTile(rec.x, rec.z) || { x: rec.x, z: rec.z };
    if (Math.hypot(localX - rec.x, localZ - rec.z) <= 2.0) doTake(rec);
    else walkTo(rec.x, rec.z);
  }
  var pendingTake = null;
  function doTake(rec) {
    pendingTake = null;
    g.RFUI.doAct('take', { g: rec.g }).then(function (r) {
      if (r && r.ok) {
        g.RFAudio.play('item');
        if (groundNodes[rec.g]) {
          groundGroup.remove(groundNodes[rec.g].node);
          delete groundNodes[rec.g];
        }
      }
    });
  }

  function addFire(x, z) {
    var node = g.RFModels.prop('campfire') || g.RFModels.prop('brazier');
    node.position.set(x, g.RFTerrainMgr.h(x, z), z);
    scene.add(node);
    fires.push({ x: x, z: z, node: node, until: performance.now() / 1000 + 120 });
    g.RFAudio.play('fire');
  }
  function tickFires() {
    var now = performance.now() / 1000;
    for (var i = fires.length - 1; i >= 0; i--) {
      if (fires[i].until < now) { scene.remove(fires[i].node); fires.splice(i, 1); }
    }
  }

  /* ----------------------------------------------------------------- sync */
  var lastWorldNpc = {};
  var depletedLocal = {};        // what we have currently hidden
  var autoRetaliateFrom = null;
  function onSync(r) {
    /* other players */
    var alive = {};
    (r.players || []).forEach(function (p) {
      alive[p.id] = 1;
      g.RFEntities.upsertRemote(p);
    });
    g.RFEntities.pruneRemotes(alive);

    /* chat */
    (r.chat || []).forEach(function (c) { g.RFUI.incomingChat(c, P.name); });
    (r.notes || []).forEach(function (n) { g.RFUI.chat(n, 'c-warn'); });

    /* shared world */
    lastWorldNpc = (r.world && r.world.npc) || {};
    /* The server sends the objects that are currently depleted. Anything we
       previously hid that is NOT in that list has respawned and must come
       back - without this, a chopped tree stayed gone for ever. */
    var nowDepleted = (r.world && r.world.obj) || {};
    for (var id in nowDepleted) {
      var o = objById(+id);
      if (!o || depletedLocal[id]) continue;
      if (o.t === 'tree') g.RFWorld.setTreeState(+id, false);
      if (o.t === 'rock') g.RFWorld.setRockDepleted(+id, true);
      depletedLocal[id] = 1;
    }
    for (var had in depletedLocal) {
      if (nowDepleted[had] !== undefined) continue;
      var o2 = objById(+had);
      delete depletedLocal[had];
      if (!o2) continue;
      if (o2.t === 'tree') g.RFWorld.setTreeState(+had, true);
      if (o2.t === 'rock') g.RFWorld.setRockDepleted(+had, false);
    }

    syncGroundItems(r.world && r.world.ground);

    /* our own vitals, in case something happened server-side */
    if (r.you) {
      if (P.hp !== r.you.hp || P.pray !== r.you.pray) {
        P.hp = r.you.hp; P.pray = r.you.pray;
        g.RFUI.setPlayer(P);
      }
      if (r.you.hp <= 0) document.getElementById('deathOverlay').classList.add('on');
      /* auto-retaliate: if something hurt us and we are not already fighting,
         turn and fight back rather than standing there taking it */
      if (combatTarget === null && P.hp < lastHp) {
        var back = g.RFEntities.nearestMonster(localX, localZ, 4.5);
        if (back) { combatTarget = back.spawnIndex; g.RFUI.chat('You retaliate!', 'c-warn'); }
      }
      lastHp = P.hp;
      /* A warp is not a disagreement - the server moved us on purpose, so
         snap to it immediately rather than waiting for the 12-tile threshold. */
      if (r.you.warp) {
        localX = r.you.x; localZ = r.you.z;
        path = []; moveTarget = null; interactTarget = null; combatTarget = null; pendingTake = null;
        g.RFNet.setLocal(localX, localZ, localR, 'idle');
      } else if (Math.hypot(r.you.x - localX, r.you.z - localZ) > 12) {
        localX = r.you.x; localZ = r.you.z; path = [];
      }
    }
    if (r.trade) g.RFUI.showTrade(r.trade, myAid);

    /* nearby player list for the Players tab */
    var list = (r.players || []).map(function (p) {
      return { id: p.id, n: p.n, cl: p.cl, dist: Math.hypot(p.x - localX, p.z - localZ) };
    }).sort(function (a, b) { return a.dist - b.dist; });
    g.RFUI.setOnline(list);
  }

  /* -------------------------------------------------------------- ambience */
  var lastHp = 10;
  var lastMusicZone = null;
  function updateAmbience() {
    var TM = g.RFTerrainMgr;
    var gt = TM.ground(localX, localZ);
    var near = 0;
    D.world.objects.forEach(function () {});
    var zone = 'town';
    var region = nearestRegion();
    if (/Blightlands|Mirefen/.test(region)) zone = 'wild';
    else if (/Kragmar/.test(region)) zone = 'deep';
    if (zone !== lastMusicZone) {
      lastMusicZone = zone;
      g.RFAudio.startMusic(zone);
    }
    var amb = 'field';
    if (gt === 0 || TM.h(localX, localZ) < 0.7) amb = 'water';
    else if (treeDensityNear() > 4) amb = 'forest';
    else if (buildingNear()) amb = 'town';
    g.RFAudio.setAmbience(amb);
  }
  var treeCache = { t: 0, v: 0 };
  function treeDensityNear() {
    var now = performance.now();
    if (now - treeCache.t < 2000) return treeCache.v;
    treeCache.t = now;
    var n = 0;
    for (var i = 0; i < D.world.objects.length; i += 1) {
      var o = D.world.objects[i];
      if (o.t !== 'tree') continue;
      if (Math.abs(o.x - localX) < 18 && Math.abs(o.z - localZ) < 18) n++;
      if (n > 6) break;
    }
    treeCache.v = n;
    return n;
  }
  function buildingNear() {
    for (var i = 0; i < D.world.buildings.length; i++) {
      var b = D.world.buildings[i];
      if (Math.abs(b.x - localX) < 24 && Math.abs(b.z - localZ) < 24) return true;
    }
    return false;
  }
  function nearestRegion() {
    var best = '', bd = 1e9;
    D.world.regions.forEach(function (r) {
      var d = Math.hypot(r.x - localX, r.z - localZ);
      if (d < bd) { bd = d; best = r.n; }
    });
    return best;
  }

  /* --------------------------------------------------------- nameplates */
  function updateNameplates() {
    var host = document.getElementById('viewport');
    var rect = renderer.domElement.getBoundingClientRect();
    var seen = {};
    function place(key, actor, label, showHp) {
      var v = new THREE.Vector3(actor.x, g.RFTerrainMgr.h(actor.x, actor.z) + 2.15, actor.z);
      v.project(camera);
      if (v.z > 1) return;
      var sx = (v.x * 0.5 + 0.5) * rect.width;
      var sy = (-v.y * 0.5 + 0.5) * rect.height;
      if (sx < -60 || sy < -40 || sx > rect.width + 60 || sy > rect.height + 40) return;
      seen[key] = 1;
      var n = nameplates[key];
      if (!n) {
        n = document.createElement('div');
        n.className = 'nameplate';
        n.innerHTML = '<span class="txt"></span><div class="hpbar"><i></i></div>';
        host.appendChild(n);
        nameplates[key] = n;
      }
      n.style.left = sx + 'px';
      n.style.top = sy + 'px';
      n.querySelector('.txt').textContent = label;
      var bar = n.querySelector('.hpbar');
      if (showHp && actor.hp < actor.maxHp) {
        bar.style.display = 'block';
        bar.firstChild.style.width = Math.max(0, Math.round(actor.hp / Math.max(1, actor.maxHp) * 100)) + '%';
      } else bar.style.display = 'none';
    }

    var np = g.RFEntities.npcs;
    for (var k in np) {
      var a = np[k];
      if (a.dead) continue;
      if (Math.hypot(a.x - localX, a.z - localZ) > 34) continue;
      place('n' + k, a, a.name + (a.hostile ? ' (level ' + a.combatLevel + ')' : ''), a.hostile);
    }
    var pl = g.RFEntities.players;
    for (var id in pl) {
      var pa = pl[id];
      if (Math.hypot(pa.x - localX, pa.z - localZ) > 46) continue;
      place('p' + id, pa, pa.name + ' (level ' + pa.combatLevel + ')', true);
    }
    for (var key in nameplates) {
      if (!seen[key]) { nameplates[key].remove(); delete nameplates[key]; }
    }
  }

  /* ----------------------------------------------------------- the camera */
  /* Ground height including bridge decks. */
  function groundY(x, z) {
    var deck = g.RFWorld.bridgeHeightAt ? g.RFWorld.bridgeHeightAt(x, z) : null;
    return deck !== null ? deck : g.RFTerrainMgr.h(x, z);
  }

  function updateCamera(dt) {
    var TM = g.RFTerrainMgr;
    /* arrow keys steer the target; the camera chases it */
    var rotSpeed = 1.9, pitchSpeed = 1.1;
    /* Left arrow swings the view to the left, up arrow raises your eye line.
       Both were reversed. */
    if (camKeys.arrowleft) camYawTarget -= rotSpeed * dt;
    if (camKeys.arrowright) camYawTarget += rotSpeed * dt;
    /* Up arrow tips the camera DOWN toward a top-down view, which is the way
       round this control scheme expects. */
    if (camKeys.arrowup) camPitchTarget = Math.min(1.38, camPitchTarget + pitchSpeed * dt);
    if (camKeys.arrowdown) camPitchTarget = Math.max(0.16, camPitchTarget - pitchSpeed * dt);
    var ease = Math.min(1, dt * 8);
    var dy = camYawTarget - camYaw;
    camYaw += dy * ease;
    camPitch += (camPitchTarget - camPitch) * ease;
    camDist += (camDistTarget - camDist) * Math.min(1, dt * 6);

    var py = groundY(localX, localZ);
    camTarget.set(localX, py + 1.5, localZ);
    var want = new THREE.Vector3(
      localX + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      py + 1.5 + Math.sin(camPitch) * camDist,
      localZ + Math.cos(camYaw) * Math.cos(camPitch) * camDist
    );
    /* never sink the camera into a hillside */
    var ground = TM.h(want.x, want.z) + 1.6;
    if (want.y < ground) want.y = ground;

    /* if scenery is between us and the player, pull in until it is not */
    var dir = want.clone().sub(camTarget);
    var dist = dir.length();
    dir.normalize();
    camRay.set(camTarget, dir);
    camRay.far = dist;
    var blockers = g.RFWorld.buildings.map(function (b) { return b.node; }).filter(Boolean);
    var hit = blockers.length ? camRay.intersectObjects(blockers, true) : [];
    if (hit.length && hit[0].distance < dist - 0.6) {
      want.copy(camTarget).add(dir.multiplyScalar(Math.max(3.2, hit[0].distance - 0.6)));
    }
    camera.position.lerp(want, Math.min(1, dt * 9));
    camera.lookAt(camTarget);
    document.getElementById('compass').style.transform = 'rotate(' + (camYaw) + 'rad)';
  }

  /* ------------------------------------------------------------- the loop */
  var mmTimer = 0, ambTimer = 0, debugTimer = 0;
  function frame() {
    if (!running) return;
    var dt = Math.min(0.1, clock.getDelta());
    var t = performance.now() / 1000;

    tickMove(dt);
    tickGather(dt);
    tickCombat(dt);
    tickFires();
    if (groundGroup) {
      for (var gk in groundNodes) groundNodes[gk].node.rotation.y += dt * 1.1;
    }


    var TM = g.RFTerrainMgr;
    TM.update(localX, localZ);
    TM.updateWater(localX, localZ, t);
    g.RFWorld.update(localX, localZ, dt);

    var me = g.RFEntities.local;
    if (me) {
      me.setPos(localX, localZ, localR);
      me.update(dt, moving);
    }
    /* remote players, drawn a fraction of a second in the past and interpolated */
    var pl = g.RFEntities.players;
    for (var id in pl) {
      var st = g.RFNet.interpolate(id);
      var a = pl[id];
      if (st) {
        a.setPos(st.x, st.z, st.r);
        a.hp = st.hp; a.maxHp = st.mhp;
        a.update(dt, st.moving);
      } else a.update(dt, false);
    }
    g.RFEntities.updateNpcs(localX, localZ, dt, g.RFNet.serverNow(), lastWorldNpc, 90);

    updateCamera(dt);
    if (skyDome) skyDome.position.set(localX, 0, localZ);
    sun.position.set(localX + 45, 80, localZ + 30);
    sun.target.position.set(localX, 0, localZ);
    sun.target.updateMatrixWorld();

    g.RFNet.setLocal(localX, localZ, localR, moving ? 'walk' : (combatTarget != null ? 'fight' : 'idle'));

    updateNameplates();
    updateOrbs();

    if (debugOn) {
      debugTimer -= dt;
      if (debugTimer <= 0) { debugTimer = 0.5; rebuildCollisionDebug(); }
    }
    mmTimer -= dt;
    if (mmTimer <= 0) {
      mmTimer = 0.18;
      drawMap();
    }
    ambTimer -= dt;
    if (ambTimer <= 0) { ambTimer = 2.5; updateAmbience(); }

    renderer.render(scene, camera);
  }

  function drawMap() {
    var dots = [];
    var np = g.RFEntities.npcs;
    for (var k in np) {
      var a = np[k];
      if (a.dead) continue;
      dots.push({ x: a.x, z: a.z, c: a.hostile ? '#d04a3a' : '#e0e0c0', r: 2.4 });
    }
    var pl = g.RFEntities.players;
    for (var id in pl) dots.push({ x: pl[id].x, z: pl[id].z, c: '#7fd0ff', r: 3 });
    fires.forEach(function (f) { dots.push({ x: f.x, z: f.z, c: '#ff8a3a', r: 2.5 }); });

    g.RFUI.drawMinimap(localX, localZ, camYaw, {
      objects: D.world.objects,
      buildings: D.world.buildings,
      dots: dots,
      dest: destMark,
      region: nearestRegion()
    });
  }

  /* ================================================================ start */
  window.addEventListener('DOMContentLoaded', function () {
    show('screen-title');
    initTitle();
  });
  if (document.readyState !== 'loading') {
    show('screen-title');
    initTitle();
  }

  g.RFGame = {
    get player() { return P; },
    get pos() { return { x: localX, z: localZ }; }
  };
})(window);
