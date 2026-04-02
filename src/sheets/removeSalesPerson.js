const { writeSheet } = require('./writeSheet');
const { readSheet } = require('./readSheet');
const fs = require('fs');
const path = require('path');

/**
 * Mark a sales person as inactive (does not delete tabs).
 */
async function removeSalesPerson(spreadsheetId, personName, companyName) {
  // Update Settings registry
  const settingsData = await readSheet(spreadsheetId, "'Settings'!M:O");
  for (let i = 0; i < settingsData.length; i++) {
    if (settingsData[i][0] === personName) {
      await writeSheet(spreadsheetId, `'Settings'!N${i + 1}`, [['FALSE']]);
      break;
    }
  }

  // Update companies config
  const { loadCompanies: loadCo, saveCompanies } = require('../config/companiesStore');
  const companiesData = loadCo();
  const company = companiesData.companies.find(c =>
    c.sheetId === spreadsheetId || c.name === companyName
  );
  if (company) {
    const person = company.salesPeople.find(p => p.name === personName);
    if (person) person.active = false;
    saveCompanies(companiesData);
  }

  console.log(`Marked "${personName}" as inactive.`);
}

module.exports = { removeSalesPerson };
