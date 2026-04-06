/**
 * Backfill messages for all Virtue Roofing storage tabs (Daily, Weekly, Monthly, Quarterly).
 * Assumes formula rows already exist from rebuildVirtueStorage.js.
 *
 * Usage: node src/scripts/backfillVirtueMessages.js [startDate] [endDate] [phase]
 *   phase: daily, weekly, monthly, quarterly, team, or all (default: all)
 *   team: runs Team daily/weekly/monthly/quarterly after individual
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

const SHEET_ID = '1kRE5ntl1NJNzjB3dmPHTlCR8vao8DQp7OOKYXSWtk1Q';
const COMPANY_NAME = 'Virtue Roofing';
const OWNER_NAME = 'Jake';
const SALES_PERSON = 'Buzz';
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

function getQuarters(startStr, endStr) {
  const quarters = [];
  let [y] = startStr.split('-').map(Number);
  let q = Math.ceil(parseInt(startStr.split('-')[1]) / 3);
  const endY = parseInt(endStr.split('-')[0]);
  const endQ = Math.ceil(parseInt(endStr.split('-')[1]) / 3);
  while (y < endY || (y === endY && q <= endQ)) {
    quarters.push({ year: y, quarter: q });
    if (++q > 4) { q = 1; y++; }
  }
  return quarters;
}

async function runPhase(phaseName, person, activityData, START_DATE, END_DATE) {
  // === Daily ===
  if (phaseName === 'all' || phaseName === 'daily') {
    const weekdays = getWeekdaysBetween(START_DATE, END_DATE);
    console.log(`=== ${person} Daily Messages (${weekdays.length} days) ===\n`);
    for (let i = 0; i < weekdays.length; i++) {
      try {
        const { message, counts, names } = await generateEOD(SHEET_ID, person, weekdays[i], COMPANY_NAME, OWNER_NAME, activityData);
        await archiveDaily(SHEET_ID, person, weekdays[i], message, counts || {}, names || {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${weekdays.length}] ${weekdays[i]} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${weekdays.length}] ${weekdays[i]} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nDaily done. Waiting 5s...\n');
    await sleep(5000);
  }

  // === Weekly ===
  if (phaseName === 'all' || phaseName === 'weekly') {
    const weeks = getWeekRanges(START_DATE, END_DATE);
    console.log(`=== ${person} Weekly Messages (${weeks.length} weeks) ===\n`);
    for (let i = 0; i < weeks.length; i++) {
      const { start, end } = weeks[i];
      try {
        const { message, counts } = await generateEOW(SHEET_ID, person, start, end, COMPANY_NAME, OWNER_NAME, activityData);
        await archiveWeekly(SHEET_ID, person, start, end, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${weeks.length}] ${start} to ${end} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${weeks.length}] ${start} to ${end} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nWeekly done. Waiting 5s...\n');
    await sleep(5000);
  }

  // === Monthly ===
  if (phaseName === 'all' || phaseName === 'monthly') {
    const months = getMonths(START_DATE, END_DATE);
    console.log(`=== ${person} Monthly Messages (${months.length} months) ===\n`);
    for (let i = 0; i < months.length; i++) {
      const { year, month } = months[i];
      try {
        const { message, counts } = await generateEOM(SHEET_ID, person, year, month, COMPANY_NAME, OWNER_NAME, activityData);
        await archiveMonthly(SHEET_ID, person, year, month, message, counts || {}, {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${months.length}] ${year}-${String(month).padStart(2, '0')} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nMonthly done. Waiting 5s...\n');
    await sleep(5000);
  }

  // === Quarterly ===
  if (phaseName === 'all' || phaseName === 'quarterly') {
    const quarters = getQuarters(START_DATE, END_DATE);
    console.log(`=== ${person} Quarterly Messages (${quarters.length} quarters) ===\n`);
    for (let i = 0; i < quarters.length; i++) {
      const { year, quarter } = quarters[i];
      try {
        const { message, counts } = await generateEOQ(SHEET_ID, person, year, quarter, COMPANY_NAME, OWNER_NAME, activityData);
        await archiveQuarterly(SHEET_ID, person, year, quarter, message, counts || {}, OWNER_NAME, COMPANY_NAME);
        process.stdout.write(`  [${i + 1}/${quarters.length}] ${year}-Q${quarter} ✓\n`);
      } catch (err) {
        console.error(`  [${i + 1}/${quarters.length}] ${year}-Q${quarter} FAILED: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    console.log('\nQuarterly done.\n');
  }
}

async function main() {
  const START_DATE = process.argv[2] || '2025-09-01';
  const END_DATE = process.argv[3] || '2026-04-06';
  const PHASE = process.argv[4] || 'all';

  console.log(`Backfilling Virtue Roofing messages: ${START_DATE} to ${END_DATE} (phase: ${PHASE})\n`);
  console.log('Reading Activity Log...');
  const activityData = await readTab(SHEET_ID, 'Activity Log');
  console.log(`  ${activityData.length - 1} activity rows loaded\n`);

  // Buzz individual
  await runPhase(PHASE, SALES_PERSON, activityData, START_DATE, END_DATE);

  // Team
  if (PHASE === 'all' || PHASE === 'team') {
    console.log('\n========== TEAM ==========\n');
    await runPhase(PHASE === 'team' ? 'all' : PHASE, 'Team', activityData, START_DATE, END_DATE);
  }

  console.log('\n=== All Virtue Roofing message backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
