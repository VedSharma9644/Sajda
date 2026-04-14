<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Daily sun position samples (altitude + azimuth) + SQLite cache.
 *
 * Input (GET/POST):
 * - latitude (required)
 * - longitude (required)
 * - date (optional, YYYY-MM-DD; default today)
 * - step (optional minutes; default 5; min 1 max 30)
 * - timezone (optional IANA TZ like America/Chicago; recommended)
 *
 * Output:
 * { success: true, data: { date, timezone, stepMin, labels, minutes, altitudeDeg, azimuthDeg } }
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
$latitude = isset($input['latitude']) ? trim($input['latitude']) : null;
$longitude = isset($input['longitude']) ? trim($input['longitude']) : null;
$dateStr = isset($input['date']) ? trim((string)$input['date']) : '';
$stepMin = isset($input['step']) ? (int)$input['step'] : 5;
$tzName = isset($input['timezone']) ? trim((string)$input['timezone']) : '';

if (!is_numeric($latitude) || !is_numeric($longitude)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Latitude and longitude are required.']);
    exit;
}

if ($stepMin < 1) $stepMin = 1;
if ($stepMin > 30) $stepMin = 30;

$lat = (float)$latitude;
$lon = (float)$longitude;

$tz = null;
if ($tzName !== '') {
    try {
        $tz = new DateTimeZone($tzName);
    } catch (Exception $e) {
        $tz = null;
    }
}
if ($tz === null) {
    $tz = new DateTimeZone(date_default_timezone_get());
    $tzName = $tz->getName();
}
$GLOBALS['ESAJDA_TZ'] = $tz;

if ($dateStr === '') {
    $dateStr = (new DateTime('now', $tz))->format('Y-m-d');
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid date (use YYYY-MM-DD).']);
    exit;
}

$db = cacheDbOpen();
$cityId = null;
$cached = null;
$ttlSeconds = 365 * 24 * 60 * 60; // keep ~1 year
$variantKey = 'date:' . $dateStr . ':step:' . $stepMin . ':tz:' . $tzName . ':v1';
if ($db !== null) {
    $cityKey = cacheDbCityKeyByCoords($lat, $lon);
    $displayName = 'Lat/Lon ' . round($lat, 4) . ', ' . round($lon, 4);
    $cityId = cacheDbUpsertCity($db, $cityKey, $displayName, $lat, $lon, $tzName);
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'sun_day', $variantKey);
    }
}

if ($cached !== null) {
    header('X-Esajda-Cache: hit');
    echo json_encode(['success' => true, 'data' => $cached]);
    exit;
}

$data = buildDailySunSamples($dateStr, $lat, $lon, $stepMin, $tz);

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'sun_day', $variantKey, $data, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $data]);

// --- SunCalc getPosition port (from https://github.com/mourner/suncalc) ---

function rad($deg) { return $deg * M_PI / 180.0; }
function deg($rad) { return $rad * 180.0 / M_PI; }

function toJulian($timestampSeconds) {
    $dayMs = 1000.0 * 60.0 * 60.0 * 24.0;
    $J1970 = 2440588.0;
    return ($timestampSeconds * 1000.0) / $dayMs - 0.5 + $J1970;
}
function toDays($timestampSeconds) {
    $J2000 = 2451545.0;
    return toJulian($timestampSeconds) - $J2000;
}

function rightAscension($l, $b) {
    $e = rad(23.4397);
    return atan2(sin($l) * cos($e) - tan($b) * sin($e), cos($l));
}
function declination($l, $b) {
    $e = rad(23.4397);
    return asin(sin($b) * cos($e) + cos($b) * sin($e) * sin($l));
}
function azimuth($H, $phi, $dec) {
    return atan2(sin($H), cos($H) * sin($phi) - tan($dec) * cos($phi));
}
function altitude($H, $phi, $dec) {
    return asin(sin($phi) * sin($dec) + cos($phi) * cos($dec) * cos($H));
}
function siderealTime($d, $lw) {
    return rad(280.16 + 360.9856235 * $d) - $lw;
}
function solarMeanAnomaly($d) {
    return rad(357.5291 + 0.98560028 * $d);
}
function eclipticLongitude($M) {
    $C = rad(1.9148 * sin($M) + 0.02 * sin(2 * $M) + 0.0003 * sin(3 * $M));
    $P = rad(102.9372);
    return $M + $C + $P + M_PI;
}
function sunCoords($d) {
    $M = solarMeanAnomaly($d);
    $L = eclipticLongitude($M);
    return ['dec' => declination($L, 0), 'ra' => rightAscension($L, 0)];
}

function getPositionPhp(DateTime $dtLocal, $lat, $lng) {
    $lw = rad(-$lng);
    $phi = rad($lat);
    $t = (int)$dtLocal->format('U');
    $d = toDays($t);
    $c = sunCoords($d);
    $H = siderealTime($d, $lw) - $c['ra'];
    return [
        'azimuth' => azimuth($H, $phi, $c['dec']),
        'altitude' => altitude($H, $phi, $c['dec'])
    ];
}

function buildDailySunSamples($dateStr, $lat, $lon, $stepMin, DateTimeZone $tz) {
    $start = new DateTime($dateStr . ' 00:00:00', $tz);
    $labels = [];
    $minutes = [];
    $altitudeDeg = [];
    $azimuthDeg = [];

    $total = 24 * 60;
    for ($m = 0; $m <= $total; $m += $stepMin) {
        $dt = clone $start;
        $dt->modify('+' . $m . ' minutes');
        $pos = getPositionPhp($dt, $lat, $lon);
        $labels[] = $dt->format('H:i');
        $minutes[] = $m;
        $altitudeDeg[] = deg($pos['altitude']);
        // SunCalc azimuth is measured from south and positive west in radians.
        // We convert to a 0..360° bearing from north (clockwise) for UI.
        $azSouth = deg($pos['azimuth']); // -180..180, 0 = south
        $bearing = fmod(($azSouth + 180.0 + 360.0), 360.0); // 0 = north, 90=east
        $azimuthDeg[] = $bearing;
    }

    return [
        'date' => $dateStr,
        'timezone' => $tz->getName(),
        'stepMin' => (int)$stepMin,
        'provider' => 'suncalc-port',
        'fetchedAt' => time(),
        'labels' => $labels,
        'minutes' => $minutes,
        'altitudeDeg' => $altitudeDeg,
        'azimuthDeg' => $azimuthDeg
    ];
}

