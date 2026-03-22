/**
 * e-Sajda – Constants and configuration
 *
 * - `PRAYERS`: which columns we show (matches Aladhan field names).
 * - `MONTHS`: labels for the month dropdown.
 * - `METHOD_RECOMMENDATIONS`: rough “if your area looks like X, try method Y” hints.
 */

/** Five daily prayers we display (Fajr through Isha; Sunrise is omitted in the UI). */
export const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

/** English month names for the calendar month picker. */
export const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Each entry: regex tested against timezone string or typed address, plus the
 * method id/name we suggest in the UI (not forced — user can still pick any method).
 */
export const METHOD_RECOMMENDATIONS = [
    { pattern: /india|pakistan|bangladesh|kolkata|calcutta|karachi|lahore|dhaka/i, methodId: '1', methodName: 'University of Islamic Sciences, Karachi', region: 'India / Pakistan' },
    { pattern: /saudi|makkah|riyadh|mecca|arabia/i, methodId: '4', methodName: 'Umm Al-Qura University, Makkah', region: 'Saudi Arabia' },
    { pattern: /uae|dubai|emirates|qatar|kuwait|bahrain|gulf|oman/i, methodId: '8', methodName: 'Gulf Region', region: 'Gulf' },
    { pattern: /egypt/i, methodId: '5', methodName: 'Egyptian General Authority', region: 'Egypt' },
    { pattern: /turkey|istanbul/i, methodId: '13', methodName: 'Turkey', region: 'Turkey' },
    { pattern: /jordan/i, methodId: '23', methodName: 'Jordan', region: 'Jordan' },
    { pattern: /america|usa|united states|canada|new york|los angeles/i, methodId: '2', methodName: 'ISNA', region: 'North America' },
    { pattern: /singapore/i, methodId: '11', methodName: 'Singapore', region: 'Singapore' },
    { pattern: /malaysia/i, methodId: '17', methodName: 'JAKIM (Malaysia)', region: 'Malaysia' },
    { pattern: /indonesia/i, methodId: '20', methodName: 'Indonesia', region: 'Indonesia' },
    { pattern: /france|paris/i, methodId: '12', methodName: 'France', region: 'France' },
    { pattern: /asia\/kolkata|asia\/calcutta|asia\/karachi|asia\/dhaka/i, methodId: '1', methodName: 'University of Islamic Sciences, Karachi', region: 'India / Pakistan' },
    { pattern: /asia\/riyadh|asia\/dubai|asia\/qatar|asia\/kuwait|asia\/bahrain|asia\/muscat/i, methodId: '8', methodName: 'Gulf Region', region: 'Gulf' },
    { pattern: /america\//i, methodId: '2', methodName: 'ISNA', region: 'North America' },
    { pattern: /europe\/london|europe\/istanbul/i, methodId: '3', methodName: 'MWL (Muslim World League)', region: 'UK / Turkey' }
];
