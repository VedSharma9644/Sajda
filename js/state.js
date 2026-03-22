/**
 * e-Sajda – Shared application state
 *
 * One plain object every module imports. Keeps coordinates, typed address,
 * suggestion UI state, and the last “today” API payload in one place.
 */

export const state = {
    currentCoords: null,
    currentAddress: null,
    useCoordinates: true,
    suggestionsList: [],
    suggestionHighlight: -1,
    suggestionDebounceTimer: null,
    lastTodayData: null,
    /** `setInterval` id for the “next prayer” countdown refresh (cleared on month view). */
    nextPrayerIntervalId: null
};
