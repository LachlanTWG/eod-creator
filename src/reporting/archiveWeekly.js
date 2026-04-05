const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildWeeklyStorageRow } = require('../sheets/populateFormulas');

/**
 * Archive an EOW snapshot to the Weekly Storage tab using live formulas.
 */
async function archiveWeekly(spreadsheetId, salesPerson, startDate, endDate, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Weekly' : `${salesPerson} Weekly`;
  const isTeam = salesPerson === 'Team';

  // Determine the row number for the new row
  const existing = await readTab(spreadsheetId, tabName);
  const newRowNum = existing.length + 1;

  const row = buildWeeklyStorageRow(startDate, endDate, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
  await appendRows(spreadsheetId, tabName, [row]);

  // Update Last Generated on EOW config tab
  const eowTab = salesPerson === 'Team' ? 'Team EOW' : `${salesPerson} EOW`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eowTab}'!B${lastGenRow}`, [[now]]);

  console.log(`Archived weekly data for ${salesPerson} (${startDate} to ${endDate}) to "${tabName}" (formula row ${newRowNum}).`);
}

module.exports = { archiveWeekly };
