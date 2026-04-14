<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Manual SQLite cache cleanup.
 *
 * - /cache-clean.php                  -> prune expired only
 * - /cache-clean.php?vacuum=1         -> prune expired + VACUUM (shrinks file)
 * - /cache-clean.php?danger=wipe      -> DELETE ALL cache rows (keeps schema)
 *
 * Returns JSON for easy use in browser/devtools.
 */

header('Content-Type: application/json; charset=utf-8');

$db = cacheDbOpen();
if ($db === null) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'SQLite not available.']);
    exit;
}

$danger = isset($_GET['danger']) ? (string)$_GET['danger'] : '';
$vacuum = isset($_GET['vacuum']) && $_GET['vacuum'] === '1';

try {
    $before = [
        'cities' => (int)$db->query('SELECT COUNT(*) FROM cities')->fetchColumn(),
        'city_cache' => (int)$db->query('SELECT COUNT(*) FROM city_cache')->fetchColumn()
    ];

    if ($danger === 'wipe') {
        $db->exec('DELETE FROM city_cache');
        $db->exec('DELETE FROM cities');
        esajdaServerLog('DB', 'cache-clean wipe requested');
    } else {
        cacheDbPruneExpired($db);
    }

    if ($vacuum) {
        // VACUUM can be slow; only on explicit request.
        $db->exec('VACUUM');
    }

    $after = [
        'cities' => (int)$db->query('SELECT COUNT(*) FROM cities')->fetchColumn(),
        'city_cache' => (int)$db->query('SELECT COUNT(*) FROM city_cache')->fetchColumn()
    ];

    echo json_encode([
        'success' => true,
        'mode' => $danger === 'wipe' ? 'wipe' : 'prune_expired',
        'vacuum' => $vacuum,
        'before' => $before,
        'after' => $after
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Cleanup failed.']);
}

