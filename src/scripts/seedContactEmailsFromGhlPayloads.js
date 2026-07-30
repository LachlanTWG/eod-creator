// Backfill contact_emails from activities.raw_payload where GHL/quotie left an email.
// Run after 0010 migration so Gmail attribution has something to match immediately.
//
//   node src/scripts/seedContactEmailsFromGhlPayloads.js
//   node src/scripts/seedContactEmailsFromGhlPayloads.js --dry-run

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');
const { normaliseEmail } = require('../integrations/mailbox');

async function main() {
  const dry = process.argv.includes('--dry-run');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    select a.company_id, a.contact_name, a.contact_id, a.raw_payload, c.name as company_name
      from activities a
      join companies c on c.id = a.company_id
     where a.raw_payload is not null
       and a.source in ('ghl', 'quotie', 'make')
     order by a.created_at desc
     limit 20000
  `);

  let found = 0;
  let upserted = 0;
  const seen = new Set();

  for (const r of rows) {
    const p = r.raw_payload || {};
    const emailRaw =
      p.email ||
      p.Email ||
      p.contactEmail ||
      p.contact_email ||
      p.contact?.email ||
      (Array.isArray(p.customFields)
        ? null
        : null);
    const email = normaliseEmail(emailRaw);
    if (!email) continue;
    found++;
    const key = `${r.company_id}::${email}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (dry) {
      console.log(`[dry] ${r.company_name} / ${email} / ${r.contact_name || ''}`);
      upserted++;
      continue;
    }
    await client.query(
      `insert into contact_emails (company_id, email, contact_name, contact_id, source, updated_at)
       values ($1, $2, $3, $4, 'import', now())
       on conflict (company_id, email) do update set
         contact_name = coalesce(excluded.contact_name, contact_emails.contact_name),
         contact_id   = coalesce(excluded.contact_id, contact_emails.contact_id),
         updated_at   = now()`,
      [r.company_id, email, r.contact_name || null, r.contact_id || null],
    );
    upserted++;
  }

  console.log(`Scanned ${rows.length} payloads; emails found=${found}; unique upserted=${upserted}${dry ? ' (dry-run)' : ''}`);
  await client.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
