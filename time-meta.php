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

// 1–2) Aladhan (tz/coords) + Nominatim (region/country, coords fallback) in parallel when cURL is available.
$today = date('d-m-Y');
$aladhanUrl = 'https://api.aladhan.com/v1/timingsByAddress/' . urlencode($today)
    . '?address=' . urlencode($address)
    . '&method=4';

$nomUrl = 'https://nominatim.openstreetmap.org/search?'
    . http_build_query([
        'q' => $address,
        'format' => 'jsonv2',
        'addressdetails' => '1',
        'limit' => '1',
    ]);

$tz = '';
$lat = null;
$lon = null;
$region = '';
$country = '';
$countryCode = '';

esajdaServerLog('time_meta', 'upstream GET Aladhan + Nominatim (parallel)');
$pair = fetchTimeMetaParallel($aladhanUrl, $nomUrl);
$body = $pair[0];
$nomBody = $pair[1];

if ($body !== null) {
    $j = json_decode($body, true);
    if (is_array($j) && isset($j['code']) && (int)$j['code'] === 200) {
        $meta = $j['data']['meta'] ?? null;
        if (is_array($meta)) {
            $tz = isset($meta['timezone']) ? (string)$meta['timezone'] : '';
            if (isset($meta['latitude'])) {
                $lat = (float)$meta['latitude'];
            }
            if (isset($meta['longitude'])) {
                $lon = (float)$meta['longitude'];
            }
        }
    }
}

if ($nomBody !== null) {
    $arr = json_decode($nomBody, true);
    if (is_array($arr) && isset($arr[0]) && is_array($arr[0])) {
        $addr = isset($arr[0]['address']) && is_array($arr[0]['address']) ? $arr[0]['address'] : [];
        $region = (string)($addr['state'] ?? $addr['state_district'] ?? $addr['region'] ?? $addr['county'] ?? $addr['province'] ?? '');
        $country = (string)($addr['country'] ?? '');
        $countryCode = strtolower((string)($addr['country_code'] ?? ''));

        if ($lat === null && isset($arr[0]['lat'])) {
            $lat = (float)$arr[0]['lat'];
        }
        if ($lon === null && isset($arr[0]['lon'])) {
            $lon = (float)$arr[0]['lon'];
        }
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

/**
 * @return array{0: ?string, 1: ?string} [aladhanBody, nominatimBody]
 */
function fetchTimeMetaParallel(string $urlA, string $urlB): array
{
    if (!function_exists('curl_init') || !function_exists('curl_multi_init')) {
        return [fetchTimeMetaUrl($urlA), fetchTimeMetaUrl($urlB)];
    }

    $commonOpts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Accept-Language: en',
            'User-Agent: e-Sajda/1.0 (Time Meta)',
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_ENCODING => '',
    ];

    $mh = curl_multi_init();
    if ($mh === false) {
        return [fetchTimeMetaUrl($urlA), fetchTimeMetaUrl($urlB)];
    }

    $chA = curl_init($urlA);
    $chB = curl_init($urlB);
    if ($chA === false || $chB === false) {
        curl_multi_close($mh);
        return [fetchTimeMetaUrl($urlA), fetchTimeMetaUrl($urlB)];
    }

    curl_setopt_array($chA, $commonOpts);
    curl_setopt_array($chB, $commonOpts);
    curl_multi_add_handle($mh, $chA);
    curl_multi_add_handle($mh, $chB);

    $running = 0;
    do {
        $stat = curl_multi_exec($mh, $running);
    } while ($stat === CURLM_CALL_MULTI_PERFORM);

    while ($running > 0 && $stat === CURLM_OK) {
        $sel = curl_multi_select($mh, 1.0);
        if ($sel === -1) {
            usleep(1000);
        }
        do {
            $stat = curl_multi_exec($mh, $running);
        } while ($stat === CURLM_CALL_MULTI_PERFORM);
    }

    $outA = null;
    $outB = null;
    if (curl_errno($chA) === 0) {
        $b = curl_multi_getcontent($chA);
        if ($b !== false && $b !== '') {
            $outA = $b;
        }
    }
    if (curl_errno($chB) === 0) {
        $b = curl_multi_getcontent($chB);
        if ($b !== false && $b !== '') {
            $outB = $b;
        }
    }

    curl_multi_remove_handle($mh, $chA);
    curl_multi_remove_handle($mh, $chB);
    curl_close($chA);
    curl_close($chB);
    curl_multi_close($mh);

    // cURL multi can report errno 0 with empty bodies when TLS/CA is misconfigured (common on local PHP).
    // `fetchTimeMetaUrl` falls back to `file_get_contents` with the same relaxed SSL path as single requests.
    if ($outA === null || $outA === '') {
        $outA = fetchTimeMetaUrl($urlA);
    }
    if ($outB === null || $outB === '') {
        $outB = fetchTimeMetaUrl($urlB);
    }

    return [$outA, $outB];
}

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

