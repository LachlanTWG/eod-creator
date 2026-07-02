const db = require('../db');

/**
 * Persist an EOQ report snapshot to Postgres. Google Sheets archiving was
 * removed — Postgres is the sole source and the dashboard reads it directly.
 * insertReport upserts on (company, person, type, period).
 */
async function archiveQuarterly(spreadsheetId, salesPerson, year, quarter, message, counts, ownerName, companyName) {
  if (!db.isEnabled() || !companyName) return;
  const startMonth = (quarter - 1) * 3 + 1;
  const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const periodEnd = new Date(year, startMonth + 2, 0).toISOString().slice(0, 10);  // last day of quarter
  try {
    await db.insertReport({
      companyName, salesPersonName: salesPerson,
      reportType: 'eoq', periodStart, periodEnd,
      formattedText: message, counts,
    });
  } catch (e) {
    console.error(`[archiveQuarterly] db insert failed (${companyName}/${salesPerson}/${year}-Q${quarter}):`, e.message);
  }
}

module.exports = { archiveQuarterly };
