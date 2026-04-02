const { appendRows } = require('../sheets/writeSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');

/**
 * Archive an EOD snapshot to the Daily Storage tab.
 */
async function archiveDaily(spreadsheetId, salesPerson, date, message, counts, names, ownerName, companyName) {
  const tabName = salesPerson === 'Team' ? 'Team Daily' : `${salesPerson} Daily`;
  const outcomeNames = getOutcomeNames(ownerName, companyName);

  const row = [date, message];
  for (const name of outcomeNames) {
    row.push(String(counts[name] || 0));
    const contactNames = names[name] || [];
    row.push(contactNames.join(', '));
  }

  await appendRows(spreadsheetId, tabName, [row]);

  // Update the "Last Generated" field on the EOD config tab
  const eodTab = salesPerson === 'Team' ? 'Team EOD' : `${salesPerson} EOD`;
  const lastGenRow = salesPerson === 'Team' ? 3 : 4;
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  await writeSheet(spreadsheetId, `'${eodTab}'!B${lastGenRow}`, [[now]]);

  console.log(`Archived daily data for ${salesPerson} on ${date} to "${tabName}".`);
}

module.exports = { archiveDaily };
