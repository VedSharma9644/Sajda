import { readLocationFromPageUrl } from './page-location.js';
import { initThemeToggle } from './theme.js';
import { $, show, hide } from './dom.js';
import { startClockWidget, startLocalClockWidget } from './clock-widget.js';
import { pathPrefixFromAddress } from './location-routing.js';
import { initMajorCities } from './major-cities.js';
import { readTimeMetaPrefetch } from './time-prefetch.js';

let tzLineIntervalId = null;
let leafletMap = null;
let leafletMarker = null;

async function fetchTimeMeta(address) {
    const url = new URL('/time-meta.php', window.location.origin);
    url.searchParams.set('address', address);
    const r = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('time_meta');
    const j = await r.json();
    if (!j.success || !j.data) throw new Error('time_meta_fail');
    return j.data;
}

function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}

function initLeafletMap(lat, lon, label) {
    const mapEl = $('time-map');
    const wrap = $('time-map-section');
    if (!mapEl || !wrap) return;
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    if (typeof window.L === 'undefined') return;

    wrap.classList.remove('hidden');
    setText('time-map-caption', label || '');

    if (!leafletMap) {
        leafletMap = window.L.map(mapEl, {
            zoomControl: true,
            scrollWheelZoom: false,
        });
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(leafletMap);
    }

    leafletMap.setView([la, lo], 11);
    if (leafletMarker) leafletMarker.remove();
    leafletMarker = window.L.marker([la, lo]).addTo(leafletMap);
    if (label) leafletMarker.bindPopup(label).openPopup();
}

function flagEmojiFromCountryCode(code) {
    if (!code) return '';
    const cc = String(code).trim().toUpperCase();
    if (cc.length !== 2) return '';
    const A = 0x1f1e6;
    const a = 'A'.charCodeAt(0);
    return String.fromCodePoint(A + (cc.charCodeAt(0) - a), A + (cc.charCodeAt(1) - a));
}

function formatLatLon(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return '—';
    const ns = la >= 0 ? 'N' : 'S';
    const ew = lo >= 0 ? 'E' : 'W';
    return `${Math.abs(la).toFixed(2)}° ${ns}, ${Math.abs(lo).toFixed(2)}° ${ew}`;
}

async function fetchCountryInfo(countryCode) {
    const cc = String(countryCode || '').trim().toLowerCase();
    if (!cc || cc.length !== 2) return null;
    try {
        const url = new URL('/country-info.php', window.location.origin);
        url.searchParams.set('code', cc);
        const r = await fetch(url.toString(), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j || !j.success || !j.data || typeof j.data !== 'object') return null;
        return j.data;
    } catch (_) {
        return null;
    }
}

function fmtInt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-GB');
}

async function fetchRegionCities(countryCode, regionName) {
    const cc = String(countryCode || '').trim().toLowerCase();
    const region = String(regionName || '').trim();
    if (!cc || cc.length !== 2 || !region) return null;
    try {
        const url = new URL('/region-cities.php', window.location.origin);
        url.searchParams.set('country_code', cc);
        url.searchParams.set('region', region);
        url.searchParams.set('limit', '30');
        const r = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j || !j.success || !j.data) return null;
        return j.data;
    } catch (_) {
        return null;
    }
}

function renderRegionCities(regionName, cities) {
    const wrap = $('major-cities');
    const title = $('major-cities-title');
    const sub = $('major-cities-sub');
    const list = $('major-cities-list');
    if (!wrap || !list) return;
    if (!Array.isArray(cities) || !cities.length) {
        wrap.classList.add('hidden');
        return;
    }
    if (title) title.textContent = `Major cities in ${regionName}:`;
    if (sub) sub.textContent = 'Quick links';
    list.innerHTML = cities.map((c) => {
        const prefix = pathPrefixFromAddress(c.label);
        const href = prefix ? '/' + prefix : '/';
        const cityOnly = c.label.split(',')[0].trim();
        const rest = c.label.split(',').slice(1).join(',').trim();
        return (
            '<a class="time-other-city-link" href="' +
            href +
            '"><span>' +
            cityOnly +
            '</span>' +
            (rest ? '<span class="time-other-city-muted">' + rest + '</span>' : '') +
            '</a>'
        );
    }).join('');
    wrap.classList.remove('hidden');
}

function renderCountryInfo({ countryName, flag, continentGuess, countryCode }) {
    const wrap = $('time-country-info');
    if (!wrap) return;
    const title = $('time-country-title');
    const sub = $('time-country-sub');
    const capEl = $('time-capital');
    const isoEl = $('time-iso');
    const tzEl = $('time-country-timezones');
    const popEl = $('time-country-pop');

    if (title) title.textContent = `Current Time in ${countryName || 'Country'}${flag ? ' ' + flag : ''}`;
    if (sub) sub.textContent = continentGuess ? `Continent: ${continentGuess}` : '';

    fetchCountryInfo(countryCode).then((info) => {
        if (!info) {
            // Still show basic bits if API blocked.
            if (capEl) capEl.textContent = '—';
            if (isoEl) isoEl.textContent = '—';
            if (tzEl) tzEl.textContent = '—';
            if (popEl) popEl.textContent = '—';
            wrap.classList.remove('hidden');
            return;
        }
        const region = info.region || '';
        const subregion = info.subregion || '';
        const cont = region ? region : (continentGuess || '');
        if (sub) sub.textContent = [cont ? `Continent: ${cont}` : '', subregion].filter(Boolean).join(' · ');
        const capital = Array.isArray(info.capital) ? info.capital[0] : info.capital;
        if (capEl) capEl.textContent = capital || '—';
        if (isoEl) isoEl.textContent = `${info.cca2 || '—'}, ${info.cca3 || '—'}`;
        if (tzEl) {
            const zones = Array.isArray(info.timezones) ? info.timezones : (info.timezones ? [String(info.timezones)] : []);
            if (!zones.length) {
                tzEl.textContent = '—';
            } else {
                tzEl.innerHTML =
                    '<div class="time-tz-chips">' +
                    zones.map((z) => '<span class="time-tz-chip">' + escapeHtml(String(z)) + '</span>').join('') +
                    '</div>';
            }
        }
        if (popEl) popEl.textContent = fmtInt(info.population);
        wrap.classList.remove('hidden');
    });
}

function tzParts(tz, date) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);
}

function getOffsetMinutes(tz, date = new Date()) {
    // Convert "time in tz" parts into a UTC timestamp, compare with real UTC time to derive offset.
    const parts = tzParts(tz, date);
    const pick = (type) => parts.find((p) => p.type === type)?.value;
    const y = pick('year');
    const m = pick('month');
    const d = pick('day');
    const hh = pick('hour');
    const mm = pick('minute');
    const ss = pick('second');
    if (!y || !m || !d || !hh || !mm || !ss) return null;
    const asUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    const diffMs = asUtc - date.getTime();
    return Math.round(diffMs / 60000);
}

function offsetToString(mins) {
    if (!Number.isFinite(mins)) return '—';
    const sign = mins >= 0 ? '+' : '-';
    const abs = Math.abs(mins);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
}

function pad2(v) {
    return String(v).padStart(2, '0');
}

function tzAbbreviation(tz, date = new Date()) {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).format(date);
    const m = s.match(/\b([A-Z]{2,6}|GMT[+-]\d{1,2}|UTC[+-]\d{1,2})\b/);
    return m ? m[1] : null;
}

function startTzLineTick(tz) {
    const el = $('clock-tzline');
    if (!el) return;
    if (tzLineIntervalId) clearInterval(tzLineIntervalId);

    const tick = () => {
        try {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            }).formatToParts(new Date());
            const get = (t) => parts.find((p) => p.type === t)?.value;
            const hh = get('hour');
            const mm = get('minute');
            const ss = get('second');
            const ab = tzAbbreviation(tz) || tz;
            if (hh && mm && ss) {
                el.textContent = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)} ${ab}`;
            } else {
                el.textContent = `— ${ab}`;
            }
        } catch (e) {
            el.textContent = '—';
        }
    };

    tick();
    tzLineIntervalId = setInterval(tick, 1000);
}

function standardAndDstOffsets(tz) {
    const y = new Date().getFullYear();
    const jan = getOffsetMinutes(tz, new Date(Date.UTC(y, 0, 15, 12, 0, 0)));
    const jul = getOffsetMinutes(tz, new Date(Date.UTC(y, 6, 15, 12, 0, 0)));
    if (!Number.isFinite(jan) || !Number.isFinite(jul)) return null;
    const standard = Math.min(jan, jul);
    const dst = Math.max(jan, jul);
    return { standard, dst };
}

function formatLongDate(tz, date = new Date()) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date);
}

async function nextOffsetChange(tz, fromDate = new Date()) {
    // Scan forward to find the next moment offset changes (DST start/end). Returns { date, fromOffset, toOffset } or null.
    const startOffset = getOffsetMinutes(tz, fromDate);
    if (!Number.isFinite(startOffset)) return null;

    const maxHours = 24 * 370;
    let stepHours = 6;
    let prev = new Date(fromDate.getTime());
    let prevOff = startOffset;

    for (let i = 0; i < maxHours; i += stepHours) {
        const cur = new Date(fromDate.getTime() + i * 3600_000);
        const curOff = getOffsetMinutes(tz, cur);
        if (!Number.isFinite(curOff)) continue;
        if (curOff !== prevOff) {
            // Binary search between prev and cur to within 1 minute
            let lo = prev.getTime();
            let hi = cur.getTime();
            let loOff = prevOff;
            let hiOff = curOff;
            for (let k = 0; k < 28 && hi - lo > 60_000; k++) {
                const mid = Math.floor((lo + hi) / 2);
                const midDate = new Date(mid);
                const midOff = getOffsetMinutes(tz, midDate);
                if (!Number.isFinite(midOff)) break;
                if (midOff === loOff) {
                    lo = mid;
                    loOff = midOff;
                } else {
                    hi = mid;
                    hiOff = midOff;
                }
            }
            return { date: new Date(hi), fromOffset: loOff, toOffset: hiOff };
        }
        prev = cur;
        prevOff = curOff;
        if (i >= 24 * 60) stepHours = 12; // after ~60 days, scan coarser
    }
    return null;
}

function isTimesLandingPath() {
    try {
        const path = new URL(window.location.href).pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        return parts.length === 1 && parts[0].toLowerCase() === 'times';
    } catch (_) {
        return false;
    }
}

function readLocationFromTimeRoot() {
    try {
        const path = new URL(window.location.href).pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (!parts.length) return null;
        if (parts[0].toLowerCase() === 'pages' || parts[0].toLowerCase() === 'js' || parts[0].toLowerCase() === 'sun-chart') {
            return null;
        }
        if (parts.length === 1) {
            if (parts[0].toLowerCase() === 'times') return null;
            const address = deslugPathSegment(parts[0]);
            const pathPrefix = encodeURIComponent(parts[0]);
            return { address, pathPrefix };
        }
        if (parts.length === 2) {
            const country = deslugPathSegment(parts[0]);
            const city = deslugPathSegment(parts[1]);
            const address = city + ', ' + country;
            const pathPrefix = parts.map((p) => encodeURIComponent(p)).join('/');
            return { address, pathPrefix };
        }
        return null;
    } catch (_) {
        return null;
    }
}

function deslugPathSegment(seg) {
    return decodeURIComponent(String(seg || ''))
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Fast path: clock + map + primary labels (no region-city list, DST, or country REST).
 * Used with sessionStorage prefetch so the user sees the clock before /time-meta round-trip.
 */
function paintTimeCoreFromMeta(loc, tm, errEl) {
    const tz = tm?.timezone || '';
    if (!tz) return false;
    startClockWidget(loc.address, tz);
    if (errEl) hide(errEl);

    const detailsEl = $('time-details');
    if (detailsEl) show(detailsEl);

    const continentGuess = tz.includes('/') ? tz.split('/')[0] : null;
    setText('time-details-sub', continentGuess ? `Timezone region: ${continentGuess}` : '');

    setText('time-iana', tz);
    setText('time-tz-label', tzAbbreviation(tz) || '—');
    setText('clock-timezone', `IANA: ${tz}`);
    startTzLineTick(tz);

    const offNow = getOffsetMinutes(tz, new Date());
    setText('time-utc-offset', offsetToString(offNow));
    setText('glance-offset', offsetToString(offNow));

    const lat = tm?.latitude;
    const lon = tm?.longitude;
    setText('time-latlong', formatLatLon(lat, lon));
    setText('glance-latlong', formatLatLon(lat, lon));
    initLeafletMap(lat, lon, loc.address);

    const region = tm?.region || null;
    const country = tm?.country || null;
    const cc = tm?.country_code || null;
    const countryCode = cc ? String(cc).toLowerCase() : '';
    const flag = flagEmojiFromCountryCode(cc);

    setText('time-region', region || '—');
    setText('glance-region', region || '—');
    if (country) {
        const cont = continentGuess ? ` (${continentGuess})` : '';
        setText('time-country', `${flag ? flag + ' ' : ''}${country}${cont}`);
    } else {
        setText('time-country', '—');
    }
    setText('glance-iana', tz);
    setText('glance-abbr', tzAbbreviation(tz) || '—');

    const glanceCard = $('time-glance');
    if (glanceCard) {
        setText('glance-dst', '…');
        glanceCard.classList.remove('hidden');
    }
    return true;
}

/** Slower path: country card, region quick links, DST text, then reveal full detail cards. */
async function runTimePageSecondary(loc, tm) {
    const tz = tm?.timezone || '';
    if (!tz) return;

    const offNow = getOffsetMinutes(tz, new Date());
    const continentGuess = tz.includes('/') ? tz.split('/')[0] : null;
    const region = tm?.region || null;
    const country = tm?.country || null;
    const cc = tm?.country_code || null;
    const countryCode = cc ? String(cc).toLowerCase() : '';
    const flag = flagEmojiFromCountryCode(cc);

    if (country && countryCode) {
        renderCountryInfo({ countryName: country, flag, continentGuess, countryCode });
    }

    if (countryCode && region) {
        const regionPayload = await fetchRegionCities(countryCode, region);
        const regionCities = regionPayload && Array.isArray(regionPayload.cities) ? regionPayload.cities : [];
        renderRegionCities(region, regionCities);
    }

    const sd = standardAndDstOffsets(tz);
    const abNow = tzAbbreviation(tz, new Date());
    const abJan = tzAbbreviation(tz, new Date(Date.UTC(new Date().getFullYear(), 0, 15, 12, 0, 0)));
    const abJul = tzAbbreviation(tz, new Date(Date.UTC(new Date().getFullYear(), 6, 15, 12, 0, 0)));

    let stdAbbr = abJan;
    let dstAbbr = abJul;
    if (sd && sd.standard === sd.dst) {
        stdAbbr = abNow || abJan || abJul;
        dstAbbr = '—';
    } else if (sd) {
        const y = new Date().getFullYear();
        const janOff = getOffsetMinutes(tz, new Date(Date.UTC(y, 0, 15, 12, 0, 0)));
        const julOff = getOffsetMinutes(tz, new Date(Date.UTC(y, 6, 15, 12, 0, 0)));
        if (janOff === sd.standard) stdAbbr = abJan;
        if (julOff === sd.standard) stdAbbr = abJul;
        if (janOff === sd.dst) dstAbbr = abJan;
        if (julOff === sd.dst) dstAbbr = abJul;
    }

    setText('time-std-abbr', stdAbbr || '—');
    setText('time-dst-abbr', dstAbbr || '—');

    let dstLine = 'No';
    if (sd && sd.standard !== sd.dst && Number.isFinite(offNow)) {
        const isDst = offNow === sd.dst;
        if (isDst) {
            dstLine = `Yes ✅ (Abbreviation: ${abNow || '—'})`;
            const next = await nextOffsetChange(tz, new Date());
            if (next) {
                const endAt = new Intl.DateTimeFormat('en-GB', {
                    timeZone: tz,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                }).format(next.date);
                dstLine += ` (Ends: ${endAt})`;
            }
        } else {
            dstLine = `No (Abbreviation: ${abNow || '—'})`;
        }
    } else if (abNow) {
        dstLine = `— (Abbreviation: ${abNow})`;
    }
    setText('time-dst', dstLine);

    let glanceDst = dstLine;
    if (sd && sd.standard !== sd.dst && Number.isFinite(offNow)) {
        const isDst = offNow === sd.dst;
        if (isDst) {
            glanceDst = `Yes (${abNow || '—'})`;
        } else {
            glanceDst = `No (${abNow || '—'})`;
        }
    } else if (abNow) {
        glanceDst = `— (${abNow})`;
    }
    setText('glance-dst', glanceDst);

    const glanceCard = $('time-glance');
    if (glanceCard) glanceCard.classList.remove('hidden');
    const detailsEl = $('time-details');
    if (detailsEl) show(detailsEl);
}

function runTimesLanding() {
    const errEl = $('time-page-error');
    if (errEl) hide(errEl);
    const heading = $('time-page-heading');
    if (heading) heading.textContent = 'Local time';
    const detailsEl = $('time-details');
    if (detailsEl) detailsEl.classList.add('hidden');

    let localTz = '';
    try {
        localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {
        localTz = '';
    }
    if (localTz) {
        setText('glance-iana', localTz);
        setText('glance-region', '—');
        setText('glance-latlong', '—');
        const off = getOffsetMinutes(localTz, new Date());
        setText('glance-offset', Number.isFinite(off) ? offsetToString(off) : '—');
        const ab = tzAbbreviation(localTz, new Date());
        setText('glance-abbr', ab || '—');
        setText('glance-dst', '—');
        const glanceCard = $('time-glance');
        if (glanceCard) glanceCard.classList.remove('hidden');
    }

    startLocalClockWidget();
}

function main() {
    initThemeToggle();
    if (isTimesLandingPath()) {
        runTimesLanding();
        return;
    }

    const loc = readLocationFromPageUrl('time') || readLocationFromTimeRoot();
    if (!loc) {
        window.location.replace('/');
        return;
    }

    const heading = $('time-page-heading');
    if (heading) heading.textContent = 'Time in ' + loc.address;
    const tagEl = $('site-header-tagline');
    if (tagEl) tagEl.textContent = loc.address;

    const errEl = $('time-page-error');

    const detailsEl = $('time-details');

    const pref = readTimeMetaPrefetch(loc.address);
    if (pref && pref.timezone) {
        paintTimeCoreFromMeta(loc, pref, errEl);
    }

    fetchTimeMeta(loc.address)
        .then((tm) => {
            const tz = tm?.timezone || '';
            if (!tz) throw new Error('no_tz');
            paintTimeCoreFromMeta(loc, tm, errEl);
            void initMajorCities(loc.address, { timeMeta: tm });
            void runTimePageSecondary(loc, tm);
        })
        .catch(() => {
            show(errEl);
            hide($('clock-section'));
            hide(detailsEl);
            if (tzLineIntervalId) {
                clearInterval(tzLineIntervalId);
                tzLineIntervalId = null;
            }
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
