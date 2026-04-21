require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { createCompanySheet } = require('./sheets/createCompanySheet');
const { addSalesPerson } = require('./sheets/addSalesPerson');
const { removeSalesPerson } = require('./sheets/removeSalesPerson');
const { logActivity } = require('./sheets/logActivity');
const { readTab, getSpreadsheetMeta } = require('./sheets/readSheet');
const { generateEOD } = require('./reporting/generateEOD');
const { archiveDaily } = require('./reporting/archiveDaily');
const { generateEOW } = require('./reporting/generateEOW');
const { archiveWeekly } = require('./reporting/archiveWeekly');
const { generateEOM } = require('./reporting/generateEOM');
const { archiveMonthly } = require('./reporting/archiveMonthly');
const { generateEOY } = require('./reporting/generateEOY');
const { archiveYearly } = require('./reporting/archiveYearly');
const { generateMeetingDoc } = require('./reporting/generateMeetingDoc');
const { populateAllFormulas, populateLiveFormulas } = require('./sheets/populateFormulas');
const { sendReportToSlack } = require('./integrations/slack');
const { sendReportToClickUp } = require('./integrations/clickup');

const { loadCompanies, loadAllCompanies } = require('./config/companiesStore');

function findCompany(name) {
  const data = loadCompanies();
  const company = data.companies.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!company) {
    console.error(`Company "${name}" not found. Available: ${data.companies.map(c => c.name).join(', ')}`);
    process.exit(1);
  }
  if (!company.sheetId) {
    console.error(`Company "${name}" has no sheetId configured. Run create-company first.`);
    process.exit(1);
  }
  return company;
}

/**
 * Get today's date in YYYY-MM-DD (AEST).
 */
function todayAEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    return;
  }

  switch (command) {
    case 'create-company': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: create-company <name> --owner <owner> --people <name1,name2>'); return; }
      const ownerIdx = args.indexOf('--owner');
      const peopleIdx = args.indexOf('--people');
      const ownerName = ownerIdx !== -1 ? args[ownerIdx + 1] : 'Owner';
      const peopleStr = peopleIdx !== -1 ? args[peopleIdx + 1] : '';
      const salesPeople = peopleStr ? peopleStr.split(',').map(n => ({
        name: n.trim(), active: true, startDate: todayAEST()
      })) : [];

      const sheetIdx = args.indexOf('--sheet');
      const existingSheetId = sheetIdx !== -1 ? args[sheetIdx + 1] : null;
      const sheetId = await createCompanySheet(companyName, ownerName, salesPeople, existingSheetId);
      console.log(`\nSheet ID: ${sheetId}`);
      if (!existingSheetId) console.log(`Share this sheet with your service account email to enable API access.`);
      break;
    }

    case 'add-person': {
      const companyName = args[1];
      const personName = args[2];
      if (!companyName || !personName) { console.error('Usage: add-person <company> <name>'); return; }
      const company = findCompany(companyName);
      await addSalesPerson(company.sheetId, personName, company.name);
      break;
    }

    case 'remove-person': {
      const companyName = args[1];
      const personName = args[2];
      if (!companyName || !personName) { console.error('Usage: remove-person <company> <name>'); return; }
      const company = findCompany(companyName);
      await removeSalesPerson(company.sheetId, personName, company.name);
      break;
    }

    case 'eod': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: eod <company> <person|--team> [--date YYYY-MM-DD]'); return; }
      const company = findCompany(companyName);

      const isTeam = args.includes('--team');
      const salesPerson = isTeam ? 'Team' : args[2];
      if (!isTeam && !salesPerson) { console.error('Specify a person name or --team'); return; }

      const dateIdx = args.indexOf('--date');
      const targetDate = dateIdx !== -1 ? args[dateIdx + 1] : todayAEST();

      const activityData = await readTab(company.sheetId, 'Activity Log');
      const { message, counts, names } = await generateEOD(
        company.sheetId, salesPerson, targetDate, company.name, company.ownerName, activityData
      );

      console.log('\n' + message + '\n');

      // Archive to daily storage
      const noArchive = args.includes('--no-archive');
      if (!noArchive) {
        await archiveDaily(company.sheetId, salesPerson, targetDate, message, counts, names, company.ownerName, company.name);
      }

      if (args.includes('--slack')) {
        await sendReportToSlack(company, 'eod', message);
      }
      if (args.includes('--clickup')) {
        const title = `EOD - ${salesPerson} - ${targetDate}`;
        await sendReportToClickUp(company, 'eod', title, message);
      }
      break;
    }

    case 'eow': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: eow <company> <person|--team> --start YYYY-MM-DD --end YYYY-MM-DD'); return; }
      const company = findCompany(companyName);

      const isTeam = args.includes('--team');
      const salesPerson = isTeam ? 'Team' : args[2];
      if (!isTeam && !salesPerson) { console.error('Specify a person name or --team'); return; }

      const startIdx = args.indexOf('--start');
      const endIdx = args.indexOf('--end');
      if (startIdx === -1 || endIdx === -1) { console.error('--start and --end dates required'); return; }
      const startDate = args[startIdx + 1];
      const endDate = args[endIdx + 1];

      const activityData = await readTab(company.sheetId, 'Activity Log');
      const { message, counts, efficiencyRates } = await generateEOW(
        company.sheetId, salesPerson, startDate, endDate, company.name, company.ownerName, activityData
      );

      console.log('\n' + message + '\n');

      const noArchive = args.includes('--no-archive');
      if (!noArchive) {
        await archiveWeekly(company.sheetId, salesPerson, startDate, endDate, message, counts, efficiencyRates || {}, company.ownerName, company.name);
      }

      if (args.includes('--slack')) {
        await sendReportToSlack(company, 'eow', message);
      }
      if (args.includes('--clickup')) {
        const title = `EOW - ${salesPerson} - ${startDate} to ${endDate}`;
        await sendReportToClickUp(company, 'eow', title, message);
      }
      break;
    }

    case 'list': {
      const data = loadAllCompanies();
      for (const c of data.companies) {
        const activePeople = c.salesPeople.filter(p => p.active).map(p => p.name);
        const status = c.active === false ? ' [INACTIVE]' : '';
        console.log(`${c.name}${status} (Sheet: ${c.sheetId || 'not created'})`);
        console.log(`  Owner: ${c.ownerName}`);
        console.log(`  Active Sales People: ${activePeople.join(', ') || 'none'}`);
        console.log();
      }
      break;
    }

    case 'read': {
      const companyName = args[1];
      const tabName = args[2];
      if (!companyName || !tabName) { console.error('Usage: read <company> <tab> [--rows N]'); return; }
      const company = findCompany(companyName);

      const rowsIdx = args.indexOf('--rows');
      const maxRows = rowsIdx !== -1 ? parseInt(args[rowsIdx + 1], 10) : 20;

      const data = await readTab(company.sheetId, tabName);
      const display = data.slice(0, maxRows + 1); // +1 for header
      for (const row of display) {
        console.log(row.join('\t'));
      }
      if (data.length > maxRows + 1) {
        console.log(`\n... ${data.length - maxRows - 1} more rows`);
      }
      break;
    }

    case 'status': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: status <company>'); return; }
      const company = findCompany(companyName);

      console.log(`\n${company.name}`);
      console.log(`Sheet ID: ${company.sheetId}`);
      console.log(`Owner: ${company.ownerName}`);
      console.log(`GHL Location: ${company.ghlLocationId || 'not set'}`);
      console.log('\nSales People:');
      for (const p of company.salesPeople) {
        console.log(`  ${p.name} - ${p.active ? 'Active' : 'Inactive'} (since ${p.startDate})`);
      }

      // Try to get activity log row count
      try {
        const logData = await readTab(company.sheetId, 'Activity Log');
        console.log(`\nActivity Log: ${Math.max(0, logData.length - 1)} entries`);

        // Find today's entries
        const today = todayAEST();
        const todayEntries = logData.filter(r => r[0] === today);
        console.log(`Today's entries (${today}): ${todayEntries.length}`);
      } catch (e) {
        console.log(`\nCould not read Activity Log: ${e.message}`);
      }
      console.log();
      break;
    }

    case 'log': {
      // Quick way to log a single activity from CLI
      const companyName = args[1];
      if (!companyName) {
        console.error('Usage: log <company> --person <name> --contact <name> --type <type> --outcome <outcome> [--value <val>] [--source <src>]');
        return;
      }
      const company = findCompany(companyName);

      const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : ''; };
      await logActivity(company.sheetId, {
        date: getArg('--date') || todayAEST(),
        salesPerson: getArg('--person'),
        contactName: getArg('--contact'),
        eventType: getArg('--type') || 'EOD Update',
        outcome: getArg('--outcome'),
        adSource: getArg('--source'),
        quoteJobValue: getArg('--value'),
        contactAddress: getArg('--address'),
      });
      console.log('Activity logged.');
      break;
    }

    case 'eom': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: eom <company> <person|--team> --year YYYY --month M [--no-archive]'); return; }
      const company = findCompany(companyName);

      const isTeam = args.includes('--team');
      const salesPerson = isTeam ? 'Team' : args[2];
      if (!isTeam && !salesPerson) { console.error('Specify a person name or --team'); return; }

      const yearIdx = args.indexOf('--year');
      const monthIdx = args.indexOf('--month');
      const today = todayAEST();
      const year = yearIdx !== -1 ? parseInt(args[yearIdx + 1]) : parseInt(today.split('-')[0]);
      const month = monthIdx !== -1 ? parseInt(args[monthIdx + 1]) : parseInt(today.split('-')[1]);

      const activityData = await readTab(company.sheetId, 'Activity Log');
      const { message, counts, efficiencyRates } = await generateEOM(
        company.sheetId, salesPerson, year, month, company.name, company.ownerName, activityData
      );

      console.log('\n' + message + '\n');

      const noArchive = args.includes('--no-archive');
      if (!noArchive && counts && Object.keys(counts).length > 0) {
        await archiveMonthly(company.sheetId, salesPerson, year, month, message, counts, efficiencyRates || {}, company.ownerName, company.name);
      }

      if (args.includes('--slack')) {
        await sendReportToSlack(company, 'eom', message);
      }
      if (args.includes('--clickup')) {
        const title = `EOM - ${salesPerson} - ${year}-${String(month).padStart(2, '0')}`;
        await sendReportToClickUp(company, 'eom', title, message);
      }
      break;
    }

    case 'eoy': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: eoy <company> <person|--team> --year YYYY [--no-archive]'); return; }
      const company = findCompany(companyName);

      const isTeam = args.includes('--team');
      const salesPerson = isTeam ? 'Team' : args[2];
      if (!isTeam && !salesPerson) { console.error('Specify a person name or --team'); return; }

      const yearIdx = args.indexOf('--year');
      const today = todayAEST();
      const year = yearIdx !== -1 ? parseInt(args[yearIdx + 1]) : parseInt(today.split('-')[0]);

      const { message, counts, efficiencyRates } = await generateEOY(
        company.sheetId, salesPerson, year, company.name, company.ownerName
      );

      console.log('\n' + message + '\n');

      const noArchive = args.includes('--no-archive');
      if (!noArchive && counts && Object.keys(counts).length > 0) {
        await archiveYearly(company.sheetId, salesPerson, year, message, counts, efficiencyRates || {}, company.ownerName, company.name);
      }

      if (args.includes('--slack')) {
        await sendReportToSlack(company, 'eoy', message);
      }
      if (args.includes('--clickup')) {
        const title = `EOY - ${salesPerson} - ${year}`;
        await sendReportToClickUp(company, 'eoy', title, message);
      }
      break;
    }

    case 'meeting': {
      const startIdx = args.indexOf('--start');
      const endIdx = args.indexOf('--end');
      const today = todayAEST();

      // Default to current week
      const d = new Date(today + 'T12:00:00+10:00');
      const day = d.getDay();
      const mondayDiff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + mondayDiff);
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);

      const startDate = startIdx !== -1 ? args[startIdx + 1] : monday.toISOString().split('T')[0];
      const endDate = endIdx !== -1 ? args[endIdx + 1] : friday.toISOString().split('T')[0];

      const { title, content } = await generateMeetingDoc(startDate, endDate);
      console.log('\n' + content + '\n');
      break;
    }

    case 'populate': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: populate <company>'); return; }
      const company = findCompany(companyName);
      await populateAllFormulas(company.sheetId, company.name, company.ownerName, company.salesPeople);
      break;
    }

    case 'populate-live': {
      const companyName = args[1];
      if (!companyName) { console.error('Usage: populate-live <company>'); return; }
      const company = findCompany(companyName);
      await populateLiveFormulas(company.sheetId, company.name, company.ownerName, company.salesPeople);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
  }
}

function printUsage() {
  console.log(`
EOD Reporting System - CLI

Commands:
  create-company <name> --owner <owner> --people <name1,name2>
  add-person <company> <name>
  remove-person <company> <name>
  eod <company> <person|--team> [--date YYYY-MM-DD] [--no-archive] [--slack] [--clickup]
  eow <company> <person|--team> --start YYYY-MM-DD --end YYYY-MM-DD [--no-archive] [--slack] [--clickup]
  eom <company> <person|--team> [--year YYYY --month M] [--no-archive] [--slack] [--clickup]
  eoy <company> <person|--team> [--year YYYY] [--no-archive] [--slack] [--clickup]
  meeting [--start YYYY-MM-DD --end YYYY-MM-DD]
  list
  read <company> <tab> [--rows N]
  status <company>
  log <company> --person <name> --contact <name> --type <type> --outcome <outcome>

Automation:
  npm run server    — Start server with cron scheduling + webhook endpoints
  npm run eod       — Run EOD for all companies
  npm run eow       — Run EOW for all companies
  npm run eom       — Run EOM for all companies
  npm run eoy       — Run EOY for all companies
  npm run meeting   — Generate weekly meeting doc
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
