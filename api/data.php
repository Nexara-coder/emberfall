<?php
/* Emberfall - game data + rules. Everything that decides an outcome
   (XP, damage, loot, prices, level requirements) lives here on the server.
   The browser is only ever told what happened. */
declare(strict_types=1);

/* ------------------------------------------------------------ data files */
function rf_load(string $name) {
    static $cache = [];
    if (isset($cache[$name])) return $cache[$name];
    $f = RF_DATA . '/' . $name . '.json';
    if (!is_readable($f)) throw new \RuntimeException('missing data file: ' . $name . '.json');
    $d = json_decode(file_get_contents($f), true);
    if ($d === null) throw new \RuntimeException('corrupt data file: ' . $name . '.json');
    return $cache[$name] = $d;
}
function rf_items(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('items') as $it) $ix[(int)$it['id']] = $it;
    return $ix;
}
function rf_item(int $id): ?array { $i = rf_items(); return $i[$id] ?? null; }
function rf_item_by_name(string $n): ?array {
    static $byName = null;
    if ($byName === null) { $byName = []; foreach (rf_items() as $it) $byName[strtolower($it['name'])] = $it; }
    return $byName[strtolower($n)] ?? null;
}
function rf_npc_types(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('npcs')['npcs'] as $n) $ix[$n['key']] = $n;
    return $ix;
}
function rf_shops(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('npcs')['shops'] as $s) $ix[$s['id']] = $s;
    return $ix;
}
function rf_quests(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('quests') as $q) $ix[$q['id']] = $q;
    return $ix;
}
function rf_world(): array { return rf_load('world'); }
function rf_spells(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('magic')['spells'] as $s) $ix[$s['id']] = $s;
    return $ix;
}
function rf_prayers(): array {
    static $ix = null;
    if ($ix !== null) return $ix;
    $ix = [];
    foreach (rf_load('magic')['prayers'] as $p) $ix[$p['id']] = $p;
    return $ix;
}

/* ------------------------------------------------------------ XP curve */
const RF_SKILLS = [
    'attack','strength','defence','hitpoints','ranged','prayer','magic',
    'mining','smithing','fishing','cooking','woodcutting','firemaking','crafting',
    'fletching','runecraft','slayer','farming','construction','hunter','agility',
    'herblore','thieving'
];
const RF_MAX_LEVEL = 99;
const RF_MAX_XP = 200000000;

function rf_xp_table(): array {
    static $t = null;
    if ($t !== null) return $t;
    $t = [0, 0];               // index = level; level 1 needs 0 xp
    $acc = 0;
    for ($l = 1; $l < RF_MAX_LEVEL; $l++) {
        $acc += (int)floor($l + 300 * pow(2, $l / 7.0));
        $t[$l + 1] = (int)floor($acc / 4);
    }
    return $t;
}
function rf_level_for_xp(int $xp): int {
    $t = rf_xp_table();
    for ($l = RF_MAX_LEVEL; $l >= 1; $l--) if ($xp >= $t[$l]) return $l;
    return 1;
}
function rf_xp_for_level(int $lvl): int {
    $t = rf_xp_table();
    return $t[max(1, min(RF_MAX_LEVEL, $lvl))] ?? 0;
}

/* ------------------------------------------------------- default player */
function rf_default_player(string $name): array {
    $skills = [];
    foreach (RF_SKILLS as $s) {
        $skills[$s] = ['x' => $s === 'hitpoints' ? rf_xp_for_level(10) : 0];
    }
    $inv = array_fill(0, 28, null);
    $kit = [
        ['Bronze dagger', 1], ['Bronze hatchet', 1], ['Bronze pickaxe', 1],
        ['Small fishing net', 1], ['Tinderbox', 1], ['Hammer', 1],
        ['Bread', 5], ['Coins', 100]
    ];
    $i = 0;
    foreach ($kit as $k) {
        $it = rf_item_by_name($k[0]);
        if ($it) $inv[$i++] = ['id' => (int)$it['id'], 'n' => (int)$k[1]];
    }
    $w = rf_world();
    return [
        'name' => $name,
        'created' => 0,
        'app' => null,                     // set during character creation
        'x' => (float)$w['spawnPoint']['x'], 'z' => (float)$w['spawnPoint']['z'], 'r' => 0.0,
        'hp' => 10, 'pray' => 1,
        'skills' => $skills,
        'inv' => $inv,
        'eq' => new \stdClass(),
        'bank' => [],
        'quests' => new \stdClass(),
        'qp' => 0,
        'style' => 'accurate',
        'autocast' => null,
        'prayers' => [],
        'slayer' => null,
        'farm' => new \stdClass(),
        'settings' => ['music' => 45, 'sfx' => 70, 'amb' => 55, 'master' => 80, 'shadows' => 1, 'draw' => 1],
        'seen' => new \stdClass(),
        'played' => 0,
        'lastSave' => 0
    ];
}

/* Normalises a loaded save so old records never crash a newer build. */
function rf_normalise_player(array $p, string $name): array {
    $d = rf_default_player($name);
    foreach ($d as $k => $v) if (!array_key_exists($k, $p)) $p[$k] = $v;
    foreach (RF_SKILLS as $s) {
        if (!isset($p['skills'][$s]) || !is_array($p['skills'][$s])) $p['skills'][$s] = ['x' => $s === 'hitpoints' ? rf_xp_for_level(10) : 0];
        $p['skills'][$s]['x'] = max(0, min(RF_MAX_XP, (int)($p['skills'][$s]['x'] ?? 0)));
    }
    if (!is_array($p['inv'])) $p['inv'] = array_fill(0, 28, null);
    $p['inv'] = array_slice(array_pad($p['inv'], 28, null), 0, 28);
    if (!is_array($p['bank'])) $p['bank'] = [];
    $p['eq'] = (array)$p['eq'];
    $p['quests'] = (array)$p['quests'];
    $p['farm'] = (array)$p['farm'];
    $p['seen'] = (array)$p['seen'];
    $p['settings'] = (array)$p['settings'];
    $p['hp'] = max(0, min(rf_skill_level($p, 'hitpoints'), (int)$p['hp']));
    return $p;
}

function rf_skill_level(array $p, string $s): int {
    return rf_level_for_xp((int)($p['skills'][$s]['x'] ?? 0));
}

/* Adds XP, returns list of ['skill'=>..,'level'=>..] level-ups. */
function rf_add_xp(array &$p, string $skill, float $amount): array {
    if (!in_array($skill, RF_SKILLS, true) || $amount <= 0) return [];
    $before = rf_skill_level($p, $skill);
    $cur = (int)($p['skills'][$skill]['x'] ?? 0);
    $p['skills'][$skill]['x'] = min(RF_MAX_XP, $cur + (int)round($amount));
    $after = rf_skill_level($p, $skill);
    $ups = [];
    if ($after > $before) {
        $ups[] = ['skill' => $skill, 'level' => $after];
        if ($skill === 'hitpoints') $p['hp'] = min($after, $p['hp'] + ($after - $before));
    }
    return $ups;
}

/* ------------------------------------------------------------ inventory */
function rf_inv_count(array $p, int $itemId): int {
    $n = 0;
    foreach ($p['inv'] as $s) if ($s && (int)$s['id'] === $itemId) $n += (int)$s['n'];
    return $n;
}
function rf_inv_free(array $p): int {
    $n = 0;
    foreach ($p['inv'] as $s) if ($s === null) $n++;
    return $n;
}
/* Can we fit qty of this item? Stackables need only one slot (or an existing one). */
function rf_inv_can_add(array $p, int $itemId, int $qty): bool {
    $it = rf_item($itemId);
    if (!$it) return false;
    if (!empty($it['stack'])) {
        foreach ($p['inv'] as $s) if ($s && (int)$s['id'] === $itemId) return true;
        return rf_inv_free($p) >= 1;
    }
    return rf_inv_free($p) >= $qty;
}
function rf_inv_add(array &$p, int $itemId, int $qty = 1): int {
    $it = rf_item($itemId);
    if (!$it || $qty <= 0) return 0;
    $added = 0;
    if (!empty($it['stack'])) {
        foreach ($p['inv'] as $i => $s) {
            if ($s && (int)$s['id'] === $itemId) {
                $p['inv'][$i]['n'] = min(2000000000, (int)$s['n'] + $qty);
                return $qty;
            }
        }
        foreach ($p['inv'] as $i => $s) {
            if ($s === null) { $p['inv'][$i] = ['id' => $itemId, 'n' => $qty]; return $qty; }
        }
        return 0;
    }
    for ($q = 0; $q < $qty; $q++) {
        $placed = false;
        foreach ($p['inv'] as $i => $s) {
            if ($s === null) { $p['inv'][$i] = ['id' => $itemId, 'n' => 1]; $placed = true; $added++; break; }
        }
        if (!$placed) break;
    }
    return $added;
}
function rf_inv_remove(array &$p, int $itemId, int $qty = 1): int {
    $removed = 0;
    foreach ($p['inv'] as $i => $s) {
        if ($removed >= $qty) break;
        if (!$s || (int)$s['id'] !== $itemId) continue;
        $take = min((int)$s['n'], $qty - $removed);
        $left = (int)$s['n'] - $take;
        $removed += $take;
        $p['inv'][$i] = $left > 0 ? ['id' => $itemId, 'n' => $left] : null;
    }
    return $removed;
}
function rf_coins(array $p): int {
    $c = rf_item_by_name('Coins');
    return $c ? rf_inv_count($p, (int)$c['id']) : 0;
}
function rf_take_coins(array &$p, int $amt): bool {
    $c = rf_item_by_name('Coins');
    if (!$c || rf_inv_count($p, (int)$c['id']) < $amt) return false;
    rf_inv_remove($p, (int)$c['id'], $amt);
    return true;
}
function rf_give_coins(array &$p, int $amt): void {
    $c = rf_item_by_name('Coins');
    if ($c) rf_inv_add($p, (int)$c['id'], $amt);
}

/* ----------------------------------------------------------------- bank */
function rf_bank_add(array &$p, int $itemId, int $qty): void {
    foreach ($p['bank'] as $i => $s) {
        if ($s && (int)$s['id'] === $itemId) { $p['bank'][$i]['n'] = min(2000000000, (int)$s['n'] + $qty); return; }
    }
    if (count($p['bank']) >= 400) return;
    $p['bank'][] = ['id' => $itemId, 'n' => $qty];
}
function rf_bank_remove(array &$p, int $itemId, int $qty): int {
    foreach ($p['bank'] as $i => $s) {
        if ($s && (int)$s['id'] === $itemId) {
            $take = min((int)$s['n'], $qty);
            $left = (int)$s['n'] - $take;
            if ($left > 0) $p['bank'][$i]['n'] = $left; else array_splice($p['bank'], $i, 1);
            return $take;
        }
    }
    return 0;
}

/* ------------------------------------------------------------ equipment */
const RF_SLOTS = ['head','cape','neck','weapon','body','shield','legs','hands','feet','ring','ammo'];

function rf_equip_bonus(array $p): array {
    $b = ['a' => 0, 's' => 0, 'd' => 0, 'r' => 0, 'm' => 0, 'p' => 0];
    foreach ((array)$p['eq'] as $slot => $id) {
        $it = rf_item((int)$id);
        if (!$it || empty($it['bonus'])) continue;
        foreach ($b as $k => $_) $b[$k] += (int)($it['bonus'][$k] ?? 0);
    }
    return $b;
}
function rf_meets_req(array $p, ?array $req): bool {
    if (!$req) return true;
    foreach ($req as $sk => $lvl) {
        if (!in_array($sk, RF_SKILLS, true)) continue;
        if (rf_skill_level($p, $sk) < (int)$lvl) return false;
    }
    return true;
}
function rf_weapon(array $p): ?array {
    $eq = (array)$p['eq'];
    $id = (int)($eq['weapon'] ?? 0);
    return $id ? rf_item($id) : null;
}
function rf_attack_speed(array $p): float {
    $w = rf_weapon($p);
    $spd = $w && isset($w['speed']) ? (int)$w['speed'] : 4;
    return max(1.2, $spd * 0.6);           // seconds between attacks
}

/* ------------------------------------------------------- combat maths */
function rf_style_bonus(string $style): array {
    switch ($style) {
        case 'aggressive': return ['a' => 0, 's' => 3, 'd' => 0];
        case 'defensive':  return ['a' => 0, 's' => 0, 'd' => 3];
        case 'controlled': return ['a' => 1, 's' => 1, 'd' => 1];
        default:           return ['a' => 3, 's' => 0, 'd' => 0];   // accurate
    }
}
function rf_prayer_mult(array $p, string $stat): float {
    $best = 0;
    $prs = rf_prayers();
    foreach ((array)($p['prayers'] ?? []) as $pid) {
        $pr = $prs[$pid] ?? null;
        if ($pr && isset($pr['eff'][$stat])) $best = max($best, (int)$pr['eff'][$stat]);
    }
    return 1 + $best / 100;
}
function rf_effective(array $p, string $skill, int $styleAdd): int {
    return (int)floor(rf_skill_level($p, $skill) * rf_prayer_mult($p, $skill)) + $styleAdd + 8;
}
function rf_att_roll(int $lvl, int $bonus): int { return max(1, ($lvl + 9) * ($bonus + 64)); }
function rf_hit_chance(int $attRoll, int $defRoll): float {
    if ($attRoll > $defRoll) return 1 - ($defRoll + 2) / (2.0 * ($attRoll + 1));
    return $attRoll / (2.0 * ($defRoll + 1));
}
function rf_max_hit(int $effStr, int $strBonus): int {
    return max(1, (int)floor(0.5 + $effStr * ($strBonus + 64) / 640.0));
}
function rf_combat_level(array $p): int {
    $a = rf_skill_level($p, 'attack');  $s = rf_skill_level($p, 'strength');
    $d = rf_skill_level($p, 'defence'); $h = rf_skill_level($p, 'hitpoints');
    $pr = rf_skill_level($p, 'prayer'); $r = rf_skill_level($p, 'ranged');
    $m = rf_skill_level($p, 'magic');
    $base = ($d + $h + (int)floor($pr / 2)) / 4.0;
    $melee = ($a + $s) * 0.325;
    $range = (int)floor($r * 1.5) * 0.325;
    $mage  = (int)floor($m * 1.5) * 0.325;
    return max(3, (int)floor($base + max($melee, $range, $mage)));
}

/* Resolves one attack from the player against an npc type.
   Returns ['hit'=>bool,'dmg'=>int,'xp'=>[skill=>amount],'style'=>'melee|ranged|magic'] */
function rf_player_attack(array $p, array $npc, string $mode, ?array $spell = null): array {
    $style = (string)($p['style'] ?? 'accurate');
    $sb = rf_style_bonus($style);
    $eb = rf_equip_bonus($p);
    $npcDefRoll = rf_att_roll((int)$npc['lvl'], (int)$npc['def']);

    if ($mode === 'magic' && $spell) {
        $attRoll = rf_att_roll(rf_effective($p, 'magic', 0), $eb['m']);
        $chance = rf_hit_chance($attRoll, $npcDefRoll);
        $hit = (mt_rand() / mt_getrandmax()) < $chance;
        $dmg = $hit ? mt_rand(1, max(1, (int)$spell['dmg'])) : 0;
        $xp = ['magic' => (float)$spell['xp'] + $dmg * 2.0];
        if ($dmg > 0) $xp['hitpoints'] = $dmg * 1.33;
        return ['hit' => $hit, 'dmg' => $dmg, 'xp' => $xp, 'style' => 'magic'];
    }
    if ($mode === 'ranged') {
        $attRoll = rf_att_roll(rf_effective($p, 'ranged', $sb['a']), $eb['r']);
        $chance = rf_hit_chance($attRoll, $npcDefRoll);
        $hit = (mt_rand() / mt_getrandmax()) < $chance;
        $max = rf_max_hit(rf_effective($p, 'ranged', $sb['s']), $eb['r']);
        $dmg = $hit ? mt_rand(0, $max) : 0;
        $xp = [];
        if ($dmg > 0) { $xp['ranged'] = $dmg * 4.0; $xp['hitpoints'] = $dmg * 1.33; }
        return ['hit' => $hit, 'dmg' => $dmg, 'xp' => $xp, 'style' => 'ranged'];
    }
    $attRoll = rf_att_roll(rf_effective($p, 'attack', $sb['a']), $eb['a']);
    $chance = rf_hit_chance($attRoll, $npcDefRoll);
    $hit = (mt_rand() / mt_getrandmax()) < $chance;
    $max = rf_max_hit(rf_effective($p, 'strength', $sb['s']), $eb['s']);
    $dmg = $hit ? mt_rand(0, $max) : 0;
    $xp = [];
    if ($dmg > 0) {
        $xp['hitpoints'] = $dmg * 1.33;
        if ($style === 'controlled') {
            $xp['attack'] = $dmg * 1.33; $xp['strength'] = $dmg * 1.33; $xp['defence'] = $dmg * 1.33;
        } elseif ($style === 'aggressive') $xp['strength'] = $dmg * 4.0;
        elseif ($style === 'defensive')    $xp['defence'] = $dmg * 4.0;
        else                               $xp['attack'] = $dmg * 4.0;
    }
    return ['hit' => $hit, 'dmg' => $dmg, 'xp' => $xp, 'style' => 'melee'];
}

/* The monster's swing back. */
function rf_npc_attack(array $npc, array $p): array {
    $sb = rf_style_bonus((string)($p['style'] ?? 'accurate'));
    $eb = rf_equip_bonus($p);
    $defRoll = rf_att_roll(rf_effective($p, 'defence', $sb['d']), $eb['d']);
    $attRoll = rf_att_roll((int)$npc['lvl'], (int)$npc['att']);
    // protection prayers cut incoming melee hard
    $prot = 1.0;
    $prs = rf_prayers();
    foreach ((array)($p['prayers'] ?? []) as $pid) {
        $pr = $prs[$pid] ?? null;
        if ($pr && ($pr['eff']['protect'] ?? '') === 'melee') $prot = 0.4;
    }
    $chance = rf_hit_chance($attRoll, $defRoll);
    $hit = (mt_rand() / mt_getrandmax()) < $chance;
    $dmg = $hit ? (int)round(mt_rand(0, max(1, (int)$npc['hit'])) * $prot) : 0;
    return ['hit' => $hit, 'dmg' => $dmg];
}

/* Rolls a monster's drop table. Always returns an array of [itemId, qty]. */
function rf_roll_drops(array $npc): array {
    $out = [];
    foreach (($npc['drops'] ?? []) as $d) {
        if (mt_rand(1, 100) <= (int)$d['w']) {
            $q = mt_rand((int)$d['min'], (int)$d['max']);
            if ($q > 0) $out[] = [(int)$d['item'], $q];
        }
    }
    return $out;
}

/* ------------------------------------------------------------- quests */
function rf_quest_state(array $p, string $qid) {
    $q = (array)$p['quests'];
    return $q[$qid] ?? null;                // null = not started, int = stage, 'done'
}
function rf_quest_done(array $p, string $qid): bool { return rf_quest_state($p, $qid) === 'done'; }
function rf_quest_points(array $p): int {
    $n = 0;
    foreach (rf_quests() as $qid => $q) if (rf_quest_done($p, $qid)) $n += (int)$q['qp'];
    return $n;
}
function rf_quest_eligible(array $p, array $q): array {
    $req = $q['req'] ?? [];
    $missing = [];
    foreach (($req['skills'] ?? []) as $s => $l) {
        if (rf_skill_level($p, $s) < (int)$l) $missing[] = ucfirst($s) . ' level ' . $l;
    }
    foreach (($req['quests'] ?? []) as $rq) {
        if (!rf_quest_done($p, $rq)) {
            $qq = rf_quests()[$rq] ?? null;
            $missing[] = 'the quest "' . ($qq['name'] ?? $rq) . '"';
        }
    }
    if (isset($req['qp']) && rf_quest_points($p) < (int)$req['qp']) $missing[] = (int)$req['qp'] . ' quest points';
    return $missing;
}

/* Advances any quest stage that the player's current state now satisfies.
   Called after kills, pickups and arrivals. Returns notification strings. */
function rf_quest_progress(array &$p, string $event, array $ctx): array {
    $notes = [];
    foreach (rf_quests() as $qid => $q) {
        $st = rf_quest_state($p, $qid);
        if ($st === null || $st === 'done') continue;
        $stage = $q['stages'][$st] ?? null;
        if (!$stage) continue;
        $advance = false;
        switch ($stage['t']) {
            case 'kill':
                if ($event === 'kill' && ($ctx['npc'] ?? '') === $stage['npc']) {
                    $key = 'k:' . $qid . ':' . $st;
                    $seen = (array)$p['seen'];
                    $seen[$key] = (int)($seen[$key] ?? 0) + 1;
                    $p['seen'] = $seen;
                    if ($seen[$key] >= (int)$stage['n']) $advance = true;
                    else $notes[] = $seen[$key] . '/' . (int)$stage['n'] . ' ' . str_replace('_', ' ', $stage['npc']) . ' defeated.';
                }
                break;
            case 'collect':
                if ($event === 'inv' || $event === 'kill' || $event === 'gather') {
                    $it = rf_item_by_name($stage['item']);
                    if ($it && rf_inv_count($p, (int)$it['id']) >= (int)$stage['n']) $advance = true;
                }
                break;
            case 'goto':
                if ($event === 'move') {
                    $d = hypot(($ctx['x'] ?? 0) - $stage['x'], ($ctx['z'] ?? 0) - $stage['z']);
                    if ($d <= (float)($stage['r'] ?? 6)) $advance = true;
                }
                break;
        }
        if ($advance) {
            $p['quests'] = (array)$p['quests'];
            $p['quests'][$qid] = $st + 1;
            if ($p['quests'][$qid] >= count($q['stages'])) {
                // final stage is always a talk-to, handled by the dialogue path
                $p['quests'][$qid] = count($q['stages']) - 1;
            }
            $next = $q['stages'][$p['quests'][$qid]] ?? null;
            $notes[] = 'Quest updated: ' . $q['name'];
            if ($next && isset($next['j'])) $notes[] = $next['j'];
        }
    }
    return $notes;
}

function rf_quest_complete(array &$p, string $qid): array {
    $q = rf_quests()[$qid] ?? null;
    if (!$q) return [];
    $p['quests'] = (array)$p['quests'];
    $p['quests'][$qid] = 'done';
    $notes = ['Quest complete: ' . $q['name'] . '!'];
    $ups = [];
    foreach (($q['rew']['xp'] ?? []) as $sk => $amt) {
        $ups = array_merge($ups, rf_add_xp($p, $sk, (float)$amt));
        $notes[] = '+' . number_format((float)$amt) . ' ' . ucfirst($sk) . ' XP';
    }
    foreach (($q['rew']['items'] ?? []) as $pair) {
        $it = rf_item_by_name($pair[0]);
        if (!$it) continue;
        $n = (int)$pair[1];
        if (rf_inv_can_add($p, (int)$it['id'], $n)) rf_inv_add($p, (int)$it['id'], $n);
        else rf_bank_add($p, (int)$it['id'], $n);
        $notes[] = 'Reward: ' . $n . ' x ' . $it['name'];
    }
    $p['qp'] = rf_quest_points($p);
    return ['notes' => $notes, 'levels' => $ups];
}

/* ------------------------------------------------------------ world state */
/* Shared, server-owned state: depleted resources and monster HP/death.
   Stored under one key and mutated transactionally. */
function rf_world_state_get(): array {
    $w = rf_store()->get('world');
    if (!is_array($w)) $w = ['obj' => [], 'npc' => [], 'ground' => [], 'seq' => 0];
    return $w;
}
function rf_world_prune(array &$w, float $now): void {
    foreach ($w['obj'] as $k => $v) if (($v['until'] ?? 0) < $now) unset($w['obj'][$k]);
    foreach ($w['npc'] as $k => $v) {
        if (isset($v['dead']) && $v['dead'] < $now) unset($w['npc'][$k]);
        elseif (!isset($v['dead']) && ($v['t'] ?? 0) < $now - 45) unset($w['npc'][$k]);
    }
    $w['ground'] = array_values(array_filter($w['ground'], fn($gI) => ($gI['until'] ?? 0) > $now));
}
