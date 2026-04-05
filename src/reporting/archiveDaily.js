const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildDailyStorageRow } = require('../sheets/populateFormulas');

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

/**
 * Archive an EOD snapshot to the Daily Storage tab using live formulas.
 * If the row already exists (from populateFormulas), updates the message only.
 */
async function archiveDaily(spreadsheetId, salesPerson, date, message, counts, names, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Daily' : `${salesPerson} Daily`;
  const isTeam = salesPerson === 'Team';

  const existing = await readTab(spreadsheetId, tabName);

  // Check if a row for this date already exists
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (parseSerialDate(existing[i][0]) === date) {
      existingRowIdx = i;
      break;
    }
  }

  if (existingRowIdx >= 0) {
    // Row exists — just update the message column (B)
    const sheetRow = existingRowIdx + 1;
    await writeSheet(spreadsheetId, `'${tabName}'!B${sheetRow}`, [[message]]);
    console.log(`Updated daily message for ${salesPerson} on ${date} in "${tabName}" row ${sheetRow}.`);
  } else {
    // Row doesn't exist — append a new formula row
    const newRowNum = existing.length + 1;
    const row = buildDailyStorageRow(date, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
    await appendRows(spreadsheetId, tabName, [row]);
    console.log(`Archived daily data for ${salesPerson} on ${date} to "${tabName}" (formula row ${newRowNum}).`);
  }

  // Update the "Last Generated" field on the EOD config tab
  const eodTab = salesPerson === 'Team' ? 'Team EOD' : `${salesPerson} EOD`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eodTab}'!B${lastGenRow}`, [[now]]);
}

module.exports = { archiveDaily };
