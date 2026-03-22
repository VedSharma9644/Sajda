/**
 * e-Sajda – Geolocation and city search with suggestions
 *
 * - **Use my location**: browser GPS → optional Nominatim reverse geocode for a label.
 * - **Search city**: OpenStreetMap Nominatim forward search with debounced dropdown.
 * Both paths update `state` and call `fetchPrayerTimes()` from `api.js`.
 */

import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { escapeHtml, getDisplayLocation, compactPlaceForUrl, englishPlaceLabelFromNominatim } from './utils.js';
import { setStatus, setResultsContext, showLoading } from './render.js';
import { updateMethodRecommendation } from './recommendations.js';
import { fetchPrayerTimes } from './api.js';

/**
 * Shareable URL shape: `https://site/Jaipur%2C%20India` (one path segment, no query).
 * Static files and `api.php` are excluded when reading the path.
 */
function replacePathWithPlaceLabel(placeLabel) {
    try {
        const trimmed = placeLabel.trim();
        if (!trimmed) return;
        const url = new URL(window.location.href);
        url.pathname = '/' + encodeURIComponent(trimmed);
        url.search = '';
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {
        /* ignore invalid base URL (e.g. rare file:// edge cases) */
    }
}

function replaceBrowserUrlWithCity(fullAddress) {
    const compact = compactPlaceForUrl(fullAddress.trim()) || fullAddress.trim();
    if (!compact) return;
    replacePathWithPlaceLabel(compact);
}

function clearCityFromBrowserUrl() {
    try {
        const url = new URL(window.location.href);
        url.pathname = '/';
        url.search = '';
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {
        /* ignore */
    }
}

function readLegacyCityQuery() {
    try {
        const raw = new URL(window.location.href).searchParams.get('city');
        if (raw == null) return null;
        const trimmed = raw.trim();
        return trimmed.length ? trimmed : null;
    } catch (_) {
        return null;
    }
}

/** Decodes `/Place%2C%20Country` → place string, or null for `/`, static assets, or `api.php`. */
function readCityFromPathname() {
    try {
        const path = new URL(window.location.href).pathname;
        const seg = path.replace(/^\/+|\/+$/g, '');
        if (!seg || seg.toLowerCase() === 'index.html') return null;
        if (/\.[a-z0-9]{2,4}$/i.test(seg)) return null;
        if (seg === 'api.php' || seg.indexOf('js/') === 0) return null;
        const city = decodeURIComponent(seg).trim();
        return city.length ? city : null;
    } catch (_) {
        return null;
    }
}

/**
 * Applies the place from the current URL path (and migrates old `?city=` once).
 * Used on first load and on browser back/forward.
 */
function applyCityFromCurrentUrl() {
    let city = readCityFromPathname();
    if (!city) {
        const legacy = readLegacyCityQuery();
        if (legacy) {
            city = compactPlaceForUrl(legacy) || legacy;
            replacePathWithPlaceLabel(city);
        }
    }
    if (!city) return;
    const inputCity = $('input-city');
    if (inputCity) inputCity.value = city;
    closeSuggestions();
    state.currentAddress = city;
    state.currentCoords = null;
    state.useCoordinates = false;
    setStatus('Using: ' + city, 'success');
    updateMethodRecommendation();
    fetchPrayerTimes();
}

/** Clears suggestion state and hides the dropdown (also used after picking a place). */
export function closeSuggestions() {
    state.suggestionsList = [];
    state.suggestionHighlight = -1;
    const suggestionsDropdown = $('suggestions-dropdown');
    const inputCity = $('input-city');
    if (suggestionsDropdown) {
        suggestionsDropdown.innerHTML = '';
        hide(suggestionsDropdown);
    }
    if (inputCity) inputCity.setAttribute('aria-expanded', 'false');
}

/** Shows a “Searching…” row while Nominatim is in flight. */
function showSuggestionsLoading() {
    const suggestionsDropdown = $('suggestions-dropdown');
    const inputCity = $('input-city');
    if (!suggestionsDropdown) return;
    suggestionsDropdown.innerHTML = '<div class="suggestion-loading">Searching…</div>';
    show(suggestionsDropdown);
    if (inputCity) inputCity.setAttribute('aria-expanded', 'true');
}

/** Renders suggestion buttons and wires click → fill input → `useCity()`. */
function showSuggestions(items) {
    state.suggestionsList = items || [];
    state.suggestionHighlight = -1;
    const suggestionsDropdown = $('suggestions-dropdown');
    const inputCity = $('input-city');
    if (!suggestionsDropdown) return;
    if (!state.suggestionsList.length) {
        suggestionsDropdown.innerHTML = '<div class="suggestion-empty">No places found. Try a different search.</div>';
    } else {
        suggestionsDropdown.innerHTML = state.suggestionsList.map((item, i) => {
            const label = englishPlaceLabelFromNominatim(item);
            return '<button type="button" class="suggestion-item" role="option" data-index="' + i + '" aria-selected="false">' + escapeHtml(label) + '</button>';
        }).join('');
        suggestionsDropdown.querySelectorAll('.suggestion-item').forEach((btn, i) => {
            // Keep focus on the input so blur+timeout does not remove the list before click fires.
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', () => {
                inputCity.value = englishPlaceLabelFromNominatim(state.suggestionsList[i]);
                closeSuggestions();
                useCity();
            });
        });
    }
    show(suggestionsDropdown);
    if (inputCity) inputCity.setAttribute('aria-expanded', 'true');
}

/** Calls Nominatim search API (min 2 chars); updates dropdown with results or empty state. */
function fetchSuggestions(query) {
    query = query.trim();
    if (query.length < 2) {
        closeSuggestions();
        return;
    }
    showSuggestionsLoading();
    const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&addressdetails=1&namedetails=1&limit=6';
    fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'e-Sajda/1.0 (Prayer Times)'
        }
    })
        .then((res) => res.json())
        .then((data) => {
            if (Array.isArray(data) && data.length) {
                showSuggestions(data);
            } else {
                showSuggestions([]);
            }
        })
        .catch(() => showSuggestions([]));
}

/** Debounced handler on the city input — waits 300ms after typing before searching. */
function onCityInput() {
    const inputCity = $('input-city');
    if (state.suggestionDebounceTimer) clearTimeout(state.suggestionDebounceTimer);
    state.suggestionDebounceTimer = setTimeout(() => {
        fetchSuggestions(inputCity ? inputCity.value : '');
    }, 300);
}

/** Keyboard navigation: moves the highlighted suggestion up/down in the list. */
function moveHighlight(delta) {
    const suggestionsDropdown = $('suggestions-dropdown');
    if (!suggestionsDropdown || suggestionsDropdown.classList.contains('hidden') || !state.suggestionsList.length) return;
    state.suggestionHighlight = state.suggestionHighlight + delta;
    if (state.suggestionHighlight < 0) state.suggestionHighlight = state.suggestionsList.length - 1;
    if (state.suggestionHighlight >= state.suggestionsList.length) state.suggestionHighlight = 0;
    suggestionsDropdown.querySelectorAll('.suggestion-item').forEach((el, i) => {
        el.setAttribute('aria-selected', i === state.suggestionHighlight);
    });
    const sel = suggestionsDropdown.querySelector('.suggestion-item[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

/**
 * Enter with the list open: if a row is highlighted (arrows), use that place; otherwise
 * use whatever is typed (same as Search). Previously highlight stayed at -1 until arrows,
 * so Enter appeared to do nothing.
 */
function selectHighlighted() {
    const inputCity = $('input-city');
    if (!inputCity || !state.suggestionsList.length) return;
    const idx = state.suggestionHighlight;
    if (idx >= 0 && idx < state.suggestionsList.length) {
        inputCity.value = englishPlaceLabelFromNominatim(state.suggestionsList[idx]);
    }
    closeSuggestions();
    useCity();
}

/**
 * “Use my location”: requests GPS coords, stores them, fetches times immediately,
 * then improves the label via `reverseGeocodeAndUpdateLocation`.
 */
export function useLocation() {
    setStatus('Getting location…');
    if (!navigator.geolocation) {
        setStatus('Geolocation is not supported by your browser.', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            state.currentCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            state.currentAddress = null; // filled via reverse geocoding
            state.useCoordinates = true;
            clearCityFromBrowserUrl();
            setStatus('Location: ' + state.currentCoords.latitude.toFixed(4) + ', ' + state.currentCoords.longitude.toFixed(4), 'success');
            updateMethodRecommendation();
            fetchPrayerTimes();
            reverseGeocodeAndUpdateLocation();
        },
        (err) => {
            state.currentCoords = null;
            const msg = err.code === 1 ? 'Location permission denied.'
                : err.code === 2 ? 'Location unavailable.'
                : 'Could not get location.';
            setStatus(msg, 'error');
            showLoading(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
}

/**
 * Turns lat/lon into a readable place name (prefers district over a distant big city)
 * and refreshes the results header + method recommendation when done.
 */
function reverseGeocodeAndUpdateLocation() {
    if (!state.currentCoords) return;
    var lat = state.currentCoords.latitude;
    var lon = state.currentCoords.longitude;

    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) +
        '&lon=' + encodeURIComponent(lon) + '&zoom=18&addressdetails=1&namedetails=1&accept-language=en';

    fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'e-Sajda/1.0 (Prayer Times)'
        }
    })
        .then((res) => res.json())
        .then((data) => {
            var address = data && data.address ? data.address : null;

            // Prefer the closest settlement-like field. If Nominatim returns a capital/major city,
            // but the district field is different, use the district to avoid misleading headers.
            var settlement =
                address && (address.city || address.town || address.village || address.municipality || address.hamlet || address.locality || address.suburb || address.county)
                    ? (address.city || address.town || address.village || address.municipality || address.hamlet || address.locality || address.suburb || address.county)
                    : '';

            var district =
                address && (address.state_district || address.district)
                    ? (address.state_district || address.district)
                    : '';

            var region =
                address && (address.state || address.region)
                    ? (address.state || address.region)
                    : '';

            var country = address && address.country ? address.country : '';

            // Prefer district when available (more reliable for “city” label than municipalities).
            if (district) settlement = district;
            else if (!settlement && district) settlement = district;

            var compact = [settlement, region, country].filter(Boolean).join(', ');

            state.currentAddress = compact || englishPlaceLabelFromNominatim(data) || null;

            // Update header context immediately after reverse geocoding resolves
            var methodName = state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.method && state.lastTodayData.meta.method.name
                ? state.lastTodayData.meta.method.name
                : '—';
            setResultsContext(getDisplayLocation(), methodName);
            updateMethodRecommendation();
        })
        .catch(() => {
            // If reverse geocoding fails, keep "Your location" as a fallback.
        });
}

/** Uses whatever is in the city input as the address string (no coordinates). */
export function useCity() {
    const inputCity = $('input-city');
    const city = inputCity && inputCity.value.trim();
    if (!city) {
        setStatus('Please enter a city and country (e.g. London, UK).', 'error');
        return;
    }
    closeSuggestions();
    state.currentAddress = city;
    state.currentCoords = null;
    state.useCoordinates = false;
    setStatus('Using: ' + city, 'success');
    replaceBrowserUrlWithCity(city);
    updateMethodRecommendation();
    fetchPrayerTimes();
}

/**
 * Attaches all location-related listeners: GPS button, search button, suggestion
 * keyboard/mouse behavior, and click-outside to close the dropdown.
 */
export function bindLocationUI() {
    const inputCity = $('input-city');
    const suggestionsDropdown = $('suggestions-dropdown');

    $('btn-use-location').addEventListener('click', useLocation);
    $('btn-search-city').addEventListener('click', useCity);

    if (inputCity) {
        inputCity.addEventListener('input', onCityInput);
        inputCity.addEventListener('focus', () => {
            if (inputCity.value.trim().length >= 2 && state.suggestionsList.length) showSuggestions(state.suggestionsList);
        });
        inputCity.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (state.suggestionsList.length && suggestionsDropdown && !suggestionsDropdown.classList.contains('hidden')) {
                    e.preventDefault();
                    selectHighlighted();
                } else {
                    useCity();
                }
                return;
            }
            if (e.key === 'Escape') {
                closeSuggestions();
                inputCity.blur();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveHighlight(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveHighlight(-1);
                return;
            }
        });
        inputCity.addEventListener('blur', () => setTimeout(closeSuggestions, 200));
    }

    document.addEventListener('click', (e) => {
        if (suggestionsDropdown && inputCity && !suggestionsDropdown.contains(e.target) && e.target !== inputCity) closeSuggestions();
    });

    window.addEventListener('popstate', () => applyCityFromCurrentUrl());
}

/** If the page was opened with `?city=…`, run the same flow as a manual city search. */
export function applyCityFromUrlOnStartup() {
    applyCityFromCurrentUrl();
}