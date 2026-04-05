/**
 * Backfill Daily, Weekly, Monthly, and Quarterly storage tabs for Lachlan @ HDK Long Run Roofing.
 * Must be run AFTER the Activity Log has been populated (backfillHDK.js).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { generateEOD } = require('../reporting/generateEOD');
const { archiveDaily } = require('../reporting/archiveDaily');
const { generateEOW } = require('../reporting/generateEOW');
const { archiveWeekly } = require('../reporting/archiveWeekly');
const { generateEOM } = require('../reporting/generateEOM');
const { archiveMonthly } = require('../reporting/archiveMonthly');
const { generateEOQ } = require('../reporting/generateEOQ');
const { archiveQuarterly } = require('../reporting/archiveQuarterly');
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

function getWeekRanges(startStr, endStr) {
  const weeks = [];
  const seen = new Set();
  const d = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');

  while (d <= end) {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(monday.getDate() + diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const monStr = monday.toISOString().split('T')[0];
    if (!seen.has(monStr)) {
      seen.add(monStr);
      weeks.push({
        start: monStr,
        end: sunday.toISOString().split('T')[0],
      });
    }
    d.setDate(d.getDate() + 7);
  }
  return weeks;
}

function getMonths(startStr, endStr) {
  const months = [];
  const startParts = startStr.split('-');
  const endParts = endStr.split('-');
  let y = parseInt(startParts[0]);
  let m = parseInt(startParts[1]);
  const endY = parseInt(endParts[0]);
  const endM = parseInt(endParts[1]);

  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function getQuarters(startStr, endStr) {
  const quarters = [];
  const startParts = startStr.split('-');
  const endParts = endStr.split('-');
  let y = parseInt(startParts[0]);
  let q = Math.ceil(parseInt(startParts[1]) / 3);
  const endY = parseInt(endParts[0]);
  const endQ = Math.ceil(parseInt(endParts[1]) / 3);

  while (y < endY || (y === endY && q <= endQ)) {
    quarters.push({ year: y, quarter: q });
    q++;
    if (q > 4) { q = 1; y++; }
  }
  return quarters;
}

async function main() {
  const START_DATE = process.argv[2] || '2025-05-09';
  const END_DATE = process.argv[3] || '2026-04-04';

  console.log('Reading Activity Log...');
  const activityData = await readTab(SHEET_ID, 'Activity Log');
  console.log(`  ${activityData.length - 1} activity rows loaded\n`);

  // ─── Phase 1: Daily Archives (SKIPPED) ─────────────────────────────
  console.log(`=== PHASE 1: Daily Archives — SKIPPED (not needed) ===\n`);

  // ─── Phase 2: Weekly Archives ──────────────────────────────────────
  const weeks = getWeekRanges(START_DATE, END_DATE);
  console.log(`=== PHASE 2: Weekly Archives (${weeks.length} weeks) ===\n`);

  for (let i = 0; i < weeks.length; i++) {
    const { start, end } = weeks[i];
    try {
      const { message, counts } = await generateEOW(
        SHEET_ID, SALES_PERSON, start, end, COMPANY_NAME, OWNER_NAME, activityData
      );
      await archiveWeekly(SHEET_ID, SALES_PERSON, start, end, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
      process.stdout.write(`  [${i + 1}/${weeks.length}] ${start} to ${end} ✓\n`);
    } catch (err) {
      console.error(`  [${i + 1}/${weeks.length}] ${start} to ${end} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nWeekly archives done. Waiting 5s...\n`);
  await sleep(5000);

  // ─── Phase 3: Monthly Archives ─────────────────────────────────────
  const months = getMonths(START_DATE, END_DATE);
  console.log(`=== PHASE 3: Monthly Archives (${months.length} months) ===\n`);

  for (let i = 0; i < months.length; i++) {
    const { year, month } = months[i];
    try {
      const { message, counts } = await generateEOM(
        SHEET_ID, SALES_PERSON, year, month, COMPANY_NAME, OWNER_NAME, activityData
      );
      await archiveMonthly(SHEET_ID, SALES_PERSON, year, month, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
      process.stdout.write(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} ✓\n`);
    } catch (err) {
      console.error(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nMonthly archives done. Waiting 5s...\n`);
  await sleep(5000);

  // ─── Phase 4: Quarterly Archives ───────────────────────────────────
  const quarters = getQuarters(START_DATE, END_DATE);
  console.log(`=== PHASE 4: Quarterly Archives (${quarters.length} quarters) ===\n`);

  for (let i = 0; i < quarters.length; i++) {
    const { year, quarter } = quarters[i];
    try {
      const { message, counts } = await generateEOQ(
        SHEET_ID, SALES_PERSON, year, quarter, COMPANY_NAME, OWNER_NAME, activityData
      );
      await archiveQuarterly(SHEET_ID, SALES_PERSON, year, quarter, message, counts || {}, OWNER_NAME, COMPANY_NAME);
      process.stdout.write(`  [${i + 1}/${quarters.length}] ${year}-Q${quarter} ✓\n`);
    } catch (err) {
      console.error(`  [${i + 1}/${quarters.length}] ${year}-Q${quarter} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log('\n=== All HDK storage backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
