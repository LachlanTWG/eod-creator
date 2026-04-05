const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildMonthlyStorageRow } = require('../sheets/populateFormulas');

/**
 * Archive an EOM snapshot to the Monthly Storage tab using live formulas.
 * If the row already exists (from populateFormulas), updates the message only.
 */
async function archiveMonthly(spreadsheetId, salesPerson, year, month, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Monthly' : `${salesPerson} Monthly`;
  const isTeam = salesPerson === 'Team';
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const existing = await readTab(spreadsheetId, tabName);

  // Check if a row for this month already exists
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === monthStr) {
      existingRowIdx = i;
      break;
    }
  }

  if (existingRowIdx >= 0) {
    // Row exists — just update the message column (B)
    const sheetRow = existingRowIdx + 1;
    await writeSheet(spreadsheetId, `'${tabName}'!B${sheetRow}`, [[message]]);
    console.log(`Updated monthly message for ${salesPerson} (${monthStr}) in "${tabName}" row ${sheetRow}.`);
  } else {
    // Row doesn't exist — append a new formula row
    const newRowNum = existing.length + 1;
    const row = buildMonthlyStorageRow(monthStr, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
    await appendRows(spreadsheetId, tabName, [row]);
    console.log(`Archived monthly data for ${salesPerson} (${monthStr}) to "${tabName}" (formula row ${newRowNum}).`);
  }
}

module.exports = { archiveMonthly };
