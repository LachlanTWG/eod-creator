const db = require('../db');

/**
 * Persist an EOW report snapshot to Postgres. Google Sheets archiving was
 * removed — Postgres is the sole source and the dashboard reads it directly.
 * insertReport upserts on (company, person, type, period).
 */
async function archiveWeekly(spreadsheetId, salesPerson, startDate, endDate, message, counts, efficiencyRates, ownerName, companyName) {
  if (!db.isEnabled() || !companyName) return;
  try {
    await db.insertReport({
      companyName, salesPersonName: salesPerson,
      reportType: 'eow', periodStart: startDate, periodEnd: endDate,
      formattedText: message, counts, efficiencyRates,
    });
  } catch (e) {
    console.error(`[archiveWeekly] db insert failed (${companyName}/${salesPerson}/${startDate}):`, e.message);
  }
}

module.exports = { archiveWeekly };
