import { pathPrefixFromAddress } from './location-routing.js';

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function show(el) {
    if (el) el.classList.remove('hidden');
}

function hide(el) {
    if (el) el.classList.add('hidden');
}

async function fetchTimeMeta(address) {
    const url = new URL('/time-meta.php', window.location.origin);
    url.searchParams.set('address', address);
    const r = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('time_meta');
    const j = await r.json();
    if (!j || !j.success || !j.data) throw new Error('time_meta_fail');
    return j.data;
}

async function fetchRegionCities(countryCode, regionName, limit = 30) {
    const cc = String(countryCode || '').trim().toLowerCase();
    const region = String(regionName || '').trim();
    if (!cc || cc.length !== 2 || !region) return null;
    try {
        const url = new URL('/region-cities.php', window.location.origin);
        url.searchParams.set('country_code', cc);
        url.searchParams.set('region', region);
        url.searchParams.set('limit', String(limit));
        const r = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j || !j.success || !j.data) return null;
        return j.data;
    } catch (_) {
        return null;
    }
}

async function fetchCountryCities(countryCode, limit = 30) {
    const cc = String(countryCode || '').trim().toLowerCase();
    if (!cc || cc.length !== 2) return null;
    try {
        const url = new URL('/country-cities.php', window.location.origin);
        url.searchParams.set('country_code', cc);
        url.searchParams.set('limit', String(limit));
        const r = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j || !j.success || !j.data) return null;
        return j.data;
    } catch (_) {
        return null;
    }
}

function renderLinks(listEl, cities) {
    listEl.innerHTML = (cities || []).map((c) => {
        const label = c && c.label ? String(c.label).trim() : '';
        if (!label) return '';
        const prefix = pathPrefixFromAddress(label);
        const href = prefix ? '/' + prefix : '/';
        const cityOnly = label.split(',')[0].trim();
        const rest = label.split(',').slice(1).join(',').trim();
        return (
            '<a class="time-other-city-link" href="' +
            href +
            '"><span>' +
            escapeHtml(cityOnly) +
            '</span>' +
            (rest ? '<span class="time-other-city-muted">' + escapeHtml(rest) + '</span>' : '') +
            '</a>'
        );
    }).join('');
}

/**
 * Initializes the “Major cities” sections if the page contains:
 * - #major-cities
 * - #major-cities-title
 * - #major-cities-sub
 * - #major-cities-list
 *
 * Optional (country-wide):
 * - #country-cities
 * - #country-cities-title
 * - #country-cities-sub
 * - #country-cities-list
 */
export async function initMajorCities(address, { limit = 30 } = {}) {
    const wrap = $('major-cities');
    const title = $('major-cities-title');
    const sub = $('major-cities-sub');
    const list = $('major-cities-list');
    const cWrap = $('country-cities');
    const cTitle = $('country-cities-title');
    const cSub = $('country-cities-sub');
    const cList = $('country-cities-list');

    if ((!wrap || !list) && (!cWrap || !cList)) return;

    const addr = String(address || '').trim();
    if (!addr) {
        hide(wrap);
        hide(cWrap);
        return;
    }

    const tm = await fetchTimeMeta(addr);
    const cc = tm?.country_code || '';
    const region = tm?.region || '';

    if (wrap && list) {
        if (!cc || !region) {
            hide(wrap);
        } else {
            const payload = await fetchRegionCities(cc, region, limit);
            const cities = payload && Array.isArray(payload.cities) ? payload.cities : [];
            if (!cities.length) {
                hide(wrap);
            } else {
                if (title) title.textContent = `Major cities in ${region}:`;
                if (sub) sub.textContent = 'Quick links';
                renderLinks(list, cities);
                show(wrap);
            }
        }
    }

    if (cWrap && cList) {
        if (!cc) {
            hide(cWrap);
        } else {
            const cPayload = await fetchCountryCities(cc, limit);
            const cCities = cPayload && Array.isArray(cPayload.cities) ? cPayload.cities : [];
            if (!cCities.length) {
                hide(cWrap);
            } else {
                const country = tm?.country ? String(tm.country).trim() : '';
                if (cTitle) cTitle.textContent = `Time now in other cities in ${country || 'this country'}:`;
                if (cSub) cSub.textContent = 'Popular cities (quick links)';
                renderLinks(cList, cCities);
                show(cWrap);
            }
        }
    }
}

