const db = require('../db');

/**
 * Persist an EOD report snapshot to Postgres.
 *
 * Google Sheets archiving (storage-tab formula rows + the EOD "Last Generated"
 * timestamp) was removed — Postgres is the sole source of truth and the
 * dashboard reads it directly. insertReport upserts on
 * (company, person, type, period), so re-running a day just refreshes the row.
 *
 * spreadsheetId / names / ownerName are unused now but kept in the signature so
 * callers (runReports.js, index.js) don't change.
 */
async function archiveDaily(spreadsheetId, salesPerson, date, message, counts, names, ownerName, companyName) {
  if (!db.isEnabled() || !companyName) return;
  try {
    await db.insertReport({
      companyName, salesPersonName: salesPerson,
      reportType: 'eod', periodStart: date, periodEnd: date,
      formattedText: message, counts, names,
    });
  } catch (e) {
    console.error(`[archiveDaily] db insert failed (${companyName}/${salesPerson}/${date}):`, e.message);
  }
}

module.exports = { archiveDaily };
