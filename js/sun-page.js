import { readLocationFromPageUrl } from './page-location.js';
import { initThemeToggle } from './theme.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { renderSunTimesWidget } from './sun-times-widget.js?v=25';
import { refreshYearlySunChart } from '../sun-chart/sun-chart-entry.js?v=6';
import {
    refreshSunMonthTable,
    hideSunMonthTable,
    fillSunMonthYearSelects,
    readSunMonthCalendarFromForm,
    syncSunMonthRangeControls
} from '../sun-chart/sun-month-table.js';
import { resolveSelectedCoords } from './weather-api.js?v=25';
import { hasSunTimesData } from './sun-times.js';
import { initMajorCities } from './major-cities.js';

/** Last coords for monthly sun table + View button */
let sunMonthContext = null;

function todayDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
}

async function fetchToday(address) {
    const url = new URL('/api.php', window.location.origin);
    url.searchParams.set('action', 'today');
    url.searchParams.set('date', todayDate());
    url.searchParams.set('method', '4');
    url.searchParams.set('address', address);
    const r = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('api');
    const j = await r.json();
    if (!j.success || !j.data) throw new Error('api_fail');
    return j.data;
}

function main() {
    initThemeToggle();
    const loc = readLocationFromPageUrl('sun');
    if (!loc) {
        window.location.replace('/');
        return;
    }

    const heading = $('sun-page-heading');
    if (heading) heading.textContent = 'Sun & twilight — ' + loc.address;
    const tagEl = $('site-header-tagline');
    if (tagEl) tagEl.textContent = loc.address;

    const errEl = $('sun-page-error');

    // Show city widgets even if sun API fails.
    void initMajorCities(loc.address);

    const viewBtn = $('sun-month-view-btn');
    const rangeSel = $('sun-month-range-select');

    function runSunMonthRefresh() {
        if (!sunMonthContext) return;
        const { viewRange, month, year } = readSunMonthCalendarFromForm();
        void refreshSunMonthTable({
            viewRange,
            year,
            month,
            placeName: sunMonthContext.place,
            latitude: sunMonthContext.lat,
            longitude: sunMonthContext.lon,
            timezone: sunMonthContext.tz
        });
    }


    async function resolveSunTableCoords(meta) {
        let lat = meta && meta.latitude != null ? Number(meta.latitude) : NaN;
        let lon = meta && meta.longitude != null ? Number(meta.longitude) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            const c = await resolveSelectedCoords();
            if (!c) return null;
            lat = c.latitude;
            lon = c.longitude;
        }
        return { lat, lon };
    }

    async function setupSunMonthTable(meta) {
        const coords = await resolveSunTableCoords(meta);
        if (!coords) {
            hideSunMonthTable();
            sunMonthContext = null;
            return;
        }
        const tz = meta && meta.timezone ? String(meta.timezone) : null;
        sunMonthContext = { lat: coords.lat, lon: coords.lon, tz, place: loc.address };
        fillSunMonthYearSelects();
        const now = new Date();
        const { viewRange } = readSunMonthCalendarFromForm();
        await refreshSunMonthTable({
            viewRange,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            placeName: loc.address,
            latitude: coords.lat,
            longitude: coords.lon,
            timezone: tz
        });
    }

    if (viewBtn) {
        viewBtn.addEventListener('click', () => runSunMonthRefresh());
    }
    if (rangeSel) {
        rangeSel.addEventListener('change', () => {
            syncSunMonthRangeControls();
            runSunMonthRefresh();
        });
    }

    fetchToday(loc.address)
        .then(async (data) => {
            const timings = data.timings;
            const meta = data.meta;
            if (!hasSunTimesData(timings)) throw new Error('no_sun');

            state.currentAddress = loc.address;
            state.currentCoords = null;
            state.useCoordinates = false;
            state.lastTodayData = { timings, meta };

            renderSunTimesWidget(timings, loc.address);
            show($('sun-times-section'));
            void refreshYearlySunChart();
            await setupSunMonthTable(meta);
            hide(errEl);
        })
        .catch(() => {
            hideSunMonthTable();
            sunMonthContext = null;
            show(errEl);
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
