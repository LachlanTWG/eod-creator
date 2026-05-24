// Read-only reconciliation: compare each company's Activity Log tab against
// the activities table in Postgres. Highlights the exact gap so we know
// whether the dashboard discrepancy is a missing-backfill, a row-skip, an
// event_type alias miss, or a person-name canonicalisation problem.
//
// Usage:  DATABASE_URL=... node src/scripts/reconcileSheetsVsPostgres.js
//         DATABASE_URL=... node src/scripts/reconcileSheetsVsPostgres.js --company "Bolton EC"
//         DATABASE_URL=... node src/scripts/reconcileSheetsVsPostgres.js --all   (include inactive)

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { loadAllCompanies } = require('../config/companiesStore');
const { readTab } = require('../sheets/readSheet');
const db = require('../db');

const EVENT_TYPE_TO_DB = {
  'EOD Update': 'eod_update',
  'Job Won': 'job_won',
  'Site Visit Booked': 'site_visit_booked',
  'Quote Sent': 'quote_sent',
  'Email Sent': 'email_sent',
};

function normaliseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4,5}$/.test(s)) {
    return new Date((parseInt(s, 10) - 25569) * 86400000).toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padNum(n, w) {
  return String(n).padStart(w, ' ');
}

async function analyseSheet(company) {
  let rows;
  try {
    rows = await readTab(company.sheetId, 'Activity Log');
  } catch (e) {
    return { error: `could not read Activity Log: ${e.message}` };
  }

  if (rows.length <= 1) {
    return {
      dataRows: 0,
      validRows: 0,
      skipped: { missingDate: 0, missingPerson: 0, unknownEventType: 0, total: 0 },
      eventTypeCounts: {},
      unknownEventTypes: {},
      salesPersonCounts: {},
      validByDbType: {},
      minDate: null,
      maxDate: null,
    };
  }

  const dataRows = rows.length - 1;
  let validRows = 0;
  const skipped = { missingDate: 0, missingPerson: 0, unknownEventType: 0, total: 0 };
  const eventTypeCounts = {};
  const unknownEventTypes = {};
  const salesPersonCounts = {};
  const validByDbType = {};
  let minDate = null, maxDate = null;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normaliseDate(r[0]);
    const person = (r[1] || '').trim();
    const eventTypeRaw = (r[3] || 'EOD Update').trim();
    const dbType = EVENT_TYPE_TO_DB[eventTypeRaw];

    eventTypeCounts[eventTypeRaw] = (eventTypeCounts[eventTypeRaw] || 0) + 1;
    if (person) salesPersonCounts[person] = (salesPersonCounts[person] || 0) + 1;

    if (!date) { skipped.missingDate++; skipped.total++; continue; }
    if (!person) { skipped.missingPerson++; skipped.total++; continue; }
    if (!dbType) {
      skipped.unknownEventType++;
      skipped.total++;
      unknownEventTypes[eventTypeRaw] = (unknownEventTypes[eventTypeRaw] || 0) + 1;
      continue;
    }
    validRows++;
    validByDbType[dbType] = (validByDbType[dbType] || 0) + 1;
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }

  return {
    dataRows,
    validRows,
    skipped,
    eventTypeCounts,
    unknownEventTypes,
    salesPersonCounts,
    validByDbType,
    minDate,
    maxDate,
  };
}

async function analysePostgres(client, companyName) {
  const { rows: companyRows } = await client.query(
    'select id, active from companies where name = $1 limit 1',
    [companyName]
  );
  if (companyRows.length === 0) return { error: 'not in companies table' };
  const companyId = companyRows[0].id;
  const active = companyRows[0].active;

  const [total, byType, bySource, unlinked, dateRange, salesPeople] = await Promise.all([
    client.query('select count(*)::int as c from activities where company_id = $1', [companyId]),
    client.query(
      'select event_type, count(*)::int as c from activities where company_id = $1 group by event_type order by event_type',
      [companyId]
    ),
    client.query(
      'select source, count(*)::int as c from activities where company_id = $1 group by source order by source',
      [companyId]
    ),
    client.query(
      'select count(*)::int as c from activities where company_id = $1 and sales_person_id is null and sales_person_name is not null and sales_person_name <> \'Team\'',
      [companyId]
    ),
    client.query(
      'select min(occurred_on)::text as min, max(occurred_on)::text as max from activities where company_id = $1',
      [companyId]
    ),
    client.query('select name from sales_people where company_id = $1 order by name', [companyId]),
  ]);

  return {
    companyId,
    active,
    total: total.rows[0].c,
    byType: Object.fromEntries(byType.rows.map(r => [r.event_type, r.c])),
    bySource: Object.fromEntries(bySource.rows.map(r => [r.source, r.c])),
    unlinkedRows: unlinked.rows[0].c,
    minDate: dateRange.rows[0].min,
    maxDate: dateRange.rows[0].max,
    salesPeople: salesPeople.rows.map(r => r.name),
  };
}

function printCompanyReport(company, sheet, pg) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${company.name}${company.active === false ? '  [INACTIVE]' : ''}`);
  console.log('═'.repeat(72));

  if (sheet.error) { console.log(`  SHEET ERROR: ${sheet.error}`); return; }
  if (pg.error) { console.log(`  POSTGRES ERROR: ${pg.error}`); return; }

  const gap = sheet.validRows - pg.total;
  const gapMark = gap === 0 ? 'OK' : (gap > 0 ? `MISSING ${gap}` : `EXTRA ${-gap}`);

  console.log(`  sheet data rows:        ${padNum(sheet.dataRows, 6)}`);
  console.log(`  sheet valid (insertable): ${padNum(sheet.validRows, 4)}    [range ${sheet.minDate || '—'} → ${sheet.maxDate || '—'}]`);
  console.log(`  sheet skipped:          ${padNum(sheet.skipped.total, 6)}    (missingDate=${sheet.skipped.missingDate}, missingPerson=${sheet.skipped.missingPerson}, unknownType=${sheet.skipped.unknownEventType})`);
  console.log(`  postgres rows:          ${padNum(pg.total, 6)}    [range ${pg.minDate || '—'} → ${pg.maxDate || '—'}]`);
  console.log(`  ─ delta (sheet valid vs pg):  ${gapMark}`);

  if (Object.keys(sheet.unknownEventTypes).length > 0) {
    console.log(`\n  ⚠ unknown eventType strings in sheet (dropped by backfill):`);
    for (const [k, v] of Object.entries(sheet.unknownEventTypes)) {
      console.log(`      "${k}" × ${v}`);
    }
  }

  console.log(`\n  per-eventType (sheet valid → pg):`);
  const allTypes = new Set([...Object.keys(sheet.validByDbType), ...Object.keys(pg.byType)]);
  for (const t of [...allTypes].sort()) {
    const s = sheet.validByDbType[t] || 0;
    const p = pg.byType[t] || 0;
    const d = s - p;
    const mark = d === 0 ? '' : (d > 0 ? `  ← missing ${d}` : `  ← extra ${-d}`);
    console.log(`      ${pad(t, 22)} sheet=${padNum(s, 5)}  pg=${padNum(p, 5)}${mark}`);
  }

  console.log(`\n  pg rows by source:`);
  for (const [src, c] of Object.entries(pg.bySource)) {
    console.log(`      ${pad(src, 22)} ${padNum(c, 5)}`);
  }

  if (pg.unlinkedRows > 0) {
    console.log(`\n  ⚠ ${pg.unlinkedRows} pg rows have sales_person_name but no sales_person_id (won't appear on per-exec views)`);
  }

  const sheetPeople = Object.keys(sheet.salesPersonCounts);
  const unknownPeople = sheetPeople.filter(p => p && p !== 'Team' && !pg.salesPeople.some(sp => sp === p || p.toLowerCase().startsWith(sp.toLowerCase() + ' ') || sp.toLowerCase() === p.toLowerCase()));
  if (unknownPeople.length > 0) {
    console.log(`\n  ⚠ sheet sales-person names that don't exactly match sales_people:`);
    for (const p of unknownPeople) {
      console.log(`      "${p}" × ${sheet.salesPersonCounts[p]}`);
    }
    console.log(`      (sales_people for this company: ${pg.salesPeople.join(', ') || '<none>'})`);
  }
}

async function main() {
  if (!db.isEnabled()) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const companyFlag = args.indexOf('--company');
  const onlyName = companyFlag !== -1 ? args[companyFlag + 1] : null;
  const includeInactive = args.includes('--all');

  const { companies } = loadAllCompanies();
  const targets = companies.filter(c =>
    c.sheetId &&
    (includeInactive || c.active !== false) &&
    (!onlyName || c.name.toLowerCase() === onlyName.toLowerCase())
  );

  if (targets.length === 0) {
    console.error('No matching companies (need a sheetId).');
    process.exit(1);
  }

  console.log(`Reconciling ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'}...`);

  const client = await db.getPool().connect();
  try {
    const summary = [];
    for (const company of targets) {
      const [sheet, pg] = await Promise.all([
        analyseSheet(company),
        analysePostgres(client, company.name),
      ]);
      printCompanyReport(company, sheet, pg);
      if (!sheet.error && !pg.error) {
        summary.push({ name: company.name, sheetValid: sheet.validRows, pgTotal: pg.total, gap: sheet.validRows - pg.total });
      }
    }

    console.log(`\n${'═'.repeat(72)}\nSUMMARY\n${'═'.repeat(72)}`);
    console.log(`${pad('company', 30)} ${pad('sheet_valid', 12)} ${pad('pg_total', 10)} ${pad('gap', 8)}`);
    for (const s of summary) {
      const mark = s.gap === 0 ? '✓' : (s.gap > 0 ? `MISSING ${s.gap}` : `EXTRA ${-s.gap}`);
      console.log(`${pad(s.name, 30)} ${padNum(s.sheetValid, 11)}  ${padNum(s.pgTotal, 9)}  ${mark}`);
    }
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(err => {
  console.error('Reconcile failed:', err.message);
  console.error(err);
  process.exit(1);
});
