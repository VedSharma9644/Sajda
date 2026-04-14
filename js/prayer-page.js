import { esajdaLog } from './debug-log.js?v=22';
import { initThemeToggle } from './theme.js';
import { initMajorCities } from './major-cities.js';

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const LABELS = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const RAKAT = {
    fajr: { sunnah: '2', fard: '2' },
    dhuhr: { sunnah: '4', fard: '4' },
    asr: { sunnah: '0', fard: '4' },
    maghrib: { sunnah: '0', fard: '3' },
    isha: { sunnah: '2', fard: '4' }
};

const CAL_TYPE_KEY = 'esajda.calType.v1';

function $(id) {
    return document.getElementById(id);
}

function getMethodFromUrl() {
    const p = new URLSearchParams(window.location.search);
    const m = p.get('method');
    const n = parseInt(m, 10);
    return Number.isFinite(n) ? String(n) : '4';
}

function readCalType() {
    try {
        const v = localStorage.getItem(CAL_TYPE_KEY);
        return v === 'hijri' ? 'hijri' : 'gregorian';
    } catch (_) {
        return 'gregorian';
    }
}

function writeCalType(t) {
    try {
        localStorage.setItem(CAL_TYPE_KEY, t);
    } catch (_) {
        /* ignore */
    }
}

function applyCalType(t) {
    const type = t === 'hijri' ? 'hijri' : 'gregorian';
    document.documentElement.dataset.calType = type;
    const btnG = $('cal-type-greg');
    const btnH = $('cal-type-hijri');
    if (btnG) btnG.setAttribute('aria-pressed', type === 'gregorian' ? 'true' : 'false');
    if (btnH) btnH.setAttribute('aria-pressed', type === 'hijri' ? 'true' : 'false');
    return type;
}

function bindCalType(onChange) {
    const btnG = $('cal-type-greg');
    const btnH = $('cal-type-hijri');
    if (btnG && btnG.dataset.bound !== '1') {
        btnG.dataset.bound = '1';
        btnG.addEventListener('click', () => {
            writeCalType('gregorian');
            applyCalType('gregorian');
            if (onChange) onChange();
        });
    }
    if (btnH && btnH.dataset.bound !== '1') {
        btnH.dataset.bound = '1';
        btnH.addEventListener('click', () => {
            writeCalType('hijri');
            applyCalType('hijri');
            if (onChange) onChange();
        });
    }
}

async function shareOrCopy({ title, text, url }) {
    const shareData = { title: title || document.title, text: text || '', url: url || window.location.href };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
            return { ok: true, mode: 'share' };
        }
    } catch (_) {
        /* fall back */
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareData.url);
            return { ok: true, mode: 'copy' };
        }
    } catch (_) {
        /* ignore */
    }
    try {
        window.prompt('Copy this link:', shareData.url);
        return { ok: true, mode: 'prompt' };
    } catch (_) {
        return { ok: false, mode: 'none' };
    }
}

function bindShareButton(getShareText) {
    const btn = $('share-page-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    const original = btn.textContent;
    btn.addEventListener('click', async () => {
        const url = window.location.href;
        const shareText = getShareText ? getShareText() : '';
        const res = await shareOrCopy({ title: document.title, text: shareText, url });
        if (!res.ok) return;
        if (res.mode === 'copy') {
            btn.textContent = 'Copied link';
            setTimeout(() => {
                btn.textContent = original;
            }, 1200);
        }
    });
}

function sanitizeTime(v) {
    return typeof v === 'string' ? v.split(' ')[0].trim() : '--:--';
}

function to12h(hhmm) {
    const s = String(hhmm || '').trim();
    const parts = s.split(':');
    if (parts.length < 2) return s;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return s;
    const am = h < 12;
    const hh = ((h + 11) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    return hh + ':' + mm + ' ' + (am ? 'AM' : 'PM');
}

function deslugPathSegment(seg) {
    return decodeURIComponent(seg)
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function readRoute() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 4 && parts[2].toLowerCase() === 'prayer-times' && PRAYERS.indexOf(parts[3].toLowerCase()) !== -1) {
        const country = deslugPathSegment(parts[0]);
        const city = deslugPathSegment(parts[1]);
        const address = city + ', ' + country;
        const pathPrefix = parts.slice(0, 2).map((p) => encodeURIComponent(p)).join('/');
        return { city: address, pathPrefix, prayer: parts[3].toLowerCase() };
    }
    if (parts.length >= 3 && parts[1].toLowerCase() === 'prayer-times' && PRAYERS.indexOf(parts[2].toLowerCase()) !== -1) {
        const pathPrefix = encodeURIComponent(parts[0]);
        const address = deslugPathSegment(parts[0]);
        return { city: address, pathPrefix, prayer: parts[2].toLowerCase() };
    }
    if (parts.length >= 2 && parts[0].toLowerCase() === 'prayer-times' && PRAYERS.indexOf(parts[1].toLowerCase()) !== -1) {
        return { city: '', pathPrefix: '', prayer: parts[1].toLowerCase() };
    }
    return { city: '', pathPrefix: '', prayer: document.body.dataset.prayer || 'fajr' };
}

async function fetchCityLabel(city) {
    if (!city) return city;
    try {
        const url = '/geocode.php?address=' + encodeURIComponent(city);
        esajdaLog('geo', 'GET /geocode.php (prayer page label)', { city });
        const res = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!res.ok) return city;
        const j = await res.json();
        if (j && j.success && j.data && typeof j.data.displayName === 'string') {
            const d = j.data.displayName.trim();
            if (d) return d;
        }
    } catch (_) {
        /* ignore and keep input city */
    }
    return city;
}

function todayDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
}

async function fetchPrayerMonth(city, method, month, year) {
    const m = new URLSearchParams();
    m.set('action', 'month');
    m.set('month', String(month));
    m.set('year', String(year));
    m.set('method', method);
    m.set('address', city);
    const monthUrl = '/api.php?' + m.toString();
    esajdaLog('api', 'GET /api.php (prayer page month)', { url: monthUrl });
    const monthRes = await fetch(monthUrl, { method: 'GET' });
    esajdaLog('api', '/api.php month response', {
        status: monthRes.status,
        serverCache: monthRes.headers.get('X-Esajda-Cache') || 'unknown'
    });
    const monthJson = await monthRes.json();
    if (!monthJson.success) return [];
    const monthData = monthJson.data && monthJson.data.data ? monthJson.data.data : monthJson.data;
    return Array.isArray(monthData) ? monthData : [];
}

async function fetchPrayerData(city, method) {
    const p = new URLSearchParams();
    p.set('action', 'today');
    p.set('date', todayDate());
    p.set('method', method);
    p.set('address', city);
    const todayUrl = '/api.php?' + p.toString();
    esajdaLog('api', 'GET /api.php (prayer page today)', { url: todayUrl });
    const todayRes = await fetch(todayUrl, { method: 'GET' });
    esajdaLog('api', '/api.php today response', {
        status: todayRes.status,
        serverCache: todayRes.headers.get('X-Esajda-Cache') || 'unknown'
    });
    const todayJson = await todayRes.json();
    if (!todayJson.success) throw new Error(todayJson.error || 'Failed to load prayer time.');

    const now = new Date();
    const monthArr = await fetchPrayerMonth(city, method, now.getMonth() + 1, now.getFullYear());
    return { today: todayJson.data, month: monthArr };
}

function renderPrayerTabs(pathPrefix, city, activePrayer, method) {
    const wrap = $('prayer-tabs');
    if (!wrap) return;
    const prefix = pathPrefix || (city ? encodeURIComponent(city) : '');
    const mq = method && method !== '4' ? '?method=' + encodeURIComponent(method) : '';
    const hub =
        prefix ?
            '<a class="prayer-tab prayer-tab-hub" href="/' + prefix + '/prayer-times' + mq + '">All prayers</a>' :
            '';
    const tabs = PRAYERS.map((k) => {
        const active = k === activePrayer ? ' prayer-tab-active' : '';
        const href = prefix ? '/' + prefix + '/prayer-times/' + k + mq : '/prayer-times/' + k + mq;
        return '<a class="prayer-tab' + active + '" href="' + href + '">' + LABELS[k] + '</a>';
    }).join('');
    wrap.innerHTML = hub + tabs;
}

function cityRootHref(pathPrefix, city) {
    if (pathPrefix) return '/' + pathPrefix;
    if (city) return '/' + encodeURIComponent(city);
    return '/';
}

function minuteDiff(nowHHMM, targetHHMM) {
    const [nh, nm] = nowHHMM.split(':').map(Number);
    const [th, tm] = targetHHMM.split(':').map(Number);
    if (Number.isNaN(nh) || Number.isNaN(nm) || Number.isNaN(th) || Number.isNaN(tm)) return null;
    return (th * 60 + tm) - (nh * 60 + nm);
}

function localNowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function pickUpcomingDays(monthArr, wantDays) {
    const today = new Date();
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const out = [];
    for (let i = 0; i < monthArr.length; i += 1) {
        const row = monthArr[i];
        const g = row && row.date && row.date.gregorian;
        if (!g) continue;
        const d = new Date(Number(g.year), Number(g.month.number) - 1, Number(g.day));
        if (d >= today0) out.push(row);
        if (out.length === wantDays) break;
    }
    return out;
}

function renderScheduleRows(rows, prayerName) {
    const body = $('seven-day-body');
    if (!body) return;
    body.innerHTML = rows.map((row) => {
        const g = row.date.gregorian;
        const h = row.date.hijri;
        const gLabel = g.weekday.en + ', ' + g.month.en + ' ' + g.day;
        const hLabel = h.day + ' ' + (h.month && h.month.en ? h.month.en : '') + (h.year ? ' ' + h.year : '');
        return '<tr><td class="col-greg">' + gLabel + '</td><td class="col-hijri">' +
            hLabel + '</td><td>' +
            sanitizeTime(row.timings[prayerName]) + '</td></tr>';
    }).join('');
}

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function setBadge(id, text, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'hero-badge' + (kind ? ' hero-badge-' + kind : '');
    if (!text) el.classList.add('hidden');
    else el.classList.remove('hidden');
}

async function init() {
    const route = readRoute();
    const prayer = route.prayer;
    const prayerLabel = LABELS[prayer] || 'Fajr';
    const city = route.city;
    if (!city) {
        setText('page-error', 'Location is missing in URL. Use /{place}/prayer-times/' + prayer + ' or /{country}/{city}/prayer-times/' + prayer + '.');
        return;
    }
    renderPrayerTabs(route.pathPrefix, city, prayer, getMethodFromUrl());
    setText('crumb-city', city);
    setText('crumb-prayer', prayerLabel + ' Prayer Times');
    const cityLabel = await fetchCityLabel(city);
    setText('hero-title', prayerLabel + ' Prayer Time Today in ' + cityLabel);
    setText('page-city', cityLabel);
    setText('site-header-tagline', cityLabel);
    void initMajorCities(cityLabel || city);

    const scheduleSelect = $('schedule-days');
    const scheduleHeading = $('schedule-heading');
    let scheduleDays = scheduleSelect ? parseInt(scheduleSelect.value, 10) : 7;
    if (!Number.isFinite(scheduleDays) || (scheduleDays !== 7 && scheduleDays !== 30)) scheduleDays = 7;
    applyCalType(readCalType());

    async function loadByMethod() {
        const method = getMethodFromUrl();
        const { today, month } = await fetchPrayerData(city, method);
        const time = sanitizeTime(today.timings[prayerLabel]);
        setText('hero-time', time);
        setText('method-name', today.meta && today.meta.method ? today.meta.method.name : '—');
        setText('niyyah', 'I intend to pray the Fard of ' + prayerLabel + ' for the sake of Allah.');
        setText('sunnah-count', RAKAT[prayer].sunnah);
        setText('fard-count', RAKAT[prayer].fard);

        const diff = minuteDiff(localNowHM(), time);
        if (diff == null) setBadge('time-status', '', '');
        else if (diff > 0) setBadge('time-status', 'Starts in ' + diff + 'm', 'soon');
        else if (diff === 0) setBadge('time-status', 'It is ' + prayerLabel + ' time now', 'now');
        else setBadge('time-status', 'Time passed', 'past');

        if (month.length >= 2) {
            const todayT = sanitizeTime(month[0].timings[prayerLabel]);
            const tomorrowT = sanitizeTime(month[1].timings[prayerLabel]);
            const drift = minuteDiff(todayT, tomorrowT);
            const driftText = drift == null || drift === 0 ? '0m tomorrow' : drift < 0 ? '-' + Math.abs(drift) + 'm tomorrow' : '+' + drift + 'm tomorrow';
            setBadge('tomorrow-shift', driftText, 'delta');
        } else {
            setBadge('tomorrow-shift', '', '');
        }

        const longEl = $('prayer-longdesc');
        let shareSummary = '';
        if (longEl) {
            const dateReadable = today?.date?.readable || '';
            const cityFull = cityLabel || city;
            const timings = today?.timings || {};
            shareSummary =
                'Accurate Islamic prayer times in ' +
                cityFull +
                (dateReadable ? ' for ' + dateReadable : '') +
                ': Fajr begins at ' +
                to12h(sanitizeTime(timings.Fajr)) +
                ', followed by Dhuhr at ' +
                to12h(sanitizeTime(timings.Dhuhr)) +
                ', Asr at ' +
                to12h(sanitizeTime(timings.Asr)) +
                ', Maghrib at ' +
                to12h(sanitizeTime(timings.Maghrib)) +
                ', and finally Isha at ' +
                to12h(sanitizeTime(timings.Isha)) +
                '. These timings ensure accurate performance of the five daily Salahs. Please note that the schedule changes daily based on the sun’s position relative to ' +
                (cityFull ? cityFull.split(',')[0] : 'your location') +
                '.';
            longEl.textContent = shareSummary;
        }
        bindShareButton(() => shareSummary);

        const dailyWrap = $('daily-times');
        if (dailyWrap) {
            const prefix = route.pathPrefix || encodeURIComponent(city);
            const mq = method !== '4' ? '?method=' + encodeURIComponent(method) : '';
            const prayerTiles = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((name) => {
                const key = name.toLowerCase();
                const activeClass = key === prayer ? ' daily-item-active' : '';
                return '<a class="daily-item' + activeClass + '" href="/' + prefix + '/prayer-times/' + key + mq + '">' +
                    '<span>' + name + '</span><strong>' + sanitizeTime(today.timings[name]) + '</strong></a>';
            }).join('');
            const monthlyTile = '<a class="daily-item daily-item-month" href="' + cityRootHref(route.pathPrefix, city) + mq + '">' +
                '<span>Monthly</span><strong>Full Table</strong></a>';
            dailyWrap.innerHTML = prayerTiles + monthlyTile;
        }

        // Build schedule rows: 7 days (from current month) or next 30 days (may span next month).
        let monthCombined = month;
        if (scheduleDays === 30) {
            const upcoming = pickUpcomingDays(monthCombined, 30);
            if (upcoming.length < 30) {
                const now = new Date();
                const nextMonth = now.getMonth() === 11 ? 1 : (now.getMonth() + 2);
                const nextYear = now.getMonth() === 11 ? (now.getFullYear() + 1) : now.getFullYear();
                const month2 = await fetchPrayerMonth(city, method, nextMonth, nextYear);
                monthCombined = monthCombined.concat(month2);
            }
        }
        const rows = pickUpcomingDays(monthCombined, scheduleDays);
        renderScheduleRows(rows, prayerLabel);
        if (scheduleHeading) {
            scheduleHeading.textContent = (scheduleDays === 30 ? 'Next 30 days' : '7-Day') + ' ' + prayerLabel + ' schedule';
        }
    }

    await loadByMethod();
    bindCalType(() => {
        applyCalType(readCalType());
        // No data refetch needed; we hide/show columns via CSS.
    });
    if (scheduleSelect) {
        scheduleSelect.addEventListener('change', () => {
            const v = parseInt(scheduleSelect.value, 10);
            scheduleDays = Number.isFinite(v) ? v : 7;
            loadByMethod().catch((err) => {
                setText('page-error', err && err.message ? err.message : 'Failed to update prayer page.');
            });
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    init().catch((err) => {
        setText('page-error', err && err.message ? err.message : 'Failed to load prayer page.');
    });
});
