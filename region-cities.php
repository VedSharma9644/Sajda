<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Region cities directory (server proxy + SQLite cache)
 *
 * Input (GET):
 * - country_code: ISO alpha-2 (e.g. "gb")
 * - region: state/province/region name (e.g. "England", "California")
 *
 * Output:
 * { success: true, data: { country_code, region, cities: [{ label }] } }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Expose-Headers: X-Esajda-Cache');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$cc = isset($_GET['country_code']) ? strtolower(trim((string)$_GET['country_code'])) : '';
$region = isset($_GET['region']) ? trim((string)$_GET['region']) : '';
$want = isset($_GET['limit']) ? (int)$_GET['limit'] : 30;
$want = $want > 0 ? $want : 30;
if ($want > 60) $want = 60;

if ($cc === '' || strlen($cc) !== 2 || $region === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'country_code (2 letters) and region are required.']);
    exit;
}

$ttlSeconds = 30 * 24 * 60 * 60; // 30 days
$db = cacheDbOpen();
$key = cacheDbRegionKey($cc, $region);
$cityId = null;

if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $key, 'Region ' . $region . ' (' . strtoupper($cc) . ')', null, null, null);
    if ($cityId !== null) {
        // v3: DB-first source (popular-location.db), fallback to Nominatim.
        $cached = cacheDbReadPayload($db, $cityId, 'region_cities', 'v3');
        if ($cached !== null) {
            header('X-Esajda-Cache: hit');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

// First try local popular-location DB (region-level popular cities).
$popularCities = popularCitiesFromDbByRegion($cc, $region, $want);
if (count($popularCities) > 0) {
    $payload = [
        'country_code' => $cc,
        'region' => $region,
        'cities' => $popularCities,
    ];
    header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
    if ($db !== null && $cityId !== null) {
        cacheDbWritePayload($db, $cityId, 'region_cities', 'v3', $payload, $ttlSeconds);
    }
    echo json_encode(['success' => true, 'data' => $payload]);
    exit;
}

// Nominatim structured search: "state" + "countrycodes"
// NOTE: We intentionally do NOT set featuretype=city, because that can exclude useful results.
// We'll filter using the returned address fields (city/town/village) instead.
$upstreamLimit = max(18, min(120, $want * 4));
$url = 'https://nominatim.openstreetmap.org/search?'
    . http_build_query([
        'state' => $region,
        'countrycodes' => $cc,
        'format' => 'jsonv2',
        'addressdetails' => '1',
        'namedetails' => '1',
        'limit' => (string)$upstreamLimit,
    ]);

esajdaServerLog('region', 'upstream GET nominatim region cities cc=' . $cc . ' region=' . substr($region, 0, 60));
$body = fetchRegionUrl($url);
if ($body === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not fetch region cities right now.']);
    exit;
}
$json = json_decode($body, true);
if (!is_array($json)) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid response from directory service.']);
    exit;
}

$cities = [];
foreach ($json as $item) {
    if (!is_array($item)) continue;
    $addr = isset($item['address']) && is_array($item['address']) ? $item['address'] : [];
    $name =
        ($addr['city'] ?? '') ? $addr['city'] :
        (($addr['town'] ?? '') ? $addr['town'] :
        (($addr['village'] ?? '') ? $addr['village'] :
        (($item['name'] ?? '') ? $item['name'] : '')));
    $country = $addr['country'] ?? '';
    $label = trim($name . ($country ? ', ' . $country : ''));
    if ($label === '') continue;
    $cities[$label] = ['label' => $label];
    if (count($cities) >= $want) break;
}

$payload = [
    'country_code' => $cc,
    'region' => $region,
    'cities' => array_values($cities),
];

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'region_cities', 'v3', $payload, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $payload]);

function fetchRegionUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: e-Sajda/1.0 (Region Cities)'
            ],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => ''
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        if ($errno === 0 && $body !== false && $body !== '') return $body;
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Region Cities)\r\n",
            'timeout' => 20
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true
        ]
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body !== false && $body !== '') return $body;
    // Windows CA bundle fallback
    $ctx2 = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Region Cities)\r\n",
            'timeout' => 20
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false
        ]
    ]);
    $body2 = @file_get_contents($url, false, $ctx2);
    return ($body2 !== false && $body2 !== '') ? $body2 : null;
}

function popularCitiesFromDbByRegion($countryCode, $region, $limit) {
    $pdo = popularLocationDbOpen();
    if ($pdo === null) return [];

    $countryName = popularDbCountryNameByIso2($pdo, $countryCode);
    if ($countryName === null || $countryName === '') return [];

    $regionName = trim((string)$region);
    if ($regionName === '') return [];

    try {
        $stmt = $pdo->prepare(
            'SELECT city
             FROM popular_cities
             WHERE country = :country
               AND state = :state
               AND city IS NOT NULL
               AND TRIM(city) <> ""
             LIMIT :lim'
        );
        $stmt->bindValue(':country', $countryName, PDO::PARAM_STR);
        $stmt->bindValue(':state', $regionName, PDO::PARAM_STR);
        $stmt->bindValue(':lim', (int)$limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($rows) || !$rows) return [];

        $out = [];
        $seen = [];
        foreach ($rows as $row) {
            $city = isset($row['city']) ? trim((string)$row['city']) : '';
            if ($city === '') continue;
            $label = $city . ', ' . $countryName;
            $k = strtolower($label);
            if (isset($seen[$k])) continue;
            $seen[$k] = true;
            $out[] = ['label' => $label];
        }
        return $out;
    } catch (Exception $e) {
        esajdaServerLog('region', 'popular db query failed: ' . $e->getMessage());
        return [];
    }
}

function popularDbCountryNameByIso2($pdo, $countryCode) {
    $cc = strtolower(trim((string)$countryCode));
    if ($cc === '' || strlen($cc) !== 2) return null;
    try {
        $stmt = $pdo->prepare(
            'SELECT name
             FROM countries
             WHERE lower(iso2) = :cc
             LIMIT 1'
        );
        $stmt->execute([':cc' => $cc]);
        $name = $stmt->fetchColumn();
        return is_string($name) ? trim($name) : null;
    } catch (Exception $e) {
        esajdaServerLog('region', 'popular db country lookup failed: ' . $e->getMessage());
        return null;
    }
}

