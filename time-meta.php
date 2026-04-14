<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Time page metadata (timezone + coords + country/region) with SQLite cache.
 *
 * Input (GET):
 * - address (required)
 *
 * Output:
 * { success: true, data: { address, timezone, latitude, longitude, region, country, country_code } }
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

$address = isset($_GET['address']) ? trim((string)$_GET['address']) : '';
if ($address === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'address is required.']);
    exit;
}

$ttlSeconds = 30 * 24 * 60 * 60; // 30 days
$cityKey = cacheDbCityKeyByAddress($address);
$db = cacheDbOpen();
$cityId = null;

if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $cityKey, $address, null, null, null);
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'time_meta', 'v1');
        if ($cached !== null) {
            header('X-Esajda-Cache: hit');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

// 1) Timezone + coords via Aladhan timingsByAddress (method=4) for today.
$today = date('d-m-Y');
$aladhanUrl = 'https://api.aladhan.com/v1/timingsByAddress/' . urlencode($today)
    . '?address=' . urlencode($address)
    . '&method=4';

$tz = '';
$lat = null;
$lon = null;

esajdaServerLog('time_meta', 'upstream GET Aladhan for tz/coords');
$body = fetchTimeMetaUrl($aladhanUrl);
if ($body !== null) {
    $j = json_decode($body, true);
    if (is_array($j) && isset($j['code']) && (int)$j['code'] === 200) {
        $meta = $j['data']['meta'] ?? null;
        if (is_array($meta)) {
            $tz = isset($meta['timezone']) ? (string)$meta['timezone'] : '';
            if (isset($meta['latitude'])) $lat = (float)$meta['latitude'];
            if (isset($meta['longitude'])) $lon = (float)$meta['longitude'];
        }
    }
}

// 2) Region/country via Nominatim (addressdetails)
$region = '';
$country = '';
$countryCode = '';

$nomUrl = 'https://nominatim.openstreetmap.org/search?'
    . http_build_query([
        'q' => $address,
        'format' => 'jsonv2',
        'addressdetails' => '1',
        'limit' => '1',
    ]);

esajdaServerLog('time_meta', 'upstream GET Nominatim for region/country');
$nomBody = fetchTimeMetaUrl($nomUrl);
if ($nomBody !== null) {
    $arr = json_decode($nomBody, true);
    if (is_array($arr) && isset($arr[0]) && is_array($arr[0])) {
        $addr = isset($arr[0]['address']) && is_array($arr[0]['address']) ? $arr[0]['address'] : [];
        $region = (string)($addr['state'] ?? $addr['state_district'] ?? $addr['region'] ?? $addr['county'] ?? $addr['province'] ?? '');
        $country = (string)($addr['country'] ?? '');
        $countryCode = strtolower((string)($addr['country_code'] ?? ''));

        // If Aladhan didn't provide coords, use Nominatim.
        if ($lat === null && isset($arr[0]['lat'])) $lat = (float)$arr[0]['lat'];
        if ($lon === null && isset($arr[0]['lon'])) $lon = (float)$arr[0]['lon'];
    }
}

if ($tz === '' && $lat === null && $lon === null && $country === '') {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not resolve time metadata right now.']);
    exit;
}

$payload = [
    'address' => $address,
    'timezone' => $tz,
    'latitude' => $lat,
    'longitude' => $lon,
    'region' => $region,
    'country' => $country,
    'country_code' => $countryCode,
];

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'time_meta', 'v1', $payload, $ttlSeconds);
    // keep city row updated with core fields
    cacheDbUpsertCity($db, $cityKey, $address, $lat, $lon, $tz);
}
echo json_encode(['success' => true, 'data' => $payload]);

function fetchTimeMetaUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Accept-Language: en',
                'User-Agent: e-Sajda/1.0 (Time Meta)'
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
            'header' => "Accept: application/json\r\nAccept-Language: en\r\nUser-Agent: e-Sajda/1.0 (Time Meta)\r\n",
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
            'header' => "Accept: application/json\r\nAccept-Language: en\r\nUser-Agent: e-Sajda/1.0 (Time Meta)\r\n",
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

