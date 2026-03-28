<?php
// phpcs:ignoreFile
require_once __DIR__ . '/database/cache-db.php';
/**
 * Weather proxy + SQLite cache
 *
 * Input:
 * - latitude
 * - longitude
 *
 * Output:
 * {
 *   success: true,
 *   data: { timezone, temperature, apparentTemperature, humidity, windSpeed, isDay, weatherCode, summary, maxToday, minToday, rainChance }
 * }
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

if (!is_numeric($latitude) || !is_numeric($longitude)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Latitude and longitude are required.']);
    exit;
}

$cityKey = cacheDbCityKeyByCoords((float)$latitude, (float)$longitude);
$ttlSeconds = 36000; // 10 hours (match prayer cache policy)
esajdaServerLog('weather', 'request lat=' . $latitude . ' lon=' . $longitude);
$db = cacheDbOpen();
$cityId = null;
if ($db !== null) {
    $cityId = cacheDbUpsertCity($db, $cityKey, 'Lat/Lon ' . round((float)$latitude, 4) . ', ' . round((float)$longitude, 4), (float)$latitude, (float)$longitude, 'auto');
    if ($cityId !== null) {
        $cached = cacheDbReadPayload($db, $cityId, 'weather', 'current');
        if ($cached !== null) {
            header('X-Esajda-Cache: hit');
            esajdaServerLog('weather', 'response CACHE HIT → JSON to client');
            echo json_encode(['success' => true, 'data' => $cached]);
            exit;
        }
    }
}

esajdaServerLog('weather', 'upstream GET Open-Meteo (cache miss or no DB)');
$params = http_build_query([
    'latitude' => $latitude,
    'longitude' => $longitude,
    'current' => 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    'daily' => 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    'timezone' => 'auto',
    'forecast_days' => '1'
]);
$url = 'https://api.open-meteo.com/v1/forecast?' . $params;
$response = fetchWeatherUrl($url);
if ($response === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not fetch weather right now.']);
    exit;
}

$json = json_decode($response, true);
if (!is_array($json) || !isset($json['current'])) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid weather response.']);
    exit;
}

$current = $json['current'];
$daily = isset($json['daily']) && is_array($json['daily']) ? $json['daily'] : [];
$code = (int)($current['weather_code'] ?? -1);

$payload = [
    'timezone' => isset($json['timezone']) ? (string)$json['timezone'] : '',
    'temperature' => $current['temperature_2m'] ?? null,
    'apparentTemperature' => $current['apparent_temperature'] ?? null,
    'humidity' => $current['relative_humidity_2m'] ?? null,
    'windSpeed' => $current['wind_speed_10m'] ?? null,
    'isDay' => ((int)($current['is_day'] ?? 0) === 1),
    'weatherCode' => $code,
    'summary' => weatherSummaryLabel($code),
    'maxToday' => isset($daily['temperature_2m_max'][0]) ? $daily['temperature_2m_max'][0] : null,
    'minToday' => isset($daily['temperature_2m_min'][0]) ? $daily['temperature_2m_min'][0] : null,
    'rainChance' => isset($daily['precipitation_probability_max'][0]) ? $daily['precipitation_probability_max'][0] : null
];

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'weather', 'current', $payload, $ttlSeconds);
    esajdaServerLog('weather', 'response fresh from Open-Meteo + DB write');
} else {
    esajdaServerLog('weather', 'response fresh from Open-Meteo (no DB cache)');
}
echo json_encode(['success' => true, 'data' => $payload]);

function weatherSummaryLabel($code) {
    $labels = [
        0 => 'Clear sky',
        1 => 'Mainly clear',
        2 => 'Partly cloudy',
        3 => 'Overcast',
        45 => 'Fog',
        48 => 'Rime fog',
        51 => 'Light drizzle',
        53 => 'Drizzle',
        55 => 'Dense drizzle',
        56 => 'Freezing drizzle',
        57 => 'Dense freezing drizzle',
        61 => 'Slight rain',
        63 => 'Rain',
        65 => 'Heavy rain',
        66 => 'Freezing rain',
        67 => 'Heavy freezing rain',
        71 => 'Slight snow',
        73 => 'Snow',
        75 => 'Heavy snow',
        77 => 'Snow grains',
        80 => 'Rain showers',
        81 => 'Heavy rain showers',
        82 => 'Violent rain showers',
        85 => 'Snow showers',
        86 => 'Heavy snow showers',
        95 => 'Thunderstorm',
        96 => 'Thunderstorm with hail',
        99 => 'Heavy thunderstorm with hail'
    ];
    return isset($labels[$code]) ? $labels[$code] : 'Weather update';
}

function fetchWeatherUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: e-Sajda/1.0 (Weather)'
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
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0\r\n",
            'timeout' => 20
        ]
    ]);
    $body = @file_get_contents($url, false, $ctx);
    return ($body !== false && $body !== '') ? $body : null;
}
