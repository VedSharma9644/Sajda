/**
 * Yearly sunrise/sunset series for a fixed lat/lon (local solar times).
 * Uses SunCalc via CDN (ESM); no build step.
 *
 * One row per calendar day (365 or 366 in a leap year). SunCalc `getTimes`
 * supplies civil / nautical / astronomical twilight, noon, nadir, golden hour.
 */

let sunCalcImportPromise = null;

function loadSunCalc() {
    if (!sunCalcImportPromise) {
        sunCalcImportPromise = import('https://esm.sh/suncalc@1.9.0').then((m) => m.default || m);
    }
    return sunCalcImportPromise;
}

async function tryFetchCachedSunYear(year, lat, lon, timezone) {
    // Same-origin cached endpoint (served by PHP) — avoids repeated computation + keeps data in SQLite.
    try {
        const url =
            '/sun-year.php?year=' +
            encodeURIComponent(String(year)) +
            '&latitude=' +
            encodeURIComponent(String(lat)) +
            '&longitude=' +
            encodeURIComponent(String(lon)) +
            (timezone ? '&timezone=' + encodeURIComponent(String(timezone)) : '');
        const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json || json.success !== true || !json.data) return null;
        return json.data;
    } catch (_) {
        return null;
    }
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** `date` local calendar day */
function labelForDay(date) {
    return pad2(date.getMonth() + 1) + '/' + pad2(date.getDate());
}

/** Minutes from local midnight (fractional). */
function minutesFromMidnight(d) {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

/**
 * SunCalc `getTimes` keys → human labels (excluding sunrise/sunset — those are chart datasets).
 * Order here is arbitrary; rows are sorted by time per day for tooltips.
 */
const EXTRA_SUN_KEYS = [
    { key: 'nightEnd', label: 'Astronomical dawn' },
    { key: 'nauticalDawn', label: 'Nautical dawn' },
    { key: 'dawn', label: 'Civil dawn' },
    { key: 'sunriseEnd', label: 'Sunrise ends' },
    { key: 'solarNoon', label: 'Solar noon' },
    { key: 'goldenHourEnd', label: 'Golden hour ends (a.m.)' },
    { key: 'dusk', label: 'Civil dusk' },
    { key: 'nauticalDusk', label: 'Nautical dusk' },
    { key: 'sunsetStart', label: 'Sunset starts' },
    { key: 'goldenHour', label: 'Golden hour ends (p.m.)' },
    { key: 'night', label: 'Astronomical dusk' },
    { key: 'nadir', label: 'Solar midnight' }
];

/**
 * @param {number} year - e.g. 2026
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{
 *   labels: string[],
 *   sunriseMin: (number|null)[],
 *   sunsetMin: (number|null)[],
 *   year: number,
 *   dayCount: number,
 *   dayExtras: { key?: string, label: string, minutes: number }[][]
 * }>}
 */
export async function buildYearlySunSeries(year, lat, lon, timezone) {
    const cached = await tryFetchCachedSunYear(year, lat, lon, timezone);
    if (cached && Array.isArray(cached.labels) && Array.isArray(cached.sunriseMin) && Array.isArray(cached.sunsetMin)) {
        // Ensure we always include these fields for chart-renderer.
        return {
            labels: cached.labels,
            sunriseMin: cached.sunriseMin,
            sunsetMin: cached.sunsetMin,
            year: cached.year || year,
            dayCount: cached.dayCount || (cached.labels ? cached.labels.length : 0),
            dayExtras: cached.dayExtras || [],
            timezone: cached.timezone || timezone || null
        };
    }

    const SunCalc = await loadSunCalc();
    const labels = [];
    const sunriseMin = [];
    const sunsetMin = [];
    const dayExtras = [];

    const d = new Date(year, 0, 1, 12, 0, 0);
    while (d.getFullYear() === year) {
        const times = SunCalc.getTimes(new Date(d.getTime()), lat, lon);
        labels.push(labelForDay(d));
        sunriseMin.push(minutesFromMidnight(times.sunrise));
        sunsetMin.push(minutesFromMidnight(times.sunset));

        const extras = [];
        for (const { key, label } of EXTRA_SUN_KEYS) {
            const t = times[key];
            const m = minutesFromMidnight(t);
            if (m != null && !Number.isNaN(m)) {
                extras.push({ key, label, minutes: m });
            }
        }
        extras.sort((a, b) => a.minutes - b.minutes);
        dayExtras.push(extras);

        d.setDate(d.getDate() + 1);
    }

    return {
        labels,
        sunriseMin,
        sunsetMin,
        year,
        dayCount: labels.length,
        dayExtras
    };
}
