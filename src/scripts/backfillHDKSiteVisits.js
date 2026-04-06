/**
 * Backfill HDK Site Visits from the raw site visits data.
 * 1. Parses the raw TSV into structured site visit entries
 * 2. Writes to the Site Visits tab
 * 3. Adds Site Visit Booked entries to the Activity Log (for dates not already covered)
 *
 * Data format: Address    Name    DD/MM/YYYY    Appointment Date
 * Fields separated by 4+ spaces.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { readTab } = require('../sheets/readSheet');
const { writeSheet, clearRange } = require('../sheets/writeSheet');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

const MONTHS = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', Jun: '06', Jul: '07',
  Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Convert DD/MM/YYYY to YYYY-MM-DD */
function convertDate(ddmmyyyy) {
  const parts = ddmmyyyy.trim().split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

/** Parse appointment date strings like "5 May 2025" or "Tuesday, January 27, 2026 16:30" */
function parseApptDate(raw) {
  if (!raw) return '';
  raw = raw.trim();

  // "5 May 2025" format
  let m = raw.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[2]];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
  }

  // "Tuesday, January 27, 2026 16:30" or "Thursday, February 5, 2026 12:00"
  m = raw.match(/\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (m) {
    const mm = MONTHS[m[1]];
    if (mm) {
      const dateStr = `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
      return m[4] ? `${dateStr} ${m[4]}` : dateStr;
    }
  }

  // "Saturday, March 15, 2025 13:30" — same pattern
  return raw; // return as-is if unparseable
}

function parseSiteVisits(rawContent) {
  const lines = rawContent.split('\n');
  const visits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(/ {4,}/).map(s => s.trim()).filter(s => s);
    if (parts.length < 2) continue;

    let address, name, dateStr, apptDate;

    if (parts.length >= 4) {
      address = parts[0].replace(/,\s*$/, '').trim();
      name = parts[1].trim();
      dateStr = convertDate(parts[2]);
      apptDate = parseApptDate(parts[3]);
    } else if (parts.length === 3) {
      // Could be: address, name, date (no appt date)
      // Or: name, date, appt date (no address)
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(parts[1])) {
        // name, date, appt — no address
        address = '';
        name = parts[0].trim();
        dateStr = convertDate(parts[1]);
        apptDate = parseApptDate(parts[2]);
      } else {
        address = parts[0].replace(/,\s*$/, '').trim();
        name = parts[1].trim();
        dateStr = convertDate(parts[2]);
        apptDate = '';
      }
    } else if (parts.length === 2) {
      // name + date only, or address + name
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(parts[1])) {
        address = '';
        name = parts[0].trim();
        dateStr = convertDate(parts[1]);
        apptDate = '';
      } else {
        // Skip — can't determine structure
        continue;
      }
    } else {
      continue;
    }

    if (!name) continue;

    visits.push({ address: address || '', name, date: dateStr, apptDate: apptDate || '' });
  }

  return visits;
}

async function main() {
  const tsvPath = path.join(__dirname, 'hdk_site_visits_raw.tsv');
  const raw = fs.readFileSync(tsvPath, 'utf-8');
  const visits = parseSiteVisits(raw);

  console.log(`Parsed ${visits.length} site visits from raw data.`);
  if (visits.length > 0) {
    console.log(`Date range: ${visits[0].date || 'N/A'} to ${visits[visits.length - 1].date || 'N/A'}`);
    for (const v of visits.slice(0, 3)) {
      console.log(`  ${v.date} | ${v.name} | ${v.address || 'N/A'} | ${v.apptDate || 'N/A'}`);
    }
    console.log(`  ...`);
    for (const v of visits.slice(-2)) {
      console.log(`  ${v.date} | ${v.name} | ${v.address || 'N/A'} | ${v.apptDate || 'N/A'}`);
    }
  }

  // === Step 1: Write to Site Visits tab ===
  console.log('\n=== Writing Site Visits tab ===');
  const siteVisitRows = visits.map(v => [v.name, v.address, v.apptDate || v.date, SALES_PERSON, '']);
  await clearRange(SHEET_ID, "'Site Visits'!A2:E");
  await writeSheet(SHEET_ID, "'Site Visits'!A2", siteVisitRows);
  console.log(`  Written ${siteVisitRows.length} rows to Site Visits tab.`);

  // === Step 2: Add to Activity Log ===
  // Only add entries for dates NOT already in the Activity Log as Site Visit Booked
  console.log('\n=== Checking existing Activity Log Site Visit Booked entries ===');
  const activityData = await readTab(SHEET_ID, 'Activity Log');
  const existingSVs = new Set();
  for (let i = 1; i < activityData.length; i++) {
    const row = activityData[i];
    if ((row[3] || '').trim() === 'Site Visit Booked') {
      // Key: date + normalized name
      const key = (row[0] || '') + '|' + (row[2] || '').trim().toLowerCase();
      existingSVs.add(key);
    }
  }
  console.log(`  ${existingSVs.size} existing Site Visit Booked entries in Activity Log.`);

  const newActivities = [];
  let skipped = 0;
  for (const v of visits) {
    if (!v.date) { skipped++; continue; }
    const key = v.date + '|' + v.name.toLowerCase();
    if (existingSVs.has(key)) {
      skipped++;
      continue;
    }
    newActivities.push({
      date: v.date,
      salesPerson: SALES_PERSON,
      contactName: v.name,
      eventType: 'Site Visit Booked',
      outcome: 'Site Visit Booked',
      adSource: '',
      quoteJobValue: '',
      contactAddress: v.address,
      contactId: '',
      appointmentDateTime: v.apptDate || '',
      appointmentDate: '',
    });
  }

  console.log(`  ${newActivities.length} new entries to add, ${skipped} already exist or skipped.`);

  if (newActivities.length > 0) {
    for (let i = 0; i < newActivities.length; i += BATCH_SIZE) {
      const batch = newActivities.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(newActivities.length / BATCH_SIZE);

      console.log(`  Uploading batch ${batchNum}/${totalBatches} (${batch.length} rows)...`);
      try {
        await logActivities(SHEET_ID, batch);
        console.log(`    Batch ${batchNum} done.`);
      } catch (err) {
        console.error(`    Batch ${batchNum} FAILED: ${err.message}`);
        await new Promise(r => setTimeout(r, 30000));
        await logActivities(SHEET_ID, batch);
        console.log(`    Batch ${batchNum} retry succeeded.`);
      }

      if (i + BATCH_SIZE < newActivities.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
  }

  console.log('\n=== HDK Site Visits backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
