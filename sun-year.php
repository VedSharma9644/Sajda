<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';

/**
 * Yearly sun/twilight times (SunCalc port) + SQLite cache.
 *
 * Input (GET/POST):
 * - latitude (required, numeric)
 * - longitude (required, numeric)
 * - year (optional, default current year)
 *
 * Output:
 * { success: true, data: { year, dayCount, labels, sunriseMin, sunsetMin, dayExtras } }
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
$year = isset($input['year']) ? (int)$input['year'] : (int)date('Y');
$tzName = isset($input['timezone']) ? trim((string)$input['timezone']) : '';

if (!is_numeric($latitude) || !is_numeric($longitude)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Latitude and longitude are required.']);
    exit;
}
if ($year < 1900 || $year > 2100) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid year.']);
    exit;
}

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
    // Fallback: server timezone (may be UTC). Client should send the location timezone.
    $tz = new DateTimeZone(date_default_timezone_get());
    $tzName = $tz->getName();
}
$GLOBALS['ESAJDA_TZ'] = $tz;

$db = cacheDbOpen();
$cityId = null;
$cached = null;
$ttlSeconds = 10 * 365 * 24 * 60 * 60; // deterministic data: keep for ~10 years
$variantKey = 'year:' . $year . ':tz:' . $tzName . ':v2';
if ($db !== null) {
    $cityKey = cacheDbCityKeyByCoords($lat, $lon);
    $displayName = 'Lat/Lon ' . round($lat, 4) . ', ' . round($lon, 4);
    $cityId = cacheDbUpsertCity($db, $cityKey, $displayName, $lat, $lon, 'auto');
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'sun_year', $variantKey);
    }
}

if ($cached !== null) {
    header('X-Esajda-Cache: hit');
    echo json_encode(['success' => true, 'data' => $cached]);
    exit;
}

$series = buildYearlySunSeriesPhp($year, $lat, $lon, $tz);

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'sun_year', $variantKey, $series, $ttlSeconds);
}
echo json_encode(['success' => true, 'data' => $series]);

/**
 * --- SunCalc getTimes port (from https://github.com/mourner/suncalc) ---
 * Returns DateTime objects in local time.
 */

function rad($deg) {
    return $deg * M_PI / 180.0;
}
function toJulian($timestampSeconds) {
    // JS: date.valueOf()/dayMs - 0.5 + J1970
    $dayMs = 1000.0 * 60.0 * 60.0 * 24.0;
    $J1970 = 2440588.0;
    return ($timestampSeconds * 1000.0) / $dayMs - 0.5 + $J1970;
}
function fromJulian($j) {
    $dayMs = 1000.0 * 60.0 * 60.0 * 24.0;
    $J1970 = 2440588.0;
    $ms = ($j + 0.5 - $J1970) * $dayMs;
    $sec = (int)round($ms / 1000.0);
    $dt = new DateTime('@' . $sec);
    $tz = isset($GLOBALS['ESAJDA_TZ']) && ($GLOBALS['ESAJDA_TZ'] instanceof DateTimeZone)
        ? $GLOBALS['ESAJDA_TZ']
        : new DateTimeZone(date_default_timezone_get());
    $dt->setTimezone($tz);
    return $dt;
}
function toDays($dateSeconds) {
    $J2000 = 2451545.0;
    return toJulian($dateSeconds) - $J2000;
}
function rightAscension($l, $b) {
    $e = rad(23.4397);
    return atan2(sin($l) * cos($e) - tan($b) * sin($e), cos($l));
}
function declination($l, $b) {
    $e = rad(23.4397);
    return asin(sin($b) * cos($e) + cos($b) * sin($e) * sin($l));
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
    return [
        'dec' => declination($L, 0),
        'ra' => rightAscension($L, 0),
        'M' => $M,
        'L' => $L
    ];
}
function julianCycle($d, $lw) {
    $J0 = 0.0009;
    return round($d - $J0 - $lw / (2 * M_PI));
}
function approxTransit($Ht, $lw, $n) {
    $J0 = 0.0009;
    return $J0 + ($Ht + $lw) / (2 * M_PI) + $n;
}
function solarTransitJ($ds, $M, $L) {
    $J2000 = 2451545.0;
    return $J2000 + $ds + 0.0053 * sin($M) - 0.0069 * sin(2 * $L);
}
function hourAngle($h, $phi, $d) {
    return acos((sin($h) - sin($phi) * sin($d)) / (cos($phi) * cos($d)));
}
function observerAngle($height) {
    return -2.076 * sqrt($height) / 60.0;
}
function getSetJ($h, $lw, $phi, $dec, $n, $M, $L) {
    $w = hourAngle($h, $phi, $dec);
    $a = approxTransit($w, $lw, $n);
    return solarTransitJ($a, $M, $L);
}

function getTimesPhp(DateTime $dateLocalNoon, $lat, $lng, $heightMeters = 0.0) {
    $heightMeters = $heightMeters ?: 0.0;
    $lw = rad(-$lng);
    $phi = rad($lat);
    $dh = observerAngle($heightMeters);

    $dateSeconds = (int)$dateLocalNoon->format('U');
    $d = toDays($dateSeconds);
    $n = julianCycle($d, $lw);
    $ds = approxTransit(0, $lw, $n);

    $coords = sunCoords($ds);
    $M = $coords['M'];
    $L = $coords['L'];
    $dec = $coords['dec'];

    $Jnoon = solarTransitJ($ds, $M, $L);
    $result = [
        'solarNoon' => fromJulian($Jnoon),
        'nadir' => fromJulian($Jnoon - 0.5)
    ];

    $times = [
        [-0.833, 'sunrise', 'sunset'],
        [-0.3, 'sunriseEnd', 'sunsetStart'],
        [-6, 'dawn', 'dusk'],
        [-12, 'nauticalDawn', 'nauticalDusk'],
        [-18, 'nightEnd', 'night'],
        [6, 'goldenHourEnd', 'goldenHour']
    ];

    foreach ($times as $t) {
        $h0 = rad($t[0] + $dh);
        $Jset = getSetJ($h0, $lw, $phi, $dec, $n, $M, $L);
        $Jrise = $Jnoon - ($Jset - $Jnoon);
        $result[$t[1]] = fromJulian($Jrise);
        $result[$t[2]] = fromJulian($Jset);
    }

    return $result;
}

function minutesFromMidnightLocal(DateTime $dt) {
    $h = (int)$dt->format('G'); // 0-23
    $m = (int)$dt->format('i');
    $s = (int)$dt->format('s');
    return $h * 60.0 + $m + ($s / 60.0);
}

function buildYearlySunSeriesPhp($year, $lat, $lon, DateTimeZone $tz) {
    $labels = [];
    $sunriseMin = [];
    $sunsetMin = [];
    $dayExtras = [];

    $extrasMap = [
        ['key' => 'nightEnd', 'label' => 'Astronomical dawn'],
        ['key' => 'nauticalDawn', 'label' => 'Nautical dawn'],
        ['key' => 'dawn', 'label' => 'Civil dawn'],
        ['key' => 'sunriseEnd', 'label' => 'Sunrise ends'],
        ['key' => 'solarNoon', 'label' => 'Solar noon'],
        ['key' => 'goldenHourEnd', 'label' => 'Golden hour ends (a.m.)'],
        ['key' => 'dusk', 'label' => 'Civil dusk'],
        ['key' => 'nauticalDusk', 'label' => 'Nautical dusk'],
        ['key' => 'sunsetStart', 'label' => 'Sunset starts'],
        ['key' => 'goldenHour', 'label' => 'Golden hour ends (p.m.)'],
        ['key' => 'night', 'label' => 'Astronomical dusk'],
        ['key' => 'nadir', 'label' => 'Solar midnight']
    ];

    $d = new DateTime($year . '-01-01 12:00:00', $tz);
    while ((int)$d->format('Y') === (int)$year) {
        $labels[] = $d->format('m/d');
        $times = getTimesPhp(clone $d, $lat, $lon, 0.0);
        $sunriseMin[] = isset($times['sunrise']) ? minutesFromMidnightLocal($times['sunrise']) : null;
        $sunsetMin[] = isset($times['sunset']) ? minutesFromMidnightLocal($times['sunset']) : null;

        $extras = [];
        foreach ($extrasMap as $e) {
            $k = $e['key'];
            if (!isset($times[$k]) || !($times[$k] instanceof DateTime)) continue;
            $extras[] = ['key' => $k, 'label' => $e['label'], 'minutes' => minutesFromMidnightLocal($times[$k])];
        }
        usort($extras, function($a, $b) {
            return ($a['minutes'] <=> $b['minutes']);
        });
        $dayExtras[] = $extras;

        $d->modify('+1 day');
    }

    return [
        'year' => (int)$year,
        'dayCount' => count($labels),
        'timezone' => $tz->getName(),
        'provider' => 'suncalc-port',
        'fetchedAt' => time(),
        'labels' => $labels,
        'sunriseMin' => $sunriseMin,
        'sunsetMin' => $sunsetMin,
        'dayExtras' => $dayExtras
    ];
}

