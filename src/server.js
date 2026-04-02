require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const cron = require('node-cron');
const {
  sendCompanyEOD, archiveCompanyEOD,
  sendCompanyEOW, archiveCompanyEOW,
  runCompanyEOM, runCompanyEOY,
  runAllEOD, runAllEOW, runAllEOM, runAllEOY, runMeetingDoc,
  loadCompanies,
} = require('./runReports');
const { logActivity } = require('./sheets/logActivity');

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

    // EOY — January 2nd at 9am
    scheduledJobs.push(cron.schedule('0 9 2 1 *', () => {
      console.log(`[${new Date().toISOString()}] EOY: ${name} (${tz})`);
      runCompanyEOY(company).catch(e => console.error(`${name} EOY error:`, e.message));
    }, { timezone: tz }));

    console.log(`  ${name}: 6 jobs scheduled (tz: ${tz})`);
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

  // GHL test endpoint — logs full payload for debugging
  if (pathname === '/webhook/ghl-test') {
    console.log('\n[GHL TEST] Full payload received:');
    console.log(JSON.stringify(body, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received', keys: Object.keys(body) }));
    return;
  }

  // GHL webhook — logs activity from GoHighLevel CRM
  if (pathname === '/webhook/ghl') {
    const locationId = body.location?.id;
    if (!locationId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing location.id' }));
      return;
    }

    const { companies } = loadCompanies();
    const company = companies.find(c => c.ghlLocationId === locationId);
    if (!company) {
      console.log(`[GHL] Unknown location: ${locationId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No company for location ${locationId}` }));
      return;
    }

    // Extract EOD fields
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

    // Match sales person by first name from assigned_to
    const assignedTo = body.customData?.assigned_to || '';
    const assignedFirst = assignedTo.split(' ')[0].toLowerCase();
    const activePeople = (company.salesPeople || []).filter(p => p.active);
    const salesPerson = activePeople.find(p =>
      p.name.split(' ')[0].toLowerCase() === assignedFirst
    );
    const salesPersonName = salesPerson?.name || assignedTo || 'Unknown';

    // Build outcome string: "LeadType | Answered | Outcome | Notes | Source"
    const outcome = [eod1, eod2, eod3, eod4, eod5]
      .map(s => s.trim())
      .join(' | ');

    // Get today's date in company timezone
    const tz = company.timezone || 'Australia/Sydney';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const activityData = {
      date: today,
      salesPerson: salesPersonName,
      contactName: body.full_name || body.contact_name || '',
      eventType: 'EOD Update',
      outcome,
      adSource: eod5,
      contactAddress: body.address1 || '',
      contactId: body.contact_id || '',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'logged', company: company.name, salesPerson: salesPersonName }));

    logActivity(company.sheetId, activityData).then(() => {
      console.log(`[GHL] Logged activity: ${company.name} / ${salesPersonName} / ${body.full_name || 'unknown contact'}`);
    }).catch(e => {
      console.error(`[GHL] Error logging activity for ${company.name}:`, e.message);
    });
    return;
  }

  // Webhook endpoints — all companies
  const endpoints = {
    '/webhook/eod': () => runAllEOD(body.date),
    '/webhook/eow': () => runAllEOW(body.startDate, body.endDate),
    '/webhook/eom': () => runAllEOM(body.year, body.month),
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
  const perCompanyMatch = pathname.match(/^\/webhook\/(eod|eow|eom|eoy)\/(send|archive)?\/?(.*)?$/);
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
    console.log(`  POST /webhook/eoy                          — All companies`);
    console.log(`  POST /webhook/meeting                      — Meeting doc`);
    console.log(`  POST /webhook/ghl                          — GHL CRM activity log`);
    console.log(`  POST /webhook/eod/send/<company>           — Send EOD for one company`);
    console.log(`  POST /webhook/eod/archive/<company>        — Archive EOD for one company`);
    console.log(`  GET  /status                               — Status + schedules`);
    console.log(`  GET  /health                               — Health check\n`);
  });
}

start();
