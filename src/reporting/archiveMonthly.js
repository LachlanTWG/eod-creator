const { appendRows } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');
const { buildMonthlyStorageRow } = require('../sheets/populateFormulas');

/**
 * Archive an EOM snapshot to the Monthly Storage tab using live formulas.
 */
async function archiveMonthly(spreadsheetId, salesPerson, year, month, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Monthly' : `${salesPerson} Monthly`;
  const isTeam = salesPerson === 'Team';
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  // Determine the row number for the new row
  const existing = await readTab(spreadsheetId, tabName);
  const newRowNum = existing.length + 1;

  const row = buildMonthlyStorageRow(monthStr, newRowNum, salesPerson, companyName, ownerName, isTeam, message);
  await appendRows(spreadsheetId, tabName, [row]);

  console.log(`Archived monthly data for ${salesPerson} (${monthStr}) to "${tabName}" (formula row ${newRowNum}).`);
}

module.exports = { archiveMonthly };
