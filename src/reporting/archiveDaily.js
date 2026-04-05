const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildDailyStorageRow } = require('../sheets/populateFormulas');

/**
 * Archive an EOD snapshot to the Daily Storage tab using live formulas.
 */
async function archiveDaily(spreadsheetId, salesPerson, date, message, counts, names, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Daily' : `${salesPerson} Daily`;
  const isTeam = salesPerson === 'Team';

  // Determine the row number for the new row
  const existing = await readTab(spreadsheetId, tabName);
  const newRowNum = existing.length + 1;

  const row = buildDailyStorageRow(date, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
  await appendRows(spreadsheetId, tabName, [row]);

  // Update the "Last Generated" field on the EOD config tab
  const eodTab = salesPerson === 'Team' ? 'Team EOD' : `${salesPerson} EOD`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eodTab}'!B${lastGenRow}`, [[now]]);

  console.log(`Archived daily data for ${salesPerson} on ${date} to "${tabName}" (formula row ${newRowNum}).`);
}

module.exports = { archiveDaily };
