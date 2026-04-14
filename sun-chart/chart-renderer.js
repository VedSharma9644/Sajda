/**
 * Chart.js yearly sunrise/sunset band chart.
 */

let chartImportPromise = null;
let chartInstance = null;

function loadChart() {
    if (!chartImportPromise) {
        chartImportPromise = import('https://esm.sh/chart.js@4.4.1/auto').then((m) => {
            const C = m.default;
            if (typeof C === 'function') return C;
            if (m.Chart) return m.Chart;
            throw new Error('Chart.js failed to load');
        });
    }
    return chartImportPromise;
}

function formatClockMinutes(m) {
    if (m == null || Number.isNaN(m)) return '';
    const total = Math.round(m);
    const h = Math.floor(total / 60) % 24;
    const min = total % 60;
    const ampm = h >= 12 ? 'p' : 'a';
    const h12 = h % 12 || 12;
    return h12 + ':' + String(min).padStart(2, '0') + ampm;
}

/** 24-hour clock for twilight / noon block in tooltip (matches typical solar apps). */
function formatClock24(m) {
    if (m == null || Number.isNaN(m)) return '—';
    const total = Math.round(m) % (24 * 60);
    const h = Math.floor(total / 60);
    const min = total % 60;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function longDateTitle(mmdd, year) {
    const parts = String(mmdd).split('/');
    if (parts.length !== 2) return mmdd + ', ' + year;
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    if (!month || !day) return mmdd + ', ' + year;
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime())) return mmdd + ', ' + year;
    try {
        return d.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (_) {
        return mmdd + ', ' + year;
    }
}

/** Vertical gradient: warm at bottom (early day) → cool at top (evening). */
function daylightGradient(ctx, chartArea, darkTheme) {
    if (!chartArea || chartArea.width <= 0 || chartArea.height <= 0) {
        return darkTheme ? 'rgba(251, 191, 36, 0.15)' : 'rgba(245, 158, 11, 0.2)';
    }
    const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    if (darkTheme) {
        g.addColorStop(0, 'rgba(251, 191, 36, 0.28)');
        g.addColorStop(0.45, 'rgba(251, 146, 60, 0.14)');
        g.addColorStop(1, 'rgba(167, 139, 250, 0.28)');
    } else {
        g.addColorStop(0, 'rgba(245, 158, 11, 0.35)');
        g.addColorStop(0.45, 'rgba(249, 115, 22, 0.12)');
        g.addColorStop(1, 'rgba(139, 92, 246, 0.3)');
    }
    return g;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   labels: string[],
 *   sunriseMin: (number|null)[],
 *   sunsetMin: (number|null)[],
 *   year: number,
 *   dayCount?: number,
 *   dayExtras?: { label: string, minutes: number }[][]
 * }} data
 * @param {boolean} darkTheme
 */
export async function renderYearlySunChart(canvas, data, darkTheme) {
    const Chart = await loadChart();
    const reduceMotion =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    const text = darkTheme ? '#e7e9ea' : '#0f1419';
    const grid = darkTheme ? 'rgba(56, 68, 77, 0.65)' : 'rgba(208, 218, 228, 0.9)';
    const sunriseLine = darkTheme ? '#fbbf24' : '#d97706';
    const sunsetLine = darkTheme ? '#c4b5fd' : '#7c3aed';
    const tooltipBg = darkTheme ? 'rgba(22, 27, 34, 0.96)' : 'rgba(255, 255, 255, 0.97)';
    const tooltipBorder = darkTheme ? 'rgba(251, 191, 36, 0.35)' : 'rgba(124, 58, 237, 0.35)';
    const dayExtras = data.dayExtras || [];
    const dayCount = data.dayCount ?? data.labels.length;
    const chartTitle =
        'Sunrise & sunset — ' + data.year + (dayCount ? ' · ' + dayCount + ' days' : '');

    chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Sunrise',
                    data: data.sunriseMin,
                    borderColor: sunriseLine,
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: sunriseLine,
                    pointHoverBorderColor: darkTheme ? '#0f1419' : '#fff',
                    tension: 0.35,
                    fill: false,
                    spanGaps: false
                },
                {
                    label: 'Sunset',
                    data: data.sunsetMin,
                    borderColor: sunsetLine,
                    backgroundColor(context) {
                        const chart = context.chart;
                        const { ctx: c, chartArea } = chart;
                        return daylightGradient(c, chartArea, darkTheme);
                    },
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: sunsetLine,
                    pointHoverBorderColor: darkTheme ? '#0f1419' : '#fff',
                    tension: 0.35,
                    fill: '-1',
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: reduceMotion
                ? false
                : {
                      duration: 1400,
                      easing: 'easeOutQuart'
                  },
            transitions: {
                active: {
                    animation: reduceMotion
                        ? { duration: 0 }
                        : { duration: 280, easing: 'easeOutQuad' }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    color: text,
                    font: { size: 14, weight: '600' },
                    padding: { bottom: 8 }
                },
                legend: {
                    labels: {
                        color: text,
                        usePointStyle: true,
                        pointStyle: 'line',
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: tooltipBg,
                    titleColor: text,
                    bodyColor: text,
                    borderColor: tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    displayColors: true,
                    boxPadding: 6,
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    animation: { duration: reduceMotion ? 0 : 180 },
                    labelColor(ctx) {
                        const c = ctx.dataset.borderColor;
                        return {
                            borderColor: c,
                            backgroundColor: c
                        };
                    },
                    itemSort: (a, b) => {
                        const ay = a.parsed.y;
                        const by = b.parsed.y;
                        if (ay == null) return 1;
                        if (by == null) return -1;
                        return ay - by;
                    },
                    callbacks: {
                        title(items) {
                            if (!items.length) return '';
                            const i = items[0].dataIndex;
                            const lab = data.labels[i];
                            return longDateTitle(lab, data.year);
                        },
                        label(ctx) {
                            const v = ctx.parsed.y;
                            if (v == null) return ctx.dataset.label + ': —';
                            return ctx.dataset.label + ': ' + formatClock24(v);
                        },
                        afterBody(items) {
                            if (!items.length) return undefined;
                            const i = items[0].dataIndex;
                            const rows = dayExtras[i];
                            if (!rows || !rows.length) return undefined;
                            const lines = ['Twilight, noon & more (24h):'];
                            for (const r of rows) {
                                lines.push(r.label + ': ' + formatClock24(r.minutes));
                            }
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: text,
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 24
                    },
                    grid: { color: grid }
                },
                y: {
                    min: 0,
                    max: 24 * 60,
                    ticks: {
                        color: text,
                        stepSize: 120,
                        callback(v) {
                            return formatClockMinutes(v);
                        }
                    },
                    grid: { color: grid },
                    title: {
                        display: true,
                        text: 'Local time',
                        color: text
                    }
                }
            }
        }
    });

    return chartInstance;
}

export function destroyYearlySunChart() {
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}
