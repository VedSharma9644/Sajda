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
