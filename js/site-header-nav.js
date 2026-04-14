import { readLocationPathPrefix, pageHref } from './page-location.js';
import { pathPrefixFromAddress, readCityFromUrl } from './location-routing.js';
import { state } from './state.js';

const HOME_NO_LOCATION = '/';

function normalizePath(p) {
    return String(p || '').replace(/\/+$/, '') || '/';
}

function effectivePathPrefix() {
    const fromUrl = readLocationPathPrefix();
    if (fromUrl) return fromUrl;
    const addr = state.currentAddress && String(state.currentAddress).trim();
    if (addr) return pathPrefixFromAddress(addr);
    return '';
}

function addressForCrumbs() {
    const fromState = state.currentAddress && String(state.currentAddress).trim();
    if (fromState) return fromState;
    const fromUrl = readCityFromUrl();
    if (fromUrl) return fromUrl;
    return '';
}

function cityLabelOnly(fullAddress) {
    const s = String(fullAddress || '').trim();
    if (!s) return '';
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    return parts[0] || s;
}

function currentSectionKey() {
    const path = normalizePath(window.location.pathname).toLowerCase();
    if (path === '/' || path === '/index.html') return 'home';
    if (path.indexOf('/prayer-times') !== -1) return 'prayer';
    if (path === '/times') return 'time';
    if (path.endsWith('/time')) return 'time';
    // Location root is the Time page.
    const prefix = readLocationPathPrefix();
    if (prefix && normalizePath('/' + prefix).toLowerCase() === path) return 'time';
    if (path.endsWith('/sun')) return 'sun';
    if (path.endsWith('/weather')) return 'weather';
    return 'other';
}

function pageTitleForCrumb(sectionKey) {
    if (sectionKey === 'prayer') return 'Prayer Times Today';
    if (sectionKey === 'time') return 'Local Time';
    if (sectionKey === 'sun') return 'Sunrise/Sunset';
    if (sectionKey === 'weather') return 'Weather';
    return '';
}

function hydrateBreadcrumbs() {
    const el = document.getElementById('site-breadcrumbs');
    if (!el) return;

    const section = currentSectionKey();
    const addr = addressForCrumbs();
    const city = cityLabelOnly(addr);
    const leaf = pageTitleForCrumb(section);

    const parts = [];
    parts.push('<a href="/">Home</a>');

    if (city) {
        parts.push('<span class="site-breadcrumb-sep">/</span>');
        parts.push('<a href="/">Cities</a>');
        parts.push('<span class="site-breadcrumb-sep">/</span>');
        parts.push('<span>' + escapeHtml(city) + '</span>');
        if (leaf) {
            parts.push('<span class="site-breadcrumb-sep">/</span>');
            parts.push('<span>' + escapeHtml(leaf) + '</span>');
        }
    } else if (leaf) {
        parts.push('<span class="site-breadcrumb-sep">/</span>');
        parts.push('<span>' + escapeHtml(leaf) + '</span>');
    }

    el.innerHTML = parts.join(' ');
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const TABS = [
    { key: 'time', label: 'Time', icon: '⏱️', seg: 'time', enabled: true },
    { key: 'sun', label: 'Sunrise/Sunset', icon: '☀️', seg: 'sun', enabled: true },
    { key: 'moon', label: 'Moon', icon: '🌙', seg: null, enabled: false },
    { key: 'weather', label: 'Weather', icon: '🌦️', seg: 'weather', enabled: true },
    { key: 'air', label: 'Air Quality', icon: '🌫️', seg: null, enabled: false },
    { key: 'eclipses', label: 'Eclipses', icon: '🟣', seg: null, enabled: false },
    { key: 'prayer', label: 'Prayer', icon: '🕌', seg: 'prayer-times', enabled: true },
];

function hydrateTabs() {
    const nav = document.getElementById('site-tabs');
    if (!nav) return;

    const prefix = effectivePathPrefix();
    const here = currentSectionKey();
    const hasPlace = Boolean(prefix);

    nav.innerHTML = TABS.map((t) => {
        const enabled = t.enabled && hasPlace && t.seg;
        const href = enabled ? pageHref(prefix, t.seg) : HOME_NO_LOCATION;
        const current = enabled && t.key === here ? ' aria-current="page"' : (t.key === here ? ' aria-current="page"' : '');
        const disabled = enabled ? '' : ' aria-disabled="true"';
        const title = enabled ? '' : ' title="Choose a location on the home page first"';
        return (
            '<a class="site-tab" href="' +
            href +
            '"' +
            title +
            current +
            disabled +
            '>' +
            '<span class="site-tab-icon" aria-hidden="true">' +
            escapeHtml(t.icon) +
            '</span>' +
            '<span class="site-tab-label">' +
            escapeHtml(t.label) +
            '</span>' +
            '</a>'
        );
    }).join('');
}

function hydrate() {
    hydrateBreadcrumbs();
    hydrateTabs();
}

export function refreshSiteHeaderToolsNav() {
    hydrateBreadcrumbs();
    hydrateTabs();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
} else {
    hydrate();
}
