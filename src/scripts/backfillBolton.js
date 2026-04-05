require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

function convertDate(ddmmyyyy) {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

function isTestEntry(contactName, eventType, dateStr) {
  if (!contactName) return false;
  const name = contactName.trim().toLowerCase();
  if (name !== 'lachlan boys') return false;
  if (!['Job Won', 'Site Visit Booked'].includes(eventType)) return false;
  // Skip Lachlan Boys Job Won/Site Visit from 02/04 onwards
  const parts = dateStr.split('/');
  const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  return d >= new Date('2026-04-02');
}

function cleanQuoteValue(raw) {
  if (!raw) return '';
  // Remove wrapping quotes and newlines
  let cleaned = raw.replace(/^"|"$/g, '').replace(/\n/g, '').trim();
  if (!cleaned || cleaned === '0.00' || cleaned === '0') return cleaned;
  // Convert comma-separated values to pipe-separated
  const values = cleaned.split(',').map(v => v.trim()).filter(v => v && v !== '');
  return values.join('|');
}

const FIELD_KEYS = ['rawDate','contactName','eventType','outcome','adSource','quoteJobValue','contactAddress','contactId','appointmentDateTime','appointmentDate'];

function parseRows(rawContent) {
  const lines = rawContent.split('\n');
  const rows = [];
  let currentRow = null;
  let openQuoteField = null; // track which field has an unclosed quote

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // If we're inside a multi-line quoted field, append to it
    if (currentRow && openQuoteField) {
      const tabParts = line.split('\t');
      currentRow[openQuoteField] += '\n' + tabParts[0];
      if (tabParts[0].includes('"')) {
        openQuoteField = null;
        // Remaining tab parts are subsequent columns
        const fieldIdx = FIELD_KEYS.indexOf(openQuoteField);
      }
      // Fill remaining columns from continuation line tabs
      // The continuation tabs map to columns AFTER the quoted field
      const qIdx = FIELD_KEYS.indexOf(openQuoteField || '');
      if (tabParts.length > 1) {
        for (let t = 1; t < tabParts.length && qIdx + t < FIELD_KEYS.length; t++) {
          if (tabParts[t]) currentRow[FIELD_KEYS[qIdx + t]] = tabParts[t];
        }
      }
      openQuoteField = null; // close after processing continuation
      continue;
    }

    // Check if line starts with a date
    const dateMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\t/);

    if (dateMatch) {
      if (currentRow) rows.push(currentRow);
      const parts = line.split('\t');
      currentRow = {};
      for (let p = 0; p < FIELD_KEYS.length; p++) {
        currentRow[FIELD_KEYS[p]] = parts[p] || '';
      }

      // Check if any field starts with " but doesn't close it (multi-line)
      for (let p = 0; p < FIELD_KEYS.length; p++) {
        const val = parts[p] || '';
        if (val.startsWith('"') && !val.endsWith('"') && val.split('"').length % 2 === 0) {
          openQuoteField = FIELD_KEYS[p];
          break;
        }
      }
    } else if (currentRow) {
      // Continuation line without tracked quote — append to quoteJobValue as fallback
      const tabParts = line.split('\t');
      currentRow.quoteJobValue += '\n' + tabParts[0];
      if (tabParts.length > 1) {
        currentRow.contactAddress = tabParts[1] || currentRow.contactAddress;
        currentRow.contactId = tabParts[2] || currentRow.contactId;
        currentRow.appointmentDateTime = tabParts[3] || currentRow.appointmentDateTime;
        currentRow.appointmentDate = tabParts[4] || currentRow.appointmentDate;
      }
    }
  }
  if (currentRow) rows.push(currentRow);

  return rows;
}

async function main() {
  const tsvPath = path.join(__dirname, 'backlog_raw.tsv');
  const raw = fs.readFileSync(tsvPath, 'utf-8');
  const rows = parseRows(raw);

  console.log(`Parsed ${rows.length} rows from backlog data.`);

  // Filter and transform
  const activities = [];
  let skipped = 0;

  for (const row of rows) {
    const date = convertDate(row.rawDate);
    if (!date) { skipped++; continue; }

    if (isTestEntry(row.contactName, row.eventType, row.rawDate)) {
      console.log(`  SKIP test: ${row.rawDate} ${row.contactName} ${row.eventType}`);
      skipped++;
      continue;
    }

    const quoteJobValue = cleanQuoteValue(row.quoteJobValue);
    const contactAddress = (row.contactAddress || '').replace(/^"|"$/g, '').replace(/\n/g, ' ').replace(/,\s*$/, '').trim();
    const contactId = (row.contactId || '').trim();
    const appointmentDate = row.appointmentDate ? convertDate(row.appointmentDate.trim()) || row.appointmentDate.trim() : '';

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

  console.log(`${activities.length} rows to upload, ${skipped} skipped.`);
  console.log(`Date range: ${activities[0]?.date} to ${activities[activities.length - 1]?.date}`);

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

  console.log('\n=== Backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
