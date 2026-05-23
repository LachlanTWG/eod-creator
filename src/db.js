// Postgres client + insert helpers.
//
// Permanent dual-write: every webhook also writes here, every archive also
// writes here. DB is the dashboard's source of truth; sheets are the manual
// ops surface.
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
  insertActivity,
  insertReport,
  insertWebhookEvent,
  resolveCompanyId,
  resolveSalesPersonId,
  clearCaches,
  close,
};
