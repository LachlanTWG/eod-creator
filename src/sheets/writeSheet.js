const { getSheetsClient } = require('../auth');

/**
 * Write values to a Google Sheet range (overwrites).
 * @param {string} spreadsheetId
 * @param {string} range - e.g. "Settings!A1:C10"
 * @param {string[][]} values
 */
async function writeSheet(spreadsheetId, range, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

/**
 * Append rows to a Google Sheet tab.
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @param {string[][]} rows
 */
async function appendRows(spreadsheetId, tabName, rows, raw = false) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: raw ? 'RAW' : 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/**
 * Clear a range in a Google Sheet.
 * @param {string} spreadsheetId
 * @param {string} range
 */
async function clearRange(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });
}

/**
 * Batch update (for adding tabs, formatting, etc.)
 * @param {string} spreadsheetId
 * @param {object[]} requests - Array of request objects
 */
async function batchUpdate(spreadsheetId, requests) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return res.data;
}

module.exports = { writeSheet, appendRows, clearRange, batchUpdate };
