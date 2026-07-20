// Prints the signed /eod-entry URL for a client — paste it into a
// GoHighLevel Custom Menu Link (sub-account level, "Embedded Page / iFrame")
// so the EOD entry form renders inside GHL. The HMAC here must mirror
// dashboard/src/lib/eodEntryToken.ts: HMAC-SHA256("eod-entry:<slug>", secret),
// hex, first 32 chars. Secret is EOD_ENTRY_SECRET, falling back to
// WEBHOOK_SECRET (which must then match the dashboard's Vercel value).
//
// Usage:
//   node src/scripts/makeEodEntryLink.js <company-slug> [baseUrl]
//   baseUrl defaults to DASHBOARD_URL env var.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const crypto = require('crypto');

const slug = process.argv[2];
const base = process.argv[3] || process.env.DASHBOARD_URL;
const secret = process.env.EOD_ENTRY_SECRET || process.env.WEBHOOK_SECRET;

if (!slug) {
  console.error('Usage: node src/scripts/makeEodEntryLink.js <company-slug> [baseUrl]');
  process.exit(1);
}
if (!secret) {
  console.error('EOD_ENTRY_SECRET / WEBHOOK_SECRET not set in .env');
  process.exit(1);
}
if (!base) {
  console.error('Pass the dashboard base URL as the 2nd arg or set DASHBOARD_URL in .env');
  process.exit(1);
}

const sig = crypto.createHmac('sha256', secret).update(`eod-entry:${slug}`).digest('hex').slice(0, 32);
const token = `${slug}.${sig}`;
console.log(`${base.replace(/\/+$/, '')}/eod-entry?token=${encodeURIComponent(token)}`);
