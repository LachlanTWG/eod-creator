const { getSheetsClient } = require('../auth');
const { writeSheet, batchUpdate } = require('./writeSheet');
const { loadConfig } = require('../config/configLoader');
const fs = require('fs');
const path = require('path');

const ACTIVITY_LOG_HEADERS = [
  'Date', 'Sales Person', 'Contact Name', 'Event Type', 'Outcome',
  'Ad Source', 'Quote/Job Value', 'Contact Address', 'Contact ID',
  'Appointment Date Time', 'Appointment Date'
];

function getOutcomeNames(ownerName, companyName) {
  const { outcomes } = loadConfig(companyName);
  return outcomes.outcomes.map(o => o.name.replace('{owner}', ownerName));
}

function getDailyStorageHeaders(ownerName, companyName) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const headers = ['Date', 'EOD Message'];
  for (const name of outcomeNames) {
    headers.push(`${name} - Count`);
    headers.push(`${name} - Names`);
  }
  return headers;
}

function getWeeklyStorageHeaders(ownerName, companyName) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const { blocks } = loadConfig(companyName);
  const headers = ['Week Start', 'Week End', 'EOW Message'];
  for (const name of outcomeNames) {
    headers.push(`${name} - Count`);
  }
  // Efficiency rate headers from eowBlocks computed entries
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (computedBlock) {
    for (const rate of computedBlock.computed) {
      headers.push(`${rate.name} %`);
    }
  }
  return headers;
}

function getMonthlyStorageHeaders(ownerName, companyName) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const { blocks } = loadConfig(companyName);
  const headers = ['Month', 'EOM Message'];
  for (const name of outcomeNames) {
    headers.push(`${name} - Count`);
  }
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (computedBlock) {
    for (const rate of computedBlock.computed) {
      headers.push(`${rate.name} %`);
    }
  }
  return headers;
}

function getQuarterlyStorageHeaders(ownerName, companyName) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const { blocks } = loadConfig(companyName);
  const headers = ['Quarter', 'EOQ Message'];
  for (const name of outcomeNames) {
    headers.push(`${name} - Count`);
  }
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (computedBlock) {
    for (const rate of computedBlock.computed) {
      headers.push(`${rate.name} %`);
    }
  }
  return headers;
}

function getYearlyStorageHeaders(ownerName, companyName) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const { blocks } = loadConfig(companyName);
  const headers = ['Year', 'EOY Message'];
  for (const name of outcomeNames) {
    headers.push(`${name} - Count`);
  }
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (computedBlock) {
    for (const rate of computedBlock.computed) {
      headers.push(`${rate.name} %`);
    }
  }
  return headers;
}

function buildSettingsData(ownerName, salesPeople, companyName) {
  const { outcomes, blocks, formulas } = loadConfig(companyName);
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const rows = [];

  rows.push([
    'Outcome Name', 'Count Header', 'Names Header', 'Flattened Header',
    'EOD Block', 'EOW Block', 'EOD Formula Type', 'EOW Formula Type',
    '', '', '', '',
    'Sales Person Name', 'Active', 'Start Date'
  ]);

  const eodBlockMap = {};
  for (const block of blocks.eodBlocks) {
    for (const o of block.outcomes) {
      eodBlockMap[o] = block.name;
    }
  }
  const eowBlockMap = {};
  for (const block of blocks.eowBlocks) {
    if (block.outcomes) {
      for (const o of block.outcomes) {
        eowBlockMap[o] = block.name;
      }
    }
  }

  for (let i = 0; i < outcomeNames.length; i++) {
    const name = outcomeNames[i];
    const templateName = outcomes.outcomes[i].name;
    const formulaEntry = formulas.outcomeFormulas[templateName] || { eod: 1, eow: 1 };
    const eodBlock = eodBlockMap[templateName] || '';
    const eowBlock = eowBlockMap[templateName] || '';

    const row = [
      name,
      `${name} - Count`,
      `${name} - Names`,
      name,
      eodBlock.replace('{owner}', ownerName),
      eowBlock.replace('{owner}', ownerName),
      String(formulaEntry.eod),
      String(formulaEntry.eow),
      '', '', '', ''
    ];

    if (i < salesPeople.length) {
      row.push(salesPeople[i].name, String(salesPeople[i].active), salesPeople[i].startDate);
    }

    rows.push(row);
  }

  return rows;
}

function buildFormulasTabData(companyName) {
  const { formulas } = loadConfig(companyName);
  const rows = [['Type ID', 'Name', 'Description', 'EOD Format', 'EOW Format']];
  for (const [id, ft] of Object.entries(formulas.formulaTypes)) {
    rows.push([id, ft.name, ft.description || '', ft.eodFormat || '', ft.eowFormat || '']);
  }
  return rows;
}

/**
 * Create a new Google Sheet for a company with all tabs configured.
 * @param {string} companyName
 * @param {string} ownerName
 * @param {Array<{name: string, active: boolean, startDate: string}>} salesPeople
 * @returns {Promise<string>} spreadsheetId
 */
async function createCompanySheet(companyName, ownerName, salesPeople, existingSheetId) {
  const sheets = await getSheetsClient();

  let spreadsheetId;

  // Build list of all tab names
  const tabNames = ['Settings', 'Formulas', 'Activity Log'];
  for (const person of salesPeople) {
    tabNames.push(`${person.name} EOD`, `${person.name} Daily`);
    tabNames.push(`${person.name} EOW`, `${person.name} Weekly`);
    tabNames.push(`${person.name} Monthly`, `${person.name} Quarterly`, `${person.name} Yearly`);
  }
  tabNames.push('Team EOD', 'Team Daily', 'Team EOW', 'Team Weekly');
  tabNames.push('Team Monthly', 'Team Quarterly', 'Team Yearly', 'Site Visits');

  if (existingSheetId) {
    // Use existing spreadsheet — add tabs to it
    spreadsheetId = existingSheetId;
    console.log(`Using existing spreadsheet: ${spreadsheetId}`);

    // Get existing tabs
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });
    const existingTabs = meta.data.sheets.map(s => s.properties.title);
    const maxId = Math.max(...meta.data.sheets.map(s => s.properties.sheetId));

    // Add missing tabs
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

    // Rename the spreadsheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ updateSpreadsheetProperties: {
          properties: { title: `${companyName} - EOD Reporting` },
          fields: 'title'
        }}]
      }
    });
  } else {
    // Create a brand new spreadsheet
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `${companyName} - EOD Reporting` },
        sheets: tabNames.map((title, i) => ({
          properties: { sheetId: i, title, index: i }
        }))
      }
    });
    spreadsheetId = createRes.data.spreadsheetId;
    console.log(`Created spreadsheet: ${spreadsheetId}`);
  }

  // Populate Settings tab
  const settingsData = buildSettingsData(ownerName, salesPeople, companyName);
  await writeSheet(spreadsheetId, "'Settings'!A1", settingsData);

  // Populate Formulas tab
  const formulasData = buildFormulasTabData(companyName);
  await writeSheet(spreadsheetId, "'Formulas'!A1", formulasData);

  // Activity Log headers
  await writeSheet(spreadsheetId, "'Activity Log'!A1", [ACTIVITY_LOG_HEADERS]);

  // Per-person tab headers
  const dailyHeaders = getDailyStorageHeaders(ownerName, companyName);
  const weeklyHeaders = getWeeklyStorageHeaders(ownerName, companyName);
  const monthlyHeaders = getMonthlyStorageHeaders(ownerName, companyName);
  const quarterlyHeaders = getQuarterlyStorageHeaders(ownerName, companyName);
  const yearlyHeaders = getYearlyStorageHeaders(ownerName, companyName);

  for (const person of salesPeople) {
    // EOD tab — config area
    await writeSheet(spreadsheetId, `'${person.name} EOD'!A1`, [
      ['Sales Person', person.name],
      ['Date Mode', 'today'],
      ['Manual Date', ''],
      ['Last Generated', ''],
    ]);

    // Daily storage headers
    await writeSheet(spreadsheetId, `'${person.name} Daily'!A1`, [dailyHeaders]);

    // EOW tab — config area
    await writeSheet(spreadsheetId, `'${person.name} EOW'!A1`, [
      ['Sales Person', person.name],
      ['Week Start', ''],
      ['Week End', ''],
      ['Last Generated', ''],
    ]);

    // Weekly storage headers
    await writeSheet(spreadsheetId, `'${person.name} Weekly'!A1`, [weeklyHeaders]);

    // Monthly storage headers
    await writeSheet(spreadsheetId, `'${person.name} Monthly'!A1`, [monthlyHeaders]);

    // Quarterly storage headers
    await writeSheet(spreadsheetId, `'${person.name} Quarterly'!A1`, [quarterlyHeaders]);

    // Yearly storage headers
    await writeSheet(spreadsheetId, `'${person.name} Yearly'!A1`, [yearlyHeaders]);
  }

  // Team tabs
  await writeSheet(spreadsheetId, "'Team EOD'!A1", [
    ['Date Mode', 'today'],
    ['Manual Date', ''],
    ['Last Generated', ''],
  ]);
  await writeSheet(spreadsheetId, "'Team Daily'!A1", [dailyHeaders]);
  await writeSheet(spreadsheetId, "'Team EOW'!A1", [
    ['Week Start', ''],
    ['Week End', ''],
    ['Last Generated', ''],
  ]);
  await writeSheet(spreadsheetId, "'Team Weekly'!A1", [weeklyHeaders]);
  await writeSheet(spreadsheetId, "'Team Monthly'!A1", [monthlyHeaders]);
  await writeSheet(spreadsheetId, "'Team Quarterly'!A1", [quarterlyHeaders]);
  await writeSheet(spreadsheetId, "'Team Yearly'!A1", [yearlyHeaders]);

  // Site Visits tab
  await writeSheet(spreadsheetId, "'Site Visits'!A1", [
    ['Contact Name', 'Address', 'Date/Time', 'Sales Person', 'Status']
  ]);

  // Update companies.json
  const { loadCompanies: loadCo, saveCompanies } = require('../config/companiesStore');
  const companiesData = loadCo();
  const existing = companiesData.companies.find(c => c.name === companyName);
  if (existing) {
    existing.sheetId = spreadsheetId;
    existing.ownerName = ownerName;
    existing.salesPeople = salesPeople;
  } else {
    companiesData.companies.push({
      name: companyName,
      sheetId: spreadsheetId,
      ownerName: ownerName,
      ghlLocationId: '',
      salesPeople: salesPeople,
    });
  }
  saveCompanies(companiesData);

  console.log(`Company "${companyName}" sheet fully configured with ${salesPeople.length} sales people.`);
  return spreadsheetId;
}

module.exports = { createCompanySheet, getDailyStorageHeaders, getWeeklyStorageHeaders, getMonthlyStorageHeaders, getQuarterlyStorageHeaders, getYearlyStorageHeaders, getOutcomeNames, ACTIVITY_LOG_HEADERS };
