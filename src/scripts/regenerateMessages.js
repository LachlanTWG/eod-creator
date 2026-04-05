/**
 * Regenerate report messages for all existing storage rows.
 * Writes messages to the message column, then re-runs formula population
 * to replace static counts with live formulas while preserving the messages.
 *
 * Handles all companies, all salespeople, and Team tabs.
 *
 * Usage:
 *   node regenerateMessages.js                # all companies
 *   node regenerateMessages.js "Bolton EC"    # specific company
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
const { loadCompanies } = require('../config/companiesStore');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

async function regenerateDaily(sheetId, tabName, personName, companyName, ownerName, activityData) {
  console.log(`\n=== Regenerating Daily Messages: ${tabName} ===\n`);
  const dailyRows = await readTab(sheetId, tabName);
  const dates = dailyRows.slice(1).map(r => parseSerialDate(r[0])).filter(Boolean);
  console.log(`  ${dates.length} daily rows to process`);

  const BATCH = 20;
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const messages = [];
    for (const date of batch) {
      try {
        const { message } = await generateEOD(sheetId, personName, date, companyName, ownerName, activityData);
        messages.push([message]);
      } catch (e) {
        messages.push(['']);
        console.error(`    ${date} failed: ${e.message}`);
      }
    }
    const startRow = i + 2;
    await writeSheet(sheetId, `'${tabName}'!B${startRow}`, messages);
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: rows ${startRow}-${startRow + messages.length - 1} done`);
    await sleep(1000);
  }
}

async function regenerateWeekly(sheetId, tabName, personName, companyName, ownerName, activityData) {
  console.log(`\n=== Regenerating Weekly Messages: ${tabName} ===\n`);
  const weeklyRows = await readTab(sheetId, tabName);
  const weeks = weeklyRows.slice(1).filter(r => r[0] && r[1]).map(r => ({
    start: parseSerialDate(r[0]),
    end: parseSerialDate(r[1]),
  }));
  console.log(`  ${weeks.length} weekly rows to process`);

  const weeklyMessages = [];
  for (let i = 0; i < weeks.length; i++) {
    const { start, end } = weeks[i];
    try {
      const { message } = await generateEOW(sheetId, personName, start, end, companyName, ownerName, activityData);
      weeklyMessages.push([message]);
    } catch (e) {
      weeklyMessages.push(['']);
      console.error(`    ${start}-${end} failed: ${e.message}`);
    }
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${weeks.length} done`);
  }
  await writeSheet(sheetId, `'${tabName}'!C2`, weeklyMessages);
  console.log(`  All ${weeks.length} weekly messages written`);
}

async function regenerateMonthly(sheetId, tabName, personName, companyName, ownerName, activityData) {
  console.log(`\n=== Regenerating Monthly Messages: ${tabName} ===\n`);
  const monthlyRows = await readTab(sheetId, tabName);
  const months = monthlyRows.slice(1).map(r => r[0]).filter(Boolean);
  console.log(`  ${months.length} monthly rows to process`);

  const monthlyMessages = [];
  for (const monthStr of months) {
    const [y, m] = monthStr.split('-').map(Number);
    try {
      const { message } = await generateEOM(sheetId, personName, y, m, companyName, ownerName, activityData);
      monthlyMessages.push([message]);
    } catch (e) {
      monthlyMessages.push(['']);
      console.error(`    ${monthStr} failed: ${e.message}`);
    }
  }
  await writeSheet(sheetId, `'${tabName}'!B2`, monthlyMessages);
  console.log(`  All ${months.length} monthly messages written`);
}

async function regenerateCompany(company) {
  const { sheetId, name: companyName, ownerName, salesPeople } = company;
  const activePeople = salesPeople.filter(p => p.active);
  const firstPerson = activePeople[0];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${companyName}`);
  console.log(`${'='.repeat(60)}`);

  // Read Activity Log ONCE for this company
  console.log('Reading Activity Log...');
  const activityData = await readTab(sheetId, 'Activity Log');
  console.log(`  ${activityData.length - 1} activity rows loaded`);

  // Phase 1: Individual salesperson tabs
  for (const person of activePeople) {
    await regenerateDaily(sheetId, `${person.name} Daily`, person.name, companyName, ownerName, activityData);
    await regenerateWeekly(sheetId, `${person.name} Weekly`, person.name, companyName, ownerName, activityData);
    await regenerateMonthly(sheetId, `${person.name} Monthly`, person.name, companyName, ownerName, activityData);
  }

  // Phase 2: Team tabs
  await regenerateDaily(sheetId, 'Team Daily', 'Team', companyName, ownerName, activityData);
  await regenerateWeekly(sheetId, 'Team Weekly', 'Team', companyName, ownerName, activityData);
  await regenerateMonthly(sheetId, 'Team Monthly', 'Team', companyName, ownerName, activityData);

  // Phase 3: Re-populate formulas (preserving messages)
  console.log('\n=== Re-populating live formulas ===\n');
  await sleep(3000);

  for (const person of activePeople) {
    await populateDailyStorage(sheetId, `${person.name} Daily`, person.name, companyName, ownerName, false);
    await sleep(2000);
    await populateWeeklyStorage(sheetId, `${person.name} Weekly`, person.name, companyName, ownerName, false);
    await sleep(2000);
    await populateMonthlyStorage(sheetId, `${person.name} Monthly`, person.name, companyName, ownerName, false);
    await sleep(2000);
  }

  const fbPrefix = firstPerson ? firstPerson.name : null;
  await populateDailyStorage(sheetId, 'Team Daily', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Daily` : null);
  await sleep(2000);
  await populateWeeklyStorage(sheetId, 'Team Weekly', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Weekly` : null);
  await sleep(2000);
  await populateMonthlyStorage(sheetId, 'Team Monthly', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Monthly` : null);

  console.log(`\n  ${companyName} — all messages regenerated and formulas applied`);
}

async function main() {
  const filterName = process.argv[2];
  const { companies } = loadCompanies();

  const targets = filterName
    ? companies.filter(c => c.name === filterName)
    : companies.filter(c => c.sheetId);

  if (targets.length === 0) {
    console.error(filterName ? `Company "${filterName}" not found.` : 'No companies found.');
    process.exit(1);
  }

  for (const company of targets) {
    await regenerateCompany(company);
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
