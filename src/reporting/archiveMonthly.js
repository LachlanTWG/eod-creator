const { appendRows } = require('../sheets/writeSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');

/**
 * Archive an EOM snapshot to the Monthly Storage tab.
 */
async function archiveMonthly(spreadsheetId, salesPerson, year, month, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Monthly' : `${salesPerson} Monthly`;
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const row = [monthStr, message];
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
  console.log(`Archived monthly data for ${salesPerson} (${monthStr}) to "${tabName}".`);
}

module.exports = { archiveMonthly };
