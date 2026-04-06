require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { generateEOD } = require('./reporting/generateEOD');
const { archiveDaily } = require('./reporting/archiveDaily');
const { generateEOW } = require('./reporting/generateEOW');
const { archiveWeekly } = require('./reporting/archiveWeekly');
const { generateEOM } = require('./reporting/generateEOM');
const { archiveMonthly } = require('./reporting/archiveMonthly');
const { generateEOQ } = require('./reporting/generateEOQ');
const { archiveQuarterly } = require('./reporting/archiveQuarterly');
const { generateEOY } = require('./reporting/generateEOY');
const { archiveYearly } = require('./reporting/archiveYearly');
const { generateMeetingDoc } = require('./reporting/generateMeetingDoc');
const { sendReportToSlack } = require('./integrations/slack');
const { sendReportToClickUp, createMeetingDocPage } = require('./integrations/clickup');

const { readTab } = require('./sheets/readSheet');
const { loadCompanies } = require('./config/companiesStore');

/**
 * Get today's date in a specific timezone.
 */
function todayInTz(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function getSundayOfWeek(dateStr) {
  const monday = getMondayOfWeek(dateStr);
  const d = new Date(monday + 'T12:00:00Z');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

// ─── Single-Company Runners ──────────────────────────────────────────
// These operate on ONE company. The scheduler calls them per-company
// at the right time for that company's timezone.

/**
 * Send EOD for one company (5:30pm) — generate + send to Slack/ClickUp, NO archive.
 */
async function sendCompanyEOD(company, targetDate) {
  const tz = company.timezone || 'Australia/Sydney';
  const date = targetDate || todayInTz(tz);
  console.log(`[SEND EOD] ${company.name} — ${date}`);

  // Read Activity Log ONCE for all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOD(
        company.sheetId, person.name, date, company.name, company.ownerName, activityData
      );
      await sendReportToSlack(company, 'eod', message).catch(e =>
        console.error(`  Slack error (${person.name}): ${e.message}`)
      );
      const title = `EOD - ${person.name} - ${date}`;
      await sendReportToClickUp(company, 'eod', title, message, person.name).catch(e =>
        console.error(`  ClickUp error (${person.name}): ${e.message}`)
      );
      console.log(`  ${person.name}: Sent.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team daily — generate only (no Slack; individual reports suffice)
  try {
    await generateEOD(
      company.sheetId, 'Team', date, company.name, company.ownerName, activityData
    );
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Archive EOD for one company (11:55pm) — generate final + archive to sheets.
 */
async function archiveCompanyEOD(company, targetDate) {
  const tz = company.timezone || 'Australia/Sydney';
  const date = targetDate || todayInTz(tz);
  console.log(`[ARCHIVE EOD] ${company.name} — ${date}`);

  // Read Activity Log ONCE for all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts, names } = await generateEOD(
        company.sheetId, person.name, date, company.name, company.ownerName, activityData
      );
      await archiveDaily(company.sheetId, person.name, date, message, counts || {}, names || {}, company.ownerName, company.name);
      console.log(`  ${person.name}: Archived.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team archive
  try {
    const { message, counts, names } = await generateEOD(
      company.sheetId, 'Team', date, company.name, company.ownerName, activityData
    );
    await archiveDaily(company.sheetId, 'Team', date, message, counts || {}, names || {}, company.ownerName, company.name);
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Send EOW for one company (Friday 5:30pm).
 */
async function sendCompanyEOW(company, startDate, endDate) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const start = startDate || getMondayOfWeek(today);
  const end = endDate || getSundayOfWeek(today);
  console.log(`[SEND EOW] ${company.name} — ${start} to ${end}`);

  // Read Activity Log ONCE for job/site visit details across all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOW(
        company.sheetId, person.name, start, end, company.name, company.ownerName, activityData
      );

      await sendReportToSlack(company, 'eow', message).catch(e =>
        console.error(`  Slack error: ${e.message}`)
      );
      const title = `EOW - ${person.name} - ${start} to ${end}`;
      await sendReportToClickUp(company, 'eow', title, message, person.name).catch(e =>
        console.error(`  ClickUp error: ${e.message}`)
      );
      console.log(`  ${person.name}: Sent.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team send
  try {
    const { message, counts } = await generateEOW(
      company.sheetId, 'Team', start, end, company.name, company.ownerName, activityData
    );
    await sendReportToSlack(company, 'eow', message).catch(() => {});
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Archive EOW for one company (Friday 11:55pm).
 */
async function archiveCompanyEOW(company, startDate, endDate) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const start = startDate || getMondayOfWeek(today);
  const end = endDate || getSundayOfWeek(today);
  console.log(`[ARCHIVE EOW] ${company.name} — ${start} to ${end}`);

  // Read Activity Log ONCE for all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOW(
        company.sheetId, person.name, start, end, company.name, company.ownerName, activityData
      );
      await archiveWeekly(company.sheetId, person.name, start, end, message, counts || {}, {}, company.ownerName, company.name);
      console.log(`  ${person.name}: Archived.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team archive
  try {
    const { message, counts } = await generateEOW(
      company.sheetId, 'Team', start, end, company.name, company.ownerName, activityData
    );
    await archiveWeekly(company.sheetId, 'Team', start, end, message, counts || {}, {}, company.ownerName, company.name);
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Run EOM for one company (send + archive).
 */
async function runCompanyEOM(company, year, month) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const y = year || parseInt(today.split('-')[0]);
  const todayDay = parseInt(today.split('-')[2]);
  const m = month || (todayDay <= 3 ? (parseInt(today.split('-')[1]) - 1 || 12) : parseInt(today.split('-')[1]));
  const actualYear = (!month && todayDay <= 3 && m === 12) ? y - 1 : y;

  console.log(`[EOM] ${company.name} — ${actualYear}-${String(m).padStart(2, '0')}`);

  // Read Activity Log ONCE for all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOM(
        company.sheetId, person.name, actualYear, m, company.name, company.ownerName, activityData
      );
      if (!counts || Object.keys(counts).length === 0) continue;

      await archiveMonthly(company.sheetId, person.name, actualYear, m, message, counts, {}, company.ownerName, company.name);
      await sendReportToSlack(company, 'eom', message).catch(e =>
        console.error(`  Slack error: ${e.message}`)
      );
      const title = `EOM - ${person.name} - ${actualYear}-${String(m).padStart(2, '0')}`;
      await sendReportToClickUp(company, 'eom', title, message, person.name).catch(e =>
        console.error(`  ClickUp error: ${e.message}`)
      );
      console.log(`  ${person.name}: Done.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team EOM
  try {
    const { message, counts } = await generateEOM(
      company.sheetId, 'Team', actualYear, m, company.name, company.ownerName, activityData
    );
    if (counts && Object.keys(counts).length > 0) {
      await archiveMonthly(company.sheetId, 'Team', actualYear, m, message, counts, {}, company.ownerName, company.name);
      await sendReportToSlack(company, 'eom', message).catch(() => {});
    }
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Run EOQ for one company (send + archive).
 */
async function runCompanyEOQ(company, year, quarter) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const y = year || parseInt(today.split('-')[0]);
  const todayMonth = parseInt(today.split('-')[1]);
  const todayDay = parseInt(today.split('-')[2]);
  // If no quarter specified, figure out the previous quarter
  // (EOQ runs on 1st day of new quarter, so report the one that just ended)
  const q = quarter || (todayDay <= 3 ? Math.ceil(todayMonth / 3) - 1 || 4 : Math.ceil(todayMonth / 3));
  const actualYear = (!quarter && todayDay <= 3 && q === 4) ? y - 1 : y;

  console.log(`[EOQ] ${company.name} — ${actualYear}-Q${q}`);

  // Read Activity Log ONCE for all people
  const activityData = await readTab(company.sheetId, 'Activity Log');

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOQ(
        company.sheetId, person.name, actualYear, q, company.name, company.ownerName, activityData
      );
      if (!counts || Object.keys(counts).length === 0) continue;

      await archiveQuarterly(company.sheetId, person.name, actualYear, q, message, counts, company.ownerName, company.name);
      await sendReportToSlack(company, 'eoq', message).catch(e =>
        console.error(`  Slack error: ${e.message}`)
      );
      const title = `EOQ - ${person.name} - ${actualYear}-Q${q}`;
      await sendReportToClickUp(company, 'eoq', title, message, person.name).catch(e =>
        console.error(`  ClickUp error: ${e.message}`)
      );
      console.log(`  ${person.name}: Done.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team EOQ
  try {
    const { message, counts } = await generateEOQ(
      company.sheetId, 'Team', actualYear, q, company.name, company.ownerName, activityData
    );
    if (counts && Object.keys(counts).length > 0) {
      await archiveQuarterly(company.sheetId, 'Team', actualYear, q, message, counts, company.ownerName, company.name);
      await sendReportToSlack(company, 'eoq', message).catch(() => {});
    }
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Run EOY for one company (send + archive).
 */
async function runCompanyEOY(company, year) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const y = year || parseInt(today.split('-')[0]) - 1;

  console.log(`[EOY] ${company.name} — ${y}`);

  const activePeople = company.salesPeople.filter(p => p.active);

  for (const person of activePeople) {
    try {
      const { message, counts } = await generateEOY(
        company.sheetId, person.name, y, company.name, company.ownerName
      );
      if (!counts || Object.keys(counts).length === 0) continue;

      await archiveYearly(company.sheetId, person.name, y, message, counts, {}, company.ownerName, company.name);
      await sendReportToSlack(company, 'eoy', message).catch(e =>
        console.error(`  Slack error: ${e.message}`)
      );
      const title = `EOY - ${person.name} - ${y}`;
      await sendReportToClickUp(company, 'eoy', title, message, person.name).catch(e =>
        console.error(`  ClickUp error: ${e.message}`)
      );
      console.log(`  ${person.name}: Done.`);
    } catch (err) {
      console.error(`  ${person.name}: ${err.message}`);
    }
  }

  // Team EOY
  try {
    const { message, counts } = await generateEOY(
      company.sheetId, 'Team', y, company.name, company.ownerName
    );
    if (counts && Object.keys(counts).length > 0) {
      await archiveYearly(company.sheetId, 'Team', y, message, counts, {}, company.ownerName, company.name);
      await sendReportToSlack(company, 'eoy', message).catch(() => {});
    }
  } catch (err) {
    console.error(`  Team: ${err.message}`);
  }
}

/**
 * Send daily site visit notification for one company (7am).
 * Shows today's visits + upcoming visits (next 7 days).
 */
async function sendSiteVisitNotification(company) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  console.log(`[SITE VISITS] ${company.name} — ${today}`);

  const siteVisitData = await readTab(company.sheetId, 'Site Visits');
  if (siteVisitData.length < 2) {
    console.log(`  No site visit data found.`);
    return;
  }

  const headers = siteVisitData[0];
  const nameIdx = headers.indexOf('Contact Name');
  const addressIdx = headers.indexOf('Address');
  const dtIdx = headers.indexOf('Date/Time');
  const spIdx = headers.indexOf('Sales Person');

  // Parse today and +7 day boundary
  const todayDate = new Date(today + 'T00:00:00');
  const next7 = new Date(todayDate);
  next7.setDate(next7.getDate() + 7);

  const todayVisits = [];
  const upcomingVisits = [];  // next 7 days (excl today)
  const beyondVisits = [];    // after 7 days

  for (let i = 1; i < siteVisitData.length; i++) {
    const row = siteVisitData[i];
    const dtStr = (row[dtIdx] || '').trim();
    if (!dtStr) continue;

    const visitDate = new Date(dtStr);
    if (isNaN(visitDate.getTime())) continue;

    const visitDateOnly = visitDate.toLocaleDateString('en-CA', { timeZone: tz });
    const entry = {
      contactName: (row[nameIdx] || '').trim(),
      address: (row[addressIdx] || '').trim(),
      datetime: dtStr,
      salesPerson: (row[spIdx] || '').trim(),
    };

    if (visitDateOnly === today) {
      todayVisits.push(entry);
    } else if (visitDate > todayDate && visitDate <= next7) {
      upcomingVisits.push(entry);
    } else if (visitDate > next7) {
      beyondVisits.push(entry);
    }
  }

  // Build message
  const lines = [];
  lines.push(`*Site Visits — ${formatNotificationDate(today)}*`);
  lines.push('');

  if (todayVisits.length > 0) {
    lines.push(`*Today's Site Visits (${todayVisits.length}):*`);
    for (const sv of todayVisits) {
      const dt = formatVisitTime(sv.datetime);
      lines.push(`- ${sv.contactName} - ${sv.address || 'TBC'} - ${dt || 'TBC'} (${sv.salesPerson})`);
    }
  } else {
    lines.push('*Today\'s Site Visits:* No site visits booked for today');
  }

  lines.push('');

  if (upcomingVisits.length > 0) {
    lines.push(`*Upcoming Site Visits (Next 7 Days):*`);
    upcomingVisits.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    for (const sv of upcomingVisits) {
      const dt = formatVisitDateTimeFull(sv.datetime);
      lines.push(`- ${sv.contactName} - ${sv.address || 'TBC'} - ${dt || 'TBC'} (${sv.salesPerson})`);
    }
  } else {
    lines.push('*Upcoming Site Visits (Next 7 Days):* Nothing booked for the week ahead');
  }

  // Only show beyond-7-day visits if there are any
  if (beyondVisits.length > 0) {
    lines.push('');
    lines.push(`*Later (${beyondVisits.length} visit${beyondVisits.length === 1 ? '' : 's'} scheduled beyond 7 days)*`);
  }

  const message = lines.join('\n');
  await sendReportToSlack(company, 'site-visits', message, { username: 'Site Visit Schedule', icon_emoji: ':round_pushpin:' });
  console.log(`  Sent site visit notification.`);
}

/**
 * Format date for notification header: "Monday 06 Apr"
 */
function formatNotificationDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]}`;
}

/**
 * Format time only for today's visits: "9:00am"
 */
function formatVisitTime(datetimeStr) {
  if (!datetimeStr) return '';
  try {
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) return datetimeStr;
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    return `${hours}:${mins}${ampm}`;
  } catch {
    return datetimeStr;
  }
}

/**
 * Format full date+time for upcoming visits: "Fri 06 Feb 9:00am"
 */
function formatVisitDateTimeFull(datetimeStr) {
  if (!datetimeStr) return '';
  try {
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) return datetimeStr;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${hours}:${mins}${ampm}`;
  } catch {
    return datetimeStr;
  }
}

// ─── "Run All" Wrappers (for CLI / webhooks) ────────────────────────

async function runAllEOD(targetDate, mode = 'both') {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    if (mode === 'send' || mode === 'both') await sendCompanyEOD(company, targetDate);
    if (mode === 'archive' || mode === 'both') await archiveCompanyEOD(company, targetDate);
  }
}

async function runAllEOW(startDate, endDate, mode = 'both') {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    if (mode === 'send' || mode === 'both') await sendCompanyEOW(company, startDate, endDate);
    if (mode === 'archive' || mode === 'both') await archiveCompanyEOW(company, startDate, endDate);
  }
}

async function runAllEOM(year, month) {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    await runCompanyEOM(company, year, month);
  }
}

async function runAllEOQ(year, quarter) {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    await runCompanyEOQ(company, year, quarter);
  }
}

async function runAllEOY(year) {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    await runCompanyEOY(company, year);
  }
}

async function runAllSiteVisitNotifications() {
  const { companies } = loadCompanies();
  for (const company of companies) {
    if (!company.sheetId) continue;
    await sendSiteVisitNotification(company);
  }
}

async function runMeetingDoc(startDate, endDate) {
  const today = todayInTz('Australia/Sydney');
  const start = startDate || getMondayOfWeek(today);
  const end = endDate || getSundayOfWeek(today);

  console.log(`\n=== Generating Meeting Doc — ${start} to ${end} ===\n`);

  const { title, content } = await generateMeetingDoc(start, end);
  console.log(content);

  // Create as a page in the ClickUp meeting doc
  try {
    const page = await createMeetingDocPage(title, content, end);
    if (page) {
      console.log(`\nCreated meeting doc page in ClickUp: ${page.id || 'done'}`);
    }
  } catch (err) {
    console.error(`ClickUp doc creation error: ${err.message}`);
  }

  return { title, content };
}

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const commands = {
    eod: () => runAllEOD(getArg('--date')),
    eow: () => runAllEOW(getArg('--start'), getArg('--end')),
    eom: () => runAllEOM(getArg('--year') ? parseInt(getArg('--year')) : null, getArg('--month') ? parseInt(getArg('--month')) : null),
    eoq: () => runAllEOQ(getArg('--year') ? parseInt(getArg('--year')) : null, getArg('--quarter') ? parseInt(getArg('--quarter')) : null),
    eoy: () => runAllEOY(getArg('--year') ? parseInt(getArg('--year')) : null),
    'site-visits': () => runAllSiteVisitNotifications(),
    meeting: () => runMeetingDoc(getArg('--start'), getArg('--end')),
  };

  if (!command || !commands[command]) {
    console.log(`
Usage: node runReports.js <command> [options]

Commands:
  eod      Run EOD for all companies    [--date YYYY-MM-DD]
  eow      Run EOW for all companies    [--start YYYY-MM-DD --end YYYY-MM-DD]
  eom      Run EOM for all companies    [--year YYYY --month M]
  eoq      Run EOQ for all companies    [--year YYYY --quarter Q]
  eoy          Run EOY for all companies    [--year YYYY]
  site-visits  Send daily site visit notifications
  meeting      Generate weekly meeting doc  [--start YYYY-MM-DD --end YYYY-MM-DD]
`);
    process.exit(0);
  }

  commands[command]().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  sendCompanyEOD, archiveCompanyEOD,
  sendCompanyEOW, archiveCompanyEOW,
  runCompanyEOM, runCompanyEOQ, runCompanyEOY,
  sendSiteVisitNotification,
  runAllEOD, runAllEOW, runAllEOM, runAllEOQ, runAllEOY, runAllSiteVisitNotifications, runMeetingDoc,
  loadCompanies,
};
