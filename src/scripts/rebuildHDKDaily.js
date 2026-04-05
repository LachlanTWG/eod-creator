/**
 * Rebuild the Lachlan Daily tab with live formula rows from Activity Log data.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { populateDailyStorage } = require('../sheets/populateFormulas');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';

async function main() {
  console.log('Rebuilding Lachlan Daily with live formulas...');
  await populateDailyStorage(SHEET_ID, 'Lachlan Daily', 'Lachlan', 'HDK Long Run Roofing', 'Jesse', false);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
