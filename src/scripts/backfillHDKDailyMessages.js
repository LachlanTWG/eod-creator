/**
 * Backfill EOD messages into the existing Lachlan Daily tab rows.
 * Assumes populateDailyStorage has already created formula rows with dates.
 * Generates the EOD message for each weekday and writes it to column B.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { generateEOD } = require('../reporting/generateEOD');
const { archiveDaily } = require('../reporting/archiveDaily');
const { readTab } = require('../sheets/readSheet');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const COMPANY_NAME = 'HDK Long Run Roofing';
const OWNER_NAME = 'Jesse';
const SALES_PERSON = 'Lachlan';
const DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getWeekdaysBetween(startStr, endStr) {
  const dates = [];
  const d = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function main() {
  const START_DATE = process.argv[2] || '2025-05-09';
  const END_DATE = process.argv[3] || '2026-04-04';

  console.log('Reading Activity Log...');
  const activityData = await readTab(SHEET_ID, 'Activity Log');
  console.log(`  ${activityData.length - 1} activity rows loaded\n`);

  const weekdays = getWeekdaysBetween(START_DATE, END_DATE);
  console.log(`=== Daily Messages (${weekdays.length} weekdays) ===\n`);

  for (let i = 0; i < weekdays.length; i++) {
    const date = weekdays[i];
    try {
      const { message, counts, names } = await generateEOD(
        SHEET_ID, SALES_PERSON, date, COMPANY_NAME, OWNER_NAME, activityData
      );
      await archiveDaily(SHEET_ID, SALES_PERSON, date, message, counts || {}, names || {}, OWNER_NAME, COMPANY_NAME);
      process.stdout.write(`  [${i + 1}/${weekdays.length}] ${date} ✓\n`);
    } catch (err) {
      console.error(`  [${i + 1}/${weekdays.length}] ${date} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log('\n=== Daily message backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
