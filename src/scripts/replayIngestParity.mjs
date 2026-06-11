// Replay-parity harness for the ingest Edge Function (Phase 1 of the
// Railway → Supabase migration).
//
// Pulls every activities row that has a raw_payload (the original webhook
// body Railway received), replays it through the SAME parsing core the Edge
// Function uses (supabase/functions/ingest/core.mjs), and diffs the rebuilt
// fields against what the Node server actually wrote. Read-only.
//
// Run: node src/scripts/replayIngestParity.mjs
//
// Known acceptable noise:
//   - occurred_on isn't compared (depends on the day the webhook arrived).
//   - appointment_at isn't strictly compared (Postgres re-formats timestamps).
//   - sales_person_name can mismatch on old rows if the roster's active flags
//     changed since (we replay against TODAY's roster).

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGHLEodActivity,
  buildGHLJobWonActivity,
  buildGHLSiteVisitActivity,
  buildQuoteActivity,
  buildEmailActivity,
} from '../../supabase/functions/ingest/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '../../.env') });

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll(pathAndQuery) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${BASE}/rest/v1/${pathAndQuery}`, {
      headers: { ...HEADERS, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`${pathAndQuery}: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Normalise for comparison: the builder uses '' where the DB stores NULL.
const norm = (v) => (v === null || v === undefined) ? '' : String(v);

function diffFields(stored, rebuilt) {
  const fields = [
    ['sales_person_name', rebuilt.salesPersonName],
    ['event_type',        rebuilt.eventType],
    ['contact_name',      rebuilt.contactName],
    ['contact_id',        rebuilt.contactId],
    ['contact_address',   rebuilt.contactAddress],
    ['outcome',           rebuilt.outcome],
    ['ad_source',         rebuilt.adSource],
    ['quote_job_value',   rebuilt.quoteJobValue],
  ];
  const mismatches = [];
  for (const [col, rebuiltVal] of fields) {
    if (norm(stored[col]) !== norm(rebuiltVal)) {
      mismatches.push({ col, stored: norm(stored[col]), rebuilt: norm(rebuiltVal) });
    }
  }
  return mismatches;
}

const companies = await fetchAll('companies?select=id,name,timezone,ghl_location_id');
const companyById = new Map(companies.map(c => [c.id, c]));
const people = await fetchAll('sales_people?select=company_id,name,active');
const rosterByCompany = new Map();
for (const p of people) {
  const arr = rosterByCompany.get(p.company_id) || [];
  arr.push({ name: p.name, active: p.active });
  rosterByCompany.set(p.company_id, arr);
}

const rows = await fetchAll(
  'activities?select=id,company_id,sales_person_name,event_type,contact_name,contact_id,contact_address,outcome,ad_source,quote_job_value,source,raw_payload,occurred_on'
  + '&raw_payload=not.is.null&source=in.(ghl,quotie,make)&order=created_at.asc'
);
console.log(`Replaying ${rows.length} stored webhook payloads through the Edge Function parsing core…\n`);

const stats = { total: 0, perfect: 0, skipped: 0, noRoute: 0 };
const mismatchByField = new Map();   // col -> count
const samples = [];                  // first N mismatch details

for (const row of rows) {
  const company = companyById.get(row.company_id);
  if (!company) { stats.noRoute++; continue; }
  const roster = rosterByCompany.get(row.company_id) || [];
  const body = row.raw_payload;

  let built;
  if (row.source === 'ghl' && row.event_type === 'eod_update') {
    built = buildGHLEodActivity(body, company.timezone, roster);
  } else if (row.source === 'ghl' && row.event_type === 'job_won') {
    built = buildGHLJobWonActivity(body, company.timezone, roster);
  } else if (row.source === 'ghl' && row.event_type === 'site_visit_booked') {
    built = buildGHLSiteVisitActivity(body, company.timezone, roster);
  } else if (row.source === 'quotie' && row.event_type === 'quote_sent') {
    built = buildQuoteActivity(body, company.timezone);
  } else if (row.source === 'make' && row.event_type === 'email_sent') {
    built = buildEmailActivity(body, company.timezone);
  } else {
    stats.noRoute++;
    continue;
  }

  stats.total++;
  if (built.skip) {
    // The Node server logged this row, but the rebuilt parse says skip —
    // that's a real divergence worth seeing.
    stats.skipped++;
    if (samples.length < 15) samples.push({ id: row.id, source: row.source, note: `rebuilt says SKIP (${built.reason}) but a stored row exists` });
    continue;
  }

  const mismatches = diffFields(row, built.activity);
  if (mismatches.length === 0) {
    stats.perfect++;
  } else {
    for (const m of mismatches) {
      mismatchByField.set(m.col, (mismatchByField.get(m.col) || 0) + 1);
      if (samples.length < 15) {
        samples.push({ id: row.id, source: row.source, col: m.col, stored: m.stored.slice(0, 80), rebuilt: m.rebuilt.slice(0, 80) });
      }
    }
  }
}

console.log('── RESULTS ──────────────────────────────────────');
console.log(`replayed:        ${stats.total}`);
console.log(`perfect match:   ${stats.perfect}  (${(stats.perfect / Math.max(1, stats.total) * 100).toFixed(1)}%)`);
console.log(`rebuilt-as-skip: ${stats.skipped}`);
console.log(`unroutable:      ${stats.noRoute}`);
if (mismatchByField.size > 0) {
  console.log('\nmismatches by field:');
  for (const [col, n] of [...mismatchByField.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${col}: ${n}`);
  }
}
if (samples.length > 0) {
  console.log('\nfirst mismatch samples:');
  for (const s of samples) console.log(' ', JSON.stringify(s));
}
