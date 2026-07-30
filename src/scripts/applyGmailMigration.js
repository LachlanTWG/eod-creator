// Apply 0010_gmail_email_tracking.sql against DATABASE_URL.
// Usage: node src/scripts/applyGmailMigration.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const sqlPath = path.join(__dirname, '..', '..', 'db', 'migrations', '0010_gmail_email_tracking.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Applied 0010_gmail_email_tracking.sql');
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
