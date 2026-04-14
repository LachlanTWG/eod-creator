require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const cron = require('node-cron');
const {
  sendCompanyEOD, archiveCompanyEOD,
  sendCompanyEOW, archiveCompanyEOW,
  runCompanyEOM, runCompanyEOQ, runCompanyEOY,
  sendSiteVisitNotification,
  runAllEOD, runAllEOW, runAllEOM, runAllEOQ, runAllEOY, runAllSiteVisitNotifications, runMeetingDoc,
  loadCompanies,
} = require('./runReports');
const { logActivity } = require('./sheets/logActivity');
const { appendRows } = require('./sheets/writeSheet');
const { populateAllFormulas } = require('./sheets/populateFormulas');

const PORT = process.env.PORT || 3000;

// ─── Per-Company Timezone Scheduling ─────────────────────────────────
//
// Each company has its own timezone. We schedule cron jobs per-company
// so that reports fire at the right local time:
//
//   5:30pm local (Mon-Fri)  → SEND EOD to Slack + ClickUp
//   5:30pm local (Friday)   → Also SEND EOW
//   11:55pm local (Mon-Fri) → ARCHIVE EOD to sheets (final record)
//   11:55pm local (Friday)  → Also ARCHIVE EOW
//   1st of month, 9am local → EOM (send + archive)
//   Jan 2, 9am local        → EOY (send + archive)
//   Friday 6pm local        → Meeting doc (after all EOWs sent)

const scheduledJobs = [];

function scheduleCompanyJobs() {
  const { companies } = loadCompanies();

  for (const company of companies) {
    if (!company.sheetId) continue;
    const tz = company.timezone || 'Australia/Sydney';
    const name = company.name;

    // EOD Send — 5:30pm weekdays
    scheduledJobs.push(cron.schedule('30 17 * * 1-5', () => {
      console.log(`[${new Date().toISOString()}] SEND EOD: ${name} (${tz})`);
      sendCompanyEOD(company).catch(e => console.error(`${name} send EOD error:`, e.message));
    }, { timezone: tz }));

    // EOD Archive — 11:55pm AEST (consistent cutoff for all companies)
    scheduledJobs.push(cron.schedule('55 23 * * 1-5', () => {
      console.log(`[${new Date().toISOString()}] ARCHIVE EOD: ${name} (AEST)`);
      archiveCompanyEOD(company).catch(e => console.error(`${name} archive EOD error:`, e.message));
    }, { timezone: 'Australia/Sydney' }));

    // EOW Send — Friday 5:30pm (same time as EOD send, runs after)
    scheduledJobs.push(cron.schedule('30 17 * * 5', () => {
      console.log(`[${new Date().toISOString()}] SEND EOW: ${name} (${tz})`);
      sendCompanyEOW(company).catch(e => console.error(`${name} send EOW error:`, e.message));
    }, { timezone: tz }));

    // EOW Archive — Friday 11:55pm AEST (consistent cutoff for all companies)
    scheduledJobs.push(cron.schedule('55 23 * * 5', () => {
      console.log(`[${new Date().toISOString()}] ARCHIVE EOW: ${name} (AEST)`);
      archiveCompanyEOW(company).catch(e => console.error(`${name} archive EOW error:`, e.message));
    }, { timezone: 'Australia/Sydney' }));

    // EOM — 1st of every month at 9am
    scheduledJobs.push(cron.schedule('0 9 1 * *', () => {
      console.log(`[${new Date().toISOString()}] EOM: ${name} (${tz})`);
      runCompanyEOM(company).catch(e => console.error(`${name} EOM error:`, e.message));
    }, { timezone: tz }));

    // EOQ — 1st of Jan, Apr, Jul, Oct at 9am
    scheduledJobs.push(cron.schedule('0 9 1 1,4,7,10 *', () => {
      console.log(`[${new Date().toISOString()}] EOQ: ${name} (${tz})`);
      runCompanyEOQ(company).catch(e => console.error(`${name} EOQ error:`, e.message));
    }, { timezone: tz }));

    // EOY — January 2nd at 9am
    scheduledJobs.push(cron.schedule('0 9 2 1 *', () => {
      console.log(`[${new Date().toISOString()}] EOY: ${name} (${tz})`);
      runCompanyEOY(company).catch(e => console.error(`${name} EOY error:`, e.message));
    }, { timezone: tz }));

    // Site Visit Notification — 7am weekdays
    scheduledJobs.push(cron.schedule('0 7 * * 1-5', () => {
      console.log(`[${new Date().toISOString()}] SITE VISITS: ${name} (${tz})`);
      sendSiteVisitNotification(company).catch(e => console.error(`${name} site visit notification error:`, e.message));
    }, { timezone: tz }));

    console.log(`  ${name}: 8 jobs scheduled (tz: ${tz})`);
  }
}

// Meeting Doc — Friday 6pm AEST (after all EOW sends have fired)
function scheduleMeetingDoc() {
  scheduledJobs.push(cron.schedule('0 18 * * 5', () => {
    console.log(`[${new Date().toISOString()}] MEETING DOC`);
    runMeetingDoc().catch(e => console.error('Meeting doc error:', e.message));
  }, { timezone: 'Australia/Sydney' }));
  console.log(`  Meeting Doc: Friday 6pm AEST`);
}

// ─── Webhook Server ──────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Auth check
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers['authorization'];
    const queryToken = url.searchParams.get('token');
    if (authHeader !== `Bearer ${webhookSecret}` && queryToken !== webhookSecret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  const body = await parseBody(req);

  // Test endpoints — logs full payload for debugging
  if (pathname.startsWith('/webhook/ghl') && pathname.endsWith('-test')) {
    const label = pathname.replace('/webhook/', '').toUpperCase();
    console.log(`\n[${label}] Full payload received:`);
    console.log(JSON.stringify(body, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received', endpoint: pathname, keys: Object.keys(body) }));
    return;
  }

  // ─── GHL / Make.com Activity Webhooks ──────────────────────────────

  // Shared: resolve company from GHL location.id
  function resolveGHLCompany(body, res) {
    const locationId = body.location?.id;
    if (!locationId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing location.id' }));
      return null;
    }
    const { companies } = loadCompanies();
    const company = companies.find(c => c.ghlLocationId === locationId);
    if (!company) {
      console.log(`[GHL] Unknown location: ${locationId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No company for location ${locationId}` }));
      return null;
    }
    return company;
  }

  // Shared: resolve sales person from GHL payload
  function resolveGHLSalesPerson(body, company) {
    console.log(`[GHL DEBUG] assigned_to fields: customData.assigned_to=${body.customData?.assigned_to}, body.assigned_to=${body.assigned_to}, owner=${body.owner}, user.firstName=${body.user?.firstName}`);
    console.log(`[GHL DEBUG] Full body keys: ${Object.keys(body).join(', ')}`);
    const assignedTo = body.customData?.assigned_to || body.assigned_to || body.owner || body.user?.firstName || '';
    const assignedFirst = assignedTo.split(' ')[0].toLowerCase();
    const activePeople = (company.salesPeople || []).filter(p => p.active);
    const match = activePeople.find(p =>
      p.name.split(' ')[0].toLowerCase() === assignedFirst
    );
    return match?.name || assignedTo || 'Unknown';
  }

  // Shared: today in company timezone
  function companyToday(company) {
    const tz = company.timezone || 'Australia/Sydney';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  }

  // EOD Update — from GHL
  if (pathname === '/webhook/ghl/eod') {
    const company = resolveGHLCompany(body, res);
    if (!company) return;

    const eod1 = body['EOD 1 - Stage'] || '';
    const eod2 = body['EOD 2 - Answered?'] || '';
    const eod3 = body['EOD 3 - Standard Outcome'] || '';
    const eod4 = body['EOD 4 - Custom Outcome'] || '';
    const eod5 = body['EOD 5 - Contact Source'] || '';

    if (!eod1 && !eod2 && !eod3) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'skipped', reason: 'No EOD fields populated' }));
      return;
    }

    const salesPersonName = resolveGHLSalesPerson(body, company);
    const outcome = [eod1, eod2, eod3, eod4, eod5].map(s => s.trim()).join(' | ');

    const activityData = {
      date: companyToday(company),
      salesPerson: salesPersonName,
      contactName: body.full_name || '',
      eventType: 'EOD Update',
      outcome,
      adSource: eod5,
      contactAddress: body.address1 || '',
      contactId: body.contact_id || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'eod', company: company.name, salesPerson: salesPersonName }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[GHL EOD] ${company.name} / ${salesPersonName} / ${body.full_name || '?'}`);
    }).catch(e => console.error(`[GHL EOD] Error ${company.name}:`, e.message));
    return;
  }

  // Job Won — from GHL
  if (pathname === '/webhook/ghl/job-won') {
    const company = resolveGHLCompany(body, res);
    if (!company) return;

    const salesPersonName = resolveGHLSalesPerson(body, company);
    const value = body['Job Won Quote Value ($) - Entered '] || body.lead_value || '';
    const comment = body['Job Won Client Comment - Entered'] || '';
    const source = body['EOD 5 - Contact Source'] || '';

    const activityData = {
      date: companyToday(company),
      salesPerson: salesPersonName,
      contactName: body.full_name || '',
      eventType: 'Job Won',
      outcome: comment,
      adSource: source,
      quoteJobValue: String(value),
      contactAddress: body.address1 || '',
      contactId: body.contact_id || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'job-won', company: company.name, salesPerson: salesPersonName, value }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[GHL JOB WON] ${company.name} / ${salesPersonName} / ${body.full_name || '?'} / $${value}`);
    }).catch(e => console.error(`[GHL JOB WON] Error ${company.name}:`, e.message));
    return;
  }

  // Site Visit Booked — from GHL
  if (pathname === '/webhook/ghl/site-visit') {
    const company = resolveGHLCompany(body, res);
    if (!company) return;

    const salesPersonName = resolveGHLSalesPerson(body, company);
    const comment = body['Site Visit Booked - Comment'] || '';
    const appointmentDT = body['Appointment Date Time'] || body['Appointment Date Time - Automated'] || '';
    const dateBooked = body['Date Booked - Automated'] || '';

    const activityData = {
      date: companyToday(company),
      salesPerson: salesPersonName,
      contactName: body.full_name || '',
      eventType: 'Site Visit Booked',
      outcome: comment,
      contactAddress: body.address1 || '',
      contactId: body.contact_id || '',
      appointmentDateTime: appointmentDT,
      appointmentDate: dateBooked,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'site-visit', company: company.name, salesPerson: salesPersonName }));

    Promise.all([
      logActivity(company.sheetId, activityData),
      appendRows(company.sheetId, 'Site Visits', [[
        body.full_name || '',
        body.address1 || '',
        appointmentDT || '',
        salesPersonName,
        '',
      ]]),
    ]).then(() => {
      console.log(`[GHL SITE VISIT] ${company.name} / ${salesPersonName} / ${body.full_name || '?'}`);
    }).catch(e => console.error(`[GHL SITE VISIT] Error ${company.name}:`, e.message));
    return;
  }

  // Quote Sent — from Make.com / Quotie
  if (pathname === '/webhook/quote') {
    // Expected JSON from Make.com HTTP module:
    // { companyName, salesPerson, contactName, quoteValue, contactAddress, contactId, source }
    const { companies } = loadCompanies();
    const company = companies.find(c =>
      c.name.toLowerCase() === (body.companyName || '').toLowerCase()
    );
    if (!company) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Company "${body.companyName}" not found` }));
      return;
    }

    // Clean quote values: strip $ and commas, keep pipe-separated
    const rawValue = String(body.quoteValue || '');
    const cleanValues = rawValue.split('|').map(v => v.replace(/[$,\s]/g, '').trim()).filter(Boolean);
    const quoteJobValue = cleanValues.join('|');

    const activityData = {
      date: companyToday(company),
      salesPerson: body.salesPerson || 'Unknown',
      contactName: body.contactName || '',
      eventType: 'Quote Sent',
      outcome: '',
      adSource: body.source || '',
      quoteJobValue,
      contactAddress: body.contactAddress || '',
      contactId: body.contactId || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'quote', company: company.name, salesPerson: body.salesPerson }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[QUOTE] ${company.name} / ${body.salesPerson} / ${body.contactName || '?'} / $${body.quoteValue}`);
    }).catch(e => console.error(`[QUOTE] Error ${company.name}:`, e.message));
    return;
  }

  // Email Sent — from Make.com (Gmail / Outlook watch)
  if (pathname === '/webhook/email') {
    console.log(`[EMAIL] Raw body:`, JSON.stringify(body));
    const { companies } = loadCompanies();
    const company = companies.find(c =>
      c.name.toLowerCase() === (body.companyName || '').toLowerCase()
    );
    if (!company) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Company "${body.companyName}" not found` }));
      return;
    }

    // Normalize date to YYYY-MM-DD
    let emailDate = body.date || companyToday(company);
    if (emailDate.includes('T')) {
      emailDate = emailDate.split('T')[0];
    }

    const activityData = {
      date: emailDate,
      salesPerson: body.salesPerson || 'Unknown',
      contactName: body.contactName || body.recipientEmail || body.to || '',
      eventType: 'Email Sent',
      outcome: body.subject || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'email', company: company.name, salesPerson: activityData.salesPerson, date: activityData.date, contact: activityData.contactName }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[EMAIL] ${company.name} / ${activityData.salesPerson} / ${activityData.contactName || '?'} / ${activityData.date}`);
    }).catch(e => console.error(`[EMAIL] Error ${company.name}:`, e.message));
    return;
  }

  // Legacy /webhook/ghl — redirect to /webhook/ghl/eod
  if (pathname === '/webhook/ghl') {
    const company = resolveGHLCompany(body, res);
    if (!company) return;

    const eod1 = body['EOD 1 - Stage'] || '';
    const eod2 = body['EOD 2 - Answered?'] || '';
    const eod3 = body['EOD 3 - Standard Outcome'] || '';
    const eod4 = body['EOD 4 - Custom Outcome'] || '';
    const eod5 = body['EOD 5 - Contact Source'] || '';

    if (!eod1 && !eod2 && !eod3) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'skipped', reason: 'No EOD fields populated' }));
      return;
    }

    const salesPersonName = resolveGHLSalesPerson(body, company);
    const outcome = [eod1, eod2, eod3, eod4, eod5].map(s => s.trim()).join(' | ');

    const activityData = {
      date: companyToday(company),
      salesPerson: salesPersonName,
      contactName: body.full_name || '',
      eventType: 'EOD Update',
      outcome,
      adSource: eod5,
      contactAddress: body.address1 || '',
      contactId: body.contact_id || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', type: 'eod', company: company.name, salesPerson: salesPersonName }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[GHL EOD] ${company.name} / ${salesPersonName} / ${body.full_name || '?'}`);
    }).catch(e => console.error(`[GHL EOD] Error ${company.name}:`, e.message));
    return;
  }

  // Refresh formulas for a company or all companies
  if (pathname === '/webhook/refresh-formulas') {
    const { companies } = loadCompanies();
    const targetName = body.company;
    const targets = targetName
      ? companies.filter(c => c.name.toLowerCase() === targetName.toLowerCase())
      : companies.filter(c => c.sheetId);

    if (targets.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Company "${targetName}" not found` }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'triggered', companies: targets.map(c => c.name) }));

    (async () => {
      for (const c of targets) {
        try {
          await populateAllFormulas(c.sheetId, c.name, c.ownerName, c.salesPeople);
          console.log(`[REFRESH] Formulas updated: ${c.name}`);
        } catch (e) {
          console.error(`[REFRESH] Error ${c.name}:`, e.message);
        }
      }
    })();
    return;
  }

  // Webhook endpoints — all companies
  const endpoints = {
    '/webhook/eod': () => runAllEOD(body.date),
    '/webhook/eow': () => runAllEOW(body.startDate, body.endDate),
    '/webhook/eom': () => runAllEOM(body.year, body.month),
    '/webhook/eoq': () => runAllEOQ(body.year, body.quarter),
    '/webhook/eoy': () => runAllEOY(body.year),
    '/webhook/meeting': () => runMeetingDoc(body.startDate, body.endDate),
  };

  if (endpoints[pathname]) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'triggered', report: pathname.split('/').pop() }));
    endpoints[pathname]().catch(e => console.error(`Webhook ${pathname} error:`, e.message));
    return;
  }

  // Per-company webhook: /webhook/eod/Bolton%20EC
  const perCompanyMatch = pathname.match(/^\/webhook\/(eod|eow|eom|eoq|eoy)\/(send|archive)?\/?(.*)?$/);
  if (perCompanyMatch) {
    const [, reportType, mode, companySlug] = perCompanyMatch;
    if (companySlug) {
      const companyName = decodeURIComponent(companySlug);
      const { companies } = loadCompanies();
      const company = companies.find(c => c.name.toLowerCase() === companyName.toLowerCase());
      if (!company) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Company "${companyName}" not found` }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'triggered', report: reportType, company: company.name, mode: mode || 'both' }));

      const handlers = {
        eod: () => mode === 'archive' ? archiveCompanyEOD(company, body.date) :
                   mode === 'send' ? sendCompanyEOD(company, body.date) :
                   sendCompanyEOD(company, body.date).then(() => archiveCompanyEOD(company, body.date)),
        eow: () => mode === 'archive' ? archiveCompanyEOW(company) :
                   mode === 'send' ? sendCompanyEOW(company) :
                   sendCompanyEOW(company).then(() => archiveCompanyEOW(company)),
        eom: () => runCompanyEOM(company, body.year, body.month),
        eoq: () => runCompanyEOQ(company, body.year, body.quarter),
        eoy: () => runCompanyEOY(company, body.year),
      };
      handlers[reportType]().catch(e => console.error(`Webhook error:`, e.message));
      return;
    }
  }

  // Status endpoint
  if (pathname === '/status') {
    const { companies } = loadCompanies();
    const companySchedules = companies
      .filter(c => c.sheetId)
      .map(c => ({ name: c.name, timezone: c.timezone || 'Australia/Sydney' }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      totalJobs: scheduledJobs.length,
      companies: companySchedules,
      schedule: {
        'EOD Send': '5:30pm local (Mon-Fri)',
        'EOD Archive': '11:55pm AEST (Mon-Fri)',
        'EOW Send': '5:30pm local (Friday)',
        'EOW Archive': '11:55pm AEST (Friday)',
        'EOM': '1st of month, 9am local',
        'EOQ': '1st of Jan/Apr/Jul/Oct, 9am local',
        'EOY': 'Jan 2, 9am local',
        'Meeting Doc': 'Friday 6pm AEST',
      },
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── Start ───────────────────────────────────────────────────────────

function start() {
  console.log('\nEOD Creator — Scheduling per-company jobs...\n');

  scheduleCompanyJobs();
  scheduleMeetingDoc();

  console.log(`\nTotal cron jobs: ${scheduledJobs.length}`);

  server.listen(PORT, () => {
    console.log(`\nServer running on port ${PORT}`);
    console.log(`\nWebhook endpoints:`);
    console.log(`  POST /webhook/eod                          — All companies`);
    console.log(`  POST /webhook/eow                          — All companies`);
    console.log(`  POST /webhook/eom                          — All companies`);
    console.log(`  POST /webhook/eoq                          — All companies`);
    console.log(`  POST /webhook/eoy                          — All companies`);
    console.log(`  POST /webhook/meeting                      — Meeting doc`);
    console.log(`  POST /webhook/ghl/eod                      — GHL EOD Update`);
    console.log(`  POST /webhook/ghl/job-won                  — GHL Job Won`);
    console.log(`  POST /webhook/ghl/site-visit               — GHL Site Visit Booked`);
    console.log(`  POST /webhook/quote                        — Make.com Quote Sent`);
    console.log(`  POST /webhook/email                        — Make.com Email Sent`);
    console.log(`  POST /webhook/eod/send/<company>           — Send EOD for one company`);
    console.log(`  POST /webhook/eod/archive/<company>        — Archive EOD for one company`);
    console.log(`  GET  /status                               — Status + schedules`);
    console.log(`  GET  /health                               — Health check\n`);
  });
}

start();
