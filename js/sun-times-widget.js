/**
 * e-Sajda – Sunrise & sunset list (today view only)
 */

import { $, show, hide, syncWeatherSunstrip } from './dom.js';
import { getDisplayLocation, escapeHtml } from './utils.js';
import { buildSunTimesRows, hasSunTimesData } from './sun-times.js';

function renderRows(listEl, rows) {
    if (!listEl) return;
    listEl.innerHTML = rows
        .map((row) => {
            const titleAttr = row.title ? ' title="' + escapeHtml(row.title) + '"' : '';
            const prefix = row.valuePrefix ? escapeHtml(row.valuePrefix) : '';
            return (
                '<li class="sun-times-row">' +
                '<span class="sun-times-icon" aria-hidden="true">' +
                row.icon +
                '</span>' +
                '<span class="sun-times-label"' +
                titleAttr +
                '>' +
                escapeHtml(row.label) +
                '</span>' +
                '<span class="sun-times-value">' +
                prefix +
                escapeHtml(row.value) +
                '</span>' +
                '</li>'
            );
        })
        .join('');
}

/**
 * @param {Record<string, string>|null|undefined} timings - Aladhan `data.timings`
 * @param {string} [locationLabel] - place name in heading
 */
export function renderSunTimesWidget(timings, locationLabel) {
    const section = $('sun-times-section');
    const placeEl = $('sun-times-place');
    const listEl = $('sun-times-list');
    if (!section || !placeEl || !listEl) return;

    if (!hasSunTimesData(timings)) {
        hide(section);
        syncWeatherSunstrip();
        return;
    }

    const label = (locationLabel || getDisplayLocation() || 'your location').trim();
    placeEl.textContent = label;

    const rows = buildSunTimesRows(timings);
    renderRows(listEl, rows);
    show(section);
    syncWeatherSunstrip();
}

export function hideSunTimesWidget() {
    const section = $('sun-times-section');
    if (section) hide(section);
    syncWeatherSunstrip();
}
