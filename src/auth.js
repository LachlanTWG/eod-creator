require('dotenv').config();
const { google } = require('googleapis');

let sheetsClient = null;

async function getAuthClient() {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const key = rawKey.replace(/\\n/g, '\n');
  console.log(`[AUTH] Key length: ${rawKey.length}, starts: ${rawKey.substring(0, 30)}, has literal \\n: ${rawKey.includes('\\n')}, has real newlines: ${rawKey.includes('\n') && !rawKey.includes('\\n')}`);
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: key,
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return auth;
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = await getAuthClient();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

module.exports = { getAuthClient, getSheetsClient };
