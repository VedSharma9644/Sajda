/**
 * e-Sajda – Location URL routing helpers
 *
 * Keeps location URL behavior isolated from UI logic:
 * - write `/country/city` paths for shareable links (SEO-friendly)
 * - keep backward compatibility with legacy `/city`
 * - clear path back to `/` for GPS mode
 * - read city from pathname, with one-time migration from legacy `?city=...`
 */

import { compactPlaceForUrl } from './utils.js';

const PRAYER_ROUTE_PREFIX = 'prayer-times';
const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const STANDALONE_PAGE_SEGMENTS = new Set(['time', 'sun', 'weather', 'prayer-times']);

function slugifySegment(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['".]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function deslugSegment(s) {
    const raw = String(s || '').trim();
    if (!raw) return '';
    return raw
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeCountrySlug(country) {
    const c = String(country || '').trim().toLowerCase();
    if (!c) return '';
    if (c === 'united states' || c === 'united states of america' || c === 'us' || c === 'u.s.' || c === 'u.s.a.' || c === 'usa') {
        return 'usa';
    }
    if (c === 'united kingdom' || c === 'uk' || c === 'u.k.' || c === 'great britain') return 'uk';
    if (c === 'uae' || c === 'u.a.e.' || c === 'united arab emirates') return 'uae';
    return slugifySegment(country);
}

function splitAddressToCityCountry(fullAddress) {
    const s = String(fullAddress || '').trim();
    if (!s) return { city: '', country: '' };
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return { city: parts[0], country: parts[parts.length - 1] };
    }
    return { city: parts[0] || s, country: '' };
}

function buildLocationPathFromAddress(fullAddress) {
    const { city, country } = splitAddressToCityCountry(fullAddress);
    const citySlug = slugifySegment(city || compactPlaceForUrl(fullAddress));
    const countrySlug = normalizeCountrySlug(country);
    if (countrySlug && citySlug) return '/' + encodeURIComponent(countrySlug) + '/' + encodeURIComponent(citySlug);
    if (citySlug) return '/' + encodeURIComponent(citySlug);
    const fallback = String(fullAddress || '').trim();
    return fallback ? '/' + encodeURIComponent(fallback) : '/';
}

/** Path prefix for `/{prefix}/time` etc., without leading slash (e.g. `usa/chicago`). */
export function pathPrefixFromAddress(fullAddress) {
    const p = buildLocationPathFromAddress(fullAddress);
    return p.replace(/^\/+|\/+$/g, '');
}

function replacePath(fullAddress, prayerKey) {
    try {
        const url = new URL(window.location.href);
        let path = buildLocationPathFromAddress(fullAddress);
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
    const trimmed = (fullAddress || '').trim();
    if (!trimmed) return;
    replacePath(trimmed, readPrayerFromUrl());
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
        const seg0 = parts[0];
        if (seg0.toLowerCase() === 'index.html') return null;
        if (/\.[a-z0-9]{2,4}$/i.test(seg0)) return null;
        if (seg0 === 'api.php' || seg0 === 'router.php') return null;
        if (seg0 === 'js') return null;
        if (seg0 === 'pages') return null;

        // /{place}/{time|sun|weather|prayer-times} — second segment is a tool page, not country/city
        if (parts.length === 2 && STANDALONE_PAGE_SEGMENTS.has(parts[1].toLowerCase())) {
            const place = deslugSegment(decodeURIComponent(parts[0]));
            return place.length ? place : null;
        }

        // /{country}/{city}/{time|sun|weather|prayer-times}
        if (parts.length === 3 && STANDALONE_PAGE_SEGMENTS.has(parts[2].toLowerCase())) {
            const country = deslugSegment(decodeURIComponent(parts[0]));
            const city = deslugSegment(decodeURIComponent(parts[1]));
            const addr = [city, country].filter(Boolean).join(', ');
            return addr.length ? addr : null;
        }

        // New SEO form: /{country}/{city}
        if (parts.length >= 2 && parts[1] !== PRAYER_ROUTE_PREFIX) {
            const country = deslugSegment(decodeURIComponent(parts[0]));
            const city = deslugSegment(decodeURIComponent(parts[1]));
            const addr = [city, country].filter(Boolean).join(', ');
            return addr.length ? addr : null;
        }

        // Legacy: /{city}
        const city = deslugSegment(decodeURIComponent(parts[0]));
        return city.length ? city : null;
    } catch (_) {
        return null;
    }
}

export function readPrayerFromUrl() {
    try {
        const path = new URL(window.location.href).pathname;
        const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        // /{city}/prayer-times/{prayer}
        if (parts.length >= 3 && parts[1] === PRAYER_ROUTE_PREFIX) {
            const prayer1 = decodeURIComponent(parts[2]).toLowerCase();
            return PRAYER_KEYS.indexOf(prayer1) !== -1 ? prayer1 : null;
        }
        // /{country}/{city}/prayer-times/{prayer}
        if (parts.length >= 4 && parts[2] === PRAYER_ROUTE_PREFIX) {
            const prayer2 = decodeURIComponent(parts[3]).toLowerCase();
            return PRAYER_KEYS.indexOf(prayer2) !== -1 ? prayer2 : null;
        }
        return null;
    } catch (_) {
        return null;
    }
}

export function buildPrayerUrl(cityLabel, prayerName) {
    const full = (cityLabel || '').trim();
    if (!full) return '/';
    const key = (prayerName || '').toLowerCase();
    const base = buildLocationPathFromAddress(full);
    if (PRAYER_KEYS.indexOf(key) === -1) return base;
    return base + '/' + PRAYER_ROUTE_PREFIX + '/' + key;
}

/**
 * Returns city from URL path. If only legacy `?city=` is present, migrates URL to `/country/city`.
 */
export function readCityFromUrl() {
    let city = readCityFromPathname();
    if (!city) {
        const legacy = readLegacyCityQuery();
        if (legacy) {
            city = legacy;
            replacePath(city, null);
        }
    }
    return city || null;
}
