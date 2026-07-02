// Shared address formatter for every report renderer (EOD / EOW / EOM), so the
// three can't drift. Two jobs, both DISPLAY-only:
//   1. Force the address onto one line — GHL sends fields with embedded newlines.
//   2. Strip the trailing Australian state + postcode ("...Kenwick WA 6107" →
//      "...Kenwick"). Either/both may be absent; whatever's there is removed.
//
// The FULL address stays in the database (Google-Maps links on /visits, dedup
// matching) — this only shapes what reports print. Keep byte-identical to the
// dashboard copy in dashboard/src/lib/messages.ts.

const AU_STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT|New South Wales|Victoria|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory';

function cleanAddress(address) {
  let s = (address || '')
    .replace(/\s+/g, ' ')        // collapse embedded newlines / whitespace runs → one space
    .replace(/\s*,\s*/g, ', ')   // tidy comma spacing
    .replace(/,\s*$/, '')        // drop any trailing comma
    .trim();
  s = s
    .replace(new RegExp(`[,\\s]+(?:(?:${AU_STATES})\\b[,\\s]*)?\\d{4}\\s*$`, 'i'), '')  // [state] postcode
    .replace(new RegExp(`[,\\s]+(?:${AU_STATES})\\.?\\s*$`, 'i'), '')                    // bare state, no postcode
    .replace(/[,\s]+$/, '')
    .trim();
  return s;
}

module.exports = { cleanAddress };
