import { readLocationFromPageUrl } from './page-location.js';
import { initThemeToggle } from './theme.js';
import { state } from './state.js';
import { $, show, hide } from './dom.js';
import { refreshWeatherWidget } from './weather-widget.js?v=30';
import { initMajorCities } from './major-cities.js';

function main() {
    initThemeToggle();
    const loc = readLocationFromPageUrl('weather');
    if (!loc) {
        window.location.replace('/');
        return;
    }

    const heading = $('weather-page-heading');
    if (heading) heading.textContent = 'Weather — ' + loc.address;
    const tagEl = $('site-header-tagline');
    if (tagEl) tagEl.textContent = loc.address;

    state.currentAddress = loc.address;
    state.currentCoords = null;
    state.useCoordinates = false;

    const errEl = $('weather-page-error');
    const section = $('weather-section');
    const hourlySec = $('weather-hourly-section');
    const dailySec = $('weather-daily-section');
    const extrasSec = $('weather-extras-section');

    void refreshWeatherWidget().then(() => {
        requestAnimationFrame(() => {
            const st = $('weather-status');
            const bad = st && /Could not|unavailable/i.test(st.textContent);
            if (bad) {
                show(errEl);
                hide(section);
                if (hourlySec) hide(hourlySec);
                if (dailySec) hide(dailySec);
                if (extrasSec) hide(extrasSec);
            } else {
                show(section);
                hide(errEl);
            }
        });
    });

    void initMajorCities(loc.address);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
