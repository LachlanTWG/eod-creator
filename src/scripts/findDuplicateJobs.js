// READ-ONLY. Find duplicate "Job Won" entries across all clients, in both the
// Google Sheets Activity Log and Postgres, within a date range.
//
// A duplicate = same company + same contact name + same value (the end result),
// per the brief. Keeps the earliest, flags the rest.
//
// Usage:
//   node src/scripts/findDuplicateJobs.js                 (defaults: 2026-05-18 .. 2026-06-01)
//   node src/scripts/findDuplicateJobs.js --start 2026-05-18 --end 2026-05-31

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { loadAllCompanies } = require('../config/companiesStore');
const { readTab } = require('../sheets/readSheet');
const db = require('../db');

const args = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const START = getArg('--start', '2026-05-18');
const END = getArg('--end', '2026-06-01');

// "Smith, John" and "John Smith" → "john smith"
function normName(name) {
  return (name || '').split(/[, ]+/).filter(Boolean).map(p => p.toLowerCase()).sort().join(' ');
}
function normValue(v) {
  const n = parseFloat(String(v || '').replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
function normDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4,5}$/.test(s)) return new Date((parseInt(s, 10) - 25569) * 86400000).toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function fmt$(v) { return '$' + Math.round(v).toLocaleString('en-AU'); }

async function sheetJobs(company) {
  let rows;
  try { rows = await readTab(company.sheetId, 'Activity Log'); }
  catch (e) { return { error: e.message }; }
  if (rows.length < 2) return { jobs: [] };
  const headers = rows[0];
  const idx = (name) => headers.indexOf(name);
  const di = idx('Date'), si = idx('Sales Person'), ei = idx('Event Type');
  const ni = idx('Contact Name'), ai = idx('Contact Address'), vi = idx('Quote/Job Value');
  const jobs = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if ((row[ei] || '').trim() !== 'Job Won') continue;
    const date = normDate(row[di]);
    if (!date || date < START || date > END) continue;
    jobs.push({
      sheetRow: r + 1,            // 1-based sheet row number (header is row 1)
      date,
      person: (row[si] || '').trim(),
      name: (row[ni] || '').trim(),
      address: (row[ai] || '').trim(),
      value: normValue(row[vi]),
    });
  }
  return { jobs };
}

async function pgJobs(client, companyName) {
  const { rows: cr } = await client.query('select id from companies where name = $1 limit 1', [companyName]);
  if (cr.length === 0) return { error: 'not in companies table' };
  const { rows } = await client.query(
    `select id, occurred_on::text as date, sales_person_name, contact_name,
            contact_address, quote_job_value, source, created_at::text as created
       from activities
      where company_id = $1 and event_type = 'job_won'
        and occurred_on between $2 and $3
      order by created_at`,
    [cr[0].id, START, END]
  );
  return {
    jobs: rows.map(r => ({
      id: r.id, date: r.date, person: r.sales_person_name, name: r.contact_name,
      address: r.contact_address, value: normValue(r.quote_job_value),
      source: r.source, created: r.created,
    })),
  };
}

function groupDupes(jobs) {
  const map = new Map();
  for (const j of jobs) {
    const key = `${normName(j.name)}::${j.value}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(j);
  }
  return [...map.values()].filter(g => g.length > 1);
}

async function main() {
  console.log(`\nDuplicate Job Won scan — range ${START} .. ${END}\n${'='.repeat(70)}`);
  const { companies } = loadAllCompanies();
  const targets = companies.filter(c => c.sheetId && c.active !== false);

  const pgOn = db.isEnabled();
  const client = pgOn ? await db.getPool().connect() : null;

  let totalSheetExtra = 0, totalPgExtra = 0;
  try {
    for (const company of targets) {
      const s = await sheetJobs(company);
      const p = client ? await pgJobs(client, company.name) : { jobs: [], error: 'DB off' };

      const sDupes = s.error ? [] : groupDupes(s.jobs);
      const pDupes = p.error ? [] : groupDupes(p.jobs);

      const sJobCount = s.jobs ? s.jobs.length : 0;
      const pJobCount = p.jobs ? p.jobs.length : 0;
      const header = `\n${company.name}  —  sheet jobs: ${sJobCount}${s.error ? ` (ERR: ${s.error})` : ''}  |  pg jobs: ${pJobCount}${p.error ? ` (ERR: ${p.error})` : ''}`;
      console.log(header);

      if (sDupes.length === 0 && pDupes.length === 0) {
        console.log('  ✓ no duplicates');
        continue;
      }

      if (sDupes.length) {
        console.log('  SHEET duplicates:');
        for (const g of sDupes) {
          const keep = g[0];
          console.log(`    • "${keep.name}"  ${fmt$(keep.value)}  ×${g.length}`);
          g.forEach((j, i) => {
            totalSheetExtra += i === 0 ? 0 : 1;
            console.log(`        ${i === 0 ? 'KEEP ' : 'DUP  '} row ${j.sheetRow}  ${j.date}  ${j.person}  ${j.address || '-'}`);
          });
        }
      }
      if (pDupes.length) {
        console.log('  POSTGRES duplicates:');
        for (const g of pDupes) {
          const keep = g[0];
          console.log(`    • "${keep.name}"  ${fmt$(keep.value)}  ×${g.length}`);
          g.forEach((j, i) => {
            totalPgExtra += i === 0 ? 0 : 1;
            console.log(`        ${i === 0 ? 'KEEP ' : 'DUP  '} id ${j.id}  ${j.date}  ${j.person}  src=${j.source}  ${j.created}`);
          });
        }
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Extra rows to remove — sheets: ${totalSheetExtra}  |  postgres: ${totalPgExtra}`);
    console.log('(KEEP = earliest kept; DUP = would be removed)\n');
  } finally {
    if (client) client.release();
    await db.close();
  }
}

main().catch(e => { console.error('Failed:', e.message); console.error(e); process.exit(1); });
