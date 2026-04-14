/**
 * Prefetch time-meta (and warm related server caches) before navigating to /…/time.
 * Time page reads the same payload from sessionStorage for an instant first paint.
 */

const STORAGE_KEY = 'esajda.prefetch.timeMeta.v1';
const MAX_AGE_MS = 5 * 60 * 1000;

export function saveTimeMetaPrefetch(address, data) {
    const addr = String(address || '').trim();
    if (!addr || !data || typeof data !== 'object') return;
    try {
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                address: addr,
                data,
                savedAt: Date.now(),
            })
        );
    } catch (_) {
        /* quota / private mode */
    }
}

/** Returns cached time-meta `data` if it matches `address` and is fresh enough. */
export function readTimeMetaPrefetch(address) {
    const addr = String(address || '').trim();
    if (!addr) return null;
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const row = JSON.parse(raw);
        if (!row || row.address !== addr || !row.data || typeof row.data !== 'object') return null;
        if (typeof row.savedAt !== 'number' || Date.now() - row.savedAt > MAX_AGE_MS) return null;
        return row.data;
    } catch (_) {
        return null;
    }
}

export async function prefetchTimeMetaForAddress(address) {
    const addr = String(address || '').trim();
    if (!addr) return null;
    try {
        const url = new URL('/time-meta.php', window.location.origin);
        url.searchParams.set('address', addr);
        const r = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j || !j.success || !j.data) return null;
        saveTimeMetaPrefetch(addr, j.data);
        return j.data;
    } catch (_) {
        return null;
    }
}

/**
 * Fire-and-forget: warm SQLite (and edge caches) for secondary widgets so the time
 * page’s follow-up fetches are mostly cache hits.
 */
export function warmTimePageCaches(address, tm) {
    const addr = String(address || '').trim();
    if (!addr || !tm || typeof tm !== 'object') return;

    const cc = tm.country_code ? String(tm.country_code).trim().toLowerCase() : '';
    const region = tm.region ? String(tm.region).trim() : '';
    const lat = tm.latitude;
    const lon = tm.longitude;

    const origin = window.location.origin;

    if (cc && region) {
        try {
            const u = new URL('/region-cities.php', origin);
            u.searchParams.set('country_code', cc);
            u.searchParams.set('region', region);
            u.searchParams.set('limit', '30');
            fetch(u.toString(), { credentials: 'same-origin' }).catch(() => {});
        } catch (_) {
            /* ignore */
        }
    }
    if (cc) {
        try {
            const u = new URL('/country-cities.php', origin);
            u.searchParams.set('country_code', cc);
            u.searchParams.set('limit', '30');
            fetch(u.toString(), { credentials: 'same-origin' }).catch(() => {});
        } catch (_) {
            /* ignore */
        }
        try {
            const u = new URL('/country-info.php', origin);
            u.searchParams.set('code', cc);
            fetch(u.toString(), { credentials: 'same-origin' }).catch(() => {});
        } catch (_) {
            /* ignore */
        }
    }
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        try {
            const u = new URL('/weather.php', origin);
            u.searchParams.set('latitude', String(lat));
            u.searchParams.set('longitude', String(lon));
            fetch(u.toString(), { credentials: 'same-origin' }).catch(() => {});
        } catch (_) {
            /* ignore */
        }
    }
}

/**
 * Navigate to the time URL immediately so the user is not stuck on the previous page
 * while upstream APIs run. Prefetch + cache warming run in parallel; if they finish
 * before unload, sessionStorage may still get a hit for first paint on /…/time.
 */
export function prefetchThenAssign(address, href) {
    const addr = String(address || '').trim();
    if (!addr) {
        window.location.assign(href);
        return;
    }
    void prefetchTimeMetaForAddress(addr).then((tm) => {
        if (tm) {
            warmTimePageCaches(addr, tm);
        }
    });
    window.location.assign(href);
}
