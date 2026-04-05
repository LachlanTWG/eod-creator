/**
 * Backfill HDK Long Run Roofing Activity Log from hdk_activity_raw.tsv.
 * Handles both DD/MM/YYYY and Excel serial number dates.
 * Data is space-delimited (4+ spaces between fields).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

/** Convert DD/MM/YYYY to YYYY-MM-DD */
function convertDate(ddmmyyyy) {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

/** Convert Excel serial number to YYYY-MM-DD */
function excelSerialToDate(serial) {
  const num = parseInt(serial, 10);
  if (isNaN(num) || num < 1) return null;
  // Excel epoch: serial 1 = 1900-01-01, with Feb 29 1900 bug (serial 60)
  const ms = Date.UTC(1900, 0, 1) + (num - 2) * 86400000;
  const d = new Date(ms);
  return d.toISOString().split('T')[0];
}

/** Parse a date field — either DD/MM/YYYY or Excel serial */
function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (/^\d{5}$/.test(raw)) return excelSerialToDate(raw);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return convertDate(raw);
  return null;
}

function isTestEntry(contactName, eventType) {
  if (!contactName) return false;
  const name = contactName.trim().toLowerCase();
  if (name !== 'lachlan boys') return false;
  if (['Job Won', 'Site Visit Booked'].includes(eventType)) return true;
  return false;
}

function cleanQuoteValue(raw) {
  if (!raw) return '';
  let cleaned = raw.replace(/^"|"$/g, '').trim();
  if (!cleaned || cleaned === '0.00' || cleaned === '0') return '';
  // Convert comma-separated values to pipe-separated
  if (cleaned.includes(',')) {
    const values = cleaned.split(',').map(v => v.trim()).filter(v => v && v !== '');
    return values.join('|');
  }
  return cleaned;
}

const VALID_EVENTS = ['EOD Update', 'Quote Sent', 'Site Visit Booked', 'Job Won', 'Email Sent'];
const KNOWN_SOURCES = ['Website Form', 'Facebook Ad Form', 'Direct Email', 'Direct Phone Call',
  'Direct Lead passed on from Client', 'Direct Lead passed on from'];

/** Check if a string looks like a numeric quote value (not an address or ID) */
function looksNumeric(s) {
  if (!s) return false;
  return /^[\d,.]+$/.test(s.replace(/\s/g, ''));
}

function parseRows(rawContent) {
  const lines = rawContent.split('\n');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(/ {4,}/).map(s => s.trim());
    if (parts.length < 3) continue;

    let rawDate, contactName, eventType, outcome, adSource, quoteJobValue,
        contactAddress, contactId, appointmentDateTime, appointmentDate;

    // Step 1: Detect empty Contact Name (parts[1] is event type, parts[2] is outcome)
    let p; // normalized parts array: [date, name, event, outcome, adSource?, value?, addr?, id?, ...]
    if (VALID_EVENTS.includes(parts[1]) && (parts.length < 5 || parts[2].includes('|'))) {
      // Contact Name was empty — insert it
      p = [parts[0], '', parts[1], parts[2], ...parts.slice(3)];
    } else {
      p = parts;
    }

    rawDate = p[0] || '';
    contactName = p[1] || '';
    eventType = p[2] || '';
    outcome = p[3] || '';

    // Step 2: Detect empty Ad Source for non-EOD-Update rows.
    // For EOD Updates, Ad Source is always present (it's in the outcome string AND as a separate field).
    // For other event types (Quote Sent, Job Won, etc.), Ad Source may be missing,
    // causing the value to shift into the Ad Source slot.
    // Detection: if p[4] looks numeric, it's the value — Ad Source was empty.
    if (eventType === 'EOD Update') {
      // EOD Updates always have: outcome, adSource, value(0.00), address, contactId, apptTime, apptDate
      adSource = p[4] || '';
      quoteJobValue = p[5] || '';
      contactAddress = p[6] || '';
      contactId = p[7] || '';
      appointmentDateTime = p[8] || '';
      appointmentDate = p[9] || '';
    } else {
      // For Quote Sent, Job Won, Site Visit Booked, Email Sent:
      // Check if p[4] is a known ad source or looks numeric
      const field4 = p[4] || '';
      if (KNOWN_SOURCES.some(s => field4.startsWith(s))) {
        // Ad Source is present
        adSource = field4;
        quoteJobValue = p[5] || '';
        contactAddress = p[6] || '';
        contactId = p[7] || '';
        appointmentDateTime = p[8] || '';
        appointmentDate = p[9] || '';
      } else {
        // Ad Source was empty — fields shifted left by one
        adSource = '';
        quoteJobValue = p[4] || '';
        contactAddress = p[5] || '';
        contactId = p[6] || '';
        appointmentDateTime = p[7] || '';
        appointmentDate = p[8] || '';
      }
    }

    rows.push({
      rawDate, contactName, eventType, outcome, adSource,
      quoteJobValue, contactAddress, contactId, appointmentDateTime, appointmentDate,
    });
  }

  return rows;
}

async function main() {
  const tsvPath = path.join(__dirname, 'hdk_activity_raw.tsv');
  const raw = fs.readFileSync(tsvPath, 'utf-8');
  const rows = parseRows(raw);

  console.log(`Parsed ${rows.length} rows from HDK activity data.`);

  let activities = [];
  let skipped = 0;
  const jobWonMap = {}; // dedupKey → last index in activities array

  for (const row of rows) {
    const date = parseDate(row.rawDate);
    if (!date) {
      console.log(`  SKIP bad date: "${row.rawDate}" ${row.contactName}`);
      skipped++;
      continue;
    }

    if (isTestEntry(row.contactName, row.eventType)) {
      console.log(`  SKIP test: ${row.rawDate} ${row.contactName} ${row.eventType}`);
      skipped++;
      continue;
    }

    if (!row.eventType || !['EOD Update', 'Quote Sent', 'Site Visit Booked', 'Job Won', 'Email Sent'].includes(row.eventType.trim())) {
      console.log(`  SKIP invalid event: ${row.rawDate} ${row.contactName} "${row.eventType}"`);
      skipped++;
      continue;
    }

    // Deduplicate Job Won entries (Sam Power x3, Eric x2 on 2026-03-31 in source data)
    // Keep the last occurrence (highest value for Sam Power)
    if (row.eventType.trim() === 'Job Won') {
      const dedupKey = date + '|' + row.contactName.trim().toLowerCase();
      jobWonMap[dedupKey] = activities.length; // track index, overwrite with latest
    }

    const quoteJobValue = cleanQuoteValue(row.quoteJobValue);
    const contactAddress = (row.contactAddress || '').replace(/,\s*$/, '').trim();
    const contactId = (row.contactId || '').trim();
    const appointmentDate = row.appointmentDate ? (parseDate(row.appointmentDate) || row.appointmentDate.trim()) : '';

    activities.push({
      date,
      salesPerson: SALES_PERSON,
      contactName: row.contactName.trim(),
      eventType: row.eventType.trim(),
      outcome: row.outcome.trim(),
      adSource: row.adSource.trim(),
      quoteJobValue,
      contactAddress,
      contactId,
      appointmentDateTime: (row.appointmentDateTime || '').trim(),
      appointmentDate,
    });
  }

  // Remove duplicate Job Wons — keep only the last occurrence per date+name
  const dupJobWonIndices = new Set();
  const jobWonByKey = {};
  for (let i = 0; i < activities.length; i++) {
    if (activities[i].eventType === 'Job Won') {
      const key = activities[i].date + '|' + activities[i].contactName.toLowerCase();
      if (jobWonByKey[key] !== undefined) {
        dupJobWonIndices.add(jobWonByKey[key]); // mark earlier one for removal
        console.log(`  DEDUP Job Won: keeping later entry for ${activities[i].contactName} on ${activities[i].date}`);
      }
      jobWonByKey[key] = i;
    }
  }
  if (dupJobWonIndices.size > 0) {
    activities = activities.filter((_, i) => !dupJobWonIndices.has(i));
    console.log(`  Removed ${dupJobWonIndices.size} duplicate Job Won entries.`);
  }

  console.log(`${activities.length} rows to upload, ${skipped} skipped.`);
  if (activities.length > 0) {
    console.log(`Date range: ${activities[0]?.date} to ${activities[activities.length - 1]?.date}`);
  }

  // Upload in batches
  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(activities.length / BATCH_SIZE);

    console.log(`Uploading batch ${batchNum}/${totalBatches} (${batch.length} rows)...`);

    try {
      await logActivities(SHEET_ID, batch);
      console.log(`  Batch ${batchNum} done.`);
    } catch (err) {
      console.error(`  Batch ${batchNum} FAILED: ${err.message}`);
      console.log('  Waiting 30s and retrying...');
      await new Promise(r => setTimeout(r, 30000));
      try {
        await logActivities(SHEET_ID, batch);
        console.log(`  Batch ${batchNum} retry succeeded.`);
      } catch (err2) {
        console.error(`  Batch ${batchNum} retry FAILED: ${err2.message}`);
        process.exit(1);
      }
    }

    if (i + BATCH_SIZE < activities.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n=== HDK Activity Log backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
