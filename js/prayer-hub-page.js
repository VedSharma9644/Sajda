/**
 * Full prayer-times page at /{prefix}/prayer-times/ — prayer times, calendar views, next prayer.
 */
import { readLocationFromPageUrl } from './page-location.js';
import { initThemeToggle } from './theme.js';
import { PRAYERS, MONTHS } from './config.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { updateNextPrayerUI, startNextPrayerTick, stopNextPrayerTick } from './next-prayer.js';

let locRef = null;
let prayerHubClockInterval = null;
let prayerHubClockTz = '';
const CAL_TYPE_KEY = 'esajda.calType.v1';
let calType = 'gregorian';

function todayDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
}

function getHubMethod() {
    const sel = $('select-method');
    if (sel && sel.value !== '') return String(sel.value);
    const p = new URLSearchParams(window.location.search);
    const m = p.get('method');
    const n = parseInt(m, 10);
    return Number.isFinite(n) ? String(n) : '4';
}

function appendMethodToHref(href) {
    const method = getHubMethod();
    if (method === '4') return href;
    const u = new URL(href, window.location.origin);
    u.searchParams.set('method', method);
    return u.pathname + u.search;
}

function setResultsContext(locationText, methodText) {
    const locEl = $('results-location');
    const methodEl = $('results-method');
    if (locEl) locEl.innerHTML = locationText ? '<strong>Location:</strong> ' + locationText : '';
    if (methodEl) methodEl.innerHTML = methodText ? '<strong>Method:</strong> ' + methodText : '';
}

function showError(msg) {
    const err = $('error-message');
    const todayTimings = $('today-timings');
    const monthTimings = $('month-timings');
    const sevenDay = $('seven-day-timings');
    if (err) {
        err.textContent = msg;
        show(err);
    }
    hide(todayTimings);
    hide(monthTimings);
    if (sevenDay) hide(sevenDay);
}

function clearError() {
    hide($('error-message'));
}

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

function showMonthPicker(visible) {
    const mp = $('month-picker');
    if (visible) show(mp);
    else hide(mp);
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

/** Schedule card rows (7 or 30 days): Gregorian + Hijri columns like single-prayer pages. */
function hubScheduleRowHtml(day) {
    const d = day.date && day.date.gregorian;
    const h = day.date && day.date.hijri;
    const t = day.timings || {};
    const gLabel = d
        ? d.weekday.en + ', ' + d.month.en + ' ' + d.day + (d.year ? ', ' + d.year : '')
        : '—';
    const hLabel = h
        ? (String(h.day) + ' ' + (h.month && h.month.en ? h.month.en : '') + (h.year ? ' ' + h.year : '')).trim() || '—'
        : '—';
    return (
        '<tr><td class="col-greg">' +
        gLabel +
        '</td><td class="col-hijri">' +
        hLabel +
        '</td><td>' +
        (t.Fajr || '--') +
        '</td><td>' +
        (t.Dhuhr || '--') +
        '</td><td>' +
        (t.Asr || '--') +
        '</td><td>' +
        (t.Maghrib || '--') +
        '</td><td>' +
        (t.Isha || '--') +
        '</td></tr>'
    );
}

/** Full-month table: compact date cells, same dual-column toggle. */
function hubMonthRowHtml(day) {
    const d = day.date && day.date.gregorian;
    const h = day.date && day.date.hijri;
    const t = day.timings || {};
    const gLabel = d ? d.day + ' ' + d.month.en + ' ' + d.year : '—';
    const hLabel = h
        ? (String(h.day) + ' ' + (h.month && h.month.en ? h.month.en : '') + (h.year ? ' ' + h.year : '')).trim() || '—'
        : '—';
    return (
        '<tr><td class="col-greg">' +
        gLabel +
        '</td><td class="col-hijri">' +
        hLabel +
        '</td><td>' +
        (t.Fajr || '--') +
        '</td><td>' +
        (t.Dhuhr || '--') +
        '</td><td>' +
        (t.Asr || '--') +
        '</td><td>' +
        (t.Maghrib || '--') +
        '</td><td>' +
        (t.Isha || '--') +
        '</td></tr>'
    );
}

async function fetchAndRenderHubSchedule(method) {
    const section = $('seven-day-timings');
    const tbody = $('prayer-table-seven-body');
    const heading = $('hub-schedule-heading');
    if (!section || !tbody || !locRef) return;
    const wantDays = 7;
    try {
        const now = new Date();
        let monthArr = await fetchMonth(locRef.address, method, now.getMonth() + 1, now.getFullYear());
        let rows = pickUpcomingDays(monthArr, wantDays);
        if (rows.length < wantDays) {
            const nextMonth = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
            const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
            const month2 = await fetchMonth(locRef.address, method, nextMonth, nextYear);
            const combined = monthArr.concat(month2);
            rows = pickUpcomingDays(combined, wantDays);
        }
        if (!rows.length) {
            hide(section);
            return;
        }
        const viewMode = $('view-mode');
        if (viewMode && viewMode.value !== 'today') {
            hide(section);
            return;
        }
        if (heading) heading.textContent = 'Next 7 days';
        tbody.innerHTML = rows.map((day) => hubScheduleRowHtml(day)).join('');
        show(section);
    } catch (_) {
        hide(section);
    }
}

async function fetchToday(address, method) {
    const p = new URLSearchParams();
    p.set('action', 'today');
    p.set('date', todayDate());
    p.set('method', method);
    p.set('address', address);
    const res = await fetch('/api.php?' + p.toString(), { method: 'GET' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load prayer times.');
    return json.data;
}

async function fetchMonth(address, method, month, year) {
    const p = new URLSearchParams();
    p.set('action', 'month');
    p.set('month', String(month));
    p.set('year', String(year));
    p.set('method', method);
    p.set('address', address);
    const res = await fetch('/api.php?' + p.toString(), { method: 'GET' });
    const json = await res.json();
    if (!json.success) return [];
    const monthData = json.data && json.data.data ? json.data.data : json.data;
    return Array.isArray(monthData) ? monthData : [];
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
    calType = t === 'hijri' ? 'hijri' : 'gregorian';
    document.documentElement.dataset.calType = calType;
    const btnG = $('cal-type-greg');
    const btnH = $('cal-type-hijri');
    if (btnG) btnG.setAttribute('aria-pressed', calType === 'gregorian' ? 'true' : 'false');
    if (btnH) btnH.setAttribute('aria-pressed', calType === 'hijri' ? 'true' : 'false');
}

function bindCalType() {
    const btnG = $('cal-type-greg');
    const btnH = $('cal-type-hijri');
    if (btnG && btnG.dataset.bound !== '1') {
        btnG.dataset.bound = '1';
        btnG.addEventListener('click', () => {
            writeCalType('gregorian');
            applyCalType('gregorian');
        });
    }
    if (btnH && btnH.dataset.bound !== '1') {
        btnH.dataset.bound = '1';
        btnH.addEventListener('click', () => {
            writeCalType('hijri');
            applyCalType('hijri');
        });
    }
}

/** Calendar type (left) + View (right) on the schedule card (Today) or above the month table. */
function syncHubToolbarPlacement() {
    const toolbar = $('hub-prayer-toolbar');
    const schedule = $('seven-day-timings');
    const monthCard = $('month-timings');
    const vm = $('view-mode');
    if (!toolbar || !schedule || !monthCard) return;
    const v = vm ? vm.value : 'today';
    if (v === 'today') {
        if (toolbar.parentNode !== schedule) {
            schedule.insertBefore(toolbar, schedule.firstChild);
        }
    } else if (toolbar.parentNode !== monthCard) {
        monthCard.insertBefore(toolbar, monthCard.firstChild);
    }
}

function stopPrayerHubClock() {
    if (prayerHubClockInterval) {
        clearInterval(prayerHubClockInterval);
        prayerHubClockInterval = null;
    }
    prayerHubClockTz = '';
}

function startPrayerHubClock(timezone) {
    const tz = String(timezone || '').trim();
    if (!tz) return;
    if (prayerHubClockTz === tz && prayerHubClockInterval) return;
    stopPrayerHubClock();
    prayerHubClockTz = tz;

    const nowEl = $('prayer-hub-now');
    const gregEl = $('prayer-hub-greg');
    if (!nowEl && !gregEl) return;

    const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const tick = () => {
        const d = new Date();
        if (nowEl) nowEl.textContent = fmtTime.format(d) + ' ' + tz;
        if (gregEl) gregEl.textContent = fmtDate.format(d);
    };

    tick();
    prayerHubClockInterval = setInterval(tick, 1000);
}

function bindCopyLink() {
    const btn = $('prayer-hub-copy-link');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
        const url = window.location.href;
        try {
            await navigator.clipboard.writeText(url);
            btn.textContent = 'Copied';
            setTimeout(() => {
                btn.textContent = 'Copy page link';
            }, 1200);
        } catch (_) {
            // Fallback: select prompt
            window.prompt('Copy this link:', url);
        }
    });
}

function renderTodayView(data) {
    const timings = data?.timings;
    const date = data?.date;
    const meta = data?.meta;
    if (!timings) {
        showError('No prayer times in response.');
        return;
    }

    syncHubToolbarPlacement();

    state.lastTodayData = { timings, meta };
    state.currentAddress = locRef.address;
    state.currentCoords = null;
    state.useCoordinates = false;

    const resultsTitle = $('results-title');
    const resultsMeta = $('results-meta');
    const prayerList = $('prayer-list');
    if (resultsTitle) resultsTitle.textContent = 'Prayer times';
    const dateReadable = date && date.readable ? date.readable : '';
    const tz = meta && meta.timezone ? meta.timezone : '';
    if (resultsMeta) resultsMeta.textContent = dateReadable + (tz ? ' · Times in: ' + tz : '');

    setResultsContext(locRef.address, meta && meta.method && meta.method.name ? meta.method.name : '—');

    // Rich hub hero (fills the “empty” feeling with useful context).
    const hero = $('prayer-hub-hero');
    const heroTitle = $('prayer-hub-title');
    const heroSub = $('prayer-hub-subtitle');
    const heroHijri = $('prayer-hub-hijri');
    const heroTz = $('prayer-hub-tz');
    const heroBlurb = $('prayer-hub-blurb');

    if (heroTitle) heroTitle.textContent = 'Islamic Prayer Times Today in ' + locRef.address;
    if (heroSub) heroSub.textContent = 'Accurate daily Salah times based on the sun’s position.';
    if (heroTz) heroTz.textContent = tz || '—';

    const hijri =
        date && date.hijri && date.hijri.day
            ? String(date.hijri.day) + ' ' + (date.hijri.month && date.hijri.month.en ? date.hijri.month.en : '') + ' ' + (date.hijri.year || '') + ' AH'
            : '';
    if (heroHijri) heroHijri.textContent = hijri || '—';

    const t = (name) => (timings && timings[name] ? String(timings[name]).split(' ')[0] : '--:--');
    if (heroBlurb) {
        heroBlurb.innerHTML =
            'Today in <strong>' +
            escapeHtml(locRef.address) +
            '</strong>: Fajr <strong>' +
            escapeHtml(t('Fajr')) +
            '</strong>, Dhuhr <strong>' +
            escapeHtml(t('Dhuhr')) +
            '</strong>, Asr <strong>' +
            escapeHtml(t('Asr')) +
            '</strong>, Maghrib <strong>' +
            escapeHtml(t('Maghrib')) +
            '</strong>, Isha <strong>' +
            escapeHtml(t('Isha')) +
            '</strong>.';
    }

    const longDesc = $('prayer-hub-longdesc');
    if (longDesc) {
        const country = (locRef.address || '').split(',').map((p) => p.trim()).filter(Boolean).slice(-1)[0] || '';
        const city = locRef.address || '';
        const dateText = dateReadable || '';
        longDesc.textContent =
            'Accurate Islamic prayer times in ' +
            city +
            (country ? ', ' + country : '') +
            (dateText ? ' for ' + dateText : '') +
            ': Fajr begins at ' +
            to12h(t('Fajr')) +
            ', followed by Dhuhr at ' +
            to12h(t('Dhuhr')) +
            ', Asr at ' +
            to12h(t('Asr')) +
            ', Maghrib at ' +
            to12h(t('Maghrib')) +
            ', and finally Isha at ' +
            to12h(t('Isha')) +
            '. These timings ensure accurate performance of the five daily Salahs. Please note that the schedule changes daily based on the sun’s position relative to ' +
            (locRef.address ? locRef.address.split(',')[0] : 'your location') +
            '.';
    }
    show(hero);
    bindCopyLink();
    if (tz) startPrayerHubClock(tz);

    const methodTip = $('results-method-tip');
    const methodId = getHubMethod();
    if (methodTip) {
        const isIndia =
            (tz && (tz.indexOf('Calcutta') !== -1 || tz.indexOf('Kolkata') !== -1)) ||
            (locRef.address && locRef.address.toLowerCase().indexOf('india') !== -1);
        if (isIndia && methodId !== '1') {
            methodTip.textContent =
                'To match Google’s times in India, switch to “University of Islamic Sciences, Karachi” above.';
            show(methodTip);
        } else {
            hide(methodTip);
        }
    }

    const base = '/' + locRef.pathPrefix + '/prayer-times/';
    if (prayerList) {
        prayerList.innerHTML = PRAYERS.map((name) => {
            const time = timings[name] || '--:--';
            const href = appendMethodToHref(base + name.toLowerCase());
            return (
                '<li data-prayer="' +
                name +
                '"><a class="prayer-link" href="' +
                href +
                '"><span class="name">' +
                name +
                '</span><span class="time">' +
                time +
                '</span></a></li>'
            );
        }).join('');
    }

    updateNextPrayerUI();
    startNextPrayerTick();

    show($('results-section'));
    show($('today-timings'));
    hide($('month-timings'));
    clearError();

    void fetchAndRenderHubSchedule(getHubMethod());
}

function renderMonthView(monthArr, metaGuess) {
    if (!monthArr.length) {
        showError('No calendar data in response.');
        return;
    }

    syncHubToolbarPlacement();

    const first = monthArr[0];
    const meta = (first && first.meta) || metaGuess;
    const monthNum =
        first && first.date && first.date.gregorian && first.date.gregorian.month
            ? first.date.gregorian.month.number
            : null;
    const yearNum = first && first.date && first.date.gregorian ? first.date.gregorian.year : '';
    const monthName =
        first && first.date && first.date.gregorian && first.date.gregorian.month
            ? first.date.gregorian.month.en
            : MONTHS[(monthNum || 1) - 1];

    const resultsTitle = $('results-title');
    const resultsMeta = $('results-meta');
    const prayerTableBody = $('prayer-table-body');
    if (resultsTitle) resultsTitle.textContent = 'Prayer times – ' + monthName + ' ' + yearNum;
    if (resultsMeta) resultsMeta.textContent = meta && meta.timezone ? 'Times in: ' + meta.timezone : '';

    setResultsContext(locRef.address, meta && meta.method && meta.method.name ? meta.method.name : '—');

    if (prayerTableBody) prayerTableBody.innerHTML = monthArr.map((day) => hubMonthRowHtml(day)).join('');

    stopNextPrayerTick();
    stopPrayerHubClock();

    state.currentAddress = locRef.address;
    state.useCoordinates = false;

    const sevenDay = $('seven-day-timings');
    if (sevenDay) hide(sevenDay);

    show($('results-section'));
    hide($('today-timings'));
    show($('month-timings'));
    clearError();
}

async function renderNext30Days(method) {
    if (!locRef) return;
    const now = new Date();
    const month1 = await fetchMonth(locRef.address, method, now.getMonth() + 1, now.getFullYear());
    let combined = month1;
    let rows = pickUpcomingDays(combined, 30);

    if (rows.length < 30) {
        const nextMonth = now.getMonth() === 11 ? 1 : (now.getMonth() + 2);
        const nextYear = now.getMonth() === 11 ? (now.getFullYear() + 1) : now.getFullYear();
        const month2 = await fetchMonth(locRef.address, method, nextMonth, nextYear);
        combined = combined.concat(month2);
        rows = pickUpcomingDays(combined, 30);
    }

    if (!rows.length) {
        showError('No calendar data in response.');
        return;
    }

    syncHubToolbarPlacement();

    const first = rows[0];
    const meta = (first && first.meta) || null;

    const resultsTitle = $('results-title');
    const resultsMeta = $('results-meta');
    const prayerTableBody = $('prayer-table-body');

    if (resultsTitle) resultsTitle.textContent = 'Prayer times – Next 30 days';
    if (resultsMeta) resultsMeta.textContent = meta && meta.timezone ? 'Times in: ' + meta.timezone : '';
    setResultsContext(locRef.address, meta && meta.method && meta.method.name ? meta.method.name : '—');

    if (prayerTableBody) prayerTableBody.innerHTML = rows.map((day) => hubScheduleRowHtml(day)).join('');

    stopNextPrayerTick();
    stopPrayerHubClock();

    state.currentAddress = locRef.address;
    state.useCoordinates = false;

    const sevenDay = $('seven-day-timings');
    if (sevenDay) hide(sevenDay);

    show($('results-section'));
    hide($('today-timings'));
    show($('month-timings'));
    clearError();
}

async function load() {
    if (!locRef) return;
    const method = getHubMethod();
    const viewMode = $('view-mode');
    try {
        if (viewMode && viewMode.value === 'month') {
            const sm = $('select-month');
            const sy = $('select-year');
            const month = sm ? parseInt(sm.value, 10) : new Date().getMonth() + 1;
            const year = sy ? parseInt(sy.value, 10) : new Date().getFullYear();
            const monthArr = await fetchMonth(locRef.address, method, month, year);
            renderMonthView(monthArr, null);
        } else if (viewMode && viewMode.value === 'next30') {
            await renderNext30Days(method);
        } else {
            const data = await fetchToday(locRef.address, method);
            renderTodayView(data);
        }
    } catch (e) {
        showError(e && e.message ? e.message : 'Could not load prayer times.');
    }
}

function main() {
    initThemeToggle();
    const loc = readLocationFromPageUrl('prayer-times');
    if (!loc) {
        window.location.replace('/');
        return;
    }
    locRef = loc;

    const titleEl = $('results-title');
    if (titleEl) titleEl.textContent = 'Prayer times — ' + loc.address;
    const tagEl = $('site-header-tagline');
    if (tagEl) tagEl.textContent = loc.address;

    buildMonthOptions();
    showMonthPicker(false);
    applyCalType(readCalType());
    bindCalType();
    syncHubToolbarPlacement();

    const viewMode = $('view-mode');
    if (viewMode) {
        viewMode.addEventListener('change', () => {
            showMonthPicker(viewMode.value === 'month');
            load();
        });
    }
    $('select-month') &&
        $('select-month').addEventListener('change', () => {
            if ($('view-mode') && $('view-mode').value === 'month') load();
        });
    $('select-year') &&
        $('select-year').addEventListener('change', () => {
            if ($('view-mode') && $('view-mode').value === 'month') load();
        });

    const methodSelect = $('select-method');
    if (methodSelect) {
        const p = new URLSearchParams(window.location.search);
        const m = p.get('method');
        const n = parseInt(m, 10);
        if (Number.isFinite(n)) {
            const opt = methodSelect.querySelector('option[value="' + String(n) + '"]');
            if (opt) methodSelect.value = String(n);
        }
        methodSelect.addEventListener('change', () => {
            const u = new URL(window.location.href);
            if (methodSelect.value === '4') u.searchParams.delete('method');
            else u.searchParams.set('method', methodSelect.value);
            const qs = u.searchParams.toString();
            history.replaceState(null, '', u.pathname + (qs ? '?' + qs : ''));
            load();
        });
    }

    load();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
