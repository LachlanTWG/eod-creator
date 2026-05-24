// Read-only: figure out why no activities have source != 'sheets_backfill'.
// Checks the webhook_events audit table (same isEnabled() gate) — if it's
// also empty/stale, the production server lacks DATABASE_URL. If it has
// recent rows, the issue is in the activities insert path itself.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const db = require('../db');

async function main() {
  if (!db.isEnabled()) {
    console.error('DATABASE_URL not set locally either. Aborting.');
    process.exit(1);
  }
  const client = await db.getPool().connect();
  try {
    console.log('\n── companies table ─────────────────────────────────────────');
    const { rows: companies } = await client.query(
      'select id, name, active from companies order by name'
    );
    for (const c of companies) {
      console.log(`  ${c.name.padEnd(30)} ${c.active ? 'active  ' : 'inactive'}  ${c.id}`);
    }

    console.log('\n── activities sources ─────────────────────────────────────');
    const { rows: sources } = await client.query(
      `select source, count(*)::int as c, min(created_at)::text as first, max(created_at)::text as last
       from activities group by source order by source`
    );
    for (const s of sources) {
      console.log(`  ${(s.source || '<null>').padEnd(22)} ${String(s.c).padStart(6)}   first=${s.first}   last=${s.last}`);
    }

    console.log('\n── webhook_events (last 7d) ──────────────────────────────');
    const wehTableExists = await client.query(
      `select to_regclass('public.webhook_events') as r`
    );
    if (!wehTableExists.rows[0].r) {
      console.log('  (table does not exist)');
    } else {
      const { rows: webhookTotal } = await client.query(
        `select count(*)::int as total,
                count(*) filter (where received_at > now() - interval '7 days')::int as last7d,
                max(received_at)::text as latest
         from webhook_events`
      );
      console.log(`  total=${webhookTotal[0].total}   last7d=${webhookTotal[0].last7d}   latest=${webhookTotal[0].latest}`);

      const { rows: byPath } = await client.query(
        `select path, status, count(*)::int as c
         from webhook_events
         where received_at > now() - interval '7 days'
         group by path, status order by path, status`
      );
      for (const r of byPath) {
        console.log(`  ${(r.path || '<null>').padEnd(40)} status=${r.status}   ${r.c}`);
      }

      const { rows: errors } = await client.query(
        `select received_at::text, path, error
         from webhook_events
         where error is not null and received_at > now() - interval '7 days'
         order by received_at desc limit 5`
      );
      if (errors.length > 0) {
        console.log('\n  recent errors:');
        for (const e of errors) {
          console.log(`    ${e.received_at}  ${e.path}  ${e.error}`);
        }
      }
    }

    console.log('\n── activities recency (any source) ──────────────────────');
    const { rows: recent } = await client.query(
      `select company_id, source, max(created_at)::text as last_created, max(occurred_on)::text as last_occurred, count(*)::int as last7d_count
       from activities
       where created_at > now() - interval '7 days'
       group by company_id, source order by company_id, source`
    );
    if (recent.length === 0) {
      console.log('  (no activities created in last 7 days)');
    } else {
      const compMap = new Map(companies.map(c => [c.id, c.name]));
      for (const r of recent) {
        console.log(`  ${(compMap.get(r.company_id) || r.company_id).padEnd(30)} ${(r.source || '<null>').padEnd(18)} last_created=${r.last_created}   count7d=${r.last7d_count}`);
      }
    }
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
