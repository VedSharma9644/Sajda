/**
 * e-Sajda – Weather widget UI
 *
 * Uses `weather-api.js` and updates the home weather card + standalone weather page.
 */

import { $, show, hide, syncWeatherSunstrip } from './dom.js';
import { getDisplayLocation, escapeHtml } from './utils.js';
import { fetchWeatherForCurrentSelection } from './weather-api.js?v=27';
import { state } from './state.js';
import { stripTimeToken } from './sun-times.js';
import { readLocationPathPrefix, pageHref } from './page-location.js';

let requestToken = 0;

function iconForCode(code, isDay) {
    if (code === 0) return isDay ? '☀️' : '🌙';
    if (code <= 3) return '⛅';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 86) return '🌦️';
    if (code >= 95) return '⛈️';
    return '🌤️';
}

function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}

function fmtValue(v, suffix) {
    return v == null || Number.isNaN(Number(v)) ? '—' : Math.round(Number(v)) + suffix;
}

/** 8-point cardinal for meteorological degrees (direction wind comes from). */
function windCardinal8(deg) {
    if (deg == null || !Number.isFinite(Number(deg))) return '';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const d = ((Number(deg) % 360) + 360) % 360;
    const idx = Math.round(d / 45) % 8;
    return dirs[idx];
}

function fmtWind(payload) {
    const spd = payload.windSpeed;
    const card = windCardinal8(payload.windDirection);
    if (spd == null || Number.isNaN(Number(spd))) return '—';
    const s = Math.round(Number(spd)) + ' km/h';
    return card ? s + ' ' + card : s;
}

function fmtHumidityLine(payload) {
    const h = payload.humidity;
    if (h == null || Number.isNaN(Number(h))) return '—';
    return Math.round(Number(h)) + '% humidity';
}

function fmtPressure(payload) {
    const p = payload.pressureMsl;
    if (p == null || Number.isNaN(Number(p))) return '—';
    return Math.round(Number(p)) + ' hPa';
}

function fmtVisibility(payload) {
    const m = payload.visibilityM;
    if (m == null || !Number.isFinite(Number(m)) || m <= 0) return '—';
    const v = Number(m);
    if (v >= 1000) return (Math.round((v / 1000) * 10) / 10).toFixed(1) + ' km visibility';
    return Math.round(v) + ' m visibility';
}

function fmtUv(payload) {
    const u = payload.uvIndex;
    if (u == null || Number.isNaN(Number(u))) return '—';
    const n = Number(u);
    const t = Math.round(n * 10) / 10;
    return 'UV index: ' + (t % 1 === 0 ? String(Math.round(t)) : t.toFixed(1));
}

function fmtDew(payload) {
    const d = payload.dewPoint;
    if (d == null || Number.isNaN(Number(d))) return '—';
    return 'Dew point: ' + Math.round(Number(d)) + '°C';
}

function todayDateDmy() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
}

function to12hDisplay(hhmm) {
    const raw = stripTimeToken(hhmm);
    if (!raw || !/^\d{1,2}:\d{2}/.test(raw)) return raw || '—';
    const [h, m] = raw.split(':').map((x) => parseInt(x, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return raw;
    const dt = new Date(2000, 0, 1, h, m, 0, 0);
    try {
        return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
        return raw;
    }
}

function wireSunLink(anchor, pathPrefix) {
    if (!anchor) return;
    const href = pathPrefix ? pageHref(pathPrefix, 'sun') : '';
    if (href) {
        anchor.href = href;
        anchor.classList.remove('is-disabled');
        anchor.removeAttribute('aria-disabled');
    } else {
        anchor.href = '#';
        anchor.classList.add('is-disabled');
        anchor.setAttribute('aria-disabled', 'true');
    }
}

async function fillSunriseSunsetRow(myToken) {
    const riseA = $('weather-sunrise-link');
    const setA = $('weather-sunset-link');
    const riseTime = $('weather-sunrise-time');
    const setTime = $('weather-sunset-time');
    if (!riseTime || !setTime) return;

    const pathPrefix = readLocationPathPrefix();
    wireSunLink(riseA, pathPrefix);
    wireSunLink(setA, pathPrefix);

    const addr = state.currentAddress;
    if (!addr) {
        riseTime.textContent = '—';
        setTime.textContent = '—';
        return;
    }

    try {
        const url = new URL('/api.php', window.location.origin);
        url.searchParams.set('action', 'today');
        url.searchParams.set('date', todayDateDmy());
        url.searchParams.set('method', '4');
        url.searchParams.set('address', addr);
        const r = await fetch(url.toString(), { credentials: 'same-origin' });
        if (myToken !== requestToken) return;
        if (!r.ok) {
            riseTime.textContent = '—';
            setTime.textContent = '—';
            return;
        }
        const j = await r.json();
        if (myToken !== requestToken) return;
        if (!j.success || !j.data || !j.data.timings) {
            riseTime.textContent = '—';
            setTime.textContent = '—';
            return;
        }
        const t = j.data.timings;
        riseTime.textContent = to12hDisplay(t.Sunrise || '');
        setTime.textContent = to12hDisplay(t.Sunset || '');
    } catch (_) {
        if (myToken !== requestToken) return;
        riseTime.textContent = '—';
        setTime.textContent = '—';
    }
}

function showWeatherLoading() {
    const st = $('weather-status');
    if (st) st.classList.remove('weather-status--empty');
    setText('weather-status', 'Loading weather...');
    const section = $('weather-section');
    if (section) show(section);
    syncWeatherSunstrip();
}

function hideHourlyForecast() {
    const sec = $('weather-hourly-section');
    const scroll = $('weather-hourly-scroll');
    if (scroll) scroll.innerHTML = '';
    if (sec) hide(sec);
}

/**
 * Horizontal hourly strip (standalone weather page only — DOM optional).
 */
function renderHourlyForecast(payload) {
    const sec = $('weather-hourly-section');
    const scroll = $('weather-hourly-scroll');
    const titleEl = $('weather-hourly-title');
    if (!sec || !scroll) return;

    const hourly = payload && Array.isArray(payload.hourly) ? payload.hourly : [];
    if (!hourly.length) {
        hideHourlyForecast();
        return;
    }

    const loc = getDisplayLocation() || 'this location';
    if (titleEl) titleEl.textContent = 'Hourly forecast for ' + loc;

    scroll.innerHTML = hourly
        .map((h) => {
            const code = typeof h.weatherCode === 'number' ? h.weatherCode : -1;
            const isDay = h.isDay !== false && h.isDay !== 0;
            const icon = iconForCode(code, isDay);
            const temp =
                h.temperature != null && !Number.isNaN(Number(h.temperature))
                    ? Math.round(Number(h.temperature)) + '°'
                    : '—';
            const precipPct =
                h.precipitation != null && !Number.isNaN(Number(h.precipitation))
                    ? Math.round(Number(h.precipitation)) + '%'
                    : '—';
            const time = escapeHtml(h.time || '—');
            return (
                '<div class="weather-hourly-card" role="listitem">' +
                '<span class="weather-hourly-time">' +
                time +
                '</span>' +
                '<span class="weather-hourly-icon" aria-hidden="true">' +
                icon +
                '</span>' +
                '<span class="weather-hourly-temp">' +
                escapeHtml(temp) +
                '</span>' +
                '<span class="weather-hourly-precip">' +
                '<span class="weather-hourly-precip-arrow" aria-hidden="true">▲</span>' +
                '<span class="weather-hourly-precip-pct">' +
                escapeHtml(precipPct) +
                '</span>' +
                '</span>' +
                '</div>'
            );
        })
        .join('');

    show(sec);
}

function hideDaily14Forecast() {
    const sec = $('weather-daily-section');
    const grid = $('weather-daily-grid');
    if (grid) grid.innerHTML = '';
    if (sec) hide(sec);
}

/**
 * Two-column 14-day grid (weather page only — DOM optional).
 */
function renderDaily14Forecast(payload) {
    const sec = $('weather-daily-section');
    const grid = $('weather-daily-grid');
    const titleEl = $('weather-daily-title');
    if (!sec || !grid) return;

    const days = payload && Array.isArray(payload.daily14) ? payload.daily14 : [];
    if (!days.length) {
        hideDaily14Forecast();
        return;
    }

    const mid = Math.ceil(days.length / 2);
    const left = days.slice(0, mid);
    const right = days.slice(mid);

    const loc = getDisplayLocation() || 'this location';
    if (titleEl) titleEl.textContent = '14-day forecast for ' + loc;

    function rowHtml(d) {
        const code = typeof d.weatherCode === 'number' ? d.weatherCode : -1;
        const icon = iconForCode(code, true);
        const desc = escapeHtml(d.summary || '—');
        const date = escapeHtml(d.dateLabel || '—');
        const hi = d.max != null && !Number.isNaN(Number(d.max)) ? Math.round(Number(d.max)) : null;
        const lo = d.min != null && !Number.isNaN(Number(d.min)) ? Math.round(Number(d.min)) : null;
        const hiStr = hi != null ? hi + '°' : '—';
        const loStr = lo != null ? lo + '°' : '—';
        return (
            '<div class="weather-daily-row" role="listitem">' +
            '<span class="weather-daily-date">' +
            date +
            '</span>' +
            '<span class="weather-daily-mid">' +
            '<span class="weather-daily-icon" aria-hidden="true">' +
            icon +
            '</span>' +
            '<span class="weather-daily-desc">' +
            desc +
            '</span>' +
            '</span>' +
            '<span class="weather-daily-temps">' +
            '<span class="weather-daily-hi">' +
            escapeHtml(hiStr) +
            '</span>' +
            '<span class="weather-daily-sep"> / </span>' +
            '<span class="weather-daily-lo">' +
            escapeHtml(loStr) +
            '</span>' +
            '</span>' +
            '</div>'
        );
    }

    grid.innerHTML =
        '<div class="weather-daily-cols">' +
        '<div class="weather-daily-col" role="list">' +
        left.map(rowHtml).join('') +
        '</div>' +
        '<div class="weather-daily-divider" aria-hidden="true"></div>' +
        '<div class="weather-daily-col" role="list">' +
        right.map(rowHtml).join('') +
        '</div>' +
        '</div>';

    show(sec);
}

function hideForecastExtras() {
    const sec = $('weather-extras-section');
    const grid = $('weather-extras-grid');
    if (grid) grid.innerHTML = '';
    if (sec) hide(sec);
}

function marineExtrasHasValues(m) {
    return !!(
        m &&
        (m.waveHeightM != null ||
            m.waterTempC != null ||
            (m.swellDirection != null && String(m.swellDirection).trim() !== '') ||
            m.swellPeriodS != null)
    );
}

function hasForecastExtrasData(x) {
    if (!x || typeof x !== 'object') return false;
    const m = x.marine;
    const hasM = marineExtrasHasValues(m);
    const hasT = Array.isArray(x.tides) && x.tides.length > 0;
    const a = x.airQuality;
    const hasA =
        a &&
        (a.usAqi != null ||
            a.co != null ||
            a.o3 != null ||
            a.no2 != null ||
            a.so2 != null ||
            a.pm25 != null ||
            a.pm10 != null);
    return hasM || hasT || hasA;
}

function extrasDataRow(icon, label, displayValue) {
    const v =
        displayValue == null || displayValue === '' || displayValue === '—' ? '—' : String(displayValue);
    return (
        '<div class="weather-extras-row">' +
        '<span class="weather-extras-row-lead">' +
        '<span class="weather-extras-ico" aria-hidden="true">' +
        icon +
        '</span>' +
        '<span class="weather-extras-label">' +
        escapeHtml(label) +
        '</span>' +
        '</span>' +
        '<span class="weather-extras-val">' +
        escapeHtml(v) +
        '</span>' +
        '</div>'
    );
}

function renderForecastExtras(payload) {
    const sec = $('weather-extras-section');
    const grid = $('weather-extras-grid');
    const titleEl = $('weather-extras-title');
    if (!sec || !grid) return;

    const x = payload && payload.forecastExtras;
    if (!hasForecastExtrasData(x)) {
        hideForecastExtras();
        return;
    }

    const loc = getDisplayLocation() || 'this location';
    if (titleEl) titleEl.textContent = 'Additional forecasts for ' + loc;

    const m = x.marine || {};
    const marineNote =
        '<p class="weather-extras-col-note" role="status">' +
        'No marine data for this point. Open-Meteo only fills waves and sea temperature near the ocean (coastal locations usually work).' +
        '</p>';
    const marineHtml =
        '<h4 class="weather-extras-col-title">Marine forecast</h4>' +
        (marineExtrasHasValues(m)
            ? extrasDataRow(
                  '🌊',
                  'Sig. wave height',
                  m.waveHeightM != null ? m.waveHeightM + ' m' : '—'
              ) +
              extrasDataRow(
                  '🌡️',
                  'Water temp',
                  m.waterTempC != null ? m.waterTempC + '°C' : '—'
              ) +
              extrasDataRow('🧭', 'Swell direction', m.swellDirection || '—') +
              extrasDataRow(
                  '⏱️',
                  'Swell period',
                  m.swellPeriodS != null ? m.swellPeriodS + 's' : '—'
              )
            : marineNote);

    let tideHtml = '<h4 class="weather-extras-col-title">Tide forecast</h4>';
    const tides = Array.isArray(x.tides) ? x.tides : [];
    if (tides.length === 0) {
        tideHtml +=
            '<p class="weather-extras-col-note" role="status">' +
            'No sea-level series here, so highs and lows cannot be estimated. Try a port or coastal city.' +
            '</p>';
    } else {
        tides.forEach((t) => {
            const up = t.type === 'HIGH';
            const arrow = up ? '↑' : '↓';
            const h =
                t.heightM != null && !Number.isNaN(Number(t.heightM))
                    ? Number(t.heightM).toFixed(2)
                    : '—';
            const line =
                escapeHtml((t.type || '') + ' ') +
                escapeHtml(t.when || '') +
                ' (' +
                escapeHtml(h) +
                'm)';
            tideHtml +=
                '<div class="weather-extras-tide-row">' +
                '<span class="weather-extras-tide-arrow ' +
                (up ? 'weather-extras-tide-high' : 'weather-extras-tide-low') +
                '" aria-hidden="true">' +
                arrow +
                '</span>' +
                '<span class="weather-extras-tide-text">' +
                line +
                '</span>' +
                '</div>';
        });
    }

    const a = x.airQuality || {};
    let aqiStr = '—';
    if (a.usAqi != null && !Number.isNaN(Number(a.usAqi))) {
        aqiStr = String(Math.round(Number(a.usAqi)));
        if (a.usAqiCategory) {
            aqiStr += ' (' + a.usAqiCategory + ')';
        }
    }
    const airHtml =
        '<h4 class="weather-extras-col-title">Air quality</h4>' +
        extrasDataRow('✨', 'US EPA index', aqiStr) +
        extrasDataRow('◦', 'CO (carbon monoxide)', a.co != null ? a.co + ' μg/m³' : '—') +
        extrasDataRow('◦', 'O₃ (ozone)', a.o3 != null ? a.o3 + ' μg/m³' : '—') +
        extrasDataRow('◦', 'NO₂ (nitrogen dioxide)', a.no2 != null ? a.no2 + ' μg/m³' : '—') +
        extrasDataRow('◦', 'SO₂ (sulphur dioxide)', a.so2 != null ? a.so2 + ' μg/m³' : '—') +
        extrasDataRow('◦', 'PM2.5 (fine particles)', a.pm25 != null ? a.pm25 + ' μg/m³' : '—') +
        extrasDataRow('◦', 'PM10 (coarse particles)', a.pm10 != null ? a.pm10 + ' μg/m³' : '—');

    grid.innerHTML =
        '<div class="weather-extras-cols">' +
        '<div class="weather-extras-col" role="region" aria-label="Marine forecast">' +
        marineHtml +
        '</div>' +
        '<div class="weather-extras-divider" aria-hidden="true"></div>' +
        '<div class="weather-extras-col" role="region" aria-label="Tide forecast">' +
        tideHtml +
        '</div>' +
        '<div class="weather-extras-divider" aria-hidden="true"></div>' +
        '<div class="weather-extras-col" role="region" aria-label="Air quality">' +
        airHtml +
        '</div>' +
        '</div>';

    show(sec);
}

function fmtMinMaxLine(payload) {
    const parts = [];
    const hOk = payload.maxToday != null && !Number.isNaN(Number(payload.maxToday));
    const lOk = payload.minToday != null && !Number.isNaN(Number(payload.minToday));
    if (hOk || lOk) {
        parts.push('Today: high ' + fmtValue(payload.maxToday, '°') + ' · low ' + fmtValue(payload.minToday, '°'));
    }
    const rain = payload.rainChance;
    if (rain != null && !Number.isNaN(Number(rain))) {
        parts.push('Rain chance ' + Math.round(Number(rain)) + '%');
    }
    if (payload.timezone && String(payload.timezone).trim()) {
        parts.push(String(payload.timezone).replace(/_/g, ' '));
    }
    return parts.join(' · ');
}

function renderWeather(payload) {
    const st = $('weather-status');
    if (!payload) {
        hideHourlyForecast();
        hideDaily14Forecast();
        hideForecastExtras();
        if (st) st.classList.remove('weather-status--empty');
        setText('weather-status', 'Weather unavailable for this location right now.');
        return;
    }
    const loc = getDisplayLocation() || 'this place';
    setText('weather-location', loc);

    const feels = fmtValue(payload.apparentTemperature, '°C');
    const summary = payload.summary || 'Weather update';
    setText('weather-subline', 'Feels like ' + feels + '. ' + summary + '.');

    setText('weather-status', '');
    if (st) st.classList.add('weather-status--empty');

    setText('weather-icon', iconForCode(payload.weatherCode, payload.isDay));
    setText('weather-temp', fmtValue(payload.temperature, '°C'));

    setText('weather-wind-line', fmtWind(payload));
    setText('weather-humidity-line', fmtHumidityLine(payload));
    setText('weather-pressure-line', fmtPressure(payload));
    setText('weather-visibility-line', fmtVisibility(payload));
    setText('weather-uv-line', fmtUv(payload));
    setText('weather-dew-line', fmtDew(payload));

    setText('weather-minmax', fmtMinMaxLine(payload));

    renderHourlyForecast(payload);
    renderDaily14Forecast(payload);
    renderForecastExtras(payload);
}

export async function refreshWeatherWidget() {
    const myToken = ++requestToken;
    const section = $('weather-section');
    if (!section) return;
    const st = $('weather-status');
    if (st) st.classList.remove('weather-status--empty');
    showWeatherLoading();
    try {
        const data = await fetchWeatherForCurrentSelection();
        if (myToken !== requestToken) return;
        renderWeather(data);
        if (data) void fillSunriseSunsetRow(myToken);
        syncWeatherSunstrip();
    } catch (_) {
        if (myToken !== requestToken) return;
        hideHourlyForecast();
        hideDaily14Forecast();
        hideForecastExtras();
        setText('weather-status', 'Could not fetch weather right now.');
        if (st) st.classList.remove('weather-status--empty');
        syncWeatherSunstrip();
    }
}

export function hideWeatherWidget() {
    hide($('weather-section'));
    hideHourlyForecast();
    hideDaily14Forecast();
    hideForecastExtras();
    syncWeatherSunstrip();
}
