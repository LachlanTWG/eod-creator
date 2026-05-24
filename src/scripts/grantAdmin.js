// Grant admin (is_admin=true) on the profiles row for a given email.
// Run after the user has logged in at least once (so their profiles row exists).
//
// Usage: node src/scripts/grantAdmin.js <email>

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node src/scripts/grantAdmin.js <email>');
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
      'update public.profiles set is_admin = true where email = $1',
      [email.toLowerCase()]
    );
    if (rowCount === 0) {
      console.error(`No profile found for ${email}. Has the user logged in yet?`);
      process.exit(1);
    }
    console.log(`✓ ${email} is now admin.`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
