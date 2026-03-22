/**
 * e-Sajda – Next prayer countdown and list highlight
 *
 * Figures out which of the five daily prayers is next based on the current time
 * in the location’s timezone, then updates the “Next prayer” banner and highlights
 * the matching row in the prayer list.
 */

import { PRAYERS } from './config.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { timeToMinutes, getNowMinutesInTimezone, formatCountdown, getTimezone } from './utils.js';

/**
 * Given today’s prayer times and an IANA timezone, returns the next prayer name
 * and how many minutes until it. After Isha, the “next” prayer is Fajr (next day).
 */
export function getNextPrayer(timings, timezone) {
    const nowM = getNowMinutesInTimezone(timezone);
    const ordered = PRAYERS.map((name) => {
        const m = timeToMinutes(timings[name]);
        return { name, minutes: m };
    }).filter((p) => p.minutes !== null);
    for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].minutes > nowM) {
            return { name: ordered[i].name, minutesUntil: ordered[i].minutes - nowM };
        }
    }
    if (ordered.length) {
        const minutesUntilMidnight = 24 * 60 - nowM;
        return { name: ordered[0].name, minutesUntil: minutesUntilMidnight + ordered[0].minutes };
    }
    return null;
}

/**
 * Refreshes the next-prayer banner and the `.next-prayer` highlight on the list.
 * Uses `state.lastTodayData` from the last successful “today” API response.
 */
export function updateNextPrayerUI() {
    if (!state.lastTodayData || !state.lastTodayData.timings) return;
    const box = $('next-prayer-box');
    const nameEl = $('next-prayer-name');
    const countdownEl = $('next-prayer-countdown');
    const prayerList = $('prayer-list');
    const tz = (state.lastTodayData.meta && state.lastTodayData.meta.timezone) || getTimezone();
    const next = getNextPrayer(state.lastTodayData.timings, tz);
    if (!next) {
        if (box) hide(box);
        if (prayerList) prayerList.querySelectorAll('.next-prayer').forEach((el) => el.classList.remove('next-prayer'));
        return;
    }
    if (box) show(box);
    if (nameEl) nameEl.textContent = next.name;
    if (countdownEl) countdownEl.textContent = formatCountdown(next.minutesUntil);
    if (prayerList) {
        prayerList.querySelectorAll('.next-prayer').forEach((el) => el.classList.remove('next-prayer'));
        const nextLi = prayerList.querySelector('[data-prayer="' + next.name + '"]');
        if (nextLi) nextLi.classList.add('next-prayer');
    }
}

/** Runs `updateNextPrayerUI` once per minute so the countdown stays accurate. */
export function startNextPrayerTick() {
    if (state.nextPrayerIntervalId) clearInterval(state.nextPrayerIntervalId);
    state.nextPrayerIntervalId = setInterval(updateNextPrayerUI, 60000);
}

/** Stops the minute timer (e.g. when switching to month view). */
export function stopNextPrayerTick() {
    if (state.nextPrayerIntervalId) {
        clearInterval(state.nextPrayerIntervalId);
        state.nextPrayerIntervalId = null;
    }
}