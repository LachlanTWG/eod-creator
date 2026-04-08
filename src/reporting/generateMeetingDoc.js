const { readTab } = require('../sheets/readSheet');
const { countOutcomes } = require('./generateEOD');
const { loadConfig } = require('../config/configLoader');
const { loadCompanies } = require('../config/companiesStore');

function formatDollar(value) {
  return '$' + Math.round(value).toLocaleString('en-AU');
}

function shortDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function formatLongDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getWeekdayDates(startDate, endDate) {
  const dates = [];
  const d = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  while (d <= end) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function parseActivityRows(rows, headers) {
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

function filterActivities(activities, targetDate, salesPerson) {
  return activities.filter(a => {
    if (a['Date'] !== targetDate) return false;
    if (salesPerson && salesPerson !== 'Team' && !a['Sales Person'].startsWith(salesPerson)) return false;
    return true;
  });
}

// ClickUp @mention user IDs
const CLICKUP_USER_IDS = {
  'Lachlan': 89456729,
  'Buzz': 95618544,
  'Zac': 89544715,
};

function mention(name) {
  const id = CLICKUP_USER_IDS[name];
  if (id) return `[@${name}](#user_mention#${id})`;
  return `@${name}`;
}

// Company metadata for display
const COMPANY_META = {
  'Bolton EC': { industry: 'Solar', location: 'Perth, WA' },
  'HDK Long Run Roofing': { industry: 'Roofing', location: 'Auckland, NZ' },
  'Virtue Roofing': { industry: 'Roofing', location: 'Perth, WA' },
  'Tradie Web Guys': { industry: 'Digital Agency', location: 'Sydney, NSW' },
  'Next Gen Solar': { industry: 'Solar', location: 'Sydney, NSW' },
  'Hughes Electrical': { industry: 'Electrical', location: 'Perth, WA' },
};

function getCompanyType(companyName) {
  const { outcomes } = loadConfig(companyName);
  const names = outcomes.outcomes.map(o => o.name);
  if (names.includes('Quote Sent')) return 'trade';
  if (names.includes('Roadmap Booked')) return 'agency';
  return 'trade';
}

function getTotalField(companyName) {
  const { outcomes } = loadConfig(companyName);
  const names = outcomes.outcomes.map(o => o.name);
  return names.includes('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';
}

function collectSources(counts, companyName) {
  const { outcomes } = loadConfig(companyName);
  const sourceOutcomes = outcomes.outcomes.filter(o => o.category === 'source');
  const shortNames = {
    'Facebook Ad Form': 'FB Ad', 'Website Form': 'Website', 'Instagram Message': 'Insta',
    'Facebook Message': 'FB Msg', 'Direct Email': 'Email', 'Direct Phone Call': 'Phone',
    'Direct Text Message': 'Text', 'Direct Lead passed on from Client': 'Referral',
    'Recommended Another Company': 'Recommended',
  };
  const sources = {};
  for (const s of sourceOutcomes) {
    const count = counts[s.name] || 0;
    if (count > 0) {
      const label = shortNames[s.name] || s.name;
      sources[label] = (sources[label] || 0) + count;
    }
  }
  return sources;
}

// ─── Weekly Trend & 90-Day Conversion Data ──────────────────────────

/**
 * Read Team Weekly storage tab and return last 4 weeks + 3-month averages.
 */
async function getWeeklyTrend(company, currentWeekStart) {
  let rows;
  try {
    rows = await readTab(company.sheetId, 'Team Weekly');
  } catch {
    return null;
  }
  if (rows.length < 2) return null;

  const headers = rows[0];
  const data = rows.slice(1);

  // Parse rows into objects, filter out empty weeks and current/future weeks
  const weeks = [];
  for (const row of data) {
    const weekStart = (row[0] || '').trim();
    if (!weekStart || weekStart >= currentWeekStart) continue;

    const obj = {};
    headers.forEach((h, i) => {
      const val = row[i] || '';
      const num = parseFloat(val);
      obj[h] = isNaN(num) ? val : num;
    });
    // Only include weeks with some activity
    const totalField = headers.find(h => h === 'Total Calls' || h === 'Total Contact Attempts');
    if (totalField && (obj[totalField] || 0) === 0) continue;
    obj._weekStart = weekStart;
    weeks.push(obj);
  }

  // Sort by week start descending
  weeks.sort((a, b) => b._weekStart.localeCompare(a._weekStart));

  const last4 = weeks.slice(0, 4).reverse(); // chronological order
  const last12 = weeks.slice(0, 12);

  if (last12.length === 0) return null;

  // Calculate 3-month averages
  const avgKeys = headers.filter(h =>
    h !== 'Week Start' && h !== 'Week End' && h !== 'Message' && h !== 'EOW Message'
    && !h.endsWith(' %')
  );
  const averages = {};
  for (const key of avgKeys) {
    const values = last12.map(w => w[key] || 0).filter(v => typeof v === 'number');
    averages[key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  return { last4, averages, weeksUsed: last12.length };
}

/**
 * Calculate 90-day rolling conversion rates from Activity Log.
 */
function calc90DayConversions(activities, companyName) {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recent = activities.filter(a => a['Date'] >= cutoffStr);

  const totalField = getTotalField(companyName);
  const companyType = getCompanyType(companyName);

  let totalCalls = 0, answered = 0, siteVisits = 0, jobsWon = 0;
  let roadmaps = 0, deals = 0, quotesSent = 0;

  for (const a of recent) {
    const eventType = a['Event Type'] || '';
    const outcome = a['Outcome'] || '';

    if (eventType === 'Site Visit Booked') { siteVisits++; continue; }
    if (eventType === 'Job Won') { jobsWon++; continue; }
    if (eventType === 'Quote Sent') { quotesSent++; continue; }

    // EOD Update activities — parse pipe-delimited outcome
    if (eventType === 'EOD Update' && outcome) {
      const parts = outcome.split('|').map(s => s.trim());
      for (const part of parts) {
        if (part === 'Answered') answered++;
        if (part === "Didn't Answer") totalCalls++;
        if (part === 'Answered') totalCalls++;
        if (part === 'Roadmap Booked') roadmaps++;
        if (part === 'Deal Closed') deals++;
      }
    }
  }

  if (companyType === 'trade') {
    return {
      type: 'trade',
      pickUpRate: totalCalls > 0 ? ((answered / totalCalls) * 100).toFixed(0) : '-',
      siteVisitRate: answered > 0 ? ((siteVisits / answered) * 100).toFixed(0) : '-',
      closingRate: siteVisits > 0 ? ((jobsWon / siteVisits) * 100).toFixed(0) : '-',
      totalCalls, answered, siteVisits, jobsWon, quotesSent,
    };
  } else {
    return {
      type: 'agency',
      pickUpRate: totalCalls > 0 ? ((answered / totalCalls) * 100).toFixed(0) : '-',
      roadmapRate: answered > 0 ? ((roadmaps / answered) * 100).toFixed(0) : '-',
      dealRate: totalCalls > 0 ? ((deals / totalCalls) * 100).toFixed(0) : '-',
      totalCalls, answered, roadmaps, deals,
    };
  }
}

// ─── This Week's Data (existing logic) ──────────────────────────────

async function getCompanyData(company, weekdays) {
  if (!company.sheetId) return null;

  const allRows = await readTab(company.sheetId, 'Activity Log');
  if (allRows.length < 2) return null;

  const headers = allRows[0];
  const activities = parseActivityRows(allRows.slice(1), headers);
  const activePeople = company.salesPeople.filter(p => p.active);

  const companyType = getCompanyType(company.name);
  const totalField = getTotalField(company.name);

  const dailyStats = {};
  const weeklyStats = {};

  for (const person of activePeople) {
    dailyStats[person.name] = {};
    const weeklyCounts = {};
    let jobValue = 0;

    for (const date of weekdays) {
      const filtered = filterActivities(activities, date, person.name);
      const data = countOutcomes(filtered, company.ownerName, company.name);
      const c = data.counts;

      dailyStats[person.name][date] = {
        total: c[totalField] || 0,
        answered: c['Answered'] || 0,
      };

      for (const [key, val] of Object.entries(c)) {
        if (typeof val === 'number') {
          weeklyCounts[key] = (weeklyCounts[key] || 0) + val;
        }
      }

      for (const job of (data.jobDetails || [])) {
        jobValue += job.value || 0;
      }
    }

    weeklyCounts._jobValue = jobValue;
    weeklyCounts._sources = collectSources(weeklyCounts, company.name);
    weeklyStats[person.name] = weeklyCounts;
  }

  const teamWeekly = {};
  const teamDaily = {};

  for (const date of weekdays) {
    let dayTotal = 0;
    for (const person of activePeople) {
      dayTotal += dailyStats[person.name][date].total;
    }
    teamDaily[date] = { total: dayTotal };
  }

  for (const person of activePeople) {
    const w = weeklyStats[person.name];
    for (const [key, val] of Object.entries(w)) {
      if (key === '_sources') {
        if (!teamWeekly._sources) teamWeekly._sources = {};
        for (const [src, count] of Object.entries(val)) {
          teamWeekly._sources[src] = (teamWeekly._sources[src] || 0) + count;
        }
      } else if (typeof val === 'number') {
        teamWeekly[key] = (teamWeekly[key] || 0) + val;
      }
    }
  }

  const totalActivity = teamWeekly[totalField] || 0;
  const answered = teamWeekly['Answered'] || 0;
  const pickUp = totalActivity > 0 ? ((answered / totalActivity) * 100).toFixed(0) : '0';

  let rates;
  if (companyType === 'trade') {
    const sv = teamWeekly['Site Visit Booked'] || 0;
    const jw = teamWeekly['Job Won'] || 0;
    rates = {
      pickUp,
      siteVisitRate: answered > 0 ? ((sv / answered) * 100).toFixed(0) : '0',
      closingRate: sv > 0 ? ((jw / sv) * 100).toFixed(0) : '0',
    };
  } else {
    const rb = teamWeekly['Roadmap Booked'] || 0;
    const dc = teamWeekly['Deal Closed'] || 0;
    rates = {
      pickUp,
      roadmapRate: answered > 0 ? ((rb / answered) * 100).toFixed(0) : '0',
      dealRate: totalActivity > 0 ? ((dc / totalActivity) * 100).toFixed(0) : '0',
    };
  }

  // Also return raw activities for 90-day calc
  return {
    company: company.name,
    owner: company.ownerName,
    people: activePeople.map(p => p.name),
    companyType,
    totalField,
    dailyStats,
    teamDaily,
    weeklyStats,
    teamWeekly,
    rates,
    activities,
  };
}

function getAllActivePeople(companies) {
  const seen = new Set();
  const people = [];
  for (const c of companies) {
    for (const p of (c.salesPeople || [])) {
      if (p.active && !seen.has(p.name)) {
        seen.add(p.name);
        people.push(p.name);
      }
    }
  }
  return people;
}

function formatSources(sources) {
  if (!sources) return 'None';
  const entries = Object.entries(sources).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}: ${v}`).join(' | ') || 'None';
}

function buildPersonMetrics(name, w, companyType) {
  const totalContacts = w['Total Calls'] || w['Total Contact Attempts'] || 0;
  const answered = w['Answered'] || 0;
  const didntAnswer = w["Didn't Answer"] || 0;
  const pickUp = totalContacts > 0 ? ((answered / totalContacts) * 100).toFixed(0) + '%' : '-';
  const lines = [];

  lines.push(`| Metric | Value |`);
  lines.push(`| ---| --- |`);
  lines.push(`| 🌱 New Leads | ${w['New Leads'] || 0} |`);

  if (companyType === 'trade') {
    lines.push(`| ⏳ Pre-Quote Follow Up | ${w['Pre-Quote Follow Up'] || 0} |`);
    lines.push(`| 🔄 Post-Quote Follow Up | ${w['Post Quote Follow Up'] || 0} |`);
  } else {
    lines.push(`| 🔄 Follow Up | ${w['Follow Up'] || 0} |`);
  }

  const totalLabel = w['Total Calls'] !== undefined ? 'Total Calls' : 'Total Contacts';
  lines.push(`| 📞 ${totalLabel} | ${totalContacts} |`);
  lines.push(`| 📱 Answered / No Answer | ${answered} / ${didntAnswer} |`);
  lines.push(`| ⚡ Pick Up Rate | ${pickUp} |`);

  if (companyType === 'trade') {
    lines.push(`| 📋 Requires Quoting | ${w['Requires Quoting'] || 0} |`);
    lines.push(`| 📤 Quotes Sent | ${w['Quote Sent'] || 0} |`);
    lines.push(`| 📄 Individual Quotes | ${w['Total Individual Quotes'] || 0} |`);
    lines.push(`| 🚙 Site Visits Booked | ${w['Site Visit Booked'] || 0} |`);
    lines.push(`| 🤝 Verbal Confirmations | ${w['Verbal Confirmation'] || 0} |`);
    lines.push(`| 🏆 Jobs Won | ${w['Job Won'] || 0} |`);
    lines.push(`| 💰 Revenue Generated | ${formatDollar(w._jobValue || 0)} |`);
    lines.push(`| 📈 Pipeline Value | ${formatDollar(w['Pipeline Value'] || 0)} |`);
  } else {
    lines.push(`| 💬 SMS Sent | ${w['SMS Sent'] || 0} |`);
    lines.push(`| 📧 Email Sent | ${w['Email Sent'] || 0} |`);
    lines.push(`| 🗺️ Roadmaps Booked | ${w['Roadmap Booked'] || 0} |`);
    lines.push(`| 📋 Roadmaps Proposed | ${w['Roadmap Proposed'] || 0} |`);
    lines.push(`| 🏆 Deals Closed | ${w['Deal Closed'] || 0} |`);
  }

  return lines.join('\n');
}

function buildAttritionLine(w, companyName) {
  const { outcomes } = loadConfig(companyName);
  const lost = outcomes.outcomes.filter(o => o.category === 'lost');
  const abandoned = outcomes.outcomes.filter(o => o.category === 'abandoned');
  const dq = outcomes.outcomes.filter(o => o.category === 'dq');

  const parts = [];

  const lostItems = lost.map(o => `${o.name.replace('Lost - ', '')}: ${w[o.name] || 0}`).filter(s => !s.endsWith(': 0'));
  if (lostItems.length > 0) parts.push(`**Lost:** ${lostItems.join(' | ')}`);

  const abandonedItems = abandoned.map(o => `${o.name.replace('Abandoned - ', '')}: ${w[o.name] || 0}`).filter(s => !s.endsWith(': 0'));
  if (abandonedItems.length > 0) parts.push(`**Abandoned:** ${abandonedItems.join(' | ')}`);

  const dqItems = dq.map(o => `${o.name.replace('DQ - ', '')}: ${w[o.name] || 0}`).filter(s => !s.endsWith(': 0'));
  if (dqItems.length > 0) parts.push(`**DQ:** ${dqItems.join(' | ')}`);

  return parts.length > 0 ? parts.join('\n') : '';
}

// ─── Trend Table Builders ───────────────────────────────────────────

function buildTrendTable(trend, companyType, totalFieldLabel) {
  if (!trend || trend.last4.length === 0) return '_Not enough historical data for trend._';

  const lines = [];
  const weeks = trend.last4;
  const avg = trend.averages;

  // Column headers: week date ranges + 3-month avg
  const weekHeaders = weeks.map(w => `${formatShortDate(w._weekStart)}`);
  weekHeaders.push(`**${trend.weeksUsed}wk Avg**`);

  lines.push(`| Metric | ${weekHeaders.join(' | ')} |`);
  lines.push(`|---|${weekHeaders.map(() => '---').join('|')}|`);

  // Key metrics to show
  const totalKey = totalFieldLabel === 'Calls' ? 'Total Calls' : 'Total Contact Attempts';

  const tradeMetrics = [
    { label: '📞 ' + totalFieldLabel, key: totalKey },
    { label: '📱 Answered', key: 'Answered' },
    { label: '🌱 New Leads', key: 'New Leads' },
    { label: '📤 Quotes Sent', key: 'Quote Sent' },
    { label: '🚙 Site Visits', key: 'Site Visit Booked' },
    { label: '🏆 Jobs Won', key: 'Job Won' },
    { label: '💰 Revenue', key: 'Total Revenue', dollar: true },
  ];

  const agencyMetrics = [
    { label: '📞 ' + totalFieldLabel, key: totalKey },
    { label: '📱 Answered', key: 'Answered' },
    { label: '🌱 New Leads', key: 'New Leads' },
    { label: '🗺️ Roadmaps Booked', key: 'Roadmap Booked' },
    { label: '🏆 Deals Closed', key: 'Deal Closed' },
  ];

  const metrics = companyType === 'trade' ? tradeMetrics : agencyMetrics;

  for (const m of metrics) {
    const weekVals = weeks.map(w => {
      const v = w[m.key] || 0;
      return m.dollar ? formatDollar(v) : Math.round(v);
    });
    const avgVal = avg[m.key] || 0;
    const avgFormatted = m.dollar ? formatDollar(avgVal) : Math.round(avgVal);
    weekVals.push(`**${avgFormatted}**`);
    lines.push(`| ${m.label} | ${weekVals.join(' | ')} |`);
  }

  return lines.join('\n');
}

function build90DayConversions(conversions) {
  if (!conversions) return '_Not enough data for conversion rates._';

  const lines = [];
  lines.push('| Stage | Count | Conversion |');
  lines.push('|---|---|---|');

  if (conversions.type === 'trade') {
    lines.push(`| 📞 Total Calls | ${conversions.totalCalls} | — |`);
    lines.push(`| 📱 Answered | ${conversions.answered} | ${conversions.pickUpRate}% pick up |`);
    lines.push(`| 🚙 Site Visits Booked | ${conversions.siteVisits} | ${conversions.siteVisitRate}% of answered |`);
    lines.push(`| 🏆 Jobs Won | ${conversions.jobsWon} | ${conversions.closingRate}% of site visits |`);
  } else {
    lines.push(`| 📞 Total Calls | ${conversions.totalCalls} | — |`);
    lines.push(`| 📱 Answered | ${conversions.answered} | ${conversions.pickUpRate}% pick up |`);
    lines.push(`| 🗺️ Roadmaps Booked | ${conversions.roadmaps} | ${conversions.roadmapRate}% of answered |`);
    lines.push(`| 🏆 Deals Closed | ${conversions.deals} | ${conversions.dealRate}% of contacts |`);
  }

  return lines.join('\n');
}

// ─── Main Generator ─────────────────────────────────────────────────

async function generateMeetingDoc(startDate, endDate) {
  const { companies } = loadCompanies();
  const activeCompanies = companies.filter(c => c.sheetId);
  const weekdays = getWeekdayDates(startDate, endDate);
  const allPeople = getAllActivePeople(activeCompanies);
  const dayHeaders = weekdays.map(d => shortDay(d));

  // Gather all company data (this week + trend + conversions)
  const companyData = [];
  for (const company of activeCompanies) {
    try {
      const data = await getCompanyData(company, weekdays);
      const trend = await getWeeklyTrend(company, startDate);
      const conversions = data ? calc90DayConversions(data.activities, company.name) : null;
      companyData.push({ company, data, trend, conversions });
    } catch (err) {
      companyData.push({ company, data: null, trend: null, conversions: null, error: err.message });
    }
  }

  const lines = [];

  // ═══ HEADER ═══
  lines.push('# 📊 Sales Exec Weekly Meeting');
  lines.push('');
  const participantMentions = allPeople.map(name => mention(name)).join(' ');
  lines.push(`**Facilitator:** ${mention('Lachlan')} | **Documenter:** ${mention('Lachlan')} | **Timekeeper:** ${mention('Lachlan')}`);
  lines.push(`**Participants:** ${participantMentions}`);
  lines.push('');
  lines.push('* * *');
  lines.push('');

  // ═══ SEGUE ═══
  lines.push('## 💬 Segue — 5 min');
  lines.push('');
  lines.push('*   One piece of personal good news');
  lines.push('*   One piece of professional good news');
  lines.push('');
  lines.push('* * *');
  lines.push('');

  // ═══ PORTFOLIO SNAPSHOT ═══
  let grandCalls = 0, grandAnswered = 0, grandQuotes = 0;
  let grandPipeline = 0, grandSiteVisits = 0, grandJobs = 0, grandRevenue = 0;
  let grandRoadmaps = 0, grandDeals = 0;
  // Pre-calculate grand totals
  for (const { data } of companyData) {
    if (!data) continue;
    const totalField = data.totalField;
    grandCalls += (data.teamWeekly[totalField] || 0);
    grandAnswered += (data.teamWeekly['Answered'] || 0);
    grandQuotes += (data.teamWeekly['Quote Sent'] || 0);
    grandPipeline += (data.teamWeekly['Pipeline Value'] || 0);
    grandSiteVisits += (data.teamWeekly['Site Visit Booked'] || 0);
    grandJobs += (data.teamWeekly['Job Won'] || 0);
    grandRevenue += (data.teamWeekly._jobValue || 0);
    grandRoadmaps += (data.teamWeekly['Roadmap Booked'] || 0);
    grandDeals += (data.teamWeekly['Deal Closed'] || 0);
  }

  const grandPickUp = grandCalls > 0 ? ((grandAnswered / grandCalls) * 100).toFixed(1) : '0';
  const activeClientCount = companyData.filter(d => d.data && (d.data.teamWeekly[d.data.totalField] || 0) > 0).length;

  lines.push('## 🏆 Portfolio Snapshot — This Week');
  lines.push(`_${formatLongDate(startDate)} — ${formatLongDate(endDate)}_`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| ---| --- |');
  lines.push(`| 🏢 Active Clients | ${activeClientCount} |`);
  lines.push(`| 📞 Total Contacts | ${grandCalls} |`);
  lines.push(`| 📱 Total Answered | ${grandAnswered} (${grandPickUp}%) |`);
  if (grandQuotes > 0) lines.push(`| 📤 Total Quotes | ${grandQuotes} |`);
  if (grandPipeline > 0) lines.push(`| 📈 Total Pipeline | ${formatDollar(grandPipeline)} |`);
  if (grandSiteVisits > 0) lines.push(`| 🚙 Total Site Visits | ${grandSiteVisits} |`);
  if (grandJobs > 0) lines.push(`| 🏆 Total Jobs Won | ${grandJobs} |`);
  if (grandRevenue > 0) lines.push(`| 💰 Total Revenue | ${formatDollar(grandRevenue)} |`);
  if (grandRoadmaps > 0) lines.push(`| 🗺️ Total Roadmaps | ${grandRoadmaps} |`);
  if (grandDeals > 0) lines.push(`| 🤝 Total Deals Closed | ${grandDeals} |`);
  lines.push('');
  lines.push('* * *');
  lines.push('');

  // ═══ PER-COMPANY DEEP DIVE ═══
  lines.push("## 📈 Client Performance Deep Dive");
  lines.push('');

  for (const { company, data, trend, conversions, error } of companyData) {
    const meta = COMPANY_META[company.name] || { industry: '', location: '' };
    const totalField = data ? data.totalField : 'Total Calls';
    const totalActivity = data ? (data.teamWeekly[totalField] || 0) : 0;

    if (error || !data || totalActivity === 0) {
      lines.push(`### 🏢 ${company.name} — ${meta.industry} | ${meta.location}`);
      lines.push('_No activity this week._');
      lines.push('');
      lines.push('* * *');
      lines.push('');
      continue;
    }

    const companyType = data.companyType;
    const totalLabel = totalField === 'Total Calls' ? 'Calls' : 'Contacts';

    lines.push(`### 🏢 ${company.name} — ${meta.industry} | ${meta.location}`);
    lines.push('');

    // ── 4-Week Trend + 3-Month Average ──
    lines.push('**📊 4-Week Trend + Average**');
    lines.push('');
    lines.push(buildTrendTable(trend, companyType, totalLabel));
    lines.push('');

    // ── 90-Day Conversion Funnel ──
    lines.push('**🔄 90-Day Conversion Funnel**');
    lines.push('');
    lines.push(build90DayConversions(conversions));
    lines.push('');

    // ── This Week's Daily Activity ──
    lines.push(`**📅 This Week — Daily ${totalLabel}**`);
    lines.push('');
    lines.push(`| | ${dayHeaders.join(' | ')} | **Total** |`);
    lines.push(`|---|${dayHeaders.map(() => '---').join('|')}|---|`);

    for (const person of data.people) {
      const dailyTotals = weekdays.map(d => data.dailyStats[person][d].total);
      const total = dailyTotals.reduce((a, b) => a + b, 0);
      lines.push(`| ${person} | ${dailyTotals.join(' | ')} | **${total}** |`);
    }

    if (data.people.length > 1) {
      const teamTotals = weekdays.map(d => data.teamDaily[d].total);
      const teamTotal = teamTotals.reduce((a, b) => a + b, 0);
      lines.push(`| **Team** | ${teamTotals.map(c => `**${c}**`).join(' | ')} | **${teamTotal}** |`);
    }
    lines.push('');

    // ── Per-Person Metrics ──
    for (const person of data.people) {
      const w = data.weeklyStats[person];
      lines.push(`**${person}**`);
      lines.push('');
      lines.push(buildPersonMetrics(person, w, companyType));
      lines.push('');

      const attrition = buildAttritionLine(w, company.name);
      if (attrition) {
        lines.push(attrition);
        lines.push('');
      }

      lines.push(`**Sources:** ${formatSources(w._sources)}`);
      lines.push('');
    }

    // ── Team Summary (if multiple people) ──
    if (data.people.length > 1) {
      const t = data.teamWeekly;
      lines.push(`**🏁 ${data.company} — Combined**`);
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`| ---| --- |`);
      lines.push(`| 📞 ${totalLabel} | ${totalActivity} |`);
      lines.push(`| 📱 Answered / No Answer | ${t['Answered'] || 0} / ${t["Didn't Answer"] || 0} |`);
      lines.push(`| ⚡ Pick Up Rate | ${data.rates.pickUp}% |`);

      if (companyType === 'trade') {
        lines.push(`| 📤 Quotes Sent | ${t['Quote Sent'] || 0} (${t['Total Individual Quotes'] || 0} individual) |`);
        lines.push(`| 📈 Pipeline Value | ${formatDollar(t['Pipeline Value'] || 0)} |`);
        lines.push(`| 🚙 Site Visits | ${t['Site Visit Booked'] || 0} |`);
        lines.push(`| 🏆 Jobs Won | ${t['Job Won'] || 0} |`);
        lines.push(`| 💰 Revenue | ${formatDollar(t._jobValue || 0)} |`);
      } else {
        lines.push(`| 🗺️ Roadmaps Booked | ${t['Roadmap Booked'] || 0} |`);
        lines.push(`| 📋 Roadmaps Proposed | ${t['Roadmap Proposed'] || 0} |`);
        lines.push(`| 🏆 Deals Closed | ${t['Deal Closed'] || 0} |`);
      }
      lines.push('');
    }

    lines.push('* * *');
    lines.push('');
  }

  // ═══ KPIs ═══
  lines.push('## 🎯 KPIs');
  lines.push('');
  lines.push('**Ledger:** 🔴 Code Red — Needs attention | 🟠 Discussion — Needs improvement | 🟢 On-track');
  lines.push('');

  for (const person of allPeople) {
    lines.push(`**${person}**`);
    lines.push('');
    lines.push('| KPI | Status |');
    lines.push('| ---| --- |');
    lines.push('| 9am start-time each day |  |');
    lines.push('| Did all leads get actioned each day? |  |');
    lines.push('| Have all leads in the pipeline been progressed? |  |');
    lines.push('| Have all quotes been actioned (followed up)? |  |');
    lines.push('| EOW client meeting done? |  |');
    lines.push('');
  }

  lines.push('* * *');
  lines.push('');

  // ═══ DOING MORE ═══
  lines.push("## 🚀 Sales Exec's Doing More? — 5 min");
  lines.push('');
  lines.push("1. Are the Sales Exec's Capable of Handling More Work? Y/N");
  lines.push('2. What can we do to add more value / improve results?');
  lines.push('3. Lead conversation quality and volume discussion.');
  lines.push('');
  lines.push('* * *');
  lines.push('');

  // ═══ NOTES ═══
  lines.push('## 💡 Client / Employee Headlines & Issues');
  lines.push('');
  for (const person of allPeople) {
    lines.push(`**${person}'s Notes:**`);
    lines.push('*   ');
    lines.push('');
  }

  lines.push('* * *');
  lines.push('');

  // ═══ TO-DOS ═══
  lines.push('## ✅ TO-DO Reminders');
  lines.push('');
  for (const person of allPeople) {
    lines.push(`**${person}'s To-Do's**`);
    lines.push('*   ');
    lines.push('');
  }

  const title = `Week of ${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
  const content = lines.join('\n');

  return { title, content };
}

module.exports = { generateMeetingDoc };
