/**
 * e-Sajda — Daily sun phases bar (night / twilight / daylight)
 *
 * Renders a 24h stacked bar + legend for the current selected location.
 * Uses the same yearly sun series source (prefers /sun-year.php cache).
 */

import { state } from '../js/state.js';
import { resolveSelectedCoords } from '../js/weather-api.js?v=27';
import { buildYearlySunSeries } from './solar-year.js';

const SECTION_ID = 'daily-sun-bar-section';
const HEADING_ID = 'dailySunBarHeading';
const DATE_ID = 'dailySunBarDateDisplay';
const BAR_ID = 'dailySunBar';
const LEGEND_ID = 'dailySunBarLegend';
const MARKER_ID = 'solarNoonMarker';

function $(id) {
    return document.getElementById(id);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function mmddLabel(date) {
    return pad2(date.getMonth() + 1) + '/' + pad2(date.getDate());
}

function formatClock24(m) {
    if (m == null || Number.isNaN(m)) return '—';
    const total = Math.round(m) % (24 * 60);
    const h = Math.floor(total / 60);
    const min = total % 60;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function formatDuration(mins) {
    const m = Math.max(0, Math.round(mins));
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h <= 0) return r + 'm';
    if (r === 0) return h + 'h';
    return h + 'h ' + r + 'm';
}

function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('hidden');
    else el.classList.remove('hidden');
}

function lookupExtraByKey(dayExtras, key) {
    if (!Array.isArray(dayExtras)) return null;
    const labelFallback = {
        nightEnd: 'Astronomical dawn',
        nauticalDawn: 'Nautical dawn',
        dawn: 'Civil dawn',
        solarNoon: 'Solar noon',
        dusk: 'Civil dusk',
        nauticalDusk: 'Nautical dusk',
        night: 'Astronomical dusk'
    };
    for (const row of dayExtras) {
        if (!row) continue;
        if (row.key === key) return row.minutes;
        // Handle older cached entries that only have `label` but no `key`.
        if (!row.key && row.label && labelFallback[key] && row.label === labelFallback[key]) {
            return row.minutes;
        }
    }
    return null;
}

function computeDailyPhasesForIndex(series, index) {
    const sunrise = series.sunriseMin[index];
    const sunset = series.sunsetMin[index];
    const extras = series.dayExtras ? series.dayExtras[index] : null;

    const astroDawn = lookupExtraByKey(extras, 'nightEnd');
    const nauticalDawn = lookupExtraByKey(extras, 'nauticalDawn');
    const civilDawn = lookupExtraByKey(extras, 'dawn');
    const civilDusk = lookupExtraByKey(extras, 'dusk');
    const nauticalDusk = lookupExtraByKey(extras, 'nauticalDusk');
    const astroDusk = lookupExtraByKey(extras, 'night');
    const solarNoon = lookupExtraByKey(extras, 'solarNoon');

    if ([sunrise, sunset, astroDawn, nauticalDawn, civilDawn, civilDusk, nauticalDusk, astroDusk].some((v) => v == null)) {
        return null;
    }

    const clamp = (v) => Math.max(0, Math.min(24 * 60, v));
    const t = {
        astroDawn: clamp(astroDawn),
        nauticalDawn: clamp(nauticalDawn),
        civilDawn: clamp(civilDawn),
        sunrise: clamp(sunrise),
        sunset: clamp(sunset),
        civilDusk: clamp(civilDusk),
        nauticalDusk: clamp(nauticalDusk),
        astroDusk: clamp(astroDusk),
        solarNoon: solarNoon != null ? clamp(solarNoon) : null
    };

    const mk = (phase, start, end, label) => ({
        phase,
        start,
        end,
        label,
        duration: Math.max(0, end - start),
        widthPct: Math.max(0, ((end - start) / (24 * 60)) * 100)
    });

    const segments = [
        mk('night', 0, t.astroDawn, 'Night'),
        mk('astro-twilight', t.astroDawn, t.nauticalDawn, 'Astro Twilight'),
        mk('nautical-twilight', t.nauticalDawn, t.civilDawn, 'Nautical Twilight'),
        mk('civil-twilight', t.civilDawn, t.sunrise, 'Civil Twilight'),
        mk('daylight', t.sunrise, t.sunset, 'Daylight'),
        mk('civil-twilight', t.sunset, t.civilDusk, 'Civil Twilight'),
        mk('nautical-twilight', t.civilDusk, t.nauticalDusk, 'Nautical Twilight'),
        mk('astro-twilight', t.nauticalDusk, t.astroDusk, 'Astro Twilight'),
        mk('night', t.astroDusk, 24 * 60, 'Night')
    ].filter((s) => s.duration > 0.01);

    return { segments, times: t };
}

function groupLegend(segments) {
    const groups = new Map();
    for (const s of segments) {
        const key = s.phase;
        if (!groups.has(key)) groups.set(key, { phase: s.phase, label: s.label, ranges: [], total: 0 });
        const g = groups.get(key);
        g.ranges.push({ start: s.start, end: s.end });
        g.total += s.duration;
    }

    const order = ['night', 'astro-twilight', 'nautical-twilight', 'civil-twilight', 'daylight'];
    return order
        .filter((k) => groups.has(k))
        .map((k) => groups.get(k));
}

function renderDailySunBar(dom, payload) {
    const { title, dateLabel, segments, solarNoon } = payload;

    dom.heading.textContent = title;
    dom.date.textContent = dateLabel;

    dom.bar.innerHTML = segments
        .map((s) => {
            const titleText =
                s.label +
                ': ' +
                formatClock24(s.start) +
                ' - ' +
                formatClock24(s.end) +
                ' (' +
                formatDuration(s.duration) +
                ')';
            return (
                '<span class="sun-phase ' +
                s.phase +
                '" title="' +
                titleText +
                '" style="width: ' +
                s.widthPct.toFixed(4) +
                '%;"></span>'
            );
        })
        .join('');

    if (solarNoon != null) {
        setHidden(dom.marker, false);
        dom.marker.title = 'Solar Noon: ' + formatClock24(solarNoon);
        dom.marker.style.left = ((solarNoon / (24 * 60)) * 100).toFixed(4) + '%';
    } else {
        setHidden(dom.marker, true);
    }

    const legendGroups = groupLegend(segments);
    dom.legend.innerHTML =
        legendGroups
            .map((g) => {
                const timesHtml = g.ranges
                    .map((r) => '<div>' + formatClock24(r.start) + ' - ' + formatClock24(r.end) + '</div>')
                    .join('');
                return (
                    '<div class="legend-item">' +
                    '<div class="legend-item-header">' +
                    '<span class="legend-color-box sun-phase ' +
                    g.phase +
                    '"></span>' +
                    '<span class="legend-item-phase-name">' +
                    g.label +
                    ':</span>' +
                    '</div>' +
                    '<div class="legend-item-times">' +
                    timesHtml +
                    '</div>' +
                    '<div class="legend-item-total">Total: ' +
                    formatDuration(g.total) +
                    '</div>' +
                    '</div>'
                );
            })
            .join('') +
        '<div class="legend-item legend-item-solarnoon">' +
        '<div class="legend-item-header"><span class="legend-item-phase-name">Solar Noon:</span></div>' +
        '<div class="legend-item-times"><div><span class="solar-noon-swatch" aria-hidden="true">━</span> ' +
        (solarNoon != null ? formatClock24(solarNoon) : '—') +
        '</div></div>' +
        '</div>';
}

export async function refreshDailySunBar() {
    const section = $(SECTION_ID);
    const heading = $(HEADING_ID);
    const date = $(DATE_ID);
    const bar = $(BAR_ID);
    const legend = $(LEGEND_ID);
    const marker = $(MARKER_ID);
    if (!section || !heading || !date || !bar || !legend || !marker) return;

    const coords = await resolveSelectedCoords();
    if (!coords) {
        setHidden(section, true);
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const mmdd = mmddLabel(now);

    try {
        const tz =
            state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.timezone
                ? state.lastTodayData.meta.timezone
                : null;
        const series = await buildYearlySunSeries(year, coords.latitude, coords.longitude, tz);
        const idx = Array.isArray(series.labels) ? series.labels.indexOf(mmdd) : -1;
        if (idx < 0) {
            setHidden(section, true);
            return;
        }

        const computed = computeDailyPhasesForIndex(series, idx);
        if (!computed) {
            setHidden(section, true);
            return;
        }

        const city =
            (state.currentAddress && String(state.currentAddress).trim()) ||
            (coords.source === 'gps' ? 'your location' : 'this location');

        setHidden(section, false);
        renderDailySunBar(
            { heading, date, bar, legend, marker },
            {
                title: "Today's Sun Phases for " + city,
                dateLabel: now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                segments: computed.segments,
                solarNoon: computed.times.solarNoon
            }
        );
    } catch (_) {
        setHidden(section, true);
    }
}

export function hideDailySunBar() {
    const section = $(SECTION_ID);
    if (section) section.classList.add('hidden');
}

