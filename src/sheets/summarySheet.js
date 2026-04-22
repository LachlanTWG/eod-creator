const { getSheetsClient } = require('../auth');
const { writeSheet, clearRange, batchUpdate, appendRows } = require('./writeSheet');
const { readTab } = require('./readSheet');
const { loadCompanies } = require('../config/companiesStore');
const { getOutcomeNames } = require('./createCompanySheet');

/**
 * Build a map of exec name -> [{ companyName, sheetId, ownerName }]
 * Only includes active companies and active salespeople.
 */
function buildExecMap() {
  const { companies } = loadCompanies();
  const execMap = {};

  for (const company of companies) {
    for (const person of company.salesPeople) {
      if (!person.active) continue;
      if (!execMap[person.name]) execMap[person.name] = [];
      execMap[person.name].push({
        companyName: company.name,
        sheetId: company.sheetId,
        ownerName: company.ownerName,
      });
    }
  }

  return execMap;
}

// ─── Sheet Creation ─────────────────────────────────────────────────

/**
 * Create the Sales Exec Summary spreadsheet (or use existing).
 * Returns the spreadsheetId.
 */
async function createSummarySheet(existingSheetId) {
  const sheets = await getSheetsClient();
  const execMap = buildExecMap();
  const execNames = Object.keys(execMap);

  // Build tab names: display tabs + storage tabs + totals
  const tabNames = [];
  for (const name of execNames) {
    tabNames.push(
      `${name} EOD`, `${name} EOW`, `${name} EOM`,
      `${name} Daily`, `${name} Weekly`, `${name} Monthly`
    );
  }
  tabNames.push(
    'Total EOD', 'Total EOW', 'Total EOM',
    'Total Daily', 'Total Weekly', 'Total Monthly'
  );

  let spreadsheetId;

  if (existingSheetId) {
    spreadsheetId = existingSheetId;
    console.log(`Using existing spreadsheet: ${spreadsheetId}`);

    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });
    const existingTabs = meta.data.sheets.map(s => s.properties.title);
    const maxId = Math.max(...meta.data.sheets.map(s => s.properties.sheetId));

    const addRequests = [];
    tabNames.forEach((title, i) => {
      if (!existingTabs.includes(title)) {
        addRequests.push({
          addSheet: { properties: { sheetId: maxId + i + 1, title } }
        });
      }
    });

    if (addRequests.length > 0) {
      await batchUpdate(spreadsheetId, addRequests);
      console.log(`Added ${addRequests.length} tabs.`);
    }
  } else {
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Sales Exec Summary' },
        sheets: tabNames.map((title, i) => ({
          properties: { sheetId: i, title, index: i }
        }))
      }
    });
    spreadsheetId = createRes.data.spreadsheetId;
    console.log(`Created spreadsheet: ${spreadsheetId}`);
  }

  // Populate display tabs + write storage headers
  await populateSummaryFormulas(spreadsheetId);
  await writeStorageHeaders(spreadsheetId);

  return spreadsheetId;
}

// ─── Display Tab Formulas (IMPORTRANGE) ─────────────────────────────

function importCell(sheetId, tabName, cellRef) {
  return `IFERROR(IMPORTRANGE("${sheetId}","'${tabName}'!${cellRef}"),0)`;
}

async function populateSummaryFormulas(summarySheetId) {
  const execMap = buildExecMap();

  for (const [execName, companies] of Object.entries(execMap)) {
    const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
    await populateExecEOD(summarySheetId, execName, companies, outcomeNames);
    await populateExecEOW(summarySheetId, execName, companies, outcomeNames);
    await populateExecEOM(summarySheetId, execName, companies, outcomeNames);
  }

  // Total tabs — sum all execs
  const execNames = Object.keys(execMap);
  const firstCompany = Object.values(execMap)[0][0];
  const outcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);
  await populateTotalTab(summarySheetId, 'Total EOD', 'EOD', execNames, outcomeNames);
  await populateTotalTab(summarySheetId, 'Total EOW', 'EOW', execNames, outcomeNames);
  await populateTotalTab(summarySheetId, 'Total EOM', 'EOM', execNames, outcomeNames);

  console.log('Summary display tabs populated.');
}

async function populateExecEOD(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} EOD`;
  const companyNames = companies.map(c => c.companyName);
  const grid = [];

  grid.push(['Sales Person', execName]);
  grid.push(['Companies', companyNames.join(', ')]);
  grid.push(['Date Mode', 'today']);
  grid.push(['Manual Date', '']);
  grid.push(['Target Date', '=IF(B3="today",TODAY(),B4)']);
  grid.push(['']);
  grid.push(['Outcome', 'Total', ...companyNames]);

  for (let i = 0; i < outcomeNames.length; i++) {
    const sourceRow = 8 + i;
    const row = [outcomeNames[i]];
    const companyCols = [];
    for (let j = 0; j < companies.length; j++) {
      companyCols.push(`=${importCell(companies[j].sheetId, `${execName} EOD`, `B${sourceRow}`)}`);
    }
    const lastCol = String.fromCharCode(67 + companies.length - 1);
    row.push(`=SUM(C${8 + i}:${lastCol}${8 + i})`);
    row.push(...companyCols);
    grid.push(row);
  }

  const lastRow = 8 + outcomeNames.length;
  await clearRange(summarySheetId, `'${tabName}'!A1:${String.fromCharCode(67 + companies.length)}${lastRow}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName}`);
}

async function populateExecEOW(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} EOW`;
  const companyNames = companies.map(c => c.companyName);
  const grid = [];

  grid.push(['Sales Person', execName]);
  grid.push(['Companies', companyNames.join(', ')]);
  grid.push(['Week Start', '=TODAY()-WEEKDAY(TODAY(),2)+1']);
  grid.push(['Week End', '=B3+6']);
  grid.push(['']);
  grid.push(['']);
  grid.push(['Outcome', 'Total', ...companyNames]);

  for (let i = 0; i < outcomeNames.length; i++) {
    const sourceRow = 8 + i;
    const row = [outcomeNames[i]];
    const companyCols = [];
    for (let j = 0; j < companies.length; j++) {
      companyCols.push(`=${importCell(companies[j].sheetId, `${execName} EOW`, `B${sourceRow}`)}`);
    }
    const lastCol = String.fromCharCode(67 + companies.length - 1);
    row.push(`=SUM(C${8 + i}:${lastCol}${8 + i})`);
    row.push(...companyCols);
    grid.push(row);
  }

  const lastRow = 8 + outcomeNames.length;
  await clearRange(summarySheetId, `'${tabName}'!A1:${String.fromCharCode(67 + companies.length)}${lastRow}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName}`);
}

async function populateExecEOM(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} EOM`;
  const companyNames = companies.map(c => c.companyName);
  const grid = [];

  grid.push(['Sales Person', execName]);
  grid.push(['Companies', companyNames.join(', ')]);
  grid.push(['Month Start', '=DATE(YEAR(TODAY()),MONTH(TODAY()),1)']);
  grid.push(['Month End', '=EOMONTH(B3,0)']);
  grid.push(['']);
  grid.push(['']);
  grid.push(['Outcome', 'Total', ...companyNames]);

  for (let i = 0; i < outcomeNames.length; i++) {
    const sourceRow = 8 + i;
    const row = [outcomeNames[i]];
    const companyCols = [];
    for (let j = 0; j < companies.length; j++) {
      companyCols.push(`=${importCell(companies[j].sheetId, `${execName} EOM`, `B${sourceRow}`)}`);
    }
    const lastCol = String.fromCharCode(67 + companies.length - 1);
    row.push(`=SUM(C${8 + i}:${lastCol}${8 + i})`);
    row.push(...companyCols);
    grid.push(row);
  }

  const lastRow = 8 + outcomeNames.length;
  await clearRange(summarySheetId, `'${tabName}'!A1:${String.fromCharCode(67 + companies.length)}${lastRow}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName}`);
}

/**
 * Populate a Total tab that sums all execs' display tabs.
 * References each exec's column B (Total) from their corresponding display tab.
 */
async function populateTotalTab(summarySheetId, tabName, reportType, execNames, outcomeNames) {
  const grid = [];

  if (reportType === 'EOD') {
    grid.push(['', 'Total', ...execNames]);
    grid.push(['Companies', 'All']);
    grid.push(['Date Mode', 'today']);
    grid.push(['Manual Date', '']);
    grid.push(['Target Date', '=IF(B3="today",TODAY(),B4)']);
  } else if (reportType === 'EOW') {
    grid.push(['', 'Total', ...execNames]);
    grid.push(['Companies', 'All']);
    grid.push(['Week Start', '=TODAY()-WEEKDAY(TODAY(),2)+1']);
    grid.push(['Week End', '=B3+6']);
  } else {
    grid.push(['', 'Total', ...execNames]);
    grid.push(['Companies', 'All']);
    grid.push(['Month Start', '=DATE(YEAR(TODAY()),MONTH(TODAY()),1)']);
    grid.push(['Month End', '=EOMONTH(B3,0)']);
  }

  grid.push(['']);
  grid.push(['']);
  grid.push(['Outcome', 'Total', ...execNames]);

  for (let i = 0; i < outcomeNames.length; i++) {
    const sourceRow = 8 + i;
    const row = [outcomeNames[i]];

    // Per-exec columns referencing their display tab's Total (column B)
    const execCols = [];
    for (const name of execNames) {
      execCols.push(`=IFERROR('${name} ${reportType}'!B${sourceRow},0)`);
    }

    // Total = SUM of exec columns
    const lastCol = String.fromCharCode(67 + execNames.length - 1);
    row.push(`=SUM(C${sourceRow}:${lastCol}${sourceRow})`);
    row.push(...execCols);
    grid.push(row);
  }

  const lastRow = 8 + outcomeNames.length;
  await clearRange(summarySheetId, `'${tabName}'!A1:${String.fromCharCode(67 + execNames.length)}${lastRow}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName}`);
}

// ─── Storage Tabs (Combined Daily/Weekly/Monthly) ───────────────────

/**
 * Write headers for all exec storage tabs.
 */
async function writeStorageHeaders(summarySheetId) {
  const execMap = buildExecMap();

  for (const [execName, companies] of Object.entries(execMap)) {
    const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
    const companyNames = companies.map(c => c.companyName);

    // Daily headers: Date | Total per outcome... | Company breakdowns...
    const dailyHeader = ['Date'];
    for (const name of outcomeNames) dailyHeader.push(name);
    dailyHeader.push('Total Revenue');
    for (const cn of companyNames) dailyHeader.push(`--- ${cn} ---`);
    // We don't actually add per-company breakdown columns to storage to keep it simple
    // The total across companies is what matters for tracking

    const weeklyHeader = ['Week Start', 'Week End'];
    for (const name of outcomeNames) weeklyHeader.push(name);
    weeklyHeader.push('Total Revenue');

    const monthlyHeader = ['Month'];
    for (const name of outcomeNames) monthlyHeader.push(name);
    monthlyHeader.push('Total Revenue');

    // Only write headers if tab is empty
    for (const [tabSuffix, header] of [['Daily', dailyHeader], ['Weekly', weeklyHeader], ['Monthly', monthlyHeader]]) {
      const tabName = `${execName} ${tabSuffix}`;
      try {
        const existing = await readTab(summarySheetId, tabName);
        if (existing.length === 0) {
          await writeSheet(summarySheetId, `'${tabName}'!A1`, [header]);
          console.log(`  Wrote headers for ${tabName}`);
        }
      } catch (e) {
        console.error(`  Could not write headers for ${tabName}: ${e.message}`);
      }
    }
  }

  // Total storage headers
  const firstCompany = Object.values(execMap)[0][0];
  const totalOutcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);

  const totalDailyHeader = ['Date'];
  for (const name of totalOutcomeNames) totalDailyHeader.push(name);
  totalDailyHeader.push('Total Revenue');

  const totalWeeklyHeader = ['Week Start', 'Week End'];
  for (const name of totalOutcomeNames) totalWeeklyHeader.push(name);
  totalWeeklyHeader.push('Total Revenue');

  const totalMonthlyHeader = ['Month'];
  for (const name of totalOutcomeNames) totalMonthlyHeader.push(name);
  totalMonthlyHeader.push('Total Revenue');

  for (const [tabSuffix, header] of [['Daily', totalDailyHeader], ['Weekly', totalWeeklyHeader], ['Monthly', totalMonthlyHeader]]) {
    const tabName = `Total ${tabSuffix}`;
    try {
      const existing = await readTab(summarySheetId, tabName);
      if (existing.length === 0) {
        await writeSheet(summarySheetId, `'${tabName}'!A1`, [header]);
        console.log(`  Wrote headers for ${tabName}`);
      }
    } catch (e) {
      console.error(`  Could not write headers for ${tabName}: ${e.message}`);
    }
  }
}

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

/**
 * Archive combined daily data for one exec across all their companies.
 * Reads each company's "{exec} Daily" tab, finds the row for the given date,
 * sums the counts, and writes to the summary sheet.
 */
async function archiveSummaryDaily(summarySheetId, execName, date) {
  const execMap = buildExecMap();
  const companies = execMap[execName];
  if (!companies || companies.length === 0) return;

  const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
  const tabName = `${execName} Daily`;

  // Read each company's daily storage and find the row for this date
  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Daily`);
      if (rows.length < 2) continue;

      // Find row for this date
      for (let i = 1; i < rows.length; i++) {
        if (parseSerialDate(rows[i][0]) === date) {
          // Daily storage layout: Date | Message | [Count, Names] pairs... | Revenue
          // Count columns are at indices 2, 4, 6, 8, ... (every other starting at 2)
          for (let j = 0; j < outcomeNames.length; j++) {
            const colIdx = 2 + (j * 2); // count columns
            const val = parseFloat(rows[i][colIdx] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          // Revenue is the last column
          const revIdx = 2 + (outcomeNames.length * 2);
          const rev = parseFloat(rows[i][revIdx] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Daily from ${company.companyName}: ${e.message}`);
    }
  }

  // Check if row exists in summary
  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (parseSerialDate(existing[i][0]) === date) {
      existingRowIdx = i;
      break;
    }
  }

  // Build the row: Date | counts... | revenue
  const row = [date, ...combinedCounts, totalRevenue];

  if (existingRowIdx >= 0) {
    const sheetRow = existingRowIdx + 1;
    await writeSheet(summarySheetId, `'${tabName}'!A${sheetRow}`, [row]);
    console.log(`  Updated ${tabName} for ${date}`);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
    console.log(`  Appended ${tabName} for ${date}`);
  }
}

/**
 * Archive combined weekly data for one exec across all their companies.
 */
async function archiveSummaryWeekly(summarySheetId, execName, startDate, endDate) {
  const execMap = buildExecMap();
  const companies = execMap[execName];
  if (!companies || companies.length === 0) return;

  const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
  const tabName = `${execName} Weekly`;

  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Weekly`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        if (parseSerialDate(rows[i][0]) === startDate) {
          // Weekly layout: Start | End | Message | counts... | computed... | Revenue
          // Count columns start at index 3
          for (let j = 0; j < outcomeNames.length; j++) {
            const colIdx = 3 + j;
            const val = parseFloat(rows[i][colIdx] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          // Revenue is the last column
          const rev = parseFloat(rows[i][rows[i].length - 1] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Weekly from ${company.companyName}: ${e.message}`);
    }
  }

  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (parseSerialDate(existing[i][0]) === startDate) {
      existingRowIdx = i;
      break;
    }
  }

  const row = [startDate, endDate, ...combinedCounts, totalRevenue];

  if (existingRowIdx >= 0) {
    const sheetRow = existingRowIdx + 1;
    await writeSheet(summarySheetId, `'${tabName}'!A${sheetRow}`, [row]);
    console.log(`  Updated ${tabName} for ${startDate}`);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
    console.log(`  Appended ${tabName} for ${startDate}`);
  }
}

/**
 * Archive combined monthly data for one exec across all their companies.
 */
async function archiveSummaryMonthly(summarySheetId, execName, year, month) {
  const execMap = buildExecMap();
  const companies = execMap[execName];
  if (!companies || companies.length === 0) return;

  const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
  const tabName = `${execName} Monthly`;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Monthly`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === monthStr) {
          // Monthly layout: Month | Message | counts... | computed... | Revenue
          // Count columns start at index 2
          for (let j = 0; j < outcomeNames.length; j++) {
            const colIdx = 2 + j;
            const val = parseFloat(rows[i][colIdx] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          const rev = parseFloat(rows[i][rows[i].length - 1] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Monthly from ${company.companyName}: ${e.message}`);
    }
  }

  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === monthStr) {
      existingRowIdx = i;
      break;
    }
  }

  const row = [monthStr, ...combinedCounts, totalRevenue];

  if (existingRowIdx >= 0) {
    const sheetRow = existingRowIdx + 1;
    await writeSheet(summarySheetId, `'${tabName}'!A${sheetRow}`, [row]);
    console.log(`  Updated ${tabName} for ${monthStr}`);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
    console.log(`  Appended ${tabName} for ${monthStr}`);
  }
}

// ─── Backfill (Historical Data) ─────────────────────────────────────

/**
 * Backfill all storage tabs by reading every row from each company's
 * storage tabs and combining them by date.
 */
async function backfillSummary(summarySheetId) {
  const execMap = buildExecMap();

  for (const [execName, companies] of Object.entries(execMap)) {
    const outcomeNames = getOutcomeNames(companies[0].ownerName, companies[0].companyName);
    console.log(`\nBackfilling ${execName} (${companies.map(c => c.companyName).join(', ')})...`);

    await backfillDaily(summarySheetId, execName, companies, outcomeNames);
    await backfillWeekly(summarySheetId, execName, companies, outcomeNames);
    await backfillMonthly(summarySheetId, execName, companies, outcomeNames);
  }

  // Backfill Total tabs by reading back all exec storage tabs and summing
  console.log('\nBackfilling Total...');
  const firstCompany = Object.values(execMap)[0][0];
  const outcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);
  const execNames = Object.keys(execMap);
  await backfillTotalDaily(summarySheetId, execNames, outcomeNames);
  await backfillTotalWeekly(summarySheetId, execNames, outcomeNames);
  await backfillTotalMonthly(summarySheetId, execNames, outcomeNames);

  console.log('\nBackfill complete.');
}

async function backfillDaily(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} Daily`;

  // Collect all dates and their combined counts from all companies
  const dateMap = {}; // date -> { counts: [], revenue: number }

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Daily`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        const date = parseSerialDate(rows[i][0]);
        if (!date || date.length !== 10) continue; // skip invalid

        if (!dateMap[date]) {
          dateMap[date] = { counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }

        for (let j = 0; j < outcomeNames.length; j++) {
          const colIdx = 2 + (j * 2);
          const val = parseFloat(rows[i][colIdx] || '0');
          if (!isNaN(val)) dateMap[date].counts[j] += val;
        }
        const revIdx = 2 + (outcomeNames.length * 2);
        const rev = parseFloat(rows[i][revIdx] || '0');
        if (!isNaN(rev)) dateMap[date].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Daily from ${company.companyName}: ${e.message}`);
    }
  }

  // Sort dates and write
  const dates = Object.keys(dateMap).sort();
  if (dates.length === 0) {
    console.log(`  ${tabName}: No data found.`);
    return;
  }

  const header = ['Date'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const date of dates) {
    const d = dateMap[date];
    grid.push([date, ...d.counts, d.revenue]);
  }

  await clearRange(summarySheetId, `'${tabName}'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  ${tabName}: ${dates.length} days written.`);
}

async function backfillWeekly(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} Weekly`;

  const weekMap = {}; // startDate -> { endDate, counts, revenue }

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Weekly`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        const startDate = parseSerialDate(rows[i][0]);
        const endDate = parseSerialDate(rows[i][1]);
        if (!startDate || startDate.length !== 10) continue;

        if (!weekMap[startDate]) {
          weekMap[startDate] = { endDate, counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }

        for (let j = 0; j < outcomeNames.length; j++) {
          const colIdx = 3 + j;
          const val = parseFloat(rows[i][colIdx] || '0');
          if (!isNaN(val)) weekMap[startDate].counts[j] += val;
        }
        const rev = parseFloat(rows[i][rows[i].length - 1] || '0');
        if (!isNaN(rev)) weekMap[startDate].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Weekly from ${company.companyName}: ${e.message}`);
    }
  }

  const weeks = Object.keys(weekMap).sort();
  if (weeks.length === 0) {
    console.log(`  ${tabName}: No data found.`);
    return;
  }

  const header = ['Week Start', 'Week End'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const start of weeks) {
    const w = weekMap[start];
    grid.push([start, w.endDate, ...w.counts, w.revenue]);
  }

  await clearRange(summarySheetId, `'${tabName}'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  ${tabName}: ${weeks.length} weeks written.`);
}

async function backfillMonthly(summarySheetId, execName, companies, outcomeNames) {
  const tabName = `${execName} Monthly`;

  const monthMap = {}; // monthStr -> { counts, revenue }

  for (const company of companies) {
    try {
      const rows = await readTab(company.sheetId, `${execName} Monthly`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        const monthStr = rows[i][0];
        if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) continue;

        if (!monthMap[monthStr]) {
          monthMap[monthStr] = { counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }

        for (let j = 0; j < outcomeNames.length; j++) {
          const colIdx = 2 + j;
          const val = parseFloat(rows[i][colIdx] || '0');
          if (!isNaN(val)) monthMap[monthStr].counts[j] += val;
        }
        const rev = parseFloat(rows[i][rows[i].length - 1] || '0');
        if (!isNaN(rev)) monthMap[monthStr].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${execName} Monthly from ${company.companyName}: ${e.message}`);
    }
  }

  const months = Object.keys(monthMap).sort();
  if (months.length === 0) {
    console.log(`  ${tabName}: No data found.`);
    return;
  }

  const header = ['Month'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const m of months) {
    const d = monthMap[m];
    grid.push([m, ...d.counts, d.revenue]);
  }

  await clearRange(summarySheetId, `'${tabName}'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'${tabName}'!A1`, grid);
  console.log(`  ${tabName}: ${months.length} months written.`);
}

// ─── Total Storage Backfill ─────────────────────────────────────────

/**
 * Read back all exec summary Daily tabs and sum into Total Daily.
 */
async function backfillTotalDaily(summarySheetId, execNames, outcomeNames) {
  const dateMap = {};

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Daily`);
      if (rows.length < 2) continue;
      for (let i = 1; i < rows.length; i++) {
        const date = rows[i][0];
        if (!date || date.length !== 10) continue;
        if (!dateMap[date]) {
          dateMap[date] = { counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }
        for (let j = 0; j < outcomeNames.length; j++) {
          const val = parseFloat(rows[i][1 + j] || '0');
          if (!isNaN(val)) dateMap[date].counts[j] += val;
        }
        const rev = parseFloat(rows[i][1 + outcomeNames.length] || '0');
        if (!isNaN(rev)) dateMap[date].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${name} Daily from summary: ${e.message}`);
    }
  }

  const dates = Object.keys(dateMap).sort();
  if (dates.length === 0) { console.log('  Total Daily: No data.'); return; }

  const header = ['Date'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const date of dates) {
    const d = dateMap[date];
    grid.push([date, ...d.counts, d.revenue]);
  }

  await clearRange(summarySheetId, `'Total Daily'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'Total Daily'!A1`, grid);
  console.log(`  Total Daily: ${dates.length} days written.`);
}

async function backfillTotalWeekly(summarySheetId, execNames, outcomeNames) {
  const weekMap = {};

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Weekly`);
      if (rows.length < 2) continue;
      for (let i = 1; i < rows.length; i++) {
        const start = rows[i][0];
        const end = rows[i][1];
        if (!start || start.length !== 10) continue;
        if (!weekMap[start]) {
          weekMap[start] = { endDate: end, counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }
        for (let j = 0; j < outcomeNames.length; j++) {
          const val = parseFloat(rows[i][2 + j] || '0');
          if (!isNaN(val)) weekMap[start].counts[j] += val;
        }
        const rev = parseFloat(rows[i][2 + outcomeNames.length] || '0');
        if (!isNaN(rev)) weekMap[start].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${name} Weekly from summary: ${e.message}`);
    }
  }

  const weeks = Object.keys(weekMap).sort();
  if (weeks.length === 0) { console.log('  Total Weekly: No data.'); return; }

  const header = ['Week Start', 'Week End'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const start of weeks) {
    const w = weekMap[start];
    grid.push([start, w.endDate, ...w.counts, w.revenue]);
  }

  await clearRange(summarySheetId, `'Total Weekly'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'Total Weekly'!A1`, grid);
  console.log(`  Total Weekly: ${weeks.length} weeks written.`);
}

async function backfillTotalMonthly(summarySheetId, execNames, outcomeNames) {
  const monthMap = {};

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Monthly`);
      if (rows.length < 2) continue;
      for (let i = 1; i < rows.length; i++) {
        const monthStr = rows[i][0];
        if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) continue;
        if (!monthMap[monthStr]) {
          monthMap[monthStr] = { counts: new Array(outcomeNames.length).fill(0), revenue: 0 };
        }
        for (let j = 0; j < outcomeNames.length; j++) {
          const val = parseFloat(rows[i][1 + j] || '0');
          if (!isNaN(val)) monthMap[monthStr].counts[j] += val;
        }
        const rev = parseFloat(rows[i][1 + outcomeNames.length] || '0');
        if (!isNaN(rev)) monthMap[monthStr].revenue += rev;
      }
    } catch (e) {
      console.error(`  Could not read ${name} Monthly from summary: ${e.message}`);
    }
  }

  const months = Object.keys(monthMap).sort();
  if (months.length === 0) { console.log('  Total Monthly: No data.'); return; }

  const header = ['Month'];
  for (const name of outcomeNames) header.push(name);
  header.push('Total Revenue');

  const grid = [header];
  for (const m of months) {
    const d = monthMap[m];
    grid.push([m, ...d.counts, d.revenue]);
  }

  await clearRange(summarySheetId, `'Total Monthly'!A1:ZZ${grid.length + 1}`);
  await writeSheet(summarySheetId, `'Total Monthly'!A1`, grid);
  console.log(`  Total Monthly: ${months.length} months written.`);
}

// ─── Total Archive (for cron) ───────────────────────────────────────

/**
 * Archive Total daily by summing all exec summary Daily rows for the date.
 */
async function archiveSummaryTotalDaily(summarySheetId, date) {
  const execMap = buildExecMap();
  const execNames = Object.keys(execMap);
  const firstCompany = Object.values(execMap)[0][0];
  const outcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);

  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Daily`);
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === date) {
          for (let j = 0; j < outcomeNames.length; j++) {
            const val = parseFloat(rows[i][1 + j] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          const rev = parseFloat(rows[i][1 + outcomeNames.length] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) { /* skip */ }
  }

  const tabName = 'Total Daily';
  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === date) { existingRowIdx = i; break; }
  }

  const row = [date, ...combinedCounts, totalRevenue];
  if (existingRowIdx >= 0) {
    await writeSheet(summarySheetId, `'${tabName}'!A${existingRowIdx + 1}`, [row]);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
  }
  console.log(`  Updated Total Daily for ${date}`);
}

async function archiveSummaryTotalWeekly(summarySheetId, startDate, endDate) {
  const execMap = buildExecMap();
  const execNames = Object.keys(execMap);
  const firstCompany = Object.values(execMap)[0][0];
  const outcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);

  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Weekly`);
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === startDate) {
          for (let j = 0; j < outcomeNames.length; j++) {
            const val = parseFloat(rows[i][2 + j] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          const rev = parseFloat(rows[i][2 + outcomeNames.length] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) { /* skip */ }
  }

  const tabName = 'Total Weekly';
  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === startDate) { existingRowIdx = i; break; }
  }

  const row = [startDate, endDate, ...combinedCounts, totalRevenue];
  if (existingRowIdx >= 0) {
    await writeSheet(summarySheetId, `'${tabName}'!A${existingRowIdx + 1}`, [row]);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
  }
  console.log(`  Updated Total Weekly for ${startDate}`);
}

async function archiveSummaryTotalMonthly(summarySheetId, year, month) {
  const execMap = buildExecMap();
  const execNames = Object.keys(execMap);
  const firstCompany = Object.values(execMap)[0][0];
  const outcomeNames = getOutcomeNames(firstCompany.ownerName, firstCompany.companyName);
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const combinedCounts = new Array(outcomeNames.length).fill(0);
  let totalRevenue = 0;

  for (const name of execNames) {
    try {
      const rows = await readTab(summarySheetId, `${name} Monthly`);
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === monthStr) {
          for (let j = 0; j < outcomeNames.length; j++) {
            const val = parseFloat(rows[i][1 + j] || '0');
            if (!isNaN(val)) combinedCounts[j] += val;
          }
          const rev = parseFloat(rows[i][1 + outcomeNames.length] || '0');
          if (!isNaN(rev)) totalRevenue += rev;
          break;
        }
      }
    } catch (e) { /* skip */ }
  }

  const tabName = 'Total Monthly';
  const existing = await readTab(summarySheetId, tabName);
  let existingRowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === monthStr) { existingRowIdx = i; break; }
  }

  const row = [monthStr, ...combinedCounts, totalRevenue];
  if (existingRowIdx >= 0) {
    await writeSheet(summarySheetId, `'${tabName}'!A${existingRowIdx + 1}`, [row]);
  } else {
    await appendRows(summarySheetId, tabName, [row]);
  }
  console.log(`  Updated Total Monthly for ${monthStr}`);
}

module.exports = {
  createSummarySheet,
  populateSummaryFormulas,
  writeStorageHeaders,
  buildExecMap,
  archiveSummaryDaily,
  archiveSummaryWeekly,
  archiveSummaryMonthly,
  archiveSummaryTotalDaily,
  archiveSummaryTotalWeekly,
  archiveSummaryTotalMonthly,
  backfillSummary,
};
