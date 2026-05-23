const { appendRows } = require('../sheets/writeSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');
const db = require('../db');

/**
 * Archive an EOY snapshot to the Yearly Storage tab.
 */
async function archiveYearly(spreadsheetId, salesPerson, year, message, counts, efficiencyRates, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Yearly' : `${salesPerson} Yearly`;
  const outcomeNames = getOutcomeNames(ownerName, companyName);

  const row = [String(year), message];
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
  console.log(`Archived yearly data for ${salesPerson} (${year}) to "${tabName}".`);

  if (db.isEnabled() && companyName) {
    try {
      await db.insertReport({
        companyName, salesPersonName: salesPerson,
        reportType: 'eoy', periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
        formattedText: message, counts, efficiencyRates,
      });
    } catch (e) {
      console.error(`[archiveYearly] db insert failed (${companyName}/${salesPerson}/${year}):`, e.message);
    }
  }
}

module.exports = { archiveYearly };
