const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildQuarterlyStorageRow } = require('../sheets/populateFormulas');
const db = require('../db');

/**
 * Archive an EOQ snapshot to the Quarterly Storage tab using live formulas.
 * If the row already exists, updates the message only.
 */
async function archiveQuarterly(spreadsheetId, salesPerson, year, quarter, message, counts, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Quarterly' : `${salesPerson} Quarterly`;
  const isTeam = salesPerson === 'Team';
  const quarterStr = `${year}-Q${quarter}`;

  const existing = await readTab(spreadsheetId, tabName);

  // Check if a row for this quarter already exists
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === quarterStr) {
      existingRowIdx = i;
      break;
    }
  }

  if (existingRowIdx >= 0) {
    // Row exists — just update the message column (B)
    const sheetRow = existingRowIdx + 1;
    await writeSheet(spreadsheetId, `'${tabName}'!B${sheetRow}`, [[message]]);
    console.log(`Updated quarterly message for ${salesPerson} (${quarterStr}) in "${tabName}" row ${sheetRow}.`);
  } else {
    // Row doesn't exist — append a new formula row
    const newRowNum = existing.length + 1;
    const row = buildQuarterlyStorageRow(quarterStr, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
    await appendRows(spreadsheetId, tabName, [row]);
    console.log(`Archived quarterly data for ${salesPerson} (${quarterStr}) to "${tabName}" (formula row ${newRowNum}).`);
  }

  if (db.isEnabled() && companyName) {
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
      console.error(`[archiveQuarterly] db insert failed (${companyName}/${salesPerson}/${quarterStr}):`, e.message);
    }
  }
}

module.exports = { archiveQuarterly };
