/**
 * e-Sajda — yearly sun chart (entry)
 *
 * Wires DOM, loader, coords from app state, and chart modules in this folder.
 */

import { resolveSelectedCoords } from '../js/weather-api.js?v=25';
import { state } from '../js/state.js';
import { buildYearlySunSeries } from './solar-year.js';
import { renderYearlySunChart, destroyYearlySunChart } from './chart-renderer.js';
import { refreshDailySunBar, hideDailySunBar } from './daily-sun-bar.js';
import { refreshDailySunProgression, hideDailySunProgression } from './daily-sun-progression.js';

const SECTION_ID = 'yearly-sun-chart-section';
const LOADER_ID = 'sunGraphLoader';
const CANVAS_ID = 'yearlySunChart';

function $(id) {
    return document.getElementById(id);
}

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function showLoader(show) {
    const el = $(LOADER_ID);
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

function showSection(show) {
    const el = $(SECTION_ID);
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

let loadToken = 0;

/**
 * Build chart for current year and selection. No-op if no coords.
 */
export async function refreshYearlySunChart() {
    const section = $(SECTION_ID);
    const canvas = $(CANVAS_ID);
    if (!section || !canvas) return;

    const coords = await resolveSelectedCoords();
    if (!coords) {
        destroyYearlySunChart();
        showSection(false);
        return;
    }

    const year = new Date().getFullYear();
    const my = ++loadToken;
    showSection(true);
    showLoader(true);

    try {
        const tz = state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.timezone
            ? state.lastTodayData.meta.timezone
            : null;
        const series = await buildYearlySunSeries(year, coords.latitude, coords.longitude, tz);
        if (my !== loadToken) return;
        await renderYearlySunChart(canvas, series, isDarkTheme());
        // Daily sun bar uses the same cached series; refresh after series is available.
        void refreshDailySunBar();
        void refreshDailySunProgression();
    } catch (_) {
        if (my !== loadToken) return;
        destroyYearlySunChart();
        showSection(false);
    } finally {
        if (my === loadToken) showLoader(false);
    }
}

export function hideYearlySunChart() {
    loadToken += 1;
    destroyYearlySunChart();
    hideDailySunBar();
    hideDailySunProgression();
    showLoader(false);
    showSection(false);
}

/**
 * After light/dark toggle: redraw chart colors without full-page loader flash.
 */
export async function restyleYearlySunChartForTheme() {
    const section = $(SECTION_ID);
    const canvas = $(CANVAS_ID);
    if (!section || !canvas || section.classList.contains('hidden')) return;
    const coords = await resolveSelectedCoords();
    if (!coords) return;
    const year = new Date().getFullYear();
    try {
        const tz = state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.timezone
            ? state.lastTodayData.meta.timezone
            : null;
        const series = await buildYearlySunSeries(year, coords.latitude, coords.longitude, tz);
        await renderYearlySunChart(canvas, series, isDarkTheme());
    } catch (_) {
        /* ignore */
    }
}
