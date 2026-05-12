/**
 * Repopulate EOD display tabs (per-salesperson + Team) across all three
 * production clients to pick up formula updates in quotesBlock.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { populateEODTab } = require('../sheets/populateFormulas');

const TARGETS = [
  { name: 'Bolton EC',            sheetId: '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c', owner: 'Jed',   people: ['Lachlan', 'Zac'] },
  { name: 'Hughes Electrical',    sheetId: '1waI6GXXPfrmIF18bJqHmSN1pIAGkH28TXbpj8vpivfU', owner: 'Ben',   people: ['Lachlan', 'Buzz'] },
  { name: 'HDK Long Run Roofing', sheetId: '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0', owner: 'Jesse', people: ['Lachlan', 'Buzz'] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  for (const t of TARGETS) {
    console.log(`\n=== ${t.name} ===`);
    for (const p of t.people) {
      console.log(`  ${p} EOD…`);
      await populateEODTab(t.sheetId, `${p} EOD`, p, t.name, t.owner, false);
      await sleep(1200);
    }
    console.log(`  Team EOD…`);
    await populateEODTab(t.sheetId, 'Team EOD', 'Team', t.name, t.owner, true);
    await sleep(1200);
  }
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
