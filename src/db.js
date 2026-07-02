// Postgres client + read/insert helpers.
//
// Every webhook dual-writes (sheet + here), every archive writes here.
// Postgres is the source of truth: report generation reads activities from
// here (fetchActivityGrid); sheets remain a legacy ops surface until retired.
//
// Connection: DATABASE_URL env var (Supabase pooler connection string).
// Service role bypasses RLS — we use it for all writes.

const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }
  pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    console.error('[db] pool error:', err.message);
  });
  return pool;
}

function isEnabled() {
  return !!process.env.DATABASE_URL;
}

// ─── Lookup caches ──────────────────────────────────────────────────
// Company + sales_person UUIDs change rarely. Cache by (companyName) and
// (companyId, personName) to avoid a lookup query per webhook.
const companyIdCache = new Map();          // companyName -> companyId
const salesPersonIdCache = new Map();      // `${companyId}::${personName}` -> salesPersonId

async function resolveCompanyId(client, companyName) {
  if (!companyName) return null;
  if (companyIdCache.has(companyName)) return companyIdCache.get(companyName);
  const { rows } = await client.query(
    'select id from companies where name = $1 limit 1',
    [companyName]
  );
  const id = rows[0]?.id || null;
  if (id) companyIdCache.set(companyName, id);
  return id;
}

async function resolveSalesPersonId(client, companyId, personName) {
  if (!companyId || !personName || personName === 'Team') return null;
  const key = `${companyId}::${personName}`;
  if (salesPersonIdCache.has(key)) return salesPersonIdCache.get(key);
  const { rows } = await client.query(
    'select id from sales_people where company_id = $1 and name = $2 limit 1',
    [companyId, personName]
  );
  const id = rows[0]?.id || null;
  if (id) salesPersonIdCache.set(key, id);
  return id;
}

function clearCaches() {
  companyIdCache.clear();
  salesPersonIdCache.clear();
}

// ─── Reads ──────────────────────────────────────────────────────────

// DB enum values → sheet eventType strings (inverse of logActivity's map).
const DB_TO_EVENT_TYPE = {
  eod_update: 'EOD Update',
  job_won: 'Job Won',
  site_visit_booked: 'Site Visit Booked',
  quote_sent: 'Quote Sent',
  email_sent: 'Email Sent',
};

// Matches ACTIVITY_LOG_HEADERS in createCompanySheet.js — generators consume
// rows both positionally and by header name, so order is load-bearing.
const ACTIVITY_GRID_HEADERS = [
  'Date', 'Sales Person', 'Contact Name', 'Event Type', 'Outcome',
  'Ad Source', 'Quote/Job Value', 'Contact Address', 'Contact ID',
  'Appointment Date Time', 'Appointment Date',
];

// ─── Read-layer dedup ───────────────────────────────────────────────
// Duplicate job_won / quote_sent / site_visit_booked rows must never double a
// job in a report — even if a re-delivered GHL webhook (no source_row_id, so
// the insert's ON CONFLICT can't fire) slips a copy into the table. Every
// report reads through fetchActivityGrid, so collapsing exact duplicates HERE
// makes doubling impossible everywhere at once. Rules mirror the dashboard
// Duplicates page (dashboard/src/lib/duplicates.ts) so both agree on what a
// "duplicate" is. Rows arrive ordered by (occurred_on, created_at), so the
// first occurrence of a key is the earliest — the copy the page keeps.

// Lowercase, drop punctuation, collapse whitespace. "J. Smith" == "J Smith".
function normNameKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip currency/commas, drop empty/zero tiers, SORT so order is irrelevant.
// "$3,500 | $1,200" -> "1200|3500". Empty when no positive number is present.
function normValueKey(raw) {
  if (!raw) return '';
  return String(raw)
    .split('|')
    .map(v => Number(String(v).replace(/[^\d.]/g, '')))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
    .map(n => String(n))
    .join('|');
}

// The dedup key for a raw DB row, or null when the row lacks the fields needed
// to match confidently (so we never collapse on blanks — those are all kept).
// `r` has DB-enum event_type and a `date` = to_char(occurred_on).
function dedupKey(r) {
  const name = normNameKey(r.contact_name);
  if (!name) return null;
  if (r.event_type === 'job_won' || r.event_type === 'quote_sent') {
    const value = normValueKey(r.quote_job_value);
    if (!value) return null; // "same value" is meaningless without a value
    return `${r.event_type}|${name}|${value}`;
  }
  if (r.event_type === 'site_visit_booked') {
    if (!r.date) return null;
    return `site_visit_booked|${name}|${r.date}`;
  }
  return null; // eod_update / email_sent etc. are never collapsed
}

/**
 * Read every activity for a company from Postgres, shaped exactly like the
 * Activity Log sheet grid (header row + string rows). This is the single
 * source the report generators consume — deleting a row in the DB removes it
 * from every subsequently generated report.
 *
 * appointment_at stores the client's wall-clock tagged as UTC, so it is
 * emitted as a naive ISO string of its UTC components (no zone suffix).
 */
async function fetchActivityGrid(companyName) {
  const client = await getPool().connect();
  try {
    const companyId = await resolveCompanyId(client, companyName);
    if (!companyId) throw new Error(`Unknown company: ${companyName}`);

    const { rows } = await client.query(
      `select
         to_char(occurred_on, 'YYYY-MM-DD') as date,
         sales_person_name,
         coalesce(contact_name, '') as contact_name,
         event_type,
         coalesce(outcome, '') as outcome,
         coalesce(ad_source, '') as ad_source,
         coalesce(quote_job_value, '') as quote_job_value,
         coalesce(contact_address, '') as contact_address,
         coalesce(contact_id, '') as contact_id,
         coalesce(to_char(appointment_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') as appointment_date_time,
         coalesce(to_char(appointment_at at time zone 'UTC', 'YYYY-MM-DD'), '') as appointment_date
       from activities
       where company_id = $1
       order by occurred_on, created_at`,
      [companyId]
    );

    const grid = [ACTIVITY_GRID_HEADERS];
    const seen = new Set();
    let dropped = 0;
    for (const r of rows) {
      // Collapse exact-duplicate job/quote/site-visit rows (first, i.e. earliest,
      // occurrence wins). Every other row type is always kept.
      const key = dedupKey(r);
      if (key) {
        if (seen.has(key)) { dropped++; continue; }
        seen.add(key);
      }
      grid.push([
        r.date,
        r.sales_person_name,
        r.contact_name,
        DB_TO_EVENT_TYPE[r.event_type] || r.event_type,
        r.outcome,
        r.ad_source,
        r.quote_job_value,
        r.contact_address,
        r.contact_id,
        r.appointment_date_time,
        r.appointment_date,
      ]);
    }
    if (dropped > 0) {
      console.log(`[db] fetchActivityGrid(${companyName}): suppressed ${dropped} duplicate row(s) from reports`);
    }
    return grid;
  } finally {
    client.release();
  }
}

// ─── Inserts ────────────────────────────────────────────────────────

/**
 * Insert one activity row.
 * @param {object} params
 * @param {string} params.companyName       Matches companies.name
 * @param {string} params.salesPersonName   Matches sales_people.name; 'Team' for team rows
 * @param {string} params.occurredOn        YYYY-MM-DD
 * @param {string} params.eventType         One of: eod_update | job_won | site_visit_booked | quote_sent | email_sent
 * @param {string} [params.contactName]
 * @param {string} [params.contactId]
 * @param {string} [params.contactAddress]
 * @param {string} [params.outcome]
 * @param {string} [params.adSource]
 * @param {string} [params.quoteJobValue]
 * @param {string} [params.appointmentAt]   ISO timestamp
 * @param {string} params.source            ghl | make | quotie | cli | sheets_backfill | manual
 * @param {string} [params.sourceRowId]     For idempotency on backfill / replay
 * @param {object} [params.rawPayload]      Original webhook body
 */
async function insertActivity(params) {
  if (!isEnabled()) return { skipped: true };
  const client = await getPool().connect();
  try {
    const companyId = await resolveCompanyId(client, params.companyName);
    if (!companyId) {
      throw new Error(`Unknown company: ${params.companyName}`);
    }
    const salesPersonId = await resolveSalesPersonId(client, companyId, params.salesPersonName);

    const sql = `
      insert into activities (
        company_id, sales_person_id, sales_person_name,
        occurred_on, occurred_at,
        event_type,
        contact_name, contact_id, contact_address,
        outcome, ad_source, quote_job_value, appointment_at,
        source, source_row_id, raw_payload
      ) values (
        $1, $2, $3,
        $4, $5,
        $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16
      )
      on conflict (company_id, source, source_row_id) do nothing
      returning id
    `;
    const values = [
      companyId,
      salesPersonId,
      params.salesPersonName || 'Unknown',
      params.occurredOn,
      params.occurredAt || null,
      params.eventType,
      params.contactName || null,
      params.contactId || null,
      params.contactAddress || null,
      params.outcome || null,
      params.adSource || null,
      params.quoteJobValue || null,
      params.appointmentAt || null,
      params.source,
      params.sourceRowId || null,
      params.rawPayload ? JSON.stringify(params.rawPayload) : null,
    ];
    const { rows } = await client.query(sql, values);
    return { id: rows[0]?.id || null, deduped: rows.length === 0 };
  } finally {
    client.release();
  }
}

/**
 * Insert one report snapshot.
 */
async function insertReport(params) {
  if (!isEnabled()) return { skipped: true };
  const client = await getPool().connect();
  try {
    const companyId = await resolveCompanyId(client, params.companyName);
    if (!companyId) throw new Error(`Unknown company: ${params.companyName}`);
    const salesPersonId = await resolveSalesPersonId(client, companyId, params.salesPersonName);

    const sql = `
      insert into reports (
        company_id, sales_person_id, sales_person_name,
        report_type, period_start, period_end,
        formatted_text, counts, names, efficiency_rates
      ) values (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9, $10
      )
      on conflict (company_id, sales_person_name, report_type, period_start, period_end)
      do update set
        formatted_text = excluded.formatted_text,
        counts = excluded.counts,
        names = excluded.names,
        efficiency_rates = excluded.efficiency_rates
      returning id
    `;
    const values = [
      companyId,
      salesPersonId,
      params.salesPersonName,
      params.reportType,
      params.periodStart,
      params.periodEnd,
      params.formattedText,
      params.counts ? JSON.stringify(params.counts) : null,
      params.names ? JSON.stringify(params.names) : null,
      params.efficiencyRates ? JSON.stringify(params.efficiencyRates) : null,
    ];
    const { rows } = await client.query(sql, values);
    return { id: rows[0]?.id || null };
  } finally {
    client.release();
  }
}

/**
 * Insert one webhook_events audit row. Fire-and-forget — don't block requests.
 */
async function insertWebhookEvent(params) {
  if (!isEnabled()) return { skipped: true };
  const client = await getPool().connect();
  try {
    await client.query(
      `insert into webhook_events (path, method, status, ip, body, error)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        params.path,
        params.method,
        params.status,
        params.ip || null,
        params.body ? JSON.stringify(params.body) : null,
        params.error || null,
      ]
    );
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    clearCaches();
  }
}

module.exports = {
  getPool,
  isEnabled,
  fetchActivityGrid,
  ACTIVITY_GRID_HEADERS,
  DB_TO_EVENT_TYPE,
  dedupKey,
  normNameKey,
  normValueKey,
  insertActivity,
  insertReport,
  insertWebhookEvent,
  resolveCompanyId,
  resolveSalesPersonId,
  clearCaches,
  close,
};
