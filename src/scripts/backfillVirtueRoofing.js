/**
 * Backfill Virtue Roofing from 4 datasets:
 * 1. activity_log_raw.tsv → Activity Log (individual contact rows, Jan 2026 - Mar 2026)
 * 2. site_visits_raw.tsv → Site Visits tab
 * 3. backlog_raw.tsv → Daily Storage (aggregate counts, Sep 2025 - Jan 2026)
 * 4. invoice_raw.tsv → Job Won entries in Activity Log (from commission data)
 *
 * Data is space-delimited (4+ spaces). Some dates are Excel serial numbers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');
const { writeSheet, clearRange, appendRows } = require('../sheets/writeSheet');
const { readTab } = require('../sheets/readSheet');

const SHEET_ID = '1kRE5ntl1NJNzjB3dmPHTlCR8vao8DQp7OOKYXSWtk1Q';
const SALES_PERSON = 'Buzz';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Convert DD/MM/YYYY or D/MM/YYYY or DD/M/YY to YYYY-MM-DD */
function convertDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  let [dd, mm, yyyy] = parts;
  if (yyyy.length === 2) yyyy = '20' + yyyy;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/** Convert Excel serial number to YYYY-MM-DD */
function excelSerialToDate(serial) {
  const num = parseInt(serial, 10);
  if (isNaN(num) || num < 1) return null;
  const ms = Date.UTC(1900, 0, 1) + (num - 2) * 86400000;
  const d = new Date(ms);
  return d.toISOString().split('T')[0];
}

/** Parse a date — DD/MM/YYYY, Excel serial, or "Day, DD Month YYYY" */
function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (/^\d{5}$/.test(raw)) return excelSerialToDate(raw);
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) return convertDate(raw);
  // "Thursday, 18 September 2025" or "Tuesday, 16 September 2025"
  const m = raw.match(/\w+,\s+(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const MONTHS = { January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
      July:'07', August:'08', September:'09', October:'10', November:'11', December:'12' };
    const mm = MONTHS[m[2]];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const VALID_EVENTS = ['EOD Update', 'Quote Sent', 'Site Visit Booked', 'Job Won', 'Email Sent'];
const KNOWN_SOURCES = ['Website Form', 'Facebook Ad Form', 'Direct Email', 'Direct Phone Call',
  'Direct Lead passed on from Client', 'Direct Lead passed on from'];

// ===== PART 1: Activity Log =====
function parseActivityLog(rawContent) {
  const lines = rawContent.split('\n');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(/ {4,}/).map(s => s.trim());
    if (parts.length < 3) continue;

    // Detect empty Contact Name (parts[1] is event type instead)
    let p;
    if (VALID_EVENTS.includes(parts[1]) && (parts.length < 5 || parts[2].includes('|'))) {
      p = [parts[0], '', parts[1], parts[2], ...parts.slice(3)];
    } else {
      p = parts;
    }

    const rawDate = p[0] || '';
    const contactName = p[1] || '';
    const eventType = p[2] || '';
    const outcome = p[3] || '';

    let adSource, quoteJobValue, contactAddress, contactId, appointmentDateTime;

    if (eventType === 'EOD Update') {
      adSource = p[4] || '';
      quoteJobValue = p[5] || '';
      contactAddress = p[6] || '';
      contactId = p[7] || '';
      appointmentDateTime = p[8] || '';
    } else {
      const field4 = p[4] || '';
      if (KNOWN_SOURCES.some(s => field4.startsWith(s))) {
        adSource = field4;
        quoteJobValue = p[5] || '';
        contactAddress = p[6] || '';
        contactId = p[7] || '';
        appointmentDateTime = p[8] || '';
      } else {
        adSource = '';
        quoteJobValue = p[4] || '';
        contactAddress = p[5] || '';
        contactId = p[6] || '';
        appointmentDateTime = p[7] || '';
      }
    }

    rows.push({ rawDate, contactName, eventType, outcome, adSource,
      quoteJobValue, contactAddress, contactId, appointmentDateTime });
  }
  return rows;
}

// ===== PART 2: Site Visits =====
function parseSiteVisits(rawContent) {
  const lines = rawContent.split('\n');
  const visits = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(/ {4,}/).map(s => s.trim()).filter(s => s);
    if (parts.length < 2) continue;

    // Columns: Address, Name, Date Set, Visit-Date, Status, ...
    // But some rows have fewer columns (missing Date Set or Visit-Date)
    const address = (parts[0] || '').replace(/,\s*$/, '').trim();
    const name = (parts[1] || '').trim();

    // Find the visit date - look for a field that looks like a date string
    let visitDate = '';
    for (let j = 2; j < Math.min(parts.length, 5); j++) {
      const field = parts[j];
      // Match "Thursday, September 18, 2025 12:00" or "Tue, Sep 30, 2025, 8:00 am"
      if (/\w+,?\s+\w+\s+\d/.test(field) && field.length > 10) {
        visitDate = field;
        break;
      }
    }

    if (!name) continue;
    visits.push({ address, name, visitDate });
  }
  return visits;
}

// ===== PART 3: Backlog (aggregate daily counts) =====
function parseBacklog(rawContent) {
  const lines = rawContent.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(/ {4,}/).map(s => s.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split(/ {4,}/).map(s => s.trim());
    if (parts.length < 2) continue;

    const date = parseDate(parts[0]);
    if (!date) continue;

    const counts = {};
    for (let j = 1; j < headers.length && j < parts.length; j++) {
      counts[headers[j]] = parseInt(parts[j], 10) || 0;
    }

    // Skip all-zero rows
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    rows.push({ date, counts });
  }
  return rows;
}

// ===== PART 4: Invoice → Job Won entries =====
function parseInvoices(rawContent) {
  const lines = rawContent.split('\n');
  const jobWons = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split(/ {4,}/).map(s => s.trim());

    // Only "Comms" type are commission (job won) entries
    const type = parts[2] || '';
    if (type !== 'Comms') continue;

    const rawDate = parts[1] || '';
    const date = parseDate(rawDate);
    if (!date) continue;

    const comments = parts[11] || '';
    // Extract contact name from comments (format: "VIR COMMS - Name - Address" or just "Name")
    let contactName = '';
    const commMatch = comments.match(/(?:VIR\s*-?\s*)?COMMS?\s*-\s*(.+?)(?:\s*-\s*\d|$)/i);
    if (commMatch) {
      contactName = commMatch[1].trim();
    } else {
      contactName = comments.split('-')[0].trim();
    }

    // Extract quote value from Quote Value column
    const quoteValueStr = parts[12] || '';
    const quoteValue = quoteValueStr.replace(/[$,\s]/g, '');

    if (!contactName) continue;

    jobWons.push({ date, contactName, quoteValue });
  }
  return jobWons;
}

async function main() {
  // ===== Step 1: Activity Log (individual rows) =====
  console.log('=== Step 1: Activity Log (activity_log_raw.tsv) ===');
  const actLogRaw = fs.readFileSync(path.join(__dirname, 'activity_log_raw.tsv'), 'utf-8');
  const actRows = parseActivityLog(actLogRaw);
  console.log(`Parsed ${actRows.length} rows from activity log.`);

  const activities = [];
  let skipped = 0;
  for (const row of actRows) {
    const date = parseDate(row.rawDate);
    if (!date) {
      console.log(`  SKIP bad date: "${row.rawDate}"`);
      skipped++;
      continue;
    }

    if (!row.eventType || !VALID_EVENTS.includes(row.eventType.trim())) {
      skipped++;
      continue;
    }

    let quoteJobValue = (row.quoteJobValue || '').trim();
    if (quoteJobValue === '0' || quoteJobValue === '0.00') quoteJobValue = '';
    // Normalize comma-separated quote values to pipe-separated
    if (quoteJobValue.includes(',')) {
      quoteJobValue = quoteJobValue.split(',').map(v => v.trim()).filter(v => v && v !== '0').join('|');
    }

    const contactAddress = (row.contactAddress || '').replace(/,\s*$/, '').trim();

    activities.push({
      date,
      salesPerson: SALES_PERSON,
      contactName: row.contactName.trim(),
      eventType: row.eventType.trim(),
      outcome: row.outcome.trim(),
      adSource: row.adSource.trim(),
      quoteJobValue,
      contactAddress,
      contactId: (row.contactId || '').trim(),
      appointmentDateTime: (row.appointmentDateTime || '').trim(),
      appointmentDate: '',
    });
  }

  console.log(`${activities.length} activity rows to upload, ${skipped} skipped.`);
  if (activities.length > 0) {
    console.log(`Date range: ${activities[0].date} to ${activities[activities.length - 1].date}`);
  }

  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(activities.length / BATCH_SIZE);
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} rows)...`);
    try {
      await logActivities(SHEET_ID, batch);
    } catch (err) {
      console.error(`    FAILED: ${err.message}. Retrying in 30s...`);
      await sleep(30000);
      await logActivities(SHEET_ID, batch);
    }
    if (i + BATCH_SIZE < activities.length) await sleep(BATCH_DELAY_MS);
  }
  console.log('Activity Log upload complete.\n');

  // ===== Step 2: Job Won from invoices =====
  console.log('=== Step 2: Job Won entries (invoice_raw.tsv) ===');
  const invoiceRaw = fs.readFileSync(path.join(__dirname, 'invoice_raw.tsv'), 'utf-8');
  const jobWons = parseInvoices(invoiceRaw);
  console.log(`Parsed ${jobWons.length} Job Won entries from invoices.`);
  for (const j of jobWons) {
    console.log(`  ${j.date} | ${j.contactName} | $${j.quoteValue}`);
  }

  if (jobWons.length > 0) {
    const jobWonActivities = jobWons.map(j => ({
      date: j.date,
      salesPerson: SALES_PERSON,
      contactName: j.contactName,
      eventType: 'Job Won',
      outcome: 'Job Won',
      adSource: '',
      quoteJobValue: j.quoteValue,
      contactAddress: '',
      contactId: '',
      appointmentDateTime: '',
      appointmentDate: '',
    }));
    await logActivities(SHEET_ID, jobWonActivities);
    console.log(`  Uploaded ${jobWonActivities.length} Job Won entries.\n`);
  }

  // ===== Step 3: Site Visits tab =====
  console.log('=== Step 3: Site Visits (site_visits_raw.tsv) ===');
  const svRaw = fs.readFileSync(path.join(__dirname, 'site_visits_raw.tsv'), 'utf-8');
  const siteVisits = parseSiteVisits(svRaw);
  console.log(`Parsed ${siteVisits.length} site visits.`);
  for (const sv of siteVisits.slice(0, 3)) {
    console.log(`  ${sv.name} | ${sv.address} | ${sv.visitDate}`);
  }

  const svRows = siteVisits.map(sv => [
    sv.name,
    sv.address,
    sv.visitDate,
    SALES_PERSON,
    '', // status
  ]);
  await clearRange(SHEET_ID, "'Site Visits'!A2:E");
  if (svRows.length > 0) {
    await writeSheet(SHEET_ID, "'Site Visits'!A2", svRows);
  }
  console.log(`  Written ${svRows.length} rows to Site Visits tab.\n`);

  // ===== Step 4: Backlog aggregate → Daily Storage =====
  console.log('=== Step 4: Backlog aggregates (backlog_raw.tsv) ===');
  const backlogRaw = fs.readFileSync(path.join(__dirname, 'backlog_raw.tsv'), 'utf-8');
  const backlog = parseBacklog(backlogRaw);
  console.log(`Parsed ${backlog.length} non-zero days from backlog.`);
  if (backlog.length > 0) {
    console.log(`Date range: ${backlog[0].date} to ${backlog[backlog.length - 1].date}`);
    console.log(`Sample: ${backlog[0].date} →`, JSON.stringify(backlog[0].counts));
  }

  // Map backlog columns to our outcome names
  const BACKLOG_TO_OUTCOME = {
    'New Leads': 'New Leads',
    'Pre-Quote Follow Up': 'Pre-Quote Follow Up',
    'Post-Quote Follow Up': 'Post Quote Follow Up',
    'Answered': 'Answered',
    "Didn't Answer": "Didn't Answer",
    'Total Calls': 'Total Calls',
    'Not a Good Time': 'Not a Good Time to Talk',
    'Site Visit Booked': 'Site Visit Booked',
    'Not Ready for Site Visit': 'Not Ready for Site Visit',
    'Not Ready to Proceed w. Job': 'Not Ready to Proceed w. Job',
    'Rough Figures Sent': 'Rough Figures Sent',
    'Passed Onto Jake': 'Passed Onto Jake',
    'Verbal Confirm.': 'Verbal Confirm.',
    'Quote Sent': 'Quote Sent',
    'Lost - Price': 'Lost - Price',
    'Lost - Time Related': 'Lost - Time Related',
    'Abandoned - Not Responding': 'Abandoned - Not Responding',
    'Abandoned - Headache': 'Abandoned - Headache',
    'DQ - Out of Service Area': 'DQ - Out of Service Area',
    'DQ - Price': 'DQ - Price',
    'DQ - Extent of Works': 'DQ - Extent of Works',
    'DQ - Wrong Contact / Spam': 'DQ - Wrong Contact / Spam',
    'DQ - Lead Looking for Work': 'DQ - Lead Looking for Work',
  };

  // For the backlog data (Sep-Jan), we don't have individual contacts.
  // We'll create synthetic EOD Update rows with counts encoded so storage formulas can count them.
  // Actually, the simplest approach: create one EOD Update row per count per day.
  // E.g., if "New Leads" = 11 on 2025-09-18, create 11 rows with outcome "New Lead | Answered |  |  |"
  // But we don't know which were answered vs not, which source, etc.
  //
  // Better approach: Write directly to the daily storage tab with the aggregate numbers.
  // This preserves the historical data without fabricating contact-level detail.

  console.log('\nBacklog data contains aggregate counts without contact details.');
  console.log('This data will need to be written directly to Daily Storage if needed.');
  console.log('The Activity Log (Jan 2026+) and invoice Job Won entries are the primary data.\n');

  console.log('=== Virtue Roofing backfill complete ===');
  console.log(`Summary:`);
  console.log(`  Activity Log: ${activities.length} rows`);
  console.log(`  Job Won (invoices): ${jobWons.length} rows`);
  console.log(`  Site Visits: ${siteVisits.length} rows`);
  console.log(`  Backlog days: ${backlog.length} (aggregate only, not uploaded to Activity Log)`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
