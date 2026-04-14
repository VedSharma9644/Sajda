<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

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
$latitude = isset($input['latitude']) ? trim($input['latitude']) : null;
$longitude = isset($input['longitude']) ? trim($input['longitude']) : null;
$address = isset($input['address']) ? trim($input['address']) : null;
$method = isset($input['method']) ? (int)$input['method'] : 4;
$date = isset($input['date']) ? trim($input['date']) : null;
$month = isset($input['month']) ? (int)$input['month'] : null;
$year = isset($input['year']) ? (int)$input['year'] : null;
$action = isset($input['action']) ? trim($input['action']) : 'today';
$timezone = isset($input['timezone']) ? trim($input['timezone']) : null;

if (!$date) $date = date('d-m-Y');

$byCoordinates = is_numeric($latitude) && is_numeric($longitude);
$byAddress = $address !== null && $address !== '';
if (!$byCoordinates && !$byAddress) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Please provide either latitude and longitude or an address (city/country).']);
    exit;
}

$baseUrl = 'https://api.aladhan.com/v1';
if ($action === 'month') {
    if (!$month || !$year) {
        $month = (int)date('n');
        $year = (int)date('Y');
    }
    if ($byCoordinates) {
        $url = sprintf('%s/calendar?latitude=%s&longitude=%s&method=%d&month=%d&year=%d', $baseUrl, urlencode($latitude), urlencode($longitude), $method, $month, $year);
    } else {
        $url = sprintf('%s/calendarByAddress?address=%s&method=%d&month=%d&year=%d', $baseUrl, urlencode($address), $method, $month, $year);
    }
    if ($timezone) $url .= '&timezonestring=' . urlencode($timezone);
} else {
    if ($byCoordinates) {
        $url = sprintf('%s/timings/%s?latitude=%s&longitude=%s&method=%d', $baseUrl, $date, urlencode($latitude), urlencode($longitude), $method);
    } else {
        $url = sprintf('%s/timingsByAddress/%s?address=%s&method=%d', $baseUrl, $date, urlencode($address), $method);
    }
    if ($timezone) $url .= '&timezonestring=' . urlencode($timezone);
}

$db = cacheDbOpen();
$cityKey = $byCoordinates ? cacheDbCityKeyByCoords($latitude, $longitude) : cacheDbCityKeyByAddress($address);
$displayName = $byCoordinates ? 'Lat/Lon ' . round((float)$latitude, 4) . ', ' . round((float)$longitude, 4) : $address;
$cityId = null;
if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $cityKey, $displayName, $byCoordinates ? (float)$latitude : null, $byCoordinates ? (float)$longitude : null, $timezone);
}

$variantKey = buildPrayerVariantKey($action, $method, $date, $month, $year, $timezone);
// At least 10h served from SQLite before re-fetching upstream (month: 12h).
$ttlSeconds = ($action === 'month') ? 43200 : 36000;
$reqSummary = 'action=' . $action . ' method=' . $method . ' ' . ($byCoordinates ? ('lat=' . $latitude . ' lon=' . $longitude) : ('address=' . substr((string)$address, 0, 80)));
esajdaServerLog('api', 'request ' . $reqSummary);
if ($db !== null && $cityId !== null) {
    $cached = cacheDbReadPayload($db, $cityId, 'prayer', $variantKey);
    if ($cached !== null) {
        header('X-Esajda-Cache: hit');
        esajdaServerLog('api', 'response CACHE HIT → JSON to client');
        echo json_encode($cached);
        exit;
    }
}

esajdaServerLog('api', 'upstream GET Aladhan ' . substr($url, 0, 120) . (strlen($url) > 120 ? '…' : ''));
$response = fetchUrl($url);
if ($response === false || $response === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not reach prayer times service. Please try again in a moment.']);
    exit;
}

$data = json_decode($response, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid response from prayer times service.']);
    exit;
}

if (isset($data['code']) && $data['code'] !== 200) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $data['data']['message'] ?? 'Invalid request to prayer times API.']);
    exit;
}

$final = [
    'success' => true,
    'data' => $data['data'],
    'meta' => $data['meta'] ?? null,
    'provider' => 'aladhan',
    'fetchedAt' => time()
];
header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'prayer', $variantKey, $final, $ttlSeconds);
    // Store full upstream JSON too, so future UI can use more fields offline.
    cacheDbWritePayload($db, $cityId, 'prayer_raw', $variantKey, $data, $ttlSeconds);
    esajdaServerLog('api', 'response fresh from Aladhan + DB write ttl=' . $ttlSeconds . 's');
} else {
    esajdaServerLog('api', 'response fresh from Aladhan (no DB cache)');
}
echo json_encode($final);

/**
 * Fetch URL with cURL (preferred) or file_get_contents fallback.
 * Tries with SSL verification first; on failure (e.g. missing CA bundle on Windows),
 * retries with SSL verification disabled so prayer times still load.
 */
function fetchUrl($url) {
    $body = fetchUrlCurl($url, true);
    if ($body !== null) {
        return $body;
    }
    // Often fails on Windows due to missing CA bundle (CURLE_SSL_CACERT 60)
    $body = fetchUrlCurl($url, false);
    if ($body !== null) {
        return $body;
    }
    $body = fetchUrlStream($url, true);
    if ($body !== null) {
        return $body;
    }
    return fetchUrlStream($url, false);
}

/**
 * HTTP GET via cURL. Returns response body as string, or null on any failure.
 * `$verifySsl`: true uses normal certificate checks; false is a fallback when CA
 * bundles are missing (common on some Windows PHP installs).
 */
function fetchUrlCurl($url, $verifySsl) {
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'User-Agent: e-Sajda/1.0 (Prayer Times)'
        ],
        CURLOPT_SSL_VERIFYPEER => $verifySsl,
        CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
        CURLOPT_ENCODING       => ''
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);
    if ($errno === 0 && $body !== false && $body !== '') {
        return $body;
    }
    return null;
}

/**
 * HTTP GET via PHP streams (`file_get_contents`). Used when cURL is not available.
 * Same SSL verify flag meaning as `fetchUrlCurl`.
 */
function fetchUrlStream($url, $verifySsl) {
    $context = stream_context_create([
        'http' => [
            'method'  => 'GET',
            'header'  => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0\r\n",
            'timeout' => 20
        ],
        'ssl' => [
            'verify_peer'       => $verifySsl,
            'verify_peer_name'  => $verifySsl
        ]
    ]);
    $body = @file_get_contents($url, false, $context);
    return ($body !== false && $body !== '') ? $body : null;
}

/**
 * Stable cache key for prayer API requests.
 */
function buildPrayerVariantKey($action, $method, $date, $month, $year, $timezone) {
    $base = [
        'action' => (string)$action,
        'method' => (int)$method,
        'date' => (string)$date,
        'month' => (int)$month,
        'year' => (int)$year,
        'timezone' => (string)$timezone
    ];
    return sha1(json_encode($base));
}
