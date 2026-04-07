/**
 * Create live Dashboard tabs for Bolton EC, HDK Long Run Roofing, and Hughes Electrical.
 *
 * Usage: node src/scripts/createDashboards.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createDashboard } = require('../sheets/createDashboard');
const { loadCompanies } = require('../config/companiesStore');

const TARGET_COMPANIES = ['Bolton EC', 'HDK Long Run Roofing', 'Hughes Electrical'];

async function main() {
  const { companies } = loadCompanies();

  for (const name of TARGET_COMPANIES) {
    const company = companies.find(c => c.name === name);
    if (!company) {
      console.warn(`Skipping "${name}" — not found in companies.json`);
      continue;
    }

    console.log(`\n=== Creating Dashboard for ${name} ===`);
    await createDashboard(company.sheetId, name, company.ownerName, company.salesPeople);
    console.log(`Sheet: https://docs.google.com/spreadsheets/d/${company.sheetId}`);
  }

  console.log('\n=== All dashboards created ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
