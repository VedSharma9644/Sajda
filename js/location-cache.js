/**
 * e-Sajda – Lightweight client cache for location lookups
 *
 * Uses localStorage to avoid repeated network calls for:
 * - city autocomplete suggestions
 * - reverse geocoding from coordinates
 */

const CACHE_KEY = 'esajda.location.cache.v1';
const SUGGESTIONS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REVERSE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const MAX_SUGGESTION_ENTRIES = 150;
const MAX_REVERSE_ENTRIES = 300;

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return { suggestions: {}, reverse: {} };
        const parsed = JSON.parse(raw);
        return {
            suggestions: parsed && parsed.suggestions ? parsed.suggestions : {},
            reverse: parsed && parsed.reverse ? parsed.reverse : {}
        };
    } catch (_) {
        return { suggestions: {}, reverse: {} };
    }
}

function writeCache(cache) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {
        /* ignore storage quota / private mode issues */
    }
}

function now() {
    return Date.now();
}

function normalizeQuery(query) {
    return (query || '').trim().toLowerCase();
}

function reverseKey(lat, lon) {
    // Round key to avoid too many unique entries for near-identical coordinates.
    return Number(lat).toFixed(3) + ',' + Number(lon).toFixed(3);
}

function pruneExpired(mapObj) {
    const t = now();
    Object.keys(mapObj).forEach((k) => {
        const row = mapObj[k];
        if (!row || typeof row.expiresAt !== 'number' || row.expiresAt < t) delete mapObj[k];
    });
}

function trimToMaxEntries(mapObj, maxEntries) {
    const keys = Object.keys(mapObj);
    if (keys.length <= maxEntries) return;
    keys
        .sort((a, b) => (mapObj[a].expiresAt || 0) - (mapObj[b].expiresAt || 0))
        .slice(0, keys.length - maxEntries)
        .forEach((k) => delete mapObj[k]);
}

function compactCache(cache) {
    pruneExpired(cache.suggestions);
    pruneExpired(cache.reverse);
    trimToMaxEntries(cache.suggestions, MAX_SUGGESTION_ENTRIES);
    trimToMaxEntries(cache.reverse, MAX_REVERSE_ENTRIES);
    return cache;
}

export function getCachedSuggestions(query) {
    const key = normalizeQuery(query);
    if (!key) return null;
    const cache = readCache();
    const hit = cache.suggestions[key];
    if (!hit || !Array.isArray(hit.items) || hit.expiresAt < now()) return null;
    return hit.items;
}

export function setCachedSuggestions(query, items) {
    const key = normalizeQuery(query);
    if (!key || !Array.isArray(items)) return;
    const cache = readCache();
    cache.suggestions[key] = { items, expiresAt: now() + SUGGESTIONS_TTL_MS };
    writeCache(compactCache(cache));
}

export function getCachedReverseLabel(lat, lon) {
    const key = reverseKey(lat, lon);
    const cache = readCache();
    const hit = cache.reverse[key];
    if (!hit || typeof hit.label !== 'string' || hit.expiresAt < now()) return null;
    return hit.label;
}

export function setCachedReverseLabel(lat, lon, label) {
    if (!label || typeof label !== 'string') return;
    const key = reverseKey(lat, lon);
    const cache = readCache();
    cache.reverse[key] = { label, expiresAt: now() + REVERSE_TTL_MS };
    writeCache(compactCache(cache));
}

export function clearLocationCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch (_) {
        /* ignore */
    }
}
