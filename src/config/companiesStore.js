const fs = require('fs');
const path = require('path');

const COMPANIES_PATH = path.join(__dirname, 'companies.json');

/**
 * Load companies config.
 * On Railway: reads from COMPANIES_JSON env var.
 * Locally: reads from companies.json file.
 */
function loadCompanies() {
  if (process.env.COMPANIES_JSON) {
    return JSON.parse(process.env.COMPANIES_JSON);
  }
  return JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf8'));
}

/**
 * Save companies config back to file.
 * Only works locally (not on Railway).
 */
function saveCompanies(data) {
  fs.writeFileSync(COMPANIES_PATH, JSON.stringify(data, null, 2) + '\n');
}

module.exports = { loadCompanies, saveCompanies, COMPANIES_PATH };
