import { englishPlaceLabelFromNominatim } from './utils.js';
import { esajdaLog } from './debug-log.js?v=21';

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const LABELS = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const RAKAT = {
    fajr: { sunnah: '2', fard: '2' },
    dhuhr: { sunnah: '4', fard: '4' },
    asr: { sunnah: '0', fard: '4' },
    maghrib: { sunnah: '0', fard: '3' },
    isha: { sunnah: '2', fard: '4' }
};

function $(id) {
    return document.getElementById(id);
}

function sanitizeTime(v) {
    return typeof v === 'string' ? v.split(' ')[0].trim() : '--:--';
}

function readRoute() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[1] === 'prayer-times' && PRAYERS.indexOf(parts[2].toLowerCase()) !== -1) {
        return { city: decodeURIComponent(parts[0]), prayer: parts[2].toLowerCase() };
    }
    if (parts.length >= 2 && parts[0] === 'prayer-times' && PRAYERS.indexOf(parts[1].toLowerCase()) !== -1) {
        return { city: '', prayer: parts[1].toLowerCase() };
    }
    return { city: '', prayer: document.body.dataset.prayer || 'fajr' };
}

async function fetchCityLabel(city) {
    if (!city) return city;
    const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(city) + '&format=json&addressdetails=1&namedetails=1&limit=1';
    esajdaLog('nominatim', 'GET search (prayer page label)', { city });
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'en',
                'User-Agent': 'e-Sajda/1.0 (Prayer Times)'
            }
        });
        const data = await res.json();
        if (Array.isArray(data) && data[0]) return englishPlaceLabelFromNominatim(data[0]) || city;
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

    const m = new URLSearchParams();
    const now = new Date();
    m.set('action', 'month');
    m.set('month', String(now.getMonth() + 1));
    m.set('year', String(now.getFullYear()));
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
    if (!monthJson.success) return { today: todayJson.data, month: [] };
    const monthData = monthJson.data && monthJson.data.data ? monthJson.data.data : monthJson.data;
    return { today: todayJson.data, month: Array.isArray(monthData) ? monthData : [] };
}

function renderPrayerTabs(city, activePrayer) {
    const wrap = $('prayer-tabs');
    if (!wrap) return;
    wrap.innerHTML = PRAYERS.map((k) => {
        const active = k === activePrayer ? ' prayer-tab-active' : '';
        const href = '/' + encodeURIComponent(city) + '/prayer-times/' + k;
        return '<a class="prayer-tab' + active + '" href="' + href + '">' + LABELS[k] + '</a>';
    }).join('');
}

function cityRootHref(city) {
    return '/' + encodeURIComponent(city);
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

function render7Day(monthArr, prayerName) {
    const body = $('seven-day-body');
    if (!body) return;
    const today = new Date();
    const rows = [];
    for (let i = 0; i < monthArr.length; i += 1) {
        const day = monthArr[i];
        const g = day && day.date && day.date.gregorian;
        if (!g) continue;
        const d = new Date(Number(g.year), Number(g.month.number) - 1, Number(g.day));
        if (d >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
            rows.push(day);
        }
        if (rows.length === 7) break;
    }
    body.innerHTML = rows.map((row) => {
        const g = row.date.gregorian;
        const h = row.date.hijri;
        return '<tr><td>' + g.weekday.en + ', ' + g.month.en + ' ' + g.day + '</td><td>' +
            h.day + ' ' + (h.month && h.month.en ? h.month.en : '') + '</td><td>' +
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
    const methodSelect = $('method-select');
    const city = route.city;
    if (!city) {
        setText('page-error', 'City is missing in URL. Use /{city}/prayer-times/' + prayer + '.');
        return;
    }
    renderPrayerTabs(city, prayer);
    setText('crumb-city', city);
    setText('crumb-prayer', prayerLabel + ' Prayer Times');
    const cityLabel = await fetchCityLabel(city);
    setText('hero-title', prayerLabel + ' Prayer Time Today in ' + cityLabel);
    setText('page-city', cityLabel);

    async function loadByMethod() {
        const method = methodSelect ? methodSelect.value : '4';
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

        const dailyWrap = $('daily-times');
        if (dailyWrap) {
            const prayerTiles = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((name) => {
                const key = name.toLowerCase();
                const activeClass = key === prayer ? ' daily-item-active' : '';
                return '<a class="daily-item' + activeClass + '" href="/' + encodeURIComponent(city) + '/prayer-times/' + key + '">' +
                    '<span>' + name + '</span><strong>' + sanitizeTime(today.timings[name]) + '</strong></a>';
            }).join('');
            const monthlyTile = '<a class="daily-item daily-item-month" href="' + cityRootHref(city) + '">' +
                '<span>Monthly</span><strong>Full Table</strong></a>';
            dailyWrap.innerHTML = prayerTiles + monthlyTile;
        }

        render7Day(month, prayerLabel);
    }

    await loadByMethod();
    if (methodSelect) {
        methodSelect.addEventListener('change', () => {
            loadByMethod().catch((err) => {
                setText('page-error', err && err.message ? err.message : 'Failed to update prayer page.');
            });
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
        setText('page-error', err && err.message ? err.message : 'Failed to load prayer page.');
    });
});
