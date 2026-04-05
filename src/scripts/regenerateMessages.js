/**
 * Regenerate report messages for all existing storage rows.
 * Writes messages to the message column, then re-runs formula population
 * to replace static counts with live formulas while preserving the messages.
 *
 * Handles both individual salesperson tabs AND Team tabs.
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

async function regenerateDaily(tabName, personName) {
  console.log(`\n=== Regenerating Daily Messages: ${tabName} ===\n`);
  const dailyRows = await readTab(SHEET_ID, tabName);
  const dates = dailyRows.slice(1).map(r => parseSerialDate(r[0])).filter(Boolean);
  console.log(`  ${dates.length} daily rows to process`);

  const BATCH = 20;
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const messages = [];
    for (const date of batch) {
      try {
        const { message } = await generateEOD(SHEET_ID, personName, date, COMPANY_NAME, OWNER_NAME);
        messages.push([message]);
      } catch (e) {
        messages.push(['']);
        console.error(`    ${date} failed: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
    const startRow = i + 2;
    await writeSheet(SHEET_ID, `'${tabName}'!B${startRow}`, messages);
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: rows ${startRow}-${startRow + messages.length - 1} done`);
    await sleep(1000);
  }
}

async function regenerateWeekly(tabName, personName) {
  console.log(`\n=== Regenerating Weekly Messages: ${tabName} ===\n`);
  const weeklyRows = await readTab(SHEET_ID, tabName);
  const weeks = weeklyRows.slice(1).filter(r => r[0] && r[1]).map(r => ({
    start: parseSerialDate(r[0]),
    end: parseSerialDate(r[1]),
  }));
  console.log(`  ${weeks.length} weekly rows to process`);

  const weeklyMessages = [];
  for (let i = 0; i < weeks.length; i++) {
    const { start, end } = weeks[i];
    try {
      const { message } = await generateEOW(SHEET_ID, personName, start, end, COMPANY_NAME, OWNER_NAME);
      weeklyMessages.push([message]);
    } catch (e) {
      weeklyMessages.push(['']);
      console.error(`    ${start}-${end} failed: ${e.message}`);
    }
    await sleep(DELAY_MS);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${weeks.length} done`);
  }
  await writeSheet(SHEET_ID, `'${tabName}'!C2`, weeklyMessages);
  console.log(`  All ${weeks.length} weekly messages written`);
}

async function regenerateMonthly(tabName, personName) {
  console.log(`\n=== Regenerating Monthly Messages: ${tabName} ===\n`);
  const monthlyRows = await readTab(SHEET_ID, tabName);
  const months = monthlyRows.slice(1).map(r => r[0]).filter(Boolean);
  console.log(`  ${months.length} monthly rows to process`);

  const monthlyMessages = [];
  for (const monthStr of months) {
    const [y, m] = monthStr.split('-').map(Number);
    try {
      const { message } = await generateEOM(SHEET_ID, personName, y, m, COMPANY_NAME, OWNER_NAME);
      monthlyMessages.push([message]);
    } catch (e) {
      monthlyMessages.push(['']);
      console.error(`    ${monthStr} failed: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  await writeSheet(SHEET_ID, `'${tabName}'!B2`, monthlyMessages);
  console.log(`  All ${months.length} monthly messages written`);
}

async function main() {
  // Phase 1: Lachlan tabs
  await regenerateDaily(`${SALES_PERSON} Daily`, SALES_PERSON);
  await regenerateWeekly(`${SALES_PERSON} Weekly`, SALES_PERSON);
  await regenerateMonthly(`${SALES_PERSON} Monthly`, SALES_PERSON);

  // Phase 2: Team tabs
  await regenerateDaily('Team Daily', 'Team');
  await regenerateWeekly('Team Weekly', 'Team');
  await regenerateMonthly('Team Monthly', 'Team');

  // Phase 3: Re-populate formulas (preserving messages)
  console.log('\n=== Re-populating live formulas ===\n');
  await sleep(3000);
  await populateDailyStorage(SHEET_ID, `${SALES_PERSON} Daily`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);
  await populateWeeklyStorage(SHEET_ID, `${SALES_PERSON} Weekly`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);
  await populateMonthlyStorage(SHEET_ID, `${SALES_PERSON} Monthly`, SALES_PERSON, COMPANY_NAME, OWNER_NAME, false);
  await sleep(2000);
  await populateDailyStorage(SHEET_ID, 'Team Daily', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Daily`);
  await sleep(2000);
  await populateWeeklyStorage(SHEET_ID, 'Team Weekly', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Weekly`);
  await sleep(2000);
  await populateMonthlyStorage(SHEET_ID, 'Team Monthly', 'Team', COMPANY_NAME, OWNER_NAME, true, `${SALES_PERSON} Monthly`);

  console.log('\n=== All messages regenerated and formulas applied ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
