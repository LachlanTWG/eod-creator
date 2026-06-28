// Grant the read-only "viewer" role (is_viewer=true) on the profiles row for a
// given email. A viewer sees ALL data across every client but cannot edit
// anything and is not an exec. See db/migrations/0008_viewer_role.sql.
//
// Run after the user has been created (Supabase Dashboard → Authentication →
// Users → Add user → Auto Confirm) so their profiles row exists, via the
// on_auth_user_created trigger.
//
// Usage:   node src/scripts/grantViewer.js <email>
// Revoke:  same query with is_viewer = false (or do it in the SQL editor).

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node src/scripts/grantViewer.js <email>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'update public.profiles set is_viewer = true where email = $1',
      [email.toLowerCase()]
    );
    if (rowCount === 0) {
      console.error(`No profile found for ${email}. Has the user been created yet?`);
      process.exit(1);
    }
    console.log(`✓ ${email} is now a read-only viewer.`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
