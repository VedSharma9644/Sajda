<?php
// phpcs:ignoreFile

/**
 * Server-side trace logging (PHP error_log). Disable with:
 *   define('ESAJDA_SERVER_LOG', false);
 * before including this file, or set env ESAJDA_SERVER_LOG=0.
 */
if (!defined('ESAJDA_SERVER_LOG')) {
    $env = getenv('ESAJDA_SERVER_LOG');
    if ($env === false || $env === '') {
        define('ESAJDA_SERVER_LOG', true);
    } else {
        define('ESAJDA_SERVER_LOG', $env === '1' || strtolower((string)$env) === 'true');
    }
}

/**
 * @param string $area Short label: DB, api, weather
 * @param string $message
 */
function esajdaServerLog($area, $message) {
    if (!ESAJDA_SERVER_LOG) {
        return;
    }
    error_log('[e-Sajda ' . $area . '] ' . $message);
}

/**
 * Shared SQLite cache helpers (city-centric model).
 *
 * Schema:
 * - cities: one row per city/location key
 * - city_cache: cached payloads by city + feature + variant
 */

function cacheDbOpen() {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    if (!class_exists('PDO')) return null;
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) return null;

    $dbPath = __DIR__ . DIRECTORY_SEPARATOR . 'cache.db';
    $dir = dirname($dbPath);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    if (!is_dir($dir)) return null;

    try {
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        cacheDbEnsureSchema($pdo);
        // Keep DB light: best-effort pruning of expired rows.
        // (Runs rarely to avoid extra overhead on every request.)
        cacheDbMaybePrune($pdo);
        esajdaServerLog('DB', 'opened sqlite:' . $dbPath);
        return $pdo;
    } catch (Exception $e) {
        esajdaServerLog('DB', 'open failed: ' . $e->getMessage());
        $pdo = null;
        return null;
    }
}

/**
 * Opens the static popular-location database (read-only lookup source).
 */
function popularLocationDbOpen() {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    if (!class_exists('PDO')) return null;
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) return null;

    $dbPath = __DIR__ . DIRECTORY_SEPARATOR . 'popular-location.db';
    if (!is_file($dbPath)) {
        return null;
    }

    try {
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    } catch (Exception $e) {
        esajdaServerLog('DB', 'popular db open failed: ' . $e->getMessage());
        $pdo = null;
        return null;
    }
}

function cacheDbEnsureSchema($pdo) {
    $pdo->exec('CREATE TABLE IF NOT EXISTS cities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        city_key TEXT NOT NULL UNIQUE,
        display_name TEXT,
        latitude REAL,
        longitude REAL,
        timezone TEXT,
        updated_at INTEGER NOT NULL
    )');

    $pdo->exec('CREATE TABLE IF NOT EXISTS city_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        city_id INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        variant_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(city_id, data_type, variant_key),
        FOREIGN KEY(city_id) REFERENCES cities(id)
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_city_cache_lookup ON city_cache(city_id, data_type, variant_key)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_city_cache_expires ON city_cache(expires_at)');
}

/**
 * Prune expired cache rows and orphaned cities (best-effort).
 * Designed to be safe to call frequently, but we usually call it probabilistically.
 */
function cacheDbPruneExpired($pdo) {
    $now = time();
    // Delete expired cache payloads.
    $stmt = $pdo->prepare('DELETE FROM city_cache WHERE expires_at < :now');
    $stmt->execute([':now' => $now]);
    $deleted = $stmt->rowCount();

    // Remove cities with no cache entries to avoid unbounded growth from typos.
    $pdo->exec('DELETE FROM cities WHERE id NOT IN (SELECT DISTINCT city_id FROM city_cache)');

    if ($deleted > 0) {
        esajdaServerLog('DB', 'pruneExpired deleted_rows=' . (int)$deleted);
    }
}

/**
 * Randomly prune to keep DB light without slowing every request.
 * Roughly 1 in 25 opens triggers cleanup.
 */
function cacheDbMaybePrune($pdo) {
    try {
        $r = random_int(1, 25);
        if ($r !== 1) return;
        cacheDbPruneExpired($pdo);
    } catch (Exception $e) {
        // Ignore pruning errors (lock contention, random_int not available, etc.)
    }
}

function cacheDbCityKeyByAddress($address) {
    return 'addr:' . strtolower(trim((string)$address));
}

function cacheDbCityKeyByCoords($latitude, $longitude) {
    return 'coord:' . round((float)$latitude, 4) . ',' . round((float)$longitude, 4);
}

function cacheDbRegionKey($countryCode, $region) {
    $cc = strtolower(trim((string)$countryCode));
    $r = strtolower(trim((string)$region));
    return 'region:' . $cc . ':' . $r;
}

function cacheDbUpsertCity($pdo, $cityKey, $displayName, $latitude, $longitude, $timezone) {
    $now = time();
    $stmt = $pdo->prepare(
        'INSERT INTO cities(city_key, display_name, latitude, longitude, timezone, updated_at)
         VALUES(:k, :d, :lat, :lon, :tz, :u)
         ON CONFLICT(city_key) DO UPDATE SET
           display_name = excluded.display_name,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           timezone = excluded.timezone,
           updated_at = excluded.updated_at'
    );
    $stmt->execute([
        ':k' => $cityKey,
        ':d' => $displayName,
        ':lat' => $latitude,
        ':lon' => $longitude,
        ':tz' => $timezone,
        ':u' => $now
    ]);

    $idStmt = $pdo->prepare('SELECT id FROM cities WHERE city_key = :k LIMIT 1');
    $idStmt->execute([':k' => $cityKey]);
    $id = $idStmt->fetchColumn();
    $cityIdInt = $id ? (int)$id : null;
    if ($cityIdInt !== null) {
        esajdaServerLog('DB', 'upsertCity id=' . $cityIdInt . ' key=' . substr((string)$cityKey, 0, 80));
    }
    return $cityIdInt;
}

function cacheDbReadPayload($pdo, $cityId, $dataType, $variantKey) {
    $stmt = $pdo->prepare(
        'SELECT payload_json, expires_at
         FROM city_cache
         WHERE city_id = :c AND data_type = :t AND variant_key = :v
         LIMIT 1'
    );
    $stmt->execute([
        ':c' => (int)$cityId,
        ':t' => (string)$dataType,
        ':v' => (string)$variantKey
    ]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        esajdaServerLog('DB', 'read MISS city_id=' . (int)$cityId . ' type=' . $dataType . ' variant=' . substr((string)$variantKey, 0, 16) . '…');
        return null;
    }
    if ((int)$row['expires_at'] < time()) {
        esajdaServerLog('DB', 'read EXPIRED city_id=' . (int)$cityId . ' type=' . $dataType);
        return null;
    }
    esajdaServerLog('DB', 'read HIT city_id=' . (int)$cityId . ' type=' . $dataType);
    $payload = json_decode((string)$row['payload_json'], true);
    return is_array($payload) ? $payload : null;
}

function cacheDbWritePayload($pdo, $cityId, $dataType, $variantKey, $payload, $ttlSeconds) {
    $body = json_encode($payload);
    if ($body === false) return;
    // Safety guard: avoid DB bloat if an upstream API returns an unexpectedly huge payload.
    // 2MB is far above our normal payload sizes (weather/prayer/sun) but prevents pathological growth.
    if (strlen($body) > 2 * 1024 * 1024) {
        esajdaServerLog('DB', 'SKIP write (payload too large) city_id=' . (int)$cityId . ' type=' . $dataType . ' bytes=' . strlen($body));
        return;
    }
    $now = time();
    $expires = $now + (int)$ttlSeconds;
    $stmt = $pdo->prepare(
        'INSERT INTO city_cache(city_id, data_type, variant_key, payload_json, created_at, expires_at)
         VALUES(:c, :t, :v, :p, :ca, :ex)
         ON CONFLICT(city_id, data_type, variant_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at'
    );
    $stmt->execute([
        ':c' => (int)$cityId,
        ':t' => (string)$dataType,
        ':v' => (string)$variantKey,
        ':p' => $body,
        ':ca' => $now,
        ':ex' => $expires
    ]);
    esajdaServerLog('DB', 'WRITE city_id=' . (int)$cityId . ' type=' . $dataType . ' ttl=' . (int)$ttlSeconds . 's bytes=' . strlen($body));
}
