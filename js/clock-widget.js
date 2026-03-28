import { $, show, hide } from './dom.js';

let clockIntervalId = null;
let clockTimezone = '';
let use24Hour = true;
let fullscreenBound = false;

function pad(v) {
    return String(v).padStart(2, '0');
}

function getNowParts(tz) {
    try {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const parts = fmt.formatToParts(new Date());
        const out = {};
        parts.forEach((p) => {
            if (p.type !== 'literal') out[p.type] = p.value;
        });
        return out;
    } catch (_) {
        return null;
    }
}

function renderClockTime() {
    if (!clockTimezone) return;
    const parts = getNowParts(clockTimezone);
    if (!parts) return;

    const h24 = Number(parts.hour || '0');
    const minute = parts.minute || '00';
    const second = parts.second || '00';
    const hour = use24Hour ? pad(h24) : pad((((h24 + 11) % 12) + 1));

    const hourEl = $('clock-hour');
    const minuteEl = $('clock-minute');
    const secondEl = $('clock-second');
    const dateEl = $('clock-date');
    const modeEl = $('clock-mode');
    const handHour = $('clock-hand-hour');
    const handMinute = $('clock-hand-minute');
    const handSecond = $('clock-hand-second');

    if (hourEl) hourEl.textContent = hour;
    if (minuteEl) minuteEl.textContent = minute;
    if (secondEl) secondEl.textContent = second;
    if (dateEl) dateEl.textContent = (parts.weekday || '') + ', ' + (parts.day || '') + ' ' + (parts.month || '') + ' ' + (parts.year || '');
    if (modeEl) modeEl.textContent = use24Hour ? '24-hour' : '12-hour';

    const h = Number(parts.hour || '0');
    const m = Number(parts.minute || '0');
    const s = Number(parts.second || '0');
    const hourDeg = (h % 12) * 30 + m * 0.5 + s * (0.5 / 60);
    const minuteDeg = m * 6 + s * 0.1;
    const secondDeg = s * 6;
    if (handHour) handHour.style.transform = 'translateX(-50%) rotate(' + hourDeg + 'deg)';
    if (handMinute) handMinute.style.transform = 'translateX(-50%) rotate(' + minuteDeg + 'deg)';
    if (handSecond) handSecond.style.transform = 'translateX(-50%) rotate(' + secondDeg + 'deg)';
}

function bindToggleButtons() {
    const btn24 = $('clock-btn-24');
    const btn12 = $('clock-btn-12');
    const btnFullscreen = $('clock-btn-fullscreen');
    const section = $('clock-section');
    if (btn24) {
        btn24.addEventListener('click', () => {
            use24Hour = true;
            btn24.classList.add('active');
            if (btn12) btn12.classList.remove('active');
            renderClockTime();
        });
    }
    if (btn12) {
        btn12.addEventListener('click', () => {
            use24Hour = false;
            btn12.classList.add('active');
            if (btn24) btn24.classList.remove('active');
            renderClockTime();
        });
    }
    if (btnFullscreen && section && !fullscreenBound) {
        btnFullscreen.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement === section) {
                    await document.exitFullscreen();
                } else {
                    await section.requestFullscreen();
                }
            } catch (_) {
                /* ignore */
            }
        });
        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = document.fullscreenElement === section;
            btnFullscreen.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
            section.classList.toggle('clock-fullscreen', isFullscreen);
        });
        fullscreenBound = true;
    }
}

let isBound = false;

export function startClockWidget(locationLabel, timezoneLabel) {
    const section = $('clock-section');
    const title = $('clock-location');
    const tz = $('clock-timezone');
    if (!section || !timezoneLabel) return;

    clockTimezone = timezoneLabel;
    if (title) title.textContent = locationLabel || 'Selected location';
    if (tz) tz.textContent = 'Timezone: ' + timezoneLabel;
    show(section);

    if (!isBound) {
        bindToggleButtons();
        isBound = true;
    }

    if (clockIntervalId) clearInterval(clockIntervalId);
    renderClockTime();
    clockIntervalId = setInterval(renderClockTime, 1000);
}

export function startLocalClockWidget() {
    let localTz = '';
    try {
        localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {
        localTz = '';
    }
    if (!localTz) return;
    startClockWidget('Your local time', localTz);
}

export function stopClockWidget() {
    if (clockIntervalId) {
        clearInterval(clockIntervalId);
        clockIntervalId = null;
    }
}

export function hideClockWidget() {
    stopClockWidget();
    hide($('clock-section'));
}
