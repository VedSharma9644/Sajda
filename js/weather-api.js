/**
 * e-Sajda – Weather data adapter
 *
 * Responsibilities:
 * - Resolve coordinates from current app state (GPS or city geocoding)
 * - Fetch weather from `weather.php` (server proxy + SQLite cache)
 * - Cache geocoding + weather briefly to reduce repeat calls
 */

import { state } from './state.js';
import { esajdaLog } from './debug-log.js?v=22';

const GEO_CACHE_KEY = 'esajda.weather.geo.v1';
const WEATHER_CACHE_KEY = 'esajda.weather.data.v1';
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WEATHER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (aligned with weather.php SQLite TTL)

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
        return fallback;
    }
}

function writeStore(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
        /* ignore localStorage errors */
    }
}

function now() {
    return Date.now();
}

function normalizeAddress(s) {
    return (s || '').trim().toLowerCase();
}

function roundCoord(v) {
    return Number(v).toFixed(3);
}

async function fetchGeocodeFromServer(address) {
    try {
        const url = '/geocode.php?address=' + encodeURIComponent(address);
        esajdaLog('weather', 'GET /geocode.php (server + SQLite)', { url });
        const res = await fetch(url, { method: 'GET' });
        const cacheHdr = res.headers.get('X-Esajda-Cache');
        esajdaLog('weather', '/geocode.php response', {
            status: res.status,
            serverCache: cacheHdr || 'unknown'
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json || !json.success || !json.data) return null;
        const latitude = Number(json.data.latitude);
        const longitude = Number(json.data.longitude);
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
        return { latitude, longitude };
    } catch (_) {
        return null;
    }
}

async function geocodeAddress(address) {
    const key = normalizeAddress(address);
    if (!key) return null;

    const geoCache = readStore(GEO_CACHE_KEY, {});
    const hit = geoCache[key];
    if (hit && hit.expiresAt > now()) {
        esajdaLog('weather', 'geocode cache HIT', { address: key });
        return { latitude: hit.latitude, longitude: hit.longitude };
    }

    // Prefer same-origin server proxy (cached in SQLite); fall back to direct Nominatim.
    const serverCoords = await fetchGeocodeFromServer(address);
    if (serverCoords) {
        geoCache[key] = { latitude: serverCoords.latitude, longitude: serverCoords.longitude, expiresAt: now() + GEO_TTL_MS };
        writeStore(GEO_CACHE_KEY, geoCache);
        return serverCoords;
    }

    const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(address) + '&format=json&addressdetails=1&limit=1';
    esajdaLog('nominatim', 'GET search (weather coords)', { url });
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'e-Sajda/1.0 (Prayer Times)'
        }
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;

    const latitude = Number(data[0].lat);
    const longitude = Number(data[0].lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    geoCache[key] = { latitude, longitude, expiresAt: now() + GEO_TTL_MS };
    writeStore(GEO_CACHE_KEY, geoCache);
    return { latitude, longitude };
}

/** Used by weather widget and yearly sun chart. */
export async function resolveSelectedCoords() {
    if (state.useCoordinates && state.currentCoords) {
        return {
            latitude: Number(state.currentCoords.latitude),
            longitude: Number(state.currentCoords.longitude),
            source: 'gps'
        };
    }
    if (state.currentAddress) {
        const coords = await geocodeAddress(state.currentAddress);
        if (!coords) return null;
        return { latitude: coords.latitude, longitude: coords.longitude, source: 'address' };
    }
    return null;
}

function weatherCacheKey(latitude, longitude) {
    return roundCoord(latitude) + ',' + roundCoord(longitude);
}

async function fetchWeatherFromServer(latitude, longitude) {
    const params = new URLSearchParams();
    params.set('latitude', String(latitude));
    params.set('longitude', String(longitude));
    const wurl = '/weather.php?' + params.toString();
    esajdaLog('weather', 'GET /weather.php (server + SQLite)', { url: wurl });
    const res = await fetch(wurl, { method: 'GET' });
    const cacheHdr = res.headers.get('X-Esajda-Cache');
    esajdaLog('weather', '/weather.php response', {
        status: res.status,
        serverCache: cacheHdr || 'unknown (hit=SQLite, miss=Open-Meteo+fresh, bypass=no DB)'
    });
    const json = await res.json();
    if (!json || !json.success || !json.data) return null;
    return json.data;
}

/**
 * Main weather fetch for selected location.
 * Returns normalized weather info for UI consumption.
 */
export async function fetchWeatherForCurrentSelection() {
    const coords = await resolveSelectedCoords();
    if (!coords) return null;

    const cacheId = weatherCacheKey(coords.latitude, coords.longitude);
    const weatherCache = readStore(WEATHER_CACHE_KEY, {});
    const cached = weatherCache[cacheId];
    if (cached && cached.expiresAt > now()) {
        // Server already persists full weather in SQLite; avoid hitting /weather.php on
        // every navigation when the in-memory payload is still fresh enough.
        const fetchedAtSec = cached.payload && typeof cached.payload.fetchedAt === 'number'
            ? cached.payload.fetchedAt
            : null;
        const ageMs = fetchedAtSec != null ? now() - fetchedAtSec * 1000 : Infinity;
        const bgRefreshAfterMs = 45 * 60 * 1000; // 45 minutes
        if (ageMs >= bgRefreshAfterMs) {
            esajdaLog('weather', 'localStorage cache HIT; background refresh → /weather.php', { cacheId, ageMs });
            fetchWeatherFromServer(coords.latitude, coords.longitude)
                .then((fresh) => {
                    if (!fresh) return;
                    const latest = readStore(WEATHER_CACHE_KEY, {});
                    latest[cacheId] = { payload: fresh, expiresAt: now() + WEATHER_TTL_MS };
                    writeStore(WEATHER_CACHE_KEY, latest);
                })
                .catch(() => {
                    /* ignore background refresh failures */
                });
        } else {
            esajdaLog('weather', 'localStorage cache HIT (skip background refresh)', { cacheId, ageMs });
        }
        return cached.payload;
    }

    const payload = await fetchWeatherFromServer(coords.latitude, coords.longitude);
    if (!payload) return null;

    weatherCache[cacheId] = { payload, expiresAt: now() + WEATHER_TTL_MS };
    writeStore(WEATHER_CACHE_KEY, weatherCache);
    return payload;
}
