/**
 * Set up Hughes Electrical sheet — create tabs, headers, and populate live formulas.
 *
 * Usage: node src/scripts/setupHughesElectrical.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createCompanySheet } = require('../sheets/createCompanySheet');
const { populateAllFormulas } = require('../sheets/populateFormulas');

const SHEET_ID = '1waI6GXXPfrmIF18bJqHmSN1pIAGkH28TXbpj8vpivfU';
const COMPANY_NAME = 'Hughes Electrical';
const OWNER_NAME = 'Ben';
const SALES_PEOPLE = [
  { name: 'Lachlan', active: true, startDate: '2026-04-07' },
  { name: 'Buzz', active: true, startDate: '2026-04-07' },
];

async function main() {
  console.log(`\n=== Setting up ${COMPANY_NAME} ===\n`);

  // Step 1: Create tabs, headers, settings on the existing sheet
  console.log('Step 1: Creating tabs and populating headers...');
  await createCompanySheet(COMPANY_NAME, OWNER_NAME, SALES_PEOPLE, SHEET_ID);

  // Step 2: Populate live storage formulas
  console.log('\nStep 2: Populating live storage formulas...');
  await populateAllFormulas(SHEET_ID, COMPANY_NAME, OWNER_NAME, SALES_PEOPLE);

  console.log(`\n=== ${COMPANY_NAME} setup complete ===`);
  console.log(`Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
