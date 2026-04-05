/**
 * Populate Daily, Weekly, and Monthly storage tabs with live formulas for Bolton EC.
 * Reads existing dates from each tab and replaces static values with formulas
 * that reference the Activity Log directly.
 *
 * Usage: node src/scripts/populateStorageFormulas.js [--all]
 *   --all: also repopulate EOD/EOW display tabs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  populateDailyStorage,
  populateWeeklyStorage,
  populateMonthlyStorage,
  populateEODTab,
  populateEOWTab,
} = require('../sheets/populateFormulas');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const COMPANY_NAME = 'Bolton EC';
const OWNER_NAME = 'Jed';
const SALES_PERSON = 'Lachlan';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const doAll = process.argv.includes('--all');

  console.log(`\nPopulating live storage formulas for ${SALES_PERSON} @ ${COMPANY_NAME}\n`);

  // Phase 1: Individual tabs
  console.log('=== Lachlan Daily Storage ===');
  await populateDailyStorage(SHEET_ID, `${SALES_PERSON} Daily`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);

  console.log('\n=== Lachlan Weekly Storage ===');
  await populateWeeklyStorage(SHEET_ID, `${SALES_PERSON} Weekly`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);

  console.log('\n=== Lachlan Monthly Storage ===');
  await populateMonthlyStorage(SHEET_ID, `${SALES_PERSON} Monthly`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);

  // Phase 2: Team tabs (fallback to Lachlan's dates)
  console.log('\n=== Team Daily Storage ===');
  await populateDailyStorage(SHEET_ID, 'Team Daily', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Daily`);
  await sleep(2000);

  console.log('\n=== Team Weekly Storage ===');
  await populateWeeklyStorage(SHEET_ID, 'Team Weekly', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Weekly`);
  await sleep(2000);

  console.log('\n=== Team Monthly Storage ===');
  await populateMonthlyStorage(SHEET_ID, 'Team Monthly', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Monthly`);

  if (doAll) {
    console.log('\n=== Display Tabs ===');
    await sleep(2000);
    await populateEODTab(SHEET_ID, `${SALES_PERSON} EOD`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
    await populateEOWTab(SHEET_ID, `${SALES_PERSON} EOW`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
    await populateEODTab(SHEET_ID, 'Team EOD', 'Team', COMPANY_NAME, OWNER_NAME, true);
    await populateEOWTab(SHEET_ID, 'Team EOW', 'Team', COMPANY_NAME, OWNER_NAME, true);
  }

  console.log('\n=== All storage tabs now formula-driven with Total Revenue ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
