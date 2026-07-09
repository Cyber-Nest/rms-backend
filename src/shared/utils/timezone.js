/**
 * Timezone Utility — Restaurant Local Timezone (America/Edmonton)
 * 
 * All date/time operations in this system should use these helpers
 * to ensure consistency with the restaurant's local timezone.
 * 
 * Local timezone (Edmonton/Alberta) uses:
 *   MST (Mountain Standard Time) = UTC-7  (Nov–Mar)
 *   MDT (Mountain Daylight Time) = UTC-6  (Mar–Nov)
 * 
 * Luxon handles DST transitions automatically via IANA timezone.
 */

const { DateTime } = require("luxon");

const TIMEZONE = "America/Edmonton";

/**
 * Get the current date-string (YYYY-MM-DD) in local time.
 * @param {Date|string} [date] - Optional date to convert. Defaults to now.
 */
function getLocalDateStr(date) {
  if (date) {
    const dt = DateTime.fromJSDate(new Date(date)).setZone(TIMEZONE);
    return dt.toFormat("yyyy-MM-dd");
  }
  return DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd");
}

/**
 * Get the UTC Date object representing the START of a day in local time.
 * @param {string} dateStr - Date string in YYYY-MM-DD format.
 * @returns {Date}
 */
function getLocalStartOfDay(dateStr) {
  const dt = DateTime.fromISO(dateStr, { zone: TIMEZONE }).startOf("day");
  return dt.toJSDate();
}

/**
 * Get the UTC Date object representing the END of a day in local time.
 * @param {string} dateStr - Date string in YYYY-MM-DD format.
 * @returns {Date}
 */
function getLocalEndOfDay(dateStr) {
  const dt = DateTime.fromISO(dateStr, { zone: TIMEZONE }).endOf("day");
  return dt.toJSDate();
}

/**
 * Get the hour (0-23) in local time for a given date.
 * @param {Date|string} date
 * @returns {number}
 */
function getLocalHour(date) {
  return DateTime.fromJSDate(new Date(date)).setZone(TIMEZONE).hour;
}

/**
 * Get the day name (Monday, Tuesday, etc.) in local time for a given date.
 * @param {Date|string} date
 * @returns {string}
 */
function getLocalDayName(date) {
  return DateTime.fromJSDate(new Date(date)).setZone(TIMEZONE).toFormat("EEEE");
}

/**
 * Format a date to local display: MM/DD/YYYY HH:mm
 * @param {Date|string} date
 * @returns {string}
 */
function formatLocalDateTime(date) {
  const dt = DateTime.fromJSDate(new Date(date)).setZone(TIMEZONE);
  return dt.toFormat("MM/dd/yyyy HH:mm");
}

/**
 * Get local "now" as a Luxon DateTime 
 * @returns {DateTime}
 */
function getLocalNow() {
  return DateTime.now().setZone(TIMEZONE);
}

module.exports = {
  TIMEZONE,
  getLocalDateStr,
  getLocalStartOfDay,
  getLocalEndOfDay,
  getLocalHour,
  getLocalDayName,
  formatLocalDateTime,
  getLocalNow,
};
