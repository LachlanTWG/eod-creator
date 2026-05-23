// Seed companies + sales_people tables from companies.json.
// Idempotent: re-running updates fields but won't duplicate rows.
//
// Usage:  DATABASE_URL=... node src/scripts/seedToPostgres.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { loadAllCompanies } = require('../config/companiesStore');
const db = require('../db');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  if (!db.isEnabled()) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  const { companies } = loadAllCompanies();
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    let companiesUpserted = 0;
    let salesPeopleUpserted = 0;

    for (const c of companies) {
      const slug = slugify(c.name);
      const { rows } = await client.query(
        `insert into companies (
           name, slug, owner_name, timezone, ghl_location_id, sheet_id,
           clickup_workspace_id, clickup_chat_channel_id, active
         ) values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, ''), $9)
         on conflict (name) do update set
           slug = excluded.slug,
           owner_name = excluded.owner_name,
           timezone = excluded.timezone,
           ghl_location_id = excluded.ghl_location_id,
           sheet_id = excluded.sheet_id,
           clickup_workspace_id = excluded.clickup_workspace_id,
           clickup_chat_channel_id = excluded.clickup_chat_channel_id,
           active = excluded.active,
           updated_at = now()
         returning id`,
        [
          c.name,
          slug,
          c.ownerName || null,
          c.timezone || 'Australia/Sydney',
          c.ghlLocationId || '',
          c.sheetId || '',
          c.clickup?.workspaceId || '',
          c.clickup?.chatChannelId || '',
          c.active !== false,
        ]
      );
      const companyId = rows[0].id;
      companiesUpserted++;

      for (const p of c.salesPeople || []) {
        await client.query(
          `insert into sales_people (company_id, name, active, start_date)
           values ($1, $2, $3, nullif($4, '')::date)
           on conflict (company_id, name) do update set
             active = excluded.active,
             start_date = coalesce(excluded.start_date, sales_people.start_date)`,
          [companyId, p.name, p.active !== false, p.startDate || '']
        );
        salesPeopleUpserted++;
      }
      console.log(`  ✓ ${c.name} (${(c.salesPeople || []).length} sales people)`);
    }

    await client.query('commit');
    console.log(`\nSeed complete: ${companiesUpserted} companies, ${salesPeopleUpserted} sales people.`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  console.error(err);
  process.exit(1);
});
