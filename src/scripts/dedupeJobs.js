// Remove duplicate "Job Won" entries (same company + same contact name + same
// value) from Postgres and/or the Google Sheets Activity Log, keeping the
// earliest of each group.
//
// Re-derives duplicates fresh at run time (does NOT trust stale row numbers),
// so it is safe to run after manual edits and is idempotent.
//
// DRY RUN by default. Add --apply to actually delete.
//
// Usage:
//   node src/scripts/dedupeJobs.js                       (dry run, pg + sheets)
//   node src/scripts/dedupeJobs.js --apply               (delete in pg + sheets)
//   node src/scripts/dedupeJobs.js --pg --apply          (postgres only)
//   node src/scripts/dedupeJobs.js --sheets --apply      (sheets only)
//   node src/scripts/dedupeJobs.js --start 2026-05-18 --end 2026-06-01 --apply

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { google } = require('googleapis');
const { getAuthClient } = require('../auth');
const { loadAllCompanies } = require('../config/companiesStore');
const { readTab, getSpreadsheetMeta } = require('../sheets/readSheet');
const db = require('../db');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const getArg = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const START = getArg('--start', '2026-05-18');
const END = getArg('--end', '2026-06-01');
const APPLY = has('--apply');
const doPg = has('--pg') || (!has('--pg') && !has('--sheets'));
const doSheets = has('--sheets') || (!has('--pg') && !has('--sheets'));

function normName(n) { return (n || '').split(/[, ]+/).filter(Boolean).map(p => p.toLowerCase()).sort().join(' '); }
function normValue(v) { const n = parseFloat(String(v || '').replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; }
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
function groupDupes(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${normName(it.name)}::${it.value}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.values()].filter(g => g.length > 1);
}

async function dedupePg(client, company) {
  const { rows: cr } = await client.query('select id from companies where name = $1 limit 1', [company.name]);
  if (cr.length === 0) return { extra: [] };
  const { rows } = await client.query(
    `select id, occurred_on::text as date, sales_person_name as person, contact_name as name,
            quote_job_value, source, created_at::text as created
       from activities
      where company_id = $1 and event_type = 'job_won' and occurred_on between $2 and $3
      order by created_at`,
    [cr[0].id, START, END]
  );
  const items = rows.map(r => ({ ...r, value: normValue(r.quote_job_value) }));
  const dupes = groupDupes(items);
  const toDelete = [];
  for (const g of dupes) {
    g.sort((a, b) => a.created.localeCompare(b.created)); // earliest first
    const [keep, ...extra] = g;
    console.log(`    • "${keep.name}" ${fmt$(keep.value)} ×${g.length}  keep id ${keep.id} (${keep.created})`);
    for (const e of extra) {
      console.log(`        DELETE id ${e.id}  ${e.date}  ${e.person}  src=${e.source}  ${e.created}`);
      toDelete.push(e.id);
    }
  }
  if (APPLY && toDelete.length) {
    await client.query('delete from activities where id = any($1::bigint[])', [toDelete]);
  }
  return { extra: toDelete };
}

async function dedupeSheet(sheetsApi, company) {
  let rows;
  try { rows = await readTab(company.sheetId, 'Activity Log'); }
  catch (e) { console.log(`    (sheet read error: ${e.message})`); return { extra: [] }; }
  if (rows.length < 2) return { extra: [] };
  const headers = rows[0];
  const idx = (n) => headers.indexOf(n);
  const di = idx('Date'), si = idx('Sales Person'), ei = idx('Event Type'), ni = idx('Contact Name'), vi = idx('Quote/Job Value');
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if ((row[ei] || '').trim() !== 'Job Won') continue;
    const date = normDate(row[di]);
    if (!date || date < START || date > END) continue;
    items.push({ sheetRow: r + 1, rowIndex: r, date, person: (row[si] || '').trim(), name: (row[ni] || '').trim(), value: normValue(row[vi]) });
  }
  const dupes = groupDupes(items);
  const toDeleteRows = []; // 0-based grid row indices
  for (const g of dupes) {
    g.sort((a, b) => a.rowIndex - b.rowIndex); // earliest (topmost) first
    const [keep, ...extra] = g;
    console.log(`    • "${keep.name}" ${fmt$(keep.value)} ×${g.length}  keep row ${keep.sheetRow}`);
    for (const e of extra) {
      console.log(`        DELETE row ${e.sheetRow}  ${e.date}  ${e.person}`);
      toDeleteRows.push(e.rowIndex);
    }
  }
  if (APPLY && toDeleteRows.length) {
    const metaRes = await getSpreadsheetMeta(company.sheetId);
    const tab = (metaRes.sheets || []).find(s => s.properties && s.properties.title === 'Activity Log');
    if (!tab) { console.log('    (could not find Activity Log tab id — skipped)'); return { extra: toDeleteRows }; }
    const tabId = tab.properties.sheetId;
    // Delete from bottom up so earlier indices stay valid.
    const requests = toDeleteRows.sort((a, b) => b - a).map(rowIndex => ({
      deleteDimension: { range: { sheetId: tabId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } },
    }));
    await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: company.sheetId, requestBody: { requests } });
  }
  return { extra: toDeleteRows };
}

async function main() {
  console.log(`\nDedupe Job Won — range ${START} .. ${END} — ${APPLY ? 'APPLY (will delete)' : 'DRY RUN'}`);
  console.log(`Targets: ${doPg ? 'Postgres' : ''}${doPg && doSheets ? ' + ' : ''}${doSheets ? 'Sheets' : ''}\n${'='.repeat(70)}`);
  const { companies } = loadAllCompanies();
  const targets = companies.filter(c => c.sheetId && c.active !== false);

  const client = doPg && db.isEnabled() ? await db.getPool().connect() : null;
  const auth = doSheets ? await getAuthClient() : null;
  const sheetsApi = doSheets ? google.sheets({ version: 'v4', auth }) : null;

  let pgTotal = 0, sheetTotal = 0;
  try {
    for (const company of targets) {
      console.log(`\n${company.name}`);
      if (doPg) {
        if (!client) { console.log('  (Postgres disabled)'); }
        else {
          console.log('  Postgres:');
          const { extra } = await dedupePg(client, company);
          if (!extra.length) console.log('    ✓ none');
          pgTotal += extra.length;
        }
      }
      if (doSheets) {
        console.log('  Sheets:');
        const { extra } = await dedupeSheet(sheetsApi, company);
        if (!extra.length) console.log('    ✓ none');
        sheetTotal += extra.length;
      }
    }
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${APPLY ? 'Deleted' : 'Would delete'} — postgres: ${pgTotal}  |  sheets: ${sheetTotal}`);
    if (!APPLY) console.log('Re-run with --apply to perform deletions.\n');
    else console.log('Done.\n');
  } finally {
    if (client) client.release();
    await db.close();
  }
}

main().catch(e => { console.error('Failed:', e.message); console.error(e); process.exit(1); });
