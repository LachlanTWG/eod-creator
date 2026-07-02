const db = require('../db');

/**
 * Persist an EOY report snapshot to Postgres. Google Sheets archiving was
 * removed — Postgres is the sole source and the dashboard reads it directly.
 * insertReport upserts on (company, person, type, period).
 */
async function archiveYearly(spreadsheetId, salesPerson, year, message, counts, efficiencyRates, ownerName, companyName) {
  if (!db.isEnabled() || !companyName) return;
  try {
    await db.insertReport({
      companyName, salesPersonName: salesPerson,
      reportType: 'eoy', periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
      formattedText: message, counts, efficiencyRates,
    });
  } catch (e) {
    console.error(`[archiveYearly] db insert failed (${companyName}/${salesPerson}/${year}):`, e.message);
  }
}

module.exports = { archiveYearly };
