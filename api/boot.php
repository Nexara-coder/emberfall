<?php
/* Emberfall - bootstrap: config, storage, sessions, helpers.
   Designed for ordinary PHP 8 shared hosting: no shell, no extensions beyond
   PDO-SQLite (with a flat-file fallback if even that is missing). */
declare(strict_types=1);

if (version_compare(PHP_VERSION, '8.0.0', '<')) {
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Emberfall requires PHP 8.0 or newer. This server runs ' . PHP_VERSION]);
    exit;
}

/* A single stray PHP notice printed before our JSON turns every API reply into
   unparseable garbage on the client. Send warnings to the log, not the page. */
@ini_set('display_errors', '0');
@ini_set('log_errors', '1');

define('RF_ROOT', dirname(__DIR__));

/* Ground items. Defined here, not in the router file: that one dispatches and
   exits near the top, so any define() further down never runs. */
define('RF_GROUND_PRIVATE', 60.0);    // seconds the killer keeps it to themselves
define('RF_GROUND_LIFE', 300.0);      // seconds before loot rots away
define('RF_DATA', RF_ROOT . '/data');
define('RF_STORE', RF_DATA . '/store');
define('RF_VERSION', '1.0.0');

define('RF_SESSION_TTL', 86400 * 14);   // login token lifetime
define('RF_PRESENCE_TTL', 22);          // seconds before a player is treated as logged out
define('RF_CHAT_KEEP', 160);            // chat backlog length
define('RF_TICK_MS', 200);              // nominal client sync interval

@mkdir(RF_STORE, 0777, true);

/* ---------------------------------------------------------------- output */
function rf_json($data, int $code = 200): void {
    // discard anything that leaked out before us (stray whitespace, notices)
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function rf_ok(array $d = []): void { rf_json(array_merge(['ok' => true], $d)); }
function rf_err(string $msg, int $code = 200): void { rf_json(['ok' => false, 'error' => $msg], $code); }

/* ---------------------------------------------------------------- store */
interface RFStore {
    public function get(string $k);
    public function put(string $k, $v): void;
    public function del(string $k): void;
    public function scan(string $prefix, float $sinceUpd = 0.0): array;
    public function mutate(string $k, callable $fn);
    public function backend(): string;
}

final class RFSqliteStore implements RFStore {
    private \PDO $db;
    /* Guards against nesting: an action like "attack" mutates the player and,
       inside that callback, mutates the shared world. SQLite cannot nest
       transactions, so an inner mutate simply joins the outer one. */
    private int $depth = 0;
    public function __construct(string $file) {
        $this->db = new \PDO('sqlite:' . $file, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $this->db->exec('PRAGMA journal_mode=WAL');
        $this->db->exec('PRAGMA busy_timeout=8000');
        $this->db->exec('PRAGMA synchronous=NORMAL');
        $this->db->exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, upd REAL NOT NULL)');
        $this->db->exec('CREATE INDEX IF NOT EXISTS kv_upd ON kv(upd)');
    }
    public function backend(): string { return 'sqlite'; }
    public function get(string $k) {
        $s = $this->db->prepare('SELECT v FROM kv WHERE k=?');
        $s->execute([$k]);
        $r = $s->fetch();
        return $r ? json_decode($r['v'], true) : null;
    }
    public function put(string $k, $v): void {
        $s = $this->db->prepare('INSERT INTO kv(k,v,upd) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, upd=excluded.upd');
        $s->execute([$k, json_encode($v, JSON_UNESCAPED_SLASHES), microtime(true)]);
    }
    public function del(string $k): void {
        $this->db->prepare('DELETE FROM kv WHERE k=?')->execute([$k]);
    }
    public function scan(string $prefix, float $sinceUpd = 0.0): array {
        $s = $this->db->prepare('SELECT k,v,upd FROM kv WHERE k LIKE ? AND upd > ?');
        $s->execute([$prefix . '%', $sinceUpd]);
        $out = [];
        foreach ($s->fetchAll() as $r) $out[$r['k']] = json_decode($r['v'], true);
        return $out;
    }
    public function mutate(string $k, callable $fn) {
        if ($this->depth > 0) {
            // already inside a transaction: read, modify and write in place
            $s = $this->db->prepare('SELECT v FROM kv WHERE k=?');
            $s->execute([$k]);
            $row = $s->fetch();
            $cur = $row ? json_decode($row['v'], true) : null;
            $res = $fn($cur);
            $new = is_array($res) && array_key_exists('__value', $res) ? $res['__value'] : $cur;
            $put = $this->db->prepare('INSERT INTO kv(k,v,upd) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, upd=excluded.upd');
            $put->execute([$k, json_encode($new, JSON_UNESCAPED_SLASHES), microtime(true)]);
            return is_array($res) && array_key_exists('__return', $res) ? $res['__return'] : null;
        }
        for ($try = 0; $try < 6; $try++) {
            try {
                $this->db->exec('BEGIN IMMEDIATE');
                $this->depth++;
                $s = $this->db->prepare('SELECT v FROM kv WHERE k=?');
                $s->execute([$k]);
                $row = $s->fetch();
                $cur = $row ? json_decode($row['v'], true) : null;
                $res = $fn($cur);
                $new = is_array($res) && array_key_exists('__value', $res) ? $res['__value'] : $cur;
                $put = $this->db->prepare('INSERT INTO kv(k,v,upd) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, upd=excluded.upd');
                $put->execute([$k, json_encode($new, JSON_UNESCAPED_SLASHES), microtime(true)]);
                $this->db->exec('COMMIT');
                $this->depth = 0;
                return is_array($res) && array_key_exists('__return', $res) ? $res['__return'] : null;
            } catch (\Throwable $e) {
                $this->depth = 0;
                try { $this->db->exec('ROLLBACK'); } catch (\Throwable $e2) {}
                if ($try === 5) throw $e;
                usleep(20000 + random_int(0, 30000));
            }
        }
        throw new \RuntimeException('store busy');
    }
}

final class RFFileStore implements RFStore {
    private string $file;
    private $fh = null;      // handle held for the duration of an outer mutate
    private int $depth = 0;  // >0 while a mutate callback is running

    public function __construct(string $file) {
        $this->file = $file;
        if (!file_exists($file)) file_put_contents($file, '{}');
    }
    public function backend(): string { return 'file'; }

    /* Reads the whole map. While nested inside a mutate we must not take a
       second lock: flock() is per file handle, so the process would wait on
       itself forever. The outer mutate already holds an exclusive lock. */
    private function readMap(bool $exclusive) {
        if ($this->depth > 0) {
            $raw = @file_get_contents($this->file);
            $d = json_decode($raw ?: '{}', true);
            return [is_array($d) ? $d : [], null];
        }
        $fh = fopen($this->file, 'c+');
        flock($fh, $exclusive ? LOCK_EX : LOCK_SH);
        $raw = stream_get_contents($fh);
        $d = json_decode($raw ?: '{}', true);
        return [is_array($d) ? $d : [], $fh];
    }
    private function writeMap(array $d, $fh): void {
        if ($fh === null) {
            file_put_contents($this->file, json_encode($d, JSON_UNESCAPED_SLASHES), LOCK_EX);
            return;
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($d, JSON_UNESCAPED_SLASHES));
        fflush($fh);
    }
    private function done($fh): void {
        if ($fh === null) return;
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    public function get(string $k) {
        [$d, $fh] = $this->readMap(false);
        $this->done($fh);
        return isset($d[$k]) ? $d[$k]['v'] : null;
    }
    public function put(string $k, $v): void {
        [$d, $fh] = $this->readMap(true);
        $d[$k] = ['v' => $v, 'upd' => microtime(true)];
        $this->writeMap($d, $fh);
        $this->done($fh);
    }
    public function del(string $k): void {
        [$d, $fh] = $this->readMap(true);
        unset($d[$k]);
        $this->writeMap($d, $fh);
        $this->done($fh);
    }
    public function scan(string $prefix, float $sinceUpd = 0.0): array {
        [$d, $fh] = $this->readMap(false);
        $this->done($fh);
        $out = [];
        foreach ($d as $k => $e) {
            if (str_starts_with($k, $prefix) && ($e['upd'] ?? 0) > $sinceUpd) $out[$k] = $e['v'];
        }
        return $out;
    }
    public function mutate(string $k, callable $fn) {
        [$d, $fh] = $this->readMap(true);
        $cur = isset($d[$k]) ? $d[$k]['v'] : null;
        $this->depth++;
        try {
            $res = $fn($cur);
        } finally {
            $this->depth--;
        }
        $new = is_array($res) && array_key_exists('__value', $res) ? $res['__value'] : $cur;
        /* The callback may have written other keys (the shared world, say), so
           re-read before saving rather than clobbering it with a stale copy. */
        $raw = @file_get_contents($this->file);
        $fresh = json_decode($raw ?: '{}', true);
        if (!is_array($fresh)) $fresh = $d;
        $fresh[$k] = ['v' => $new, 'upd' => microtime(true)];
        $this->writeMap($fresh, $fh);
        $this->done($fh);
        return is_array($res) && array_key_exists('__return', $res) ? $res['__return'] : null;
    }
}

/* The save file gets an unguessable name, recorded in a .php file that the web
   server executes rather than serves. That way the player database stays
   private even on a host that ignores .htaccess entirely. */
function rf_store_path(string $ext): string {
    $legacy = RF_STORE . '/emberfall.' . $ext;
    if (file_exists($legacy)) return $legacy;        // keep existing installs working

    $keyFile = RF_STORE . '/dbname.php';
    $name = null;
    if (is_readable($keyFile)) {
        $v = @include $keyFile;
        if (is_string($v) && preg_match('/^[a-f0-9]{16}$/', $v)) $name = $v;
    }
    if ($name === null) {
        $name = bin2hex(random_bytes(8));
        @file_put_contents($keyFile, "<?php return '" . $name . "';\n");
    }
    return RF_STORE . '/emberfall-' . $name . '.' . $ext;
}

function rf_store(): RFStore {
    static $s = null;
    if ($s !== null) return $s;
    if (extension_loaded('pdo_sqlite')) {
        try { $s = new RFSqliteStore(rf_store_path('sqlite')); return $s; }
        catch (\Throwable $e) { /* fall through to the flat file */ }
    }
    $s = new RFFileStore(rf_store_path('json'));
    return $s;
}

/* ------------------------------------------------------------- request */
function rf_input(): array {
    static $in = null;
    if ($in !== null) return $in;
    $raw = file_get_contents('php://input');
    $j = $raw ? json_decode($raw, true) : null;
    $in = is_array($j) ? $j : [];
    foreach ($_POST as $k => $v) if (!isset($in[$k])) $in[$k] = $v;
    foreach ($_GET as $k => $v) if (!isset($in[$k])) $in[$k] = $v;
    return $in;
}
function rf_p(string $k, $def = null) {
    $in = rf_input();
    return array_key_exists($k, $in) ? $in[$k] : $def;
}
function rf_pi(string $k, int $def = 0): int { $v = rf_p($k, $def); return is_numeric($v) ? (int)$v : $def; }
function rf_pf(string $k, float $def = 0.0): float { $v = rf_p($k, $def); return is_numeric($v) ? (float)$v : $def; }
function rf_ps(string $k, string $def = ''): string { $v = rf_p($k, $def); return is_string($v) ? $v : $def; }

/* ------------------------------------------------------------- sessions */
function rf_token(): string {
    $h = $_SERVER['HTTP_X_RF_TOKEN'] ?? '';
    if ($h) return (string)$h;
    return rf_ps('token', '');
}
function rf_new_token(): string { return bin2hex(random_bytes(20)); }

function rf_session(): ?array {
    static $cached = false; static $val = null;
    if ($cached) return $val;
    $cached = true;
    $t = rf_token();
    if (!$t || !preg_match('/^[a-f0-9]{40}$/', $t)) return $val = null;
    $s = rf_store()->get('sess:' . $t);
    if (!$s || ($s['exp'] ?? 0) < time()) return $val = null;
    $val = ['aid' => (int)$s['aid'], 'token' => $t, 'name' => $s['name'] ?? ''];
    return $val;
}
function rf_require_session(): array {
    $s = rf_session();
    if (!$s) rf_err('Your session has expired. Please log in again.', 200);
    return $s;
}

/* --------------------------------------------------------------- utils */
function rf_clean_name(string $n): string {
    $n = trim(preg_replace('/\s+/', ' ', $n));
    return $n;
}
function rf_valid_username(string $n): bool {
    return (bool)preg_match('/^[A-Za-z0-9_ ]{3,14}$/', $n) && trim($n) !== '';
}
function rf_now(): float { return microtime(true); }

/* Strip anything that could break the chat panel or be used for injection. */
function rf_sanitise_chat(string $s): string {
    $s = preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$s);
    $s = trim((string)$s);
    // mbstring is not guaranteed on shared hosting, so fall back to a
    // UTF-8-aware truncation that never splits a multi-byte character
    if (function_exists('mb_substr')) return mb_substr($s, 0, 140);
    if (strlen($s) <= 140) return $s;
    $cut = substr($s, 0, 140);
    while ($cut !== '' && (ord($cut[strlen($cut) - 1]) & 0xC0) === 0x80) $cut = substr($cut, 0, -1);
    if ($cut !== '' && (ord($cut[strlen($cut) - 1]) & 0xC0) === 0xC0) $cut = substr($cut, 0, -1);
    return $cut;
}

/* Very small per-account rate limiter to blunt scripted spam. */
function rf_rate_ok(int $aid, string $bucket, float $minInterval): bool {
    $k = 'rl:' . $aid . ':' . $bucket;
    $st = rf_store();
    $last = $st->get($k);
    $now = rf_now();
    if (is_numeric($last) && ($now - (float)$last) < $minInterval) return false;
    $st->put($k, $now);
    return true;
}
