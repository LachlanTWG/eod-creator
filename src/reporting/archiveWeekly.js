const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildWeeklyStorageRow } = require('../sheets/populateFormulas');

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

/**
 * Archive an EOW snapshot to the Weekly Storage tab using live formulas.
 * If the row already exists (from populateFormulas), updates the message only.
 */
async function archiveWeekly(spreadsheetId, salesPerson, startDate, endDate, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Weekly' : `${salesPerson} Weekly`;
  const isTeam = salesPerson === 'Team';

  const existing = await readTab(spreadsheetId, tabName);

  // Check if a row for this week already exists
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (parseSerialDate(existing[i][0]) === startDate) {
      existingRowIdx = i;
      break;
    }
  }

  if (existingRowIdx >= 0) {
    // Row exists — just update the message column (C)
    const sheetRow = existingRowIdx + 1;
    await writeSheet(spreadsheetId, `'${tabName}'!C${sheetRow}`, [[message]]);
    console.log(`Updated weekly message for ${salesPerson} (${startDate} to ${endDate}) in "${tabName}" row ${sheetRow}.`);
  } else {
    // Row doesn't exist — append a new formula row
    const newRowNum = existing.length + 1;
    const row = buildWeeklyStorageRow(startDate, endDate, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
    await appendRows(spreadsheetId, tabName, [row]);
    console.log(`Archived weekly data for ${salesPerson} (${startDate} to ${endDate}) to "${tabName}" (formula row ${newRowNum}).`);
  }

  // Update Last Generated on EOW config tab
  const eowTab = salesPerson === 'Team' ? 'Team EOW' : `${salesPerson} EOW`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eowTab}'!B${lastGenRow}`, [[now]]);
}

module.exports = { archiveWeekly };
