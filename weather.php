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
 *   data: { timezone, temperature, hourly?: [{ time, temperature, weatherCode, precipitation, isDay }], ... }
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
        $cached = cacheDbReadPayload($db, $cityId, 'weather', 'current:v5');
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
    'current' => implode(',', [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'weather_code',
        'wind_speed_10m',
        'wind_direction_10m',
        'is_day',
        'pressure_msl',
        'visibility',
        'dew_point_2m',
        'uv_index'
    ]),
    'daily' => 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    'hourly' => 'temperature_2m,weather_code,precipitation_probability,is_day',
    'timezone' => 'auto',
    'forecast_days' => '14'
]);
$url = 'https://api.open-meteo.com/v1/forecast?' . $params;
$response = fetchWeatherUrl($url);
$provider = 'open-meteo';
$json = null;
$payload = null;

if ($response !== null) {
    $json = json_decode($response, true);
    if (is_array($json) && isset($json['current'])) {
        $current = $json['current'];
        $daily = isset($json['daily']) && is_array($json['daily']) ? $json['daily'] : [];
        $code = (int)($current['weather_code'] ?? -1);
        $vis = isset($current['visibility']) ? (float)$current['visibility'] : null;
        $payload = [
            'timezone' => isset($json['timezone']) ? (string)$json['timezone'] : '',
            'temperature' => $current['temperature_2m'] ?? null,
            'apparentTemperature' => $current['apparent_temperature'] ?? null,
            'humidity' => $current['relative_humidity_2m'] ?? null,
            'windSpeed' => $current['wind_speed_10m'] ?? null,
            'windDirection' => isset($current['wind_direction_10m']) ? (float)$current['wind_direction_10m'] : null,
            'pressureMsl' => isset($current['pressure_msl']) ? (float)$current['pressure_msl'] : null,
            'visibilityM' => ($vis !== null && $vis > 0) ? $vis : null,
            'dewPoint' => isset($current['dew_point_2m']) ? (float)$current['dew_point_2m'] : null,
            'uvIndex' => isset($current['uv_index']) ? (float)$current['uv_index'] : null,
            'isDay' => ((int)($current['is_day'] ?? 0) === 1),
            'weatherCode' => $code,
            'summary' => weatherSummaryLabel($code),
            'maxToday' => isset($daily['temperature_2m_max'][0]) ? $daily['temperature_2m_max'][0] : null,
            'minToday' => isset($daily['temperature_2m_min'][0]) ? $daily['temperature_2m_min'][0] : null,
            'rainChance' => isset($daily['precipitation_probability_max'][0]) ? $daily['precipitation_probability_max'][0] : null,
            'hourly' => buildHourlyFromOpenMeteo($json),
            'daily14' => buildDaily14FromOpenMeteo($json),
            'provider' => 'open-meteo',
            'fetchedAt' => time()
        ];
    }
}

// Fallback provider: MET Norway (api.met.no) — no API key, requires a descriptive User-Agent.
if ($payload === null) {
    $provider = 'met-no';
    esajdaServerLog('weather', 'fallback GET MET Norway (Open-Meteo failed)');
    $met = fetchMetNoWeather((float)$latitude, (float)$longitude);
    if ($met !== null) {
        $json = $met['raw'];
        $payload = $met['payload'];
    }
}

if ($payload === null) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not fetch weather right now.']);
    exit;
}

if (isset($payload['provider']) && $payload['provider'] === 'open-meteo') {
    $tzOpt = !empty($payload['timezone']) ? (string)$payload['timezone'] : 'auto';
    $payload['forecastExtras'] = fetchForecastExtrasOpenMeteo((float)$latitude, (float)$longitude, $tzOpt);
} else {
    $payload['forecastExtras'] = null;
}

header('X-Esajda-Cache: ' . (($db !== null && $cityId !== null) ? 'miss' : 'bypass'));
if ($db !== null && $cityId !== null) {
    cacheDbWritePayload($db, $cityId, 'weather', 'current:v5', $payload, $ttlSeconds);
    // Store full upstream JSON too, so future UI can use more fields offline.
    $rawKey = ($provider === 'met-no') ? 'met-no.locationforecast.v2' : 'open-meteo.v1';
    cacheDbWritePayload($db, $cityId, 'weather_raw', $rawKey, $json, $ttlSeconds);
    esajdaServerLog('weather', 'response fresh from ' . $provider . ' + DB write');
} else {
    esajdaServerLog('weather', 'response fresh from ' . $provider . ' (no DB cache)');
}
echo json_encode(['success' => true, 'data' => $payload]);

/**
 * @return array<int, array{time: string, temperature: float|null, weatherCode: int, precipitation: float|null, isDay: bool}>
 */
function buildHourlyFromOpenMeteo(array $json) {
    $hourly = $json['hourly'] ?? null;
    if (!is_array($hourly) || empty($hourly['time']) || !is_array($hourly['time'])) {
        return [];
    }
    $tzName = isset($json['timezone']) ? (string)$json['timezone'] : 'UTC';
    try {
        $tz = new DateTimeZone($tzName);
    } catch (Exception $e) {
        $tz = new DateTimeZone('UTC');
    }
    $times = $hourly['time'];
    $temps = isset($hourly['temperature_2m']) && is_array($hourly['temperature_2m']) ? $hourly['temperature_2m'] : [];
    $codes = isset($hourly['weather_code']) && is_array($hourly['weather_code']) ? $hourly['weather_code'] : [];
    $precip = isset($hourly['precipitation_probability']) && is_array($hourly['precipitation_probability'])
        ? $hourly['precipitation_probability'] : [];
    $isDayArr = isset($hourly['is_day']) && is_array($hourly['is_day']) ? $hourly['is_day'] : [];
    $out = [];
    $max = min(count($times), 48);
    for ($i = 0; $i < $max; $i++) {
        $tStr = $times[$i];
        if (!is_string($tStr) || $tStr === '') {
            continue;
        }
        try {
            $dt = new DateTime($tStr, $tz);
        } catch (Exception $e) {
            continue;
        }
        $out[] = [
            'time' => $dt->format('H:i'),
            'temperature' => isset($temps[$i]) && is_numeric($temps[$i]) ? (float)$temps[$i] : null,
            'weatherCode' => isset($codes[$i]) ? (int)$codes[$i] : -1,
            'precipitation' => isset($precip[$i]) && is_numeric($precip[$i]) ? (float)$precip[$i] : null,
            'isDay' => isset($isDayArr[$i]) ? ((int)$isDayArr[$i] === 1) : true,
        ];
    }
    return $out;
}

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

/**
 * Up to 14 calendar days for the extended forecast UI.
 *
 * @return array<int, array{dateLabel: string, weatherCode: int, summary: string, max: float|null, min: float|null}>
 */
function buildDaily14FromOpenMeteo(array $json) {
    $daily = $json['daily'] ?? null;
    if (!is_array($daily) || empty($daily['time']) || !is_array($daily['time'])) {
        return [];
    }
    $tzName = isset($json['timezone']) ? (string)$json['timezone'] : 'UTC';
    try {
        $tz = new DateTimeZone($tzName);
    } catch (Exception $e) {
        $tz = new DateTimeZone('UTC');
    }
    $times = $daily['time'];
    $maxT = isset($daily['temperature_2m_max']) && is_array($daily['temperature_2m_max'])
        ? $daily['temperature_2m_max'] : [];
    $minT = isset($daily['temperature_2m_min']) && is_array($daily['temperature_2m_min'])
        ? $daily['temperature_2m_min'] : [];
    $codes = isset($daily['weather_code']) && is_array($daily['weather_code']) ? $daily['weather_code'] : [];
    $n = min(14, count($times));
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $tStr = $times[$i];
        if (!is_string($tStr) || $tStr === '') {
            continue;
        }
        try {
            $dt = new DateTime($tStr, $tz);
        } catch (Exception $e) {
            continue;
        }
        $wc = isset($codes[$i]) ? (int)$codes[$i] : -1;
        $out[] = [
            'dateLabel' => $dt->format('D, M j'),
            'weatherCode' => $wc,
            'summary' => weatherSummaryLabel($wc),
            'max' => isset($maxT[$i]) && is_numeric($maxT[$i]) ? (float)$maxT[$i] : null,
            'min' => isset($minT[$i]) && is_numeric($minT[$i]) ? (float)$minT[$i] : null,
        ];
    }
    return $out;
}

function fetchWeatherUrl($url) {
    $body = fetchWeatherUrlCurl($url, true);
    if ($body !== null) return $body;
    // Fallback for some Windows PHP installs missing CA bundle.
    $body = fetchWeatherUrlCurl($url, false);
    if ($body !== null) return $body;
    $body = fetchWeatherUrlStream($url, true);
    if ($body !== null) return $body;
    return fetchWeatherUrlStream($url, false);
}

function fetchWeatherUrlCurl($url, $verifySsl) {
    if (!function_exists('curl_init')) return null;
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
        CURLOPT_SSL_VERIFYPEER => $verifySsl,
        CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
        CURLOPT_ENCODING => ''
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);
    if ($errno === 0 && $body !== false && $body !== '') return $body;
    return null;
}

function fetchWeatherUrlStream($url, $verifySsl) {
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: e-Sajda/1.0 (Weather)\r\n",
            'timeout' => 20
        ],
        'ssl' => [
            'verify_peer' => $verifySsl,
            'verify_peer_name' => $verifySsl
        ]
    ]);
    $body = @file_get_contents($url, false, $ctx);
    return ($body !== false && $body !== '') ? $body : null;
}

function metNoSummary($symbol) {
    $s = strtolower((string)$symbol);
    if ($s === '') return 'Weather update';
    if (strpos($s, 'clearsky') !== false) return 'Clear sky';
    if (strpos($s, 'fair') !== false) return 'Fair';
    if (strpos($s, 'partlycloudy') !== false) return 'Partly cloudy';
    if (strpos($s, 'cloudy') !== false) return 'Cloudy';
    if (strpos($s, 'fog') !== false) return 'Fog';
    if (strpos($s, 'rain') !== false) return 'Rain';
    if (strpos($s, 'sleet') !== false) return 'Sleet';
    if (strpos($s, 'snow') !== false) return 'Snow';
    if (strpos($s, 'thunder') !== false) return 'Thunderstorm';
    return 'Weather update';
}

function fetchMetNoWeather($lat, $lon) {
    // Docs: https://api.met.no/weatherapi/locationforecast/2.0/documentation
    $url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' . urlencode((string)$lat) . '&lon=' . urlencode((string)$lon);
    $body = fetchMetNoUrl($url);
    if ($body === null) return null;
    $json = json_decode($body, true);
    if (!is_array($json)) return null;
    $series = $json['properties']['timeseries'] ?? null;
    if (!is_array($series) || !isset($series[0])) return null;
    $instant = $series[0]['data']['instant']['details'] ?? null;
    if (!is_array($instant)) return null;

    $airTemp = $instant['air_temperature'] ?? null;
    $windRaw = $instant['wind_speed'] ?? null;
    // MET Norway uses m/s; match Open-Meteo (km/h) for the client.
    $wind = ($windRaw !== null && is_numeric($windRaw)) ? round((float)$windRaw * 3.6, 1) : null;
    $humidity = $instant['relative_humidity'] ?? null;
    $windDir = isset($instant['wind_from_direction']) ? (float)$instant['wind_from_direction'] : null;
    $pressure = isset($instant['air_pressure_at_sea_level']) ? (float)$instant['air_pressure_at_sea_level'] : null;
    $dew = isset($instant['dew_point_temperature']) ? (float)$instant['dew_point_temperature'] : null;
    $uv = isset($instant['ultraviolet_index_clear_sky']) ? (float)$instant['ultraviolet_index_clear_sky'] : null;
    $visM = null;
    if (isset($instant['visibility']) && is_numeric($instant['visibility'])) {
        $visM = (float)$instant['visibility'];
    }

    $symbol = $series[0]['data']['next_1_hours']['summary']['symbol_code'] ?? '';
    $tz = $json['properties']['meta']['units'] ? 'auto' : 'auto';
    $payload = [
        'timezone' => $tz,
        'temperature' => $airTemp,
        'apparentTemperature' => null,
        'humidity' => $humidity,
        'windSpeed' => $wind,
        'windDirection' => $windDir,
        'pressureMsl' => $pressure,
        'visibilityM' => ($visM !== null && $visM > 0) ? $visM : null,
        'dewPoint' => $dew,
        'uvIndex' => $uv,
        'isDay' => null,
        'weatherCode' => -1,
        'summary' => metNoSummary($symbol),
        'maxToday' => null,
        'minToday' => null,
        'rainChance' => null,
        'hourly' => [],
        'daily14' => [],
        'provider' => 'met-no',
        'fetchedAt' => time()
    ];

    return ['raw' => $json, 'payload' => $payload];
}

function fetchMetNoUrl($url) {
    // MET Norway requires a descriptive User-Agent with contact info.
    $ua = 'e-Sajda/1.0 (Weather; contact: admin@example.com)';
    if (function_exists('curl_init')) {
        $body = fetchMetNoUrlCurl($url, $ua, true);
        if ($body !== null) return $body;
        return fetchMetNoUrlCurl($url, $ua, false);
    }
    return fetchMetNoUrlStream($url, $ua, true) ?? fetchMetNoUrlStream($url, $ua, false);
}

function fetchMetNoUrlCurl($url, $ua, $verifySsl) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'User-Agent: ' . $ua
        ],
        CURLOPT_SSL_VERIFYPEER => $verifySsl,
        CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
        CURLOPT_ENCODING => ''
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);
    if ($errno === 0 && $body !== false && $body !== '') return $body;
    return null;
}

function fetchMetNoUrlStream($url, $ua, $verifySsl) {
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: " . $ua . "\r\n",
            'timeout' => 20
        ],
        'ssl' => [
            'verify_peer' => $verifySsl,
            'verify_peer_name' => $verifySsl
        ]
    ]);
    $body = @file_get_contents($url, false, $ctx);
    return ($body !== false && $body !== '') ? $body : null;
}

/**
 * Marine (waves/SST/swell), model sea-level extrema as tide-like events, and CAMS air quality (Open-Meteo only).
 *
 * @return array{marine: ?array, tides: array<int, array{type: string, when: string, heightM: float}>, airQuality: ?array}
 */
function fetchForecastExtrasOpenMeteo(float $lat, float $lon, string $timezone) {
    $out = [
        'marine' => null,
        'tides' => [],
        'airQuality' => null,
    ];

    $marineParams = http_build_query([
        'latitude' => $lat,
        'longitude' => $lon,
        'current' => 'wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature',
        'hourly' => 'sea_level_height_msl',
        'forecast_days' => 3,
        'timezone' => $timezone,
        'cell_selection' => 'sea',
    ]);
    $marineUrl = 'https://marine-api.open-meteo.com/v1/marine?' . $marineParams;
    $marineBody = fetchWeatherUrl($marineUrl);
    if ($marineBody !== null) {
        $mj = json_decode($marineBody, true);
        if (is_array($mj) && empty($mj['error'])) {
            $tzName = isset($mj['timezone']) ? (string)$mj['timezone'] : $timezone;
            if (isset($mj['current']) && is_array($mj['current'])) {
                $c = $mj['current'];
                $deg = isset($c['swell_wave_direction']) && is_numeric($c['swell_wave_direction'])
                    ? (float)$c['swell_wave_direction'] : null;
                $out['marine'] = [
                    'waveHeightM' => isset($c['wave_height']) && is_numeric($c['wave_height'])
                        ? round((float)$c['wave_height'], 1) : null,
                    'waterTempC' => isset($c['sea_surface_temperature']) && is_numeric($c['sea_surface_temperature'])
                        ? round((float)$c['sea_surface_temperature'], 1) : null,
                    'swellDirection' => marineDegToCardinal8($deg),
                    'swellPeriodS' => isset($c['swell_wave_period']) && is_numeric($c['swell_wave_period'])
                        ? round((float)$c['swell_wave_period'], 1) : null,
                ];
            }
            if (isset($mj['hourly']['time'], $mj['hourly']['sea_level_height_msl'])
                && is_array($mj['hourly']['time']) && is_array($mj['hourly']['sea_level_height_msl'])) {
                $out['tides'] = extractTideLikeExtremes(
                    $mj['hourly']['time'],
                    $mj['hourly']['sea_level_height_msl'],
                    $tzName
                );
            }
        }
    }

    $aqParams = http_build_query([
        'latitude' => $lat,
        'longitude' => $lon,
        'current' => 'us_aqi,carbon_monoxide,ozone,nitrogen_dioxide,sulphur_dioxide,pm2_5,pm10',
        'timezone' => $timezone,
    ]);
    $aqUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?' . $aqParams;
    $aqBody = fetchWeatherUrl($aqUrl);
    if ($aqBody !== null) {
        $aj = json_decode($aqBody, true);
        if (is_array($aj) && empty($aj['error']) && isset($aj['current']) && is_array($aj['current'])) {
            $c = $aj['current'];
            $aqi = isset($c['us_aqi']) && is_numeric($c['us_aqi']) ? (int)round((float)$c['us_aqi']) : null;
            $out['airQuality'] = [
                'usAqi' => $aqi,
                'usAqiCategory' => usAqiCategoryLabel($aqi),
                'co' => isset($c['carbon_monoxide']) && is_numeric($c['carbon_monoxide'])
                    ? round((float)$c['carbon_monoxide'], 1) : null,
                'o3' => isset($c['ozone']) && is_numeric($c['ozone'])
                    ? round((float)$c['ozone'], 1) : null,
                'no2' => isset($c['nitrogen_dioxide']) && is_numeric($c['nitrogen_dioxide'])
                    ? round((float)$c['nitrogen_dioxide'], 1) : null,
                'so2' => isset($c['sulphur_dioxide']) && is_numeric($c['sulphur_dioxide'])
                    ? round((float)$c['sulphur_dioxide'], 1) : null,
                'pm25' => isset($c['pm2_5']) && is_numeric($c['pm2_5'])
                    ? round((float)$c['pm2_5'], 1) : null,
                'pm10' => isset($c['pm10']) && is_numeric($c['pm10'])
                    ? round((float)$c['pm10'], 1) : null,
            ];
        }
    }

    return $out;
}

function marineDegToCardinal8($deg) {
    if ($deg === null || !is_numeric($deg)) {
        return null;
    }
    $fd = (float)$deg;
    if (!is_finite($fd)) {
        return null;
    }
    $d = fmod($fd + 360.0, 360.0);
    $dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $idx = (int)round($d / 45.0) % 8;
    return $dirs[$idx];
}

/** @param int|null $aqi */
function usAqiCategoryLabel($aqi) {
    if ($aqi === null || !is_numeric($aqi)) {
        return null;
    }
    $v = (int)$aqi;
    if ($v <= 50) {
        return 'Good';
    }
    if ($v <= 100) {
        return 'Moderate';
    }
    if ($v <= 150) {
        return 'Unhealthy for sensitive groups';
    }
    if ($v <= 200) {
        return 'Unhealthy';
    }
    if ($v <= 300) {
        return 'Very unhealthy';
    }
    return 'Hazardous';
}

/**
 * Local maxima/minima on hourly sea level (model MSL; not chart datum). For display only.
 *
 * @return array<int, array{type: string, when: string, heightM: float}>
 */
function extractTideLikeExtremes(array $times, array $levels, $tzName) {
    $n = min(count($times), count($levels));
    if ($n < 3) {
        return [];
    }
    try {
        $tz = esajdaSafeTimezone($tzName);
    } catch (Exception $e) {
        $tz = new DateTimeZone('UTC');
    }

    $extremes = [];
    for ($i = 1; $i < $n - 1; $i++) {
        if (!isset($levels[$i - 1], $levels[$i], $levels[$i + 1])) {
            continue;
        }
        if (!is_numeric($levels[$i - 1]) || !is_numeric($levels[$i]) || !is_numeric($levels[$i + 1])) {
            continue;
        }
        $a = (float)$levels[$i - 1];
        $b = (float)$levels[$i];
        $c = (float)$levels[$i + 1];
        if ($b > $a && $b > $c) {
            $extremes[] = ['type' => 'HIGH', 't' => $times[$i], 'h' => $b];
        } elseif ($b < $a && $b < $c) {
            $extremes[] = ['type' => 'LOW', 't' => $times[$i], 'h' => $b];
        }
    }
    if ($extremes === []) {
        return [];
    }

    usort($extremes, function ($x, $y) {
        return strcmp((string)$x['t'], (string)$y['t']);
    });

    $now = new DateTime('now', $tz);
    $future = [];
    foreach ($extremes as $e) {
        try {
            $dt = new DateTime((string)$e['t'], $tz);
        } catch (Exception $x) {
            continue;
        }
        if ($dt >= $now) {
            $future[] = $e;
        }
    }

    $pick = $future;
    if (count($pick) < 4) {
        $pick = $extremes;
    }
    $pick = array_slice($pick, 0, 4);

    $rows = [];
    foreach ($pick as $e) {
        try {
            $dt = new DateTime((string)$e['t'], $tz);
        } catch (Exception $x) {
            continue;
        }
        $rows[] = [
            'type' => $e['type'],
            'when' => $dt->format('Y-m-d H:i'),
            'heightM' => round((float)$e['h'], 2),
        ];
    }
    return $rows;
}

function esajdaSafeTimezone($name) {
    $n = trim((string)$name);
    if ($n === '' || strcasecmp($n, 'auto') === 0) {
        return new DateTimeZone('UTC');
    }
    return new DateTimeZone($n);
}
