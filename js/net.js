/* Emberfall - networking.
   Shared hosting has no websockets, so this is HTTP, but it is HTTP done
   carefully: small frequent posts, appearance sent only when it changes, and
   a snapshot buffer on the receiving end so other players glide instead of
   teleporting between updates. */
(function (g) {
  'use strict';

  var API = 'api/index.php';
  var token = null;
  var aid = 0;
  var syncTimer = null;
  var inFlight = false;
  var lastSince = 0;
  var knownAppearance = {};        // playerId -> appearance version we already hold
  var listeners = {};
  var failures = 0;
  var interval = 200;              // ms between syncs, adapts to round-trip time
  var lastRTT = 120;

  /* snapshots of remote players, kept so we can render slightly in the past */
  var snaps = {};                  // id -> [{t, x, z, r, anim}]
  var RENDER_DELAY = 0.18;         // seconds behind the newest snapshot
  var serverOffset = 0;            // serverTime - clientTime

  /* Turns an unparseable reply into something a person can act on. */
  function describeBadReply(status, txt) {
    var raw = String(txt || '');
    var body = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    /* The server handed back the PHP source instead of running it. */
    if (raw.indexOf('<?php') >= 0) {
      return 'Your host sent back the PHP source code instead of running it. '
        + 'PHP is not enabled for this folder. Contact your host, or check that '
        + 'the site is not on a static-only plan.';
    }
    /* The server handed back a web page. Usually PHP is off, or another
       .htaccess above this folder is swallowing the request. */
    if (/^\s*(<!DOCTYPE|<html)/i.test(raw)) {
      if (status === 200) {
        return 'The server returned a web page instead of game data. Two usual '
          + 'causes: (1) PHP is not enabled on this hosting plan, or (2) another '
          + '.htaccess higher up - a WordPress or CMS install in the same folder - '
          + 'is redirecting every request to itself. Try uploading Emberfall '
          + 'into its own empty subfolder, e.g. public_html/emberfall/. '
          + 'Open api/index.php?a=ping directly to see what your host sends.';
      }
      return 'The server returned an error page (HTTP ' + status + ') instead of '
        + 'game data. Open api/index.php?a=ping directly in a browser tab to see it.';
    }
    if (status === 500) {
      return 'The server returned a 500 error instead of game data. This is almost '
        + 'always the .htaccess file - delete .htaccess and data/store/.htaccess and '
        + 'reload. (Server said: ' + body.slice(0, 120) + ')';
    }
    if (status === 404) {
      return 'The server could not find api/index.php (404). Check that the api '
        + 'folder uploaded and that you uploaded the CONTENTS of the zip, not the '
        + 'folder itself.';
    }
    if (status === 403) {
      return 'The server refused access to the API (403). Check file permissions '
        + 'on the api folder - 755 for folders, 644 for files.';
    }
    if (/^\s*$/.test(body)) {
      return 'The server sent an empty reply (HTTP ' + status + '). Your host may be '
        + 'running PHP below version 8. Open health.php to check.';
    }
    if (/deprecated|warning|notice|fatal error|parse error/i.test(body)) {
      return 'PHP printed an error before the game data. Open health.php for '
        + 'details. (' + body.slice(0, 160) + ')';
    }
    return 'The server replied with something that is not game data (HTTP ' + status
      + '): ' + body.slice(0, 160) + ' - try opening health.php.';
  }

  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, data) { (listeners[evt] || []).forEach(function (f) { try { f(data); } catch (e) { console.error(e); } }); }

  function post(action, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-RF-Token'] = token;
    var status = 0;
    return fetch(API + '?a=' + encodeURIComponent(action), {
      method: 'POST', headers: headers, body: JSON.stringify(body || {})
    }).then(function (r) {
      status = r.status;
      return r.text();
    }).then(function (txt) {
      try { return JSON.parse(txt); }
      catch (e) { throw new Error(describeBadReply(status, txt)); }
    });
  }

  /* ------------------------------------------------------------ accounts */
  function register(user, pass) {
    return post('register', { user: user, pass: pass }).then(function (r) {
      if (r.ok) { token = r.token; try { localStorage.setItem('rf2tok', token); } catch (e) {} }
      return r;
    });
  }
  function login(user, pass) {
    return post('login', { user: user, pass: pass }).then(function (r) {
      if (r.ok) { token = r.token; try { localStorage.setItem('rf2tok', token); } catch (e) {} }
      return r;
    });
  }
  function logout() {
    stopSync();
    var t = token;
    token = null;
    try { localStorage.removeItem('rf2tok'); } catch (e) {}
    if (!t) return Promise.resolve({ ok: true });
    return fetch(API + '?a=logout', { method: 'POST', headers: { 'X-RF-Token': t } })
      .then(function () { return { ok: true }; }).catch(function () { return { ok: true }; });
  }
  function restoreToken() {
    try { token = localStorage.getItem('rf2tok') || null; } catch (e) { token = null; }
    return token;
  }
  function createCharacter(app) { return post('create', { app: app }); }
  function load() { return post('load', {}); }
  function recipes() { return post('recipes', {}); }
  function act(op, params) {
    var body = Object.assign({ op: op }, params || {});
    return post('act', body);
  }
  function say(msg, to) { return post('chat', { m: msg, to: to || '' }); }
  function saveSettings(settings) { return post('save', { settings: settings }); }

  /* ---------------------------------------------------------------- sync */
  var pending = { x: 0, z: 0, r: 0, anim: 'idle' };
  function setLocal(x, z, r, anim) {
    pending.x = x; pending.z = z; pending.r = r; pending.anim = anim || 'idle';
  }

  function startSync() {
    if (syncTimer) return;
    var tick = function () {
      syncTimer = setTimeout(tick, interval);
      doSync();
    };
    syncTimer = setTimeout(tick, 60);
  }
  function stopSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
  }

  function doSync() {
    if (inFlight || !token) return;
    inFlight = true;
    var sent = performance.now();
    post('sync', {
      x: Math.round(pending.x * 100) / 100,
      z: Math.round(pending.z * 100) / 100,
      r: Math.round(pending.r * 1000) / 1000,
      anim: pending.anim,
      since: lastSince,
      known: knownAppearance
    }).then(function (r) {
      inFlight = false;
      if (!r.ok) {
        if (/session/i.test(r.error || '')) emit('kicked', r.error);
        return;
      }
      failures = 0;
      lastRTT = performance.now() - sent;
      /* keep the poll rate sensible: never faster than the round trip */
      interval = Math.max(170, Math.min(650, Math.round(lastRTT * 1.15 + 90)));
      serverOffset = r.t - (performance.now() / 1000);

      ingestPlayers(r.players || [], r.t);
      (r.chat || []).forEach(function (c) { if (c.t > lastSince) lastSince = c.t; });
      emit('sync', r);
    }).catch(function (err) {
      inFlight = false;
      failures++;
      interval = Math.min(3000, 400 * failures);
      if (failures === 3) emit('netTrouble', err.message);
    });
  }

  function ingestPlayers(list, serverT) {
    var seen = {};
    list.forEach(function (p) {
      seen[p.id] = 1;
      if (p.app) knownAppearance[p.id] = p.av;
      var buf = snaps[p.id] || (snaps[p.id] = []);
      var last = buf[buf.length - 1];
      if (!last || last.t !== p.t) {
        buf.push({ t: p.t, x: p.x, z: p.z, r: p.r, anim: p.a, hp: p.hp, mhp: p.mhp });
        if (buf.length > 12) buf.shift();
      }
    });
    Object.keys(snaps).forEach(function (id) { if (!seen[id]) delete snaps[id]; });
  }

  /* Where should player `id` be drawn right now?
     We render RENDER_DELAY behind the newest snapshot and interpolate between
     the two that straddle that moment, which removes the stutter that a plain
     "snap to the latest packet" approach produces. */
  function interpolate(id) {
    var buf = snaps[id];
    if (!buf || !buf.length) return null;
    var now = performance.now() / 1000 + serverOffset - RENDER_DELAY;
    if (buf.length === 1 || now <= buf[0].t) {
      var b0 = buf[0];
      return { x: b0.x, z: b0.z, r: b0.r, anim: b0.anim, hp: b0.hp, mhp: b0.mhp, moving: false };
    }
    var last = buf[buf.length - 1];
    if (now >= last.t) {
      /* ran past the newest packet: hold position rather than guessing wildly */
      return { x: last.x, z: last.z, r: last.r, anim: last.anim, hp: last.hp, mhp: last.mhp, moving: false };
    }
    for (var i = buf.length - 2; i >= 0; i--) {
      var a = buf[i], b = buf[i + 1];
      if (now >= a.t && now <= b.t) {
        var span = Math.max(0.0001, b.t - a.t);
        var f = (now - a.t) / span;
        var dr = b.r - a.r;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        var dist = Math.hypot(b.x - a.x, b.z - a.z);
        return {
          x: a.x + (b.x - a.x) * f,
          z: a.z + (b.z - a.z) * f,
          r: a.r + dr * f,
          anim: b.anim, hp: b.hp, mhp: b.mhp,
          moving: dist / span > 0.6
        };
      }
    }
    return { x: last.x, z: last.z, r: last.r, anim: last.anim, hp: last.hp, mhp: last.mhp, moving: false };
  }

  function serverNow() { return performance.now() / 1000 + serverOffset; }

  g.RFNet = {
    on: on, post: post,
    register: register, login: login, logout: logout, restoreToken: restoreToken,
    createCharacter: createCharacter, load: load, act: act, say: say,
    recipes: recipes, saveSettings: saveSettings,
    startSync: startSync, stopSync: stopSync, setLocal: setLocal, forceSync: doSync,
    interpolate: interpolate, serverNow: serverNow,
    get ping() { return Math.round(lastRTT); },
    get rate() { return interval; },
    get aid() { return aid; },
    set aid(v) { aid = v; },
    get token() { return token; }
  };
})(window);
