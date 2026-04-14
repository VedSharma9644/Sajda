<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Geocoding proxy + SQLite cache (Nominatim).
 *
 * Input:
 * - address (required)
 *
 * Output:
 * { success: true, data: { latitude, longitude, displayName } }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Expose-Headers: X-Esajda-Cache');

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'])) {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = array_merge($_GET, $_POST);
$address = isset($input['address']) ? trim((string)$input['address']) : '';
if ($address === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Address is required.']);
    exit;
}

$cityKey = cacheDbCityKeyByAddress($address);
$ttlSeconds = 7 * 24 * 60 * 60; // 7 days
esajdaServerLog('geo', 'request address=' . substr($address, 0, 120) . (strlen($address) > 120 ? '…' : ''));
$db = cacheDbOpen();
$cityId = null;
if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $cityKey, $address, null, null, 'auto');
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'geocode', 'nominatim.v1');
        if ($cached !== null) {
            header('X-Esajda-Cache: hit');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

$url = 'https://nominatim.openstreetmap.org/search?q=' . urlencode($address) . '&format=json&addressdetails=1&limit=1';
esajdaServerLog('geo', 'upstream GET Nominatim ' . substr($url, 0, 160) . (strlen($url) > 160 ? '…' : ''));
$body = fetchGeoUrl($url);
if ($body === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not geocode address right now.']);
    exit;
}

$json = json_decode($body, true);
if (!is_array($json) || !isset($json[0])) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'No results for address.']);
    exit;
}

$latitude = isset($json[0]['lat']) ? (float)$json[0]['lat'] : null;
$longitude = isset($json[0]['lon']) ? (float)$json[0]['lon'] : null;
if ($latitude === null || $longitude === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid geocoding response.']);
    exit;
}

$displayName = isset($json[0]['display_name']) ? (string)$json[0]['display_name'] : $address;
$payload = [
    'latitude' => $latitude,
    'longitude' => $longitude,
    'displayName' => $displayName
];

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'geocode', 'nominatim.v1', $payload, $ttlSeconds);
    cacheDbWritePayload($db, $cityId, 'geocode_raw', 'nominatim.v1', $json, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $payload]);

function fetchGeoUrl($url) {
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
                // Nominatim policy: identify your application via UA.
                'User-Agent: e-Sajda/1.0 (Geocoding)'
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
            'header' => "Accept: application/json\r\nAccept-Language: en\r\nUser-Agent: e-Sajda/1.0 (Geocoding)\r\n",
            'timeout' => 20
        ]
    ]);
    $body = @file_get_contents($url, false, $ctx);
    return ($body !== false && $body !== '') ? $body : null;
}

