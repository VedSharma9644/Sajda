/**
 * e-Sajda — Daily sun progression chart (altitude vs time)
 *
 * Fetches cached samples from /sun-day.php (SQLite) and renders with Chart.js.
 * Hovering updates the info panel (time, altitude, heading, day/night).
 */

import { state } from '../js/state.js';
import { resolveSelectedCoords } from '../js/weather-api.js?v=25';

const SECTION_ID = 'daily-sun-progression-section';
const DATE_SPAN_ID = 'dailyProgressionChartDate';
const CITY_SPAN_ID = 'dailyProgressionChartCity';
const CANVAS_ID = 'dailySunAltitudeChart';

const PANEL_TIME_ID = 'panelTime';
const PANEL_ALT_ID = 'panelAltitude';
const PANEL_HEADING_ID = 'panelHeading';
const PANEL_POS_ID = 'panelPosition';

let chartImportPromise = null;
let chartInstance = null;

function $(id) {
    return document.getElementById(id);
}

function loadChart() {
    if (!chartImportPromise) {
        chartImportPromise = import('https://esm.sh/chart.js@4.4.1/auto').then((m) => {
            const C = m.default;
            if (typeof C === 'function') return C;
            if (m.Chart) return m.Chart;
            throw new Error('Chart.js failed to load');
        });
    }
    return chartImportPromise;
}

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('hidden');
    else el.classList.remove('hidden');
}

function fmtDeg(v) {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(1) + '°';
}

function normalizeBearing(deg) {
    let d = Number(deg);
    if (!Number.isFinite(d)) return null;
    d %= 360;
    if (d < 0) d += 360;
    return d;
}

function bearingLabel(deg) {
    const d = normalizeBearing(deg);
    if (d == null) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(d / 45) % 8;
    return dirs[idx] + ' (' + Math.round(d) + '°)';
}

function longDate(dateStr, timezone) {
    // dateStr is YYYY-MM-DD in location tz
    const parts = String(dateStr).split('-').map((x) => Number(x));
    if (parts.length !== 3) return dateStr;
    const [y, m, d] = parts;
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    try {
        // Format in the requested timezone if supported.
        return new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: timezone || undefined
        }).format(dt);
    } catch (_) {
        return dateStr;
    }
}

async function fetchSunDay(lat, lon, dateStr, stepMin, timezone) {
    const url =
        '/sun-day.php?latitude=' +
        encodeURIComponent(String(lat)) +
        '&longitude=' +
        encodeURIComponent(String(lon)) +
        '&date=' +
        encodeURIComponent(String(dateStr)) +
        '&step=' +
        encodeURIComponent(String(stepMin)) +
        (timezone ? '&timezone=' + encodeURIComponent(String(timezone)) : '');
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.success !== true || !json.data) return null;
    return json.data;
}

function destroyChart() {
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

function updatePanel(sample, timezone) {
    const tEl = $(PANEL_TIME_ID);
    const aEl = $(PANEL_ALT_ID);
    const hEl = $(PANEL_HEADING_ID);
    const pEl = $(PANEL_POS_ID);
    if (!tEl || !aEl || !hEl || !pEl) return;

    if (!sample) {
        tEl.textContent = '—';
        aEl.textContent = '—';
        hEl.textContent = '—';
        pEl.textContent = '—';
        return;
    }

    tEl.textContent = sample.label || '—';
    aEl.textContent = fmtDeg(sample.altitudeDeg);
    hEl.textContent = bearingLabel(sample.azimuthDeg);
    // Day if above horizon; reference sites sometimes use -0.833, but we keep it simple.
    pEl.textContent = sample.altitudeDeg >= 0 ? 'Day' : 'Night';
    // expose timezone in title if present
    if (timezone) tEl.title = 'Timezone: ' + timezone;
}

export async function refreshDailySunProgression() {
    const section = $(SECTION_ID);
    const dateSpan = $(DATE_SPAN_ID);
    const citySpan = $(CITY_SPAN_ID);
    const canvas = $(CANVAS_ID);
    if (!section || !dateSpan || !citySpan || !canvas) return;

    const coords = await resolveSelectedCoords();
    if (!coords) {
        destroyChart();
        setHidden(section, true);
        return;
    }

    const tz =
        state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.timezone
            ? state.lastTodayData.meta.timezone
            : null;

    // Use today's date in the location timezone if possible.
    let dateStr = null;
    try {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        dateStr = fmt.format(new Date()); // YYYY-MM-DD in en-CA
    } catch (_) {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateStr = y + '-' + m + '-' + dd;
    }

    const stepMin = 5;
    let data = null;
    try {
        data = await fetchSunDay(coords.latitude, coords.longitude, dateStr, stepMin, tz);
    } catch (_) {
        data = null;
    }
    if (!data || !Array.isArray(data.labels) || !Array.isArray(data.altitudeDeg) || !Array.isArray(data.azimuthDeg)) {
        destroyChart();
        setHidden(section, true);
        return;
    }

    const city =
        (state.currentAddress && String(state.currentAddress).trim()) ||
        (coords.source === 'gps' ? 'your location' : 'this location');

    dateSpan.textContent = longDate(data.date || dateStr, data.timezone || tz);
    citySpan.textContent = city;

    const Chart = await loadChart();
    const reduceMotion =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dark = isDarkTheme();

    const text = dark ? '#e7e9ea' : '#0f1419';
    const textMuted = dark ? 'rgba(231, 233, 234, 0.78)' : 'rgba(15, 20, 25, 0.75)';
    const grid = dark ? 'rgba(56, 68, 77, 0.42)' : 'rgba(208, 218, 228, 0.85)';
    const axisBorder = dark ? 'rgba(231, 233, 234, 0.35)' : 'rgba(15, 20, 25, 0.22)';
    const line = dark ? '#7aa2ff' : '#2563eb';
    // Stronger fills so day/night is readable.
    const fillDay = dark ? 'rgba(59, 130, 246, 0.28)' : 'rgba(37, 99, 235, 0.16)';
    const fillNight = dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.12)';

    const points = data.labels.map((label, i) => ({
        x: data.minutes[i],
        y: data.altitudeDeg[i],
        label,
        altitudeDeg: data.altitudeDeg[i],
        azimuthDeg: data.azimuthDeg[i]
    }));

    destroyChart();
    setHidden(section, false);

    // Set initial panel to solar noon-ish (max altitude)
    let maxIdx = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].y > points[maxIdx].y) maxIdx = i;
    }
    updatePanel(points[maxIdx], data.timezone || tz);

    chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Altitude (°)',
                    data: points,
                    parsing: false,
                    borderColor: line,
                    borderWidth: 2.5,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: line,
                    pointHoverBorderColor: dark ? '#0f1419' : '#fff',
                    fill: {
                        target: { value: 0 },
                        above: fillDay,
                        below: fillNight
                    }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduceMotion ? false : { duration: 900, easing: 'easeOutQuart' },
            interaction: { mode: 'nearest', intersect: false },
            layout: {
                padding: { left: 6, right: 8, top: 6, bottom: 2 }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false } // we use the side panel instead
            },
            onHover: (_evt, active) => {
                if (!active || !active.length) return;
                const el = active[0];
                const idx = el.index;
                updatePanel(points[idx], data.timezone || tz);
            },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 24 * 60,
                    ticks: {
                        color: textMuted,
                        stepSize: 120,
                        maxRotation: 0,
                        padding: 6,
                        callback(v) {
                            const total = Number(v);
                            const h = Math.floor(total / 60);
                            const m = Math.round(total % 60);
                            return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
                        }
                    },
                    grid: { color: grid },
                    border: { color: axisBorder }
                },
                y: {
                    // Stable range makes the curve easier to read.
                    min: -90,
                    max: 90,
                    ticks: {
                        color: textMuted,
                        stepSize: 30,
                        padding: 6,
                        callback(v) {
                            return Number(v).toFixed(0) + '°';
                        }
                    },
                    grid: { color: grid },
                    border: { color: axisBorder }
                }
            }
        }
    });
}

export function hideDailySunProgression() {
    destroyChart();
    const section = $(SECTION_ID);
    if (section) section.classList.add('hidden');
}

