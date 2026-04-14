/**
 * e-Sajda – Geolocation and city search with suggestions
 *
 * - **Use my location**: browser GPS → optional Nominatim reverse geocode for a label.
 * - **Search city**: OpenStreetMap Nominatim forward search with debounced dropdown.
 * Both paths update `state` and call `fetchPrayerTimes()` from `api.js`.
 */

import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { escapeHtml, getDisplayLocation, englishPlaceLabelFromNominatim } from './utils.js';
import { setStatus, setResultsContext, showLoading } from './render.js?v=25';
import { updateMethodRecommendation } from './recommendations.js';
import { fetchPrayerTimes } from './api.js';
import { replaceBrowserUrlWithCity, clearCityFromBrowserUrl, readCityFromUrl } from './location-routing.js';
import { refreshSiteHeaderToolsNav } from './site-header-nav.js?v=3';
import { getCachedSuggestions, setCachedSuggestions, getCachedReverseLabel, setCachedReverseLabel } from './location-cache.js';
import { esajdaLog } from './debug-log.js?v=21';

/** When set by `bindLocationUI({ navigateAfterPick })`, city/GPS picks full-page navigate instead of SPA home flow. */
let locationUiNavigateAfterPick = null;

/**
 * Applies the place from the current URL path (and migrates old `?city=` once).
 * Used on first load and on browser back/forward.
 */
function applyCityFromCurrentUrl() {
    const city = readCityFromUrl();
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
    refreshSiteHeaderToolsNav();
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
            const label = suggestionItemLabel(item);
            return '<button type="button" class="suggestion-item" role="option" data-index="' + i + '" aria-selected="false">' + escapeHtml(label) + '</button>';
        }).join('');
        suggestionsDropdown.querySelectorAll('.suggestion-item').forEach((btn, i) => {
            // Keep focus on the input so blur+timeout does not remove the list before click fires.
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', () => {
                inputCity.value = suggestionItemLabel(state.suggestionsList[i]);
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
    const cached = getCachedSuggestions(query);
    if (cached) {
        showSuggestions(cached);
        return;
    }
    showSuggestionsLoading();
    const url = '/popular-cities.php?q=' + encodeURIComponent(query) + '&limit=6';
    fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
    })
        .then((res) => res.ok ? res.json() : null)
        .then((json) => {
            const cities = json && json.success && json.data && Array.isArray(json.data.cities) ? json.data.cities : [];
            if (cities.length) {
                setCachedSuggestions(query, cities);
                showSuggestions(cities);
            } else {
                showSuggestions([]);
            }
        })
        .catch(() => showSuggestions([]));
}

function suggestionItemLabel(item) {
    if (!item) return '';
    if (typeof item === 'string') return item.trim();
    if (typeof item.label === 'string' && item.label.trim()) return item.label.trim();
    return englishPlaceLabelFromNominatim(item);
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
        inputCity.value = suggestionItemLabel(state.suggestionsList[idx]);
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
    const onErr = (err) => {
        state.currentCoords = null;
        const msg = err.code === 1 ? 'Location permission denied.'
            : err.code === 2 ? 'Location unavailable.'
            : 'Could not get location.';
        setStatus(msg, 'error');
        showLoading(false);
    };

    if (locationUiNavigateAfterPick) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                setStatus('Finding address…');
                const cached = getCachedReverseLabel(lat, lon);
                const p = cached ? Promise.resolve(cached) : reverseGeocodeLatLonToAddress(lat, lon);
                p.then((addr) => {
                    if (addr) {
                        setStatus('Using: ' + addr, 'success');
                        locationUiNavigateAfterPick(addr);
                    } else {
                        setStatus('Could not resolve address from GPS. Try searching for a city.', 'error');
                    }
                }).catch(() => {
                    setStatus('Could not resolve address from GPS.', 'error');
                });
            },
            onErr,
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
        );
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
            refreshSiteHeaderToolsNav();
            reverseGeocodeAndUpdateLocation();
        },
        onErr,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
}

/**
 * Turns lat/lon into a readable place name (prefers district over a distant big city)
 * and refreshes the results header + method recommendation when done.
 */
function compactLabelFromNominatimReverse(data) {
    var address = data && data.address ? data.address : null;
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
    if (district) settlement = district;
    else if (!settlement && district) settlement = district;
    var compact = [settlement, region, country].filter(Boolean).join(', ');
    return compact || englishPlaceLabelFromNominatim(data) || null;
}

function reverseGeocodeLatLonToAddress(lat, lon) {
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) +
        '&lon=' + encodeURIComponent(lon) + '&zoom=18&addressdetails=1&namedetails=1&accept-language=en';
    esajdaLog('nominatim', 'GET reverse (label)', { lat, lon });
    return fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'e-Sajda/1.0 (Prayer Times)'
        }
    })
        .then((res) => res.json())
        .then((data) => {
            var label = compactLabelFromNominatimReverse(data);
            if (label) setCachedReverseLabel(lat, lon, label);
            return label;
        });
}

function reverseGeocodeAndUpdateLocation() {
    if (!state.currentCoords) return;
    var lat = state.currentCoords.latitude;
    var lon = state.currentCoords.longitude;
    var cachedLabel = getCachedReverseLabel(lat, lon);
    if (cachedLabel) {
        esajdaLog('nominatim', 'reverse geocode cache HIT', { lat, lon });
        state.currentAddress = cachedLabel;
        var cachedMethodName = state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.method && state.lastTodayData.meta.method.name
            ? state.lastTodayData.meta.method.name
            : '—';
        setResultsContext(getDisplayLocation(), cachedMethodName);
        updateMethodRecommendation();
        refreshSiteHeaderToolsNav();
        return;
    }

    reverseGeocodeLatLonToAddress(lat, lon)
        .then((label) => {
            if (!label) return;
            state.currentAddress = label;
            var methodName = state.lastTodayData && state.lastTodayData.meta && state.lastTodayData.meta.method && state.lastTodayData.meta.method.name
                ? state.lastTodayData.meta.method.name
                : '—';
            setResultsContext(getDisplayLocation(), methodName);
            updateMethodRecommendation();
            refreshSiteHeaderToolsNav();
        })
        .catch(() => {
            /* keep coords-only label */
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
    if (locationUiNavigateAfterPick) {
        setStatus('Loading…', 'success');
        locationUiNavigateAfterPick(city);
        return;
    }
    state.currentAddress = city;
    state.currentCoords = null;
    state.useCoordinates = false;
    setStatus('Using: ' + city, 'success');
    replaceBrowserUrlWithCity(city);
    updateMethodRecommendation();
    fetchPrayerTimes();
    refreshSiteHeaderToolsNav();
}

/**
 * Attaches all location-related listeners: GPS button, search button, suggestion
 * keyboard/mouse behavior, and click-outside to close the dropdown.
 * @param {{ navigateAfterPick?: (address: string) => void }} [options] — on tool pages, navigate instead of home SPA.
 */
export function bindLocationUI(options) {
    locationUiNavigateAfterPick = options && typeof options.navigateAfterPick === 'function' ? options.navigateAfterPick : null;

    const inputCity = $('input-city');
    const suggestionsDropdown = $('suggestions-dropdown');
    const btnUse = $('btn-use-location');
    const btnSearch = $('btn-search-city');
    if (!btnUse || !btnSearch) return;

    btnUse.addEventListener('click', useLocation);
    btnSearch.addEventListener('click', useCity);

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

    if (!locationUiNavigateAfterPick) {
        window.addEventListener('popstate', applyCityFromCurrentUrl);
    }
}

/** If the page was opened with `?city=…`, run the same flow as a manual city search. */
export function applyCityFromUrlOnStartup() {
    applyCityFromCurrentUrl();
}