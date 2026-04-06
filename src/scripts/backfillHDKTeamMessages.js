/**
 * Backfill messages for Team Daily, Weekly, Monthly storage tabs for HDK.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { generateEOD } = require('../reporting/generateEOD');
const { archiveDaily } = require('../reporting/archiveDaily');
const { generateEOW } = require('../reporting/generateEOW');
const { archiveWeekly } = require('../reporting/archiveWeekly');
const { generateEOM } = require('../reporting/generateEOM');
const { archiveMonthly } = require('../reporting/archiveMonthly');
const { readTab } = require('../sheets/readSheet');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const COMPANY_NAME = 'HDK Long Run Roofing';
const OWNER_NAME = 'Jesse';
const DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getWeekdaysBetween(startStr, endStr) {
  const dates = [];
  const d = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');
  while (d <= end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(d.toISOString().split('T')[0]);
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
      weeks.push({ start: monStr, end: sunday.toISOString().split('T')[0] });
    }
    d.setDate(d.getDate() + 7);
  }
  return weeks;
}

function getMonths(startStr, endStr) {
  const months = [];
  let [y, m] = startStr.split('-').map(Number);
  const [endY, endM] = endStr.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: y, month: m });
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

async function main() {
  const START_DATE = process.argv[2] || '2025-05-01';
  const END_DATE = process.argv[3] || '2026-04-04';
  const PHASE = process.argv[4] || 'all';

  console.log('Reading Activity Log...');
  const activityData = await readTab(SHEET_ID, 'Activity Log');
  console.log(`  ${activityData.length - 1} activity rows loaded\n`);

  if (PHASE === 'all' || PHASE === 'daily') {
    const weekdays = getWeekdaysBetween(START_DATE, END_DATE);
    console.log(`=== Team Daily Messages (${weekdays.length} days) ===\n`);
    for (let i = 0; i < weekdays.length; i++) {
      try {
        const { message, counts, names } = await generateEOD(SHEET_ID, 'Team', weekdays[i], COMPANY_NAME, OWNER_NAME, activityData);
        await archiveDaily(SHEET_ID, 'Team', weekdays[i], message, counts || {}, names || {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${weekdays.length}] ${weekdays[i]} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${weekdays.length}] ${weekdays[i]} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nTeam Daily done. Waiting 5s...\n');
    await sleep(5000);
  }

  if (PHASE === 'all' || PHASE === 'weekly') {
    const weeks = getWeekRanges(START_DATE, END_DATE);
    console.log(`=== Team Weekly Messages (${weeks.length} weeks) ===\n`);
    for (let i = 0; i < weeks.length; i++) {
      const { start, end } = weeks[i];
      try {
        const { message, counts } = await generateEOW(SHEET_ID, 'Team', start, end, COMPANY_NAME, OWNER_NAME, activityData);
        await archiveWeekly(SHEET_ID, 'Team', start, end, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${weeks.length}] ${start} to ${end} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${weeks.length}] ${start} to ${end} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nTeam Weekly done. Waiting 5s...\n');
    await sleep(5000);
  }

  if (PHASE === 'all' || PHASE === 'monthly') {
    const months = getMonths(START_DATE, END_DATE);
    console.log(`=== Team Monthly Messages (${months.length} months) ===\n`);
    for (let i = 0; i < months.length; i++) {
      const { year, month } = months[i];
      try {
        const { message, counts } = await generateEOM(SHEET_ID, 'Team', year, month, COMPANY_NAME, OWNER_NAME, activityData);
        await archiveMonthly(SHEET_ID, 'Team', year, month, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log('\n=== Team message backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
