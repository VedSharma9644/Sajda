/**
 * Shared URL parsing for standalone SEO pages: /{location}/time, /sun, /weather, /prayer
 * Location may be one segment ("Collierville") or two ("usa/new-york" → "New York, Usa").
 */

function deslug(s) {
    const raw = decodeURIComponent(String(s || '').trim());
    if (!raw) return '';
    return raw
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * @param {string} suffix - 'time' | 'sun' | 'weather' | 'prayer-times'
 * @returns {{ address: string, pathPrefix: string } | null}
 */
export function readLocationFromPageUrl(suffix) {
    const want = String(suffix || '').toLowerCase();
    if (!want) return null;
    try {
        const path = new URL(window.location.href).pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (!parts.length) return null;
        const last = parts[parts.length - 1].toLowerCase();
        if (last !== want) return null;
        const locParts = parts.slice(0, -1);
        if (!locParts.length) return null;

        const pathPrefix = locParts.map((p) => encodeURIComponent(p)).join('/');

        if (locParts.length === 1) {
            return { address: deslug(locParts[0]), pathPrefix };
        }

        const country = deslug(locParts[0]);
        const city = deslug(locParts[1]);
        return { address: city + ', ' + country, pathPrefix };
    } catch (_) {
        return null;
    }
}

export function pageHref(pathPrefix, segment) {
    if (!pathPrefix) return '/';
    return '/' + pathPrefix + '/' + segment;
}

const STANDALONE_SUFFIXES = ['time', 'sun', 'weather', 'prayer-times'];

function isStandaloneSuffix(seg) {
    return STANDALONE_SUFFIXES.indexOf(String(seg || '').toLowerCase()) !== -1;
}

/**
 * Path prefix for location URLs: /{prefix}/time, /{prefix}/prayer-times/fajr, etc.
 * @returns {string} e.g. "usa/jaipur" or "" when not on a location path.
 */
export function readLocationPathPrefix() {
    try {
        const path = new URL(window.location.href).pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 4 && parts[2].toLowerCase() === 'prayer-times') {
            return parts.slice(0, 2).map((p) => encodeURIComponent(p)).join('/');
        }
        if (parts.length >= 3 && parts[1].toLowerCase() === 'prayer-times') {
            return encodeURIComponent(parts[0]);
        }
        if (parts.length === 3 && parts[2].toLowerCase() === 'prayer-times') {
            return parts.slice(0, 2).map((p) => encodeURIComponent(p)).join('/');
        }
        if (parts.length === 2 && parts[1].toLowerCase() === 'prayer-times') {
            return encodeURIComponent(parts[0]);
        }
        if (parts.length >= 3 && isStandaloneSuffix(parts[2])) {
            return parts.slice(0, 2).map((p) => encodeURIComponent(p)).join('/');
        }
        if (parts.length >= 2 && isStandaloneSuffix(parts[1])) {
            return encodeURIComponent(parts[0]);
        }
        if (
            parts.length === 2 &&
            parts[1].toLowerCase() !== 'prayer-times' &&
            !isStandaloneSuffix(parts[1])
        ) {
            const top = parts[0].toLowerCase();
            if (top === 'pages' || top === 'js' || top === 'sun-chart') return '';
            return parts.slice(0, 2).map((p) => encodeURIComponent(p)).join('/');
        }
        if (parts.length === 1) {
            const top = parts[0].toLowerCase();
            if (top === 'times') return '';
            if (top === 'index.html' || top === 'pages' || top === 'js' || /\.[a-z0-9]{2,4}$/i.test(parts[0])) {
                return '';
            }
            return encodeURIComponent(parts[0]);
        }
        return '';
    } catch (_) {
        return '';
    }
}
