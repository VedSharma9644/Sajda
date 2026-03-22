<?php
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

if ($uri === '/' || $uri === '') {
    require __DIR__ . '/index.html';
    return true;
}

if (file_exists(__DIR__ . $uri)) {
    return false; // serve the file as-is
}

require __DIR__ . '/index.html';
return true;
