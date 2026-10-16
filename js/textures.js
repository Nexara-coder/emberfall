/* Emberfall - procedural textures.
   RS2 did not render untextured plastic boxes; it painted stone brick, wood
   plank and thatch onto very simple geometry, over a muted earthy palette.
   These are written as plain pixel loops rather than canvas drawing calls, so
   the same code can be run offline to preview exactly what ships. */
(function (g) {
  'use strict';

  /* ---------------------------------------------------------- utilities */
  function hash2(x, y, s) {
    var n = (x * 374761393 + y * 668265263 + s * 1442695040888963407) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }
  /* Value noise that wraps, so every texture tiles seamlessly. */
  function wrapNoise(x, y, period, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    function at(a, b) {
      return hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
    }
    var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbmWrap(x, y, period, seed, oct) {
    var sum = 0, amp = 1, tot = 0, p = period, f = 1;
    for (var i = 0; i < (oct || 3); i++) {
      sum += wrapNoise(x * f, y * f, p * f, seed + i * 17) * amp;
      tot += amp; amp *= 0.5; f *= 2;
    }
    return sum / tot;
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }
  function mix(a, b, t) { return a + (b - a) * t; }

  /* Each generator fills an RGBA byte array of size*size. */
  var GEN = {};

  /* Muted grass: clumped olive tones with darker blade speckle. */
  GEN.grass = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 8, y / S * 8, 8, 11, 3);
      var blade = hash2(x, y, 3) > 0.82 ? -22 : 0;
      var clump = wrapNoise(x / S * 4, y / S * 4, 4, 29) * 18;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(118 + n * 34 + blade + clump * 0.5);
      d[i + 1] = clamp255(132 + n * 30 + blade + clump);
      d[i + 2] = clamp255(96 + n * 26 + blade);
      d[i + 3] = 255;
    }
  };

  /* Dry earth: fine grain with occasional pebbles. */
  GEN.dirt = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 10, y / S * 10, 10, 5, 3);
      var g2 = hash2(x, y, 9);
      var peb = g2 > 0.955 ? 26 : (g2 < 0.03 ? -20 : 0);
      var i = (y * S + x) * 4;
      d[i]     = clamp255(150 + n * 40 + peb);
      d[i + 1] = clamp255(132 + n * 34 + peb);
      d[i + 2] = clamp255(110 + n * 28 + peb);
      d[i + 3] = 255;
    }
  };

  /* Trodden path: paler, smoother, with wheel-rut streaks. */
  GEN.path = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 6, y / S * 12, 6, 21, 2);
      var rut = Math.sin(x / S * Math.PI * 4) * 6;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(168 + n * 30 + rut);
      d[i + 1] = clamp255(156 + n * 26 + rut);
      d[i + 2] = clamp255(130 + n * 22 + rut);
      d[i + 3] = 255;
    }
  };

  GEN.sand = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 14, y / S * 14, 14, 33, 2);
      var sp = hash2(x, y, 41) > 0.93 ? 18 : 0;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(196 + n * 26 + sp);
      d[i + 1] = clamp255(182 + n * 24 + sp);
      d[i + 2] = clamp255(146 + n * 20 + sp);
      d[i + 3] = 255;
    }
  };

  /* Stone brick: staggered courses with recessed mortar and per-block tone. */
  GEN.brick = function (d, S) {
    var rows = 4, cols = 4;
    var bh = S / rows, bw = S / cols;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var row = Math.floor(y / bh);
      var offset = (row % 2) * (bw / 2);
      var bx = (x + offset) % S;
      var col = Math.floor(bx / bw);
      var inX = bx - col * bw, inY = y - row * bh;
      var mortar = (inX < 1.6 || inY < 1.6 || inX > bw - 1.6 || inY > bh - 1.6);
      var tone = hash2(col, row, 7) * 34 - 17;
      var grain = fbmWrap(x / S * 14, y / S * 14, 14, 61, 4) * 26;
      /* pitting, and softer worn corners */
      var pit = fbmWrap(x / S * 30, y / S * 30, 30, 63, 2) < 0.18 ? -18 : 0;
      var dx0 = Math.min(inX, bw - inX), dy0 = Math.min(inY, bh - inY);
      var wear = Math.min(1, Math.min(dx0, dy0) / 3) * 10 - 10;
      var base = mortar ? 92 + grain * 0.5 : 148 + tone + grain + pit + wear;
      /* a soft highlight along the top edge of each block reads as relief */
      if (!mortar && inY < bh * 0.22) base += 12;
      if (!mortar && inY > bh * 0.80) base -= 10;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 1.00);
      d[i + 1] = clamp255(base * 0.98);
      d[i + 2] = clamp255(base * 0.90);
      d[i + 3] = 255;
    }
  };

  /* Vertical wooden boards with grain lines and dark seams. */
  GEN.plank = function (d, S) {
    var boards = 4, bw = S / boards;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var b = Math.floor(x / bw);
      var inX = x - b * bw;
      var seam = (inX < 1.3 || inX > bw - 1.3);
      var tone = hash2(b, 0, 13) * 30 - 15;
      var grain = Math.sin((y / S * 26) + hash2(b, 1, 17) * 9) * 7
                + fbmWrap(x / S * 5, y / S * 26, 5, 71, 2) * 22;
      var knot = 0;
      var ky = hash2(b, 2, 23) * S;
      if (Math.abs(y - ky) < 3 && inX > bw * 0.3 && inX < bw * 0.7) knot = -26;
      var nail = (Math.abs(y % (S / 2) - 6) < 2 && Math.abs(inX - bw / 2) < 2) ? -30 : 0;
      var base = seam ? 58 : 130 + tone + grain + knot + nail;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 1.00);
      d[i + 1] = clamp255(base * 0.76);
      d[i + 2] = clamp255(base * 0.48);
      d[i + 3] = 255;
    }
  };

  /* Straw thatch: matted diagonal strands. */
  GEN.thatch = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var strand = Math.sin((x * 0.7 + y * 2.3)) * 8;
      var n = fbmWrap(x / S * 7, y / S * 18, 7, 91, 2);
      var band = Math.floor(y / (S / 5)) % 2 ? 6 : -6;
      var base = 148 + n * 42 + strand + band;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 1.00);
      d[i + 1] = clamp255(base * 0.84);
      d[i + 2] = clamp255(base * 0.50);
      d[i + 3] = 255;
    }
  };

  /* Overlapping roof shingles. */
  GEN.shingle = function (d, S) {
    var rows = 5, cols = 6;
    var rh = S / rows, cw = S / cols;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var row = Math.floor(y / rh);
      var off = (row % 2) * (cw / 2);
      var cx2 = (x + off) % S;
      var col = Math.floor(cx2 / cw);
      var inY = y - row * rh, inX = cx2 - col * cw;
      var edge = (inY < 1.4) || (inX < 1.2) || (inX > cw - 1.2);
      var tone = hash2(col, row, 37) * 22 - 11;
      var shade = (inY / rh) * 16;          // darker toward the bottom lip
      var base = edge ? 58 : 110 + tone - shade;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 0.92);
      d[i + 1] = clamp255(base * 0.72);
      d[i + 2] = clamp255(base * 0.66);
      d[i + 3] = 255;
    }
  };

  /* Tree bark: vertical fissures. */
  GEN.bark = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      /* Bark is vertical plates split by deep cracks. A sine ripple reads as
         corduroy; this warps the plate edges and darkens hard inside the
         cracks so the trunk has depth at a distance. */
      var warp = fbmWrap(x / S * 3, y / S * 7, 3, 51, 3) * 3.2;
      var plate = Math.abs(Math.sin(x / S * Math.PI * 6 + warp));
      var crack = plate < 0.14 ? -52 * (1 - plate / 0.14) : 0;
      var grain = fbmWrap(x / S * 7, y / S * 34, 7, 43, 4);
      var knot = fbmWrap(x / S * 2.5, y / S * 2.5, 3, 47, 2);
      var base = 92 + plate * 46 + grain * 34 + crack + (knot - 0.25) * 30;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 1.00);
      d[i + 1] = clamp255(base * 0.74);
      d[i + 2] = clamp255(base * 0.50);
      d[i + 3] = 255;
    }
  };

  /* Leaf canopy: clumped foliage, darker in the gaps. */
  GEN.leaf = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      /* several scales of clumping, so foliage has light and dark masses
         rather than an even speckle */
      var n = fbmWrap(x / S * 11, y / S * 11, 11, 67, 4);
      var clump = fbmWrap(x / S * 4, y / S * 4, 4, 83, 2);
      var fleck = hash2(x, y, 89) > 0.86 ? 18 : 0;
      var base = 66 + n * 62 + clump * 52 + fleck;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 0.62);
      d[i + 1] = clamp255(base * 1.00);
      d[i + 2] = clamp255(base * 0.44);
      d[i + 3] = 255;
    }
  };

  /* Rough rock face for boulders, cliffs and ore. */
  GEN.rock = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 9, y / S * 9, 9, 101, 4);
      var crack = fbmWrap(x / S * 4, y / S * 4, 4, 113, 2);
      var c = Math.abs(crack - 0.5) < 0.035 ? -34 : 0;
      var base = 126 + n * 46 + c;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 0.98);
      d[i + 1] = clamp255(base * 0.97);
      d[i + 2] = clamp255(base * 0.95);
      d[i + 3] = 255;
    }
  };

  /* Cloth for robes, awnings and banners. */
  GEN.cloth = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 8 : -8;
      var n = fbmWrap(x / S * 12, y / S * 12, 12, 131, 2);
      var base = 168 + weave + n * 20;
      var i = (y * S + x) * 4;
      d[i] = clamp255(base); d[i + 1] = clamp255(base); d[i + 2] = clamp255(base);
      d[i + 3] = 255;
    }
  };

  /* Water surface, used as a scrolling overlay. */
  GEN.water = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var w = Math.sin(x / S * Math.PI * 4 + Math.cos(y / S * Math.PI * 3) * 1.4);
      var n = fbmWrap(x / S * 6, y / S * 6, 6, 151, 2);
      var base = 128 + w * 22 + n * 30;
      var i = (y * S + x) * 4;
      d[i]     = clamp255(base * 0.52);
      d[i + 1] = clamp255(base * 0.82);
      d[i + 2] = clamp255(base * 1.00);
      d[i + 3] = 255;
    }
  };

  GEN.snow = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 10, y / S * 10, 10, 173, 3);
      var sp = hash2(x, y, 181) > 0.97 ? 14 : 0;
      var base = 222 + n * 26 + sp;
      var i = (y * S + x) * 4;
      d[i] = clamp255(base * 0.97); d[i + 1] = clamp255(base * 0.99); d[i + 2] = clamp255(base);
      d[i + 3] = 255;
    }
  };

  /* Metal, for anvils, armour stands and gates. */
  GEN.metal = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var brush = Math.sin(y * 1.7) * 5 + fbmWrap(x / S * 16, y / S * 3, 16, 191, 2) * 26;
      var base = 150 + brush;
      var i = (y * S + x) * 4;
      d[i] = clamp255(base * 0.97); d[i + 1] = clamp255(base * 0.98); d[i + 2] = clamp255(base * 1.02);
      d[i + 3] = 255;
    }
  };

  /* Foliage with real transparency. This is the piece that has been missing:
     the reference canopies are not solid surfaces, they are leaf sheets with
     holes, which is where the ragged edge and the sky showing through the
     crown come from. Solid geometry cannot imitate that at any polygon count. */
  GEN.foliage = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var i = (y * S + x) * 4;
      /* clumps at two scales, so leaves gather into masses with gaps between */
      var big = fbmWrap(x / S * 5, y / S * 5, 5, 301, 3);
      var fine = fbmWrap(x / S * 17, y / S * 17, 17, 311, 3);
      var mask = big * 0.62 + fine * 0.38;
      var lit = fbmWrap(x / S * 11, y / S * 11, 11, 317, 2);
      /* This noise runs about 0.10 to 0.40, not 0 to 1 - thresholds have to
         be set against its real range or the whole sheet cuts away. */
      var maskN = (mask - 0.10) / 0.30;
      var litN = Math.max(0, Math.min(1, (lit - 0.10) / 0.30));
      if (maskN < 0.46) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
      var a = maskN < 0.56 ? 150 : 255;
      var base = 74 + litN * 104 + (maskN - 0.5) * 46;
      d[i]     = clamp255(base * 0.56);
      d[i + 1] = clamp255(base * 1.00);
      d[i + 2] = clamp255(base * 0.40);
      d[i + 3] = a;
    }
  };

  /* A near-white detail grain used to break up flat painted surfaces. */
  GEN.detail = function (d, S) {
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var n = fbmWrap(x / S * 10, y / S * 10, 10, 211, 3);
      var base = 206 + n * 48;
      var i = (y * S + x) * 4;
      d[i] = clamp255(base); d[i + 1] = clamp255(base); d[i + 2] = clamp255(base);
      d[i + 3] = 255;
    }
  };

  /* -------------------------------------------------------------- build */
  var SIZE = 512;   // 64 -> 256 -> 512; the small sheets read as mush on a big screen
  var cache = {};

  function pixels(name, size) {
    var S = size || SIZE;
    var d = new Uint8ClampedArray(S * S * 4);
    (GEN[name] || GEN.detail)(d, S);
    return { data: d, size: S };
  }

  /* repeat may be a number, or [u, v] when a surface needs different tiling
     around it than up it - a short wide cylinder tiled evenly turns the sheet
     into horizontal stripes. */
  function texture(name, repeat, size) {
    var ru = Array.isArray(repeat) ? repeat[0] : (repeat || 1);
    var rv = Array.isArray(repeat) ? repeat[1] : (repeat || 1);
    var key = name + ':' + ru + 'x' + rv + ':' + (size || SIZE);
    if (cache[key]) return cache[key];
    var S = size || SIZE;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    (GEN[name] || GEN.detail)(img.data, S);
    ctx.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(ru, rv);
    /* Linear filtering with mipmaps and anisotropy. Nearest was giving the
       ground the blocky, aliased look; the era's chunkiness should come from
       the geometry and the palette, not from pixelated magnification. */
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    cache[key] = t;
    return t;
  }

  g.RFTextures = { texture: texture, pixels: pixels, names: Object.keys(GEN), SIZE: SIZE };
})(window);
