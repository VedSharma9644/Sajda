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
import { fetchPrayerTimes } from './api.js';
import { updateMethodRecommendation } from './recommendations.js';
import { runCompareWithKarachi } from './comparison.js';
// Query string busts cache: only app.js had ?v= in HTML, so an old cached location.js could lack exports.
import { useLocation, useCity, bindLocationUI, applyCityFromUrlOnStartup } from './location.js?v=6';

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
    applyCityFromUrlOnStartup();

    const btnWhyMethod = $('btn-why-method');
    const whyMethodContent = $('why-method-content');
    if (btnWhyMethod && whyMethodContent) {
        btnWhyMethod.addEventListener('click', () => {
            const isNowHidden = whyMethodContent.classList.toggle('hidden');
            btnWhyMethod.setAttribute('aria-expanded', !isNowHidden);
        });
    }
}

init();
