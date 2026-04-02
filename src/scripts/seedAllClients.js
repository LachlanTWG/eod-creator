require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { appendRows } = require('../sheets/writeSheet');
const { populateAllFormulas } = require('../sheets/populateFormulas');
const { loadCompanies } = require('../config/companiesStore');
const companies = loadCompanies().companies;

// --- Name pools ---
const firstNames = ['James','Sarah','Michael','Emma','David','Sophie','Daniel','Olivia','Luke','Mia',
  'Ben','Charlotte','Ryan','Chloe','Jack','Emily','Tom','Grace','Matt','Hannah','Chris','Jessica',
  'Adam','Lily','Josh','Isabella','Nathan','Ava','Sam','Zoe','Mark','Ruby','Steve','Ella','Pete',
  'Amelia','Nick','Harper','Tim','Scarlett','Brad','Layla','Craig','Sienna','Aaron','Piper',
  'Glen','Willow','Dean','Matilda'];
const lastNames = ['Smith','Johnson','Williams','Brown','Jones','Wilson','Taylor','Davis','Anderson',
  'Thomas','White','Harris','Martin','Thompson','Moore','Clark','Walker','Hall','Allen','Young',
  'King','Wright','Green','Baker','Hill','Scott','Adams','Nelson','Carter','Mitchell','Roberts',
  'Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins','Stewart','Morris'];

const sources = ['Facebook Ad Form','Website Form','Instagram Message','Facebook Message',
  'Direct Email','Direct Phone Call','Direct Text Message','Direct Lead passed on from Client'];

const addresses = ['12 Smith St','45 Ocean Dr','78 Mountain Rd','3 Railway Pde','22 Park Ave',
  '91 Beach Rd','15 George St','67 Victoria Ave','34 King St','8 Bridge Rd','55 Station St',
  '29 Lake Dr','41 Elm St','73 Cedar Ln','19 Maple Ave','88 Pine Rd','6 Harbour Way',
  '52 River Rd','31 Valley Dr','64 Summit St'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomName() { return `${pick(firstNames)} ${pick(lastNames)}`; }

function generateDayData(date, salesPerson, ownerName, intensity) {
  const rows = [];
  const numCalls = randInt(intensity.minCalls, intensity.maxCalls);
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
      if (r < 0.2) action = 'Requires Quoting';
      else if (r < 0.3) action = `Passed Onto ${ownerName}`;
      else if (r < 0.4) action = 'Verbal Confirmation';
      else if (r < 0.45) action = 'Book Site Visit';
      else if (r < 0.55) action = 'Not a Good Time to Talk';
      else if (r < 0.6) action = 'Email Sent';
      else if (r < 0.65) action = 'Lost - Price';
      else if (r < 0.7) action = 'Lost - Time Related';
      else if (r < 0.73) action = 'Abandoned - Not Responding';
      else if (r < 0.76) action = 'DQ - Wrong Contact / Spam';
      else if (r < 0.78) action = 'DQ - Out of Service Area';
      else if (r < 0.8) action = 'Not Ready Yet - Pre-Quote';
      else if (r < 0.82) action = 'Not Ready Yet - Post Quote';
      else action = 'Requires Quoting';
    }

    const outcome = `${leadType} | ${answerStatus} | ${action} | | ${source}`;
    rows.push([date, salesPerson, contact, 'EOD Update', outcome, source, '', '', '', '', '']);

    // Site visit from "Book Site Visit" actions
    if (action === 'Book Site Visit' && Math.random() < 0.7) {
      const visitDate = new Date(date + 'T12:00:00+10:00');
      visitDate.setDate(visitDate.getDate() + randInt(2, 7));
      const hour = randInt(8, 15);
      const visitDateStr = visitDate.toISOString().split('T')[0];
      const visitDateTime = `${visitDateStr}T${String(hour).padStart(2,'0')}:00:00+10:00`;
      const addr = pick(addresses);
      rows.push([date, salesPerson, contact, 'Site Visit Booked', '', '', '', addr, '', visitDateTime, visitDateStr]);
    }
  }

  // Quotes (2-4 per day for busy, 0-2 for quiet)
  const numQuotes = randInt(intensity.minQuotes, intensity.maxQuotes);
  for (let i = 0; i < numQuotes; i++) {
    const contact = contacts[randInt(0, Math.min(contacts.length - 1, numCalls - 1))] || randomName();
    const numValues = randInt(1, 3);
    const values = [];
    for (let j = 0; j < numValues; j++) {
      values.push(randInt(2000, 35000));
    }
    rows.push([date, salesPerson, contact, 'Quote Sent', '', '', values.join('|'), '', '', '', '']);
  }

  // Jobs won (0-1 per day)
  if (Math.random() < intensity.jobChance) {
    const contact = contacts[randInt(0, Math.min(contacts.length - 1, numCalls - 1))] || randomName();
    const value = randInt(5000, 45000);
    const addr = pick(addresses);
    rows.push([date, salesPerson, contact, 'Job Won', '', pick(sources), String(value), addr, '', '', '']);
  }

  return rows;
}

function getWeekdaysBetween(start, end) {
  const dates = [];
  const d = new Date(start + 'T12:00:00+10:00');
  const endD = new Date(end + 'T12:00:00+10:00');
  while (d <= endD) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function seedCompany(company) {
  if (!company.sheetId) {
    console.log(`Skipping ${company.name} — no sheet ID.`);
    return;
  }

  console.log(`\nSeeding ${company.name}...`);

  // Generate 2 weeks of data: March 23 - April 2
  const weekdays = getWeekdaysBetween('2026-03-23', '2026-04-02');
  const allRows = [];

  const intensities = {
    'Bolton EC': { minCalls: 8, maxCalls: 15, minQuotes: 1, maxQuotes: 4, jobChance: 0.35 },
    'HDK Long Run Roofing': { minCalls: 6, maxCalls: 12, minQuotes: 1, maxQuotes: 3, jobChance: 0.3 },
    'Virtue Roofing': { minCalls: 5, maxCalls: 10, minQuotes: 1, maxQuotes: 3, jobChance: 0.25 },
    'Tradie Web Guys': { minCalls: 4, maxCalls: 8, minQuotes: 0, maxQuotes: 2, jobChance: 0.2 },
    'Next Gen Solar': { minCalls: 6, maxCalls: 12, minQuotes: 1, maxQuotes: 3, jobChance: 0.3 },
    'Hughes Electrical': { minCalls: 7, maxCalls: 14, minQuotes: 1, maxQuotes: 4, jobChance: 0.3 },
  };

  const intensity = intensities[company.name] || { minCalls: 5, maxCalls: 10, minQuotes: 1, maxQuotes: 2, jobChance: 0.25 };
  const activePeople = company.salesPeople.filter(p => p.active);

  for (const date of weekdays) {
    for (const person of activePeople) {
      const dayRows = generateDayData(date, person.name, company.ownerName, intensity);
      allRows.push(...dayRows);
    }
  }

  // Write all rows at once
  console.log(`  Writing ${allRows.length} activity rows...`);

  // Batch in chunks of 200 to avoid quota issues
  const CHUNK_SIZE = 200;
  for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
    const chunk = allRows.slice(i, i + CHUNK_SIZE);
    await appendRows(company.sheetId, 'Activity Log', chunk);
    if (i + CHUNK_SIZE < allRows.length) {
      // Small delay between chunks to avoid rate limits
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.log(`  Activity log populated.`);

  // Populate formulas
  console.log(`  Populating live formulas...`);
  await populateAllFormulas(company.sheetId, company.name, company.ownerName, company.salesPeople);
  console.log(`  Formulas populated.`);

  console.log(`  ${company.name} — DONE`);
}

async function main() {
  const targetCompany = process.argv[2]; // Optional: seed just one company

  for (const company of companies) {
    if (targetCompany && company.name.toLowerCase() !== targetCompany.toLowerCase()) continue;
    if (company.name === 'Bolton EC') {
      console.log(`Skipping Bolton EC — already has data.`);
      continue;
    }

    try {
      await seedCompany(company);
      // Delay between companies to avoid rate limits
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error(`Error seeding ${company.name}: ${err.message}`);
    }
  }

  console.log('\n=== All clients seeded ===');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
