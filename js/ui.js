/* Emberfall - interface.
   Owns every pixel of the DOM: the tabbed side panel, the chat box, the bank
   and shop windows, the dialogue box and the minimap. The 3D side of the game
   never touches the DOM directly; it calls in here. */
(function (g) {
  'use strict';

  var D = {};            // data: items, quests, npcs, world, spells, prayers, recipes
  var P = null;          // current player snapshot from the server
  var hooks = {};        // callbacks back into game.js
  var el = {};
  var activeTab = 'inventory';
  var chatFilter = 'all';
  var chatLines = [];
  var bankQty = 1, shopQty = 1, makeQty = 1;
  var bankSearch = '';
  var currentShop = null;
  var currentMake = null;
  var currentDialogue = null;
  var tradeState = null;
  var useItemSlot = -1;   // "use X on ..." selection
  var friends = [];
  var onlineList = [];
  var mmZoom = 1.6;

  var TABS = [
    ['combat', 'Combat'], ['stats', 'Stats'], ['quests', 'Quests'],
    ['inventory', 'Inv'], ['equipment', 'Worn'], ['prayer', 'Prayer'],
    ['magic', 'Magic'], ['friends', 'Friends'], ['players', 'Players'], ['options', 'Options']
  ];
  var SKILL_ORDER = [
    'attack', 'hitpoints', 'mining',
    'strength', 'agility', 'smithing',
    'defence', 'herblore', 'fishing',
    'ranged', 'thieving', 'cooking',
    'prayer', 'crafting', 'firemaking',
    'magic', 'fletching', 'woodcutting',
    'runecraft', 'slayer', 'farming',
    'construction', 'hunter'
  ];
  var SKILL_COL = {
    attack: '#9b2f2f', strength: '#2f6b9b', defence: '#6b6b9b', hitpoints: '#9b4b2f',
    ranged: '#4b8b2f', prayer: '#b0a060', magic: '#2f5b9b', mining: '#6b5b8b',
    smithing: '#8b8b8b', fishing: '#3f8b9b', cooking: '#8b3f6b', woodcutting: '#5b7b3f',
    firemaking: '#c4652f', crafting: '#8b6b3f', fletching: '#6b8b5b', runecraft: '#9b8b3f',
    slayer: '#5b2f2f', farming: '#4b8b4b', construction: '#7b6b4b', hunter: '#6b5b3f',
    agility: '#3f5b8b', herblore: '#3f8b4b', thieving: '#6b3f6b'
  };
  var EQ_SLOTS = ['head', 'cape', 'neck', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring', 'ammo'];
  var EQ_LABEL = { head: 'Head', cape: 'Cape', neck: 'Neck', weapon: 'Weapon', body: 'Body',
    shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring', ammo: 'Ammo' };

  function $(id) { return document.getElementById(id); }
  /* Audio is optional: a browser with it blocked must not break the interface. */
  function sfx(name) { try { if (g.RFAudio) g.RFAudio.play(name); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function item(id) { return D.items[id] || null; }
  function comma(n) { return (n | 0).toLocaleString('en-GB'); }

  /* ===================================================== xp / level maths */
  var XPT = null;
  function xpTable() {
    if (XPT) return XPT;
    XPT = [0, 0];
    var acc = 0;
    for (var l = 1; l < 99; l++) { acc += Math.floor(l + 300 * Math.pow(2, l / 7)); XPT[l + 1] = Math.floor(acc / 4); }
    return XPT;
  }
  function levelForXp(x) {
    var t = xpTable();
    for (var l = 99; l >= 1; l--) if (x >= t[l]) return l;
    return 1;
  }
  function xpForLevel(l) { return xpTable()[Math.max(1, Math.min(99, l))] || 0; }
  function skillLevel(s) { return P ? levelForXp(P.skills[s] ? P.skills[s].x : 0) : 1; }
  function skillXp(s) { return P && P.skills[s] ? P.skills[s].x : 0; }

  /* ================================================================ init */
  function init(data, callbacks) {
    D = data; hooks = callbacks || {};
    el.panel = $('panelBody');
    el.tabRow = $('tabRow');
    el.chatLog = $('chatLog');
    el.chatInput = $('chatInput');
    el.hover = $('hoverText');
    el.ctx = $('ctxMenu');
    el.toast = $('toast');
    el.splat = $('splatLayer');
    el.minimap = $('minimap');
    try { friends = JSON.parse(localStorage.getItem('rf2friends') || '[]'); } catch (e) { friends = []; }

    buildTabs();
    wireChat();
    wireWindows();
    document.addEventListener('click', function (e) {
      if (!el.ctx.contains(e.target)) hideCtx();
    });
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest('#screen-game')) e.preventDefault();
    });
    window.addEventListener('resize', function () { positionWindows(); });
  }

  function buildTabs() {
    el.tabRow.innerHTML = '';
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab-btn' + (t[0] === activeTab ? ' active' : '');
      b.textContent = t[1];
      b.dataset.tab = t[0];
      b.onclick = function () { setTab(t[0]); sfx('click'); };
      el.tabRow.appendChild(b);
    });
  }
  function setTab(name) {
    activeTab = name;
    Array.prototype.forEach.call(el.tabRow.children, function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    render();
  }

  /* ============================================================== render */
  function setPlayer(p) {
    if (!p) return;
    var before = P;
    P = p;
    if (before) {
      // level-up detection is done server-side, but keep local levels fresh
    }
    render();
    if (currentShop) renderShop();
    if ($('bankWindow').style.display === 'block') renderBank();
    if (currentMake) renderMake();
    if (tradeState) renderTrade();
  }
  function player() { return P; }

  function render() {
    if (!P) return;
    var fn = {
      combat: renderCombat, stats: renderStats, quests: renderQuests,
      inventory: renderInventory, equipment: renderEquipment, prayer: renderPrayer,
      magic: renderMagic, friends: renderFriends, players: renderPlayers, options: renderOptions
    }[activeTab];
    if (fn) fn();
  }

  /* --------------------------------------------------------- inventory */
  function invSlotNode(slot, idx, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'inv-slot';
    d.dataset.slot = idx;
    if (slot) {
      var it = item(slot.id);
      if (it) {
        d.appendChild(g.RFIcons.node(it, 40));
        if (slot.n > 1) {
          var q = document.createElement('span');
          q.className = 'qty';
          q.textContent = slot.n >= 100000 ? Math.floor(slot.n / 1000) + 'k' : comma(slot.n);
          d.appendChild(q);
        }
        d.title = it.name;
      }
    }
    if (useItemSlot === idx) d.classList.add('drag');
    if (opts.onClick) d.onclick = function () { opts.onClick(idx, slot); };
    if (opts.onRight) d.oncontextmenu = function (e) { e.preventDefault(); opts.onRight(e, idx, slot); };
    return d;
  }

  function renderInventory() {
    var free = P.inv.filter(function (s) { return !s; }).length;
    var h = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Pack (' + (28 - free) + '/28)';
    h.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'inv-grid';
    P.inv.forEach(function (s, i) {
      grid.appendChild(invSlotNode(s, i, {
        onClick: function () { invLeftClick(i, s); },
        onRight: function (e) { invMenu(e, i, s); }
      }));
    });
    h.appendChild(grid);
    var coins = document.createElement('div');
    coins.className = 'stat-total';
    coins.textContent = comma(countItemByName('Coins')) + ' coins';
    h.appendChild(coins);
    el.panel.innerHTML = '';
    el.panel.appendChild(h);
  }

  function countItemByName(name) {
    var id = idByName(name);
    if (!id) return 0;
    var n = 0;
    P.inv.forEach(function (s) { if (s && s.id === id) n += s.n; });
    return n;
  }
  var nameIdx = null;
  function idByName(name) {
    if (!nameIdx) {
      nameIdx = {};
      for (var k in D.items) nameIdx[D.items[k].name.toLowerCase()] = +k;
    }
    return nameIdx[String(name).toLowerCase()] || 0;
  }
  function hasItemNamed(name) { return countItemByName(name) > 0; }

  function invLeftClick(i, s) {
    if (!s) { useItemSlot = -1; render(); return; }
    var it = item(s.id);
    if (!it) return;
    if (useItemSlot >= 0 && useItemSlot !== i) {
      var a = useItemSlot; useItemSlot = -1;
      hooks.useOnItem && hooks.useOnItem(a, i);
      render();
      return;
    }
    if (it.eat) return doAct('eat', { slot: i });
    if (it.drink) return doAct('drink', { slot: i });
    if (it.bury) return doAct('bury', { slot: i });
    if (it.slot) return doAct('equip', { slot: i });
    // logs default to lighting a fire if you carry a tinderbox
    if ((it.tags || []).indexOf('log') >= 0 && hasItemNamed('Tinderbox')) return doAct('fire', { slot: i });
    examine(it);
  }

  function invMenu(e, i, s) {
    if (!s) return;
    var it = item(s.id);
    if (!it) return;
    var opts = [];
    if (it.eat) opts.push(['Eat', function () { doAct('eat', { slot: i }); }]);
    if (it.drink) opts.push(['Drink', function () { doAct('drink', { slot: i }); }]);
    if (it.bury) opts.push(['Bury', function () { doAct('bury', { slot: i }); }]);
    if (it.slot) opts.push([it.slot === 'weapon' ? 'Wield' : 'Wear', function () { doAct('equip', { slot: i }); }]);
    if ((it.tags || []).indexOf('log') >= 0) {
      opts.push(['Light', function () { doAct('fire', { slot: i }); }]);
      opts.push(['Fletch', function () { openMake('fletch', 'knife', it.id); }]);
      opts.push(['Build with', function () { doAct('construct', {}); }]);
    }
    if ((it.tags || []).indexOf('raw') >= 0) opts.push(['Cook', function () { hooks.cook && hooks.cook(i); }]);
    if (/^Grimy /.test(it.name)) opts.push(['Clean', function () { makeByOutputName(it.name.replace('Grimy ', '')); }]);
    if (/^Uncut /.test(it.name)) opts.push(['Cut', function () { makeByOutputName('Cut ' + it.name.replace('Uncut ', '')); }]);
    opts.push(['Use', function () { useItemSlot = i; toast('Use ' + it.name + ' on...'); render(); }]);
    opts.push(['Drop', function () { doAct('drop', { slot: i }); }]);
    opts.push(['Examine', function () { examine(it); }]);
    showCtx(e.clientX, e.clientY, it.name, opts);
  }

  function makeByOutputName(name) {
    var books = ['herb', 'craft', 'smith', 'smelt', 'fletch'];
    for (var b = 0; b < books.length; b++) {
      var list = (D.recipes && D.recipes[books[b]]) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].name.toLowerCase() === name.toLowerCase()) {
          return doAct('make', { book: books[b], i: i, n: 1 });
        }
      }
    }
    toast('You do not know how to make that.');
  }

  function examine(it) {
    chat(it.name + ': ' + (it.desc || 'An ordinary thing.') +
      (it.value ? ' (worth ' + comma(it.value) + ' coins)' : ''), 'c-game');
  }

  /* --------------------------------------------------------- equipment */
  function renderEquipment() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Worn Equipment';
    wrap.appendChild(head);

    var layout = [
      [null, 'head', null],
      ['cape', 'neck', 'ammo'],
      [null, 'weapon', null],
      ['shield', 'body', 'ring'],
      [null, 'legs', null],
      ['hands', 'feet', null]
    ];
    var grid = document.createElement('div');
    grid.className = 'eq-layout';
    layout.forEach(function (row) {
      row.forEach(function (slot) {
        var d = document.createElement('div');
        d.className = 'eq-slot';
        if (!slot) { d.style.visibility = 'hidden'; grid.appendChild(d); return; }
        var id = P.eq[slot];
        if (id) {
          var it = item(id);
          if (it) {
            d.appendChild(g.RFIcons.node(it, 38));
            d.title = it.name;
            if (slot === 'ammo' && P.eq.ammoN) {
              var q = document.createElement('span');
              q.className = 'qty'; q.textContent = comma(P.eq.ammoN);
              d.appendChild(q);
            }
          }
        } else {
          d.textContent = EQ_LABEL[slot];
        }
        d.onclick = function () { if (P.eq[slot]) doAct('unequip', { eslot: slot }); };
        d.oncontextmenu = function (e) {
          e.preventDefault();
          if (!P.eq[slot]) return;
          showCtx(e.clientX, e.clientY, item(P.eq[slot]).name, [
            ['Remove', function () { doAct('unequip', { eslot: slot }); }],
            ['Examine', function () { examine(item(P.eq[slot])); }]
          ]);
        };
        grid.appendChild(d);
      });
    });
    wrap.appendChild(grid);

    var b = bonuses();
    var box = document.createElement('div');
    box.className = 'list-row';
    box.style.cursor = 'default';
    box.innerHTML = '<b>Attack bonus</b> ' + sgn(b.a) +
      '<span class="sub">Strength ' + sgn(b.s) + ' &nbsp; Defence ' + sgn(b.d) + '</span>' +
      '<span class="sub">Ranged ' + sgn(b.r) + ' &nbsp; Magic ' + sgn(b.m) + ' &nbsp; Prayer ' + sgn(b.p) + '</span>';
    wrap.appendChild(box);
    var cl = document.createElement('div');
    cl.className = 'stat-total';
    cl.textContent = 'Combat level ' + P.cl;
    wrap.appendChild(cl);

    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }
  function sgn(n) { return (n >= 0 ? '+' : '') + n; }
  function bonuses() {
    var b = { a: 0, s: 0, d: 0, r: 0, m: 0, p: 0 };
    for (var k in P.eq) {
      if (k === 'ammoN') continue;
      var it = item(P.eq[k]);
      if (!it || !it.bonus) continue;
      for (var x in b) b[x] += (it.bonus[x] || 0);
    }
    return b;
  }

  /* ------------------------------------------------------------- stats */
  function renderStats() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Skills';
    wrap.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'stat-grid';
    var total = 0;
    SKILL_ORDER.forEach(function (s) {
      var lv = skillLevel(s);
      total += lv;
      var c = document.createElement('div');
      c.className = 'stat-cell';
      c.innerHTML = '<span class="stat-dot" style="background:' + SKILL_COL[s] + '"></span>' +
        '<span class="stat-name">' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>' +
        '<span class="stat-lvl">' + lv + '</span>';
      c.onclick = function () {
        var xp = skillXp(s), next = xpForLevel(Math.min(99, lv + 1));
        chat(s.charAt(0).toUpperCase() + s.slice(1) + ': level ' + lv + ', ' + comma(xp) + ' XP' +
          (lv < 99 ? ' &mdash; ' + comma(Math.max(0, next - xp)) + ' XP to level ' + (lv + 1) : ' &mdash; mastered'), 'c-game');
      };
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
    var t = document.createElement('div');
    t.className = 'stat-total';
    t.textContent = 'Total level ' + total + ' \u00b7 ' + P.qp + ' quest points';
    wrap.appendChild(t);
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }

  /* ------------------------------------------------------------ combat */
  function renderCombat() {
    var w = item(P.eq.weapon);
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = w ? w.name : 'Unarmed';
    wrap.appendChild(head);

    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<i style="width:' + Math.round(P.hp / Math.max(1, P.maxhp) * 100) + '%;background:#4ec45a"></i>' +
      '<span>Health ' + P.hp + ' / ' + P.maxhp + '</span>';
    wrap.appendChild(bar);
    var pb = document.createElement('div');
    pb.className = 'bar';
    pb.innerHTML = '<i style="width:' + Math.round(P.pray / Math.max(1, P.maxpray) * 100) + '%;background:#6fa8d0"></i>' +
      '<span>Prayer ' + P.pray + ' / ' + P.maxpray + '</span>';
    wrap.appendChild(pb);

    var styles = [
      ['accurate', 'Accurate', 'Attack XP'],
      ['aggressive', 'Aggressive', 'Strength XP'],
      ['defensive', 'Defensive', 'Defence XP'],
      ['controlled', 'Controlled', 'Shared XP']
    ];
    var sh = document.createElement('div');
    sh.className = 'panel-h';
    sh.textContent = 'Attack style';
    wrap.appendChild(sh);
    styles.forEach(function (s) {
      var r = document.createElement('div');
      r.className = 'list-row' + (P.style === s[0] ? ' q-active' : '');
      r.innerHTML = '<b>' + s[1] + '</b><span class="sub">' + s[2] + '</span>';
      r.onclick = function () { doAct('style', { style: s[0], autocast: P.autocast || '' }); };
      wrap.appendChild(r);
    });

    if (P.autocast) {
      var sp = D.spells.filter(function (x) { return x.id === P.autocast; })[0];
      var ac = document.createElement('div');
      ac.className = 'list-row q-active';
      ac.innerHTML = '<b>Autocast: ' + (sp ? sp.name : P.autocast) + '</b><span class="sub">Click to clear</span>';
      ac.onclick = function () { doAct('style', { style: P.style, autocast: '' }); };
      wrap.appendChild(ac);
    }
    if (P.slayer && P.slayer.left > 0) {
      var sl = document.createElement('div');
      sl.className = 'list-row';
      sl.innerHTML = '<b>Slayer task</b><span class="sub">' + P.slayer.left + ' x ' + esc(P.slayer.name || P.slayer.npc) + ' remaining</span>';
      wrap.appendChild(sl);
    }
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }

  /* ------------------------------------------------------------ quests */
  function renderQuests() {
    var wrap = document.createElement('div');
    var done = 0, active = 0;
    D.quests.forEach(function (q) {
      var st = P.quests[q.id];
      if (st === 'done') done++;
      else if (st !== undefined && st !== null) active++;
    });
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Quest Journal \u00b7 ' + P.qp + ' QP';
    wrap.appendChild(head);
    var sum = document.createElement('div');
    sum.className = 'stat-total';
    sum.textContent = done + ' complete \u00b7 ' + active + ' in progress \u00b7 ' + (D.quests.length - done - active) + ' to find';
    wrap.appendChild(sum);

    var order = D.quests.slice().sort(function (a, b) {
      var sa = P.quests[a.id], sb = P.quests[b.id];
      var ra = sa === 'done' ? 2 : (sa != null ? 0 : 1);
      var rb = sb === 'done' ? 2 : (sb != null ? 0 : 1);
      return ra - rb;
    });
    order.forEach(function (q) {
      var st = P.quests[q.id];
      var row = document.createElement('div');
      var cls = st === 'done' ? 'q-done' : (st != null ? 'q-active' : 'q-none');
      row.className = 'list-row ' + cls;
      var note;
      if (st === 'done') note = 'Completed \u00b7 ' + q.qp + ' QP';
      else if (st != null) {
        var stage = q.stages[st];
        note = 'Step ' + (st + 1) + '/' + q.stages.length + ': ' + ((stage && stage.j) || 'Press on.');
      } else {
        var startNpc = D.npcs[q.start];
        note = q.desc + ' Ask ' + ((startNpc && startNpc.name) || 'someone') + '.';
      }
      row.innerHTML = '<b>' + esc(q.name) + '</b> <span style="opacity:.7">(' + q.diff + ')</span>' +
        '<span class="sub">' + esc(note) + '</span>';
      wrap.appendChild(row);
    });
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }

  /* ------------------------------------------------------------ prayer */
  function renderPrayer() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Prayer ' + P.pray + '/' + P.maxpray;
    wrap.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'icon-grid';
    var lvl = skillLevel('prayer');
    D.prayers.forEach(function (pr) {
      var c = document.createElement('div');
      var on = (P.prayers || []).indexOf(pr.id) >= 0;
      c.className = 'icon-cell' + (on ? ' on' : '') + (lvl < pr.lvl ? ' locked' : '');
      c.innerHTML = '<span class="gem" style="background:' + prayerColour(pr) + '"></span>' + esc(pr.name);
      c.title = pr.name + ' (level ' + pr.lvl + ')';
      c.onclick = function () {
        if (lvl < pr.lvl) { toast('You need Prayer level ' + pr.lvl + '.'); return; }
        doAct('prayer', { id: pr.id });
      };
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
    var alt = document.createElement('div');
    alt.className = 'list-row';
    alt.innerHTML = '<b>Recharge</b><span class="sub">Pray at an altar to restore your points.</span>';
    wrap.appendChild(alt);
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }
  function prayerColour(pr) {
    if (pr.eff && pr.eff.protect) return '#c9a23c';
    if (pr.eff && pr.eff.strength) return '#c4453a';
    if (pr.eff && pr.eff.defence) return '#6b6b9b';
    if (pr.eff && pr.eff.attack) return '#9b2f2f';
    return '#8fa8c4';
  }

  /* ------------------------------------------------------------- magic */
  function renderMagic() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Spellbook \u00b7 Magic ' + skillLevel('magic');
    wrap.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'icon-grid';
    var lvl = skillLevel('magic');

    /* Home Teleport sits first in the book, as a proper spell rather than a
       button: its own rune-free icon, tooltip and cast. */
    var homeCell = document.createElement('div');
    homeCell.className = 'icon-cell spell-home';
    homeCell.innerHTML = '<span class="gem home-gem"></span>Home';
    homeCell.title = 'Home Teleport\nLevel 1 \u00b7 no runes required\n'
      + 'Returns you to the standing stone at Oakheart.\n'
      + 'Three minute cooldown. Cannot be cast while under attack.';
    homeCell.onclick = function () {
      doAct('home', {}).then(function (r) {
        if (r && r.ok && hooks.teleportEffect) hooks.teleportEffect();
      });
    };
    grid.appendChild(homeCell);

    D.spells.forEach(function (sp) {
      var c = document.createElement('div');
      c.className = 'icon-cell' + (lvl < sp.lvl ? ' locked' : '') + (P.autocast === sp.id ? ' on' : '');
      c.innerHTML = '<span class="gem" style="background:' + elColour(sp.el) + '"></span>' + esc(sp.name);
      var runeTxt = (sp.runes || []).map(function (r) {
        var ri = item(r.item);
        return r.n + ' ' + (ri ? ri.name : '?');
      }).join(', ');
      c.title = sp.name + ' (level ' + sp.lvl + ')\n' + runeTxt;
      c.onclick = function () {
        if (lvl < sp.lvl) { toast('You need Magic level ' + sp.lvl + '.'); return; }
        if (sp.alch) { useItemSlot = -1; toast('Choose an item to transmute.'); hooks.alchemy && hooks.alchemy(sp.id); return; }
        if (sp.tele) { doAct('cast', { spell: sp.id }); return; }
        doAct('style', { style: P.style, autocast: sp.id });
        toast('Autocasting ' + sp.name + '.');
      };
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
    var hint = document.createElement('div');
    hint.className = 'list-row';
    hint.style.cursor = 'default';
    hint.innerHTML = '<span class="sub">Wield a staff and pick a combat spell to autocast it. ' +
      'Alchemy asks you for an item; teleports fire straight away.</span>';
    wrap.appendChild(hint);
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }
  function elColour(e) {
    return { air: '#cfe4ef', water: '#3f7fd0', earth: '#7a5a34', fire: '#d2582c' }[e] || '#9b8ad0';
  }

  /* ----------------------------------------------------------- friends */
  function renderFriends() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Friends';
    wrap.appendChild(head);

    var add = document.createElement('div');
    add.className = 'list-row';
    add.innerHTML = '<b>+ Add a friend</b><span class="sub">Click, then type their name.</span>';
    add.onclick = function () {
      promptBox('Add friend', 'Name', function (v) {
        v = (v || '').trim();
        if (!v) return;
        if (friends.indexOf(v) < 0) friends.push(v);
        try { localStorage.setItem('rf2friends', JSON.stringify(friends)); } catch (e) {}
        render();
      });
    };
    wrap.appendChild(add);

    if (!friends.length) {
      var none = document.createElement('div');
      none.className = 'list-row q-none';
      none.style.cursor = 'default';
      none.innerHTML = '<span class="sub">Nobody yet.</span>';
      wrap.appendChild(none);
    }
    friends.forEach(function (f, i) {
      var online = onlineList.some(function (o) { return o.n.toLowerCase() === f.toLowerCase(); });
      var r = document.createElement('div');
      r.className = 'list-row ' + (online ? 'q-done' : 'q-none');
      r.innerHTML = '<b>' + esc(f) + '</b><span class="sub">' + (online ? 'In the realm' : 'Elsewhere') + '</span>';
      r.onclick = function () {
        el.chatInput.value = '/tell ' + f + ' ';
        el.chatInput.focus();
      };
      r.oncontextmenu = function (e) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, f, [
          ['Message', function () { el.chatInput.value = '/tell ' + f + ' '; el.chatInput.focus(); }],
          ['Remove', function () {
            friends.splice(i, 1);
            try { localStorage.setItem('rf2friends', JSON.stringify(friends)); } catch (e) {}
            render();
          }]
        ]);
      };
      wrap.appendChild(r);
    });
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }

  /* ----------------------------------------------------------- players */
  function setOnline(list) { onlineList = list || []; if (activeTab === 'players' || activeTab === 'friends') render(); }
  function renderPlayers() {
    var wrap = document.createElement('div');
    var head = document.createElement('div');
    head.className = 'panel-h';
    head.textContent = 'Players nearby (' + onlineList.length + ')';
    wrap.appendChild(head);
    if (!onlineList.length) {
      var none = document.createElement('div');
      none.className = 'list-row q-none';
      none.style.cursor = 'default';
      none.innerHTML = '<span class="sub">Nobody else is close by. Share the link with a friend and you will see each other move in real time.</span>';
      wrap.appendChild(none);
    }
    onlineList.forEach(function (o) {
      var r = document.createElement('div');
      r.className = 'list-row';
      r.innerHTML = '<b>' + esc(o.n) + '</b><span class="sub">Combat level ' + o.cl + ' \u00b7 ' + Math.round(o.dist) + ' paces away</span>';
      r.onclick = function (e) { playerMenu(e, o); };
      r.oncontextmenu = function (e) { e.preventDefault(); playerMenu(e, o); };
      wrap.appendChild(r);
    });
    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }
  function playerMenu(e, o) {
    showCtx(e.clientX || 200, e.clientY || 200, o.n, [
      ['Follow', function () { hooks.follow && hooks.follow(o.id); }],
      ['Trade with', function () { doAct('trade_offer', { to: o.id }); }],
      ['Message', function () { el.chatInput.value = '/tell ' + o.n + ' '; el.chatInput.focus(); }],
      ['Add friend', function () {
        if (friends.indexOf(o.n) < 0) friends.push(o.n);
        try { localStorage.setItem('rf2friends', JSON.stringify(friends)); } catch (er) {}
        toast(o.n + ' added to friends.');
      }],
      ['Examine', function () { chat(o.n + ' is a level ' + o.cl + ' adventurer.', 'c-game'); }]
    ]);
  }

  /* ----------------------------------------------------------- options */
  function renderOptions() {
    var s = P.settings || {};
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="panel-h">Sound</div>';
    [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'], ['amb', 'Ambience']].forEach(function (k) {
      var line = document.createElement('div');
      line.className = 'opt-line';
      var val = s[k[0]] === undefined ? 60 : s[k[0]];
      line.innerHTML = '<label>' + k[1] + '</label>';
      var r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 100; r.value = val;
      var out = document.createElement('span');
      out.style.width = '30px'; out.style.fontSize = '11px';
      out.textContent = val;
      r.oninput = function () {
        out.textContent = r.value;
        s[k[0]] = +r.value;
        g.RFAudio && g.RFAudio.setVolumes(s);
      };
      r.onchange = function () { g.RFNet.saveSettings(s); };
      line.appendChild(r); line.appendChild(out);
      wrap.appendChild(line);
    });

    wrap.appendChild(divider('Display'));
    var draw = document.createElement('div');
    draw.className = 'list-row';
    draw.innerHTML = '<b>Detail: ' + (s.draw ? 'High' : 'Low') + '</b><span class="sub">Lower this if the world runs rough.</span>';
    draw.onclick = function () {
      s.draw = s.draw ? 0 : 1;
      g.RFNet.saveSettings(s);
      hooks.setDetail && hooks.setDetail(s.draw);
      render();
    };
    wrap.appendChild(draw);

    var sh = document.createElement('div');
    sh.className = 'list-row';
    sh.innerHTML = '<b>Shadows: ' + (s.shadows ? 'On' : 'Off') + '</b><span class="sub">Soft shadows under characters and trees.</span>';
    sh.onclick = function () {
      s.shadows = s.shadows ? 0 : 1;
      g.RFNet.saveSettings(s);
      hooks.setShadows && hooks.setShadows(s.shadows);
      render();
    };
    wrap.appendChild(sh);

    wrap.appendChild(divider('Account'));
    var bld = document.createElement('div');
    bld.className = 'list-row';
    bld.style.cursor = 'default';
    bld.innerHTML = '<b>Version</b><span class="sub">world build ' +
      esc((D.world && D.world.build) || 'unknown') + '</span>' +
      '<span class="sub">If this does not match the server after an upload, ' +
      'your browser is serving a cached copy - hard refresh with Ctrl+F5.</span>';
    wrap.appendChild(bld);

    var info = document.createElement('div');
    info.className = 'list-row';
    info.style.cursor = 'default';
    info.innerHTML = '<b>' + esc(P.name) + '</b><span class="sub">Combat level ' + P.cl +
      ' \u00b7 ' + P.qp + ' quest points</span><span class="sub">Ping ' + g.RFNet.ping + 'ms, syncing every ' + g.RFNet.rate + 'ms</span>';
    wrap.appendChild(info);

    var save = document.createElement('div');
    save.className = 'list-row';
    save.innerHTML = '<b>Save now</b><span class="sub">Your progress also saves automatically.</span>';
    save.onclick = function () { g.RFNet.saveSettings(s).then(function () { toast('Progress saved.'); }); };
    wrap.appendChild(save);

    var out = document.createElement('div');
    out.className = 'list-row';
    out.innerHTML = '<b>Log out</b>';
    out.onclick = function () { hooks.logout && hooks.logout(); };
    wrap.appendChild(out);

    el.panel.innerHTML = '';
    el.panel.appendChild(wrap);
  }
  function divider(t) {
    var d = document.createElement('div');
    d.className = 'panel-h';
    d.textContent = t;
    return d;
  }

  /* ================================================================ chat */
  function wireChat() {
    Array.prototype.forEach.call(document.querySelectorAll('.chat-tab'), function (b) {
      b.onclick = function () {
        chatFilter = b.dataset.ch;
        Array.prototype.forEach.call(document.querySelectorAll('.chat-tab'), function (x) {
          x.classList.toggle('active', x === b);
        });
        redrawChat();
      };
    });
    el.chatInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      var v = el.chatInput.value.trim();
      el.chatInput.value = '';
      if (!v) { el.chatInput.blur(); return; }
      var m = v.match(/^\/(?:tell|pm|w)\s+(\S+)\s+([\s\S]+)$/i);
      if (m) {
        g.RFNet.say(m[2], m[1]).then(function (r) {
          if (!r.ok) chat(r.error, 'c-warn');
          else chat('To ' + m[1] + ': ' + m[2], 'c-pm', 'private');
        });
        return;
      }
      g.RFNet.say(v).then(function (r) { if (!r.ok) chat(r.error, 'c-warn'); });
    });
  }

  function chat(text, cls, channel) {
    chatLines.push({ t: text, c: cls || 'c-game', ch: channel || 'game' });
    if (chatLines.length > 220) chatLines.shift();
    appendChat(chatLines[chatLines.length - 1]);
  }
  function appendChat(line) {
    if (chatFilter !== 'all' && line.ch !== chatFilter) return;
    var d = document.createElement('div');
    d.className = line.c;
    d.innerHTML = line.t;
    el.chatLog.appendChild(d);
    while (el.chatLog.children.length > 220) el.chatLog.removeChild(el.chatLog.firstChild);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }
  function redrawChat() {
    el.chatLog.innerHTML = '';
    chatLines.forEach(appendChat);
  }
  function incomingChat(c, myName) {
    if (c.c === 'pm') {
      var mine = c.n === myName;
      chat((mine ? 'To ' + esc(c.ton) : 'From ' + esc(c.n)) + ': ' + esc(c.m), 'c-pm', 'private');
    } else {
      chat('<b>' + esc(c.n) + ':</b> ' + esc(c.m), 'c-pub', 'public');
    }
  }

  /* ============================================================== toast */
  function toast(msg) {
    var d = document.createElement('div');
    d.className = 'toast-msg';
    d.textContent = msg;
    el.toast.appendChild(d);
    setTimeout(function () { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; }, 1700);
    setTimeout(function () { d.remove(); }, 2200);
  }

  function levelUp(list) {
    if (!list || !list.length) return;
    var box = $('levelUp');
    var s = list[0];
    box.innerHTML = '<h3>Level up!</h3><p>Your <b>' + esc(s.skill) + '</b> is now level <b>' + s.level + '</b>.</p>';
    box.style.display = 'block';
    sfx('levelup');
    list.forEach(function (x) {
      chat('<b>Level up!</b> Your ' + x.skill + ' is now ' + x.level + '.', 'c-good');
    });
    clearTimeout(levelUp._t);
    levelUp._t = setTimeout(function () { box.style.display = 'none'; }, 3400);
  }

  function xpDrop(skill, amount) {
    var wrap = $('xpDrop');
    if (!wrap) return;
    var d = document.createElement('div');
    var dot = SKILL_COL[skill.toLowerCase()] || '#e0c23c';
    d.innerHTML = '<i style="background:' + dot + '"></i>+' + Math.round(amount) + ' ' + skill;
    wrap.appendChild(d);
    while (wrap.children.length > 6) wrap.removeChild(wrap.firstChild);
    setTimeout(function () { d.remove(); }, 2600);
  }

  /* ========================================================= hit splats */
  function splat(sx, sy, value, type) {
    var d = document.createElement('div');
    d.className = 'splat ' + (type || (value > 0 ? 'hit' : 'miss'));
    d.textContent = value;
    d.style.left = sx + 'px';
    d.style.top = sy + 'px';
    el.splat.appendChild(d);
    var start = performance.now();
    (function rise() {
      var f = (performance.now() - start) / 900;
      if (f >= 1) { d.remove(); return; }
      d.style.top = (sy - f * 26) + 'px';
      d.style.opacity = String(1 - f * f);
      requestAnimationFrame(rise);
    })();
  }

  /* ======================================================= context menu */
  function showCtx(x, y, title, options) {
    el.ctx.innerHTML = '';
    if (title) {
      var h = document.createElement('div');
      h.className = 'ctx-head';
      h.textContent = title;
      el.ctx.appendChild(h);
    }
    options.forEach(function (o) {
      var d = document.createElement('div');
      d.className = 'ctx-item';
      d.textContent = o[0];
      d.onclick = function (e) { e.stopPropagation(); hideCtx(); o[1](); };
      el.ctx.appendChild(d);
    });
    el.ctx.style.display = 'block';
    var w = el.ctx.offsetWidth, h2 = el.ctx.offsetHeight;
    el.ctx.style.left = Math.min(x, window.innerWidth - w - 6) + 'px';
    el.ctx.style.top = Math.min(y, window.innerHeight - h2 - 6) + 'px';
  }
  function hideCtx() { el.ctx.style.display = 'none'; }

  /* ============================================================ prompts */
  function promptBox(title, label, cb) {
    var v = window.prompt(title + '\n' + label);
    if (v !== null) cb(v);
  }

  /* ============================================================ windows */
  function wireWindows() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { closeWindow(b.dataset.close); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bq]'), function (b) {
      b.onclick = function () {
        bankQty = +b.dataset.bq;
        Array.prototype.forEach.call(document.querySelectorAll('[data-bq]'), function (x) {
          x.classList.toggle('on', x === b);
        });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sq]'), function (b) {
      b.onclick = function () {
        shopQty = +b.dataset.sq;
        Array.prototype.forEach.call(document.querySelectorAll('[data-sq]'), function (x) {
          x.classList.toggle('on', x === b);
        });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-mq]'), function (b) {
      b.onclick = function () {
        makeQty = +b.dataset.mq;
        Array.prototype.forEach.call(document.querySelectorAll('[data-mq]'), function (x) {
          x.classList.toggle('on', x === b);
        });
      };
    });
    $('bankSearch').oninput = function () { bankSearch = this.value.toLowerCase(); renderBank(); };
    $('btnDepositAll').onclick = function () { doAct('bank', { sub: 'depositAll' }); };
    $('btnTradeAccept').onclick = function () { doAct('trade_accept', {}); };
    $('btnTradeCancel').onclick = function () { doAct('trade_cancel', {}); closeWindow('tradeWindow'); };
    makeDraggable($('bankWindow'));
    makeDraggable($('shopWindow'));
    makeDraggable($('makeWindow'));
    makeDraggable($('tradeWindow'));
  }
  function makeDraggable(win) {
    var bar = win.querySelector('.win-title');
    if (!bar) return;
    var dx = 0, dy = 0, on = false;
    bar.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('win-close')) return;
      on = true;
      var r = win.getBoundingClientRect();
      win.style.transform = 'none';
      win.style.left = r.left + 'px';
      win.style.top = r.top + 'px';
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!on) return;
      win.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)) + 'px';
      win.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy)) + 'px';
    });
    window.addEventListener('mouseup', function () { on = false; });
  }
  function positionWindows() { /* windows re-centre through CSS on load */ }

  function openWindow(id) { $(id).style.display = 'block'; sfx('open'); }
  function closeWindow(id) {
    $(id).style.display = 'none';
    if (id === 'shopWindow') currentShop = null;
    if (id === 'makeWindow') currentMake = null;
    if (id === 'tradeWindow') tradeState = null;
  }
  function anyWindowOpen() {
    return ['bankWindow', 'shopWindow', 'makeWindow', 'tradeWindow'].some(function (id) {
      return $(id).style.display === 'block';
    }) || $('dialogueBox').style.display === 'block';
  }

  /* --------------------------------------------------------------- bank */
  function openBank() { openWindow('bankWindow'); renderBank(); }
  function renderBank() {
    var grid = $('bankGrid');
    grid.innerHTML = '';
    var list = (P.bank || []).filter(function (b) {
      if (!bankSearch) return true;
      var it = item(b.id);
      return it && it.name.toLowerCase().indexOf(bankSearch) >= 0;
    });
    if (!list.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:14px;text-align:center;color:#a3946f;font-size:12px">' +
        (bankSearch ? 'Nothing matches that.' : 'Your account is empty.') + '</div>';
    }
    list.forEach(function (b) {
      var it = item(b.id);
      if (!it) return;
      var d = document.createElement('div');
      d.className = 'inv-slot';
      d.appendChild(g.RFIcons.node(it, 38));
      var q = document.createElement('span');
      q.className = 'qty';
      q.textContent = b.n >= 100000 ? Math.floor(b.n / 1000) + 'k' : comma(b.n);
      d.appendChild(q);
      d.title = it.name + ' x' + comma(b.n);
      d.onclick = function () { doAct('bank', { sub: 'withdraw', id: b.id, n: bankQty }); };
      d.oncontextmenu = function (e) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, it.name, [
          ['Withdraw 1', function () { doAct('bank', { sub: 'withdraw', id: b.id, n: 1 }); }],
          ['Withdraw 5', function () { doAct('bank', { sub: 'withdraw', id: b.id, n: 5 }); }],
          ['Withdraw 10', function () { doAct('bank', { sub: 'withdraw', id: b.id, n: 10 }); }],
          ['Withdraw All', function () { doAct('bank', { sub: 'withdraw', id: b.id, n: -1 }); }],
          ['Examine', function () { examine(it); }]
        ]);
      };
      grid.appendChild(d);
    });

    var inv = $('bankInv');
    inv.innerHTML = '';
    P.inv.forEach(function (s, i) {
      inv.appendChild(invSlotNode(s, i, {
        onClick: function () { if (s) doAct('bank', { sub: 'deposit', slot: i, n: bankQty }); },
        onRight: function (e) {
          if (!s) return;
          showCtx(e.clientX, e.clientY, item(s.id).name, [
            ['Deposit 1', function () { doAct('bank', { sub: 'deposit', slot: i, n: 1 }); }],
            ['Deposit 5', function () { doAct('bank', { sub: 'deposit', slot: i, n: 5 }); }],
            ['Deposit 10', function () { doAct('bank', { sub: 'deposit', slot: i, n: 10 }); }],
            ['Deposit All', function () { doAct('bank', { sub: 'deposit', slot: i, n: -1 }); }]
          ]);
        }
      }));
    });
  }

  /* --------------------------------------------------------------- shop */
  function openShop(shopId) {
    var sh = D.shops[shopId];
    if (!sh) { toast('That shop is shut.'); return; }
    currentShop = sh;
    $('shopTitle').firstChild.textContent = sh.name + ' ';
    openWindow('shopWindow');
    renderShop();
  }
  function renderShop() {
    if (!currentShop) return;
    var grid = $('shopGrid');
    grid.innerHTML = '';
    currentShop.stock.forEach(function (s) {
      var it = item(s.item);
      if (!it) return;
      var price = Math.max(1, Math.round(it.value * currentShop.buyMul));
      var d = document.createElement('div');
      d.className = 'inv-slot shop-cell';
      d.appendChild(g.RFIcons.node(it, 38));
      var pr = document.createElement('span');
      pr.className = 'price';
      pr.textContent = comma(price);
      d.appendChild(pr);
      var q = document.createElement('span');
      q.className = 'qty';
      q.textContent = s.qty;
      d.appendChild(q);
      d.title = it.name + ' \u2013 ' + comma(price) + ' coins';
      d.onclick = function () { doAct('shop', { sub: 'buy', shop: currentShop.id, id: s.item, n: shopQty }); };
      d.oncontextmenu = function (e) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, it.name, [
          ['Buy 1', function () { doAct('shop', { sub: 'buy', shop: currentShop.id, id: s.item, n: 1 }); }],
          ['Buy 5', function () { doAct('shop', { sub: 'buy', shop: currentShop.id, id: s.item, n: 5 }); }],
          ['Buy 10', function () { doAct('shop', { sub: 'buy', shop: currentShop.id, id: s.item, n: 10 }); }],
          ['Value', function () { chat(it.name + ' sells here for ' + comma(price) + ' coins.', 'c-game'); }],
          ['Examine', function () { examine(it); }]
        ]);
      };
      grid.appendChild(d);
    });

    var inv = $('shopInv');
    inv.innerHTML = '';
    P.inv.forEach(function (s, i) {
      inv.appendChild(invSlotNode(s, i, {
        onClick: function () {
          if (!s) return;
          doAct('shop', { sub: 'sell', shop: currentShop.id, id: s.id, n: shopQty });
        },
        onRight: function (e) {
          if (!s) return;
          var it = item(s.id);
          var price = Math.max(1, Math.round(it.value * currentShop.sellMul));
          showCtx(e.clientX, e.clientY, it.name, [
            ['Sell 1', function () { doAct('shop', { sub: 'sell', shop: currentShop.id, id: s.id, n: 1 }); }],
            ['Sell 5', function () { doAct('shop', { sub: 'sell', shop: currentShop.id, id: s.id, n: 5 }); }],
            ['Sell All', function () { doAct('shop', { sub: 'sell', shop: currentShop.id, id: s.id, n: 1000 }); }],
            ['Value', function () { chat('They would pay ' + comma(price) + ' coins for that.', 'c-game'); }]
          ]);
        }
      }));
    });
  }

  /* ------------------------------------------------------- make window */
  function openMake(book, station, requireItemId, title) {
    if (!D.recipes || !D.recipes[book]) { toast('You cannot work here.'); return; }
    currentMake = { book: book, station: station, need: requireItemId || 0 };
    $('makeTitle').firstChild.textContent = (title || bookTitle(book)) + ' ';
    openWindow('makeWindow');
    renderMake();
  }
  function bookTitle(b) {
    return { smelt: 'Smelting', smith: 'Smithing', craft: 'Crafting', fletch: 'Fletching', herb: 'Herblore' }[b] || 'Make';
  }
  function renderMake() {
    if (!currentMake) return;
    var list = D.recipes[currentMake.book] || [];
    var box = $('makeList');
    box.innerHTML = '';
    box.style.display = 'block';
    var skill = { smelt: 'smithing', smith: 'smithing', craft: 'crafting', fletch: 'fletching', herb: 'herblore' }[currentMake.book];
    var lvl = skillLevel(skill);
    var shown = 0;
    list.forEach(function (rec, i) {
      if (currentMake.station && rec.station && rec.station !== 'any' && rec.station !== currentMake.station) return;
      if (currentMake.need) {
        var uses = rec.in.some(function (x) { return x.id === currentMake.need; });
        if (!uses) return;
      }
      var have = rec.in.every(function (x) { return countId(x.id) >= x.n; });
      var canLvl = lvl >= rec.lvl;
      shown++;
      var out = item(rec.out);
      var row = document.createElement('div');
      row.className = 'list-row ' + (canLvl && have ? 'q-active' : 'q-none');
      var ing = rec.in.map(function (x) {
        var ii = item(x.id);
        return x.n + ' ' + (ii ? ii.name : '?') + ' (' + countId(x.id) + ')';
      }).join(', ');
      row.innerHTML = '<b>' + esc(rec.name) + '</b>' +
        '<span class="sub">Level ' + rec.lvl + ' \u00b7 ' + Math.round(rec.xp) + ' XP</span>' +
        '<span class="sub">Needs: ' + esc(ing) + '</span>';
      row.onclick = function () {
        if (!canLvl) { toast('You need ' + skill + ' level ' + rec.lvl + '.'); return; }
        doAct('make', { book: currentMake.book, i: i, n: makeQty });
      };
      box.appendChild(row);
    });
    if (!shown) {
      box.innerHTML = '<div style="padding:14px;color:#a3946f;font-size:12px">Nothing here can be made with what you are carrying.</div>';
    }
  }
  function countId(id) {
    var n = 0;
    P.inv.forEach(function (s) { if (s && s.id === id) n += s.n; });
    return n;
  }

  /* ---------------------------------------------------------- dialogue */
  function openDialogue(npcKey, nodeId) {
    var npc = D.npcs[npcKey];
    if (!npc || !npc.dialogue || !npc.dialogue.length) { toast('They have nothing to say.'); return; }
    currentDialogue = { key: npcKey, npc: npc };
    showDialogueNode(nodeId === undefined ? 0 : nodeId);
  }
  function showDialogueNode(id) {
    var npc = currentDialogue.npc;
    var node = null;
    npc.dialogue.forEach(function (d) { if (d.id === id) node = d; });
    if (!node) { closeDialogue(); return; }
    $('dlgName').textContent = npc.name + (npc.role ? ' \u2013 ' + npc.role : '');
    $('dlgText').innerHTML = esc(node.text);
    var opts = $('dlgOpts');
    opts.innerHTML = '';
    (node.opts || []).forEach(function (o) {
      var d = document.createElement('div');
      d.className = 'dlg-opt';
      d.textContent = o.t;
      d.onclick = function () { chooseDialogue(o); };
      opts.appendChild(d);
    });
    $('dialogueBox').style.display = 'block';
  }
  function chooseDialogue(o) {
    if (o.act) {
      var act = o.act;
      closeDialogue();
      if (act === 'bank') return openBank();
      if (act === 'shop') return openShop(currentShopKeyFor());
      if (act === 'slayer_assign') return doAct('slayer', { sub: 'assign' });
      if (act === 'slayer_check') return doAct('slayer', { sub: 'check' });
      return;
    }
    if (o.quest) return questDialogue(o.quest);
    if (o.go === null || o.go === undefined) return closeDialogue();
    showDialogueNode(o.go);
  }
  function currentShopKeyFor() {
    return currentDialogue && currentDialogue.npc ? currentDialogue.npc.shop : null;
  }
  function questDialogue(qid) {
    var q = null;
    D.quests.forEach(function (x) { if (x.id === qid) q = x; });
    if (!q) return closeDialogue();
    var st = P.quests[qid];
    if (st === 'done') {
      simpleDialogue(currentDialogue.npc.name, 'You have my thanks for that. It will not be forgotten.');
      return;
    }
    if (st === undefined || st === null) {
      var missing = questMissing(q);
      if (missing.length) {
        simpleDialogue(currentDialogue.npc.name, 'I would ask, but you are not ready. You need ' + missing.join(', ') + '.');
        return;
      }
      $('dlgName').textContent = currentDialogue.npc.name;
      $('dlgText').innerHTML = esc(q.desc) + '<br><br><i>Will you take this on?</i>';
      var opts = $('dlgOpts');
      opts.innerHTML = '';
      var yes = document.createElement('div');
      yes.className = 'dlg-opt';
      yes.textContent = 'Yes, I will help.';
      yes.onclick = function () {
        closeDialogue();
        doAct('quest_start', { quest: qid }).then(function () {
          sfx('quest');
        });
      };
      var no = document.createElement('div');
      no.className = 'dlg-opt';
      no.textContent = 'Not right now.';
      no.onclick = closeDialogue;
      opts.appendChild(yes); opts.appendChild(no);
      $('dialogueBox').style.display = 'block';
      return;
    }
    var stage = q.stages[st];
    simpleDialogue(currentDialogue.npc.name, (stage && stage.j) || 'Keep at it.');
  }
  function questMissing(q) {
    var out = [];
    var req = q.req || {};
    for (var s in (req.skills || {})) {
      if (skillLevel(s) < req.skills[s]) out.push(s.charAt(0).toUpperCase() + s.slice(1) + ' level ' + req.skills[s]);
    }
    (req.quests || []).forEach(function (rq) {
      if (P.quests[rq] !== 'done') {
        var nm = rq;
        D.quests.forEach(function (x) { if (x.id === rq) nm = x.name; });
        out.push('the quest "' + nm + '"');
      }
    });
    if (req.qp && P.qp < req.qp) out.push(req.qp + ' quest points');
    return out;
  }
  function simpleDialogue(name, text, then) {
    $('dlgName').textContent = name;
    $('dlgText').innerHTML = esc(text);
    var opts = $('dlgOpts');
    opts.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'dlg-opt';
    d.textContent = 'Continue';
    d.onclick = function () { closeDialogue(); if (then) then(); };
    opts.appendChild(d);
    $('dialogueBox').style.display = 'block';
  }
  function closeDialogue() {
    $('dialogueBox').style.display = 'none';
    currentDialogue = null;
  }

  /* -------------------------------------------------------------- trade */
  function showTrade(t, myAid) {
    tradeState = t;
    if (!t || t.state === 'closed') {
      closeWindow('tradeWindow');
      return;
    }
    tradeState.me = (t.a === myAid) ? 'a' : 'b';
    openWindow('tradeWindow');
    renderTrade();
  }
  function renderTrade() {
    var t = tradeState;
    if (!t) return;
    var me = t.me, them = me === 'a' ? 'b' : 'a';
    $('tradeTitle').firstChild.textContent = 'Trading with ' + t[them + 'n'] + ' ';
    $('tradeTheirHead').textContent = t[them + 'n'] + ' offers';
    fillTradeGrid($('tradeMine'), t[me + 'i'], true);
    fillTradeGrid($('tradeTheirs'), t[them + 'i'], false);
    var mine = t[me + 'a'], theirs = t[them + 'a'];
    $('tradeStatus').innerHTML = (t.stage === 2 ? '<b>Confirm the trade</b> \u2013 ' : '') +
      'You: ' + (mine ? 'accepted' : 'waiting') + ' \u00b7 ' + esc(t[them + 'n']) + ': ' + (theirs ? 'accepted' : 'waiting');
    var inv = $('tradeInv');
    inv.innerHTML = '';
    P.inv.forEach(function (s, i) {
      inv.appendChild(invSlotNode(s, i, {
        onClick: function () { if (s) doAct('trade_put', { slot: i, n: 1 }); },
        onRight: function (e) {
          if (!s) return;
          showCtx(e.clientX, e.clientY, item(s.id).name, [
            ['Offer 1', function () { doAct('trade_put', { slot: i, n: 1 }); }],
            ['Offer 10', function () { doAct('trade_put', { slot: i, n: 10 }); }],
            ['Offer All', function () { doAct('trade_put', { slot: i, n: -1 }); }]
          ]);
        }
      }));
    });
  }
  function fillTradeGrid(node, list, mine) {
    node.innerHTML = '';
    for (var i = 0; i < 14; i++) {
      var e = list[i];
      var d = document.createElement('div');
      d.className = 'inv-slot';
      if (e) {
        var it = item(e.id);
        if (it) {
          d.appendChild(g.RFIcons.node(it, 34));
          if (e.n > 1) {
            var q = document.createElement('span');
            q.className = 'qty'; q.textContent = comma(e.n);
            d.appendChild(q);
          }
          d.title = it.name + ' x' + comma(e.n);
          if (mine) {
            (function (id) { d.onclick = function () { doAct('trade_take', { id: id }); }; })(e.id);
          }
        }
      }
      node.appendChild(d);
    }
  }

  /* ============================================================= minimap */
  var groundCssCache = {};
  function groundCss(TM, id) {
    if (groundCssCache[id]) return groundCssCache[id];
    var a = TM.GROUND_COL[id];
    var css = a ? 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')' : '#4a6b32';
    return (groundCssCache[id] = css);
  }
  function drawMinimap(px, pz, rot, ctxInfo) {
    var cv = el.minimap;
    if (!cv) return;
    var c = cv.getContext('2d');
    var S = cv.width, half = S / 2;
    var TM = g.RFTerrainMgr;
    var range = 46 / mmZoom;               // world units shown across the radius

    c.save();
    c.beginPath(); c.arc(half, half, half - 1, 0, 6.2832); c.clip();
    c.fillStyle = '#1d2a16';
    c.fillRect(0, 0, S, S);

    /* terrain, sampled on a coarse grid */
    var step = 3;
    var perPx = (range * 2) / S;
    for (var sy = 0; sy < S; sy += step) {
      for (var sx = 0; sx < S; sx += step) {
        var lx = (sx - half) * perPx, lz = (sy - half) * perPx;
        var wx = px + lx, wz = pz + lz;
        var gt = TM.ground(wx, wz);
        c.fillStyle = groundCss(TM, gt);
        c.fillRect(sx, sy, step, step);
      }
    }

    /* scenery dots */
    var objs = ctxInfo.objects || [];
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var dx = o.x - px, dz = o.z - pz;
      if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
      var mx = half + dx / perPx, my = half + dz / perPx;
      var col = MM_COL[o.t];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }

    /* buildings */
    (ctxInfo.buildings || []).forEach(function (b) {
      var dx = b.x - px, dz = b.z - pz;
      if (Math.abs(dx) > range || Math.abs(dz) > range) return;
      c.fillStyle = 'rgba(120,90,55,.85)';
      c.fillRect(half + (dx - b.w / 2) / perPx, half + (dz - b.d / 2) / perPx, b.w / perPx, b.d / perPx);
      c.strokeStyle = '#2b2013';
      c.lineWidth = 1;
      c.strokeRect(half + (dx - b.w / 2) / perPx, half + (dz - b.d / 2) / perPx, b.w / perPx, b.d / perPx);
    });

    /* monsters, npcs, players */
    (ctxInfo.dots || []).forEach(function (d) {
      var dx = d.x - px, dz = d.z - pz;
      if (Math.abs(dx) > range || Math.abs(dz) > range) return;
      c.fillStyle = d.c;
      c.beginPath();
      c.arc(half + dx / perPx, half + dz / perPx, d.r || 2.6, 0, 6.2832);
      c.fill();
    });

    /* where you last clicked, drawn flat on the map the way it should be */
    if (ctxInfo.dest) {
      var ddx = ctxInfo.dest.x - px, ddz = ctxInfo.dest.z - pz;
      if (Math.abs(ddx) <= range && Math.abs(ddz) <= range) {
        var mx2 = half + ddx / perPx, my2 = half + ddz / perPx;
        c.strokeStyle = '#f0e0a0'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(mx2, my2); c.lineTo(mx2, my2 - 9); c.stroke();
        c.fillStyle = '#d8c24a';
        c.beginPath(); c.moveTo(mx2, my2 - 9); c.lineTo(mx2 + 7, my2 - 6.5); c.lineTo(mx2, my2 - 4); c.fill();
      }
    }

    /* you, and the way you are facing */
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(half, half, 3.2, 0, 6.2832); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.75)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(half, half);
    c.lineTo(half + Math.sin(rot) * 11, half + Math.cos(rot) * 11);
    c.stroke();
    c.restore();

    if (ctxInfo.region) $('regionName').textContent = ctxInfo.region;
  }
  var MM_COL = {
    tree: '#2f6b2a', rock: '#9a9a9a', fish: '#4fa8d8', herb: '#7fd06a',
    flax: '#d6cf6a', bank_booth: '#e0c23c', altar_rc: '#b08fd0', altar: '#d0c890',
    furnace: '#d2582c', anvil: '#b0b0b8', range: '#e08a4a', dungeon: '#101010',
    sign: '#c8b088', patch: '#8b6f3f', agility: '#8fd0c4', rift: '#b08fd0'
  };
  function zoomMinimap(dir) {
    mmZoom = Math.max(0.6, Math.min(3.2, mmZoom + dir * 0.35));
  }

  /* ============================================================== action */
  /* Every gameplay action funnels through here so results are handled once. */
  function doAct(op, params) {
    return g.RFNet.act(op, params).then(function (r) {
      handleResult(r, op);
      return r;
    }).catch(function (e) {
      chat('The server did not answer: ' + esc(e.message), 'c-warn');
      return { ok: false, error: e.message };
    });
  }

  function handleResult(r, op) {
    if (!r) return;
    if (r.p && hooks.xpGains) hooks.xpGains(r.p);
    if (r.p) setPlayer(r.p);
    (r.notes || []).forEach(function (n) { chat(esc(n), 'c-sys'); });
    if (r.levels && r.levels.length) levelUp(r.levels);
    if (r.trade !== undefined && r.trade) showTrade(r.trade, hooks.myAid ? hooks.myAid() : 0);
    if (r.done) { toast('Trade complete.'); closeWindow('tradeWindow'); }
    if (!r.ok) {
      if (r.error && r.error !== 'wait' && r.error !== 'depleted') {
        chat(esc(r.error), 'c-warn');
        sfx('error');
      }
      return;
    }
    if (op === 'make') sfx('smith');
    if (op === 'eat' || op === 'drink') sfx('eat');
    if (op === 'bury') sfx('bury');
    if (op === 'equip' || op === 'unequip') {
      sfx('item');
      hooks.equipmentChanged && hooks.equipmentChanged();
    }
    if (op === 'bank' || op === 'shop') sfx('coin');
    if (r.tele) {
      hooks.teleport && hooks.teleport(r.tele.x, r.tele.z);
      if (hooks.teleportEffect) hooks.teleportEffect(); else sfx('teleport');
    }
    if (r.at) hooks.teleport && hooks.teleport(P.x, P.z);
    if (r.fire) hooks.fireLit && hooks.fireLit(r.fire === true ? P.x : r.x, r.z === undefined ? P.z : r.z);
  }

  g.RFUI = {
    init: init, setPlayer: setPlayer, player: player, render: render, setTab: setTab,
    chat: chat, incomingChat: incomingChat, toast: toast, levelUp: levelUp, xpDrop: xpDrop,
    splat: splat, showCtx: showCtx, hideCtx: hideCtx,
    openBank: openBank, openShop: openShop, openMake: openMake, openDialogue: openDialogue,
    simpleDialogue: simpleDialogue, closeDialogue: closeDialogue,
    showTrade: showTrade, closeWindow: closeWindow, anyWindowOpen: anyWindowOpen,
    drawMinimap: drawMinimap, zoomMinimap: zoomMinimap,
    get minimapZoom() { return mmZoom; },
    setOnline: setOnline, doAct: doAct, handleResult: handleResult,
    skillLevel: skillLevel, idByName: idByName, countItemByName: countItemByName,
    hasItemNamed: hasItemNamed, examine: examine,
    get useSlot() { return useItemSlot; },
    set useSlot(v) { useItemSlot = v; render(); },
    get hoverEl() { return el.hover; }
  };
})(window);
