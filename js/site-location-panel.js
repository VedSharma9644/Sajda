/**
 * Same city search UI as the home page, on standalone tool/prayer URLs.
 * Full navigation after pick (replaces the old header “Go” bar).
 */
import { pathPrefixFromAddress, readCityFromUrl } from './location-routing.js';
import { bindLocationUI } from './location.js?v=25';
import { prefetchThenAssign } from './time-prefetch.js?v=3';

const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function methodQueryPreserve() {
    try {
        if (window.location.pathname.toLowerCase().indexOf('prayer-times') === -1) return '';
        const m = new URLSearchParams(window.location.search).get('method');
        if (m == null || m === '') return '';
        const n = parseInt(m, 10);
        if (!Number.isFinite(n) || String(n) === '4') return '';
        return '?method=' + encodeURIComponent(String(n));
    } catch (_) {
        return '';
    }
}

function navigateTargetForAddress(address) {
    const prefix = pathPrefixFromAddress(address);
    const q = methodQueryPreserve();
    if (!prefix) {
        window.location.assign('/' + q);
        return;
    }
    const raw = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const parts = raw.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1].toLowerCase() : '';

    if (last === 'time' || last === 'times') {
        void prefetchThenAssign(address, '/' + prefix + '/time' + q);
        return;
    }
    if (last === 'sun') {
        window.location.assign('/' + prefix + '/sun' + q);
        return;
    }
    if (last === 'weather') {
        window.location.assign('/' + prefix + '/weather' + q);
        return;
    }
    if (last === 'prayer-times') {
        window.location.assign('/' + prefix + '/prayer-times' + q);
        return;
    }
    const i = parts.map((p) => p.toLowerCase()).indexOf('prayer-times');
    if (i !== -1 && i < parts.length - 1) {
        const pk = parts[i + 1].toLowerCase();
        if (PRAYER_KEYS.indexOf(pk) !== -1) {
            window.location.assign('/' + prefix + '/prayer-times/' + pk + q);
            return;
        }
    }
    window.location.assign('/' + prefix + q);
}

function init() {
    const input = document.getElementById('input-city');
    if (!input) return;
    const city = readCityFromUrl();
    if (city && !String(input.value || '').trim()) input.value = city;
    bindLocationUI({ navigateAfterPick: navigateTargetForAddress });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
