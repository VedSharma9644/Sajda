/**
 * e-Sajda – Main entry (app bootstrap)
 *
 * This file is the only script loaded from `index.html`. It wires all buttons and
 * dropdowns to the rest of the modules. Flow: user picks location → `api.js`
 * fetches times → `render.js` shows results.
 */

import { MONTHS } from './config.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { fetchPrayerTimes } from './api.js?v=21';
import { updateMethodRecommendation } from './recommendations.js';
import { runCompareWithKarachi } from './comparison.js';
import { useLocation, useCity, bindLocationUI, applyCityFromUrlOnStartup } from './location.js?v=17';
import { clearLocationCache } from './location-cache.js';
import { startLocalClockWidget } from './clock-widget.js';
import { esajdaLog } from './debug-log.js?v=21';

const FIRST_VISIT_LOCATION_PROMPT_KEY = 'esajda.location.prompted.v1';

/** Fills the month/year dropdowns for “This month” view with sensible defaults. */
function buildMonthOptions() {
    const selectMonth = $('select-month');
    const selectYear = $('select-year');
    if (!selectMonth || !selectYear) return;
    const now = new Date();
    selectMonth.innerHTML = MONTHS.map((name, i) =>
        '<option value="' + (i + 1) + '"' + (i === now.getMonth() ? ' selected' : '') + '>' + name + '</option>'
    ).join('');
    const year = now.getFullYear();
    selectYear.innerHTML = [year - 1, year, year + 1].map((y) =>
        '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>'
    ).join('');
}

/** Shows or hides the extra month/year controls when “This month” is selected. */
function showMonthPicker(visible) {
    const monthPicker = $('month-picker');
    if (visible) show(monthPicker);
    else hide(monthPicker);
}

/**
 * One-time setup: attach listeners, build dropdowns, show initial recommendation text.
 */
function init() {
    const viewMode = $('view-mode');
    const selectMonth = $('select-month');
    const selectYear = $('select-year');

    viewMode.addEventListener('change', () => {
        showMonthPicker(viewMode.value === 'month');
        if (state.currentCoords || state.currentAddress) fetchPrayerTimes();
    });

    bindLocationUI();

    const btnCompare = $('btn-compare-karachi');
    if (btnCompare) btnCompare.addEventListener('click', runCompareWithKarachi);

    $('select-method').addEventListener('change', () => {
        if (state.currentCoords || state.currentAddress) fetchPrayerTimes();
    });

    selectMonth.addEventListener('change', () => {
        if (state.currentCoords || state.currentAddress) fetchPrayerTimes();
    });
    selectYear.addEventListener('change', () => {
        if (state.currentCoords || state.currentAddress) fetchPrayerTimes();
    });

    buildMonthOptions();
    showMonthPicker(viewMode && viewMode.value === 'month');
    updateMethodRecommendation();
    startLocalClockWidget();
    applyCityFromUrlOnStartup();
    maybePromptLocationOnFirstVisit();

    const btnWhyMethod = $('btn-why-method');
    const whyMethodContent = $('why-method-content');
    if (btnWhyMethod && whyMethodContent) {
        btnWhyMethod.addEventListener('click', () => {
            const isNowHidden = whyMethodContent.classList.toggle('hidden');
            btnWhyMethod.setAttribute('aria-expanded', !isNowHidden);
        });
    }

    // Dev helper: run `window.esajdaClearLocationCache()` in console.
    window.esajdaClearLocationCache = clearLocationCache;
    // Dev helpers: mute/unmute `[e-Sajda]` browser console API logs (no reload needed).
    window.esajdaDebugOn = () => {
        try {
            localStorage.removeItem('esajdaDebug');
        } catch (_) {
            /* ignore */
        }
        window.__ESAJDA_DEBUG__ = true;
        esajdaLog('debug', 'logging enabled');
    };
    window.esajdaDebugOff = () => {
        try {
            localStorage.setItem('esajdaDebug', '0');
        } catch (_) {
            /* ignore */
        }
        window.__ESAJDA_DEBUG__ = false;
        console.log('[e-Sajda] Console API logging disabled (browser only).');
    };
    // Dev helper: run `window.esajdaResetLocationPrompt()` to test first-visit prompt again.
    window.esajdaResetLocationPrompt = () => {
        try {
            localStorage.removeItem(FIRST_VISIT_LOCATION_PROMPT_KEY);
        } catch (_) {
            /* ignore storage errors */
        }
    };
}

/**
 * One-time permission ask for homepage visitors:
 * - If user has not searched a city yet, trigger browser geolocation prompt once.
 * - If they deny, we keep local clock and do not ask automatically again.
 */
function maybePromptLocationOnFirstVisit() {
    if (state.currentCoords || state.currentAddress) return;
    let alreadyPrompted = false;
    try {
        alreadyPrompted = localStorage.getItem(FIRST_VISIT_LOCATION_PROMPT_KEY) === '1';
    } catch (_) {
        alreadyPrompted = false;
    }
    if (alreadyPrompted) return;
    try {
        localStorage.setItem(FIRST_VISIT_LOCATION_PROMPT_KEY, '1');
    } catch (_) {
        /* ignore storage errors */
    }
    setTimeout(() => {
        if (!state.currentCoords && !state.currentAddress) useLocation();
    }, 400);
}

init();
