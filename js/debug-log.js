/**
 * Browser console logging for API / network tracing.
 *
 * Enabled by default. To silence:
 *   window.__ESAJDA_DEBUG__ = false
 * or: localStorage.setItem('esajdaDebug', '0')
 */

export function esajdaDebugEnabled() {
    if (typeof window === 'undefined') return false;
    if (window.__ESAJDA_DEBUG__ === false) return false;
    try {
        if (localStorage.getItem('esajdaDebug') === '0') return false;
    } catch (_) {
        /* ignore */
    }
    return true;
}

/** Serialize detail for one-line logs (avoids some consoles showing only "Object"). */
function formatDetail(detail) {
    if (detail === undefined) return '';
    if (detail === null) return ' null';
    const t = typeof detail;
    if (t === 'string' || t === 'number' || t === 'boolean') return ' ' + String(detail);
    try {
        return ' ' + JSON.stringify(detail);
    } catch (_) {
        return ' [detail]';
    }
}

/**
 * @param {string} category - e.g. 'api', 'weather', 'nominatim'
 * @param {string} message
 * @param {unknown} [detail] - optional payload (embedded in the line as JSON)
 */
export function esajdaLog(category, message, detail) {
    if (!esajdaDebugEnabled()) return;
    const line = '[e-Sajda] [' + category + '] ' + message + formatDetail(detail);
    console.log(line);
}
