/* Emberfall - actors.
   Everything that walks around: your character, other people's characters, and
   every NPC and monster. Animation is hand-driven on the model's limb pivots
   rather than baked clips, which keeps the download to zero extra files. */
(function (g) {
  'use strict';
  var M = null, TM = null;

  var _shadowGeo = null, _shadowMat = null;
  function shadowGeo() {
    if (!_shadowGeo) _shadowGeo = new THREE.CircleGeometry(0.42, 12);
    return _shadowGeo;
  }
  function shadowMat() {
    if (!_shadowMat) _shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1a1408, transparent: true, opacity: 0.26, depthWrite: false
    });
    return _shadowMat;
  }

  /* ------------------------------------------------------------- Actor */
  function Actor(opts) {
    this.kind = opts.kind || 'player';          // player | remote | npc | monster
    this.name = opts.name || '';
    this.key = opts.key || '';
    this.id = opts.id;
    this.spawnIndex = opts.spawnIndex;
    this.combatLevel = opts.combatLevel || 0;
    this.hp = opts.hp || 10;
    this.maxHp = opts.maxHp || 10;
    this.hostile = !!opts.hostile;
    this.scaleBase = 1;

    if (opts.model) {
      this.node = M.creature(opts.model);
      this.scaleBase = 1;
    } else if (false && g.RF_USE_RIG && g.RFAssets && g.RFAssets.rigged &&
               g.RFAssets.rigged((opts.app || {}).build === 1 ? 'female' : 'male')) {
      /* A real skinned character with its own skeleton and clips. Everything
         below - walk cycles, swings, gathering - is driven by the rig rather
         than by rotating limb groups by hand. */
      var rig = g.RFAssets.rigged((opts.app || {}).build === 1 ? 'female' : 'male');
      this.node = new THREE.Group();
      this.node.add(rig.root);
      this.rig = rig;
      this.mixer = new THREE.AnimationMixer(rig.root);
      this.actions = {};
      rig.clips.forEach(function (c) { this.actions[c.name] = this.mixer.clipAction(c); }, this);
      this.current = null;
      this.weaponMount = rig.sockets['weapon_socket.R'] || null;
      this.shieldMount = rig.sockets['shield_socket.L'] || null;
      this.headMount = rig.sockets.headgear_socket || null;
      this.capeMount = rig.sockets.cape_socket || null;
      this.node.head = this.headMount;
      this.rigged = true;
    } else {
      this.node = M.humanoid(opts.app || {});
    }
    this.node.userData.actor = this;
    /* A soft dark disc on the ground. Real shadow maps are too costly on a
       phone, but without anything underfoot characters read as floating. */
    var blob = new THREE.Mesh(shadowGeo(), shadowMat());
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.04;
    blob.renderOrder = 1;
    this.node.add(blob);
    this.shadow = blob;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.r = opts.r || 0;
    this.node.position.set(this.x, 0, this.z);

    this.anim = 'idle';
    this.phase = Math.random() * 6.28;
    this.attackT = 0;
    this.gatherT = 0;
    this.deathT = 0;
    this.dead = false;
    this.bobSeed = Math.random() * 6.28;
    this.visible = true;
    this.homeX = this.x; this.homeZ = this.z;
    this.wander = opts.wander || 0;
    this.eq = null;
  }

  Actor.prototype.setEquipment = function (eq, itemDB) {
    this.eq = eq || {};
    try {
      if (this.rigged && M.equipRigged) M.equipRigged(this, this.eq, itemDB);
      else if (this.node.torso) M.equipVisuals(this.node, this.eq, itemDB);
    } catch (e) { console.warn('Emberfall: equipment visual failed', e.message); }
  };

  Actor.prototype.setPos = function (x, z, r) {
    this.x = x; this.z = z;
    if (r !== undefined && r !== null) this.r = r;
  };

  Actor.prototype.swing = function () { this.attackT = 0.45; };

  /* Maps what the actor is doing to one of the rig's clips, and cross-fades. */
  var CLIP_FOR = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'MeleeAttack',
                   chop: 'Woodcut', mine: 'Mine', cast: 'MagicCast', death: 'Death' };
  Actor.prototype.playClip = function (state, once) {
    if (!this.actions) return;
    var name = CLIP_FOR[state] || 'Idle';
    var next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = !!once;
    if (this.current) next.crossFadeFrom(this.current, 0.18, false);
    next.play();
    this.current = next;
  };
  Actor.prototype.gatherSwing = function (kind) { this.gatherT = 0.9; this.gatherKind = kind || ''; };
  Actor.prototype.die = function () { this.dead = true; this.deathT = 1.1; };
  Actor.prototype.revive = function () {
    this.dead = false; this.deathT = 0;
    this.node.rotation.x = 0; this.node.rotation.z = 0;
    this.node.visible = true;
    if (this.node.body) this.node.body.position.y = 0;
  };

  /* Per-frame pose. dt in seconds, moving tells us whether to walk. */
  Actor.prototype.update = function (dt, moving) {
    var n = this.node;
    n.position.x = this.x;
    n.position.z = this.z;
    var deck = g.RFWorld && g.RFWorld.bridgeHeightAt ? g.RFWorld.bridgeHeightAt(this.x, this.z) : null;
    n.position.y = deck !== null ? deck : TM.h(this.x, this.z);
    n.rotation.y = this.r;

    if (this.shadow) this.shadow.visible = !this.dead;

    /* Skeleton-driven actors must advance their AnimationMixer every frame.
       Previously the rig loaded but stayed frozen because only the procedural
       limb path below was updated. */
    if (this.rigged && this.mixer) {
      if (this.dead) {
        this.playClip('death', true);
        this.deathT = Math.max(0, this.deathT - dt);
        this.mixer.update(dt);
        if (this.deathT <= 0) n.visible = false;
        return;
      }
      if (this.attackT > 0) {
        this.playClip('attack', true);
        this.attackT = Math.max(0, this.attackT - dt);
      } else if (this.gatherT > 0 && !moving) {
        this.playClip(this.gatherKind === 'rock' ? 'mine' : (this.gatherKind === 'tree' ? 'chop' : 'idle'), false);
        this.gatherT = Math.max(0, this.gatherT - dt);
      } else {
        this.playClip(this.anim === 'run' && moving ? 'run' : (moving ? 'walk' : 'idle'), false);
      }
      this.mixer.update(dt);
      return;
    }

    if (this.dead) {
      this.deathT = Math.max(0, this.deathT - dt);
      var f = 1 - this.deathT / 1.1;
      n.rotation.x = -Math.PI / 2 * Math.min(1, f * 1.3);
      n.position.y += 0.1 * Math.min(1, f);
      if (this.deathT <= 0) n.visible = false;
      return;
    }

    var body = n.body, armL = n.armL, armR = n.armR, legL = n.legL, legR = n.legR;

    if (this.attackT > 0) {
      this.attackT = Math.max(0, this.attackT - dt);
      var a = 1 - this.attackT / 0.45;
      var swing = Math.sin(a * Math.PI) * 1.9;
      if (armR) armR.rotation.x = -swing;
      if (armL) armL.rotation.x = swing * 0.25;
      if (body) body.rotation.y = Math.sin(a * Math.PI) * 0.28;
      if (legL) legL.rotation.x = 0;
      if (legR) legR.rotation.x = 0;
      return;
    }
    if (this.gatherT > 0 && !moving) {
      this.gatherT = Math.max(0, this.gatherT - dt);
      var gp = (0.9 - this.gatherT) * 7;
      var sw = Math.abs(Math.sin(gp)) * 1.5;
      if (armR) armR.rotation.x = -sw;
      if (armL) armL.rotation.x = -sw * 0.7;
      if (body) body.rotation.x = sw * 0.16;
      return;
    }
    if (body) { body.rotation.x = 0; body.rotation.y = 0; }

    if (moving) {
      this.phase += dt * 9.2;
      var s = Math.sin(this.phase), c = Math.cos(this.phase);
      if (legL) legL.rotation.x = s * 0.82;
      if (legR) legR.rotation.x = -s * 0.82;
      if (armL) armL.rotation.x = -s * 0.62;
      if (armR) armR.rotation.x = s * 0.62;
      if (body) body.position.y = Math.abs(c) * 0.055;
      if (n.legFL) { n.legFL.rotation.x = s * 0.7; n.legFR.rotation.x = -s * 0.7; }
      if (n.legBL) { n.legBL.rotation.x = -s * 0.7; n.legBR.rotation.x = s * 0.7; }
    } else {
      this.phase += dt * 1.6;
      var idle = Math.sin(this.phase) * 0.06;
      if (legL) legL.rotation.x *= 0.82;
      if (legR) legR.rotation.x *= 0.82;
      if (armL) armL.rotation.x = idle;
      if (armR) armR.rotation.x = -idle;
      if (body) body.position.y = Math.sin(this.phase * 0.8) * 0.018;
      if (n.legFL) { n.legFL.rotation.x *= 0.85; n.legFR.rotation.x *= 0.85; }
      if (n.legBL) { n.legBL.rotation.x *= 0.85; n.legBR.rotation.x *= 0.85; }
    }
    /* wings and tails get a little life of their own */
    if (n.wingL) {
      var w = Math.sin(this.phase * (moving ? 3 : 1.1) + this.bobSeed) * 0.5;
      n.wingL.rotation.z = w; n.wingR.rotation.z = -w;
    }
  };

  /* ---------------------------------------------------- actor registry */
  var scene = null;
  var players = {};          // id -> Actor
  var npcs = {};             // spawnIndex -> Actor
  var localActor = null;
  var itemDB = {};
  var npcTypes = {};
  var spawns = [];

  function init(sc, opts) {
    scene = sc;
    M = g.RFModels; TM = g.RFTerrainMgr;
    itemDB = opts.itemDB || {};
    npcTypes = opts.npcTypes || {};
    spawns = opts.spawns || [];
  }

  function makeLocal(player) {
    if (localActor) scene.remove(localActor.node);
    localActor = new Actor({
      kind: 'player', name: player.name, app: player.app,
      x: player.x, z: player.z, r: player.r || 0,
      hp: player.hp, maxHp: player.maxhp, combatLevel: player.cl
    });
    localActor.setEquipment(player.eq || {}, itemDB);
    scene.add(localActor.node);
    return localActor;
  }

  function upsertRemote(p) {
    var a = players[p.id];
    if (!a) {
      a = new Actor({
        kind: 'remote', id: p.id, name: p.n, app: p.app || {},
        x: p.x, z: p.z, r: p.r, hp: p.hp, maxHp: p.mhp, combatLevel: p.cl
      });
      scene.add(a.node);
      players[p.id] = a;
      if (p.eq) a.setEquipment(p.eq, itemDB);
    }
    a.combatLevel = p.cl;
    a.hp = p.hp; a.maxHp = p.mhp;
    if (p.app) { /* appearance changed: rebuild the body */
      var old = a.node;
      var rebuilt = new Actor({ kind: 'remote', id: p.id, name: p.n, app: p.app,
        x: a.x, z: a.z, r: a.r, hp: p.hp, maxHp: p.mhp, combatLevel: p.cl });
      rebuilt.setEquipment(p.eq || {}, itemDB);
      scene.remove(old);
      scene.add(rebuilt.node);
      players[p.id] = rebuilt;
      a = rebuilt;
    } else if (p.eq) {
      a.setEquipment(p.eq, itemDB);
    }
    return a;
  }

  function pruneRemotes(aliveIds) {
    Object.keys(players).forEach(function (id) {
      if (!aliveIds[id]) { scene.remove(players[id].node); delete players[id]; }
    });
  }

  /* --------------------------------------------------------- npc spawns */
  /* Monsters wander on a deterministic curve seeded by their spawn index, so
     every client draws them in roughly the same place without the server
     needing a tick loop it cannot run on shared hosting. */
  function npcPos(idx, t) {
    var sp = spawns[idx];
    if (!sp) return { x: 0, z: 0 };
    var w = sp.w || 0;
    if (w <= 0) return { x: sp.x, z: sp.z };
    var seed = (idx * 2654435761) % 100000;
    var ph = (seed % 1000) / 1000 * 6.2831853;
    var pd = 11 + (seed % 7);
    return {
      x: sp.x + Math.sin(t / pd + ph) * w * 0.55 + Math.sin(t / (pd * 1.7) + ph * 2) * w * 0.3,
      z: sp.z + Math.cos(t / (pd * 1.3) + ph) * w * 0.55 + Math.cos(t / (pd * 2.1) + ph * 3) * w * 0.3
    };
  }

  function ensureNpc(idx) {
    if (npcs[idx]) return npcs[idx];
    var sp = spawns[idx];
    if (!sp) return null;
    var t = npcTypes[sp.k];
    if (!t) return null;
    var a;
    var isMonster = t.kind === 'monster';
    if (isMonster && t.model && t.model.kind && t.model.kind !== 'humanoid') {
      a = new Actor({ kind: 'monster', key: sp.k, spawnIndex: idx, name: t.name,
        model: t.model, x: sp.x, z: sp.z, hp: t.hp, maxHp: t.hp,
        combatLevel: t.lvl, hostile: true, wander: sp.w || 0 });
    } else {
      var app = {
        skin: (t.model && t.model.c1) || '#e0b892',
        shirt: (t.model && t.model.c2) || '#5a7a9a',
        legs: (t.model && t.model.c3) || '#4a4238',
        hair: (t.model && t.model.hair) || '#3a2a20',
        hairStyle: (t.model && t.model.hairStyle !== undefined) ? t.model.hairStyle : 1,
        build: (t.model && t.model.build) || 0
      };
      a = new Actor({ kind: isMonster ? 'monster' : 'npc', key: sp.k, spawnIndex: idx,
        name: t.name, app: app, x: sp.x, z: sp.z, hp: t.hp, maxHp: t.hp,
        combatLevel: t.lvl, hostile: isMonster, wander: sp.w || 0 });
      if (t.model && t.model.sc) a.node.scale.setScalar(t.model.sc);
      /* give them whatever they are described as carrying */
      var gear = {};
      if (t.model && t.model.weap) {
        for (var id in itemDB) if (itemDB[id].name === t.model.weap) gear.weapon = +id;
      }
      if (Object.keys(gear).length) a.setEquipment(gear, itemDB);
    }
    a.role = t.role || '';
    a.type = t;
    scene.add(a.node);
    npcs[idx] = a;
    return a;
  }

  function removeNpc(idx) {
    if (!npcs[idx]) return;
    scene.remove(npcs[idx].node);
    delete npcs[idx];
  }

  /* Keep only the NPCs near the player instantiated. */
  function updateNpcs(px, pz, dt, serverT, worldNpcState, radius) {
    radius = radius || 96;
    var r2 = radius * radius;
    for (var i = 0; i < spawns.length; i++) {
      var sp = spawns[i];
      var dx = sp.x - px, dz = sp.z - pz;
      if (dx * dx + dz * dz > r2) { if (npcs[i]) removeNpc(i); continue; }
      var a = ensureNpc(i);
      if (!a) continue;

      var st = worldNpcState ? worldNpcState[i] : null;
      if (st && st.dead) {
        if (!a.dead) { a.die(); }
        var left = st.dead - serverT;
        if (left <= 0) { a.revive(); a.hp = a.maxHp; }
      } else {
        if (a.dead) { a.revive(); a.hp = a.maxHp; }
        if (st && st.hp !== undefined) a.hp = st.hp;
      }

      var target;
      if (a.chaseX !== undefined && a.chaseT > 0) {
        a.chaseT -= dt;
        target = { x: a.chaseX, z: a.chaseZ };
      } else {
        target = npcPos(i, serverT);
      }
      var ox = a.x, oz = a.z;
      var lerp = Math.min(1, dt * 4.5);
      a.x += (target.x - a.x) * lerp;
      a.z += (target.z - a.z) * lerp;
      var moved = Math.hypot(a.x - ox, a.z - oz);
      if (moved > 0.002) a.r = Math.atan2(a.x - ox, a.z - oz);
      a.update(dt, moved / Math.max(dt, 0.001) > 0.35 && !a.dead);
    }
  }

  function nearestMonster(x, z, maxDist) {
    var best = null, bd = maxDist || 12;
    for (var k in npcs) {
      var a = npcs[k];
      if (!a.hostile || a.dead) continue;
      var d = Math.hypot(a.x - x, a.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function npcAt(idx) { return npcs[idx] || null; }
  function allNpcNodes() {
    var out = [];
    for (var k in npcs) if (!npcs[k].dead) out.push(npcs[k].node);
    return out;
  }
  function allPlayerNodes() {
    var out = [];
    for (var k in players) out.push(players[k].node);
    return out;
  }
  function resolveActor(object) {
    var cur = object;
    while (cur) {
      if (cur.userData && cur.userData.actor) return cur.userData.actor;
      cur = cur.parent;
    }
    return null;
  }

  g.RFEntities = {
    init: init, Actor: Actor,
    makeLocal: makeLocal, upsertRemote: upsertRemote, pruneRemotes: pruneRemotes,
    updateNpcs: updateNpcs, ensureNpc: ensureNpc, npcAt: npcAt, npcPos: npcPos,
    nearestMonster: nearestMonster,
    allNpcNodes: allNpcNodes, allPlayerNodes: allPlayerNodes, resolveActor: resolveActor,
    get local() { return localActor; },
    get players() { return players; },
    get npcs() { return npcs; }
  };
})(window);
