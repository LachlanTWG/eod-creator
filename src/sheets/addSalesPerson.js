const { getSheetsClient } = require('../auth');
const { writeSheet, batchUpdate } = require('./writeSheet');
const { readSheet, getSpreadsheetMeta } = require('./readSheet');
const { getDailyStorageHeaders, getWeeklyStorageHeaders } = require('./createCompanySheet');
const fs = require('fs');
const path = require('path');

/**
 * Add a new sales person to an existing company sheet.
 * Creates their EOD, Daily, EOW, Weekly tabs and registers them in Settings.
 */
async function addSalesPerson(spreadsheetId, personName, companyName) {
  const sheets = await getSheetsClient();
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const existingTabs = meta.sheets.map(s => s.properties.title);

  // Check if tabs already exist
  if (existingTabs.includes(`${personName} EOD`)) {
    console.log(`Tabs for "${personName}" already exist.`);
    return;
  }

  // Find the next available sheetId
  const maxId = Math.max(...meta.sheets.map(s => s.properties.sheetId));

  // Get ownerName from companies config
  const { loadCompanies: loadCo, saveCompanies } = require('../config/companiesStore');
  const companiesData = loadCo();
  const company = companiesData.companies.find(c =>
    c.sheetId === spreadsheetId || c.name === companyName
  );
  const ownerName = company?.ownerName || 'Owner';

  // Create the 4 new tabs
  const newTabs = [
    `${personName} EOD`,
    `${personName} Daily`,
    `${personName} EOW`,
    `${personName} Weekly`,
  ];

  const addSheetRequests = newTabs.map((title, i) => ({
    addSheet: { properties: { sheetId: maxId + i + 1, title } }
  }));
  await batchUpdate(spreadsheetId, addSheetRequests);

  // Populate tab content
  await writeSheet(spreadsheetId, `'${personName} EOD'!A1`, [
    ['Sales Person', personName],
    ['Date Mode', 'today'],
    ['Manual Date', ''],
    ['Last Generated', ''],
  ]);

  const dailyHeaders = getDailyStorageHeaders(ownerName);
  await writeSheet(spreadsheetId, `'${personName} Daily'!A1`, [dailyHeaders]);

  await writeSheet(spreadsheetId, `'${personName} EOW'!A1`, [
    ['Sales Person', personName],
    ['Week Start', ''],
    ['Week End', ''],
    ['Last Generated', ''],
  ]);

  const weeklyHeaders = getWeeklyStorageHeaders(ownerName);
  await writeSheet(spreadsheetId, `'${personName} Weekly'!A1`, [weeklyHeaders]);

  // Add to Settings sales person registry
  const settingsData = await readSheet(spreadsheetId, "'Settings'!M:O");
  const nextRow = settingsData.length + 1;
  const today = new Date().toISOString().split('T')[0];
  await writeSheet(spreadsheetId, `'Settings'!M${nextRow}:O${nextRow}`, [
    [personName, 'TRUE', today]
  ]);

  // Update companies.json
  if (company) {
    company.salesPeople.push({ name: personName, active: true, startDate: today });
    saveCompanies(companiesData);
  }

  console.log(`Added sales person "${personName}" to sheet.`);
}

module.exports = { addSalesPerson };
