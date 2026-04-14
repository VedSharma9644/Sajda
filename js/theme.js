/**
 * Light mode is default. Dark mode is opt-in via toggle + localStorage.
 */

const STORAGE_KEY = 'esajda.theme';

export function getStoredTheme() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch (_) {
        return 'light';
    }
}

export function applyTheme(theme) {
    const dark = theme === 'dark';
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    try {
        if (dark) {
            localStorage.setItem(STORAGE_KEY, 'dark');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (_) {
        /* ignore */
    }
    syncThemeToggleUI();
    import('../sun-chart/sun-chart-entry.js?v=6')
        .then((m) => m.restyleYearlySunChartForTheme())
        .catch(() => {
            /* sun chart optional */
        });
}

function syncThemeToggleUI() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    const label = btn.querySelector('.theme-toggle-label');
    if (label) {
        label.textContent = isDark ? 'Light mode' : 'Dark mode';
    }
    const icon = btn.querySelector('.theme-toggle-icon');
    if (icon) {
        icon.textContent = isDark ? '☀️' : '🌙';
    }
}

export function initThemeToggle() {
    applyTheme(getStoredTheme());
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });
}
