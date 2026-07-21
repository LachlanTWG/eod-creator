// Verify GHL Private Integration tokens for every client sub-account.
//
// Probes the three read scopes the popup relies on, per location:
//   - View Custom Fields   GET /locations/{id}/customFields
//   - View Contacts        GET /contacts?locationId=&limit=1
//   - View Opportunities   GET /opportunities/search?location_id=&limit=1
// (Edit Contacts / Edit Opportunities can't be probed non-destructively —
// they're granted alongside the read scopes in the same PIT save.)
//
// Usage:
//   node src/scripts/verifyGhlTokens.js                   verify GHL_LOCATION_TOKENS from .env
//   node src/scripts/verifyGhlTokens.js --file new.json   verify a candidate token map instead

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { loadCompanies } = require('../config/companiesStore');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const tokens = fileIdx !== -1
  ? JSON.parse(require('fs').readFileSync(args[fileIdx + 1], 'utf8'))
  : JSON.parse(process.env.GHL_LOCATION_TOKENS || '{}');

async function probe(url, token) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION },
    });
    return res.ok ? 'ok' : `${res.status}`;
  } catch (e) {
    return `err:${e.message}`;
  }
}

async function main() {
  const { companies } = loadCompanies();
  let allOk = true;

  for (const c of companies) {
    const loc = c.ghlLocationId;
    const token = tokens[loc];
    if (!token) {
      console.log(`✗ ${c.name.padEnd(24)} NO TOKEN in map for ${loc}`);
      allOk = false;
      continue;
    }
    const [fields, contacts, opps] = await Promise.all([
      probe(`${GHL_BASE}/locations/${loc}/customFields`, token),
      probe(`${GHL_BASE}/contacts/?locationId=${loc}&limit=1`, token),
      probe(`${GHL_BASE}/opportunities/search?location_id=${loc}&limit=1`, token),
    ]);
    const ok = fields === 'ok' && contacts === 'ok' && opps === 'ok';
    if (!ok) allOk = false;
    console.log(`${ok ? '✓' : '✗'} ${c.name.padEnd(24)} customFields:${fields}  contacts:${contacts}  opportunities:${opps}  (${token.slice(0, 12)}…)`);
  }

  console.log(allOk
    ? '\nAll tokens verified for custom-field, contact and opportunity read scopes.'
    : '\nSome tokens failed — recreate/rescope those PITs and re-run.');
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
