/**
 * Rebuild all Virtue Roofing storage tabs (Daily, Weekly, Monthly, Quarterly) with live formulas.
 * Run this FIRST, then run backfillVirtueMessages.js to populate messages.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const {
  populateDailyStorage,
  populateWeeklyStorage,
  populateMonthlyStorage,
  populateQuarterlyStorage,
} = require('../sheets/populateFormulas');

const SHEET_ID = '1kRE5ntl1NJNzjB3dmPHTlCR8vao8DQp7OOKYXSWtk1Q';
const COMPANY = 'Virtue Roofing';
const OWNER = 'Jake';
const PERSON = 'Buzz';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Rebuilding all Virtue Roofing storage tabs...\n');

  // === Buzz Individual ===
  console.log('=== Buzz Daily ===');
  await populateDailyStorage(SHEET_ID, `${PERSON} Daily`, PERSON, COMPANY, OWNER, false);
  await sleep(3000);

  console.log('\n=== Buzz Weekly ===');
  await populateWeeklyStorage(SHEET_ID, `${PERSON} Weekly`, PERSON, COMPANY, OWNER, false);
  await sleep(3000);

  console.log('\n=== Buzz Monthly ===');
  await populateMonthlyStorage(SHEET_ID, `${PERSON} Monthly`, PERSON, COMPANY, OWNER, false);
  await sleep(3000);

  console.log('\n=== Buzz Quarterly ===');
  await populateQuarterlyStorage(SHEET_ID, `${PERSON} Quarterly`, PERSON, COMPANY, OWNER, false);
  await sleep(3000);

  // === Team (fallback to Buzz's dates) ===
  console.log('\n=== Team Daily ===');
  await populateDailyStorage(SHEET_ID, 'Team Daily', 'Team', COMPANY, OWNER, true, `${PERSON} Daily`);
  await sleep(3000);

  console.log('\n=== Team Weekly ===');
  await populateWeeklyStorage(SHEET_ID, 'Team Weekly', 'Team', COMPANY, OWNER, true, `${PERSON} Weekly`);
  await sleep(3000);

  console.log('\n=== Team Monthly ===');
  await populateMonthlyStorage(SHEET_ID, 'Team Monthly', 'Team', COMPANY, OWNER, true, `${PERSON} Monthly`);
  await sleep(3000);

  console.log('\n=== Team Quarterly ===');
  await populateQuarterlyStorage(SHEET_ID, 'Team Quarterly', 'Team', COMPANY, OWNER, true, `${PERSON} Quarterly`);

  console.log('\n=== All Virtue Roofing storage tabs rebuilt with live formulas ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
