<?php
// phpcs:ignoreFile
/**
 * Router for PHP built-in server.
 * Ensures /api.php is always served from this directory.
 * Usage: php -S localhost:8000 router.php
 *
 * Logic:
 * - `/api.php` → run the JSON proxy script.
 * - `/` → serve `index.html`.
 * - Existing files (CSS, JS) → let the built-in server handle them.
 * - Anything else (e.g. `/Jaipur%2C%20India` for a place) → `index.html` (SPA; path is read by JS).
 */
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

/**
 * When true, GET / redirects to /times (world-clock landing). Prayer home is still at /index.html.
 * Leave false if you want / to stay the main prayer-times home.
 */
$ESAJDA_ROOT_REDIRECT_TO_TIMES = false;

if (($uri === '/' || $uri === '') && !empty($ESAJDA_ROOT_REDIRECT_TO_TIMES)) {
    header('Location: /times', true, 302);
    return true;
}

if ($uri === '/api.php') {
    require __DIR__ . '/api.php';
    return true;
}

if ($uri === '/weather.php') {
    require __DIR__ . '/weather.php';
    return true;
}

if ($uri === '/sun-year.php') {
    require __DIR__ . '/sun-year.php';
    return true;
}

if ($uri === '/sun-day.php') {
    require __DIR__ . '/sun-day.php';
    return true;
}

if ($uri === '/geocode.php') {
    require __DIR__ . '/geocode.php';
    return true;
}

if ($uri === '/time-meta.php') {
    require __DIR__ . '/time-meta.php';
    return true;
}

if ($uri === '/region-cities.php') {
    require __DIR__ . '/region-cities.php';
    return true;
}

if ($uri === '/country-cities.php') {
    require __DIR__ . '/country-cities.php';
    return true;
}

if ($uri === '/popular-cities.php') {
    require __DIR__ . '/popular-cities.php';
    return true;
}

if ($uri === '/cache-clean.php') {
    require __DIR__ . '/cache-clean.php';
    return true;
}

// Legacy: …/prayer → …/prayer-times (avoid clashing with prayer-times paths)
if (preg_match('#/prayer/?$#', $uri) && strpos($uri, 'prayer-times') === false) {
    $target = preg_replace('#/prayer/?$#', '/prayer-times', $uri);
    if ($target !== $uri) {
        header('Location: ' . $target, true, 301);
        return true;
    }
}

if (preg_match('#^/([^/]+)/([^/]+)/prayer-times/(fajr|dhuhr|asr|maghrib|isha)/?$#i', $uri, $m)) {
    require __DIR__ . '/prayer-times/' . strtolower($m[3]) . '.html';
    return true;
}

if (preg_match('#^/([^/]+)/([^/]+)/prayer-times/?$#i', $uri)) {
    require __DIR__ . '/pages/prayer-hub.html';
    return true;
}

if (preg_match('#^/([^/]+)/prayer-times/(fajr|dhuhr|asr|maghrib|isha)/?$#i', $uri, $m)) {
    require __DIR__ . '/prayer-times/' . strtolower($m[2]) . '.html';
    return true;
}

if (preg_match('#^/([^/]+)/prayer-times/?$#i', $uri)) {
    require __DIR__ . '/pages/prayer-hub.html';
    return true;
}

if (preg_match('#^/([^/]+)/([^/]+)/(time|sun|weather)/?$#i', $uri, $m)) {
    require __DIR__ . '/pages/' . strtolower($m[3]) . '.html';
    return true;
}

if (preg_match('#^/([^/]+)/(time|sun|weather)/?$#i', $uri, $m)) {
    require __DIR__ . '/pages/' . strtolower($m[2]) . '.html';
    return true;
}

// Location root should render the time page:
// - /{country}/{city} → pages/time.html
// - /{city} → pages/time.html
// (avoid special folders/files handled above)
if (preg_match('#^/([^/]+)/([^/]+)/?$#i', $uri, $m)) {
    $seg0 = strtolower($m[1]);
    if ($seg0 !== 'pages' && $seg0 !== 'js' && $seg0 !== 'sun-chart' && $seg0 !== 'css') {
        require __DIR__ . '/pages/time.html';
        return true;
    }
}

if (preg_match('#^/([^/]+)/?$#i', $uri, $m)) {
    $seg0 = strtolower($m[1]);
    if (
        $seg0 !== 'pages' &&
        $seg0 !== 'js' &&
        $seg0 !== 'sun-chart' &&
        $seg0 !== 'css' &&
        $seg0 !== 'api.php' &&
        $seg0 !== 'weather.php' &&
        $seg0 !== 'geocode.php' &&
        $seg0 !== 'router.php' &&
        $seg0 !== 'style.css' &&
        $seg0 !== 'country-cities.php' &&
        $seg0 !== 'popular-cities.php' &&
        $seg0 !== 'cache-clean.php' &&
        $seg0 !== 'sun-year.php' &&
        $seg0 !== 'sun-day.php' &&
        $seg0 !== 'prayer-times'
    ) {
        require __DIR__ . '/pages/time.html';
        return true;
    }
}

if (preg_match('#^/prayer-times/(fajr|dhuhr|asr|maghrib|isha)(?:\.html)?/?$#i', $uri, $m)) {
    require __DIR__ . '/prayer-times/' . strtolower($m[1]) . '.html';
    return true;
}

if (preg_match('#^/([^/]+)/([^/]+)/(style\.css|js/.+|sun-chart/.+)$#i', $uri, $m)) {
    $assetPath = __DIR__ . '/' . $m[3];
    if (is_file($assetPath)) {
        $ext = strtolower(pathinfo($assetPath, PATHINFO_EXTENSION));
        if ($ext === 'css') {
            header('Content-Type: text/css; charset=utf-8');
        } else if ($ext === 'js') {
            header('Content-Type: application/javascript; charset=utf-8');
        }
        readfile($assetPath);
        return true;
    }
}

if (preg_match('#^/[^/]+/(style\.css|js/.+|sun-chart/.+)$#i', $uri, $m)) {
    $assetPath = __DIR__ . '/' . $m[1];
    if (is_file($assetPath)) {
        $ext = strtolower(pathinfo($assetPath, PATHINFO_EXTENSION));
        if ($ext === 'css') header('Content-Type: text/css; charset=utf-8');
        else if ($ext === 'js') header('Content-Type: application/javascript; charset=utf-8');
        readfile($assetPath);
        return true;
    }
}

if ($uri === '/' || $uri === '') {
    require __DIR__ . '/index.html';
    return true;
}

if (file_exists(__DIR__ . $uri)) {
    return false; // serve the file as-is
}

require __DIR__ . '/index.html';
return true;
