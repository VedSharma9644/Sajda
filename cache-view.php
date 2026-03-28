<?php
// phpcs:ignoreFile
/**
 * e-Sajda cache viewer (read-only)
 *
 * Usage:
 * - /cache-view.php          -> simple HTML table
 * - /cache-view.php?json=1   -> JSON output
 *
 * This does not modify cache data.
 */

$dbPath = __DIR__ . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'cache.db';

if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    http_response_code(500);
    echo 'SQLite PDO driver is not available.';
    exit;
}

if (!is_file($dbPath)) {
    http_response_code(404);
    echo 'Cache database not found yet.';
    exit;
}

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $stmt = $pdo->query(
        'SELECT cc.created_at, cc.data_type, cc.variant_key, cc.payload_json, c.city_key, c.display_name, c.latitude, c.longitude, c.timezone
         FROM city_cache cc
         INNER JOIN cities c ON c.id = cc.city_id
         ORDER BY cc.created_at DESC
         LIMIT 1000'
    );
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (Exception $e) {
    http_response_code(500);
    echo 'Failed to read cache database.';
    exit;
}

/**
 * Best-effort summary parser for payload JSON.
 */
function summarizePayload($payloadJson) {
    $summary = [
        'type' => 'unknown',
        'timezone' => '',
        'method' => '',
        'items' => '',
        'fajr' => '',
        'dhuhr' => '',
        'asr' => '',
        'maghrib' => '',
        'isha' => '',
        'temp' => '',
        'weather' => ''
    ];
    $obj = json_decode($payloadJson, true);
    if (!is_array($obj)) return $summary;
    $data = isset($obj['data']) ? $obj['data'] : $obj;
    if (is_array($data) && isset($data['timings'])) {
        $summary['type'] = 'today';
        $summary['timezone'] = isset($data['meta']['timezone']) ? (string)$data['meta']['timezone'] : '';
        $summary['method'] = isset($data['meta']['method']['name']) ? (string)$data['meta']['method']['name'] : '';
        $summary['items'] = isset($data['date']['readable']) ? (string)$data['date']['readable'] : '1 day';
        $summary['fajr'] = isset($data['timings']['Fajr']) ? (string)$data['timings']['Fajr'] : '';
        $summary['dhuhr'] = isset($data['timings']['Dhuhr']) ? (string)$data['timings']['Dhuhr'] : '';
        $summary['asr'] = isset($data['timings']['Asr']) ? (string)$data['timings']['Asr'] : '';
        $summary['maghrib'] = isset($data['timings']['Maghrib']) ? (string)$data['timings']['Maghrib'] : '';
        $summary['isha'] = isset($data['timings']['Isha']) ? (string)$data['timings']['Isha'] : '';
        return $summary;
    }

    if (is_array($data) && isset($data['temperature'])) {
        $summary['type'] = 'weather';
        $summary['timezone'] = isset($data['timezone']) ? (string)$data['timezone'] : '';
        $summary['temp'] = isset($data['temperature']) ? ((string)$data['temperature'] . '°C') : '';
        $summary['weather'] = isset($data['summary']) ? (string)$data['summary'] : '';
        $summary['items'] = 'current';
        return $summary;
    }

    if (is_array($data) && isset($data[0])) {
        $summary['type'] = 'month';
        $summary['items'] = count($data) . ' rows';
        if (isset($data[0]['meta']['timezone'])) $summary['timezone'] = (string)$data[0]['meta']['timezone'];
        if (isset($data[0]['meta']['method']['name'])) $summary['method'] = (string)$data[0]['meta']['method']['name'];
        return $summary;
    }

    if (is_array($data) && isset($data['data']) && is_array($data['data'])) {
        $summary['type'] = 'month';
        $summary['items'] = count($data['data']) . ' rows';
        return $summary;
    }

    return $summary;
}

$out = [];
foreach ($rows as $row) {
    $s = summarizePayload($row['payload_json']);
    $out[] = [
        'city_key' => (string)$row['city_key'],
        'display_name' => (string)$row['display_name'],
        'lat' => $row['latitude'],
        'lon' => $row['longitude'],
        'source' => (string)$row['data_type'],
        'variant' => (string)$row['variant_key'],
        'cache_key' => sha1($row['city_key'] . '|' . $row['data_type'] . '|' . $row['variant_key']),
        'created_at' => (int)$row['created_at'],
        'created_at_iso' => date('c', (int)$row['created_at']),
        'type' => $s['type'],
        'timezone' => $s['timezone'] !== '' ? $s['timezone'] : (string)$row['timezone'],
        'method' => $s['method'],
        'items' => $s['items'],
        'fajr' => $s['fajr'],
        'dhuhr' => $s['dhuhr'],
        'asr' => $s['asr'],
        'maghrib' => $s['maghrib'],
        'isha' => $s['isha'],
        'temp' => $s['temp'],
        'weather' => $s['weather']
    ];
}

if (isset($_GET['json']) && $_GET['json'] === '1') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'count' => count($out),
        'entries' => $out
    ]);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>e-Sajda Cache Viewer</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #0f1419; color: #e7e9ea; }
        h1 { margin: 0 0 12px; font-size: 24px; }
        p { color: #8b98a5; margin: 0 0 14px; }
        table { width: 100%; border-collapse: collapse; background: #1a2332; }
        th, td { border: 1px solid #38444d; padding: 8px 10px; text-align: left; font-size: 13px; }
        th { background: #243447; }
        code { color: #9ad1ff; }
        .meta { margin-bottom: 14px; }
        a { color: #1d9bf0; }
    </style>
</head>
<body>
    <h1>Cache Viewer</h1>
    <p class="meta">Entries: <?php echo count($out); ?> · Source: <code>database/cache.db</code> · <a href="/cache-view.php?json=1">JSON view</a></p>
    <table>
        <thead>
            <tr>
                <th>Created (ISO)</th>
                <th>City</th>
                <th>Coords</th>
                <th>Source</th>
                <th>Variant</th>
                <th>Type</th>
                <th>Timezone</th>
                <th>Method</th>
                <th>Items</th>
                <th>Fajr</th>
                <th>Dhuhr</th>
                <th>Asr</th>
                <th>Maghrib</th>
                <th>Isha</th>
                <th>Temp</th>
                <th>Weather</th>
                <th>Cache Key</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($out as $e): ?>
                <tr>
                    <td><?php echo htmlspecialchars($e['created_at_iso'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['display_name'] ?: $e['city_key'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars(($e['lat'] !== null ? $e['lat'] : '—') . ', ' . ($e['lon'] !== null ? $e['lon'] : '—'), ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['source'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['variant'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['type'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['timezone'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['method'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['items'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['fajr'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['dhuhr'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['asr'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['maghrib'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['isha'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['temp'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><?php echo htmlspecialchars($e['weather'], ENT_QUOTES, 'UTF-8'); ?></td>
                    <td><code><?php echo htmlspecialchars($e['cache_key'], ENT_QUOTES, 'UTF-8'); ?></code></td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</body>
</html>
