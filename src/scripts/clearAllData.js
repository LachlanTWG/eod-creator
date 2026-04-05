require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { clearRange } = require('../sheets/writeSheet');
const { loadCompanies } = require('../config/companiesStore');

async function clearCompany(company) {
  if (!company.sheetId) {
    console.log(`Skipping ${company.name} — no sheet ID.`);
    return;
  }

  console.log(`\nClearing ${company.name}...`);
  const sheetId = company.sheetId;

  // Clear Activity Log (keep header row 1)
  await clearRange(sheetId, "'Activity Log'!A2:K");
  console.log(`  Activity Log cleared.`);

  // Clear per-person storage tabs
  for (const person of company.salesPeople) {
    const tabs = [
      `${person.name} Daily`,
      `${person.name} Weekly`,
      `${person.name} Monthly`,
      `${person.name} Yearly`,
    ];
    for (const tab of tabs) {
      try {
        await clearRange(sheetId, `'${tab}'!A2:Z`);
      } catch (e) {
        console.log(`  Skipped ${tab} (${e.message})`);
      }
    }
    console.log(`  ${person.name} storage tabs cleared.`);
  }

  // Clear Team storage tabs
  const teamTabs = ['Team Daily', 'Team Weekly', 'Team Monthly', 'Team Yearly'];
  for (const tab of teamTabs) {
    try {
      await clearRange(sheetId, `'${tab}'!A2:Z`);
    } catch (e) {
      console.log(`  Skipped ${tab} (${e.message})`);
    }
  }
  console.log(`  Team storage tabs cleared.`);

  // Clear Site Visits (keep header)
  try {
    await clearRange(sheetId, "'Site Visits'!A2:E");
  } catch (e) {
    console.log(`  Skipped Site Visits (${e.message})`);
  }

  console.log(`  ${company.name} — DONE`);
}

async function main() {
  const { companies } = loadCompanies();
  const targetCompany = process.argv[2];

  for (const company of companies) {
    if (targetCompany && company.name.toLowerCase() !== targetCompany.toLowerCase()) continue;
    try {
      await clearCompany(company);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`Error clearing ${company.name}: ${err.message}`);
    }
  }

  console.log('\n=== All data cleared ===');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
