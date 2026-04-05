/**
 * Regenerate report messages for all existing storage rows.
 * Writes messages to the message column, then re-runs formula population
 * to replace static counts with live formulas while preserving the messages.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { readTab } = require('../sheets/readSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { generateEOD } = require('../reporting/generateEOD');
const { generateEOW } = require('../reporting/generateEOW');
const { generateEOM } = require('../reporting/generateEOM');
const {
  populateDailyStorage,
  populateWeeklyStorage,
  populateMonthlyStorage,
} = require('../sheets/populateFormulas');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const COMPANY_NAME = 'Bolton EC';
const OWNER_NAME = 'Jed';
const SALES_PERSON = 'Lachlan';
const DELAY_MS = 1200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

async function main() {
  // ─── Phase 1: Daily Messages ───────────────────────────────────────
  console.log('\n=== Phase 1: Regenerating Daily Messages ===\n');
  const dailyTab = `${SALES_PERSON} Daily`;
  const dailyRows = await readTab(SHEET_ID, dailyTab);
  const dates = dailyRows.slice(1).map(r => parseSerialDate(r[0])).filter(Boolean);
  console.log(`  ${dates.length} daily rows to process`);

  // Generate messages in batches and write to column B
  const BATCH = 20;
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const messages = [];
    for (const date of batch) {
      try {
        const { message } = await generateEOD(SHEET_ID, SALES_PERSON, date, COMPANY_NAME, OWNER_NAME);
        messages.push([message]);
      } catch (e) {
        messages.push(['']);
        console.error(`    ${date} failed: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
    // Write batch of messages to column B
    const startRow = i + 2; // row 1 is header
    await writeSheet(SHEET_ID, `'${dailyTab}'!B${startRow}`, messages);
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: rows ${startRow}-${startRow + messages.length - 1} done`);
    await sleep(1000);
  }

  // ─── Phase 2: Weekly Messages ──────────────────────────────────────
  console.log('\n=== Phase 2: Regenerating Weekly Messages ===\n');
  const weeklyTab = `${SALES_PERSON} Weekly`;
  const weeklyRows = await readTab(SHEET_ID, weeklyTab);
  const weeks = weeklyRows.slice(1).filter(r => r[0] && r[1]).map(r => ({
    start: parseSerialDate(r[0]),
    end: parseSerialDate(r[1]),
  }));
  console.log(`  ${weeks.length} weekly rows to process`);

  const weeklyMessages = [];
  for (let i = 0; i < weeks.length; i++) {
    const { start, end } = weeks[i];
    try {
      const { message } = await generateEOW(SHEET_ID, SALES_PERSON, start, end, COMPANY_NAME, OWNER_NAME);
      weeklyMessages.push([message]);
    } catch (e) {
      weeklyMessages.push(['']);
      console.error(`    ${start}-${end} failed: ${e.message}`);
    }
    await sleep(DELAY_MS);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${weeks.length} done`);
  }
  await writeSheet(SHEET_ID, `'${weeklyTab}'!C2`, weeklyMessages);
  console.log(`  All ${weeks.length} weekly messages written`);

  // ─── Phase 3: Monthly Messages ─────────────────────────────────────
  console.log('\n=== Phase 3: Regenerating Monthly Messages ===\n');
  const monthlyTab = `${SALES_PERSON} Monthly`;
  const monthlyRows = await readTab(SHEET_ID, monthlyTab);
  const months = monthlyRows.slice(1).map(r => r[0]).filter(Boolean);
  console.log(`  ${months.length} monthly rows to process`);

  const monthlyMessages = [];
  for (const monthStr of months) {
    const [y, m] = monthStr.split('-').map(Number);
    try {
      const { message } = await generateEOM(SHEET_ID, SALES_PERSON, y, m, COMPANY_NAME, OWNER_NAME);
      monthlyMessages.push([message]);
    } catch (e) {
      monthlyMessages.push(['']);
      console.error(`    ${monthStr} failed: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  await writeSheet(SHEET_ID, `'${monthlyTab}'!B2`, monthlyMessages);
  console.log(`  All ${months.length} monthly messages written`);

  // ─── Phase 4: Re-populate formulas (preserving messages) ───────────
  console.log('\n=== Phase 4: Re-populating live formulas ===\n');
  await sleep(3000);
  await populateDailyStorage(SHEET_ID, dailyTab, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);
  await populateWeeklyStorage(SHEET_ID, weeklyTab, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);
  await populateMonthlyStorage(SHEET_ID, monthlyTab, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);

  console.log('\n=== All messages regenerated and formulas applied ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
