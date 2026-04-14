<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Popular city suggestions from local SQLite DB.
 *
 * Input (GET):
 * - q: search query (required)
 * - limit: optional, default 6, max 20
 *
 * Output:
 * { success: true, data: { query, cities: [{ label }] } }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$query = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
$want = isset($_GET['limit']) ? (int)$_GET['limit'] : 6;
$want = $want > 0 ? $want : 6;
if ($want > 20) $want = 20;

if ($query === '' || strlen($query) < 2) {
    echo json_encode(['success' => true, 'data' => ['query' => $query, 'cities' => []]]);
    exit;
}

$pdo = popularLocationDbOpen();
if ($pdo === null) {
    echo json_encode(['success' => true, 'data' => ['query' => $query, 'cities' => []]]);
    exit;
}

try {
    $q = mb_strtolower($query, 'UTF-8');
} catch (Exception $e) {
    $q = strtolower($query);
}
$qLikePrefix = $q . '%';
$qLikeAny = '%' . $q . '%';

try {
    // Prefix matches first, then contains matches.
    $stmt = $pdo->prepare(
        'SELECT city, state, country
         FROM popular_cities
         WHERE city IS NOT NULL
           AND country IS NOT NULL
           AND TRIM(city) <> ""
           AND TRIM(country) <> ""
           AND lower(city) LIKE :q
         LIMIT :lim'
    );
    $stmt->bindValue(':q', $qLikePrefix, PDO::PARAM_STR);
    $stmt->bindValue(':lim', (int)$want, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (!is_array($rows)) $rows = [];
    if (count($rows) < $want) {
        $need = $want - count($rows);
        $stmt2 = $pdo->prepare(
            'SELECT city, state, country
             FROM popular_cities
             WHERE city IS NOT NULL
               AND country IS NOT NULL
               AND TRIM(city) <> ""
               AND TRIM(country) <> ""
               AND lower(city) LIKE :q
             LIMIT :lim'
        );
        $stmt2->bindValue(':q', $qLikeAny, PDO::PARAM_STR);
        $stmt2->bindValue(':lim', (int)$need, PDO::PARAM_INT);
        $stmt2->execute();
        $rows2 = $stmt2->fetchAll(PDO::FETCH_ASSOC);
        if (is_array($rows2) && $rows2) {
            $rows = array_merge($rows, $rows2);
        }
    }

    $seen = [];
    $cities = [];
    foreach ($rows as $r) {
        $city = isset($r['city']) ? trim((string)$r['city']) : '';
        $state = isset($r['state']) ? trim((string)$r['state']) : '';
        $country = isset($r['country']) ? trim((string)$r['country']) : '';
        if ($city === '' || $country === '') continue;

        $labelParts = [$city];
        if ($state !== '' && strcasecmp($state, $city) !== 0) $labelParts[] = $state;
        $labelParts[] = $country;
        $label = implode(', ', $labelParts);
        $k = strtolower($label);
        if (isset($seen[$k])) continue;
        $seen[$k] = true;
        $cities[] = ['label' => $label];
        if (count($cities) >= $want) break;
    }

    echo json_encode(['success' => true, 'data' => ['query' => $query, 'cities' => $cities]]);
} catch (Exception $e) {
    esajdaServerLog('popular', 'query failed: ' . $e->getMessage());
    echo json_encode(['success' => true, 'data' => ['query' => $query, 'cities' => []]]);
}

