/**
 * e-Sajda – Backend API layer (`api.php` + optional direct Aladhan fallback)
 *
 * Builds query strings for our PHP proxy, which then talks to Aladhan. If the
 * server returns 502/504, we retry a few times, then try Aladhan directly from
 * the browser (CORS) as a last resort.
 */

import { state } from './state.js';
import { $ } from './dom.js';
import { getTimezone, getTodayDate } from './utils.js';
import { showLoading, onApiResponse } from './render.js?v=25';
import { esajdaLog } from './debug-log.js?v=21';

function readAllMethodIdsFromDom() {
    const sel = $('select-method');
    if (!sel) return [];
    const ids = [];
    for (const opt of Array.from(sel.querySelectorAll('option'))) {
        const v = String(opt.value || '').trim();
        if (v && /^\d+$/.test(v)) ids.push(v);
    }
    // de-dupe, stable order
    return Array.from(new Set(ids));
}

function prefetchSignatureFromParams(params) {
    // Signature for "same city/date/view" regardless of selected method.
    const p = new URLSearchParams(params.toString());
    p.delete('method');
    // Keep it short but stable; SHA1 not needed here.
    return p.toString();
}

function shouldPrefetchNow(signature) {
    const key = 'esajda.prefetch.methods.v1:' + signature;
    const now = Date.now();
    try {
        const raw = localStorage.getItem(key);
        const last = raw ? Number(raw) : 0;
        // Re-prefetch at most once per 24h for the same signature.
        if (last && Number.isFinite(last) && now - last < 24 * 60 * 60 * 1000) return false;
        localStorage.setItem(key, String(now));
        return true;
    } catch (_) {
        // If storage is unavailable, still prefetch once per session.
        return true;
    }
}

function prefetchOtherMethodsInBackground(baseParams) {
    try {
        const action = baseParams.get('action') || 'today';
        if (action !== 'today') return; // month prefetch is heavy; can add later if needed

        const signature = prefetchSignatureFromParams(baseParams);
        if (!shouldPrefetchNow(signature)) return;

        const all = readAllMethodIdsFromDom();
        const current = String(baseParams.get('method') || '');
        const others = all.filter((m) => m !== current);
        if (!others.length) return;

        // Limit to avoid hammering upstream. Order: nearby/common methods first.
        const maxPrefetch = 8;
        const list = others.slice(0, maxPrefetch);

        let idx = 0;
        const concurrency = 2;
        let inFlight = 0;

        function next() {
            while (inFlight < concurrency && idx < list.length) {
                const method = list[idx++];
                const p = new URLSearchParams(baseParams.toString());
                p.set('method', method);
                const url = '/api.php?' + p.toString();
                inFlight += 1;
                esajdaLog('api', 'prefetch /api.php (method cache warm)', { method, url });
                fetch(url, { method: 'GET' })
                    .then(() => {
                        // Intentionally ignore body; server cache is what we care about.
                    })
                    .catch(() => {
                        /* ignore prefetch failures */
                    })
                    .finally(() => {
                        inFlight -= 1;
                        next();
                    });
            }
        }

        next();
    } catch (_) {
        // Never let prefetch break primary flow.
    }
}

/** Updates the small status line under the location controls (success / error messages). */
function setStatus(text, type) {
    const locationStatus = $('location-status');
    if (!locationStatus) return;
    locationStatus.textContent = text;
    locationStatus.className = 'status' + (type ? ' ' + type : '');
}

/**
 * Collects everything the PHP script needs: method, date or month/year, and either
 * lat/lng or a typed address. Timezone is only sent when using “Use my location”
 * so city search uses the place’s own local time.
 */
export function buildParams() {
    const params = new URLSearchParams();
    const selectMethod = $('select-method');
    const viewMode = $('view-mode');
    const selectMonth = $('select-month');
    const selectYear = $('select-year');
    params.set('method', selectMethod ? selectMethod.value : '4');
    if (state.useCoordinates) {
        params.set('timezone', getTimezone());
    }
    if (viewMode && viewMode.value === 'month') {
        params.set('action', 'month');
        params.set('month', selectMonth ? selectMonth.value : '');
        params.set('year', selectYear ? selectYear.value : '');
    } else {
        params.set('action', 'today');
        params.set('date', getTodayDate());
    }
    if (state.useCoordinates && state.currentCoords) {
        params.set('latitude', state.currentCoords.latitude);
        params.set('longitude', state.currentCoords.longitude);
    } else if (state.currentAddress) {
        params.set('address', state.currentAddress);
    } else {
        return null;
    }
    return params;
}

/**
 * Same parameters as `buildParams`, but as a full Aladhan REST URL — used only
 * when `api.php` fails and we need the direct-fetch fallback.
 */
export function buildAladhanUrl() {
    const base = 'https://api.aladhan.com/v1';
    const selectMethod = $('select-method');
    const viewMode = $('view-mode');
    const selectMonth = $('select-month');
    const selectYear = $('select-year');
    const method = selectMethod ? selectMethod.value : '4';
    const tz = state.useCoordinates ? getTimezone() : '';
    const date = getTodayDate();
    const q = (p) => (p ? '&' + p : '');
    if (viewMode && viewMode.value === 'month') {
        const month = selectMonth ? selectMonth.value : '';
        const year = selectYear ? selectYear.value : '';
        if (state.useCoordinates && state.currentCoords) {
            return base + '/calendar?latitude=' + encodeURIComponent(state.currentCoords.latitude) +
                '&longitude=' + encodeURIComponent(state.currentCoords.longitude) +
                '&method=' + method + '&month=' + month + '&year=' + year + q(tz && ('timezonestring=' + encodeURIComponent(tz)));
        }
        return base + '/calendarByAddress?address=' + encodeURIComponent(state.currentAddress) +
            '&method=' + method + '&month=' + month + '&year=' + year + q(tz && ('timezonestring=' + encodeURIComponent(tz)));
    }
    if (state.useCoordinates && state.currentCoords) {
        return base + '/timings/' + date + '?latitude=' + encodeURIComponent(state.currentCoords.latitude) +
            '&longitude=' + encodeURIComponent(state.currentCoords.longitude) + '&method=' + method +
            q(tz && ('timezonestring=' + encodeURIComponent(tz)));
    }
    return base + '/timingsByAddress/' + date + '?address=' + encodeURIComponent(state.currentAddress) +
        '&method=' + method + q(tz && ('timezonestring=' + encodeURIComponent(tz)));
}

/**
 * Main fetch: calls `api.php?...`, shows loading state, then passes JSON to
 * `onApiResponse`. Retries on gateway errors; may call `tryDirectAladhan` as fallback.
 */
export function fetchPrayerTimes() {
    const params = buildParams();
    const resultsSection = $('results-section');
    if (!params) {
        setStatus('Set location (use my location or enter city) first.', 'error');
        return;
    }
    const isUpdating = resultsSection && !resultsSection.classList.contains('hidden');
    showLoading(true, isUpdating);
    setStatus('');

    const url = '/api.php?' + params.toString();
    let attempt = 0;
    const maxAttempts = 3;

    /** Single attempt + retry logic for the PHP endpoint. */
    function doFetch() {
        attempt += 1;
        esajdaLog('api', 'GET /api.php (prayer times)', { attempt, url });
        fetch(url, { method: 'GET' })
            .then((res) => res.json().catch(() => ({ success: false, error: 'Invalid response from server.' })).then((json) => ({ res, json })))
            .then(({ res, json }) => {
                if (res.ok) {
                    const cacheHdr = res.headers.get('X-Esajda-Cache');
                    esajdaLog('api', '/api.php OK', {
                        status: res.status,
                        serverCache: cacheHdr || 'unknown (hit=SQLite, miss=Aladhan+fresh, bypass=no DB)'
                    });
                    showLoading(false);
                    onApiResponse(json);
                    // Warm method cache in the background so switching methods is instant.
                    prefetchOtherMethodsInBackground(params);
                    return;
                }
                if ((res.status === 502 || res.status === 504) && attempt < maxAttempts) {
                    setTimeout(doFetch, 1000);
                    return;
                }
                if ((res.status === 502 || res.status === 504) && attempt >= maxAttempts) {
                    tryDirectAladhan();
                    return;
                }
                showLoading(false);
                onApiResponse(json);
            })
            .catch(() => {
                if (attempt < maxAttempts) {
                    setTimeout(doFetch, 1000);
                } else {
                    tryDirectAladhan();
                }
            });
    }

    /** Last resort: browser → Aladhan API (same query shape as PHP would use). */
    function tryDirectAladhan() {
        const directUrl = buildAladhanUrl();
        esajdaLog('api', 'GET Aladhan direct (fallback)', { url: directUrl });
        fetch(directUrl, { method: 'GET' })
            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
            .then((result) => {
                showLoading(false);
                if (result.ok && result.data && result.data.code === 200) {
                    onApiResponse({ success: true, data: result.data.data, meta: result.data.meta || null });
                } else {
                    onApiResponse({ success: false, error: 'Could not load prayer times. Please try again.' });
                }
            })
            .catch(() => {
                showLoading(false);
                onApiResponse({ success: false, error: 'Could not reach prayer times service. Please check your connection and try again.' });
            });
    }

    doFetch();
}

/**
 * Same as `buildParams` but forces calculation method `1` (Karachi) for the
 * “Compare with Karachi” feature.
 */
export function buildComparisonParams() {
    const params = buildParams();
    if (!params) return null;
    params.set('method', '1');
    return params;
}
