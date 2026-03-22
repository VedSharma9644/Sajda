# e-Sajda JavaScript modules

The app is split into modules so you can find and fix issues by area. Each file has a short **module comment** at the top, and **each function** has a human-readable note (what it does and when to use it).

| File | Purpose |
|------|--------|
| **app.js** | Entry point. Wires event listeners, builds month/year dropdowns, runs init. |
| **config.js** | Constants: `PRAYERS`, `MONTHS`, `METHOD_RECOMMENDATIONS`. |
| **state.js** | Shared state: `currentCoords`, `currentAddress`, `useCoordinates`, `lastTodayData`, suggestion state, next-prayer interval. |
| **dom.js** | Helpers: `$`, `show`, `hide`. |
| **utils.js** | Helpers: `getTimezone`, `getTodayDate`, `timeToMinutes`, `getNowMinutesInTimezone`, `formatCountdown`, `escapeHtml`, `getDisplayLocation`. |
| **next-prayer.js** | Next prayer countdown and list highlight: `getNextPrayer`, `updateNextPrayerUI`, `startNextPrayerTick`, `stopNextPrayerTick`. |
| **recommendations.js** | Method recommendation by region: `getRecommendedMethod`, `updateMethodRecommendation`. |
| **render.js** | Results UI: `setStatus`, `setResultsContext`, `showLoading`, `showError`, `clearError`, `renderToday`, `renderMonth`, `onApiResponse`. |
| **api.js** | Backend calls: `buildParams`, `buildAladhanUrl`, `fetchPrayerTimes`, `buildComparisonParams`. |
| **comparison.js** | Karachi comparison: `renderComparison`, `runCompareWithKarachi`. |
| **location.js** | Location and autocomplete: `useLocation`, `useCity`, `closeSuggestions`, `bindLocationUI`. |

Dependencies: `app.js` imports the rest. No circular imports. Load in the browser with `<script src="js/app.js" type="module"></script>`.
