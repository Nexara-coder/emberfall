/* Emberfall - item icons.
   Every item carries icon:[shape, colour1, colour2]. Rather than shipping a few
   hundred sprite files we draw each icon once onto a small canvas and cache it,
   which also means an item can never show up as a broken image. */
(function (g) {
  'use strict';
  var cache = {};
  var SIZE = 96;

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    var gg = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    var b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  function poly(c, pts, fill, stroke) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.4; c.stroke(); }
  }
  function rect(c, x, y, w, h, fill, stroke) {
    c.fillStyle = fill; c.fillRect(x, y, w, h);
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.strokeRect(x + .5, y + .5, w - 1, h - 1); }
  }
  function circ(c, x, y, r, fill, stroke) {
    c.beginPath(); c.arc(x, y, r, 0, 6.2832);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.3; c.stroke(); }
  }

  /* blade + hilt, shared by every sword-ish weapon */
  function blade(c, c1, c2, len, wide, curve) {
    var top = 24 - len / 2, bot = 24 + len / 2;
    c.save();
    if (curve) {
      c.beginPath();
      c.moveTo(24 - wide / 2, bot);
      c.quadraticCurveTo(24 - wide * 1.5, 24, 24 + wide * .4, top);
      c.lineTo(24 + wide * 1.1, top + 5);
      c.quadraticCurveTo(24 + wide * .4, 24, 24 + wide / 2, bot);
      c.closePath();
      c.fillStyle = c1; c.fill();
      c.strokeStyle = shade(c2, .8); c.lineWidth = 1.2; c.stroke();
    } else {
      poly(c, [[24 - wide / 2, bot], [24 - wide / 2, top + 5], [24, top], [24 + wide / 2, top + 5], [24 + wide / 2, bot]], c1, shade(c2, .8));
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.fillRect(24 - wide / 2 + 1, top + 6, wide * .28, len - 8);
    }
    c.restore();
    rect(c, 24 - wide * 1.15, bot - 2, wide * 2.3, 4, c2, '#241a11');   // guard
    rect(c, 23, bot + 2, 3, 9, '#5a4227', '#241a11');                   // grip
    circ(c, 24.5, bot + 12, 2.6, c2, '#241a11');                        // pommel
  }

  var SHAPES = {
    coin: function (c, a, b) {
      circ(c, 19, 28, 10, b, '#241a11');
      circ(c, 28, 22, 11, a, '#241a11');
      circ(c, 28, 22, 6, shade(a, 1.15));
    },
    dagger: function (c, a, b) { blade(c, a, b, 20, 8, false); },
    sword: function (c, a, b) { blade(c, a, b, 27, 9, false); },
    longsword: function (c, a, b) { blade(c, a, b, 32, 9, false); },
    scimitar: function (c, a, b) { blade(c, a, b, 28, 10, true); },
    greatsword: function (c, a, b) { blade(c, a, b, 36, 13, false); },
    mace: function (c, a, b) {
      rect(c, 22.5, 20, 3.5, 22, '#5a4227', '#241a11');
      circ(c, 24, 16, 9, a, shade(b, .8));
      for (var i = 0; i < 6; i++) {
        var an = i / 6 * 6.2832;
        poly(c, [[24 + Math.cos(an) * 8, 16 + Math.sin(an) * 8],
                 [24 + Math.cos(an) * 13, 16 + Math.sin(an) * 13],
                 [24 + Math.cos(an + .4) * 8, 16 + Math.sin(an + .4) * 8]], b);
      }
    },
    battleaxe: function (c, a, b) {
      rect(c, 22.5, 8, 3.5, 34, '#6b4e2c', '#241a11');
      poly(c, [[24, 10], [38, 14], [38, 26], [24, 28]], a, shade(b, .8));
      poly(c, [[24, 10], [10, 14], [10, 26], [24, 28]], shade(a, .88), shade(b, .8));
    },
    hatchet: function (c, a, b) {
      rect(c, 23, 12, 3.2, 30, '#6b4e2c', '#241a11');
      poly(c, [[24, 13], [37, 17], [36, 27], [24, 27]], a, shade(b, .8));
    },
    pickaxe: function (c, a, b) {
      rect(c, 23, 12, 3.2, 30, '#6b4e2c', '#241a11');
      c.beginPath(); c.moveTo(9, 22); c.quadraticCurveTo(24, 9, 39, 22);
      c.lineWidth = 5; c.strokeStyle = a; c.stroke();
      c.lineWidth = 1.2; c.strokeStyle = shade(b, .8); c.stroke();
    },
    bow: function (c, a, b) {
      c.beginPath(); c.arc(30, 24, 16, 2.2, 4.1);
      c.lineWidth = 4; c.strokeStyle = a; c.stroke();
      c.beginPath(); c.moveTo(21, 10); c.lineTo(21, 38);
      c.lineWidth = 1.4; c.strokeStyle = b; c.stroke();
    },
    staff: function (c, a, b) {
      rect(c, 22.5, 10, 3.5, 34, '#6b4e2c', '#241a11');
      circ(c, 24, 10, 7, a, shade(b, .8));
      circ(c, 24, 10, 3.2, '#fff8d0');
    },
    arrow: function (c, a, b) {
      for (var i = 0; i < 3; i++) {
        var x = 15 + i * 9;
        rect(c, x, 14, 2, 24, '#8b6239');
        poly(c, [[x + 1, 9], [x - 3, 16], [x + 5, 16]], a, shade(b, .8));
        poly(c, [[x + 1, 38], [x - 3, 44], [x + 5, 44]], '#e8e2cf');
      }
    },
    helm: function (c, a, b) {
      c.beginPath(); c.arc(24, 26, 14, Math.PI, 0); c.closePath();
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .8); c.lineWidth = 1.4; c.stroke();
      rect(c, 10, 26, 28, 7, b, '#241a11');
      rect(c, 22, 14, 4, 19, shade(a, .8));
    },
    body: function (c, a, b) {
      poly(c, [[13, 14], [19, 11], [29, 11], [35, 14], [35, 38], [13, 38]], a, shade(b, .8));
      rect(c, 9, 14, 6, 16, b, '#241a11');
      rect(c, 33, 14, 6, 16, b, '#241a11');
      rect(c, 21, 12, 6, 5, shade(a, .75));
    },
    legs: function (c, a, b) {
      poly(c, [[14, 10], [34, 10], [33, 40], [26, 40], [24, 24], [22, 40], [15, 40]], a, shade(b, .8));
    },
    shield: function (c, a, b) {
      poly(c, [[12, 10], [36, 10], [35, 28], [24, 40], [13, 28]], a, shade(b, .8));
      poly(c, [[24, 14], [31, 18], [31, 27], [24, 35], [17, 27], [17, 18]], shade(a, .78));
    },
    gloves: function (c, a, b) {
      rect(c, 14, 18, 9, 18, a, shade(b, .8));
      rect(c, 25, 18, 9, 18, a, shade(b, .8));
      rect(c, 13, 32, 11, 6, b); rect(c, 24, 32, 11, 6, b);
    },
    boots: function (c, a, b) {
      poly(c, [[15, 12], [24, 12], [24, 30], [33, 30], [33, 38], [15, 38]], a, shade(b, .8));
    },
    cape: function (c, a, b) {
      poly(c, [[16, 10], [32, 10], [38, 40], [24, 34], [10, 40]], a, shade(b, .8));
    },
    ring: function (c, a, b) {
      circ(c, 24, 28, 11, 'transparent', a); c.lineWidth = 4;
      c.beginPath(); c.arc(24, 28, 10, 0, 6.2832); c.strokeStyle = a; c.stroke();
      poly(c, [[24, 6], [30, 13], [24, 20], [18, 13]], b, '#ffffff88');
    },
    amulet: function (c, a, b) {
      c.beginPath(); c.arc(24, 18, 12, .3, Math.PI - .3);
      c.lineWidth = 2.4; c.strokeStyle = a; c.stroke();
      poly(c, [[24, 24], [32, 32], [24, 42], [16, 32]], b, '#ffffff66');
    },
    ore: function (c, a, b) {
      poly(c, [[12, 32], [18, 18], [30, 15], [38, 27], [32, 38], [17, 38]], '#7b7b83', '#3d3d45');
      circ(c, 21, 27, 4.5, a); circ(c, 30, 24, 3.6, a); circ(c, 26, 33, 3, shade(a, 1.2));
    },
    bar: function (c, a, b) {
      poly(c, [[11, 30], [16, 20], [37, 20], [32, 30]], shade(a, 1.12), shade(b, .8));
      poly(c, [[11, 30], [32, 30], [32, 37], [11, 37]], a, shade(b, .8));
    },
    gemraw: function (c, a, b) {
      poly(c, [[14, 30], [19, 16], [31, 14], [37, 26], [29, 37], [18, 37]], b, '#3d3d45');
      poly(c, [[22, 28], [24, 20], [30, 21], [31, 29], [26, 33]], a);
    },
    gem: function (c, a, b) {
      poly(c, [[24, 8], [37, 20], [24, 42], [11, 20]], a, '#ffffff88');
      poly(c, [[24, 8], [30, 20], [24, 42]], shade(a, 1.3));
      poly(c, [[11, 20], [37, 20], [24, 27]], '#ffffff44');
    },
    log: function (c, a, b) {
      rect(c, 8, 18, 32, 13, a, shade(b, .75));
      circ(c, 40, 24.5, 6.5, shade(a, 1.15), shade(b, .75));
      circ(c, 40, 24.5, 3, shade(b, .9));
    },
    fish: function (c, a, b) {
      c.beginPath(); c.ellipse(25, 24, 14, 8, 0, 0, 6.2832);
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .7); c.lineWidth = 1.2; c.stroke();
      poly(c, [[11, 24], [4, 17], [4, 31]], a, shade(b, .7));
      circ(c, 32, 21, 1.8, '#1a1409');
    },
    food: function (c, a, b) {
      circ(c, 24, 26, 13, a, shade(b, .8));
      c.fillStyle = shade(a, 1.2);
      c.beginPath(); c.ellipse(20, 22, 6, 4, -.5, 0, 6.2832); c.fill();
    },
    bread: function (c, a, b) {
      c.beginPath(); c.moveTo(9, 32); c.quadraticCurveTo(24, 8, 39, 32); c.lineTo(39, 38); c.lineTo(9, 38);
      c.closePath(); c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .8); c.lineWidth = 1.3; c.stroke();
      for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(15 + i * 7, 22 + i); c.lineTo(19 + i * 7, 17 + i); c.strokeStyle = shade(b, .8); c.stroke(); }
    },
    potion: function (c, a, b) {
      rect(c, 21, 8, 6, 7, '#b6b0a0', '#241a11');
      c.beginPath(); c.moveTo(20, 15); c.lineTo(28, 15); c.lineTo(34, 28);
      c.quadraticCurveTo(34, 41, 24, 41); c.quadraticCurveTo(14, 41, 14, 28); c.closePath();
      c.fillStyle = b; c.fill(); c.strokeStyle = '#241a11'; c.lineWidth = 1.3; c.stroke();
      c.fillStyle = a; c.beginPath(); c.moveTo(15, 27); c.lineTo(33, 27);
      c.quadraticCurveTo(33, 40, 24, 40); c.quadraticCurveTo(15, 40, 15, 27); c.fill();
    },
    vial: function (c, a, b) { SHAPES.potion(c, a || '#cfe4ef', b || '#b6c8d0'); },
    rune: function (c, a, b) {
      poly(c, [[24, 9], [36, 19], [32, 38], [16, 38], [12, 19]], a, shade(b, .7));
      c.strokeStyle = '#1a1409'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(20, 17); c.lineTo(28, 30); c.moveTo(28, 17); c.lineTo(20, 30); c.stroke();
    },
    herb: function (c, a, b) {
      rect(c, 23, 20, 2.5, 20, '#5d7a3a');
      for (var i = 0; i < 5; i++) {
        var an = -1.6 + i * .62;
        c.save(); c.translate(24, 22); c.rotate(an);
        c.beginPath(); c.ellipse(0, -9, 3.6, 9, 0, 0, 6.2832); c.fillStyle = a; c.fill();
        c.restore();
      }
    },
    seed: function (c, a, b) {
      for (var i = 0; i < 5; i++) {
        var x = 16 + (i % 3) * 8, y = 20 + Math.floor(i / 3) * 9;
        c.beginPath(); c.ellipse(x, y, 4, 5.5, .4, 0, 6.2832); c.fillStyle = a; c.fill();
        c.strokeStyle = shade(b, .8); c.lineWidth = 1; c.stroke();
      }
    },
    bones: function (c, a, b) {
      c.save(); c.translate(24, 24); c.rotate(-.6);
      rect(c, -14, -3, 28, 6, a || '#e6e0cc', '#8a8474');
      circ(c, -14, -3.5, 4, a || '#e6e0cc', '#8a8474'); circ(c, -14, 3.5, 4, a || '#e6e0cc', '#8a8474');
      circ(c, 14, -3.5, 4, a || '#e6e0cc', '#8a8474'); circ(c, 14, 3.5, 4, a || '#e6e0cc', '#8a8474');
      c.restore();
    },
    tool: function (c, a, b) {
      rect(c, 22, 16, 4, 26, '#6b4e2c', '#241a11');
      rect(c, 13, 8, 22, 10, a, shade(b, .8));
    },
    pot: function (c, a, b) {
      c.beginPath(); c.moveTo(14, 18); c.lineTo(34, 18); c.lineTo(31, 38); c.lineTo(17, 38); c.closePath();
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .8); c.lineWidth = 1.3; c.stroke();
      rect(c, 12, 14, 24, 5, shade(a, 1.12), shade(b, .8));
    },
    bucket: function (c, a, b) {
      c.beginPath(); c.moveTo(14, 18); c.lineTo(34, 18); c.lineTo(31, 39); c.lineTo(17, 39); c.closePath();
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .7); c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.arc(24, 18, 10, Math.PI, 0); c.strokeStyle = shade(b, .6); c.lineWidth = 1.6; c.stroke();
    },
    cloth: function (c, a, b) {
      poly(c, [[12, 14], [36, 12], [34, 36], [14, 38]], a, shade(b, .8));
      c.strokeStyle = shade(b, .75); c.lineWidth = 1;
      for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(14, 19 + i * 6); c.lineTo(35, 17 + i * 6); c.stroke(); }
    },
    key: function (c, a, b) {
      circ(c, 16, 18, 7, 'transparent', a); c.lineWidth = 3.5;
      c.beginPath(); c.arc(16, 18, 6, 0, 6.2832); c.strokeStyle = a; c.stroke();
      rect(c, 19, 22, 3.5, 18, a); rect(c, 22, 32, 7, 3, a); rect(c, 22, 37, 5, 3, a);
    },
    scroll: function (c, a, b) {
      rect(c, 12, 12, 24, 26, a || '#e2d3ac', '#8a7647');
      rect(c, 10, 9, 28, 5, b || '#b79a4a', '#6a5535');
      rect(c, 10, 36, 28, 5, b || '#b79a4a', '#6a5535');
      c.strokeStyle = '#9a8a63'; c.lineWidth = 1;
      for (var i = 0; i < 4; i++) { c.beginPath(); c.moveTo(15, 18 + i * 5); c.lineTo(33, 18 + i * 5); c.stroke(); }
    },

    /* --- shapes that previously fell through to a generic blob ---------- */
    nail: function (c, a, b) {
      for (var i = 0; i < 3; i++) {
        var x = 14 + i * 9;
        poly(c, [[x - 4, 12], [x + 4, 12], [x + 1.5, 17], [x - 1.5, 17]], a, shade(b, .7));
        rect(c, x - 1.2, 16, 2.4, 22, a);
        poly(c, [[x - 1.2, 38], [x + 1.2, 38], [x, 43]], shade(a, .8));
      }
    },
    string: function (c, a, b) {
      circ(c, 24, 26, 13, a, shade(b, .7));
      c.strokeStyle = shade(b, .75); c.lineWidth = 1.1;
      for (var i = -2; i <= 2; i++) {
        c.beginPath();
        c.ellipse(24, 26, 13, 5 + Math.abs(i) * 2.2, i * 0.5, 0, 6.2832);
        c.stroke();
      }
      c.beginPath(); c.moveTo(34, 20); c.quadraticCurveTo(42, 14, 38, 8);
      c.lineWidth = 1.6; c.strokeStyle = a; c.stroke();
    },
    feather: function (c, a, b) {
      c.save(); c.translate(24, 24); c.rotate(-0.5);
      c.beginPath(); c.moveTo(0, -18);
      c.quadraticCurveTo(11, -2, 0, 18);
      c.quadraticCurveTo(-11, -2, 0, -18);
      c.fillStyle = a; c.fill();
      c.strokeStyle = shade(b, .8); c.lineWidth = 1; c.stroke();
      c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 20);
      c.strokeStyle = shade(b, .65); c.lineWidth = 1.3; c.stroke();
      for (var i = -12; i < 14; i += 3) {
        c.beginPath(); c.moveTo(0, i); c.lineTo(6 - Math.abs(i) * 0.18, i + 3);
        c.lineWidth = .8; c.stroke();
        c.beginPath(); c.moveTo(0, i); c.lineTo(-6 + Math.abs(i) * 0.18, i + 3); c.stroke();
      }
      c.restore();
    },
    shaft: function (c, a, b) {
      for (var i = 0; i < 3; i++) {
        var x = 15 + i * 9;
        rect(c, x, 9, 2.6, 30, a, shade(b, .7));
        poly(c, [[x + 1.3, 39], [x - 2.5, 44], [x + 5, 44]], b);
      }
    },
    robe: function (c, a, b) {
      poly(c, [[16, 10], [32, 10], [38, 18], [34, 20], [33, 40], [15, 40], [14, 20], [10, 18]], a, shade(b, .75));
      poly(c, [[21, 11], [27, 11], [26, 24], [22, 24]], shade(b, .9));
      rect(c, 14, 30, 20, 3, shade(b, .8));
    },
    hide: function (c, a, b) {
      poly(c, [[12, 12], [20, 9], [30, 11], [37, 16], [34, 26], [37, 36], [27, 39],
               [18, 37], [11, 30], [14, 21]], a, shade(b, .75));
      c.fillStyle = shade(a, .86);
      c.beginPath(); c.ellipse(24, 25, 7, 9, .3, 0, 6.2832); c.fill();
    },
    leather: function (c, a, b) {
      poly(c, [[13, 13], [24, 10], [35, 13], [35, 37], [24, 40], [13, 37]], a, shade(b, .75));
      c.strokeStyle = shade(b, .6); c.lineWidth = 1;
      for (var i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(14, 16 + i * 5); c.lineTo(17, 16 + i * 5);
        c.moveTo(31, 16 + i * 5); c.lineTo(34, 16 + i * 5);
        c.stroke();
      }
    },
    plant: function (c, a, b) {
      rect(c, 23, 24, 2.6, 17, '#5d7a3a');
      for (var i = 0; i < 4; i++) {
        var an = -1.2 + i * 0.8;
        c.save(); c.translate(24, 26); c.rotate(an);
        c.beginPath(); c.ellipse(0, -8, 4.5, 9, 0, 0, 6.2832);
        c.fillStyle = i % 2 ? a : shade(a, .85); c.fill();
        c.strokeStyle = shade(b, .8); c.lineWidth = .9; c.stroke();
        c.restore();
      }
      circ(c, 24, 15, 4.5, shade(a, 1.2), shade(b, .8));
    },
    net: function (c, a, b) {
      c.beginPath(); c.moveTo(12, 14); c.quadraticCurveTo(24, 44, 36, 14); c.closePath();
      c.fillStyle = 'rgba(0,0,0,.10)'; c.fill();
      c.strokeStyle = a; c.lineWidth = 1.8; c.stroke();
      c.lineWidth = 1;
      for (var i = 1; i < 5; i++) {
        c.beginPath(); c.moveTo(12 + i * 4.8, 14); c.lineTo(20 + i * 2, 36); c.stroke();
        c.beginPath(); c.moveTo(14 + i * 1.6, 14 + i * 5); c.lineTo(34 - i * 1.6, 14 + i * 5); c.stroke();
      }
      rect(c, 11, 10, 26, 3.5, b, '#241a11');
    },
    bowl: function (c, a, b) {
      c.beginPath(); c.moveTo(11, 22); c.quadraticCurveTo(24, 42, 37, 22); c.closePath();
      c.fillStyle = b; c.fill(); c.strokeStyle = '#241a11'; c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.ellipse(24, 22, 13, 4.2, 0, 0, 6.2832);
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .7); c.stroke();
    },
    pie: function (c, a, b) {
      c.beginPath(); c.ellipse(24, 28, 15, 9, 0, 0, 6.2832);
      c.fillStyle = b; c.fill(); c.strokeStyle = shade(b, .7); c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.ellipse(24, 24, 13, 7.5, 0, 0, 6.2832);
      c.fillStyle = a; c.fill();
      c.strokeStyle = shade(b, .75); c.lineWidth = 1;
      for (var i = 0; i < 4; i++) {
        c.beginPath(); c.moveTo(24, 24); c.lineTo(24 + Math.cos(i * 1.57) * 13, 24 + Math.sin(i * 1.57) * 7.5);
        c.stroke();
      }
    },
    cake: function (c, a, b) {
      rect(c, 12, 24, 24, 13, a, shade(b, .7));
      c.beginPath(); c.ellipse(24, 24, 12, 5, 0, 0, 6.2832);
      c.fillStyle = b; c.fill();
      c.fillStyle = shade(b, 1.1);
      for (var i = 0; i < 4; i++) circ(c, 17 + i * 5, 23 + (i % 2), 1.8, shade(b, 1.25));
      rect(c, 23, 10, 2, 8, '#efe6d0');
      circ(c, 24, 9, 2, '#e0a03c');
    },
    eye: function (c, a, b) {
      c.beginPath(); c.ellipse(24, 25, 15, 9, 0, 0, 6.2832);
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .7); c.lineWidth = 1.4; c.stroke();
      circ(c, 24, 25, 6.5, b, '#241a11');
      circ(c, 24, 25, 2.8, '#141410');
      circ(c, 21, 22, 2, 'rgba(255,255,255,.75)');
    },
    dust: function (c, a, b) {
      c.beginPath(); c.moveTo(10, 36); c.quadraticCurveTo(24, 26, 38, 36);
      c.lineTo(38, 39); c.lineTo(10, 39); c.closePath();
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .8); c.lineWidth = 1; c.stroke();
      for (var i = 0; i < 9; i++) {
        circ(c, 13 + (i * 7) % 24, 16 + ((i * 11) % 16), 1.3 + (i % 3) * .5, shade(a, 1.08));
      }
    },
    scale: function (c, a, b) {
      for (var r = 0; r < 3; r++) {
        for (var i = 0; i < 3 - (r % 2 ? 1 : 0); i++) {
          var x = 16 + i * 9 + (r % 2 ? 4.5 : 0), y = 16 + r * 8;
          c.beginPath(); c.arc(x, y, 5, Math.PI, 0); c.closePath();
          c.fillStyle = r === 1 ? shade(a, 1.1) : a; c.fill();
          c.strokeStyle = shade(b, .75); c.lineWidth = 1; c.stroke();
        }
      }
    },
    bone: function (c, a, b) { SHAPES.bones(c, a, b); },
    jug: function (c, a, b) {
      c.beginPath(); c.moveTo(17, 16); c.lineTo(31, 16);
      c.quadraticCurveTo(35, 28, 32, 39); c.lineTo(16, 39);
      c.quadraticCurveTo(13, 28, 17, 16); c.closePath();
      c.fillStyle = a; c.fill(); c.strokeStyle = shade(b, .7); c.lineWidth = 1.3; c.stroke();
      rect(c, 19, 11, 10, 5, shade(a, .9), shade(b, .7));
      c.beginPath(); c.arc(33, 26, 6, -1.1, 1.1);
      c.lineWidth = 2.4; c.strokeStyle = a; c.stroke();
    },
    quest: function (c, a, b) {
      poly(c, [[24, 7], [30, 19], [43, 21], [34, 30], [36, 43], [24, 37],
               [12, 43], [14, 30], [5, 21], [18, 19]], a, shade(b, .75));
      poly(c, [[24, 13], [28, 20], [24, 32], [20, 20]], shade(a, 1.25));
    },
    misc: function (c, a, b) {
      poly(c, [[14, 16], [34, 14], [36, 34], [16, 36]], a, shade(b, .8));
      circ(c, 25, 25, 5, shade(a, 1.2));
    }
  };

  var ALIAS = { platebody: 'body', platelegs: 'legs', kiteshield: 'shield',
    gauntlets: 'gloves', wand: 'staff', shortbow: 'bow', longbow: 'bow',
    meat: 'food', crop: 'food', fishcooked: 'fish', nails: 'nail',
    hammer: 'tool', needle: 'tool', chisel: 'tool', tinderbox: 'tool',
    bones: 'bones' };

  /* Traces a dark border round everything opaque. Early MMO item art was
     outlined for exactly this reason: without it a small icon dissolves into
     the panel behind it. */
  function outline(c, S) {
    var src = c.getImageData(0, 0, S, S);
    var a = src.data;
    var edge = c.createImageData(S, S);
    var e = edge.data;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var i = (y * S + x) * 4;
        if (a[i + 3] > 40) continue;
        var hit = false;
        for (var dy = -2; dy <= 2 && !hit; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
            if (a[(ny * S + nx) * 4 + 3] > 140) { hit = true; break; }
          }
        }
        if (hit) { e[i] = 20; e[i + 1] = 16; e[i + 2] = 10; e[i + 3] = 235; }
      }
    }
    var tmp = document.createElement('canvas');
    tmp.width = tmp.height = S;
    tmp.getContext('2d').putImageData(edge, 0, 0);
    c.globalCompositeOperation = 'destination-over';
    c.drawImage(tmp, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }

  function draw(spec) {
    var shape = (spec && spec[0]) || 'misc';
    shape = ALIAS[shape] || shape;
    var fn = SHAPES[shape] || SHAPES.misc;
    var cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, SIZE, SIZE);
    /* the shape functions are authored against a 48px box */
    var k = SIZE / 48;
    c.save();
    c.scale(k, k);
    c.lineJoin = 'round';
    try { fn(c, (spec && spec[1]) || '#b0a48a', (spec && spec[2]) || '#6b5c3f'); }
    catch (e) { SHAPES.misc(c, '#b0a48a', '#6b5c3f'); }
    c.restore();
    try { outline(c, SIZE); } catch (e2) {}
    return cv;
  }

  /* Returns a cached <canvas> for this item; callers clone by drawing it. */
  function get(item) {
    if (!item) return null;
    var key = (item.icon || ['misc']).join('|');
    if (!cache[key]) cache[key] = draw(item.icon);
    return cache[key];
  }
  /* Convenience: a fresh canvas element sized for a slot. */
  function node(item, px) {
    var src = get(item);
    var cv = document.createElement('canvas');
    cv.width = cv.height = px || SIZE;
    if (src) cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  function dataURL(item) {
    var src = get(item);
    return src ? src.toDataURL() : '';
  }

  g.RFIcons = { get: get, node: node, dataURL: dataURL, shade: shade, SIZE: SIZE };
})(window);
