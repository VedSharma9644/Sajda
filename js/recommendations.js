/**
 * e-Sajda – Method recommendations by region
 *
 * After we know a timezone or address, we can suggest a common calculation method
 * (MWL, Karachi, etc.). This is advisory only — the user’s dropdown choice always wins.
 */

import { METHOD_RECOMMENDATIONS } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { getTimezone } from './utils.js';

/**
 * Returns the first matching `{ region, methodName, pattern }` from config, or `null`.
 */
export function getRecommendedMethod(timezoneOrAddress) {
    if (!timezoneOrAddress || typeof timezoneOrAddress !== 'string') return null;
    const s = timezoneOrAddress.trim().toLowerCase();
    for (let i = 0; i < METHOD_RECOMMENDATIONS.length; i++) {
        const r = METHOD_RECOMMENDATIONS[i];
        if (r.pattern.test(s)) return r;
    }
    return null;
}

/** Writes the one-line recommendation under the method dropdown based on current state. */
export function updateMethodRecommendation() {
    const el = $('method-recommendation');
    if (!el) return;
    let input = null;
    if (state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.timezone) {
        input = state.lastTodayData.meta.timezone;
    } else if (state.currentAddress) {
        input = state.currentAddress;
    } else if (state.useCoordinates && state.currentCoords) {
        input = getTimezone();
    }
    if (!input) {
        el.textContent = 'Set a location to see a regional recommendation.';
        return;
    }
    const rec = getRecommendedMethod(input);
    if (rec) {
        el.innerHTML = 'For <strong>' + rec.region + '</strong> we recommend: <strong>' + rec.methodName + '</strong>.';
    } else {
        el.textContent = 'No specific recommendation for this region. MWL or Umm Al-Qura are widely used.';
    }
}
