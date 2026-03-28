/**
 * e-Sajda – Compare with Karachi method
 *
 * Fetches the same day again with method id `1` (Karachi) and shows a side-by-side
 * table with minute differences — useful to see how much another method shifts times.
 */

import { PRAYERS } from './config.js';
import { state } from './state.js';
import { $, show } from './dom.js';
import { timeToMinutes } from './utils.js';
import { setStatus } from './render.js?v=21';
import { buildComparisonParams } from './api.js';
import { esajdaLog } from './debug-log.js?v=21';

/** Fills the comparison table and shows the panel. `current` is the user’s method; `karachi` is method 1. */
export function renderComparison(current, karachi) {
    const panel = $('comparison-panel');
    const tbody = $('comparison-table-body');
    const colCurrent = $('col-current');
    if (!panel || !tbody) return;

    const currentName = (current && current.meta && current.meta.method && current.meta.method.name) ? current.meta.method.name : 'Current method';
    if (colCurrent) colCurrent.textContent = currentName;

    const currentTimings = (current && current.timings) ? current.timings : {};
    const karachiTimings = (karachi && karachi.timings) ? karachi.timings : {};

    tbody.innerHTML = PRAYERS.map((name) => {
        const t1 = currentTimings[name] || '--:--';
        const t2 = karachiTimings[name] || '--:--';
        const m1 = timeToMinutes(t1);
        const m2 = timeToMinutes(t2);
        const diff = (m1 !== null && m2 !== null) ? (m2 - m1) : null;
        const diffClass = diff === 0 ? 'diff-zero' : 'diff-positive';
        const diffStr = diff !== null ? (diff > 0 ? '+' + diff : String(diff)) + ' min' : '—';
        return '<tr><td>' + name + '</td><td>' + t1 + '</td><td>' + t2 + '</td><td class="' + diffClass + '">' + diffStr + '</td></tr>';
    }).join('');

    show(panel);
}

/** Button handler: loads Karachi times via `api.php` and passes them to `renderComparison`. */
export function runCompareWithKarachi() {
    if (!state.lastTodayData) return;
    const params = buildComparisonParams();
    if (!params) return;

    const btn = $('btn-compare-karachi');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading…';
    }

    const url = '/api.php?' + params.toString();
    esajdaLog('api', 'GET /api.php (compare Karachi)', { url });
    fetch(url, { method: 'GET' })
        .then((res) =>
            res.json().then((json) => ({
                json,
                serverCache: res.headers.get('X-Esajda-Cache'),
                ok: res.ok,
                status: res.status
            }))
        )
        .then(({ json, serverCache, ok, status }) => {
            esajdaLog('api', '/api.php (compare) response', { status, serverCache: serverCache || 'unknown' });
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Compare with Karachi method';
            }
            if (ok && json.success && json.data) {
                renderComparison(state.lastTodayData, json.data);
            } else {
                setStatus(json.error || 'Could not load Karachi method times.', 'error');
            }
        })
        .catch(() => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Compare with Karachi method';
            }
            setStatus('Network error. Could not load comparison.', 'error');
        });
}
