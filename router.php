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

if ($uri === '/api.php') {
    require __DIR__ . '/api.php';
    return true;
}

if ($uri === '/weather.php') {
    require __DIR__ . '/weather.php';
    return true;
}

if (preg_match('#^/([^/]+)/prayer-times/(fajr|dhuhr|asr|maghrib|isha)/?$#i', $uri, $m)) {
    require __DIR__ . '/prayer-times/' . strtolower($m[2]) . '.html';
    return true;
}

if (preg_match('#^/prayer-times/(fajr|dhuhr|asr|maghrib|isha)(?:\.html)?/?$#i', $uri, $m)) {
    require __DIR__ . '/prayer-times/' . strtolower($m[1]) . '.html';
    return true;
}

if (preg_match('#^/[^/]+/(style\.css|js/.+)$#i', $uri, $m)) {
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
