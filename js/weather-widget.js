/**
 * e-Sajda – Weather widget UI
 *
 * Uses `weather-api.js` and updates the home weather card.
 * The widget is intentionally independent from prayer rendering internals.
 */

import { $, show, hide } from './dom.js';
import { getDisplayLocation } from './utils.js';
import { fetchWeatherForCurrentSelection } from './weather-api.js?v=21';

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

function showWeatherLoading() {
    setText('weather-status', 'Loading weather...');
    const section = $('weather-section');
    if (section) show(section);
}

function renderWeather(payload) {
    if (!payload) {
        setText('weather-status', 'Weather unavailable for this location right now.');
        return;
    }
    setText('weather-location', getDisplayLocation());
    setText('weather-status', payload.summary + ' · ' + (payload.timezone || 'Local time'));
    setText('weather-icon', iconForCode(payload.weatherCode, payload.isDay));
    setText('weather-temp', fmtValue(payload.temperature, '°C'));
    setText('weather-feels', fmtValue(payload.apparentTemperature, '°C'));
    setText('weather-humidity', fmtValue(payload.humidity, '%'));
    setText('weather-wind', fmtValue(payload.windSpeed, ' km/h'));
    setText('weather-minmax', 'H: ' + fmtValue(payload.maxToday, '°') + ' · L: ' + fmtValue(payload.minToday, '°'));
    setText('weather-rain', fmtValue(payload.rainChance, '%'));
}

export async function refreshWeatherWidget() {
    const myToken = ++requestToken;
    const section = $('weather-section');
    if (!section) return;
    showWeatherLoading();
    try {
        const data = await fetchWeatherForCurrentSelection();
        if (myToken !== requestToken) return; // ignore stale responses
        renderWeather(data);
    } catch (_) {
        if (myToken !== requestToken) return;
        setText('weather-status', 'Could not fetch weather right now.');
    }
}

export function hideWeatherWidget() {
    hide($('weather-section'));
}
