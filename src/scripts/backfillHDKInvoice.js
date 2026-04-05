/**
 * Backfill HDK Activity Log with Job Won entries from invoice/commission data.
 * Each "Comms" row = one Job Won event, extracting client name, address, and quote value.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

function convertDate(ddmmyyyy) {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return null;
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

/**
 * Parse a Comms invoice row into Job Won data.
 * Column layout varies: find "Paid"/"Pending" status, then Comments is next.
 */
function parseCommsRow(parts) {
  const date = convertDate(parts[1]);
  if (!date) return null;

  // Find Status field ("Paid" or "Pending")
  const statusIdx = parts.findIndex(p => p === 'Paid' || p === 'Pending');
  if (statusIdx < 0) return null;

  const comments = parts[statusIdx + 1] || '';
  if (!comments) return null;

  // Extract client name and address from Comments
  let contactName = '', contactAddress = '';

  // Also check remaining parts for "HDK COMMS" if quotes broke the field
  let fullComments = comments;
  if (!fullComments.includes('HDK COMMS')) {
    for (let j = statusIdx + 2; j < parts.length; j++) {
      if (parts[j] && parts[j].includes('HDK COMMS')) { fullComments = parts[j]; break; }
    }
  }

  if (fullComments.includes('HDK COMMS')) {
    // Strip quote chars and invoice number prefix
    const stripped = fullComments.replace(/^["']/, '').replace(/^\d+\s*-\s*/, '');
    const commParts = stripped.split(/\s*-\s*/);
    // commParts[0] = "HDK COMMS", [1] = Name, [2] = Address (maybe), [3+] = description
    if (commParts.length >= 2) {
      contactName = commParts[1].trim();
      if (commParts.length >= 3) {
        const addrCandidate = commParts[2].trim();
        if (addrCandidate && !addrCandidate.startsWith('$') && !addrCandidate.match(/^\d+.*x\s*\d/)) {
          contactAddress = addrCandidate;
        }
      }
    }
  } else {
    // Early rows: Comments is just the client name (e.g., "Liz", "Nevile")
    contactName = comments.trim();
  }

  if (!contactName) return null;

  // Quote Value (Subtotal) is the first field after Comments that looks numeric
  let quoteValue = '';
  const qvField = (parts[statusIdx + 2] || '').trim();
  if (qvField) {
    // Match $XX,XXX.XX or plain number like 23516.62
    const cleaned = qvField.replace(/[$,]/g, '');
    if (/^\d+(\.\d+)?$/.test(cleaned) && parseFloat(cleaned) > 100) {
      quoteValue = cleaned;
    }
  }
  // Fallback: scan remaining fields for a large $ value
  if (!quoteValue) {
    for (let i = statusIdx + 2; i < Math.min(statusIdx + 5, parts.length); i++) {
      const val = parts[i];
      if (val && /^\$[\d,.]+$/.test(val)) {
        const num = parseFloat(val.replace(/[$,]/g, ''));
        if (num > 1000) { quoteValue = val.replace(/[$,]/g, ''); break; }
      }
    }
  }

  // If no explicit quote value, estimate from commission amount.
  // Commission is the last $ field before Status (Amount minus GST).
  if (!quoteValue) {
    let commissionAUD = 0;
    for (let i = statusIdx - 1; i >= 3; i--) {
      if (parts[i] && /^\$[\d,.]+$/.test(parts[i])) {
        commissionAUD = parseFloat(parts[i].replace(/[$,]/g, ''));
        break;
      }
    }
    if (commissionAUD > 0) {
      // Convert AUD to NZD (÷ 0.90), then reverse the commission rate.
      // HDK rates: 2.5% for large jobs (>$30k), 3% for medium ($20-30k), 4% for smaller.
      // Minimums: $950 NZD (2.5%), $800 NZD (3%), $500 NZD (4%).
      // Use iterative approach: estimate with 3.5%, then refine based on result.
      const commNZD = commissionAUD / 0.90;
      let rate, estimated;
      if (commNZD >= 900) {
        // Could be 2.5% rate or a min-floor hit at 3%
        rate = 0.025;
        estimated = commNZD / rate;
        // If estimate > $35k, 2.5% is right. If < $27k, it was likely 3% min floor.
        if (estimated < 27000) { rate = 0.03; estimated = commNZD / rate; }
      } else if (commNZD >= 650) {
        rate = 0.03;
        estimated = commNZD / rate;
      } else {
        rate = 0.04;
        estimated = commNZD / rate;
        // If commission = $500 NZD (minimum), quote could be up to $12,500
        // Use the rate-based estimate as-is
      }
      quoteValue = String(Math.round(estimated * 100) / 100);
    }
  }

  return { date, contactName, contactAddress, quoteValue };
}

async function main() {
  const tsvPath = path.join(__dirname, 'hdk_invoice_raw.tsv');
  const raw = fs.readFileSync(tsvPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const activities = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/ {4,}/).map(s => s.trim());

    // Only process Comms rows (commission = Job Won)
    if (parts[2] !== 'Comms') {
      skipped++;
      continue;
    }

    // Skip the $0 deduction row
    if (parts.some(p => p.includes('cancel each other out') || p.includes('MOSES Deduction'))) {
      console.log(`  SKIP deduction row: line ${i}`);
      skipped++;
      continue;
    }

    const parsed = parseCommsRow(parts);
    if (!parsed) {
      console.log(`  SKIP unparseable: line ${i} - ${parts.slice(0, 4).join(' | ')}`);
      skipped++;
      continue;
    }

    // Skip entries from 2026-01-20 onwards — activity log TSV already has Job Wons for that period
    if (parsed.date >= '2026-01-20') {
      skipped++;
      continue;
    }

    activities.push({
      date: parsed.date,
      salesPerson: SALES_PERSON,
      contactName: parsed.contactName,
      eventType: 'Job Won',
      outcome: 'Job Won',
      adSource: '',
      quoteJobValue: parsed.quoteValue,
      contactAddress: parsed.contactAddress,
      contactId: '',
      appointmentDateTime: '',
      appointmentDate: '',
    });
  }

  console.log(`${activities.length} Job Won entries to upload, ${skipped} skipped.`);
  if (activities.length > 0) {
    console.log(`Date range: ${activities[0].date} to ${activities[activities.length - 1].date}`);
    // Show a few samples
    for (const a of activities.slice(0, 3)) {
      console.log(`  ${a.date} | ${a.contactName} | ${a.contactAddress || 'N/A'} | $${a.quoteJobValue || '0'}`);
    }
    console.log('  ...');
    for (const a of activities.slice(-2)) {
      console.log(`  ${a.date} | ${a.contactName} | ${a.contactAddress || 'N/A'} | $${a.quoteJobValue || '0'}`);
    }
  }

  if (activities.length === 0) {
    console.log('Nothing to upload.');
    return;
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

  console.log('\n=== HDK Invoice Job Won backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
