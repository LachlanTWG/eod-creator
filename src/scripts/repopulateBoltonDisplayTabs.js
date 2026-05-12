/**
 * Repopulate Bolton EC's EOD/EOW display tabs to pick up the
 * empty-Quote-Value fix in quotesBlock / pipelineCountFormula /
 * totalQuotesCountFormula.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { populateEODTab, populateEOWTab } = require('../sheets/populateFormulas');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const COMPANY_NAME = 'Bolton EC';
const OWNER_NAME = 'Jed';
const PEOPLE = ['Lachlan', 'Zac'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  for (const person of PEOPLE) {
    console.log(`\n=== ${person} EOD ===`);
    await populateEODTab(SHEET_ID, `${person} EOD`, person, COMPANY_NAME, OWNER_NAME, false);
    await sleep(1500);
    console.log(`=== ${person} EOW ===`);
    await populateEOWTab(SHEET_ID, `${person} EOW`, person, COMPANY_NAME, OWNER_NAME, false);
    await sleep(1500);
  }
  console.log(`\n=== Team EOD ===`);
  await populateEODTab(SHEET_ID, 'Team EOD', 'Team', COMPANY_NAME, OWNER_NAME, true);
  await sleep(1500);
  console.log(`=== Team EOW ===`);
  await populateEOWTab(SHEET_ID, 'Team EOW', 'Team', COMPANY_NAME, OWNER_NAME, true);
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
