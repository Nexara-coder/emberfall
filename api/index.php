<?php
/* Emberfall - API front controller.
   Every outcome that matters is decided here. The client may ask to swing at
   a goblin; only this file decides whether it connected, for how much, and
   what fell out of it. */
declare(strict_types=1);

require __DIR__ . '/boot.php';
require __DIR__ . '/data.php';

set_error_handler(function ($no, $str, $file, $line) {
    throw new \ErrorException($str, 0, $no, $file, $line);
});

try {
    rf_route(rf_ps('a', ''));
} catch (\Throwable $e) {
    rf_json(['ok' => false, 'error' => 'Server error: ' . $e->getMessage()], 200);
}

/* ==================================================================== */
function rf_route(string $a): void {
    switch ($a) {
        case 'ping':      rf_a_ping(); return;
        case 'asset':     rf_a_asset(); return;
        case 'gamedata':  rf_a_gamedata(); return;
        case 'register':  rf_a_register(); return;
        case 'login':     rf_a_login(); return;
        case 'logout':    rf_a_logout(); return;
        case 'create':    rf_a_create(); return;
        case 'load':      rf_a_load(); return;
        case 'sync':      rf_a_sync(); return;
        case 'chat':      rf_a_chat(); return;
        case 'act':       rf_a_act(); return;
        case 'save':      rf_a_save(); return;
        case 'recipes':   rf_a_recipes(); return;
        default:          rf_err('Unknown action.');
    }
}

/* Loads, mutates and stores the player atomically. $fn(&$p) returns a payload. */
function rf_with_player(int $aid, callable $fn) {
    return rf_store()->mutate('player:' . $aid, function ($cur) use ($fn, $aid) {
        if (!is_array($cur)) return ['__value' => $cur, '__return' => ['ok' => false, 'error' => 'No character found.']];
        $p = rf_normalise_player($cur, (string)($cur['name'] ?? 'Adventurer'));
        $out = $fn($p);
        return ['__value' => $p, '__return' => $out];
    });
}

/* A tiny endpoint you can open in a browser to prove the API is alive and
   speaking JSON:  https://yourdomain.com/api/index.php?a=ping  */
function rf_a_ping(): void {
    $store = 'unavailable';
    $storeErr = '';
    try { $store = rf_store()->backend(); }
    catch (\Throwable $e) { $storeErr = $e->getMessage(); }
    rf_ok([
        'php' => PHP_VERSION,
        'build' => rf_world()['build'] ?? '',
        'store' => $store,
        'storeError' => $storeErr,
        'writable' => is_writable(RF_STORE),
        'sqlite' => extension_loaded('pdo_sqlite'),
        'mbstring' => extension_loaded('mbstring'),
        'time' => time()
    ]);
}

/* Serves items, NPCs, quests, the world and magic in one reply.
   The browser used to fetch data/*.json directly, but plenty of hosts refuse
   web access to files in a data folder. PHP can always read them, so the game
   no longer depends on those files being reachable from the outside. */
function rf_a_gamedata(): void {
    rf_require_session();
    $files = ['items', 'npcs', 'quests', 'world', 'magic'];
    $parts = [];
    foreach ($files as $f) {
        $path = RF_DATA . '/' . $f . '.json';
        if (!is_readable($path)) {
            rf_err('The server cannot read data/' . $f . '.json. Re-upload the data '
                 . 'folder and set files to 644 and folders to 755.');
        }
        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            rf_err('data/' . $f . '.json is empty on the server. Re-upload it in BINARY mode.');
        }
        if (json_decode($raw) === null) {
            rf_err('data/' . $f . '.json is corrupt. Re-upload it in BINARY mode - some '
                 . 'FTP clients damage .json files in ASCII mode.');
        }
        $parts[] = json_encode($f) . ':' . $raw;   // pass through, no re-encoding
    }
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    echo '{"ok":true,"v":' . json_encode(RF_VERSION) . ',"data":{' . implode(',', $parts) . '}}';
    exit;
}

/* ------------------------------------------------------------- accounts */
function rf_a_register(): void {
    $u = rf_clean_name(rf_ps('user'));
    $pw = rf_ps('pass');
    if (!rf_valid_username($u)) rf_err('Usernames must be 3-14 letters, numbers, spaces or underscores.');
    if (strlen($pw) < 6) rf_err('Passwords must be at least 6 characters.');
    if (strlen($pw) > 200) rf_err('That password is too long.');
    $lc = strtolower($u);
    $st = rf_store();

    $res = $st->mutate('acct:' . $lc, function ($cur) use ($u, $pw) {
        if (is_array($cur)) return ['__value' => $cur, '__return' => ['dup' => true]];
        return ['__value' => ['name' => $u, 'hash' => password_hash($pw, PASSWORD_DEFAULT), 'created' => time()],
                '__return' => ['dup' => false]];
    });
    if ($res['dup']) rf_err('That name is already taken.');

    // allocate a numeric id
    $aid = $st->mutate('nextid', function ($cur) {
        $n = is_numeric($cur) ? (int)$cur + 1 : 1;
        return ['__value' => $n, '__return' => $n];
    });
    $acct = $st->get('acct:' . $lc);
    $acct['aid'] = $aid;
    $st->put('acct:' . $lc, $acct);

    $p = rf_default_player($u);
    $p['created'] = time();
    $st->put('player:' . $aid, $p);

    $tok = rf_new_token();
    $st->put('sess:' . $tok, ['aid' => $aid, 'name' => $u, 'exp' => time() + RF_SESSION_TTL]);
    rf_ok(['token' => $tok, 'name' => $u, 'needChar' => true]);
}

function rf_a_login(): void {
    $u = rf_clean_name(rf_ps('user'));
    $pw = rf_ps('pass');
    $lc = strtolower($u);
    $st = rf_store();
    $acct = $st->get('acct:' . $lc);
    // constant-ish work either way so a wrong name isn't obviously faster
    if (!is_array($acct)) { password_verify($pw, '$2y$10$usesomesillystringfors0meunusedhashvaluexxxxxxxxxxxxxx'); rf_err('Unknown name or password.'); }
    if (!password_verify($pw, (string)$acct['hash'])) rf_err('Unknown name or password.');

    $aid = (int)($acct['aid'] ?? 0);
    if (!$aid) rf_err('That account is damaged. Please contact the server owner.');
    $p = $st->get('player:' . $aid);
    $tok = rf_new_token();
    $st->put('sess:' . $tok, ['aid' => $aid, 'name' => $acct['name'], 'exp' => time() + RF_SESSION_TTL]);
    rf_ok(['token' => $tok, 'name' => $acct['name'], 'needChar' => empty($p['app'])]);
}

function rf_a_logout(): void {
    $s = rf_session();
    if ($s) { rf_store()->del('sess:' . $s['token']); rf_store()->del('pres:' . $s['aid']); }
    rf_ok();
}

/* ---------------------------------------------------- character creation */
function rf_a_create(): void {
    $s = rf_require_session();
    $app = rf_p('app');
    if (!is_array($app)) rf_err('Missing appearance.');
    $clean = [
        'build' => max(0, min(1, (int)($app['build'] ?? 0))),
        'skin'  => rf_hex($app['skin'] ?? '#e0b892'),
        'hair'  => rf_hex($app['hair'] ?? '#3a2a20'),
        'hairStyle' => max(0, min(4, (int)($app['hairStyle'] ?? 1))),
        'beard' => !empty($app['beard']) ? 1 : 0,
        'beardColor' => rf_hex($app['beardColor'] ?? '#3a2a20'),
        'shirt' => rf_hex($app['shirt'] ?? '#5a7a9a'),
        'legs'  => rf_hex($app['legs'] ?? '#4a4238'),
        'boots' => rf_hex($app['boots'] ?? '#3a2f26')
    ];
    $r = rf_with_player($s['aid'], function (array &$p) use ($clean) {
        $p['app'] = $clean;
        return ['ok' => true];
    });
    if (!$r['ok']) rf_json($r);
    rf_ok();
}
function rf_hex($v): string {
    $v = is_string($v) ? $v : '#888888';
    return preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? $v : '#888888';
}

/* ------------------------------------------------------------ full load */
function rf_a_load(): void {
    $s = rf_require_session();
    $p = rf_store()->get('player:' . $s['aid']);
    if (!is_array($p)) rf_err('No character found.');
    $p = rf_normalise_player($p, $s['name']);
    rf_ok(['player' => rf_client_player($p), 'aid' => $s['aid'],
           'build' => rf_world()['build'] ?? '',
           'world' => rf_world_state_get(), 'serverTime' => rf_now()]);
}

/* The shape the browser sees. Never includes anything secret. */
function rf_client_player(array $p): array {
    return [
        'name' => $p['name'], 'app' => $p['app'],
        'x' => $p['x'], 'z' => $p['z'], 'r' => $p['r'],
        'hp' => $p['hp'], 'maxhp' => rf_skill_level($p, 'hitpoints'),
        'pray' => $p['pray'], 'maxpray' => rf_skill_level($p, 'prayer'),
        'skills' => $p['skills'], 'inv' => $p['inv'], 'eq' => (object)(array)$p['eq'],
        'bank' => $p['bank'], 'quests' => (object)(array)$p['quests'], 'qp' => rf_quest_points($p),
        'style' => $p['style'], 'autocast' => $p['autocast'], 'prayers' => array_values((array)($p['prayers'] ?? [])),
        'slayer' => $p['slayer'], 'farm' => (object)(array)$p['farm'],
        'settings' => (object)(array)$p['settings'],
        'cl' => rf_combat_level($p)
    ];
}

/* ---------------------------------------------------------------- sync */
function rf_a_sync(): void {
    $s = rf_require_session();
    $aid = $s['aid'];
    $st = rf_store();
    $now = rf_now();

    $x = rf_pf('x', -1); $z = rf_pf('z', -1); $r = rf_pf('r', 0);
    $anim = rf_ps('anim', 'idle');
    $known = rf_p('known');
    $known = is_array($known) ? $known : [];
    $since = rf_pf('since', 0);

    // Position is client-reported but speed-checked, so a hacked client can
    // at worst move at a plausible run speed, not teleport across the map.
    $notes = [];
    $pl = $st->get('player:' . $aid);
    if (!is_array($pl)) rf_err('No character found.');
    $pl = rf_normalise_player($pl, $s['name']);

    if ($x >= 0 && $z >= 0 && $x <= 384 && $z <= 384) {
        $prev = $st->get('pres:' . $aid);
        $dt = $prev ? max(0.05, $now - (float)($prev['t'] ?? $now)) : 999;
        $dist = $prev ? hypot($x - (float)$prev['x'], $z - (float)$prev['z']) : 0;
        /* A teleport is the server's own decision, so for a couple of seconds
           afterwards the client's idea of where it is gets ignored entirely.
           Without this the speed check saw the jump, called it cheating, and
           dragged the player straight back - which is why Home Teleport
           looked like it did nothing. */
        $warping = (rf_now() - (float)($pl['warp'] ?? 0)) < 2.5;
        if ($warping) {
            $x = (float)$pl['x']; $z = (float)$pl['z'];
        }
        $maxSpeed = 13.0;                              // tiles/sec ceiling (running is ~9.2)
        if (!$warping && $dt < 30 && $dist > $maxSpeed * $dt + 3) {
            // snap back rather than accept the jump
            $x = (float)$prev['x']; $z = (float)$prev['z'];
            $notes[] = 'Movement desynchronised - position restored.';
        }
        $pl['x'] = $x; $pl['z'] = $z; $pl['r'] = $r;
        $qn = rf_quest_progress($pl, 'move', ['x' => $x, 'z' => $z]);
        if ($qn) $notes = array_merge($notes, $qn);
        $st->put('player:' . $aid, $pl);
    }

    $appVer = rf_app_version($pl);
    $st->put('pres:' . $aid, [
        'n' => $pl['name'], 'x' => $pl['x'], 'z' => $pl['z'], 'r' => $pl['r'],
        'anim' => substr($anim, 0, 12), 'cl' => rf_combat_level($pl),
        'av' => $appVer, 'hp' => $pl['hp'], 'mhp' => rf_skill_level($pl, 'hitpoints'),
        't' => $now
    ]);

    // nearby players
    $players = [];
    foreach ($st->scan('pres:', $now - RF_PRESENCE_TTL) as $k => $v) {
        $oid = (int)substr($k, 5);
        if ($oid === $aid) continue;
        if (hypot((float)$v['x'] - $pl['x'], (float)$v['z'] - $pl['z']) > 150) continue;
        $e = ['id' => $oid, 'n' => $v['n'], 'x' => round((float)$v['x'], 2), 'z' => round((float)$v['z'], 2),
              'r' => round((float)$v['r'], 3), 'a' => $v['anim'], 'cl' => (int)$v['cl'],
              'hp' => (int)($v['hp'] ?? 10), 'mhp' => (int)($v['mhp'] ?? 10), 'av' => (int)$v['av'], 't' => $v['t']];
        if ((int)($known[(string)$oid] ?? -1) !== (int)$v['av']) {
            $op = $st->get('player:' . $oid);
            if (is_array($op)) { $e['app'] = $op['app']; $e['eq'] = (object)(array)($op['eq'] ?? []); }
        }
        $players[] = $e;
    }

    // world + chat
    $w = rf_world_state_get();
    rf_world_prune($w, $now);
    $chat = $st->get('chat');
    $chat = is_array($chat) ? $chat : [];
    $out = [];
    foreach ($chat as $c) {
        if ((float)$c['t'] <= $since) continue;
        if (($c['c'] ?? 'pub') === 'pm' && (int)($c['to'] ?? 0) !== $aid && (int)($c['from'] ?? 0) !== $aid) continue;
        $out[] = $c;
    }

    // pending trade
    $trade = $st->get('trade:' . $aid);

    rf_ok([
        'players' => $players, 'chat' => $out, 'world' => ['obj' => (object)$w['obj'], 'npc' => (object)$w['npc'],
                    'ground' => rf_ground_near($w, $x, $z, $aid)],
        'you' => ['hp' => $pl['hp'], 'maxhp' => rf_skill_level($pl, 'hitpoints'), 'pray' => $pl['pray'],
                  'x' => $pl['x'], 'z' => $pl['z'], 'warp' => $warping ? 1 : 0],
        'trade' => $trade, 'notes' => $notes, 't' => $now
    ]);
}

function rf_app_version(array $p): int {
    return (int)(crc32(json_encode([$p['app'], (array)$p['eq']])) & 0x7fffffff) % 100000;
}

/* ---------------------------------------------------------------- chat */
function rf_a_chat(): void {
    $s = rf_require_session();
    if (!rf_rate_ok($s['aid'], 'chat', 0.6)) rf_err('You are talking too quickly.');
    $msg = rf_sanitise_chat(rf_ps('m'));
    if ($msg === '') rf_err('Nothing to say.');
    $to = rf_ps('to', '');
    $st = rf_store();
    $entry = ['n' => $s['name'], 'm' => $msg, 't' => rf_now(), 'c' => 'pub', 'from' => $s['aid']];
    if ($to !== '') {
        $acct = $st->get('acct:' . strtolower(rf_clean_name($to)));
        if (!is_array($acct)) rf_err('No player by that name.');
        $entry['c'] = 'pm';
        $entry['to'] = (int)$acct['aid'];
        $entry['ton'] = $acct['name'];
    }
    $st->mutate('chat', function ($cur) use ($entry) {
        $c = is_array($cur) ? $cur : [];
        $c[] = $entry;
        if (count($c) > RF_CHAT_KEEP) $c = array_slice($c, -RF_CHAT_KEEP);
        return ['__value' => $c];
    });
    rf_ok();
}

/* -------------------------------------------------------------- saving */
function rf_a_save(): void {
    $s = rf_require_session();
    $set = rf_p('settings');
    $r = rf_with_player($s['aid'], function (array &$p) use ($set) {
        if (is_array($set)) {
            foreach (['music','sfx','amb','master'] as $k)
                if (isset($set[$k])) $p['settings'][$k] = max(0, min(100, (int)$set[$k]));
            foreach (['shadows','draw'] as $k)
                if (isset($set[$k])) $p['settings'][$k] = (int)$set[$k];
        }
        $p['lastSave'] = time();
        return ['ok' => true];
    });
    rf_json($r);
}

/* ==================================================================== */
/*  GAMEPLAY ACTIONS                                                     */
/* ==================================================================== */
function rf_a_act(): void {
    $s = rf_require_session();
    $op = rf_ps('op');
    $aid = $s['aid'];

    // trade touches two players, so it runs outside the single-player mutate
    if (str_starts_with($op, 'trade_')) { rf_trade_op($aid, $op); return; }

    $res = rf_with_player($aid, function (array &$p) use ($op, $aid) {
        switch ($op) {
            case 'attack':     return rf_op_attack($p, $aid);
            case 'gather':     return rf_op_gather($p);
            case 'equip':      return rf_op_equip($p);
            case 'unequip':    return rf_op_unequip($p);
            case 'drop':       return rf_op_drop_ground($p, $aid);
            case 'eat':        return rf_op_eat($p);
            case 'bury':       return rf_op_bury($p);
            case 'drink':      return rf_op_drink($p);
            case 'swap':       return rf_op_swap($p);
            case 'bank':       return rf_op_bank($p);
            case 'shop':       return rf_op_shop($p);
            case 'make':       return rf_op_make($p);
            case 'cook':       return rf_op_cook($p);
            case 'fire':       return rf_op_fire($p);
            case 'runecraft':  return rf_op_runecraft($p);
            case 'farm':       return rf_op_farm($p);
            case 'thieve':     return rf_op_thieve($p);
            case 'agility':    return rf_op_agility($p);
            case 'dialogue':   return rf_op_dialogue($p);
            case 'quest_start':return rf_op_quest_start($p);
            case 'style':      return rf_op_style($p);
            case 'prayer':     return rf_op_prayer($p);
            case 'cast':       return rf_op_cast($p, $aid);
            case 'slayer':     return rf_op_slayer($p);
            case 'respawn':    return rf_op_respawn($p);
            case 'loot':       return rf_op_loot($p);
            case 'take':       return rf_op_take($p, $aid);
            case 'construct':  return rf_op_construct($p);
            case 'recharge':   return rf_op_recharge($p);
            case 'home':       return rf_op_home($p);
            default:           return ['ok' => false, 'error' => 'Unknown operation.'];
        }
    });
    if (!is_array($res)) $res = ['ok' => false, 'error' => 'No response.'];
    if (!empty($res['ok'])) {
        $p = rf_store()->get('player:' . $aid);
        if (is_array($p)) $res['p'] = rf_client_player(rf_normalise_player($p, $p['name'] ?? ''));
    }
    rf_json($res);
}

/* Convenience: wrap a success result with messages and level-ups. */
function rf_res(array $extra = [], array $notes = [], array $levels = []): array {
    return array_merge(['ok' => true, 'notes' => $notes, 'levels' => $levels], $extra);
}

/* --------------------------------------------------------------- combat */
function rf_op_attack(array &$p, int $aid): array {
    $p['lastCombat'] = rf_now();
    $si = rf_pi('si', -1);
    $w = rf_world();
    $spawn = $w['spawns'][$si] ?? null;
    if (!$spawn) return ['ok' => false, 'error' => 'No such target.'];
    $types = rf_npc_types();
    $npc = $types[$spawn['k']] ?? null;
    if (!$npc || ($npc['kind'] ?? '') !== 'monster') return ['ok' => false, 'error' => 'You cannot attack that.'];
    if ((int)$p['hp'] <= 0) return ['ok' => false, 'error' => 'You are dead.'];

    $dist = hypot($p['x'] - $spawn['x'], $p['z'] - $spawn['z']);
    if ($dist > 14) return ['ok' => false, 'error' => 'You are too far away.'];

    $now = rf_now();
    $speed = rf_attack_speed($p);
    if (($now - (float)($p['lastAtk'] ?? 0)) < $speed * 0.85) return ['ok' => false, 'error' => 'wait'];
    $p['lastAtk'] = $now;

    // work out the attack mode from what is held
    $weap = rf_weapon($p);
    $mode = 'melee'; $spell = null;
    if ($weap && ($weap['wclass'] ?? '') === 'bow') $mode = 'ranged';
    elseif ($weap && ($weap['wclass'] ?? '') === 'staff' && !empty($p['autocast'])) {
        $spell = rf_spells()[$p['autocast']] ?? null;
        if ($spell) $mode = 'magic';
    }
    if ($mode === 'ranged') {
        $ammoId = (int)(((array)$p['eq'])['ammo'] ?? 0);
        if (!$ammoId || rf_inv_count($p, $ammoId) + 0 <= 0) {
            // ammo lives in the equipment slot; count it there
            $eqAmmo = (int)(((array)$p['eq'])['ammoN'] ?? 0);
            if ($eqAmmo <= 0) return ['ok' => false, 'error' => 'You have no ammunition equipped.'];
        }
    }
    if ($mode === 'magic' && $spell) {
        $missing = rf_spell_missing($p, $spell);
        if ($missing) return ['ok' => false, 'error' => 'You need ' . $missing . ' to cast that.'];
    }

    $notes = []; $levels = [];
    $result = rf_player_attack($p, $npc, $mode, $spell);

    // spend the cost of the swing
    if ($mode === 'ranged') rf_spend_ammo($p);
    if ($mode === 'magic' && $spell) rf_spend_runes($p, $spell);

    $died = false; $drops = []; $npcHpAfter = (int)$npc['hp'];

    if ($result['dmg'] > 0 || !$result['hit']) {
        $dmg = (int)$result['dmg'];
        $out = rf_store()->mutate('world', function ($cur) use ($si, $npc, $dmg, $aid) {
            $wst = is_array($cur) ? $cur : ['obj' => [], 'npc' => [], 'ground' => [], 'seq' => 0];
            $now = rf_now();
            $k = (string)$si;
            $e = $wst['npc'][$k] ?? null;
            if ($e && isset($e['dead'])) {
                if ($e['dead'] > $now) return ['__value' => $wst, '__return' => ['gone' => true]];
                unset($wst['npc'][$k]); $e = null;
            }
            $hp = $e ? (int)$e['hp'] : (int)$npc['hp'];
            $hp -= $dmg;
            if ($hp <= 0) {
                $wst['npc'][$k] = ['dead' => $now + (float)$npc['resp'], 'by' => $aid, 't' => $now];
                return ['__value' => $wst, '__return' => ['died' => true, 'hp' => 0]];
            }
            $wst['npc'][$k] = ['hp' => $hp, 't' => $now, 'tgt' => $aid];
            return ['__value' => $wst, '__return' => ['died' => false, 'hp' => $hp]];
        });
        if (!empty($out['gone'])) return ['ok' => false, 'error' => 'It is already dead.'];
        $died = !empty($out['died']);
        $npcHpAfter = (int)($out['hp'] ?? 0);
    }

    foreach ($result['xp'] as $sk => $amt) $levels = array_merge($levels, rf_add_xp($p, $sk, (float)$amt));

    $back = null;
    if (!$died) {
        $back = rf_npc_attack($npc, $p);
        if ($back['dmg'] > 0) {
            $p['hp'] = max(0, (int)$p['hp'] - (int)$back['dmg']);
        }
    }

    if ($died) {
        $notes[] = 'You defeat the ' . strtolower($npc['name']) . '.';
        /* Loot falls where the monster fell. It belongs to whoever landed the
           killing blow for a minute, then anyone may take it, and it rots
           away after five. Nothing goes straight into the pack. */
        $drops = rf_roll_drops($npc);
        if ($drops) {
            rf_ground_drop($drops, (float)$spawn['x'], (float)$spawn['z'], $aid);
            $names = [];
            foreach ($drops as $d) {
                $it = rf_item($d[0]);
                if ($it) $names[] = ($d[1] > 1 ? $d[1] . ' x ' : '') . $it['name'];
            }
            if ($names) $notes[] = 'It drops ' . implode(', ', $names) . '.';
        }
        // slayer
        if (!empty($p['slayer']) && ($p['slayer']['npc'] ?? '') === $spawn['k']) {
            $p['slayer']['left'] = max(0, (int)$p['slayer']['left'] - 1);
            $levels = array_merge($levels, rf_add_xp($p, 'slayer', (float)$npc['hp']));
            if ($p['slayer']['left'] <= 0) {
                $notes[] = 'Slayer assignment complete! Return to Vex Harrowgate.';
                $p['slayer']['done'] = 1;
            } else {
                $notes[] = $p['slayer']['left'] . ' ' . $npc['name'] . ' remaining.';
            }
        }
        $qn = rf_quest_progress($p, 'kill', ['npc' => $spawn['k']]);
        $notes = array_merge($notes, $qn);
        $qn2 = rf_quest_progress($p, 'inv', []);
        $notes = array_merge($notes, $qn2);
    }

    $playerDied = false;
    if ((int)$p['hp'] <= 0) {
        $playerDied = true;
        $notes[] = 'You have died.';
    }

    return rf_res([
        'result' => ['hit' => $result['hit'], 'dmg' => (int)$result['dmg'], 'style' => $result['style']],
        'npc' => ['si' => $si, 'hp' => $npcHpAfter, 'max' => (int)$npc['hp'], 'died' => $died],
        'back' => $back, 'drops' => $drops, 'dead' => $playerDied
    ], $notes, $levels);
}

function rf_spell_missing(array $p, array $spell): string {
    $lack = [];
    if (rf_skill_level($p, 'magic') < (int)$spell['lvl']) return 'Magic level ' . $spell['lvl'];
    $weap = rf_weapon($p);
    $staffEl = null;
    if ($weap && ($weap['wclass'] ?? '') === 'staff') {
        foreach (['Air','Water','Earth','Fire'] as $el)
            if (stripos($weap['name'], $el) === 0) $staffEl = strtolower($el);
    }
    foreach ($spell['runes'] as $r) {
        $it = rf_item((int)$r['item']);
        if (!$it) continue;
        if ($staffEl && stripos($it['name'], $staffEl) === 0) continue;   // staff supplies it
        if (rf_inv_count($p, (int)$r['item']) < (int)$r['n']) $lack[] = $r['n'] . ' x ' . $it['name'];
    }
    return implode(', ', $lack);
}
function rf_spend_runes(array &$p, array $spell): void {
    $weap = rf_weapon($p);
    $staffEl = null;
    if ($weap && ($weap['wclass'] ?? '') === 'staff') {
        foreach (['Air','Water','Earth','Fire'] as $el)
            if (stripos($weap['name'], $el) === 0) $staffEl = strtolower($el);
    }
    foreach ($spell['runes'] as $r) {
        $it = rf_item((int)$r['item']);
        if ($staffEl && $it && stripos($it['name'], $staffEl) === 0) continue;
        rf_inv_remove($p, (int)$r['item'], (int)$r['n']);
    }
}
function rf_spend_ammo(array &$p): void {
    $eq = (array)$p['eq'];
    if (!isset($eq['ammo'])) return;
    $n = (int)($eq['ammoN'] ?? 1) - 1;
    if ($n <= 0) { unset($eq['ammo']); unset($eq['ammoN']); }
    else $eq['ammoN'] = $n;
    $p['eq'] = $eq;
}

function rf_op_respawn(array &$p): array {
    /* One home. Dying anywhere in the world returns you to the standing stone
       at Oakheart, not to whichever town happened to be closest to your
       corpse - which made death feel inconsistent and sometimes dropped you
       back into the thing that killed you. */
    $w = rf_world();
    $home = $w['homePoint'] ?? $w['spawnPoint'];
    $best = ['n' => $home['n'] ?? 'Oakheart', 'x' => $home['x'], 'z' => $home['z']];
    $p['x'] = (float)$best['x']; $p['z'] = (float)$best['z'];
    $p['warp'] = rf_now();          // sync must not argue with this
    $p['hp'] = rf_skill_level($p, 'hitpoints');
    $p['prayers'] = [];
    /* explicit coordinates so the client moves you even if its own position
       tracking disagrees - respawning used to leave you where you fell */
    return rf_res(['at' => $best['n'], 'tele' => ['x' => (float)$best['x'], 'z' => (float)$best['z']]],
                  ['You wake up in ' . $best['n'] . '.']);
}

/* ------------------------------------------------------------ gathering */

/* How many logs a tree carries. Ordinary trees give a handful; the slow,
   high level ones are worth the walk. */
function rf_tree_logs(array $spec): int {
    $lvl = (int)$spec['lvl'];
    if ($lvl <= 1) return 4;        // ordinary tree
    if ($lvl <= 15) return 6;       // oak
    if ($lvl <= 30) return 8;       // willow
    if ($lvl <= 45) return 9;       // birch
    if ($lvl <= 60) return 11;      // ironbark
    return 13;                      // ghostwood
}
/* Ore seams: common metal is plentiful, the rare tiers are not. */
function rf_rock_yield(array $spec): int {
    $lvl = (int)$spec['lvl'];
    if ($lvl <= 1) return 4;        // copper, tin
    if ($lvl <= 15) return 3;       // iron
    if ($lvl <= 30) return 3;       // coal
    if ($lvl <= 55) return 2;       // kaldrite
    return 1;                       // aetherium
}
/* Fishing spots hold a shoal rather than a single fish. */
function rf_fish_yield(array $spec): int {
    return max(3, 9 - (int)floor((int)$spec['lvl'] / 12));
}

/* Counts down what is left in a node. Shared world state, so two players
   working the same tree draw from the same stock. Returns how many remain
   and whether that was the last one. */
function rf_node_yield(int $oi, string $kind, int $total): array {
    $res = rf_store()->mutate('world', function ($cur) use ($oi, $total) {
        $w = is_array($cur) ? $cur : ['obj' => [], 'npc' => [], 'ground' => []];
        if (!isset($w['yield']) || !is_array($w['yield'])) $w['yield'] = [];
        $left = isset($w['yield'][$oi]) ? (int)$w['yield'][$oi] : $total;
        $left--;
        if ($left <= 0) { unset($w['yield'][$oi]); return ['__value' => $w, '__return' => ['left' => 0, 'spent' => true]]; }
        $w['yield'][$oi] = $left;
        return ['__value' => $w, '__return' => ['left' => $left, 'spent' => false]];
    });
    return is_array($res) ? $res : ['left' => 0, 'spent' => true];
}
function rf_world_obj(int $id): ?array {
    static $ix = null;
    if ($ix === null) { $ix = []; foreach (rf_world()['objects'] as $o) $ix[(int)$o['i']] = $o; }
    return $ix[$id] ?? null;
}
/* Marks a resource depleted for N seconds, shared across all players. */
function rf_deplete(int $objId, float $seconds): void {
    rf_store()->mutate('world', function ($cur) use ($objId, $seconds) {
        $w = is_array($cur) ? $cur : ['obj' => [], 'npc' => [], 'ground' => [], 'seq' => 0];
        $w['obj'][(string)$objId] = ['until' => rf_now() + $seconds];
        return ['__value' => $w];
    });
}
function rf_is_depleted(int $objId): bool {
    $w = rf_world_state_get();
    $e = $w['obj'][(string)$objId] ?? null;
    return $e && (float)$e['until'] > rf_now();
}

function rf_best_tool(array $p, string $kind): ?array {
    $best = null;
    $consider = function ($id) use (&$best, $kind, $p) {
        $it = rf_item((int)$id);
        if (!$it || ($it['tool'] ?? '') !== $kind) return;
        if (!rf_meets_req($p, $it['req'] ?? null)) return;
        if (!$best || (float)($it['power'] ?? 1) > (float)($best['power'] ?? 1)) $best = $it;
    };
    foreach ((array)$p['eq'] as $slot => $id) if ($slot !== 'ammoN') $consider($id);
    foreach ($p['inv'] as $sl) if ($sl) $consider($sl['id']);
    return $best;
}
function rf_has_fish_tool(array $p, string $t): bool {
    foreach ($p['inv'] as $sl) {
        if (!$sl) continue;
        $it = rf_item((int)$sl['id']);
        if ($it && ($it['fishTool'] ?? '') === $t) return true;
    }
    foreach ((array)$p['eq'] as $slot => $id) {
        if ($slot === 'ammoN') continue;
        $it = rf_item((int)$id);
        if ($it && ($it['fishTool'] ?? '') === $t) return true;
    }
    return false;
}

function rf_op_gather(array &$p): array {
    $oi = rf_pi('oi', -1);
    $o = rf_world_obj($oi);
    if (!$o) return ['ok' => false, 'error' => 'Nothing to gather there.'];
    if (hypot($p['x'] - $o['x'], $p['z'] - $o['z']) > 6) return ['ok' => false, 'error' => 'You are too far away.'];
    if (rf_is_depleted($oi)) return ['ok' => false, 'error' => 'depleted'];
    if (!rf_rate_ok(0, 'g', 0)) { /* no-op, kept for symmetry */ }

    $notes = []; $levels = []; $gained = null; $felled = false;
    $w = rf_world();

    if ($o['t'] === 'tree') {
        $spec = null;
        foreach ($w['trees'] as $t) if ($t['tree'] === $o['k']) $spec = $t;
        if (!$spec) return ['ok' => false, 'error' => 'That tree is strange.'];
        $lvl = rf_skill_level($p, 'woodcutting');
        if ($lvl < (int)$spec['lvl']) return ['ok' => false, 'error' => 'You need Woodcutting level ' . $spec['lvl'] . ' to cut this.'];
        $axe = rf_best_tool($p, 'hatchet');
        if (!$axe) return ['ok' => false, 'error' => 'You need a hatchet you have the level to use.'];
        $chance = min(0.92, 0.17 + ($lvl - (int)$spec['lvl']) * 0.012 + (float)$axe['power'] * 0.09);
        if ((mt_rand() / mt_getrandmax()) > $chance) return rf_res(['swing' => true]);
        $it = rf_item_by_name($spec['n']);
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'woodcutting', (float)$spec['xp']);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        $notes[] = 'You get some ' . strtolower($spec['n']) . '.';
        /* A tree is worth several logs, and each one pays its own XP. Bigger
           trees carry more. The tree only comes down when its logs run out. */
        $yield = rf_node_yield($oi, 'tree', rf_tree_logs($spec));
        if ($yield['spent']) {
            rf_deplete($oi, (float)(($spec['lvl'] <= 1) ? 26 : 40 + $spec['lvl'] * 1.2));
            $notes[] = 'The tree falls.';
            $felled = true;
        } else {
            $notes[] = $yield['left'] . ' more ' . ($yield['left'] === 1 ? 'log' : 'logs') . ' left in it.';
        }
    } elseif ($o['t'] === 'rock') {
        $spec = null;
        foreach ($w['ores'] as $t) if ($t['n'] === $o['ore']) $spec = $t;
        if (!$spec) return ['ok' => false, 'error' => 'That rock holds nothing.'];
        $lvl = rf_skill_level($p, 'mining');
        if ($lvl < (int)$spec['lvl']) return ['ok' => false, 'error' => 'You need Mining level ' . $spec['lvl'] . ' to mine this.'];
        $pick = rf_best_tool($p, 'pickaxe');
        if (!$pick) return ['ok' => false, 'error' => 'You need a pickaxe you have the level to use.'];
        $chance = min(0.9, 0.15 + ($lvl - (int)$spec['lvl']) * 0.013 + (float)$pick['power'] * 0.085);
        if ((mt_rand() / mt_getrandmax()) > $chance) return rf_res(['swing' => true]);
        $it = rf_item_by_name($spec['n']);
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'mining', (float)$spec['xp']);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        $notes[] = 'You mine some ' . strtolower($spec['n']) . '.';
        /* Richer seams give up more before they are exhausted. */
        $yield = rf_node_yield($oi, 'rock', rf_rock_yield($spec));
        if ($yield['spent']) {
            rf_deplete($oi, 14 + (float)$spec['lvl'] * 1.1);
            $notes[] = 'The rock is spent.';
            $felled = true;
        }
    } elseif ($o['t'] === 'fish') {
        $kinds = $o['f'];
        $lvl = rf_skill_level($p, 'fishing');
        $spec = null;
        foreach ($w['fish'] as $f) {
            if (!in_array($f['n'], $kinds, true)) continue;
            if ($lvl < (int)$f['lvl']) continue;
            if (!rf_has_fish_tool($p, $f['tool'])) continue;
            if (!$spec || (int)$f['lvl'] > (int)$spec['lvl']) $spec = $f;
        }
        if (!$spec) {
            $need = [];
            foreach ($w['fish'] as $f) if (in_array($f['n'], $kinds, true)) $need[] = $f['n'] . ' (level ' . $f['lvl'] . ', ' . $f['tool'] . ')';
            return ['ok' => false, 'error' => 'You cannot fish here yet. This spot holds: ' . implode(', ', $need) . '.'];
        }
        $chance = min(0.88, 0.20 + ($lvl - (int)$spec['lvl']) * 0.014);
        if ((mt_rand() / mt_getrandmax()) > $chance) return rf_res(['swing' => true]);
        $it = rf_item_by_name('Raw ' . strtolower($spec['n']));
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'fishing', (float)$spec['xp']);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        $notes[] = 'You catch a ' . strtolower($spec['n']) . '.';
    } elseif ($o['t'] === 'herb') {
        $spec = null;
        foreach ($w['herbs'] as $hh) if ($hh['n'] === $o['h']) $spec = $hh;
        if (!$spec) return ['ok' => false, 'error' => 'Just weeds.'];
        $lvl = rf_skill_level($p, 'herblore');
        $it = rf_item_by_name('Grimy ' . strtolower($spec['n']));
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'herblore', 2.0 + $lvl * 0.1);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        rf_deplete($oi, 40);
        $notes[] = 'You pick a herb.';
    } elseif ($o['t'] === 'flax') {
        $it = rf_item_by_name('Flax');
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'crafting', 1.0);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        rf_deplete($oi, 8);
        $notes[] = 'You pick some flax.';
    } elseif ($o['t'] === 'rift') {
        $lvl = rf_skill_level($p, 'runecraft');
        $it = rf_item_by_name($lvl >= 30 ? 'Pure essence' : 'Rune essence');
        if (!$it) return ['ok' => false, 'error' => 'The rift is silent.'];
        if (!rf_inv_can_add($p, (int)$it['id'], 1)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], 1);
        $levels = rf_add_xp($p, 'mining', 5.0);
        $gained = ['id' => (int)$it['id'], 'n' => 1];
        $notes[] = 'You chip a piece of essence from the rift.';
    } elseif ($o['t'] === 'hunt') {
        $lvl = rf_skill_level($p, 'hunter');
        $it = rf_item_by_name((mt_rand(1, 100) > 55) ? 'Raw chicken' : 'Feather');
        $qty = $it['name'] === 'Feather' ? mt_rand(3, 9) : 1;
        if (!rf_inv_can_add($p, (int)$it['id'], $qty)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$it['id'], $qty);
        $levels = rf_add_xp($p, 'hunter', 22.0 + $lvl * 1.2);
        $gained = ['id' => (int)$it['id'], 'n' => $qty];
        rf_deplete($oi, 25);
        $notes[] = 'Your snare catches something.';
    } else {
        return ['ok' => false, 'error' => 'You cannot gather that.'];
    }

    $notes = array_merge($notes, rf_quest_progress($p, 'gather', []));
    return rf_res(['gained' => $gained, 'obj' => $felled ? $oi : 0, 'felled' => $felled ? 1 : 0], $notes, $levels);
}

/* ------------------------------------------------------------ equipment */
function rf_op_equip(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || empty($it['slot'])) return ['ok' => false, 'error' => 'You cannot wear that.'];
    if (!rf_meets_req($p, $it['req'] ?? null)) {
        $need = [];
        foreach (($it['req'] ?? []) as $s => $l) $need[] = ucfirst($s) . ' ' . $l;
        return ['ok' => false, 'error' => 'You need ' . implode(' and ', $need) . ' to use that.'];
    }
    $eq = (array)$p['eq'];
    $target = $it['slot'];
    $qty = ($target === 'ammo') ? (int)$sl['n'] : 1;

    // free the slot(s) this displaces
    $toReturn = [];
    if (isset($eq[$target])) $toReturn[] = [(int)$eq[$target], $target === 'ammo' ? (int)($eq['ammoN'] ?? 1) : 1];
    if ($target === 'weapon' && !empty($it['twoh']) && isset($eq['shield'])) $toReturn[] = [(int)$eq['shield'], 1];
    if ($target === 'shield' && isset($eq['weapon'])) {
        $wi = rf_item((int)$eq['weapon']);
        if ($wi && !empty($wi['twoh'])) $toReturn[] = [(int)$eq['weapon'], 1];
    }
    // make sure there is room once the incoming item leaves the pack
    $p['inv'][$slotIdx] = null;
    foreach ($toReturn as $tr) {
        if (!rf_inv_can_add($p, $tr[0], $tr[1])) {
            $p['inv'][$slotIdx] = $sl;
            return ['ok' => false, 'error' => 'You need a free pack slot first.'];
        }
        rf_inv_add($p, $tr[0], $tr[1]);
        foreach ($eq as $k => $v) if ((int)$v === $tr[0] && $k !== 'ammoN') unset($eq[$k]);
        unset($eq['ammoN']);
    }
    $eq[$target] = (int)$it['id'];
    if ($target === 'ammo') $eq['ammoN'] = $qty;
    $p['eq'] = $eq;
    return rf_res([], ['You equip the ' . strtolower($it['name']) . '.']);
}

function rf_op_unequip(array &$p): array {
    $slot = rf_ps('eslot');
    $eq = (array)$p['eq'];
    if (!isset($eq[$slot])) return ['ok' => false, 'error' => 'Nothing equipped there.'];
    $id = (int)$eq[$slot];
    $qty = $slot === 'ammo' ? (int)($eq['ammoN'] ?? 1) : 1;
    if (!rf_inv_can_add($p, $id, $qty)) return ['ok' => false, 'error' => 'Your pack is full.'];
    rf_inv_add($p, $id, $qty);
    unset($eq[$slot]);
    if ($slot === 'ammo') unset($eq['ammoN']);
    $p['eq'] = $eq;
    return rf_res([], ['You remove the ' . strtolower(rf_item($id)['name'] ?? 'item') . '.']);
}

function rf_op_swap(array &$p): array {
    $a = rf_pi('from', -1); $b = rf_pi('to', -1);
    if ($a < 0 || $b < 0 || $a > 27 || $b > 27) return ['ok' => false, 'error' => 'Bad slot.'];
    $t = $p['inv'][$a]; $p['inv'][$a] = $p['inv'][$b]; $p['inv'][$b] = $t;
    return rf_res();
}

function rf_op_drop(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    $p['inv'][$slotIdx] = null;
    return rf_res([], ['You drop the ' . strtolower($it['name'] ?? 'item') . '.']);
}

function rf_op_eat(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || empty($it['eat'])) return ['ok' => false, 'error' => 'You cannot eat that.'];
    $max = rf_skill_level($p, 'hitpoints');
    if ($p['hp'] >= $max) return ['ok' => false, 'error' => 'You do not feel hungry.'];
    $p['hp'] = min($max, (int)$p['hp'] + (int)$it['eat']);
    if ((int)$sl['n'] > 1) $p['inv'][$slotIdx]['n'] = (int)$sl['n'] - 1;
    else $p['inv'][$slotIdx] = null;
    return rf_res(['heal' => (int)$it['eat']], ['You eat the ' . strtolower($it['name']) . '.']);
}

function rf_op_drink(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || empty($it['drink'])) return ['ok' => false, 'error' => 'You cannot drink that.'];
    $eff = $it['drink'];
    $notes = [];
    if (isset($eff['prayer'])) {
        $p['pray'] = min(rf_skill_level($p, 'prayer'), (int)$p['pray'] + (int)$eff['prayer']);
        $notes[] = 'You feel spiritually restored.';
    }
    if (isset($eff['restore'])) { $notes[] = 'Your skills feel restored.'; }
    if (isset($eff['skill'])) { $notes[] = 'You feel stronger for a while.'; }
    if (isset($eff['cure'])) { $notes[] = 'You feel the poison leave you.'; }
    $vial = rf_item_by_name('Vial');
    $p['inv'][$slotIdx] = $vial ? ['id' => (int)$vial['id'], 'n' => 1] : null;
    return rf_res([], $notes);
}

function rf_op_bury(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || empty($it['bury'])) return ['ok' => false, 'error' => 'You cannot bury that.'];
    if ((int)$sl['n'] > 1) $p['inv'][$slotIdx]['n'] = (int)$sl['n'] - 1;
    else $p['inv'][$slotIdx] = null;
    $lv = rf_add_xp($p, 'prayer', (float)$it['bury']);
    $notes = array_merge(['You bury the ' . strtolower($it['name']) . '.'], rf_quest_progress($p, 'inv', []));
    return rf_res([], $notes, $lv);
}

/* ---------------------------------------------------------------- bank */
function rf_op_bank(array &$p): array {
    $sub = rf_ps('sub');
    $n = rf_pi('n', 1);
    if ($sub === 'deposit') {
        $slotIdx = rf_pi('slot', -1);
        $sl = $p['inv'][$slotIdx] ?? null;
        if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
        $id = (int)$sl['id'];
        $have = rf_inv_count($p, $id);
        $take = $n < 0 ? $have : min($have, $n);
        rf_inv_remove($p, $id, $take);
        rf_bank_add($p, $id, $take);
        return rf_res();
    }
    if ($sub === 'depositAll') {
        foreach ($p['inv'] as $i => $sl) {
            if (!$sl) continue;
            rf_bank_add($p, (int)$sl['id'], (int)$sl['n']);
            $p['inv'][$i] = null;
        }
        return rf_res([], ['You deposit your pack.']);
    }
    if ($sub === 'withdraw') {
        $id = rf_pi('id', 0);
        $have = 0;
        foreach ($p['bank'] as $b) if ((int)$b['id'] === $id) $have = (int)$b['n'];
        if ($have <= 0) return ['ok' => false, 'error' => 'You have none of those banked.'];
        $want = $n < 0 ? $have : min($have, $n);
        $it = rf_item($id);
        if (!$it) return ['ok' => false, 'error' => 'Unknown item.'];
        if (empty($it['stack'])) $want = min($want, rf_inv_free($p));
        if ($want <= 0) return ['ok' => false, 'error' => 'Your pack is full.'];
        if (!rf_inv_can_add($p, $id, $want)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_bank_remove($p, $id, $want);
        rf_inv_add($p, $id, $want);
        return rf_res();
    }
    return ['ok' => false, 'error' => 'Unknown bank operation.'];
}

/* ---------------------------------------------------------------- shops */
function rf_op_shop(array &$p): array {
    $sid = rf_ps('shop');
    $shops = rf_shops();
    $shop = $shops[$sid] ?? null;
    if (!$shop) return ['ok' => false, 'error' => 'No such shop.'];
    $sub = rf_ps('sub');
    $id = rf_pi('id', 0);
    $n = max(1, min(1000, rf_pi('n', 1)));
    $it = rf_item($id);
    if (!$it) return ['ok' => false, 'error' => 'Unknown item.'];

    if ($sub === 'buy') {
        $inStock = null;
        foreach ($shop['stock'] as $s) if ((int)$s['item'] === $id) $inStock = $s;
        if (!$inStock) return ['ok' => false, 'error' => 'This shop does not stock that.'];
        $price = max(1, (int)round((int)$it['value'] * (float)$shop['buyMul']));
        $n = min($n, (int)$inStock['qty']);
        if ($n <= 0) return ['ok' => false, 'error' => 'Out of stock.'];
        if (empty($it['stack'])) $n = min($n, rf_inv_free($p));
        if ($n <= 0) return ['ok' => false, 'error' => 'Your pack is full.'];
        $cost = $price * $n;
        if (rf_coins($p) < $cost) return ['ok' => false, 'error' => 'You cannot afford that.'];
        if (!rf_inv_can_add($p, $id, $n)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_take_coins($p, $cost);
        rf_inv_add($p, $id, $n);
        return rf_res([], ['You buy ' . $n . ' x ' . $it['name'] . ' for ' . number_format($cost) . ' coins.']);
    }
    if ($sub === 'sell') {
        if (empty($it['trade'])) return ['ok' => false, 'error' => 'You cannot sell that.'];
        $have = rf_inv_count($p, $id);
        $n = min($n, $have);
        if ($n <= 0) return ['ok' => false, 'error' => 'You have none of those.'];
        $price = max(1, (int)round((int)$it['value'] * (float)$shop['sellMul']));
        rf_inv_remove($p, $id, $n);
        rf_give_coins($p, $price * $n);
        return rf_res([], ['You sell ' . $n . ' x ' . $it['name'] . ' for ' . number_format($price * $n) . ' coins.']);
    }
    return ['ok' => false, 'error' => 'Unknown shop operation.'];
}

/* ------------------------------------------------------------- crafting */
/* Recipes are derived from the tier tables so weapon/armour smithing stays in
   step with the item database automatically. */
function rf_recipes(): array {
    static $R = null;
    if ($R !== null) return $R;
    $R = ['smelt' => [], 'smith' => [], 'craft' => [], 'fletch' => [], 'herb' => []];
    $w = rf_world();

    $smelt = [
        ['Bronze bar', 1, 6.2, [['Copper ore', 1], ['Tin ore', 1]]],
        ['Iron bar', 15, 12.5, [['Iron ore', 1]]],
        ['Silver bar', 20, 13.7, [['Silver ore', 1]]],
        ['Steel bar', 30, 17.5, [['Iron ore', 1], ['Coal', 2]]],
        ['Gold bar', 40, 22.5, [['Gold ore', 1]]],
        ['Verdite bar', 50, 30.0, [['Verdite ore', 1], ['Coal', 4]]],
        ['Kaldrite bar', 70, 37.5, [['Kaldrite ore', 1], ['Coal', 6]]],
        ['Aetherium bar', 85, 50.0, [['Aetherium ore', 1], ['Coal', 8]]]
    ];
    foreach ($smelt as $s) {
        $out = rf_item_by_name($s[0]);
        if (!$out) continue;
        $ing = [];
        foreach ($s[3] as $i) { $ii = rf_item_by_name($i[0]); if ($ii) $ing[] = ['id' => (int)$ii['id'], 'n' => $i[1]]; }
        $R['smelt'][] = ['out' => (int)$out['id'], 'n' => 1, 'lvl' => $s[1], 'xp' => $s[2], 'in' => $ing,
                         'name' => $s[0], 'fail' => $s[0] === 'Iron bar' ? 0.5 : 0.0];
    }

    $addLvl = ['dagger' => 0, 'sword' => 4, 'scimitar' => 5, 'longsword' => 6, 'mace' => 2,
               'battleaxe' => 10, 'greatsword' => 14, 'helm' => 1, 'shield' => 8,
               'body' => 18, 'legs' => 16, 'gloves' => 3, 'boots' => 3];
    $bars = ['dagger' => 1, 'sword' => 1, 'scimitar' => 2, 'longsword' => 2, 'mace' => 1,
             'battleaxe' => 3, 'greatsword' => 3, 'helm' => 1, 'shield' => 2,
             'body' => 5, 'legs' => 3, 'gloves' => 1, 'boots' => 1];
    $suffix = ['dagger' => 'dagger', 'sword' => 'sword', 'scimitar' => 'scimitar', 'longsword' => 'longsword',
               'mace' => 'mace', 'battleaxe' => 'battleaxe', 'greatsword' => 'greatsword',
               'helm' => 'helm', 'shield' => 'kiteshield', 'body' => 'platebody', 'legs' => 'platelegs',
               'gloves' => 'gauntlets', 'boots' => 'boots'];
    $tierBase = ['Bronze' => 1, 'Iron' => 15, 'Steel' => 30, 'Verdite' => 50, 'Kaldrite' => 70, 'Aetherium' => 85];
    foreach ($tierBase as $tn => $base) {
        $bar = rf_item_by_name($tn . ' bar');
        if (!$bar) continue;
        foreach ($suffix as $k => $sfx) {
            $out = rf_item_by_name($tn . ' ' . $sfx);
            if (!$out) continue;
            $R['smith'][] = [
                'out' => (int)$out['id'], 'n' => 1, 'name' => $out['name'],
                'lvl' => min(99, $base + $addLvl[$k]), 'xp' => $bars[$k] * 12.5 * (1 + $base / 40),
                'in' => [['id' => (int)$bar['id'], 'n' => $bars[$k]]], 'tier' => $tn
            ];
        }
        $arrow = rf_item_by_name($tn . ' arrow');
        if ($arrow) $R['smith'][] = ['out' => (int)$arrow['id'], 'n' => 15, 'name' => '15 x ' . $arrow['name'],
            'lvl' => min(99, $base + 4), 'xp' => 12.5 * (1 + $base / 40),
            'in' => [['id' => (int)$bar['id'], 'n' => 1]], 'tier' => $tn];
        $nails = rf_item_by_name($tn . ' nails');
        if ($nails) $R['smith'][] = ['out' => (int)$nails['id'], 'n' => 15, 'name' => '15 x ' . $nails['name'],
            'lvl' => min(99, $base + 2), 'xp' => 10.0 * (1 + $base / 40),
            'in' => [['id' => (int)$bar['id'], 'n' => 1]], 'tier' => $tn];
    }

    // crafting: leather, gems, jewellery, pottery, glass, spinning
    $craft = [
        ['Leather', 1, 5, [['Cowhide', 1]], 'tan'],
        ['Hard leather', 28, 9, [['Cowhide', 2]], 'tan'],
        ['Leather gloves', 1, 13.8, [['Leather', 1], ['Thread', 1]], 'needle'],
        ['Leather boots', 7, 16.2, [['Leather', 1], ['Thread', 1]], 'needle'],
        ['Leather cowl', 9, 18.5, [['Leather', 1], ['Thread', 1]], 'needle'],
        ['Leather body', 14, 25, [['Leather', 1], ['Thread', 1]], 'needle'],
        ['Leather chaps', 18, 27, [['Leather', 1], ['Thread', 1]], 'needle'],
        ['Hard leather body', 28, 35, [['Hard leather', 1], ['Thread', 1]], 'needle'],
        ['Bow string', 10, 15, [['Flax', 1]], 'wheel'],
        ['Ball of wool', 1, 2.5, [['Wool', 1]], 'wheel'],
        ['Unfired pot', 1, 6.3, [['Soft clay', 1]], 'potter'],
        ['Molten glass', 1, 20, [['Bucket of sand', 1]], 'furnace'],
        ['Gold ring', 5, 15, [['Gold bar', 1]], 'furnace'],
        ['Gold amulet', 8, 30, [['Gold bar', 1]], 'furnace'],
        ['Sapphire ring', 20, 40, [['Gold bar', 1], ['Sapphire', 1]], 'furnace'],
        ['Sapphire amulet', 24, 65, [['Gold bar', 1], ['Sapphire', 1]], 'furnace'],
        ['Emerald ring', 27, 55, [['Gold bar', 1], ['Emerald', 1]], 'furnace'],
        ['Emerald amulet', 31, 70, [['Gold bar', 1], ['Emerald', 1]], 'furnace'],
        ['Ruby ring', 34, 70, [['Gold bar', 1], ['Ruby', 1]], 'furnace'],
        ['Ruby amulet', 50, 85, [['Gold bar', 1], ['Ruby', 1]], 'furnace'],
        ['Diamond ring', 43, 85, [['Gold bar', 1], ['Diamond', 1]], 'furnace'],
        ['Diamond amulet', 70, 100, [['Gold bar', 1], ['Diamond', 1]], 'furnace']
    ];
    foreach ($craft as $c) {
        $out = rf_item_by_name($c[0]);
        if (!$out) continue;
        $ing = [];
        foreach ($c[3] as $i) { $ii = rf_item_by_name($i[0]); if ($ii) $ing[] = ['id' => (int)$ii['id'], 'n' => $i[1]]; }
        $R['craft'][] = ['out' => (int)$out['id'], 'n' => 1, 'name' => $c[0], 'lvl' => $c[1], 'xp' => $c[2], 'in' => $ing, 'station' => $c[4]];
    }
    // gem cutting
    foreach ($w['gems'] as $gem) {
        $raw = rf_item_by_name('Uncut ' . strtolower($gem['n']));
        $cut = rf_item_by_name($gem['n']);
        if ($raw && $cut) $R['craft'][] = ['out' => (int)$cut['id'], 'n' => 1, 'name' => 'Cut ' . $gem['n'],
            'lvl' => (int)$gem['lvl'], 'xp' => (int)$gem['lvl'] * 2.5,
            'in' => [['id' => (int)$raw['id'], 'n' => 1]], 'station' => 'chisel'];
    }

    // fletching
    foreach ($w['bowwood'] as $b) {
        $log = rf_item_by_name($b['n']);
        if (!$log) continue;
        foreach (['shortbow', 'longbow'] as $kind) {
            $nm = $b['p'] ? ($b['p'] . $kind) : (ucfirst($kind));
            $bow = rf_item_by_name($nm);
            if (!$bow) continue;
            $R['fletch'][] = ['out' => (int)$bow['id'], 'n' => 1, 'name' => $bow['name'],
                'lvl' => max(1, (int)$b['lvl'] + ($kind === 'longbow' ? 5 : 0)),
                'xp' => 10 * $b['mul'] * ($kind === 'longbow' ? 1.2 : 1),
                'in' => [['id' => (int)$log['id'], 'n' => 1], ['id' => (int)(rf_item_by_name('Bow string')['id']), 'n' => 1]],
                'station' => 'knife'];
        }
    }
    $shaft = rf_item_by_name('Arrow shaft');
    $logs = rf_item_by_name('Logs');
    if ($shaft && $logs) $R['fletch'][] = ['out' => (int)$shaft['id'], 'n' => 15, 'name' => '15 x Arrow shaft',
        'lvl' => 1, 'xp' => 5, 'in' => [['id' => (int)$logs['id'], 'n' => 1]], 'station' => 'knife'];

    // herblore
    foreach ($w['potions'] as $po) {
        $herb = rf_item_by_name($po['herb']);
        $sec = rf_item_by_name($po['sec']);
        $vial = rf_item_by_name('Vial of water');
        $unf = rf_item_by_name('Unfinished ' . strtolower($po['n']));
        $fin = rf_item_by_name($po['n']);
        if (!$herb || !$sec || !$vial || !$unf || !$fin) continue;
        $R['herb'][] = ['out' => (int)$unf['id'], 'n' => 1, 'name' => $unf['name'], 'lvl' => (int)$po['lvl'], 'xp' => 0,
            'in' => [['id' => (int)$herb['id'], 'n' => 1], ['id' => (int)$vial['id'], 'n' => 1]], 'station' => 'any'];
        $R['herb'][] = ['out' => (int)$fin['id'], 'n' => 1, 'name' => $fin['name'], 'lvl' => (int)$po['lvl'], 'xp' => (float)$po['xp'],
            'in' => [['id' => (int)$unf['id'], 'n' => 1], ['id' => (int)$sec['id'], 'n' => 1]], 'station' => 'any'];
    }
    // herb cleaning
    foreach ($w['herbs'] as $hh) {
        $grimy = rf_item_by_name('Grimy ' . strtolower($hh['n']));
        $clean = rf_item_by_name($hh['n']);
        if ($grimy && $clean) $R['herb'][] = ['out' => (int)$clean['id'], 'n' => 1, 'name' => 'Clean ' . $hh['n'],
            'lvl' => (int)$hh['lvl'], 'xp' => (float)$hh['xp'], 'in' => [['id' => (int)$grimy['id'], 'n' => 1]], 'station' => 'any'];
    }
    return $R;
}

function rf_op_make(array &$p): array {
    $book = rf_ps('book');
    $idx = rf_pi('i', -1);
    $count = max(1, min(28, rf_pi('n', 1)));
    $R = rf_recipes();
    if (!isset($R[$book])) return ['ok' => false, 'error' => 'Unknown craft.'];
    $rec = $R[$book][$idx] ?? null;
    if (!$rec) return ['ok' => false, 'error' => 'Unknown recipe.'];

    $skill = ['smelt' => 'smithing', 'smith' => 'smithing', 'craft' => 'crafting',
              'fletch' => 'fletching', 'herb' => 'herblore'][$book];
    $lvl = rf_skill_level($p, $skill);
    if ($lvl < (int)$rec['lvl']) return ['ok' => false, 'error' => 'You need ' . ucfirst($skill) . ' level ' . $rec['lvl'] . '.'];

    $made = 0; $failed = 0; $levels = [];
    for ($c = 0; $c < $count; $c++) {
        foreach ($rec['in'] as $i) if (rf_inv_count($p, (int)$i['id']) < (int)$i['n']) break 2;
        if (!rf_inv_can_add($p, (int)$rec['out'], (int)$rec['n'])) break;
        foreach ($rec['in'] as $i) rf_inv_remove($p, (int)$i['id'], (int)$i['n']);
        if (!empty($rec['fail']) && (mt_rand() / mt_getrandmax()) < (float)$rec['fail'] * max(0.1, 1 - ($lvl - $rec['lvl']) / 45)) {
            $failed++;
            continue;
        }
        rf_inv_add($p, (int)$rec['out'], (int)$rec['n']);
        $levels = array_merge($levels, rf_add_xp($p, $skill, (float)$rec['xp']));
        $made++;
    }
    if ($made === 0 && $failed === 0) return ['ok' => false, 'error' => 'You do not have the materials.'];
    $notes = [];
    if ($made) $notes[] = 'You make ' . $made . ' x ' . $rec['name'] . '.';
    if ($failed) $notes[] = 'The ore was too impure ' . $failed . ' time(s).';
    $notes = array_merge($notes, rf_quest_progress($p, 'inv', []));
    return rf_res(['made' => $made], $notes, $levels);
}

function rf_op_cook(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $onRange = rf_pi('range', 0) === 1;
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || !in_array('raw', $it['tags'] ?? [], true)) return ['ok' => false, 'error' => 'You cannot cook that.'];

    $w = rf_world();
    $base = substr($it['name'], 4);                 // "Raw shrimp" -> "shrimp"
    $spec = null;
    foreach ($w['fish'] as $f) if (strtolower($f['n']) === strtolower($base)) $spec = $f;
    $cookLvl = $spec ? (int)$spec['cook'] : 1;
    $xp = $spec ? (float)$spec['cxp'] : 30.0;
    $cookedName = $spec ? $spec['n'] : ucfirst($base);
    if (!$spec) {
        $map = ['beef' => ['Cooked beef', 1, 30], 'chicken' => ['Cooked chicken', 1, 30]];
        $mk = strtolower($base);
        if (!isset($map[$mk])) return ['ok' => false, 'error' => 'You cannot cook that.'];
        $cookedName = $map[$mk][0]; $cookLvl = $map[$mk][1]; $xp = $map[$mk][2];
    }
    $lvl = rf_skill_level($p, 'cooking');
    if ($lvl < $cookLvl) return ['ok' => false, 'error' => 'You need Cooking level ' . $cookLvl . ' for that.'];

    $burnStop = $cookLvl + 34 - ($onRange ? 6 : 0);
    $burnChance = $lvl >= $burnStop ? 0 : max(0.03, 0.55 - ($lvl - $cookLvl) * (0.52 / max(1, $burnStop - $cookLvl)));
    $burnt = (mt_rand() / mt_getrandmax()) < $burnChance;

    $outName = $burnt ? ('Burnt ' . strtolower($base)) : $cookedName;
    $out = rf_item_by_name($outName);
    if (!$out && $burnt) $out = rf_item_by_name('Burnt meat');
    if (!$out) return ['ok' => false, 'error' => 'Something went wrong cooking that.'];

    if ((int)$sl['n'] > 1) $p['inv'][$slotIdx]['n'] = (int)$sl['n'] - 1;
    else $p['inv'][$slotIdx] = null;
    rf_inv_add($p, (int)$out['id'], 1);
    $levels = $burnt ? [] : rf_add_xp($p, 'cooking', $xp);
    $notes = [$burnt ? 'You burn the ' . strtolower($base) . '.' : 'You cook the ' . strtolower($base) . '.'];
    $notes = array_merge($notes, rf_quest_progress($p, 'inv', []));
    return rf_res(['burnt' => $burnt], $notes, $levels);
}

function rf_op_fire(array &$p): array {
    $slotIdx = rf_pi('slot', -1);
    $sl = $p['inv'][$slotIdx] ?? null;
    if (!$sl) return ['ok' => false, 'error' => 'Nothing there.'];
    $it = rf_item((int)$sl['id']);
    if (!$it || !in_array('log', $it['tags'] ?? [], true)) return ['ok' => false, 'error' => 'That will not burn.'];
    $tb = rf_item_by_name('Tinderbox');
    if (!$tb || rf_inv_count($p, (int)$tb['id']) < 1) return ['ok' => false, 'error' => 'You need a tinderbox.'];
    $w = rf_world();
    $spec = null;
    foreach ($w['trees'] as $t) if ($t['n'] === $it['name']) $spec = $t;
    if (!$spec) return ['ok' => false, 'error' => 'That will not burn.'];
    $lvl = rf_skill_level($p, 'firemaking');
    if ($lvl < (int)$spec['fire']) return ['ok' => false, 'error' => 'You need Firemaking level ' . $spec['fire'] . '.'];
    if ((int)$sl['n'] > 1) $p['inv'][$slotIdx]['n'] = (int)$sl['n'] - 1;
    else $p['inv'][$slotIdx] = null;
    $levels = rf_add_xp($p, 'firemaking', (float)$spec['fxp']);
    return rf_res(['fire' => true, 'x' => $p['x'], 'z' => $p['z']], ['The logs catch light.'], $levels);
}

function rf_op_runecraft(array &$p): array {
    $oi = rf_pi('oi', -1);
    $o = rf_world_obj($oi);
    if (!$o || $o['t'] !== 'altar_rc') return ['ok' => false, 'error' => 'That is not a rune altar.'];
    if (hypot($p['x'] - $o['x'], $p['z'] - $o['z']) > 6) return ['ok' => false, 'error' => 'You are too far away.'];
    $w = rf_world();
    $spec = null;
    foreach ($w['runes'] as $r) if ($r['n'] === $o['rune']) $spec = $r;
    if (!$spec) return ['ok' => false, 'error' => 'The altar is silent.'];
    $lvl = rf_skill_level($p, 'runecraft');
    if ($lvl < (int)$spec['lvl']) return ['ok' => false, 'error' => 'You need Runecraft level ' . $spec['lvl'] . '.'];
    $ess = rf_item_by_name('Rune essence');
    $pure = rf_item_by_name('Pure essence');
    $useId = 0;
    if ($pure && rf_inv_count($p, (int)$pure['id']) > 0) $useId = (int)$pure['id'];
    elseif ($ess && rf_inv_count($p, (int)$ess['id']) > 0) $useId = (int)$ess['id'];
    if (!$useId) return ['ok' => false, 'error' => 'You have no essence.'];
    $have = rf_inv_count($p, $useId);
    $rune = rf_item_by_name($spec['n'] . ' rune');
    $mult = 1 + (int)floor($lvl / 25);
    rf_inv_remove($p, $useId, $have);
    rf_inv_add($p, (int)$rune['id'], $have * $mult);
    $levels = rf_add_xp($p, 'runecraft', (float)$spec['xp'] * $have);
    $notes = array_merge(['You bind ' . ($have * $mult) . ' ' . strtolower($spec['n']) . ' runes.'], rf_quest_progress($p, 'inv', []));
    return rf_res([], $notes, $levels);
}

/* -------------------------------------------------------------- farming */
function rf_op_farm(array &$p): array {
    $oi = rf_pi('oi', -1);
    $o = rf_world_obj($oi);
    if (!$o || $o['t'] !== 'patch') return ['ok' => false, 'error' => 'That is not a patch.'];
    if (hypot($p['x'] - $o['x'], $p['z'] - $o['z']) > 6) return ['ok' => false, 'error' => 'You are too far away.'];
    $sub = rf_ps('sub');
    $farm = (array)$p['farm'];
    $key = (string)$oi;
    $now = time();
    $w = rf_world();

    if ($sub === 'plant') {
        if (isset($farm[$key])) return ['ok' => false, 'error' => 'Something is already growing there.'];
        $seedId = rf_pi('id', 0);
        $seed = rf_item($seedId);
        if (!$seed || !in_array('seed', $seed['tags'] ?? [], true)) return ['ok' => false, 'error' => 'That is not a seed.'];
        if (rf_inv_count($p, $seedId) < 1) return ['ok' => false, 'error' => 'You have no such seed.'];
        $isHerb = in_array('herbseed', $seed['tags'] ?? [], true);
        if ($isHerb && ($o['kind'] ?? '') !== 'herb') return ['ok' => false, 'error' => 'Herb seeds need a herb patch.'];
        if (!$isHerb && ($o['kind'] ?? '') !== 'allotment') return ['ok' => false, 'error' => 'That seed needs an allotment.'];

        $base = str_replace(' seed', '', $seed['name']);
        $spec = null;
        foreach ($w['crops'] as $c) if ($c['n'] === $base) $spec = $c;
        $herbSpec = null;
        foreach ($w['herbs'] as $hh) if ($hh['n'] === $base) $herbSpec = $hh;
        $lvl = rf_skill_level($p, 'farming');
        $need = $spec ? (int)$spec['lvl'] : ($herbSpec ? (int)$herbSpec['lvl'] : 1);
        if ($lvl < $need) return ['ok' => false, 'error' => 'You need Farming level ' . $need . '.'];
        $grow = $spec ? (int)$spec['grow'] : 300;
        rf_inv_remove($p, $seedId, 1);
        $farm[$key] = ['seed' => $seedId, 'at' => $now, 'ready' => $now + $grow, 'crop' => $base];
        $p['farm'] = $farm;
        rf_add_xp($p, 'farming', 4.0);
        return rf_res([], ['You plant the ' . strtolower($seed['name']) . '. Come back in a few minutes.']);
    }
    if ($sub === 'harvest') {
        $e = $farm[$key] ?? null;
        if (!$e) return ['ok' => false, 'error' => 'Nothing is growing there.'];
        if ($now < (int)$e['ready']) {
            $left = (int)$e['ready'] - $now;
            return ['ok' => false, 'error' => 'Not ready for another ' . ceil($left / 60) . ' minute(s).'];
        }
        $crop = rf_item_by_name($e['crop']);
        if (!$crop) { unset($farm[$key]); $p['farm'] = $farm; return ['ok' => false, 'error' => 'The crop failed.']; }
        $spec = null;
        foreach ($w['crops'] as $c) if ($c['n'] === $e['crop']) $spec = $c;
        $herbSpec = null;
        foreach ($w['herbs'] as $hh) if ($hh['n'] === $e['crop']) $herbSpec = $hh;
        $qty = mt_rand(3, 6);
        if (!rf_inv_can_add($p, (int)$crop['id'], $qty)) return ['ok' => false, 'error' => 'Your pack is full.'];
        rf_inv_add($p, (int)$crop['id'], $qty);
        $xp = $spec ? (float)$spec['xp'] * $qty : ($herbSpec ? (float)$herbSpec['xp'] * $qty * 3 : 10.0 * $qty);
        $levels = rf_add_xp($p, 'farming', $xp);
        unset($farm[$key]);
        $p['farm'] = $farm;
        $notes = array_merge(['You harvest ' . $qty . ' x ' . $crop['name'] . '.'], rf_quest_progress($p, 'inv', []));
        return rf_res([], $notes, $levels);
    }
    return ['ok' => false, 'error' => 'Unknown farming action.'];
}

/* ------------------------------------------------------------- thieving */
function rf_op_thieve(array &$p): array {
    $key = rf_ps('npc');
    $types = rf_npc_types();
    $npc = $types[$key] ?? null;
    if (!$npc || ($npc['kind'] ?? '') !== 'npc') return ['ok' => false, 'error' => 'You cannot steal from that.'];
    $now = rf_now();
    if (($now - (float)($p['lastThieve'] ?? 0)) < 2.4) return ['ok' => false, 'error' => 'wait'];
    $p['lastThieve'] = $now;
    $lvl = rf_skill_level($p, 'thieving');
    $need = 1;
    if (($npc['role'] ?? '') === 'Banker') $need = 45;
    elseif (in_array(($npc['role'] ?? ''), ['Guard', 'City Guard'], true)) $need = 40;
    elseif (($npc['role'] ?? '') === 'Shopkeeper') $need = 25;
    if ($lvl < $need) return ['ok' => false, 'error' => 'You need Thieving level ' . $need . ' to pickpocket them.'];

    $chance = min(0.9, 0.30 + ($lvl - $need) * 0.012);
    if ((mt_rand() / mt_getrandmax()) > $chance) {
        $dmg = mt_rand(1, 3);
        $p['hp'] = max(0, (int)$p['hp'] - $dmg);
        return rf_res(['caught' => true, 'dmg' => $dmg], ['You are caught! ' . $npc['name'] . ' shoves you away.']);
    }
    $coins = mt_rand(8, 20) + $need * mt_rand(2, 6);
    rf_give_coins($p, $coins);
    $levels = rf_add_xp($p, 'thieving', 8.0 + $need * 1.8);
    $notes = ['You lift ' . $coins . ' coins.'];
    // the purse quest wants specific loot
    $purse = rf_item_by_name('Stolen purse');
    if ($purse && rf_quest_state($p, 'thief') !== null && !rf_quest_done($p, 'thief')
        && rf_inv_count($p, (int)$purse['id']) < 3 && mt_rand(1, 100) <= 45
        && rf_inv_can_add($p, (int)$purse['id'], 1)) {
        rf_inv_add($p, (int)$purse['id'], 1);
        $notes[] = 'You also lift a distinctive purse.';
        $notes = array_merge($notes, rf_quest_progress($p, 'inv', []));
    }
    return rf_res(['coins' => $coins], $notes, $levels);
}

/* -------------------------------------------------------------- agility */
function rf_op_agility(array &$p): array {
    $oi = rf_pi('oi', -1);
    $o = rf_world_obj($oi);
    if (!$o || $o['t'] !== 'agility') return ['ok' => false, 'error' => 'Not an obstacle.'];
    if (hypot($p['x'] - $o['x'], $p['z'] - $o['z']) > 7) return ['ok' => false, 'error' => 'You are too far away.'];
    $lvl = rf_skill_level($p, 'agility');
    if ($lvl < (int)$o['lvl']) return ['ok' => false, 'error' => 'You need Agility level ' . $o['lvl'] . '.'];
    $now = rf_now();
    if (($now - (float)($p['lastAgil'] ?? 0)) < 1.5) return ['ok' => false, 'error' => 'wait'];
    $p['lastAgil'] = $now;

    $prog = (array)($p['seen'] ?? []);
    $expect = (int)($prog['ag_next'] ?? 0);
    $notes = [];
    $xp = (float)$o['xp'];
    $levels = [];
    if ((int)$o['ord'] === $expect) {
        $prog['ag_next'] = $expect + 1;
        if ($prog['ag_next'] >= 6) {
            $prog['ag_next'] = 0;
            $xp += 55;
            $notes[] = 'Lap complete!';
            $prog['ag_laps'] = (int)($prog['ag_laps'] ?? 0) + 1;
        }
    } else {
        $prog['ag_next'] = ((int)$o['ord'] === 0) ? 1 : $expect;
        $xp *= 0.4;
    }
    $p['seen'] = $prog;
    $levels = rf_add_xp($p, 'agility', $xp);
    // step the player past the obstacle
    return rf_res(['pass' => true, 'obst' => $o['o']], array_merge(['You cross the obstacle.'], $notes), $levels);
}

/* -------------------------------------------------------------- prayers */
function rf_op_prayer(array &$p): array {
    $pid = rf_ps('id');
    $prs = rf_prayers();
    $pr = $prs[$pid] ?? null;
    if (!$pr) return ['ok' => false, 'error' => 'Unknown prayer.'];
    if (rf_skill_level($p, 'prayer') < (int)$pr['lvl']) return ['ok' => false, 'error' => 'You need Prayer level ' . $pr['lvl'] . '.'];
    $act = array_values((array)($p['prayers'] ?? []));
    if (in_array($pid, $act, true)) {
        $act = array_values(array_filter($act, fn($x) => $x !== $pid));
    } else {
        if ((int)$p['pray'] <= 0) return ['ok' => false, 'error' => 'You have run out of prayer points.'];
        // protection prayers are mutually exclusive, as are same-stat boosts
        foreach ($act as $other) {
            $op = $prs[$other] ?? null;
            if (!$op) continue;
            $clash = false;
            foreach (['attack','strength','defence','ranged','magic','protect'] as $st)
                if (isset($op['eff'][$st]) && isset($pr['eff'][$st])) $clash = true;
            if ($clash) $act = array_values(array_filter($act, fn($x) => $x !== $other));
        }
        $act[] = $pid;
    }
    $p['prayers'] = $act;
    return rf_res(['prayers' => $act]);
}

function rf_op_style(array &$p): array {
    $s = rf_ps('style');
    if (!in_array($s, ['accurate','aggressive','defensive','controlled'], true)) return ['ok' => false, 'error' => 'Unknown style.'];
    $p['style'] = $s;
    $ac = rf_p('autocast');
    if ($ac === null || $ac === '' || $ac === false) $p['autocast'] = null;
    elseif (isset(rf_spells()[$ac])) $p['autocast'] = $ac;
    return rf_res();
}

/* ---------------------------------------------------------------- magic */
function rf_op_cast(array &$p, int $aid): array {
    $sid = rf_ps('spell');
    $spell = rf_spells()[$sid] ?? null;
    if (!$spell) return ['ok' => false, 'error' => 'Unknown spell.'];
    $missing = rf_spell_missing($p, $spell);
    if ($missing) return ['ok' => false, 'error' => 'You need ' . $missing . '.'];

    if (isset($spell['tele'])) {
        rf_spend_runes($p, $spell);
        $p['x'] = (float)$spell['tele']['x']; $p['z'] = (float)$spell['tele']['z'];
        $lv = rf_add_xp($p, 'magic', (float)$spell['xp']);
        $n = array_merge(['You teleport away.'], rf_quest_progress($p, 'move', ['x' => $p['x'], 'z' => $p['z']]));
        return rf_res(['tele' => $spell['tele']], $n, $lv);
    }
    if (isset($spell['alch'])) {
        $slotIdx = rf_pi('slot', -1);
        $sl = $p['inv'][$slotIdx] ?? null;
        if (!$sl) return ['ok' => false, 'error' => 'Choose an item to transmute.'];
        $it = rf_item((int)$sl['id']);
        if (!$it || empty($it['trade'])) return ['ok' => false, 'error' => 'That cannot be transmuted.'];
        if (in_array('currency', $it['tags'] ?? [], true)) return ['ok' => false, 'error' => 'That is already money.'];
        rf_spend_runes($p, $spell);
        $gain = max(1, (int)round((int)$it['value'] * (float)$spell['alch']));
        if ((int)$sl['n'] > 1) $p['inv'][$slotIdx]['n'] = (int)$sl['n'] - 1;
        else $p['inv'][$slotIdx] = null;
        rf_give_coins($p, $gain);
        $lv = rf_add_xp($p, 'magic', (float)$spell['xp']);
        return rf_res(['gold' => $gain], ['The ' . strtolower($it['name']) . ' becomes ' . $gain . ' coins.'], $lv);
    }
    return ['ok' => false, 'error' => 'Select a target for that spell.'];
}

/* --------------------------------------------------------------- slayer */
function rf_op_slayer(array &$p): array {
    $sub = rf_ps('sub');
    if ($sub === 'assign') {
        if (!empty($p['slayer']) && empty($p['slayer']['done'])) {
            return ['ok' => false, 'error' => 'You already have an assignment: ' . $p['slayer']['left'] . ' ' . $p['slayer']['name'] . '.'];
        }
        $cl = rf_combat_level($p);
        $cands = [];
        foreach (rf_npc_types() as $k => $n) {
            if (($n['kind'] ?? '') !== 'monster' || !empty($n['boss'])) continue;
            if ((int)$n['lvl'] > $cl + 12) continue;
            $cands[] = [$k, $n];
        }
        if (!$cands) return ['ok' => false, 'error' => 'Nothing suitable to hunt.'];
        $pick = $cands[array_rand($cands)];
        $n = mt_rand(12, 32);
        $p['slayer'] = ['npc' => $pick[0], 'name' => $pick[1]['name'], 'left' => $n, 'total' => $n];
        return rf_res(['slayer' => $p['slayer']], ['Your task: kill ' . $n . ' ' . $pick[1]['name'] . '.']);
    }
    if ($sub === 'check') {
        if (empty($p['slayer'])) return rf_res([], ['You have no assignment.']);
        if (!empty($p['slayer']['done'])) {
            $rew = 300 + rf_skill_level($p, 'slayer') * 60;
            rf_give_coins($p, $rew);
            $lv = rf_add_xp($p, 'slayer', 120.0);
            $p['slayer'] = null;
            return rf_res([], ['Well done. Here is ' . $rew . ' coins.'], $lv);
        }
        return rf_res([], [$p['slayer']['left'] . ' ' . $p['slayer']['name'] . ' left to kill.']);
    }
    return ['ok' => false, 'error' => 'Unknown slayer action.'];
}

/* ------------------------------------------------------------- dialogue */
function rf_op_dialogue(array &$p): array {
    // Talking to a quest NPC is what advances "talk" stages and hands out rewards.
    $key = rf_ps('npc');
    $notes = []; $levels = []; $completed = null;
    foreach (rf_quests() as $qid => $q) {
        $st = rf_quest_state($p, $qid);
        if ($st === null || $st === 'done') continue;
        $stage = $q['stages'][$st] ?? null;
        if (!$stage || $stage['t'] !== 'talk' || ($stage['npc'] ?? '') !== $key) continue;
        $isLast = ($st === count($q['stages']) - 1);
        if ($isLast) {
            $r = rf_quest_complete($p, $qid);
            $notes = array_merge($notes, $r['notes']);
            $levels = array_merge($levels, $r['levels']);
            $completed = $qid;
        } else {
            $p['quests'] = (array)$p['quests'];
            $p['quests'][$qid] = $st + 1;
            $nx = $q['stages'][$st + 1] ?? null;
            $notes[] = 'Quest updated: ' . $q['name'];
            if ($nx && isset($nx['j'])) $notes[] = $nx['j'];
            // hand over any quest item this stage is supposed to give
            rf_grant_stage_items($p, $qid, $st + 1, $notes);
        }
    }
    $notes = array_merge($notes, rf_quest_progress($p, 'inv', []));
    return rf_res(['completed' => $completed], $notes, $levels);
}

/* Some quest stages need an item in hand to be possible; give it on arrival. */
function rf_grant_stage_items(array &$p, string $qid, int $stageIdx, array &$notes): void {
    $q = rf_quests()[$qid] ?? null;
    if (!$q) return;
    $stage = $q['stages'][$stageIdx] ?? null;
    if (!$stage || $stage['t'] !== 'collect') return;
    $it = rf_item_by_name($stage['item']);
    if (!$it || empty($it['quest'])) return;              // only hand over quest items
    if (rf_inv_count($p, (int)$it['id']) >= (int)$stage['n']) return;
    // quest items that are "found" in the world are granted when the player
    // reaches the stage that needs them, so a quest can never dead-end
    $need = (int)$stage['n'] - rf_inv_count($p, (int)$it['id']);
    if (rf_inv_can_add($p, (int)$it['id'], $need)) {
        rf_inv_add($p, (int)$it['id'], $need);
        $notes[] = 'You receive: ' . $it['name'] . '.';
    }
}

function rf_op_quest_start(array &$p): array {
    $qid = rf_ps('quest');
    $q = rf_quests()[$qid] ?? null;
    if (!$q) return ['ok' => false, 'error' => 'Unknown quest.'];
    if (rf_quest_state($p, $qid) !== null) return ['ok' => false, 'error' => 'You have already begun that.'];
    $missing = rf_quest_eligible($p, $q);
    if ($missing) return ['ok' => false, 'error' => 'You need ' . implode(', ', $missing) . ' first.'];
    $p['quests'] = (array)$p['quests'];
    $p['quests'][$qid] = 1;                         // stage 0 is the intro talk
    $notes = ['Quest started: ' . $q['name']];
    if (isset($q['stages'][1]['j'])) $notes[] = $q['stages'][1]['j'];
    rf_grant_stage_items($p, $qid, 1, $notes);
    $notes = array_merge($notes, rf_quest_progress($p, 'inv', []));
    return rf_res([], $notes);
}

/* ---------------------------------------------------------- home teleport */
/* Free, needs no runes and no Magic level: somewhere to run to. Has a cool
   down so it cannot be used to escape a fight you are losing. */
function rf_op_home(array &$p): array {
    $now = rf_now();
    $last = (float)($p['lastHome'] ?? 0);
    $cool = 180.0;
    if ($now - $last < $cool) {
        $left = (int)ceil($cool - ($now - $last));
        return ['ok' => false, 'error' => 'You must gather your focus for another ' . $left . ' second(s).'];
    }
    if ($now - (float)($p['lastCombat'] ?? 0) < 10.0) {
        return ['ok' => false, 'error' => 'You cannot concentrate while you are under attack.'];
    }
    $w2 = rf_world();
    $sp = $w2['homePoint'] ?? $w2['spawnPoint'];
    $p['lastHome'] = $now;
    $p['x'] = (float)$sp['x'];
    $p['z'] = (float)$sp['z'];
    $p['warp'] = $now;              // sync must not argue with this
    return rf_res(['tele' => ['x' => (float)$sp['x'], 'z' => (float)$sp['z']], 'home' => 1],
                  ['You focus on the standing stone at Oakheart and the world folds around you.']);
}

/* --------------------------------------------------------- prayer altar */
function rf_op_recharge(array &$p): array {
    $near = null;
    foreach (rf_world()['objects'] as $o) {
        if ($o['t'] !== 'altar') continue;
        if (hypot($p['x'] - $o['x'], $p['z'] - $o['z']) <= 6) { $near = $o; break; }
    }
    if (!$near) return ['ok' => false, 'error' => 'You need to be at an altar.'];
    $max = rf_skill_level($p, 'prayer');
    if ((int)$p['pray'] >= $max) return rf_res([], ['You are already at peace.']);
    $p['pray'] = $max;
    return rf_res(['recharged' => 1], ['You pray at the altar. Your prayer points are restored.']);
}

/* ------------------------------------------------------- recipe catalogue */
function rf_a_recipes(): void {
    rf_require_session();
    rf_ok(['recipes' => rf_recipes()]);
}

/* -------------------------------------------------------- construction */
function rf_op_construct(array &$p): array {
    $hammer = rf_item_by_name('Hammer');
    if (!$hammer || rf_inv_count($p, (int)$hammer['id']) < 1) return ['ok' => false, 'error' => 'You need a hammer.'];
    $logs = rf_item_by_name('Logs');
    if (!$logs || rf_inv_count($p, (int)$logs['id']) < 2) return ['ok' => false, 'error' => 'You need 2 logs.'];
    $nails = null;
    foreach (rf_items() as $it) {
        if (stripos($it['name'], ' nails') !== false && rf_inv_count($p, (int)$it['id']) >= 3) { $nails = $it; break; }
    }
    if (!$nails) return ['ok' => false, 'error' => 'You need 3 nails of any metal.'];
    $now = rf_now();
    if (($now - (float)($p['lastBuild'] ?? 0)) < 1.6) return ['ok' => false, 'error' => 'wait'];
    $p['lastBuild'] = $now;
    rf_inv_remove($p, (int)$logs['id'], 2);
    rf_inv_remove($p, (int)$nails['id'], 3);
    $lvl = rf_skill_level($p, 'construction');
    $levels = rf_add_xp($p, 'construction', 25.0 + $lvl * 2.0);
    return rf_res(['built' => 1], ['You knock together a sturdy camp bench.'], $levels);
}

/* ---------------------------------------------------------------- loot */
function rf_op_loot(array &$p): array {
    return ['ok' => false, 'error' => 'Walk over what you want and take it.'];
}

/* Serves a file out of /assets through PHP. Many shared hosts refuse direct
   web access to asset directories - the same thing that blocked /data/ early
   on - and when that happens every texture and model silently fails and the
   game falls back to its built-in shapes. This gives the client a route that
   always works. */
function rf_a_asset(): void {
    $rel = (string)($_GET['f'] ?? '');
    $rel = str_replace('\\', '/', $rel);
    if ($rel === '' || strpos($rel, '..') !== false || $rel[0] === '/') {
        http_response_code(400); exit('bad path');
    }
    $full = RF_ROOT . '/assets/' . $rel;
    $real = realpath($full);
    $base = realpath(RF_ROOT . '/assets');
    if ($real === false || $base === false || strpos($real, $base) !== 0) {
        http_response_code(404); exit('not found');
    }
    $ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
    $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
              'glb' => 'model/gltf-binary', 'json' => 'application/json'];
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($real));
    header('Cache-Control: public, max-age=604800');
    readfile($real);
}

/* ========================================================== ground items */
/* Server-authoritative. Every item on the floor lives in the shared world
   record, so two players standing over the same pile see the same pile. */
function rf_ground_drop(array $drops, float $x, float $z, int $ownerAid): void {
    $now = rf_now();
    rf_store()->mutate('world', function ($cur) use ($drops, $x, $z, $ownerAid, $now) {
        $w = is_array($cur) ? $cur : ['obj' => [], 'npc' => [], 'ground' => [], 'seq' => 0];
        if (!isset($w['ground']) || !is_array($w['ground'])) $w['ground'] = [];
        $gid = (int)($w['gid'] ?? 0);
        $n = 0;
        foreach ($drops as $d) {
            /* spread a multi-item drop over neighbouring tiles so the pile is
               readable rather than one icon hiding five */
            $ang = $n * 1.7;
            $w['ground'][] = [
                'g'     => ++$gid,
                'id'    => (int)$d[0],
                'n'     => (int)$d[1],
                'x'     => round($x + cos($ang) * min(0.9, 0.35 * $n), 2),
                'z'     => round($z + sin($ang) * min(0.9, 0.35 * $n), 2),
                'own'   => $ownerAid,
                'pub'   => $now + RF_GROUND_PRIVATE,
                'until' => $now + RF_GROUND_LIFE
            ];
            $n++;
        }
        $w['gid'] = $gid;
        /* never let the floor grow without bound */
        if (count($w['ground']) > 400) $w['ground'] = array_slice($w['ground'], -400);
        return ['__value' => $w];
    });
}

/* What is lying near a player, filtered by ownership. */
function rf_ground_near(array $w, float $x, float $z, int $aid, float $range = 30.0): array {
    $now = rf_now();
    $out = [];
    foreach ((array)($w['ground'] ?? []) as $g) {
        if (($g['until'] ?? 0) <= $now) continue;
        if (hypot($x - $g['x'], $z - $g['z']) > $range) continue;
        /* somebody else's kill stays invisible until it goes public */
        if (!empty($g['own']) && (int)$g['own'] !== $aid && ($g['pub'] ?? 0) > $now) continue;
        $out[] = ['g' => (int)$g['g'], 'id' => (int)$g['id'], 'n' => (int)$g['n'],
                  'x' => (float)$g['x'], 'z' => (float)$g['z'],
                  'mine' => (!empty($g['own']) && (int)$g['own'] === $aid) ? 1 : 0];
    }
    return $out;
}

function rf_op_take(array &$p, int $aid): array {
    $gid = rf_pi('g', 0);
    $px = (float)$p['x']; $pz = (float)$p['z'];
    $taken = rf_store()->mutate('world', function ($cur) use ($gid, $px, $pz, $aid) {
        $w = is_array($cur) ? $cur : ['ground' => []];
        if (!isset($w['ground']) || !is_array($w['ground'])) $w['ground'] = [];
        $now = rf_now();
        foreach ($w['ground'] as $i => $g) {
            if ((int)$g['g'] !== $gid) continue;
            if (($g['until'] ?? 0) <= $now) return ['__value' => $w, '__return' => ['gone' => 1]];
            if (hypot($px - $g['x'], $pz - $g['z']) > 3.0) return ['__value' => $w, '__return' => ['far' => 1]];
            if (!empty($g['own']) && (int)$g['own'] !== $aid && ($g['pub'] ?? 0) > $now) {
                return ['__value' => $w, '__return' => ['owned' => 1]];
            }
            array_splice($w['ground'], $i, 1);
            return ['__value' => $w, '__return' => ['id' => (int)$g['id'], 'n' => (int)$g['n']]];
        }
        return ['__value' => $w, '__return' => ['gone' => 1]];
    });
    if (!is_array($taken) || !empty($taken['gone'])) return ['ok' => false, 'error' => 'It is no longer there.'];
    if (!empty($taken['far'])) return ['ok' => false, 'error' => 'You need to stand over it.'];
    if (!empty($taken['owned'])) return ['ok' => false, 'error' => 'That is not yours to take yet.'];

    if (!rf_inv_can_add($p, (int)$taken['id'], (int)$taken['n'])) {
        /* put it straight back rather than destroying it */
        rf_ground_drop([[$taken['id'], $taken['n']]], (float)$p['x'], (float)$p['z'], $aid);
        return ['ok' => false, 'error' => 'Your pack is full.'];
    }
    rf_inv_add($p, (int)$taken['id'], (int)$taken['n']);
    $it = rf_item((int)$taken['id']);
    return rf_res(['took' => $gid], ['You pick up ' .
        ((int)$taken['n'] > 1 ? $taken['n'] . ' x ' : '') . ($it['name'] ?? 'something') . '.']);
}

/* Dropping from the inventory puts the item on the floor too. */
function rf_op_drop_ground(array &$p, int $aid): array {
    $slot = rf_pi('slot', -1);
    if ($slot < 0 || $slot >= 28 || empty($p['inv'][$slot])) return ['ok' => false, 'error' => 'Nothing there.'];
    $row = $p['inv'][$slot];
    $id = (int)$row['id']; $n = (int)$row['n'];
    rf_inv_remove($p, $id, $n);
    rf_ground_drop([[$id, $n]], (float)$p['x'], (float)$p['z'], $aid);
    $it = rf_item($id);
    return rf_res([], ['You drop the ' . strtolower($it['name'] ?? 'item') . '.']);
}

/* ================================================================ trade */
/* Two-stage confirmation. Items never move until both sides have accepted
   twice and the server has re-verified that each player still holds them. */
function rf_trade_op(int $aid, string $op): void {
    $st = rf_store();
    switch ($op) {
        case 'trade_offer': {
            $to = rf_pi('to', 0);
            if ($to === $aid || $to <= 0) rf_err('You cannot trade with yourself.');
            $other = $st->get('pres:' . $to);
            if (!$other || (rf_now() - (float)$other['t']) > RF_PRESENCE_TTL) rf_err('That player is not online.');
            $me = $st->get('pres:' . $aid);
            if (!$me || hypot((float)$me['x'] - (float)$other['x'], (float)$me['z'] - (float)$other['z']) > 8)
                rf_err('You need to stand next to them.');
            $existing = $st->get('trade:' . $aid);
            if ($existing && ($existing['state'] ?? '') !== 'closed') rf_err('You are already trading.');
            $tid = bin2hex(random_bytes(8));
            $rec = ['id' => $tid, 'a' => $aid, 'b' => $to, 'an' => $me['n'], 'bn' => $other['n'],
                    'ai' => [], 'bi' => [], 'aa' => 0, 'ba' => 0, 'stage' => 1, 'state' => 'open', 't' => rf_now()];
            $st->put('trade:' . $aid, $rec);
            $st->put('trade:' . $to, $rec);
            rf_ok(['trade' => $rec]);
        }
        case 'trade_put': {
            $slotIdx = rf_pi('slot', -1);
            $n = rf_pi('n', 1);
            rf_trade_mutate($aid, function (array &$t, string $side) use ($aid, $slotIdx, $n) {
                $p = rf_store()->get('player:' . $aid);
                $sl = $p['inv'][$slotIdx] ?? null;
                if (!$sl) return 'Nothing in that slot.';
                $it = rf_item((int)$sl['id']);
                if (!$it || empty($it['trade'])) return 'That item cannot be traded.';
                $list = $t[$side . 'i'];
                $qty = $n < 0 ? (int)$sl['n'] : min($n, (int)$sl['n']);
                $found = false;
                foreach ($list as $i => $e) {
                    if ((int)$e['id'] === (int)$sl['id']) { $list[$i]['n'] = min((int)$e['n'] + $qty, rf_inv_count($p, (int)$sl['id'])); $found = true; break; }
                }
                if (!$found) {
                    if (count($list) >= 12) return 'You cannot offer more than twelve stacks.';
                    $list[] = ['id' => (int)$sl['id'], 'n' => $qty];
                }
                $t[$side . 'i'] = $list;
                $t['aa'] = 0; $t['ba'] = 0; $t['stage'] = 1;    // any change resets acceptance
                return null;
            });
        }
        case 'trade_take': {
            $id = rf_pi('id', 0);
            rf_trade_mutate($aid, function (array &$t, string $side) use ($id) {
                $t[$side . 'i'] = array_values(array_filter($t[$side . 'i'], fn($e) => (int)$e['id'] !== $id));
                $t['aa'] = 0; $t['ba'] = 0; $t['stage'] = 1;
                return null;
            });
        }
        case 'trade_accept': {
            rf_trade_mutate($aid, function (array &$t, string $side) {
                $t[$side . 'a'] = 1;
                if ($t['aa'] && $t['ba']) {
                    if ($t['stage'] === 1) { $t['stage'] = 2; $t['aa'] = 0; $t['ba'] = 0; }
                    else $t['state'] = 'confirm';
                }
                return null;
            });
        }
        case 'trade_cancel': {
            $t = $st->get('trade:' . $aid);
            if ($t) {
                $st->del('trade:' . (int)$t['a']);
                $st->del('trade:' . (int)$t['b']);
            }
            rf_ok(['cancelled' => true]);
        }
        case 'trade_state': {
            rf_ok(['trade' => $st->get('trade:' . $aid)]);
        }
    }
    rf_err('Unknown trade operation.');
}

function rf_trade_mutate(int $aid, callable $fn): void {
    $st = rf_store();
    $t = $st->get('trade:' . $aid);
    if (!is_array($t) || ($t['state'] ?? '') === 'closed') rf_err('No active trade.');
    $side = ((int)$t['a'] === $aid) ? 'a' : 'b';
    $err = $fn($t, $side);
    if ($err) rf_err($err);
    $t['t'] = rf_now();

    if (($t['state'] ?? '') === 'confirm') {
        $done = rf_trade_settle($t);
        if ($done !== true) { rf_err($done); }
        $t['state'] = 'closed';
        $st->put('trade:' . (int)$t['a'], $t);
        $st->put('trade:' . (int)$t['b'], $t);
        rf_ok(['trade' => $t, 'done' => true]);
    }
    $st->put('trade:' . (int)$t['a'], $t);
    $st->put('trade:' . (int)$t['b'], $t);
    rf_ok(['trade' => $t]);
}

/* Moves the goods. Re-checks both inventories first so nothing can be
   duplicated by offering an item and then dropping it. */
function rf_trade_settle(array $t) {
    $st = rf_store();
    $A = (int)$t['a']; $B = (int)$t['b'];
    $pa = $st->get('player:' . $A); $pb = $st->get('player:' . $B);
    if (!is_array($pa) || !is_array($pb)) return 'A trader vanished.';
    $pa = rf_normalise_player($pa, $pa['name'] ?? ''); $pb = rf_normalise_player($pb, $pb['name'] ?? '');

    foreach ($t['ai'] as $e) if (rf_inv_count($pa, (int)$e['id']) < (int)$e['n']) return $t['an'] . ' no longer has those items.';
    foreach ($t['bi'] as $e) if (rf_inv_count($pb, (int)$e['id']) < (int)$e['n']) return $t['bn'] . ' no longer has those items.';

    // space check after removing what each side gives away
    $tmpA = $pa; $tmpB = $pb;
    foreach ($t['ai'] as $e) rf_inv_remove($tmpA, (int)$e['id'], (int)$e['n']);
    foreach ($t['bi'] as $e) rf_inv_remove($tmpB, (int)$e['id'], (int)$e['n']);
    foreach ($t['bi'] as $e) if (!rf_inv_can_add($tmpA, (int)$e['id'], (int)$e['n'])) return $t['an'] . ' does not have room.';
    foreach ($t['ai'] as $e) if (!rf_inv_can_add($tmpB, (int)$e['id'], (int)$e['n'])) return $t['bn'] . ' does not have room.';
    foreach ($t['bi'] as $e) rf_inv_add($tmpA, (int)$e['id'], (int)$e['n']);
    foreach ($t['ai'] as $e) rf_inv_add($tmpB, (int)$e['id'], (int)$e['n']);

    $st->put('player:' . $A, $tmpA);
    $st->put('player:' . $B, $tmpB);
    return true;
}
