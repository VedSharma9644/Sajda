<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Country cities directory (server proxy + SQLite cache)
 *
 * Input (GET):
 * - country_code: ISO alpha-2 (e.g. "gb")
 * - limit: optional, default 30, max 60
 *
 * Output:
 * { success: true, data: { country_code, cities: [{ label }] } }
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
$want = isset($_GET['limit']) ? (int)$_GET['limit'] : 30;
$want = $want > 0 ? $want : 30;
if ($want > 60) $want = 60;

if ($cc === '' || strlen($cc) !== 2) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'country_code (2 letters) is required.']);
    exit;
}

$ttlSeconds = 30 * 24 * 60 * 60; // 30 days
$db = cacheDbOpen();
$key = 'country:' . $cc;
$cityId = null;

if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $key, 'Country ' . strtoupper($cc), null, null, null);
    if ($cityId !== null) {
        // v2: DB-first source (popular-location.db), fallback to Nominatim.
        $cached = cacheDbReadPayload($db, $cityId, 'country_cities', 'v2');
        if ($cached !== null) {
            header('X-Esajda-Cache: hit');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

// First try local popular-location DB (country-level popular cities).
$popularCities = popularCitiesFromDbByCountryCode($cc, $want);
if (count($popularCities) > 0) {
    $payload = [
        'country_code' => $cc,
        'cities' => $popularCities,
    ];
    header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
    if ($db !== null && $cityId !== null) {
        cacheDbWritePayload($db, $cityId, 'country_cities', 'v2', $payload, $ttlSeconds);
    }
    echo json_encode(['success' => true, 'data' => $payload]);
    exit;
}

// Nominatim: search in a country for populated places. We request many and then filter/dedupe.
$upstreamLimit = max(50, min(200, $want * 5));
$url = 'https://nominatim.openstreetmap.org/search?'
    . http_build_query([
        'countrycodes' => $cc,
        'format' => 'jsonv2',
        'addressdetails' => '1',
        'namedetails' => '1',
        'limit' => (string)$upstreamLimit,
        // Keep featuretype=city here: it works better for country-wide lists.
        // We still accept town/village from address fields.
        'featuretype' => 'city',
    ]);

esajdaServerLog('country', 'upstream GET nominatim country cities cc=' . $cc);
$body = fetchCountryUrl($url);
if ($body === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not fetch country cities right now.']);
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
    $label = trim((string)$name . ($country ? ', ' . (string)$country : ''));
    if ($label === '') continue;
    $cities[$label] = ['label' => $label];
    if (count($cities) >= $want) break;
}

$payload = [
    'country_code' => $cc,
    'cities' => array_values($cities),
];

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'country_cities', 'v2', $payload, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $payload]);

function fetchCountryUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: e-Sajda/1.0 (Country Cities)'
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
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Country Cities)\r\n",
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
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Country Cities)\r\n",
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

function popularCitiesFromDbByCountryCode($countryCode, $limit) {
    $pdo = popularLocationDbOpen();
    if ($pdo === null) return [];

    $countryName = popularDbCountryNameByIso2($pdo, $countryCode);
    if ($countryName === null || $countryName === '') return [];

    try {
        $stmt = $pdo->prepare(
            'SELECT city
             FROM popular_cities
             WHERE country = :country
               AND city IS NOT NULL
               AND TRIM(city) <> ""
             LIMIT :lim'
        );
        $stmt->bindValue(':country', $countryName, PDO::PARAM_STR);
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
        esajdaServerLog('country', 'popular db query failed: ' . $e->getMessage());
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
        esajdaServerLog('country', 'popular db country lookup failed: ' . $e->getMessage());
        return null;
    }
}

