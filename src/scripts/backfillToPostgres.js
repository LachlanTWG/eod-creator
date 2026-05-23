// Backfill every active company's Activity Log tab into Postgres.
// Idempotent: source='sheets_backfill', source_row_id=<sheet row number>.
// The unique index on (company_id, source, source_row_id) makes re-runs safe.
//
// Usage:  DATABASE_URL=... node src/scripts/backfillToPostgres.js
//         DATABASE_URL=... node src/scripts/backfillToPostgres.js --company "Bolton EC"

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { loadAllCompanies } = require('../config/companiesStore');
const { readTab } = require('../sheets/readSheet');
const db = require('../db');

// Activity Log column order (matches src/sheets/logActivity.js toRow()):
//   0 date, 1 salesPerson, 2 contactName, 3 eventType, 4 outcome,
//   5 adSource, 6 quoteJobValue, 7 contactAddress, 8 contactId,
//   9 appointmentDateTime, 10 appointmentDate
const EVENT_TYPE_TO_DB = {
  'EOD Update': 'eod_update',
  'Job Won': 'job_won',
  'Site Visit Booked': 'site_visit_booked',
  'Quote Sent': 'quote_sent',
  'Email Sent': 'email_sent',
};

// Sheets serial date → YYYY-MM-DD
function normaliseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4,5}$/.test(s)) {
    return new Date((parseInt(s, 10) - 25569) * 86400000).toISOString().slice(0, 10);
  }
  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// Try to parse an appointment timestamp. Sheet column has all sorts of formats
// ("Fri, 9 Jan, 14:30", "2026-01-09T14:30:00", numbers, blanks). Return null
// rather than failing the whole row — the original value can be recovered from
// the corresponding sheet row if ever needed.
function normaliseTimestamp(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  // ISO-ish
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Sheets serial number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date((parseFloat(s) - 25569) * 86400000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Anything else (human-readable etc.) — don't guess, drop.
  return null;
}

async function backfillCompany(company) {
  console.log(`\n→ ${company.name}`);
  let rows;
  try {
    rows = await readTab(company.sheetId, 'Activity Log');
  } catch (e) {
    console.error(`  ✗ could not read Activity Log: ${e.message}`);
    return { inserted: 0, deduped: 0, skipped: 0, failed: 0 };
  }
  if (rows.length <= 1) {
    console.log('  (no rows)');
    return { inserted: 0, deduped: 0, skipped: 0, failed: 0 };
  }

  let inserted = 0, deduped = 0, skipped = 0, failed = 0;

  // i=1 to skip header. Sheet row number = i + 1.
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sheetRowNum = i + 1;

    const date = normaliseDate(r[0]);
    const salesPersonName = (r[1] || '').trim();
    const eventTypeRaw = (r[3] || 'EOD Update').trim();
    const eventType = EVENT_TYPE_TO_DB[eventTypeRaw];

    if (!date || !salesPersonName || !eventType) {
      skipped++;
      continue;
    }

    try {
      const result = await db.insertActivity({
        companyName: company.name,
        salesPersonName,
        occurredOn: date,
        eventType,
        contactName: (r[2] || '').trim() || null,
        outcome: (r[4] || '').trim() || null,
        adSource: (r[5] || '').trim() || null,
        quoteJobValue: (r[6] || '').trim() || null,
        contactAddress: (r[7] || '').trim() || null,
        contactId: (r[8] || '').trim() || null,
        appointmentAt: normaliseTimestamp(r[9]),
        source: 'sheets_backfill',
        sourceRowId: String(sheetRowNum),
      });
      if (result.deduped) deduped++;
      else inserted++;
    } catch (e) {
      failed++;
      if (failed <= 3) {
        console.error(`  row ${sheetRowNum} failed: ${e.message}`);
      }
    }
  }

  console.log(`  ✓ inserted=${inserted}  deduped=${deduped}  skipped=${skipped}  failed=${failed}  (of ${rows.length - 1})`);
  return { inserted, deduped, skipped, failed };
}

async function main() {
  if (!db.isEnabled()) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const companyFlag = args.indexOf('--company');
  const onlyName = companyFlag !== -1 ? args[companyFlag + 1] : null;

  const { companies } = loadAllCompanies();
  const targets = companies.filter(c => c.sheetId && (!onlyName || c.name.toLowerCase() === onlyName.toLowerCase()));

  if (targets.length === 0) {
    console.error('No matching companies (need a sheetId).');
    process.exit(1);
  }

  console.log(`Backfilling ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'}...`);

  let totals = { inserted: 0, deduped: 0, skipped: 0, failed: 0 };
  for (const c of targets) {
    const result = await backfillCompany(c);
    for (const k of Object.keys(totals)) totals[k] += result[k];
  }

  console.log('\n─ totals ─────────────────────');
  console.log(`  inserted: ${totals.inserted}`);
  console.log(`  deduped:  ${totals.deduped}`);
  console.log(`  skipped:  ${totals.skipped}`);
  console.log(`  failed:   ${totals.failed}`);

  await db.close();
}

main().catch(err => {
  console.error('Backfill failed:', err.message);
  console.error(err);
  process.exit(1);
});
