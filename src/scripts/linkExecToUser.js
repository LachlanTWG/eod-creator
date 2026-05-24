// Link an exec's auth user to all their sales_people rows. Run once per exec
// after creating their Supabase auth user (Dashboard → Authentication → Users
// → Add user → Create new user → Auto Confirm).
//
// Usage:
//   node src/scripts/linkExecToUser.js <email> <salesPersonName>
// Example:
//   node src/scripts/linkExecToUser.js buzz@example.com Buzz
//   node src/scripts/linkExecToUser.js zac@example.com  Zac
//
// This updates EVERY sales_people row with the given canonical first-name to
// point at the user. After this, the exec logs in and lands on /me which
// redirects to their personal dashboard.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');

async function main() {
  const email = process.argv[2];
  const name = process.argv[3];
  if (!email || !name) {
    console.error('Usage: node src/scripts/linkExecToUser.js <email> <salesPersonName>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 1. Resolve auth user id by email via the profiles table (which is auto-
    //    populated on signup by the on_auth_user_created trigger).
    const { rows: profileRows } = await client.query(
      'select id from public.profiles where email = $1',
      [email.toLowerCase()],
    );
    if (profileRows.length === 0) {
      console.error(`No profile found for ${email}. Has the user logged in (or been created) yet?`);
      process.exit(1);
    }
    const userId = profileRows[0].id;

    // 2. Update every sales_people row with that canonical name.
    const { rowCount, rows: updatedRows } = await client.query(
      `update public.sales_people sp
       set user_id = $1
       from public.companies c
       where sp.company_id = c.id
         and sp.name = $2
       returning c.name as company_name`,
      [userId, name],
    );

    if (rowCount === 0) {
      console.error(`No sales_people rows found with name "${name}". Available names:`);
      const { rows } = await client.query('select distinct name from public.sales_people order by name');
      for (const r of rows) console.error(`  ${r.name}`);
      process.exit(1);
    }

    console.log(`✓ Linked ${email} → ${name} (${rowCount} sales_people rows):`);
    for (const r of updatedRows) console.log(`    · ${r.company_name}`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
