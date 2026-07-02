const db = require('../db');

/**
 * Persist an EOM report snapshot to Postgres. Google Sheets archiving was
 * removed — Postgres is the sole source and the dashboard reads it directly.
 * insertReport upserts on (company, person, type, period).
 */
async function archiveMonthly(spreadsheetId, salesPerson, year, month, message, counts, efficiencyRates, ownerName, companyName) {
  if (!db.isEnabled() || !companyName) return;
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);  // last day of month
  try {
    await db.insertReport({
      companyName, salesPersonName: salesPerson,
      reportType: 'eom', periodStart, periodEnd,
      formattedText: message, counts, efficiencyRates,
    });
  } catch (e) {
    console.error(`[archiveMonthly] db insert failed (${companyName}/${salesPerson}/${year}-${month}):`, e.message);
  }
}

module.exports = { archiveMonthly };
