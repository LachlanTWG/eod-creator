/**
 * Backfill missing Job Won entries from invoice data into Bolton EC Activity Log.
 * Cross-references against existing Job Won rows to avoid duplicates.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { readTab } = require('../sheets/readSheet');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const SALES_PERSON = 'Lachlan';

function normalizeName(name) {
  return (name || '').split(/[, ()\-.]+/).filter(Boolean).map(p => p.toLowerCase()).sort().join(' ');
}

/**
 * Strict matching: normalized name match OR word-boundary matching on all 5+ char parts.
 */
function namesMatch(invName, jwName) {
  const normA = normalizeName(invName);
  const normB = normalizeName(jwName);
  if (normA === normB) return true;

  // Split both names into individual word tokens
  const invWords = invName.split(/[, ()\-.]+/).filter(Boolean).map(p => p.toLowerCase());
  const jwWords = (jwName || '').split(/[, ()\-.]+/).filter(Boolean).map(p => p.toLowerCase());

  // Require ALL words of 5+ chars from invoice name to exactly match a word in JW name
  const invLong = invWords.filter(p => p.length >= 5);
  if (invLong.length > 0 && invLong.every(p => jwWords.includes(p))) return true;

  // And vice versa
  const jwLong = jwWords.filter(p => p.length >= 5);
  if (jwLong.length > 0 && jwLong.every(p => invWords.includes(p))) return true;

  return false;
}

function parseComment(comment) {
  if (!comment) return { name: '', address: '' };
  let c = comment.replace(/^\d+\s*-\s*/, '').replace(/^BEC COMMS\s*-\s*/i, '').trim();
  // Remove trailing ' - ' junk (commission descriptions, notes)
  // Split on ' - ' and take first two parts (name, address)
  const dashParts = c.split(' - ');
  let name = (dashParts[0] || '').trim();
  let address = (dashParts.length > 1 ? dashParts[1] : '').trim();

  // Clean up trailing junk from name and address
  name = name.replace(/\s*-\s*$/, '').trim();
  address = address.replace(/\s*-\s*$/, '').replace(/\s*-\s+\$.*$/, '').trim();

  // Some comments are just a name like "Shari" or "Ian Hartley - This one is on the house."
  if (address && address.match(/^(This|50%|comms)/i)) address = '';

  return { name, address };
}

function convertDate(d) {
  const parts = d.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

async function main() {
  // Parse invoice data
  const raw = fs.readFileSync(path.join(__dirname, 'invoice_raw.tsv'), 'utf-8');
  const lines = raw.split('\n').slice(1).filter(l => l.trim());

  const invoiceJobs = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts[2] !== 'Comms') continue;
    const { name, address } = parseComment(parts[11]);
    const quoteVal = (parts[12] || '').replace(/[$,\s"]/g, '');
    if (!name) continue;

    invoiceJobs.push({
      date: convertDate(parts[1]),
      name,
      address,
      quoteValue: parseFloat(quoteVal) || 0,
    });
  }

  console.log(`Parsed ${invoiceJobs.length} Comms entries from invoices.\n`);

  // Read existing Job Won rows
  const rows = await readTab(SHEET_ID, 'Activity Log');
  const jobWons = rows.slice(1).filter(r => r[3] === 'Job Won');
  console.log(`Existing Job Won rows: ${jobWons.length}\n`);

  // Find missing entries
  const missing = [];
  const matched = [];

  for (const inv of invoiceJobs) {
    const found = jobWons.find(jw => namesMatch(inv.name, jw[2]));
    if (found) {
      matched.push({ inv: inv.name, jw: found[2] });
    } else {
      missing.push(inv);
    }
  }

  console.log(`Matched: ${matched.length}`);
  console.log(`Missing: ${missing.length}\n`);

  if (missing.length === 0) {
    console.log('Nothing to add!');
    return;
  }

  // Cross-reference lead sources from Activity Log EOD Updates
  const allActivities = rows.slice(1);
  function resolveSource(name) {
    const norm = normalizeName(name);
    // Try normalized name match
    const match = allActivities.find(r =>
      r[3] === 'EOD Update' && r[5] && normalizeName(r[2]) === norm
    );
    if (match) return match[5];

    // Try partial (5+ char parts)
    const parts = name.split(/[, ()\-.]+/).filter(p => p.length >= 5).map(p => p.toLowerCase());
    if (parts.length > 0) {
      const partial = allActivities.find(r =>
        r[3] === 'EOD Update' && r[5] &&
        parts.every(p => (r[2] || '').toLowerCase().includes(p))
      );
      if (partial) return partial[5];
    }
    return '';
  }

  console.log('=== Missing entries to add ===\n');
  const toUpload = missing.map(m => {
    const source = resolveSource(m.name);
    console.log(`  ${m.date} | ${m.name} | ${m.address || 'N/A'} | $${m.quoteValue.toLocaleString()} | ${source || 'N/A'}`);
    return {
      date: m.date,
      salesPerson: SALES_PERSON,
      contactName: m.name,
      eventType: 'Job Won',
      outcome: 'Job Won',
      adSource: source,
      quoteJobValue: m.quoteValue ? String(m.quoteValue) : '',
      contactAddress: m.address,
      contactId: '',
      appointmentDateTime: '',
      appointmentDate: '',
    };
  });

  console.log(`\nUploading ${toUpload.length} missing Job Won entries...`);

  // Upload in batches
  const BATCH_SIZE = 50;
  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);
    await logActivities(SHEET_ID, batch);
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} done (${batch.length} rows).`);
    if (i + BATCH_SIZE < toUpload.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
