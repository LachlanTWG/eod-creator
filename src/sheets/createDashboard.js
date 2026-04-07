const { writeSheet, batchUpdate } = require('./writeSheet');
const { getSpreadsheetMeta } = require('./readSheet');
const { loadConfig } = require('../config/configLoader');

function colLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function outcomeCountCol(name, outcomeNames) {
  const idx = outcomeNames.indexOf(name);
  if (idx === -1) throw new Error(`Outcome not found: ${name}`);
  return colLetter(2 + idx * 2);
}

// =====================================================================
//  BRAND THEMES
// =====================================================================
const THEMES = {
  'Bolton EC': {
    headerBg:        { red: 0.45, green: 0.04, blue: 0.04 },
    headerText:      { red: 1, green: 1, blue: 1 },
    scorecardTitle:  { red: 0.3, green: 0.02, blue: 0.02 },
    scorecardSub:    { red: 0.92, green: 0.86, blue: 0.86 },
    personBg:        { red: 0.88, green: 0.82, blue: 0.82 },
    teamBg:          { red: 0.25, green: 0.25, blue: 0.25 },
    teamText:        { red: 1, green: 1, blue: 1 },
    sectionBg:       { red: 0.22, green: 0.22, blue: 0.22 },
    sectionText:     { red: 1, green: 1, blue: 1 },
    c: [
      { red: 0.72, green: 0.11, blue: 0.11 },
      { red: 0.15, green: 0.15, blue: 0.15 },
      { red: 0.52, green: 0.52, blue: 0.52 },
      { red: 0.88, green: 0.28, blue: 0.28 },
      { red: 0.38, green: 0.38, blue: 0.38 },
    ],
  },
  'HDK Long Run Roofing': {
    headerBg:        { red: 0.12, green: 0.25, blue: 0.45 },
    headerText:      { red: 1, green: 1, blue: 1 },
    scorecardTitle:  { red: 0.08, green: 0.18, blue: 0.35 },
    scorecardSub:    { red: 0.88, green: 0.92, blue: 0.97 },
    personBg:        { red: 0.85, green: 0.9, blue: 0.96 },
    teamBg:          { red: 0.2, green: 0.35, blue: 0.55 },
    teamText:        { red: 1, green: 1, blue: 1 },
    sectionBg:       { red: 0.12, green: 0.25, blue: 0.45 },
    sectionText:     { red: 1, green: 1, blue: 1 },
    c: [
      { red: 0.15, green: 0.38, blue: 0.68 },
      { red: 0.95, green: 0.6, blue: 0.1 },
      { red: 0.45, green: 0.45, blue: 0.45 },
      { red: 0.3, green: 0.6, blue: 0.85 },
      { red: 0.7, green: 0.7, blue: 0.7 },
    ],
  },
  'Hughes Electrical': {
    headerBg:        { red: 0.1, green: 0.35, blue: 0.15 },
    headerText:      { red: 1, green: 1, blue: 1 },
    scorecardTitle:  { red: 0.06, green: 0.25, blue: 0.1 },
    scorecardSub:    { red: 0.88, green: 0.95, blue: 0.9 },
    personBg:        { red: 0.85, green: 0.93, blue: 0.87 },
    teamBg:          { red: 0.15, green: 0.4, blue: 0.2 },
    teamText:        { red: 1, green: 1, blue: 1 },
    sectionBg:       { red: 0.1, green: 0.35, blue: 0.15 },
    sectionText:     { red: 1, green: 1, blue: 1 },
    c: [
      { red: 0.12, green: 0.55, blue: 0.22 },
      { red: 0.2, green: 0.2, blue: 0.2 },
      { red: 0.55, green: 0.55, blue: 0.55 },
      { red: 0.35, green: 0.75, blue: 0.45 },
      { red: 0.85, green: 0.6, blue: 0.1 },
    ],
  },
};

const DEFAULT_THEME = {
  headerBg:        { red: 0.22, green: 0.46, blue: 0.82 },
  headerText:      { red: 1, green: 1, blue: 1 },
  scorecardTitle:  { red: 0.15, green: 0.35, blue: 0.6 },
  scorecardSub:    { red: 0.85, green: 0.9, blue: 0.95 },
  personBg:        { red: 0.88, green: 0.92, blue: 0.98 },
  teamBg:          { red: 0.2, green: 0.5, blue: 0.3 },
  teamText:        { red: 1, green: 1, blue: 1 },
  sectionBg:       { red: 0.25, green: 0.4, blue: 0.65 },
  sectionText:     { red: 1, green: 1, blue: 1 },
  c: [
    { red: 0.2, green: 0.5, blue: 0.9 },
    { red: 0.1, green: 0.7, blue: 0.3 },
    { red: 0.9, green: 0.5, blue: 0.1 },
    { red: 0.6, green: 0.3, blue: 0.8 },
    { red: 0.9, green: 0.7, blue: 0.1 },
  ],
};

async function createDashboard(spreadsheetId, companyName, ownerName, salesPeople) {
  const { outcomes } = loadConfig(companyName);
  const outcomeNames = outcomes.outcomes.map(o => o.name.replace('{owner}', ownerName));
  const col = (name) => outcomeCountCol(name, outcomeNames);
  const t = THEMES[companyName] || DEFAULT_THEME;

  const C = {
    totalCalls: col('Total Calls'),     newLeads: col('New Leads'),
    preQuote: col('Pre-Quote Follow Up'), postQuote: col('Post Quote Follow Up'),
    answered: col('Answered'),          didntAnswer: col("Didn't Answer"),
    quoteSent: col('Quote Sent'),       pipeline: col('Pipeline Value'),
    jobWon: col('Job Won'),             siteVisit: col('Site Visit Booked'),
    emails: col('Emails Sent'),         reqQuoting: col('Requires Quoting'),
  };

  const sourceOutcomes = [
    'Facebook Ad Form', 'Website Form', 'Instagram Message', 'Facebook Message',
    'Direct Email', 'Direct Phone Call', 'Direct Text Message',
    'Direct Lead passed on from Client', 'Recommended Another Company',
  ];
  const lostNames = ['Lost - Price', 'Lost - Time Related', 'Lost - Priorities Changed'];
  const dqNames = ['DQ - Out of Service Area', 'DQ - Price', 'DQ - Extent of Works', 'DQ - Wrong Contact / Spam', 'DQ - Lead Looking for Work'];
  const abandonedNames = ['Abandoned - Not Responding', 'Abandoned - Headache'];

  // --- Delete old, create new ---
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const tabs = meta.sheets.map(s => s.properties);
  const oldDash = tabs.find(x => x.title === 'Dashboard');
  if (oldDash) {
    await batchUpdate(spreadsheetId, [{ deleteSheet: { sheetId: oldDash.sheetId } }]);
    console.log('  Deleted existing Dashboard tab.');
  }
  const dashId = Math.max(...tabs.map(x => x.sheetId)) + 1;
  await batchUpdate(spreadsheetId, [
    { addSheet: { properties: { sheetId: dashId, title: 'Dashboard', index: 0, gridProperties: { columnCount: 55, rowCount: 500 } } } },
  ]);
  console.log(`  Created Dashboard tab (sheetId=${dashId}).`);

  // ===================================================================
  //  FORMULA HELPERS
  // ===================================================================
  const WINDOW = 180; // 6 months — trend data + long-range scorecard

  const sumLast = (tab, c, days) =>
    `SUMPRODUCT(('${tab}'!A2:A>=TODAY()-${days})*('${tab}'!${c}2:${c}))`;
  const activeDays = (tab, days) =>
    `SUMPRODUCT(('${tab}'!A2:A>=TODAY()-${days})*('${tab}'!${C.totalCalls}2:${C.totalCalls}>0)*1)`;
  const avgPerDay = (tab, c, days) =>
    `IFERROR(ROUND(${sumLast(tab, c, days)}/${activeDays(tab, days)},1),0)`;
  const answerRate = (tab, days) =>
    `IFERROR(ROUND(${sumLast(tab, C.answered, days)}/${sumLast(tab, C.totalCalls, days)}*100,1),0)`;

  // "Leads Touched" = New Leads + Pre-Quote + Post-Quote per active day
  const leadsTouchedAvg = (tab, days) => {
    const sum = `(${sumLast(tab, C.newLeads, days)}+${sumLast(tab, C.preQuote, days)}+${sumLast(tab, C.postQuote, days)})`;
    return `IFERROR(ROUND(${sum}/${activeDays(tab, days)},1),0)`;
  };

  // ===================================================================
  //  A — Team Trend Data (cols A-N) — last 6 months only
  // ===================================================================
  const td = "'Team Daily'";
  const trendHeaders = [
    'Date', 'Total Calls', 'New Leads', 'Follow Ups', 'Answered', "Didn't Answer",
    'Answer Rate %', 'Quotes Sent', 'Pipeline Value', 'Jobs Won',
    'Site Visits', 'Emails Sent', 'Total Lost', 'Total DQ+Abandoned',
  ];

  // FILTER-based: compact output, no blank rows for old dates
  const dateF = `${td}!A2:A>=TODAY()-${WINDOW},${td}!A2:A<>""`;
  const filt = (expr) => `IFERROR(FILTER(${expr},${dateF}),"")`;
  const sRef = (c) => filt(`${td}!${c}2:${c}`);
  const sumCols = (names) => names.map(n => `${td}!${col(n)}2:${col(n)}`).join('+');

  const trendFormulas = [
    filt(`${td}!A2:A`),
    sRef(C.totalCalls), sRef(C.newLeads),
    filt(`${td}!${C.preQuote}2:${C.preQuote}+${td}!${C.postQuote}2:${C.postQuote}`),
    sRef(C.answered), sRef(C.didntAnswer),
    filt(`IF(${td}!${C.totalCalls}2:${C.totalCalls}=0,0,ROUND(${td}!${C.answered}2:${C.answered}/${td}!${C.totalCalls}2:${C.totalCalls}*100,1))`),
    sRef(C.quoteSent), sRef(C.pipeline), sRef(C.jobWon), sRef(C.siteVisit), sRef(C.emails),
    filt(sumCols(lostNames)),
    filt(sumCols([...dqNames, ...abandonedNames])),
  ];

  // ===================================================================
  //  B — Per-Person Trend Data (hidden cols at 40+, VLOOKUP aligned to team dates)
  // ===================================================================
  const ppCol = 40;
  const ppHeaders = [];
  const ppFormulas = [];

  const ppMetrics = [
    { suffix: 'Calls', col: C.totalCalls },
    { suffix: 'Site Visits', col: C.siteVisit },
    { suffix: 'Quotes', col: C.quoteSent },
    { suffix: 'Jobs Won', col: C.jobWon },
  ];

  // Track column indices per person per metric
  const ppIdx = {};
  let ppNext = ppCol;
  for (const person of salesPeople) {
    ppIdx[person.name] = {};
    const pd = `'${person.name} Daily'`;
    for (const metric of ppMetrics) {
      ppIdx[person.name][metric.suffix] = ppNext;
      ppHeaders.push(`${person.name} ${metric.suffix}`);
      // VLOOKUP against team dates in col A — aligns all series to shared x-axis
      ppFormulas.push(
        `ARRAYFORMULA(IFERROR(VLOOKUP(A2:A200,{${pd}!A2:A,${pd}!${metric.col}2:${metric.col}},2,FALSE),0))`
      );
      ppNext++;
    }
  }

  // ===================================================================
  //  B2 — Weekly Pipeline Data (hidden cols after per-person)
  // ===================================================================
  const wkCol = ppNext;
  const tw = "'Team Weekly'";
  const pipelineOutcomeIdx = outcomeNames.indexOf('Pipeline Value');
  const wkPipelineCol = colLetter(3 + pipelineOutcomeIdx);
  const wkDateF = `${tw}!A2:A>=TODAY()-90,${tw}!A2:A<>""`;
  ppHeaders.push('Week Start', 'Weekly Pipeline');
  ppFormulas.push(
    `IFERROR(FILTER(${tw}!A2:A,${wkDateF}),"")`,
    `IFERROR(FILTER(${tw}!${wkPipelineCol}2:${wkPipelineCol},${wkDateF}),"")`
  );
  ppNext += 2;

  // ===================================================================
  //  C — Performance Scorecard (col P = 15)
  //      Columns: 7d / 30d / 90d
  // ===================================================================
  const SC = 15;
  const scoreData = [];
  scoreData.push(['Performance Scorecard', '', '', '']);
  scoreData.push(['', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days']);

  function addCard(label, tab) {
    const windows = [7, 30, 90];
    scoreData.push([label, '', '', '']);
    scoreData.push(['Avg Calls / Day',          ...windows.map(d => `=${avgPerDay(tab, C.totalCalls, d)}`)]);
    scoreData.push(['Leads Touched / Day',       ...windows.map(d => `=${leadsTouchedAvg(tab, d)}`)]);
    scoreData.push(['Avg New Leads / Day',       ...windows.map(d => `=${avgPerDay(tab, C.newLeads, d)}`)]);
    scoreData.push(['Answer Rate %',             ...windows.map(d => `=${answerRate(tab, d)}`)]);
    scoreData.push(['Quotes Sent',               ...windows.map(d => `=${sumLast(tab, C.quoteSent, d)}`)]);
    scoreData.push(['Site Visits Booked',        ...windows.map(d => `=${sumLast(tab, C.siteVisit, d)}`)]);
    scoreData.push(['Jobs Won',                  ...windows.map(d => `=${sumLast(tab, C.jobWon, d)}`)]);
    scoreData.push(['Pipeline Value',            ...windows.map(d => `=${sumLast(tab, C.pipeline, d)}`)]);
    scoreData.push(['Active Days',               ...windows.map(d => `=${activeDays(tab, d)}`)]);
    scoreData.push(['', '', '', '']);
  }

  const personNameRows = [];
  for (const person of salesPeople) {
    personNameRows.push(scoreData.length);
    addCard(person.name.toUpperCase(), `${person.name} Daily`);
  }
  const teamNameRow = scoreData.length;
  addCard('TEAM', 'Team Daily');
  const scorecardEnd = scoreData.length;

  // ===================================================================
  //  D — Lead Sources (Last 30d)
  // ===================================================================
  const srcStart = scorecardEnd;
  const sourceRows = [['Lead Sources (Last 30 Days)', 'Count']];
  for (const src of sourceOutcomes) {
    sourceRows.push([src, `=${sumLast('Team Daily', col(src), 30)}`]);
  }

  // ===================================================================
  //  E — Conversion Funnel (Last 30d)
  // ===================================================================
  const fnlStart = srcStart + sourceRows.length + 1;
  const funnelRows = [
    ['Conversion Funnel (Last 30 Days)', 'Count'],
    ['New Leads',        `=${sumLast('Team Daily', C.newLeads, 30)}`],
    ['Requires Quoting', `=${sumLast('Team Daily', C.reqQuoting, 30)}`],
    ['Quotes Sent',      `=${sumLast('Team Daily', C.quoteSent, 30)}`],
    ['Site Visits',      `=${sumLast('Team Daily', C.siteVisit, 30)}`],
    ['Jobs Won',         `=${sumLast('Team Daily', C.jobWon, 30)}`],
  ];

  // ===================================================================
  //  F — Per-Person Comparison (Last 30d avg/day)
  // ===================================================================
  const cmpStart = fnlStart + funnelRows.length + 1;
  const compRows = [['Sales Person', 'Calls / Day', 'New Leads / Day', 'Quotes / Day']];
  for (const person of salesPeople) {
    const ptab = `${person.name} Daily`;
    compRows.push([
      person.name,
      `=${avgPerDay(ptab, C.totalCalls, 30)}`,
      `=${avgPerDay(ptab, C.newLeads, 30)}`,
      `=${avgPerDay(ptab, C.quoteSent, 30)}`,
    ]);
  }

  // ===================================================================
  //  G — Answered vs Didn't Answer per person (Last 30d)
  // ===================================================================
  const ansStart = cmpStart + compRows.length + 1;
  const ansRows = [['Sales Person', 'Answered', "Didn't Answer", 'Answer Rate %']];
  for (const person of salesPeople) {
    const ptab = `${person.name} Daily`;
    ansRows.push([
      person.name,
      `=${sumLast(ptab, C.answered, 30)}`,
      `=${sumLast(ptab, C.didntAnswer, 30)}`,
      `=${answerRate(ptab, 30)}`,
    ]);
  }

  // ===================================================================
  //  H — Loss Reasons (Last 30d)
  // ===================================================================
  const lossStart = ansStart + ansRows.length + 1;
  const lossRows = [
    ['Loss Reason (Last 30 Days)', 'Count'],
    ['Lost - Price',      `=${sumLast('Team Daily', col('Lost - Price'), 30)}`],
    ['Lost - Timing',     `=${sumLast('Team Daily', col('Lost - Time Related'), 30)}`],
    ['Lost - Priorities',  `=${sumLast('Team Daily', col('Lost - Priorities Changed'), 30)}`],
    ['Abandoned',         `=${sumLast('Team Daily', col('Abandoned - Not Responding'), 30)}+${sumLast('Team Daily', col('Abandoned - Headache'), 30)}`],
    ['Disqualified',      `=${dqNames.map(n => sumLast('Team Daily', col(n), 30)).join('+')}`],
  ];

  // ===================================================================
  //  WRITE DATA
  // ===================================================================
  const ppColLetter = colLetter(ppCol);
  await Promise.all([
    writeSheet(spreadsheetId, "'Dashboard'!A1", [trendHeaders]),
    writeSheet(spreadsheetId, `'Dashboard'!${ppColLetter}1`, [ppHeaders]),
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}1`, scoreData),
  ]);
  await Promise.all([
    writeSheet(spreadsheetId, "'Dashboard'!A2", [trendFormulas.map(f => `=${f}`)]),
    writeSheet(spreadsheetId, `'Dashboard'!${ppColLetter}2`, [ppFormulas.map(f => `=${f}`)]),
  ]);
  await Promise.all([
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}${srcStart + 1}`, sourceRows),
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}${fnlStart + 1}`, funnelRows),
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}${cmpStart + 1}`, compRows),
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}${ansStart + 1}`, ansRows),
    writeSheet(spreadsheetId, `'Dashboard'!${colLetter(SC)}${lossStart + 1}`, lossRows),
  ]);
  console.log('  Data tables and formulas written.');

  // ===================================================================
  //  CHARTS (12, 2×6 grid)
  // ===================================================================
  const dataEnd = 200;
  const mr = (r0, r1, c0, c1) => ({
    sheetId: dashId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1,
  });

  const LCol = 24;   const RCol = 36;
  const cW = 750;    const cWr = 650;
  const cH = 380;    const rowGap = 21;

  const charts = [];
  const n = salesPeople.length;

  // ── Row 1: Activity ──

  // 1) Team Daily Activity (line — calls + new leads)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Daily Activity — Calls & New Leads',
      basicChart: {
        chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(0, dataEnd, 1, 2)] } }, targetAxis: 'LEFT_AXIS', color: t.c[0] },
          { series: { sourceRange: { sources: [mr(0, dataEnd, 2, 3)] } }, targetAxis: 'LEFT_AXIS', color: t.c[1] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: 0, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 2) Per-Person Calls (line)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Daily Calls — Per Person',
      basicChart: {
        chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: salesPeople.map((p) => ({
          series: { sourceRange: { sources: [mr(0, dataEnd, ppIdx[p.name]['Calls'], ppIdx[p.name]['Calls'] + 1)] } },
          targetAxis: 'LEFT_AXIS', color: t.c[salesPeople.indexOf(p) % t.c.length],
        })),
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: 0, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  // ── Row 2: Pipeline & Communication ──

  // 3) Site Visits Over Time — Per Person (column)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Site Visits — Per Person',
      basicChart: {
        chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: salesPeople.map((p) => ({
          series: { sourceRange: { sources: [mr(0, dataEnd, ppIdx[p.name]['Site Visits'], ppIdx[p.name]['Site Visits'] + 1)] } },
          targetAxis: 'LEFT_AXIS', color: t.c[salesPeople.indexOf(p) % t.c.length],
        })),
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 4) Answered vs Didn't Answer (stacked area)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Answered vs Didn\'t Answer',
      basicChart: {
        chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        stackedType: 'STACKED',
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(0, dataEnd, 4, 5)] } }, targetAxis: 'LEFT_AXIS', color: t.c[0] },
          { series: { sourceRange: { sources: [mr(0, dataEnd, 5, 6)] } }, targetAxis: 'LEFT_AXIS', color: t.c[2] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  // ── Row 3: Quoting ──

  // 5) Quotes Sent — Per Person (line)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Quotes Sent — Per Person',
      basicChart: {
        chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: salesPeople.map((p) => ({
          series: { sourceRange: { sources: [mr(0, dataEnd, ppIdx[p.name]['Quotes'], ppIdx[p.name]['Quotes'] + 1)] } },
          targetAxis: 'LEFT_AXIS', color: t.c[salesPeople.indexOf(p) % t.c.length],
        })),
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 2, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 6) Weekly Pipeline Value (area)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Pipeline Value Per Week (90 Days)',
      basicChart: {
        chartType: 'AREA', legendPosition: 'NO_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '$' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, wkCol, wkCol + 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(0, dataEnd, wkCol + 1, wkCol + 2)] } }, targetAxis: 'LEFT_AXIS', color: t.c[0] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 2, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  // ── Row 4: Wins ──

  // 7) Jobs Won — Per Person (column)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Jobs Won — Per Person',
      basicChart: {
        chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(0, dataEnd, 0, 1)] } } }],
        series: salesPeople.map((p) => ({
          series: { sourceRange: { sources: [mr(0, dataEnd, ppIdx[p.name]['Jobs Won'], ppIdx[p.name]['Jobs Won'] + 1)] } },
          targetAxis: 'LEFT_AXIS', color: t.c[salesPeople.indexOf(p) % t.c.length],
        })),
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 3, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 8) Conversion Funnel (last 30d bar)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Conversion Funnel (Last 30 Days)',
      basicChart: {
        chartType: 'BAR', legendPosition: 'NO_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: '' }],
        domains: [{ domain: { sourceRange: { sources: [mr(fnlStart, fnlStart + funnelRows.length, SC, SC + 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(fnlStart, fnlStart + funnelRows.length, SC + 1, SC + 2)] } }, targetAxis: 'BOTTOM_AXIS', color: t.c[0] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 3, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  // ── Row 5: Sources & Losses ──

  // 9) Lead Sources Pie (last 30d)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Lead Sources (Last 30 Days)',
      pieChart: {
        legendPosition: 'RIGHT_LEGEND',
        domain: { sourceRange: { sources: [mr(srcStart, srcStart + sourceRows.length, SC, SC + 1)] } },
        series: { sourceRange: { sources: [mr(srcStart, srcStart + sourceRows.length, SC + 1, SC + 2)] } },
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 4, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 10) Loss Reasons Pie (last 30d)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Loss Reasons (Last 30 Days)',
      pieChart: {
        legendPosition: 'RIGHT_LEGEND',
        domain: { sourceRange: { sources: [mr(lossStart, lossStart + lossRows.length, SC, SC + 1)] } },
        series: { sourceRange: { sources: [mr(lossStart, lossStart + lossRows.length, SC + 1, SC + 2)] } },
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 4, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  // ── Row 6: Per-Person ──

  // 11) Per-Person Daily Avg (last 30d, grouped column)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Per-Person Daily Avg (Last 30 Days)',
      basicChart: {
        chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: 'Avg / Active Day' }],
        domains: [{ domain: { sourceRange: { sources: [mr(cmpStart, cmpStart + compRows.length, SC, SC + 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(cmpStart, cmpStart + compRows.length, SC + 1, SC + 2)] } }, targetAxis: 'LEFT_AXIS', color: t.c[0] },
          { series: { sourceRange: { sources: [mr(cmpStart, cmpStart + compRows.length, SC + 2, SC + 3)] } }, targetAxis: 'LEFT_AXIS', color: t.c[1] },
          { series: { sourceRange: { sources: [mr(cmpStart, cmpStart + compRows.length, SC + 3, SC + 4)] } }, targetAxis: 'LEFT_AXIS', color: t.c[2] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 5, columnIndex: LCol }, widthPixels: cW, heightPixels: cH } },
  } } });

  // 12) Calls Breakdown by Person (last 30d, stacked column)
  charts.push({ addChart: { chart: {
    spec: {
      title: 'Calls Breakdown by Person (Last 30 Days)',
      basicChart: {
        chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        stackedType: 'STACKED',
        axis: [{ position: 'BOTTOM_AXIS', title: '' }, { position: 'LEFT_AXIS', title: 'Calls' }],
        domains: [{ domain: { sourceRange: { sources: [mr(ansStart, ansStart + ansRows.length, SC, SC + 1)] } } }],
        series: [
          { series: { sourceRange: { sources: [mr(ansStart, ansStart + ansRows.length, SC + 1, SC + 2)] } }, targetAxis: 'LEFT_AXIS', color: t.c[0] },
          { series: { sourceRange: { sources: [mr(ansStart, ansStart + ansRows.length, SC + 2, SC + 3)] } }, targetAxis: 'LEFT_AXIS', color: t.c[2] },
        ],
      },
    },
    position: { overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: rowGap * 5, columnIndex: RCol }, widthPixels: cWr, heightPixels: cH } },
  } } });

  await batchUpdate(spreadsheetId, charts);
  console.log('  12 charts created.');

  // ===================================================================
  //  FORMATTING
  // ===================================================================
  const fmt = [];
  const white = { red: 1, green: 1, blue: 1 };
  const black = { red: 0, green: 0, blue: 0 };

  // Date column format
  fmt.push({ repeatCell: {
    range: mr(1, dataEnd, 0, 1),
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
    fields: 'userEnteredFormat.numberFormat',
  } });

  // Pipeline ($) — daily column
  fmt.push({ repeatCell: {
    range: mr(1, dataEnd, 8, 9),
    cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } },
    fields: 'userEnteredFormat.numberFormat',
  } });

  // Weekly date + pipeline formatting
  fmt.push({ repeatCell: {
    range: mr(1, dataEnd, wkCol, wkCol + 1),
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
    fields: 'userEnteredFormat.numberFormat',
  } });
  fmt.push({ repeatCell: {
    range: mr(1, dataEnd, wkCol + 1, wkCol + 2),
    cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } },
    fields: 'userEnteredFormat.numberFormat',
  } });

  // Trend header row (brand)
  fmt.push({ repeatCell: {
    range: mr(0, 1, 0, 14),
    cell: { userEnteredFormat: { backgroundColor: t.headerBg, textFormat: { bold: true, foregroundColor: t.headerText } } },
    fields: 'userEnteredFormat(textFormat,backgroundColor)',
  } });

  // Scorecard title
  fmt.push({ repeatCell: {
    range: mr(0, 1, SC, SC + 4),
    cell: { userEnteredFormat: { backgroundColor: t.scorecardTitle, textFormat: { bold: true, fontSize: 13, foregroundColor: white } } },
    fields: 'userEnteredFormat(textFormat,backgroundColor)',
  } });

  // Scorecard sub-headers
  fmt.push({ repeatCell: {
    range: mr(1, 2, SC, SC + 4),
    cell: { userEnteredFormat: { backgroundColor: t.scorecardSub, textFormat: { bold: true, foregroundColor: black } } },
    fields: 'userEnteredFormat(textFormat,backgroundColor)',
  } });

  // Person name rows
  for (const row of personNameRows) {
    fmt.push({ repeatCell: {
      range: mr(row, row + 1, SC, SC + 4),
      cell: { userEnteredFormat: { backgroundColor: t.personBg, textFormat: { bold: true, fontSize: 11 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    } });
  }

  // Team name row
  fmt.push({ repeatCell: {
    range: mr(teamNameRow, teamNameRow + 1, SC, SC + 4),
    cell: { userEnteredFormat: { backgroundColor: t.teamBg, textFormat: { bold: true, fontSize: 11, foregroundColor: t.teamText } } },
    fields: 'userEnteredFormat(textFormat,backgroundColor)',
  } });

  // Section headers
  for (const row of [srcStart, fnlStart, cmpStart, ansStart, lossStart]) {
    fmt.push({ repeatCell: {
      range: mr(row, row + 1, SC, SC + 4),
      cell: { userEnteredFormat: { backgroundColor: t.sectionBg, textFormat: { bold: true, foregroundColor: t.sectionText } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    } });
  }

  // Freeze header row
  fmt.push({ updateSheetProperties: {
    properties: { sheetId: dashId, gridProperties: { frozenRowCount: 1 } },
    fields: 'gridProperties.frozenRowCount',
  } });

  // Auto-resize scorecard + data columns
  fmt.push({ autoResizeDimensions: {
    dimensions: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 20 },
  } });

  // Hide per-person helper columns
  fmt.push({ updateDimensionProperties: {
    range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: ppCol, endIndex: ppNext },
    properties: { pixelSize: 1 },
    fields: 'pixelSize',
  } });

  await batchUpdate(spreadsheetId, fmt);
  console.log('  Formatting applied.');
  console.log(`  Dashboard complete for ${companyName}.`);
  return dashId;
}

module.exports = { createDashboard };
