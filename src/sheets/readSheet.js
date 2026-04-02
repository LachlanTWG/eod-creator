const { getSheetsClient } = require('../auth');

/**
 * Read values from a Google Sheet range.
 * @param {string} spreadsheetId
 * @param {string} range - e.g. "Activity Log!A1:K100"
 * @returns {Promise<string[][]>} rows of values
 */
async function readSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return res.data.values || [];
}

/**
 * Read all values from a named tab.
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @returns {Promise<string[][]>}
 */
async function readTab(spreadsheetId, tabName) {
  return readSheet(spreadsheetId, `'${tabName}'`);
}

/**
 * Get spreadsheet metadata (tab names, properties, etc.)
 * @param {string} spreadsheetId
 * @returns {Promise<object>}
 */
async function getSpreadsheetMeta(spreadsheetId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  return res.data;
}

module.exports = { readSheet, readTab, getSpreadsheetMeta };
