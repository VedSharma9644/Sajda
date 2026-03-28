/**
 * e-Sajda – Render results and UI feedback
 *
 * Turns successful API JSON into the “today” list or “month” table, updates
 * loading/error visibility, and drives the next-prayer banner via `next-prayer.js`.
 */

import { PRAYERS, MONTHS } from './config.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { getDisplayLocation } from './utils.js';
import { updateMethodRecommendation } from './recommendations.js';
import { updateNextPrayerUI, startNextPrayerTick, stopNextPrayerTick } from './next-prayer.js';
import { buildPrayerUrl, readPrayerFromUrl } from './location-routing.js';
import { renderPrayerDetailPage, hidePrayerDetailPage, isPrayerDetailRoute } from './prayer-detail.js';
import { startClockWidget, startLocalClockWidget } from './clock-widget.js';
import { refreshWeatherWidget, hideWeatherWidget } from './weather-widget.js?v=21';

/** Status line under location controls (`success` / `error` add CSS classes). */
export function setStatus(text, type) {
    const locationStatus = $('location-status');
    if (!locationStatus) return;
    locationStatus.textContent = text;
    locationStatus.className = 'status' + (type ? ' ' + type : '');
}

/** Sets the “Location:” / “Method:” lines above the prayer results. */
export function setResultsContext(locationText, methodText) {
    const locEl = $('results-location');
    const methodEl = $('results-method');
    if (locEl) locEl.innerHTML = locationText ? '<strong>Location:</strong> ' + locationText : '';
    if (methodEl) methodEl.innerHTML = methodText ? '<strong>Method:</strong> ' + methodText : '';
}

/** Full-screen loading overlay; `isUpdating` uses a shorter message for refetches. */
export function showLoading(showIt, isUpdating) {
    const msgEl = $('loading-message');
    const loading = $('loading');
    const resultsSection = $('results-section');
    const errorMessage = $('error-message');
    if (showIt) {
        if (msgEl) msgEl.textContent = isUpdating ? 'Updating…' : 'Loading prayer times…';
        show(loading);
        hide(resultsSection);
        hide(errorMessage);
    } else {
        hide(loading);
    }
}

/** Shows the error box and hides the today/month content so the message is visible. */
export function showError(msg) {
    const errorMessage = $('error-message');
    const resultsSection = $('results-section');
    const todayTimings = $('today-timings');
    const monthTimings = $('month-timings');
    if (!errorMessage) return;
    errorMessage.textContent = msg;
    show(errorMessage);
    show(resultsSection);
    hide(todayTimings);
    hide(monthTimings);
    hidePrayerDetailPage();
    startLocalClockWidget();
    hideWeatherWidget();
}

/** Hides the global error message element. */
export function clearError() {
    hide($('error-message'));
}

/** Single-day view: prayer list, meta line, India/Google tip, next-prayer UI. */
export function renderToday(data) {
    const timings = data?.timings;
    const date = data?.date;
    const meta = data?.meta;
    const resultsTitle = $('results-title');
    const resultsMeta = $('results-meta');
    const prayerList = $('prayer-list');
    const resultsSection = $('results-section');
    const todayTimings = $('today-timings');
    const monthTimings = $('month-timings');

    if (!timings) {
        showError('No prayer times in response.');
        return;
    }

    state.lastTodayData = { timings, meta };

    resultsTitle.textContent = 'Prayer times';
    const dateReadable = date && date.readable ? date.readable : '';
    const tz = meta && meta.timezone ? meta.timezone : '';
    resultsMeta.textContent = dateReadable + (tz ? ' · Times in: ' + tz : '');

    setResultsContext(getDisplayLocation(), meta && meta.method && meta.method.name ? meta.method.name : '—');
    if (tz) startClockWidget(getDisplayLocation(), tz);
    else startLocalClockWidget();
    refreshWeatherWidget();
    updateMethodRecommendation();

    const methodTip = $('results-method-tip');
    if (methodTip) {
        const isIndia = (tz && (tz.indexOf('Calcutta') !== -1 || tz.indexOf('Kolkata') !== -1)) ||
            (state.currentAddress && state.currentAddress.toLowerCase().indexOf('india') !== -1);
        const methodId = $('select-method') ? $('select-method').value : '';
        if (isIndia && methodId !== '1') {
            methodTip.textContent = 'To match Google\u2019s times in India, switch to \u201cUniversity of Islamic Sciences, Karachi\u201d above.';
            show(methodTip);
        } else {
            hide(methodTip);
        }
    }

    const routePrayer = readPrayerFromUrl();
    prayerList.innerHTML = PRAYERS.map((name) => {
        const time = timings[name] || '--:--';
        const href = buildPrayerUrl(state.currentAddress || getDisplayLocation(), name);
        const activeClass = routePrayer === name.toLowerCase() ? ' prayer-link-active' : '';
        return '<li data-prayer="' + name + '"><a class="prayer-link' + activeClass + '" href="' + href + '"><span class="name">' + name + '</span><span class="time">' + time + '</span></a></li>';
    }).join('');

    updateNextPrayerUI();
    startNextPrayerTick();

    show(resultsSection);
    show(todayTimings);
    hide(monthTimings);
    hide($('comparison-panel'));
    clearError();
    if (isPrayerDetailRoute()) renderPrayerDetailPage(data);
    else hidePrayerDetailPage();
}

/** Calendar month: builds a table of rows; stops the next-prayer tick (not meaningful for a month). */
export function renderMonth(data) {
    const list = data?.data || data;
    let arr = [];
    if (Array.isArray(list)) {
        arr = list;
    } else if (list && typeof list === 'object') {
        arr = Object.keys(list)
            .filter((k) => /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => list[k]);
    }

    const resultsSection = $('results-section');
    const resultsTitle = $('results-title');
    const resultsMeta = $('results-meta');
    const prayerTableBody = $('prayer-table-body');
    const todayTimings = $('today-timings');
    const monthTimings = $('month-timings');

    if (!arr.length) {
        showError('No calendar data in response.');
        return;
    }

    const first = arr[0];
    const meta = (first && first.meta) || (data && data.meta);
    const monthNum = first && first.date && first.date.gregorian && first.date.gregorian.month ? first.date.gregorian.month.number : null;
    const yearNum = first && first.date && first.date.gregorian ? first.date.gregorian.year : '';
    const monthName = first && first.date && first.date.gregorian && first.date.gregorian.month ? first.date.gregorian.month.en : MONTHS[(monthNum || 1) - 1];
    resultsTitle.textContent = 'Prayer times – ' + monthName + ' ' + yearNum;
    resultsMeta.textContent = meta && meta.timezone ? 'Times in: ' + meta.timezone : '';

    setResultsContext(getDisplayLocation(), meta && meta.method && meta.method.name ? meta.method.name : '—');
    if (meta && meta.timezone) startClockWidget(getDisplayLocation(), meta.timezone);
    else startLocalClockWidget();
    refreshWeatherWidget();
    updateMethodRecommendation();

    const rows = arr.map((day) => {
        const d = day.date?.gregorian;
        const t = day.timings || {};
        const dateStr = d ? `${d.day} ${d.month?.en || ''} ${d.year}` : '';
        return `<tr>
            <td>${dateStr}</td>
            <td>${t.Fajr || '--'}</td>
            <td>${t.Dhuhr || '--'}</td>
            <td>${t.Asr || '--'}</td>
            <td>${t.Maghrib || '--'}</td>
            <td>${t.Isha || '--'}</td>
        </tr>`;
    }).join('');

    prayerTableBody.innerHTML = rows;

    stopNextPrayerTick();

    show(resultsSection);
    hide(todayTimings);
    show(monthTimings);
    clearError();
    hidePrayerDetailPage();
}

/**
 * Central dispatch after `fetch` resolves: branches on view mode and passes payload
 * to `renderToday` or `renderMonth`, or shows an error if `success` is false.
 */
export function onApiResponse(json) {
    const viewMode = $('view-mode');
    if (!json.success) {
        showError(json.error || 'Request failed.');
        return;
    }
    const raw = json.data;
    if (viewMode && viewMode.value === 'month') {
        renderMonth(raw);
    } else {
        renderToday(raw);
    }
}
