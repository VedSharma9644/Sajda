/**
 * e-Sajda – Prayer-specific detail page renderer
 *
 * Route shape: /{city}/prayer-times/{prayer}
 * Reuses the existing today/month API payloads and shows focused information
 * for a single prayer.
 */

import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { readPrayerFromUrl } from './location-routing.js';
import { getDisplayLocation, getNowMinutesInTimezone, timeToMinutes } from './utils.js';

const PRAYER_LABELS = {
    fajr: 'Fajr',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha'
};

const PRAYER_TEXT = {
    fajr: { window: 'from true dawn until just before sunrise', niyyah: 'I intend to pray the Fard of Fajr for the sake of Allah.', sunnah: '2', fard: '2' },
    dhuhr: { window: 'after the sun passes its zenith until Asr starts', niyyah: 'I intend to pray the Fard of Dhuhr for the sake of Allah.', sunnah: '4', fard: '4' },
    asr: { window: 'from late afternoon until just before sunset', niyyah: 'I intend to pray the Fard of Asr for the sake of Allah.', sunnah: '0', fard: '4' },
    maghrib: { window: 'right after sunset until twilight disappears', niyyah: 'I intend to pray the Fard of Maghrib for the sake of Allah.', sunnah: '0', fard: '3' },
    isha: { window: 'from nightfall until before dawn', niyyah: 'I intend to pray the Fard of Isha for the sake of Allah.', sunnah: '2', fard: '4' }
};

function getPrayerKey() {
    return readPrayerFromUrl();
}

export function isPrayerDetailRoute() {
    return !!getPrayerKey();
}

function sanitizeTime(s) {
    return typeof s === 'string' ? s.split(' ')[0].trim() : '--:--';
}

function minuteDeltaToday(timings, prayerName, tz) {
    const prayerMinutes = timeToMinutes(sanitizeTime(timings[prayerName]));
    const nowMinutes = getNowMinutesInTimezone(tz);
    if (prayerMinutes == null || nowMinutes == null) return null;
    return prayerMinutes - nowMinutes;
}

function dayRowsForPrayer(monthRows, prayerName, startDate) {
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const out = [];
    for (let i = 0; i < monthRows.length; i += 1) {
        const row = monthRows[i];
        const day = Number(row?.date?.gregorian?.day);
        const month = Number(row?.date?.gregorian?.month?.number) - 1;
        const year = Number(row?.date?.gregorian?.year);
        if (!day || month < 0 || !year) continue;
        const d = new Date(year, month, day);
        if (d >= start && out.length < 7) {
            out.push({
                weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
                label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                hijri: row?.date?.hijri?.day ? row.date.hijri.day + ' ' + (row.date.hijri.month?.en || '') : '—',
                time: sanitizeTime(row?.timings?.[prayerName])
            });
        }
    }
    return out;
}

async function fetchCurrentMonthRows() {
    const method = $('select-method') ? $('select-method').value : '4';
    const now = new Date();
    const p = new URLSearchParams();
    p.set('action', 'month');
    p.set('month', String(now.getMonth() + 1));
    p.set('year', String(now.getFullYear()));
    p.set('method', method);
    if (state.useCoordinates && state.currentCoords) {
        p.set('latitude', state.currentCoords.latitude);
        p.set('longitude', state.currentCoords.longitude);
    } else if (state.currentAddress) {
        p.set('address', state.currentAddress);
    } else {
        return [];
    }
    const res = await fetch('/api.php?' + p.toString(), { method: 'GET' });
    const json = await res.json();
    if (!json.success) return [];
    const payload = json.data?.data || json.data;
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
        return Object.keys(payload).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map((k) => payload[k]);
    }
    return [];
}

export function hidePrayerDetailPage() {
    hide($('prayer-detail-section'));
}

export async function renderPrayerDetailPage(todayData) {
    const key = getPrayerKey();
    if (!key) return false;
    const prayerName = PRAYER_LABELS[key];
    const timings = todayData?.timings || {};
    const tz = todayData?.meta?.timezone || '';
    const todayPrayer = sanitizeTime(timings[prayerName]);
    const detailCfg = PRAYER_TEXT[key];

    const section = $('prayer-detail-section');
    if (!section) return false;
    show(section);

    const cityLabel = getDisplayLocation();
    $('prayer-detail-title').textContent = prayerName + ' Prayer Time Today in ' + cityLabel;
    $('prayer-detail-time').textContent = todayPrayer;

    const delta = minuteDeltaToday(timings, prayerName, tz);
    if (delta == null) $('prayer-detail-status').textContent = '';
    else if (delta > 0) $('prayer-detail-status').textContent = 'Starts in ' + delta + ' minute(s)';
    else if (delta === 0) $('prayer-detail-status').textContent = 'It is ' + prayerName + ' time now';
    else $('prayer-detail-status').textContent = 'Time passed by ' + Math.abs(delta) + ' minute(s)';

    $('prayer-detail-about').textContent =
        prayerName + ' is performed ' + detailCfg.window + '. For ' + cityLabel + ', today\'s ' + prayerName +
        ' starts at ' + todayPrayer + '.';
    $('prayer-detail-niyyah').textContent = '"' + detailCfg.niyyah + '"';
    $('prayer-detail-sunnah').textContent = detailCfg.sunnah;
    $('prayer-detail-fard').textContent = detailCfg.fard;
    $('prayer-detail-method').textContent = todayData?.meta?.method?.name || '—';

    const monthRows = await fetchCurrentMonthRows();
    const g = todayData?.date?.gregorian;
    const startDate = g ? new Date(Number(g.year), Number(g.month?.number) - 1, Number(g.day)) : new Date();
    const rows = dayRowsForPrayer(monthRows, prayerName, startDate);
    const body = $('prayer-detail-7day-body');
    body.innerHTML = rows.map((r) =>
        '<tr><td>' + r.weekday + ', ' + r.label + '</td><td>' + r.hijri + '</td><td>' + r.time + '</td></tr>'
    ).join('');

    if (rows.length > 1) {
        const t0 = timeToMinutes(rows[0].time);
        const t1 = timeToMinutes(rows[1].time);
        if (t0 != null && t1 != null) {
            const diff = t1 - t0;
            const dir = diff === 0 ? 'same' : diff < 0 ? Math.abs(diff) + 'm earlier' : diff + 'm later';
            $('prayer-detail-tomorrow').textContent = 'Tomorrow: ' + rows[1].time + ' (' + dir + ')';
        }
    } else {
        $('prayer-detail-tomorrow').textContent = '';
    }

    return true;
}
