/**
 * e-Sajda – Tiny DOM helpers
 *
 * `$` is shorthand for `getElementById`. `show` / `hide` toggle the `.hidden` class
 * used across the HTML (no inline styles).
 */

/** Returns an element by id, or null if missing. */
export function $(id) {
    return document.getElementById(id);
}

/** Removes the `hidden` class so the element is visible. */
export function show(el) {
    if (el) el.classList.remove('hidden');
}

/** Adds the `hidden` class so the element is not shown. */
export function hide(el) {
    if (el) el.classList.add('hidden');
}

/** Shows `#weather-sunstrip` when weather or sun-times panel is visible. */
export function syncWeatherSunstrip() {
    const strip = document.getElementById('weather-sunstrip');
    const weather = document.getElementById('weather-section');
    const sun = document.getElementById('sun-times-section');
    if (!strip) return;
    const wVis = weather && !weather.classList.contains('hidden');
    const sVis = sun && !sun.classList.contains('hidden');
    if (wVis || sVis) {
        strip.classList.remove('hidden');
    } else {
        strip.classList.add('hidden');
    }
}
