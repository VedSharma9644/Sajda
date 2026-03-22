/**
 * e-Sajda – Small helpers (time, HTML escaping, location label)
 *
 * Used by API building, “next prayer” logic, and the results header. Nothing here
 * touches the DOM except `escapeHtml` (creates a temporary element).
 */

import { state } from './state.js';

/** Returns the browser’s IANA timezone string (e.g. `Asia/Kolkata`), or `''` if unknown. */
export function getTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {
        return '';
    }
}

/** Today’s calendar date as `DD-MM-YYYY` — Aladhan’s expected format for single-day requests. */
export function getTodayDate() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/** Parses `"HH:MM"` into minutes since midnight, or `null` if invalid. */
export function timeToMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const parts = hhmm.trim().split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

/**
 * “What time is it now?” expressed as minutes since midnight in the given IANA
 * timezone. Falls back to the browser’s local clock if `Intl` fails.
 */
export function getNowMinutesInTimezone(tz) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        let hour = 0, minute = 0;
        parts.forEach((p) => {
            if (p.type === 'hour') hour = parseInt(p.value, 10);
            if (p.type === 'minute') minute = parseInt(p.value, 10);
        });
        return hour * 60 + minute;
    } catch (_) {
        const d = new Date();
        return d.getHours() * 60 + d.getMinutes();
    }
}

/** Turns a minute offset into short text like `in 2h 15m` for the next-prayer banner. */
export function formatCountdown(minutesUntil) {
    if (minutesUntil <= 0) return 'Starting now';
    const h = Math.floor(minutesUntil / 60);
    const m = minutesUntil % 60;
    if (h > 0 && m > 0) return 'in ' + h + 'h ' + m + 'm';
    if (h > 0) return 'in ' + h + 'h';
    return 'in ' + m + 'm';
}

/** Escapes text so it is safe to inject into `innerHTML` (e.g. Nominatim place names). */
export function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/**
 * Short place label for the URL path: first segment of a Nominatim-style name → `Jaipur`.
 * Keeps links like `https://site/Jaipur` instead of long comma-separated strings.
 */
export function compactPlaceForUrl(full) {
    if (!full || typeof full !== 'string') return '';
    const parts = full.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    return parts.length ? parts[0] : '';
}

/**
 * User-facing English place line from a Nominatim search/reverse item (not raw `display_name`,
 * which may use local scripts). Uses `address` fields + optional `name:en` from `namedetails`.
 */
export function englishPlaceLabelFromNominatim(item) {
    if (!item || typeof item !== 'object') return '';
    const a = item.address || {};
    const namedetails = item.namedetails || {};

    var settlement =
        a.city || a.town || a.village || a.municipality || a.hamlet || a.locality ||
        a.suburb || a.city_district || a.neighbourhood || '';

    var district = a.state_district || a.district || a.county || '';
    if (!settlement && district) settlement = district;

    var region = a.state || a.region || '';
    var country = a.country || '';

    if (!settlement && namedetails['name:en']) {
        settlement = namedetails['name:en'];
    } else if (!settlement && namedetails.name) {
        settlement = namedetails.name;
    }

    var parts = [];
    if (settlement) parts.push(settlement);
    if (region) parts.push(region);
    if (country) parts.push(country);
    if (parts.length) return parts.join(', ');

    var fallback = item.display_name;
    return typeof fallback === 'string' ? fallback.trim() : '';
}

/**
 * Human-readable location line for the results header: typed address, or
 * “Your location (lat, lon)” with optional coordinates when using GPS.
 */
export function getDisplayLocation() {
    if (state.currentAddress) {
        if (state.useCoordinates && state.currentCoords) {
            var lat = state.currentCoords.latitude;
            var lon = state.currentCoords.longitude;
            if (typeof lat === 'number' && typeof lon === 'number') {
                return state.currentAddress + ' (' + lat.toFixed(2) + ', ' + lon.toFixed(2) + ')';
            }
        }
        return state.currentAddress;
    }
    if (state.useCoordinates && state.currentCoords) return 'Your location (' + state.currentCoords.latitude.toFixed(2) + ', ' + state.currentCoords.longitude.toFixed(2) + ')';
    return '—';
}
