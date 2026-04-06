/**
 * Rebuild all HDK storage tabs (Daily, Weekly, Monthly, Quarterly) with live formulas.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  populateDailyStorage,
  populateWeeklyStorage,
  populateMonthlyStorage,
  populateQuarterlyStorage,
} = require('../sheets/populateFormulas');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const COMPANY = 'HDK Long Run Roofing';
const OWNER = 'Jesse';
const PERSON = 'Lachlan';

async function main() {
  console.log('Rebuilding all HDK storage tabs...\n');

  console.log('=== Daily ===');
  await populateDailyStorage(SHEET_ID, `${PERSON} Daily`, PERSON, COMPANY, OWNER, false);

  console.log('\n=== Weekly ===');
  await populateWeeklyStorage(SHEET_ID, `${PERSON} Weekly`, PERSON, COMPANY, OWNER, false);

  console.log('\n=== Monthly ===');
  await populateMonthlyStorage(SHEET_ID, `${PERSON} Monthly`, PERSON, COMPANY, OWNER, false);

  console.log('\n=== Quarterly ===');
  await populateQuarterlyStorage(SHEET_ID, `${PERSON} Quarterly`, PERSON, COMPANY, OWNER, false);

  console.log('\n=== All storage tabs rebuilt ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
