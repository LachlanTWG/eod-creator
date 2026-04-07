/**
 * Seed Hughes Electrical with one week of realistic test data (March 31 - April 4).
 * This covers a full Mon-Fri work week for EOD/EOW testing, plus April data for EOM.
 *
 * Usage: node src/scripts/seedHughes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { appendRows } = require('../sheets/writeSheet');

const SHEET_ID = '1waI6GXXPfrmIF18bJqHmSN1pIAGkH28TXbpj8vpivfU';
const OWNER = 'Ben';
const SALES_PEOPLE = ['Lachlan', 'Buzz'];

const firstNames = ['James','Sarah','Michael','Emma','David','Sophie','Daniel','Olivia','Luke','Mia',
  'Ben','Charlotte','Ryan','Chloe','Jack','Emily','Tom','Grace','Matt','Hannah','Chris','Jessica',
  'Adam','Lily','Josh','Isabella','Nathan','Ava','Sam','Zoe','Mark','Ruby','Steve','Ella','Pete',
  'Amelia','Nick','Harper','Tim','Scarlett','Brad','Layla','Craig','Sienna','Aaron','Piper'];
const lastNames = ['Smith','Johnson','Williams','Brown','Jones','Wilson','Taylor','Davis','Anderson',
  'Thomas','White','Harris','Martin','Thompson','Moore','Clark','Walker','Hall','Allen','Young',
  'King','Wright','Green','Baker','Hill','Scott','Adams','Nelson','Carter','Mitchell'];

const sources = ['Facebook Ad Form','Website Form','Instagram Message','Facebook Message',
  'Direct Email','Direct Phone Call','Direct Text Message','Direct Lead passed on from Client'];

const addresses = ['12 Smith St, Perth','45 Ocean Dr, Joondalup','78 Mountain Rd, Midland',
  '3 Railway Pde, Fremantle','22 Park Ave, Subiaco','91 Beach Rd, Scarborough',
  '15 George St, East Perth','67 Victoria Ave, Claremont','34 King St, Perth CBD',
  '8 Bridge Rd, Como','55 Station St, Cannington','29 Lake Dr, Bibra Lake'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomName() { return `${pick(firstNames)} ${pick(lastNames)}`; }

function generateDayData(date, salesPerson) {
  const rows = [];
  const numCalls = randInt(8, 15);
  const contacts = [];

  for (let i = 0; i < numCalls; i++) {
    contacts.push(randomName());
  }

  for (let i = 0; i < numCalls; i++) {
    const contact = contacts[i];
    const isNew = Math.random() < 0.45;
    const isPreQuote = Math.random() < 0.3;
    const leadType = isNew ? 'New Leads' : (isPreQuote ? 'Pre-Quote Follow Up' : 'Post Quote Follow Up');
    const answered = Math.random() < 0.7;
    const answerStatus = answered ? 'Answered' : "Didn't Answer";
    const source = pick(sources);

    let action = '';
    if (answered) {
      const r = Math.random();
      if (r < 0.15) action = 'Requires Quoting';
      else if (r < 0.25) action = `Passed Onto ${OWNER}`;
      else if (r < 0.35) action = 'Verbal Confirmation';
      else if (r < 0.42) action = 'Book Site Visit';
      else if (r < 0.50) action = 'Not a Good Time to Talk';
      else if (r < 0.55) action = 'Emails Sent';
      else if (r < 0.60) action = 'Lost - Price';
      else if (r < 0.65) action = 'Lost - Time Related';
      else if (r < 0.68) action = 'Lost - Priorities Changed';
      else if (r < 0.73) action = 'Abandoned - Not Responding';
      else if (r < 0.76) action = 'DQ - Wrong Contact / Spam';
      else if (r < 0.79) action = 'DQ - Out of Service Area';
      else if (r < 0.82) action = 'DQ - Price';
      else if (r < 0.85) action = 'DQ - Extent of Works';
      else if (r < 0.88) action = 'Not Ready Yet - Pre-Quote';
      else if (r < 0.91) action = 'Not Ready Yet - Post Quote';
      else if (r < 0.94) action = 'Abandoned - Headache';
      else if (r < 0.97) action = 'DQ - Lead Looking for Work';
      else action = 'Requires Quoting';
    }

    const outcome = `${leadType} | ${answerStatus} | ${action} | | ${source}`;
    rows.push([date, salesPerson, contact, 'EOD Update', outcome, source, '', '', '', '', '']);

    // Site visits from "Book Site Visit" actions
    if (action === 'Book Site Visit' && Math.random() < 0.8) {
      const visitDate = new Date(date + 'T12:00:00+08:00');
      visitDate.setDate(visitDate.getDate() + randInt(2, 7));
      const hour = randInt(8, 16);
      const visitDateStr = visitDate.toISOString().split('T')[0];
      const visitDateTime = `${visitDateStr}T${String(hour).padStart(2,'0')}:00:00+08:00`;
      const addr = pick(addresses);
      rows.push([date, salesPerson, contact, 'Site Visit Booked', '', '', '', addr, '', visitDateTime, visitDateStr]);
    }

    // Emails sent
    if (action === 'Emails Sent') {
      rows.push([date, salesPerson, contact, 'Emails Sent', '', '', '', '', '', '', '']);
    }
  }

  // Quotes (2-5 per day)
  const numQuotes = randInt(2, 5);
  for (let i = 0; i < numQuotes; i++) {
    const contact = contacts[randInt(0, contacts.length - 1)] || randomName();
    const numValues = randInt(1, 3);
    const values = [];
    for (let j = 0; j < numValues; j++) {
      values.push(randInt(3000, 25000));
    }
    rows.push([date, salesPerson, contact, 'Quote Sent', '', '', values.join('|'), '', '', '', '']);
  }

  // Jobs won (0-2 per day)
  const numJobs = Math.random() < 0.4 ? randInt(1, 2) : 0;
  for (let i = 0; i < numJobs; i++) {
    const contact = contacts[randInt(0, contacts.length - 1)] || randomName();
    const value = randInt(4000, 35000);
    const addr = pick(addresses);
    rows.push([date, salesPerson, contact, 'Job Won', '', pick(sources), String(value), addr, '', '', '']);
  }

  return rows;
}

function getWeekdays(start, end) {
  const dates = [];
  const d = new Date(start + 'T12:00:00+08:00');
  const endD = new Date(end + 'T12:00:00+08:00');
  while (d <= endD) {
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function main() {
  // Full work week: Mon March 31 - Fri April 4
  const weekdays = getWeekdays('2026-03-31', '2026-04-04');
  const allRows = [];

  for (const date of weekdays) {
    for (const person of SALES_PEOPLE) {
      allRows.push(...generateDayData(date, person));
    }
  }

  console.log(`Generated ${allRows.length} rows for ${weekdays.length} days x ${SALES_PEOPLE.length} people`);
  console.log(`Date range: ${weekdays[0]} to ${weekdays[weekdays.length - 1]}`);

  // Upload in chunks
  const CHUNK = 200;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    await appendRows(SHEET_ID, 'Activity Log', chunk, true);
    console.log(`  Uploaded rows ${i + 1}-${Math.min(i + CHUNK, allRows.length)}`);
    if (i + CHUNK < allRows.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log('\nDone! You can now run:');
  console.log('  EOD:  node src/index.js eod "Hughes Electrical" Lachlan --date 2026-04-04');
  console.log('  EOW:  node src/index.js eow "Hughes Electrical" Lachlan --start 2026-03-31 --end 2026-04-04');
  console.log('  EOM:  node src/index.js eom "Hughes Electrical" Lachlan --month 2026-04');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
