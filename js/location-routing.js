/**
 * e-Sajda – Location URL routing helpers
 *
 * Keeps location URL behavior isolated from UI logic:
 * - write `/city` paths for shareable links
 * - clear path back to `/` for GPS mode
 * - read city from pathname, with one-time migration from legacy `?city=...`
 */

import { compactPlaceForUrl } from './utils.js';

const PRAYER_ROUTE_PREFIX = 'prayer-times';
const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function replacePath(placeLabel, prayerKey) {
    try {
        const trimmed = placeLabel.trim();
        if (!trimmed) return;
        const url = new URL(window.location.href);
        let path = '/' + encodeURIComponent(trimmed);
        if (prayerKey && PRAYER_KEYS.indexOf(prayerKey) !== -1) {
            path += '/' + PRAYER_ROUTE_PREFIX + '/' + prayerKey;
        }
        url.pathname = path;
        url.search = '';
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {
        /* ignore invalid base URL */
    }
}

export function replaceBrowserUrlWithCity(fullAddress) {
    const compact = compactPlaceForUrl((fullAddress || '').trim()) || (fullAddress || '').trim();
    if (!compact) return;
    replacePath(compact, readPrayerFromUrl());
}

export function clearCityFromBrowserUrl() {
    try {
        const url = new URL(window.location.href);
        url.pathname = '/';
        url.search = '';
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {
        /* ignore */
    }
}

function readLegacyCityQuery() {
    try {
        const raw = new URL(window.location.href).searchParams.get('city');
        if (raw == null) return null;
        const trimmed = raw.trim();
        return trimmed.length ? trimmed : null;
    } catch (_) {
        return null;
    }
}

function readCityFromPathname() {
    try {
        const path = new URL(window.location.href).pathname;
        const raw = path.replace(/^\/+|\/+$/g, '');
        if (!raw) return null;
        const parts = raw.split('/').filter(Boolean);
        if (!parts.length) return null;
        const seg = parts[0];
        if (seg.toLowerCase() === 'index.html') return null;
        if (/\.[a-z0-9]{2,4}$/i.test(seg)) return null;
        if (seg === 'api.php' || seg === 'router.php') return null;
        if (seg === 'js') return null;
        const city = decodeURIComponent(seg).trim();
        return city.length ? city : null;
    } catch (_) {
        return null;
    }
}

export function readPrayerFromUrl() {
    try {
        const path = new URL(window.location.href).pathname;
        const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (parts.length < 3) return null;
        if (parts[1] !== PRAYER_ROUTE_PREFIX) return null;
        const prayer = decodeURIComponent(parts[2]).toLowerCase();
        return PRAYER_KEYS.indexOf(prayer) !== -1 ? prayer : null;
    } catch (_) {
        return null;
    }
}

export function buildPrayerUrl(cityLabel, prayerName) {
    const city = compactPlaceForUrl((cityLabel || '').trim()) || (cityLabel || '').trim();
    if (!city) return '/';
    const key = (prayerName || '').toLowerCase();
    if (PRAYER_KEYS.indexOf(key) === -1) return '/' + encodeURIComponent(city);
    return '/' + encodeURIComponent(city) + '/' + PRAYER_ROUTE_PREFIX + '/' + key;
}

/**
 * Returns city from URL path. If only legacy `?city=` is present, migrates URL to `/city`.
 */
export function readCityFromUrl() {
    let city = readCityFromPathname();
    if (!city) {
        const legacy = readLegacyCityQuery();
        if (legacy) {
            city = compactPlaceForUrl(legacy) || legacy;
            replacePath(city, null);
        }
    }
    return city || null;
}
