const { appendRows } = require('./writeSheet');

/**
 * Append an activity row to the Activity Log tab.
 * @param {string} spreadsheetId
 * @param {object} data
 * @param {string} data.date - YYYY-MM-DD
 * @param {string} data.salesPerson
 * @param {string} data.contactName
 * @param {string} data.eventType - "EOD Update", "Quote Sent", "Site Visit Booked", "Job Won"
 * @param {string} data.outcome - Pipe-delimited outcome string
 * @param {string} [data.adSource]
 * @param {string} [data.quoteJobValue]
 * @param {string} [data.contactAddress]
 * @param {string} [data.contactId]
 * @param {string} [data.appointmentDateTime]
 * @param {string} [data.appointmentDate]
 */
async function logActivity(spreadsheetId, data) {
  const row = [
    data.date,
    data.salesPerson,
    data.contactName || '',
    data.eventType || 'EOD Update',
    data.outcome || '',
    data.adSource || '',
    data.quoteJobValue || '',
    data.contactAddress || '',
    data.contactId || '',
    data.appointmentDateTime || '',
    data.appointmentDate || '',
  ];
  await appendRows(spreadsheetId, 'Activity Log', [row], true);
}

/**
 * Log multiple activity rows at once.
 */
async function logActivities(spreadsheetId, dataArray) {
  const rows = dataArray.map(data => [
    data.date,
    data.salesPerson,
    data.contactName || '',
    data.eventType || 'EOD Update',
    data.outcome || '',
    data.adSource || '',
    data.quoteJobValue || '',
    data.contactAddress || '',
    data.contactId || '',
    data.appointmentDateTime || '',
    data.appointmentDate || '',
  ]);
  await appendRows(spreadsheetId, 'Activity Log', rows, true);
}

module.exports = { logActivity, logActivities };
