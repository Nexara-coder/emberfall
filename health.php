<?php
/* Emberfall - hosting check.
   Upload the whole folder, then visit  https://yourdomain.com/health.php
   This page tells you whether the server can actually run the game, and if
   not, exactly what to change. It writes nothing except a throwaway test
   record, which it deletes again. */
declare(strict_types=1);

$checks = [];
$fatal = 0;
$warn = 0;

function check(string $name, bool $ok, string $good, string $bad, bool $fatalIfBad = true): void {
    global $checks, $fatal, $warn;
    $checks[] = ['name' => $name, 'ok' => $ok, 'msg' => $ok ? $good : $bad, 'fatal' => $fatalIfBad];
    if (!$ok) { if ($fatalIfBad) $fatal++; else $warn++; }
}

/* -------------------------------------------------------------- PHP */
$phpOk = version_compare(PHP_VERSION, '8.0.0', '>=');
check('PHP version', $phpOk,
    'PHP ' . PHP_VERSION . ' - good.',
    'PHP ' . PHP_VERSION . ' is too old. Emberfall needs PHP 8.0 or newer. Most hosts let you switch PHP version in cPanel under "Select PHP Version".');

check('JSON support', function_exists('json_encode'),
    'Available.',
    'The JSON extension is missing. Enable ext-json in your PHP settings.');

check('Password hashing', function_exists('password_hash') && function_exists('password_verify'),
    'password_hash() and password_verify() are available.',
    'Password hashing is unavailable, so accounts cannot be created securely.');

check('Random bytes', function_exists('random_bytes'),
    'Cryptographically secure tokens are available.',
    'random_bytes() is missing; session tokens would be predictable.');

/* --------------------------------------------------------- storage */
$sqlite = extension_loaded('pdo_sqlite');
check('SQLite (preferred storage)', $sqlite,
    'PDO SQLite is available. The game will use a single database file.',
    'PDO SQLite is not installed. The game will fall back to a flat JSON file, which still works but is slower with many players at once. Ask your host to enable pdo_sqlite if you can.',
    false);

check('Multibyte strings', extension_loaded('mbstring'),
    'mbstring is available.',
    'mbstring is not installed. The game still works - chat truncation falls back to a built-in UTF-8 safe method - but enabling it is tidier.',
    false);

$dataDir = __DIR__ . '/data';
$storeDir = $dataDir . '/store';
if (!is_dir($storeDir)) @mkdir($storeDir, 0777, true);
$writable = is_dir($storeDir) && is_writable($storeDir);
check('Writable save folder', $writable,
    'data/store is writable, so characters can be saved.',
    'The folder data/store does not exist or is not writable. Create it and set its permissions to 755 (or 777 on strict hosts). Without this, nobody can save a character.');

if ($writable) {
    $probe = $storeDir . '/.healthcheck';
    $wrote = @file_put_contents($probe, 'ok') !== false;
    $read = $wrote && @file_get_contents($probe) === 'ok';
    @unlink($probe);
    check('Read/write test', $read,
        'Wrote and read a test file successfully.',
        'Could not write a test file into data/store. Check the folder permissions.');
}

/* ----------------------------------------------------------- files */
$need = [
    'index.html', 'css/style.css',
    'js/vendor/three.min.js', 'js/terrain_height.js', 'js/models.js', 'js/terrain.js',
    'js/path.js', 'js/world.js', 'js/icons.js', 'js/audio.js', 'js/net.js',
    'js/entities.js', 'js/ui.js', 'js/game.js',
    'api/index.php', 'api/boot.php', 'api/data.php',
    'data/items.json', 'data/npcs.json', 'data/quests.json', 'data/world.json', 'data/magic.json'
];
$missing = [];
foreach ($need as $f) if (!is_readable(__DIR__ . '/' . $f)) $missing[] = $f;
check('Game files present', count($missing) === 0,
    count($need) . ' required files found.',
    'Missing: ' . implode(', ', $missing) . '. Re-upload the ZIP contents, keeping the folder structure intact.');

/* ------------------------------------------------------- data sanity */
$dataOk = true; $dataMsg = '';
if (!$missing) {
    try {
        $items = json_decode(file_get_contents($dataDir . '/items.json'), true);
        $world = json_decode(file_get_contents($dataDir . '/world.json'), true);
        $npcs  = json_decode(file_get_contents($dataDir . '/npcs.json'), true);
        $quests = json_decode(file_get_contents($dataDir . '/quests.json'), true);
        if (!is_array($items) || !is_array($world) || !is_array($npcs) || !is_array($quests)) {
            $dataOk = false; $dataMsg = 'One of the data files is not valid JSON.';
        } else {
            $dataMsg = count($items) . ' items, ' . count($npcs['npcs']) . ' NPC types, ' .
                count($quests) . ' quests, ' . count($world['objects']) . ' world objects, ' .
                count($world['buildings']) . ' buildings, ' . count($world['spawns']) . ' spawns.';
        }
    } catch (\Throwable $e) {
        $dataOk = false; $dataMsg = $e->getMessage();
    }
} else { $dataOk = false; $dataMsg = 'Skipped - files are missing.'; }
check('Game data readable', $dataOk, $dataMsg, $dataMsg);

/* --------------------------------------------------- engine self-test */
$engineOk = false; $engineMsg = '';
if (!$missing && $phpOk) {
    try {
        require_once __DIR__ . '/api/boot.php';
        require_once __DIR__ . '/api/data.php';
        $t = rf_xp_table();
        $p = rf_default_player('HealthCheck');
        $l2 = $t[2] === 83;
        $l99 = $t[99] === 13034431;
        $hp = rf_skill_level($p, 'hitpoints') === 10;
        $cb = rf_combat_level($p) === 3;
        $inv = count($p['inv']) === 28;
        $slots = count(RF_SLOTS) === 11;
        $sk = count(RF_SKILLS) === 23;
        $engineOk = $l2 && $l99 && $hp && $cb && $inv && $slots && $sk;
        $engineMsg = 'XP for level 2 = ' . $t[2] . ' (expected 83); ' .
            'XP for level 99 = ' . number_format($t[99]) . ' (expected 13,034,431); ' .
            'starting Hitpoints level ' . rf_skill_level($p, 'hitpoints') . '; ' .
            'starting combat level ' . rf_combat_level($p) . '; ' .
            count($p['inv']) . ' inventory slots; ' . count(RF_SLOTS) . ' equipment slots; ' .
            count(RF_SKILLS) . ' skills.';
    } catch (\Throwable $e) {
        $engineMsg = 'The rules engine failed to load: ' . $e->getMessage();
    }
} else { $engineMsg = 'Skipped.'; }
check('Rules engine self-test', $engineOk, $engineMsg, $engineMsg);

/* --------------------------------------------- game data service check */
if (!$missing) {
    $gdOk = true; $gdMsg = [];
    foreach (['items', 'npcs', 'quests', 'world', 'magic'] as $f) {
        $path = $dataDir . '/' . $f . '.json';
        if (!is_readable($path)) { $gdOk = false; $gdMsg[] = $f . '.json unreadable'; continue; }
        $raw = @file_get_contents($path);
        if ($raw === false || $raw === '' || json_decode($raw) === null) {
            $gdOk = false; $gdMsg[] = $f . '.json corrupt or empty';
        }
    }
    check('Game data service', $gdOk,
        'PHP can read and parse all five data files, so the game will load even if '
        . 'your host blocks direct web access to the data folder.',
        'Problems: ' . implode(', ', $gdMsg) . '. Re-upload the data folder in BINARY mode '
        . 'and set files to 644, folders to 755.');
}

/* ------------------------------------------------------ storage probe */
if ($phpOk && $writable && !$missing) {
    $storeOk = false; $storeMsg = '';
    try {
        $st = rf_store();
        $key = 'healthcheck:' . bin2hex(random_bytes(4));
        $st->put($key, ['t' => time(), 'v' => 'hello']);
        $back = $st->get($key);
        $st->del($key);
        $storeOk = is_array($back) && ($back['v'] ?? '') === 'hello';
        $storeMsg = $storeOk
            ? 'Saved and loaded a test record using the ' . $st->backend() . ' backend.'
            : 'The store accepted a write but did not return it.';
    } catch (\Throwable $e) {
        $storeMsg = 'Storage failed: ' . $e->getMessage();
    }
    check('Save system', $storeOk, $storeMsg, $storeMsg);
}

/* ------------------------------------------------------------- limits */
$mem = ini_get('memory_limit');
$memBytes = (int)$mem;
if (stripos($mem, 'g') !== false) $memBytes *= 1024;
check('Memory limit', $mem === '-1' || $memBytes >= 64,
    'memory_limit is ' . $mem . ' - plenty.',
    'memory_limit is ' . $mem . '. Raise it to at least 64M in php.ini or .htaccess.',
    false);

check('Output compression', true,
    'Not required, but enabling gzip in your host control panel will make the world data load faster.',
    '', false);

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
check('HTTPS', $https,
    'The site is served over HTTPS.',
    'This page was served over plain HTTP. The game still works, but browsers will only unlock audio and store logins reliably on HTTPS. Most hosts offer a free certificate.',
    false);

$status = $fatal === 0 ? ($warn === 0 ? 'ready' : 'ready-warn') : 'blocked';
?><!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emberfall &mdash; hosting check</title>
<style>
body{margin:0;padding:26px 16px;background:#1a150e;color:#e9dcbd;
  font-family:"Trebuchet MS",Verdana,sans-serif;line-height:1.5}
.wrap{max-width:760px;margin:0 auto}
h1{font-family:Georgia,serif;letter-spacing:4px;color:#f0dda3;margin:0 0 4px;font-size:30px}
h1 span{color:#e0c23c}
.sub{color:#a3946f;font-size:14px;margin-bottom:20px}
.banner{padding:14px 16px;border:3px solid #100c07;margin-bottom:20px;font-size:16px}
.ready{background:linear-gradient(#2f5b2f,#1e3d1e);border-color:#4c8b4c}
.warn{background:linear-gradient(#6b5a24,#463a14);border-color:#b79a4a}
.blocked{background:linear-gradient(#6b2a24,#3d1713);border-color:#c4453a}
table{width:100%;border-collapse:collapse;background:rgba(0,0,0,.25)}
td{padding:9px 10px;border-bottom:1px solid #3a3025;vertical-align:top;font-size:14px}
td.k{width:190px;color:#cbbd9a;font-weight:bold}
td.s{width:34px;text-align:center;font-size:17px}
.ok{color:#7fc06a}.no{color:#e0705a}.mid{color:#e0c23c}
a{color:#e0c23c}
.foot{margin-top:22px;font-size:13px;color:#a3946f}
code{background:#000;padding:1px 5px;border-radius:2px;color:#d8c9a3}
</style></head><body><div class="wrap">
<h1>EMBERFALL<span> II</span></h1>
<div class="sub">Hosting environment check</div>

<?php if ($status === 'ready'): ?>
  <div class="banner ready"><b>Everything checks out.</b> Your server can run the game.
  <a href="index.html">Open Emberfall &rarr;</a></div>
<?php elseif ($status === 'ready-warn'): ?>
  <div class="banner warn"><b>Good enough to play.</b> <?= $warn ?> non-critical item(s) below could be improved.
  <a href="index.html">Open Emberfall &rarr;</a></div>
<?php else: ?>
  <div class="banner blocked"><b><?= $fatal ?> problem(s) must be fixed</b> before the game will run.
  Each row below says exactly what to change.</div>
<?php endif; ?>

<table>
<?php foreach ($checks as $c): ?>
  <tr>
    <td class="s <?= $c['ok'] ? 'ok' : ($c['fatal'] ? 'no' : 'mid') ?>"><?= $c['ok'] ? '&#10003;' : ($c['fatal'] ? '&#10007;' : '!') ?></td>
    <td class="k"><?= htmlspecialchars($c['name']) ?></td>
    <td><?= htmlspecialchars($c['msg']) ?></td>
  </tr>
<?php endforeach; ?>
</table>

<div class="foot">
  <p><b>Where things live:</b> characters and the shared world are stored in <code>data/store/</code>.
  Back that folder up and you have backed up every account. Delete it and the world starts fresh.</p>
  <p><b>Server:</b> <?= htmlspecialchars(PHP_OS_FAMILY . ' &middot; PHP ' . PHP_VERSION . ' &middot; ' . ($_SERVER['SERVER_SOFTWARE'] ?? 'unknown web server')) ?></p>
  <p>It is safe to leave this file in place, but you can delete <code>health.php</code> once the game is running.</p>
</div>
</div></body></html>
