<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * RestCountries proxy + SQLite cache (capital, timezones, population, etc.).
 *
 * Input (GET):
 * - code: ISO 3166-1 alpha-2 (e.g. "in")
 *
 * Output:
 * { success: true, data: { ...restcountries item... } }
 * Same shape as restcountries.com/v3.1/alpha/{code}?fields=...
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

$cc = isset($_GET['code']) ? strtolower(trim((string)$_GET['code'])) : '';
if ($cc === '' || strlen($cc) !== 2) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'code (2-letter ISO) is required.']);
    exit;
}

$ttlSeconds = 30 * 24 * 60 * 60; // 30 days
$variantKey = 'restcountries.v1';
$db = cacheDbOpen();
$cityKey = 'iso2:' . $cc;
$cityId = null;

if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $cityKey, 'Country ' . strtoupper($cc), null, null, null);
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'country_info', $variantKey);
        if ($cached !== null && is_array($cached)) {
            header('X-Esajda-Cache: hit');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

$fields = 'name,cca2,cca3,capital,region,subregion,timezones,population';
$url = 'https://restcountries.com/v3.1/alpha/' . rawurlencode($cc) . '?fields=' . rawurlencode($fields);
esajdaServerLog('country_info', 'upstream GET ' . substr($url, 0, 120));

$body = countryInfoFetchUrl($url);
if ($body === null || $body === '') {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not fetch country info right now.']);
    exit;
}

$json = json_decode($body, true);
if (!is_array($json)) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid response from country directory.']);
    exit;
}

$item = isset($json[0]) && is_array($json[0]) ? $json[0] : (isset($json['cca2']) ? $json : null);
if ($item === null || !is_array($item)) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'Unknown country code.']);
    exit;
}

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'country_info', $variantKey, $item, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $item]);

function countryInfoFetchUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: e-Sajda/1.0 (Country Info)',
            ],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => '',
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        if ($errno === 0 && $body !== false && $body !== '') {
            return $body;
        }
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Country Info)\r\n",
            'timeout' => 20,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body !== false && $body !== '') {
        return $body;
    }
    $ctx2 = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Country Info)\r\n",
            'timeout' => 20,
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    $body2 = @file_get_contents($url, false, $ctx2);
    return ($body2 !== false && $body2 !== '') ? $body2 : null;
}
