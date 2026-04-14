/**
 * e-Sajda — Monthly (or 7-day) sun times table (sunrise/sunset, twilights, solar noon, bearings)
 * Uses yearly series from sun-year.php (via buildYearlySunSeries) + SunCalc for azimuth at key times.
 */

import { buildYearlySunSeries } from './solar-year.js';
import { escapeHtml } from '../js/utils.js';

let sunCalcImportPromise = null;

function loadSunCalc() {
    if (!sunCalcImportPromise) {
        sunCalcImportPromise = import('https://esm.sh/suncalc@1.9.0').then((m) => m.default || m);
    }
    return sunCalcImportPromise;
}

function zonedDayWallTimeToUtcDate(year, month, day, hour, minute, timeZone) {
    if (!timeZone) {
        return new Date(year, month - 1, day, hour, minute, 0, 0);
    }
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    function readLocal(dt) {
        const parts = fmt.formatToParts(dt);
        const o = {};
        for (const p of parts) {
            if (p.type !== 'literal') o[p.type] = p.value;
        }
        return {
            y: Number(o.year),
            m: Number(o.month),
            d: Number(o.day),
            H: Number(o.hour),
            M: Number(o.minute),
            S: Number(o.second || 0)
        };
    }
    let guess = new Date(Date.UTC(year, month - 1, day, hour - 6, minute, 0));
    for (let i = 0; i < 40; i++) {
        const L = readLocal(guess);
        if (L.y === year && L.m === month && L.d === day && L.H === hour && L.M === minute) {
            return guess;
        }
        const deltaSec = (hour - L.H) * 3600 + (minute - L.M) * 60 - L.S;
        guess = new Date(guess.getTime() + deltaSec * 1000);
    }
    return guess;
}

/** SunCalc azimuth (rad, from south clockwise) → compass degrees from north [0,360). */
function suncalcAzimuthToCompassDeg(azRad) {
    const degFromSouth = (azRad * 180) / Math.PI;
    let fromNorth = (degFromSouth + 180) % 360;
    if (fromNorth < 0) fromNorth += 360;
    return fromNorth;
}

function bearingCellLabel(deg) {
    if (deg == null || !Number.isFinite(deg)) return '';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(deg / 45) % 8;
    return Math.round(deg) + '° ' + dirs[idx];
}

/** Split fractional minutes-from-midnight into hour (0–23) and minute (0–59). */
function wallClockFromMinutes(m) {
    if (m == null || Number.isNaN(m)) return null;
    const totalSec = Math.round(m * 60);
    let totalMin = Math.floor(totalSec / 60);
    totalMin = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
    return { h: Math.floor(totalMin / 60), min: totalMin % 60 };
}

function minutesToHm(m) {
    const w = wallClockFromMinutes(m);
    if (!w) return null;
    return String(w.h).padStart(2, '0') + ':' + String(w.min).padStart(2, '0');
}

function extrasByKey(dayExtrasRow) {
    const map = {};
    if (!Array.isArray(dayExtrasRow)) return map;
    for (const e of dayExtrasRow) {
        if (e && e.key) map[e.key] = e.minutes;
    }
    return map;
}

function dayLengthMinutes(sunriseMin, sunsetMin) {
    if (sunriseMin == null || sunsetMin == null) return null;
    let d = sunsetMin - sunriseMin;
    if (d < 0) d += 24 * 60;
    return d;
}

function formatDayLength(totalMinutes) {
    if (totalMinutes == null || totalMinutes < 0) return '—';
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

function formatDayLengthDelta(deltaMin) {
    if (deltaMin == null || !Number.isFinite(deltaMin)) return '—';
    const sign = deltaMin >= 0 ? '+' : '−';
    const abs = Math.abs(deltaMin);
    const sec = Math.round(abs * 60);
    const mPart = Math.floor(sec / 60);
    const sPart = sec % 60;
    return sign + mPart + 'm ' + sPart + 's';
}

/** Approximate Earth–Sun distance (million km) for a calendar date. */
function sunDistanceMillionKm(year, month, day) {
    const jan1 = new Date(year, 0, 1);
    const d = new Date(year, month - 1, day);
    const dayOfYear = Math.floor((d - jan1) / 86400000) + 1;
    const g = (2 * Math.PI * (dayOfYear - 1)) / 365.25;
    const au = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    return (au * 149.5978707) / 1;
}

function dayIndexInYear(year, month1, day) {
    const jan1 = new Date(year, 0, 1);
    const cur = new Date(year, month1 - 1, day);
    return Math.floor((cur - jan1) / 86400000);
}

function daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
}

/** Gregorian calendar date in IANA `timeZone` for “now” (fallback: device local). */
function calendarTodayInTimezone(timeZone) {
    if (!timeZone) {
        const n = new Date();
        return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
    }
    try {
        const s = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        const [yy, mm, dd] = s.split('-').map((x) => parseInt(x, 10));
        if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) throw new Error('bad');
        return { y: yy, m: mm, d: dd };
    } catch (_) {
        const n = new Date();
        return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
    }
}

/** Add signed whole days in the Gregorian calendar (UTC date math). */
function addCalendarDays(y, month, day, deltaDays) {
    const t = Date.UTC(y, month - 1, day) + deltaDays * 86400000;
    const d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function $(id) {
    return document.getElementById(id);
}

let loadToken = 0;
/** @type {Map<string, object>} */
let seriesMemCache = new Map();

function seriesCacheKey(year, lat, lon, tz) {
    const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
    return year + '|' + r4(lat) + '|' + r4(lon) + '|' + String(tz || '');
}

async function getSeriesForYear(year, lat, lon, tz, my) {
    const key = seriesCacheKey(year, lat, lon, tz);
    if (seriesMemCache.has(key)) return seriesMemCache.get(key);
    const s = await buildYearlySunSeries(year, lat, lon, tz || undefined);
    if (my !== loadToken) return null;
    seriesMemCache.set(key, s);
    return s;
}

function monthName(m) {
    return new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' });
}

function formatShortWeekdayDate(y, m, d) {
    try {
        return new Date(y, m - 1, d).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
    } catch (_) {
        return d + ' ' + monthName(m);
    }
}

function buildTableHead(dayColumnLabel) {
    const dayLabel = dayColumnLabel || 'Day';
    return (
        '<thead>' +
        '<tr>' +
        '<th rowspan="2" scope="col" class="sun-month-th-day">' +
        escapeHtml(dayLabel) +
        '</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Sunrise / Sunset</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Daylight</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Astronomical twilight</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Nautical twilight</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Civil twilight</th>' +
        '<th colspan="2" scope="colgroup" class="sun-month-th-group">Solar noon</th>' +
        '</tr>' +
        '<tr>' +
        '<th scope="col" class="sun-month-th-sub">Sunrise</th>' +
        '<th scope="col" class="sun-month-th-sub">Sunset</th>' +
        '<th scope="col" class="sun-month-th-sub">Length</th>' +
        '<th scope="col" class="sun-month-th-sub">Diff.</th>' +
        '<th scope="col" class="sun-month-th-sub">Start</th>' +
        '<th scope="col" class="sun-month-th-sub">End</th>' +
        '<th scope="col" class="sun-month-th-sub">Start</th>' +
        '<th scope="col" class="sun-month-th-sub">End</th>' +
        '<th scope="col" class="sun-month-th-sub">Start</th>' +
        '<th scope="col" class="sun-month-th-sub">End</th>' +
        '<th scope="col" class="sun-month-th-sub">Time</th>' +
        '<th scope="col" class="sun-month-th-sub">Sun dist. (mil km)</th>' +
        '</tr>' +
        '</thead>'
    );
}

function timeAndBearingHtml(timeStr, bearingStr) {
    if (!timeStr || timeStr === '—') return '—';
    const b = bearingStr ? '<br><span class="sun-month-bearing">' + escapeHtml(bearingStr) + '</span>' : '';
    return '<span class="sun-month-time">' + escapeHtml(timeStr) + '</span>' + b;
}

/**
 * @param {{
 *   y: number, m: number, dom: number,
 *   series: object,
 *   prevSeries: object|null,
 *   prevY: number, prevM: number, prevD: number,
 *   lat: number, lon: number, timezone: string|null,
 *   SunCalc: object|null,
 *   dayCellHtml: string,
 *   todayY: number, todayM: number, todayD: number
 * }} p
 */
function buildRowHtml(p) {
    const {
        y,
        m,
        dom,
        series,
        prevSeries,
        prevY,
        prevM,
        prevD,
        lat,
        lon,
        timezone,
        SunCalc,
        dayCellHtml,
        todayY,
        todayM,
        todayD
    } = p;

    const idx = dayIndexInYear(y, m, dom);
    const sr = series.sunriseMin[idx];
    const ss = series.sunsetMin[idx];
    const ex = extrasByKey(series.dayExtras[idx]);

    const len = dayLengthMinutes(sr, ss);
    let deltaStr = '—';
    let deltaClass = '';
    if (prevSeries && len != null) {
        const pIdx = dayIndexInYear(prevY, prevM, prevD);
        const prevLen = dayLengthMinutes(prevSeries.sunriseMin[pIdx], prevSeries.sunsetMin[pIdx]);
        if (prevLen != null) {
            const dMin = len - prevLen;
            deltaStr = formatDayLengthDelta(dMin);
            deltaClass = dMin > 0 ? ' sun-month-diff-pos' : dMin < 0 ? ' sun-month-diff-neg' : '';
        }
    }

    const tSr = minutesToHm(sr);
    const tSs = minutesToHm(ss);
    const tNightEnd = minutesToHm(ex.nightEnd);
    const tNight = minutesToHm(ex.night);
    const tNautDawn = minutesToHm(ex.nauticalDawn);
    const tNautDusk = minutesToHm(ex.nauticalDusk);
    const tDawn = minutesToHm(ex.dawn);
    const tDusk = minutesToHm(ex.dusk);
    const tNoon = minutesToHm(ex.solarNoon);

    let brSr = '';
    let brSs = '';
    if (timezone && SunCalc) {
        try {
            if (tSr && sr != null) {
                const w = wallClockFromMinutes(sr);
                if (w) {
                    const dRise = zonedDayWallTimeToUtcDate(y, m, dom, w.h, w.min, timezone);
                    const pRise = SunCalc.getPosition(dRise, lat, lon);
                    brSr = bearingCellLabel(suncalcAzimuthToCompassDeg(pRise.azimuth));
                }
            }
            if (tSs && ss != null) {
                const w = wallClockFromMinutes(ss);
                if (w) {
                    const dSet = zonedDayWallTimeToUtcDate(y, m, dom, w.h, w.min, timezone);
                    const pSet = SunCalc.getPosition(dSet, lat, lon);
                    brSs = bearingCellLabel(suncalcAzimuthToCompassDeg(pSet.azimuth));
                }
            }
        } catch (_) {
            /* bearings optional */
        }
    }

    const dist = sunDistanceMillionKm(y, m, dom).toFixed(2);
    const rowToday = y === todayY && m === todayM && dom === todayD ? ' sun-month-tr-today' : '';

    return (
        '<tr class="sun-month-tr' + rowToday + '">' +
        '<th scope="row" class="sun-month-td-day">' +
        dayCellHtml +
        '</th>' +
        '<td class="sun-month-td">' +
        timeAndBearingHtml(tSr || '—', brSr) +
        '</td>' +
        '<td class="sun-month-td">' +
        timeAndBearingHtml(tSs || '—', brSs) +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(formatDayLength(len)) +
        '</td>' +
        '<td class="sun-month-td' + deltaClass + '">' +
        escapeHtml(deltaStr) +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tNightEnd || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tNight || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tNautDawn || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tNautDusk || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tDawn || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tDusk || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(tNoon || '—') +
        '</td>' +
        '<td class="sun-month-td">' +
        escapeHtml(dist) +
        '</td>' +
        '</tr>'
    );
}

/**
 * @param {{
 *   year: number,
 *   month: number,
 *   viewRange: 'month' | '7day',
 *   placeName: string,
 *   latitude: number,
 *   longitude: number,
 *   timezone: string|null
 * }} opts
 */
export async function refreshSunMonthTable(opts) {
    const section = $('sun-month-calendar-section');
    const table = $('sun-month-table');
    const titleEl = $('sun-month-calendar-title');
    const errEl = $('sun-month-calendar-error');
    if (!section || !table || !titleEl) return;

    const { year, month, viewRange, placeName, latitude, longitude, timezone } = opts;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const range = viewRange === '7day' ? '7day' : 'month';

    const my = ++loadToken;
    if (errEl) errEl.classList.add('hidden');

    try {
        const tz = timezone || null;
        const today = calendarTodayInTimezone(tz);
        /** @type {{ y: number, m: number, d: number }[]} */
        let days = [];

        if (range === '7day') {
            for (let i = 0; i < 7; i++) {
                days.push(addCalendarDays(today.y, today.m, today.d, i));
            }
        } else {
            const dim = daysInMonth(year, month);
            for (let dom = 1; dom <= dim; dom++) {
                days.push({ y: year, m: month, d: dom });
            }
        }

        const yearsNeeded = new Set(days.map((x) => x.y));
        if (days.length) {
            const first = days[0];
            const beforeFirst = addCalendarDays(first.y, first.m, first.d, -1);
            yearsNeeded.add(beforeFirst.y);
        }
        const yearsSorted = [...yearsNeeded].sort((a, b) => a - b);
        /** @type {Record<number, object>} */
        const seriesByYear = {};
        for (const y of yearsSorted) {
            const s = await getSeriesForYear(y, lat, lon, tz, my);
            if (my !== loadToken) return;
            if (!s) throw new Error('series');
            seriesByYear[y] = s;
        }

        const SunCalc = tz ? await loadSunCalc() : null;
        if (my !== loadToken) return;

        const rows = [];
        for (let i = 0; i < days.length; i++) {
            const { y, m, d } = days[i];
            const series = seriesByYear[y];
            const prev = i > 0 ? days[i - 1] : addCalendarDays(y, m, d, -1);
            const prevSeries = seriesByYear[prev.y] || null;

            const dayCellHtml =
                range === '7day'
                    ? escapeHtml(formatShortWeekdayDate(y, m, d))
                    : escapeHtml(String(d));

            rows.push(
                buildRowHtml({
                    y,
                    m,
                    dom: d,
                    series,
                    prevSeries,
                    prevY: prev.y,
                    prevM: prev.m,
                    prevD: prev.d,
                    lat,
                    lon,
                    timezone: tz,
                    SunCalc,
                    dayCellHtml,
                    todayY: today.y,
                    todayM: today.m,
                    todayD: today.d
                })
            );
        }

        if (range === '7day') {
            const end = days[days.length - 1];
            titleEl.textContent =
                'Next 7 days of sun & twilight (' +
                formatShortWeekdayDate(today.y, today.m, today.d) +
                ' – ' +
                formatShortWeekdayDate(end.y, end.m, end.d) +
                ') in ' +
                (placeName || 'this location');
        } else {
            titleEl.textContent =
                monthName(month) + ' ' + year + ' sunrise & sunset times in ' + (placeName || 'this location');
        }

        const headLabel = range === '7day' ? 'Date' : 'Day';
        table.innerHTML = buildTableHead(headLabel) + '<tbody>' + rows.join('') + '</tbody>';
        section.classList.remove('hidden');
        syncSunMonthRangeControls();
    } catch (_) {
        if (my !== loadToken) return;
        seriesMemCache.clear();
        table.innerHTML = '';
        if (errEl) {
            errEl.textContent = 'Could not load the monthly sun table.';
            errEl.classList.remove('hidden');
        }
    }
}

export function hideSunMonthTable() {
    loadToken += 1;
    const section = $('sun-month-calendar-section');
    if (section) section.classList.add('hidden');
    seriesMemCache.clear();
}

export function syncSunMonthRangeControls() {
    const rangeSel = $('sun-month-range-select');
    const monthSel = $('sun-month-select');
    const yearSel = $('sun-year-select');
    const viewBtn = $('sun-month-view-btn');
    const mode = rangeSel && rangeSel.value === '7day' ? '7day' : 'month';
    const disabled = mode === '7day';
    [monthSel, yearSel].forEach((el) => {
        if (!el) return;
        el.disabled = disabled;
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        el.closest('.sun-month-calendar-label')?.classList.toggle('sun-month-calendar-label--disabled', disabled);
    });
    if (viewBtn) {
        viewBtn.textContent = mode === '7day' ? 'Refresh' : 'View sun data';
    }
}

export function fillSunMonthYearSelects() {
    const monthSel = $('sun-month-select');
    const yearSel = $('sun-year-select');
    const rangeSel = $('sun-month-range-select');
    if (!monthSel || !yearSel) return;

    const now = new Date();
    const cy = now.getFullYear();

    if (rangeSel && !rangeSel.dataset.esajdaFilled) {
        rangeSel.innerHTML = '';
        const o1 = document.createElement('option');
        o1.value = 'month';
        o1.textContent = 'Whole month';
        rangeSel.appendChild(o1);
        const o2 = document.createElement('option');
        o2.value = '7day';
        o2.textContent = 'Next 7 days';
        rangeSel.appendChild(o2);
        rangeSel.dataset.esajdaFilled = '1';
        rangeSel.value = 'month';
    }

    if (!monthSel.dataset.esajdaFilled) {
        monthSel.innerHTML = '';
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = String(m);
            opt.textContent = monthName(m);
            monthSel.appendChild(opt);
        }
        monthSel.dataset.esajdaFilled = '1';
    }

    if (!yearSel.dataset.esajdaFilled) {
        yearSel.innerHTML = '';
        for (let y = cy - 5; y <= cy + 5; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            yearSel.appendChild(opt);
        }
        yearSel.dataset.esajdaFilled = '1';
    }

    monthSel.value = String(now.getMonth() + 1);
    yearSel.value = String(cy);
    syncSunMonthRangeControls();
}

/** @returns {{ viewRange: 'month'|'7day', month: number, year: number }} */
export function readSunMonthCalendarFromForm() {
    const rangeSel = $('sun-month-range-select');
    const viewRange = rangeSel && rangeSel.value === '7day' ? '7day' : 'month';
    const { month, year } = readSunMonthYearFromForm();
    return { viewRange, month, year };
}

export function readSunMonthYearFromForm() {
    const monthSel = $('sun-month-select');
    const yearSel = $('sun-year-select');
    const month = monthSel ? Math.max(1, Math.min(12, parseInt(monthSel.value, 10) || 1)) : 1;
    const year = yearSel ? parseInt(yearSel.value, 10) || new Date().getFullYear() : new Date().getFullYear();
    return { month, year };
}
