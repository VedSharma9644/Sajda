/**
 * e-Sajda – Sunrise / sunset helpers (Aladhan timings)
 *
 * Uses standard Aladhan `timings` keys: Sunrise, Sunset, Fajr, Isha.
 * - Day length is computed as the span between Sunrise and Sunset (local same day).
 * - Dawn / Dusk rows use Fajr and Isha as Islamic morning / evening references
 *   (Fajr ≈ true dawn for prayer; Isha marks entry into night — common app pattern
 *   when civil dusk is not provided by the API).
 */

import { timeToMinutes } from './utils.js';

/** First time token from Aladhan strings like `06:52` or `06:52 (GMT+5)`. */
export function stripTimeToken(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim().split(/\s+/)[0].trim();
}

/**
 * Minutes from sunrise to sunset (same calendar day). Handles rare wrap if needed.
 * @returns {number|null}
 */
export function dayLengthMinutes(sunriseRaw, sunsetRaw) {
    const sr = timeToMinutes(stripTimeToken(sunriseRaw));
    const ss = timeToMinutes(stripTimeToken(sunsetRaw));
    if (sr === null || ss === null) return null;
    let diff = ss - sr;
    if (diff < 0) {
        diff += 24 * 60;
    }
    return diff;
}

/** Format total minutes as `12h 23m`. */
export function formatDayLength(totalMinutes) {
    if (totalMinutes === null || totalMinutes < 0) return '—';
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    return h + 'h ' + m + 'm';
}

/** User-facing time cell (strip timezone suffix). */
export function formatTimeForDisplay(raw) {
    if (!raw || typeof raw !== 'string') return '—';
    const t = stripTimeToken(raw);
    return t || '—';
}

/**
 * @typedef {{ key: string, icon: string, label: string, value: string, title?: string, valuePrefix?: string }} SunTimesRow
 */

/**
 * Build display rows from Aladhan `data.timings`.
 * @param {Record<string, string>|null|undefined} timings
 * @returns {SunTimesRow[]}
 */
export function buildSunTimesRows(timings) {
    if (!timings || typeof timings !== 'object') return [];

    const sunrise = timings.Sunrise;
    const sunset = timings.Sunset;
    const fajr = timings.Fajr;
    const isha = timings.Isha;

    const len = dayLengthMinutes(sunrise, sunset);
    const dayLenStr = formatDayLength(len);

    const rows = [];

    if (sunrise) {
        rows.push({
            key: 'sunrise',
            icon: '🌅',
            label: 'Sunrise',
            value: formatTimeForDisplay(sunrise),
            valuePrefix: '↑ ',
            title: 'Official sunrise'
        });
    }
    if (sunset) {
        rows.push({
            key: 'sunset',
            icon: '🌇',
            label: 'Sunset',
            value: formatTimeForDisplay(sunset),
            valuePrefix: '↓ ',
            title: 'Official sunset'
        });
    }
    if (sunrise && sunset) {
        rows.push({
            key: 'daylength',
            icon: '⏳',
            label: 'Day length',
            value: dayLenStr,
            title: 'Time between sunrise and sunset'
        });
    }
    if (fajr) {
        rows.push({
            key: 'dawn',
            icon: '🌄',
            label: 'Dawn',
            value: formatTimeForDisplay(fajr),
            title: 'Fajr (Islamic dawn)'
        });
    }
    if (isha) {
        rows.push({
            key: 'dusk',
            icon: '🌆',
            label: 'Dusk',
            value: formatTimeForDisplay(isha),
            title: 'Isha (evening; Islamic night prayer time)'
        });
    }

    return rows;
}

/**
 * Whether we have enough data to show the sun-times card.
 * @param {Record<string, string>|null|undefined} timings
 */
export function hasSunTimesData(timings) {
    const rows = buildSunTimesRows(timings);
    return rows.length > 0;
}
