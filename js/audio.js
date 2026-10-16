/* Emberfall - audio.
   All music and effects are synthesised in the browser with WebAudio. Nothing
   is sampled from anywhere, and the download carries no audio files at all. */
(function (g) {
  'use strict';

  var ctx = null, master = null, musicGain = null, sfxGain = null, ambGain = null;
  var started = false;
  var vol = { master: 0.8, music: 0.45, sfx: 0.7, amb: 0.55 };
  var musicTimer = null, currentTheme = null;
  var ambNodes = [];

  function init() {
    if (ctx) return true;
    var AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    ambGain = ctx.createGain();
    musicGain.connect(master); sfxGain.connect(master); ambGain.connect(master);
    master.connect(ctx.destination);
    applyVolumes();
    return true;
  }
  function applyVolumes() {
    if (!ctx) return;
    master.gain.value = vol.master;
    musicGain.gain.value = vol.music * 0.34;
    sfxGain.gain.value = vol.sfx * 0.5;
    ambGain.gain.value = vol.amb * 0.22;
  }
  function setVolumes(v) {
    if (v.master !== undefined) vol.master = v.master / 100;
    if (v.music !== undefined) vol.music = v.music / 100;
    if (v.sfx !== undefined) vol.sfx = v.sfx / 100;
    if (v.amb !== undefined) vol.amb = v.amb / 100;
    applyVolumes();
  }
  function resume() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
  }

  /* ------------------------------------------------------------- helpers */
  function tone(o) {
    if (!ctx || !started) return;
    var t0 = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    var gn = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.dur || 0.2));
    var peak = (o.gain === undefined ? 0.5 : o.gain);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (o.attack || 0.008));
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.dur || 0.2));
    osc.connect(gn);
    gn.connect(o.bus || sfxGain);
    osc.start(t0);
    osc.stop(t0 + (o.dur || 0.2) + 0.05);
  }

  function noise(o) {
    if (!ctx || !started) return;
    var t0 = ctx.currentTime + (o.delay || 0);
    var dur = o.dur || 0.2;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var flt = ctx.createBiquadFilter();
    flt.type = o.filter || 'bandpass';
    flt.frequency.value = o.freq || 800;
    flt.Q.value = o.q || 1.2;
    var gn = ctx.createGain();
    gn.gain.value = (o.gain === undefined ? 0.4 : o.gain);
    src.connect(flt); flt.connect(gn); gn.connect(o.bus || sfxGain);
    src.start(t0);
  }

  /* --------------------------------------------------------------- music */
  /* Three short original themes built from a scale and a simple chord walk.
     Each bar is scheduled a little ahead so the loop stays in time. */
  var SCALES = {
    town:  [0, 2, 4, 5, 7, 9, 11],      // major, warm
    wild:  [0, 2, 3, 5, 7, 8, 10],      // minor, uneasy
    deep:  [0, 1, 4, 5, 7, 8, 11]       // exotic, dungeon
  };
  var ROOTS = { town: 196.00, wild: 164.81, deep: 146.83 };
  var PROG = {
    town: [0, 4, 5, 3],
    wild: [0, 5, 3, 4],
    deep: [0, 3, 6, 4]
  };

  function noteFreq(root, scale, degree) {
    var oct = Math.floor(degree / scale.length);
    var semis = scale[((degree % scale.length) + scale.length) % scale.length] + oct * 12;
    return root * Math.pow(2, semis / 12);
  }

  var barIndex = 0;
  function playBar(theme) {
    if (!ctx || !started) return;
    var scale = SCALES[theme] || SCALES.town;
    var root = ROOTS[theme] || 196;
    var prog = PROG[theme] || PROG.town;
    var chord = prog[barIndex % prog.length];
    var beat = 0.52;

    /* bass note under the bar */
    tone({ freq: noteFreq(root / 2, scale, chord), dur: beat * 3.4, gain: 0.30,
           type: 'sine', bus: musicGain, attack: 0.06 });
    /* soft chord pad */
    [0, 2, 4].forEach(function (iv, n) {
      tone({ freq: noteFreq(root, scale, chord + iv), dur: beat * 3.2, gain: 0.10,
             type: 'triangle', bus: musicGain, attack: 0.18, delay: n * 0.02 });
    });
    /* melody: four notes drawn from the chord, wandering a little */
    var seed = barIndex * 2654435761 % 100000;
    for (var i = 0; i < 4; i++) {
      var pick = chord + [0, 2, 4, 5, 2, 4][(seed + i * 7) % 6] + (((seed + i) % 5 === 0) ? 7 : 0);
      tone({ freq: noteFreq(root * 2, scale, pick), dur: beat * 0.78, gain: 0.16,
             type: theme === 'deep' ? 'sine' : 'triangle', bus: musicGain,
             delay: i * beat, attack: 0.02 });
    }
    barIndex++;
  }

  function startMusic(theme) {
    if (!init()) return;
    if (currentTheme === theme && musicTimer) return;
    currentTheme = theme;
    if (musicTimer) clearInterval(musicTimer);
    barIndex = 0;
    if (!started) return;
    playBar(theme);
    musicTimer = setInterval(function () { playBar(currentTheme); }, 2100);
  }
  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null; currentTheme = null;
  }

  /* ----------------------------------------------------------- ambience */
  function clearAmbience() {
    ambNodes.forEach(function (n) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    ambNodes = [];
  }
  var ambKind = null;
  function setAmbience(kind) {
    if (!init() || !started) return;
    if (ambKind === kind) return;
    ambKind = kind;
    clearAmbience();
    if (!kind) return;

    var len = Math.floor(ctx.sampleRate * 3);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var flt = ctx.createBiquadFilter();
    var gn = ctx.createGain();

    if (kind === 'water')      { flt.type = 'lowpass'; flt.frequency.value = 620; gn.gain.value = 0.5; }
    else if (kind === 'forest'){ flt.type = 'bandpass'; flt.frequency.value = 1500; flt.Q.value = 0.6; gn.gain.value = 0.24; }
    else if (kind === 'town')  { flt.type = 'lowpass'; flt.frequency.value = 380; gn.gain.value = 0.2; }
    else if (kind === 'cave')  { flt.type = 'lowpass'; flt.frequency.value = 210; gn.gain.value = 0.42; }
    else                       { flt.type = 'lowpass'; flt.frequency.value = 300; gn.gain.value = 0.16; }

    src.connect(flt); flt.connect(gn); gn.connect(ambGain);
    src.start();
    ambNodes.push(src);

    /* forest gets the occasional bird */
    if (kind === 'forest') {
      var birdTimer = setInterval(function () {
        if (ambKind !== 'forest') { clearInterval(birdTimer); return; }
        if (Math.random() < 0.45) {
          var f = 1600 + Math.random() * 900;
          tone({ freq: f, to: f * 1.35, dur: 0.13, gain: 0.06, type: 'sine', bus: ambGain });
          tone({ freq: f * 1.2, to: f * 0.9, dur: 0.11, gain: 0.05, type: 'sine', bus: ambGain, delay: 0.16 });
        }
      }, 4200);
      ambNodes.push({ stop: function () { clearInterval(birdTimer); } });
    }
  }

  /* ------------------------------------------------------------ effects */
  var SFX = {
    click:    function () { tone({ freq: 620, to: 420, dur: 0.06, gain: 0.22, type: 'square' }); },
    step:     function () { noise({ freq: 340, dur: 0.08, gain: 0.10, filter: 'lowpass' }); },
    chop:     function () { noise({ freq: 520, dur: 0.22, gain: 0.4, q: 0.9 });
                            tone({ freq: 180, to: 90, dur: 0.18, gain: 0.24, type: 'square' }); },
    treefall: function () { noise({ freq: 260, dur: 0.9, gain: 0.5, filter: 'lowpass' });
                            tone({ freq: 120, to: 48, dur: 0.8, gain: 0.3, type: 'sawtooth' }); },
    mine:     function () { tone({ freq: 900, to: 320, dur: 0.14, gain: 0.3, type: 'square' });
                            noise({ freq: 2200, dur: 0.16, gain: 0.3 }); },
    fish:     function () { noise({ freq: 900, dur: 0.28, gain: 0.22, filter: 'bandpass', q: 0.7 }); },
    smith:    function () { tone({ freq: 1400, to: 700, dur: 0.2, gain: 0.32, type: 'square' });
                            tone({ freq: 2100, to: 1100, dur: 0.14, gain: 0.16, type: 'sine', delay: 0.03 }); },
    fire:     function () { noise({ freq: 700, dur: 0.6, gain: 0.3, filter: 'bandpass', q: 0.5 }); },
    cook:     function () { noise({ freq: 1200, dur: 0.4, gain: 0.2, filter: 'highpass' }); },
    hit:      function () { tone({ freq: 200, to: 70, dur: 0.16, gain: 0.36, type: 'square' });
                            noise({ freq: 400, dur: 0.14, gain: 0.26, filter: 'lowpass' }); },
    miss:     function () { noise({ freq: 1800, dur: 0.12, gain: 0.14, filter: 'bandpass', q: 2 }); },
    hurt:     function () { tone({ freq: 320, to: 140, dur: 0.22, gain: 0.34, type: 'sawtooth' }); },
    die:      function () { tone({ freq: 260, to: 60, dur: 0.75, gain: 0.34, type: 'sawtooth' });
                            noise({ freq: 200, dur: 0.7, gain: 0.22, filter: 'lowpass' }); },
    bow:      function () { noise({ freq: 2600, dur: 0.12, gain: 0.2, filter: 'highpass' });
                            tone({ freq: 800, to: 2200, dur: 0.14, gain: 0.12, type: 'sine' }); },
    magic:    function () { tone({ freq: 420, to: 1700, dur: 0.34, gain: 0.22, type: 'sine' });
                            tone({ freq: 630, to: 2300, dur: 0.3, gain: 0.14, type: 'triangle', delay: 0.05 }); },
    levelup:  function () { [0, 4, 7, 12].forEach(function (s, i) {
                              tone({ freq: 392 * Math.pow(2, s / 12), dur: 0.4, gain: 0.28,
                                     type: 'triangle', delay: i * 0.12 }); }); },
    quest:    function () { [0, 5, 9, 14, 17].forEach(function (s, i) {
                              tone({ freq: 330 * Math.pow(2, s / 12), dur: 0.5, gain: 0.24,
                                     type: 'sine', delay: i * 0.15 }); }); },
    coin:     function () { tone({ freq: 1500, to: 2400, dur: 0.1, gain: 0.16, type: 'square' });
                            tone({ freq: 2000, to: 2800, dur: 0.09, gain: 0.12, type: 'square', delay: 0.06 }); },
    item:     function () { tone({ freq: 1000, to: 1500, dur: 0.09, gain: 0.16, type: 'triangle' }); },
    door:     function () { noise({ freq: 320, dur: 0.5, gain: 0.24, filter: 'bandpass', q: 0.8 });
                            tone({ freq: 120, to: 90, dur: 0.45, gain: 0.14, type: 'sawtooth' }); },
    eat:      function () { noise({ freq: 700, dur: 0.22, gain: 0.2, filter: 'lowpass' }); },
    bury:     function () { noise({ freq: 260, dur: 0.42, gain: 0.24, filter: 'lowpass' }); },
    error:    function () { tone({ freq: 200, to: 150, dur: 0.18, gain: 0.22, type: 'square' }); },
    open:     function () { tone({ freq: 500, to: 760, dur: 0.11, gain: 0.16, type: 'triangle' }); },
    teleport: function () { tone({ freq: 300, to: 2400, dur: 0.55, gain: 0.24, type: 'sine' });
                            noise({ freq: 2000, dur: 0.5, gain: 0.18, filter: 'highpass' }); }
  };

  function play(name) {
    if (!ctx || !started) return;
    var f = SFX[name];
    if (f) { try { f(); } catch (e) {} }
  }

  g.RFAudio = {
    resume: resume, play: play, setVolumes: setVolumes,
    startMusic: startMusic, stopMusic: stopMusic, setAmbience: setAmbience,
    get ready() { return !!ctx && started; }
  };
})(window);
