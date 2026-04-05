/**
 * Rebuild the Lachlan Quarterly tab with correct formula rows.
 * Uses populateQuarterlyStorage which clears, sorts, and writes all rows
 * with self-consistent row numbers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { populateQuarterlyStorage } = require('../sheets/populateFormulas');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';

async function main() {
  console.log('Rebuilding Lachlan Quarterly with live formulas...');
  await populateQuarterlyStorage(SHEET_ID, 'Lachlan Quarterly', 'Lachlan', 'HDK Long Run Roofing', 'Jesse', false);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
