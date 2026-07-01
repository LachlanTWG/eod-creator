// Parity check: generate reports from the Postgres activities grid vs the
// Google Sheet Activity Log for the same company/period, and diff the output.
// Differences are EXPECTED where rows were deleted/edited in the dashboard
// (Postgres is the source of truth) — this is to confirm the plumbing, not
// to force byte-equality.
//
// Usage: node db/diagnostics/reportParityCheck.js "<Company Name>" [YYYY-MM-DD]

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const db = require('../../src/db');
const { readTab } = require('../../src/sheets/readSheet');

// Local .env has no DATABASE_URL (only Railway does), so fetch the same rows
// via PostgREST with the service-role key and shape them with the same
// mapping db.fetchActivityGrid uses.
async function fetchGridViaRest(companyName) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const cRes = await fetch(`${base}/rest/v1/companies?name=eq.${encodeURIComponent(companyName)}&select=id`, { headers });
  const cRows = await cRes.json();
  if (!cRows[0]) throw new Error(`Unknown company: ${companyName}`);
  const companyId = cRows[0].id;

  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(
      `${base}/rest/v1/activities?company_id=eq.${companyId}` +
      `&select=occurred_on,sales_person_name,contact_name,event_type,outcome,ad_source,quote_job_value,contact_address,contact_id,appointment_at` +
      `&order=occurred_on.asc,created_at.asc`,
      { headers: { ...headers, Range: `${from}-${from + page - 1}` } },
    );
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(JSON.stringify(batch));
    rows.push(...batch);
    if (batch.length < page) break;
  }

  const naive = (ts) => ts ? ts.replace(/\.\d+/, '').replace(/(\+00:00|Z)$/, '') : '';
  const grid = [db.ACTIVITY_GRID_HEADERS];
  for (const r of rows) {
    grid.push([
      r.occurred_on,
      r.sales_person_name,
      r.contact_name || '',
      db.DB_TO_EVENT_TYPE[r.event_type] || r.event_type,
      r.outcome || '',
      r.ad_source || '',
      r.quote_job_value || '',
      r.contact_address || '',
      r.contact_id || '',
      naive(r.appointment_at),
      naive(r.appointment_at).slice(0, 10),
    ]);
  }
  return grid;
}
const { generateEOD } = require('../../src/reporting/generateEOD');
const { generateEOW } = require('../../src/reporting/generateEOW');
const { generateEOM } = require('../../src/reporting/generateEOM');
const { loadCompanies } = require('../../src/config/companiesStore');

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

async function main() {
  const companyName = process.argv[2];
  const { companies } = loadCompanies();
  const company = companies.find(c => companyName
    ? c.name.toLowerCase() === companyName.toLowerCase()
    : c.sheetId);
  if (!company) {
    console.error('Company not found. Available:', companies.map(c => c.name).join(', '));
    process.exit(1);
  }

  const date = process.argv[3] || new Date().toLocaleDateString('en-CA', { timeZone: company.timezone || 'Australia/Sydney' });
  const monday = getMondayOfWeek(date);
  const sunday = (() => { const d = new Date(monday + 'T12:00:00Z'); d.setDate(d.getDate() + 6); return d.toISOString().split('T')[0]; })();
  const [y, m] = date.split('-').map(Number);

  console.log(`\n=== Parity check — ${company.name} — ${date} ===\n`);

  const pgGrid = process.env.DATABASE_URL
    ? await db.fetchActivityGrid(company.name)
    : await fetchGridViaRest(company.name);
  const sheetGrid = await readTab(company.sheetId, 'Activity Log');
  console.log(`Rows: postgres=${pgGrid.length - 1}  sheet=${sheetGrid.length - 1}`);

  for (const person of [...company.salesPeople.filter(p => p.active).map(p => p.name), 'Team']) {
    const [pgEod, shEod] = await Promise.all([
      generateEOD(company.sheetId, person, date, company.name, company.ownerName, pgGrid),
      generateEOD(company.sheetId, person, date, company.name, company.ownerName, sheetGrid),
    ]);
    const same = pgEod.message === shEod.message;
    console.log(`\nEOD ${person}: ${same ? 'IDENTICAL' : 'DIFFERS'}`);
    if (!same) {
      console.log('--- postgres ---\n' + pgEod.message);
      console.log('--- sheet ---\n' + shEod.message);
    }
  }

  const pgEow = await generateEOW(company.sheetId, 'Team', monday, sunday, company.name, company.ownerName, pgGrid);
  console.log(`\nEOW Team (${monday}..${sunday}) from postgres:\n`);
  console.log(pgEow.message);

  const pgEom = await generateEOM(company.sheetId, 'Team', y, m, company.name, company.ownerName, pgGrid);
  const shEom = await generateEOM(company.sheetId, 'Team', y, m, company.name, company.ownerName, sheetGrid);
  console.log(`\nEOM Team ${y}-${m}: ${pgEom.message === shEom.message ? 'IDENTICAL' : 'DIFFERS'}`);
  if (pgEom.message !== shEom.message) {
    console.log('--- postgres ---\n' + pgEom.message);
    console.log('--- sheet ---\n' + shEom.message);
  }

  if (process.env.DATABASE_URL) await db.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
