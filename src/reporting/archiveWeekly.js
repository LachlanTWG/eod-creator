const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');

/**
 * Archive an EOW snapshot to the Weekly Storage tab.
 */
async function archiveWeekly(spreadsheetId, salesPerson, startDate, endDate, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Weekly' : `${salesPerson} Weekly`;
  const outcomeNames = getOutcomeNames(ownerName, companyName);

  const row = [startDate, endDate, message];
  for (const name of outcomeNames) {
    row.push(String(counts[name] || 0));
  }

  // Dynamic efficiency rates from config
  const { blocks } = loadConfig(companyName);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (computedBlock) {
    for (const comp of computedBlock.computed) {
      row.push(String(efficiencyRates[comp.name] || 0));
    }
  }

  await appendRows(spreadsheetId, tabName, [row]);

  // Update Last Generated on EOW config tab
  const eowTab = salesPerson === 'Team' ? 'Team EOW' : `${salesPerson} EOW`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eowTab}'!B${lastGenRow}`, [[now]]);

  console.log(`Archived weekly data for ${salesPerson} (${startDate} to ${endDate}) to "${tabName}".`);
}

module.exports = { archiveWeekly };
