/**
 * Import Quote Sent rows from Quotie CSV export into per-client Activity Logs.
 *
 * - Groups CSV rows by (client, date, salesperson, customer) → one Activity Log row
 *   per group with pipe-delimited quote values (matches existing format).
 * - Deletes existing Quote Sent rows in the CSV's date range before inserting
 *   to avoid duplicates and clear out old broken rows.
 * - Backs up each Activity Log to JSON before modifying.
 *
 * Usage:
 *   node src/scripts/importQuotieQuotes.js          # dry-run (no writes)
 *   node src/scripts/importQuotieQuotes.js --apply  # write to sheets
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const { readTab } = require('../sheets/readSheet');
const { writeSheet, clearRange } = require('../sheets/writeSheet');

const CLIENTS = {
  'Bolton EC':            { sheetId: '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c' },
  'Hughes Electrical':    { sheetId: '1waI6GXXPfrmIF18bJqHmSN1pIAGkH28TXbpj8vpivfU' },
  'HDK Long Run Roofing': { sheetId: '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0' },
};

const APPLY = process.argv.includes('--apply');

function detectClient(quoteName) {
  if (/Bolton EC/i.test(quoteName)) return 'Bolton EC';
  if (/Hughes Electrical/i.test(quoteName)) return 'Hughes Electrical';
  if (/HDK Long Run Roofing/i.test(quoteName)) return 'HDK Long Run Roofing';
  return null;
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write to sheets)' : 'DRY-RUN (no writes)'}\n`);

  const csvPath = path.join(__dirname, 'quotie_quotes.csv');
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));

  // Group by (client, date, salesperson, customer)
  const grouped = new Map();
  const dateSet = new Set();
  const skipped = [];
  for (const r of rows) {
    const client = detectClient(r.quote_name);
    if (!client) { skipped.push(r); continue; }
    const date = r.sent_date;
    const sp = r.salesperson;
    const customer = (r.customer || '').trim();
    const value = r.grand_total;
    const key = `${client}|${date}|${sp}|${customer}`;
    if (!grouped.has(key)) grouped.set(key, { client, date, sp, customer, values: [] });
    grouped.get(key).values.push(value);
    dateSet.add(date);
  }

  if (skipped.length) {
    console.log(`Skipped ${skipped.length} rows (no client detected):`);
    skipped.forEach(r => console.log(`  ${r.quote_name}`));
  }

  const dates = [...dateSet].sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  console.log(`\nCSV date range: ${minDate} → ${maxDate}`);
  console.log(`Total quote lines: ${rows.length}`);
  console.log(`Grouped into: ${grouped.size} Activity Log rows`);

  // Bucket by client
  const byClient = {};
  for (const g of grouped.values()) {
    if (!byClient[g.client]) byClient[g.client] = [];
    byClient[g.client].push(g);
  }

  for (const [clientName, groups] of Object.entries(byClient)) {
    const { sheetId } = CLIENTS[clientName];
    console.log(`\n=== ${clientName} ===`);

    const allRows = await readTab(sheetId, 'Activity Log');
    const headers = allRows[0];
    const H = name => headers.indexOf(name);

    // Find existing Quote Sent rows in date range (will be replaced)
    const oldQuoteRows = allRows.slice(1).filter(r =>
      r[H('Event Type')] === 'Quote Sent' &&
      r[H('Date')] >= minDate && r[H('Date')] <= maxDate
    );

    // Build contactId/address lookup from any existing rows
    const lookup = {};
    for (const r of allRows.slice(1)) {
      const name = (r[H('Contact Name')] || '').trim().toLowerCase();
      const cid = r[H('Contact ID')];
      const addr = r[H('Contact Address')];
      if (!name) continue;
      if (!lookup[name]) lookup[name] = { cid: '', addr: '' };
      if (cid && !lookup[name].cid) lookup[name].cid = cid;
      if (addr && !lookup[name].addr) lookup[name].addr = addr;
    }

    // Build new rows
    const newRows = groups.map(g => {
      const row = new Array(headers.length).fill('');
      row[H('Date')] = g.date;
      row[H('Sales Person')] = g.sp;
      row[H('Contact Name')] = g.customer;
      row[H('Event Type')] = 'Quote Sent';
      row[H('Outcome')] = 'Quote Sent';
      row[H('Quote/Job Value')] = g.values.join('|');
      const look = lookup[g.customer.toLowerCase()];
      if (look) {
        row[H('Contact ID')] = look.cid;
        row[H('Contact Address')] = look.addr;
      }
      return row;
    });

    // Sort new rows by date (ascending)
    newRows.sort((a, b) => a[H('Date')].localeCompare(b[H('Date')]));

    // Keep everything except old Quote Sent rows in range
    const keptRows = allRows.slice(1).filter(r =>
      !(r[H('Event Type')] === 'Quote Sent' &&
        r[H('Date')] >= minDate && r[H('Date')] <= maxDate)
    );

    const finalRows = [headers, ...keptRows, ...newRows];

    console.log(`  Quotes in CSV:           ${groups.length} rows`);
    console.log(`  Existing rows to delete: ${oldQuoteRows.length} rows`);
    console.log(`  Activity Log size:       ${allRows.length} → ${finalRows.length}`);
    console.log(`  Sample new rows:`);
    newRows.slice(-5).forEach(r => {
      const vals = r[H('Quote/Job Value')].split('|');
      console.log(`    ${r[H('Date')]} | ${r[H('Sales Person')]} | ${r[H('Contact Name')]} | ${vals.length} quotes`);
    });

    if (APPLY) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(__dirname, `backup_${clientName.replace(/\s+/g, '_')}_${stamp}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(allRows, null, 2));
      console.log(`  Backup → ${backupPath}`);

      await clearRange(sheetId, "'Activity Log'");
      await writeSheet(sheetId, "'Activity Log'!A1", finalRows);
      console.log(`  Activity Log rewritten.`);
    }
  }

  console.log(APPLY ? '\nDone (applied).' : '\nDry-run complete. Re-run with --apply to write.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
