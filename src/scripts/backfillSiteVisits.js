/**
 * Backfill the Site Visits tab from Activity Log for one or more companies.
 * Reads all "Site Visit Booked" events and writes them to the Site Visits sheet.
 *
 * Usage: node backfillSiteVisits.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { readTab } = require('../sheets/readSheet');
const { writeSheet } = require('../sheets/writeSheet');
const { clearRange } = require('../sheets/writeSheet');

const COMPANIES = [
  {
    name: 'HDK Long Run Roofing',
    sheetId: '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0',
  },
  {
    name: 'Bolton EC',
    sheetId: '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c',
  },
];

async function backfillCompany(company) {
  console.log(`\n=== ${company.name} ===`);

  const activityData = await readTab(company.sheetId, 'Activity Log');
  if (activityData.length < 2) {
    console.log('  No activity data found.');
    return;
  }

  const headers = activityData[0];
  const dateIdx = headers.indexOf('Date');
  const nameIdx = headers.indexOf('Contact Name');
  const eventIdx = headers.indexOf('Event Type');
  const addressIdx = headers.indexOf('Contact Address');
  const apptDateTimeIdx = headers.indexOf('Appointment Date Time');
  const salesPersonIdx = headers.indexOf('Sales Person');

  const siteVisits = [];

  for (let i = 1; i < activityData.length; i++) {
    const row = activityData[i];
    if ((row[eventIdx] || '').trim() !== 'Site Visit Booked') continue;

    const contactName = (row[nameIdx] || '').trim();
    const address = (row[addressIdx] || '').replace(/,\s*$/, '').trim();
    const dateTime = (row[apptDateTimeIdx] || '').trim();
    const salesPerson = (row[salesPersonIdx] || '').trim();
    const date = (row[dateIdx] || '').trim();

    // Use appointment date/time if available, otherwise fall back to activity date
    const displayDateTime = dateTime || date;

    siteVisits.push([contactName, address, displayDateTime, salesPerson, '']);
  }

  console.log(`  Found ${siteVisits.length} Site Visit Booked entries.`);

  if (siteVisits.length === 0) {
    console.log('  Nothing to write.');
    return;
  }

  // Show preview
  for (const sv of siteVisits.slice(0, 3)) {
    console.log(`  ${sv[3]} | ${sv[0]} | ${sv[1] || 'N/A'} | ${sv[2] || 'N/A'}`);
  }
  if (siteVisits.length > 3) console.log(`  ... and ${siteVisits.length - 3} more`);

  // Clear existing data (keep header row)
  await clearRange(company.sheetId, "'Site Visits'!A2:E");

  // Write all rows
  await writeSheet(company.sheetId, "'Site Visits'!A2", siteVisits);
  console.log(`  Written ${siteVisits.length} rows to Site Visits tab.`);
}

async function main() {
  for (const company of COMPANIES) {
    await backfillCompany(company);
  }
  console.log('\n=== Site Visits backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
