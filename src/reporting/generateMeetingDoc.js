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
    if (salesPerson && salesPerson !== 'Team' && a['Sales Person'] !== salesPerson) return false;
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

/**
 * Detect whether a company has trade metrics or agency metrics.
 */
function getCompanyType(companyName) {
  const { outcomes } = loadConfig(companyName);
  const names = outcomes.outcomes.map(o => o.name);
  if (names.includes('Quote Sent')) return 'trade';
  if (names.includes('Roadmap Booked')) return 'agency';
  return 'trade'; // default
}

/**
 * Get the total activity field name for a company.
 */
function getTotalField(companyName) {
  const { outcomes } = loadConfig(companyName);
  const names = outcomes.outcomes.map(o => o.name);
  return names.includes('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';
}

/**
 * Collect source counts from outcome counts using config.
 */
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

/**
 * Get daily + weekly stats for one company (dynamic based on config).
 */
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

      // Accumulate weekly counts
      for (const [key, val] of Object.entries(c)) {
        if (typeof val === 'number') {
          weeklyCounts[key] = (weeklyCounts[key] || 0) + val;
        }
      }

      // Job values from jobDetails
      for (const job of (data.jobDetails || [])) {
        jobValue += job.value || 0;
      }
    }

    weeklyCounts._jobValue = jobValue;
    weeklyCounts._sources = collectSources(weeklyCounts, company.name);
    weeklyStats[person.name] = weeklyCounts;
  }

  // Team totals
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

/**
 * Build per-person metric table — adapts to trade or agency.
 */
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

/**
 * Build attrition line for a person's weekly stats.
 */
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

/**
 * Generate the weekly sales exec meeting document.
 */
async function generateMeetingDoc(startDate, endDate) {
  const { companies } = loadCompanies();
  const activeCompanies = companies.filter(c => c.sheetId);
  const weekdays = getWeekdayDates(startDate, endDate);
  const allPeople = getAllActivePeople(activeCompanies);
  const dayHeaders = weekdays.map(d => shortDay(d));

  // Gather all company data
  const companyData = [];
  for (const company of activeCompanies) {
    try {
      const data = await getCompanyData(company, weekdays);
      companyData.push({ company, data });
    } catch (err) {
      companyData.push({ company, data: null, error: err.message });
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

  // ═══ DOING MORE ═══
  lines.push("## 🚀 Sales Exec's Doing More? — 5 min");
  lines.push('');
  lines.push("1. Are the Sales Exec's Capable of Handling More Work? Y/N");
  lines.push('2. What can we do to add more value / improve results?');
  lines.push('3. Lead conversation quality and volume discussion.');
  lines.push('');
  lines.push('* * *');
  lines.push('');

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

  // ═══ PERFORMANCE REVIEW ═══
  lines.push("## 📈 Past Week's Performance Review");
  lines.push(`_${formatLongDate(startDate)} — ${formatLongDate(endDate)}_`);
  lines.push('');

  let grandCalls = 0, grandAnswered = 0, grandQuotes = 0;
  let grandPipeline = 0, grandSiteVisits = 0, grandJobs = 0, grandRevenue = 0;
  let grandRoadmaps = 0, grandDeals = 0;

  for (const { company, data, error } of companyData) {
    const meta = COMPANY_META[company.name] || { industry: '', location: '' };
    const totalField = data ? data.totalField : 'Total Calls';
    const totalActivity = data ? (data.teamWeekly[totalField] || 0) : 0;

    if (error || !data || totalActivity === 0) {
      lines.push(`🏢 **${company.name} — ${meta.industry} | ${meta.location}**`);
      lines.push('_No activity this week._');
      lines.push('');
      lines.push('* * *');
      lines.push('');
      continue;
    }

    grandCalls += totalActivity;
    grandAnswered += (data.teamWeekly['Answered'] || 0);
    grandQuotes += (data.teamWeekly['Quote Sent'] || 0);
    grandPipeline += (data.teamWeekly['Pipeline Value'] || 0);
    grandSiteVisits += (data.teamWeekly['Site Visit Booked'] || 0);
    grandJobs += (data.teamWeekly['Job Won'] || 0);
    grandRevenue += (data.teamWeekly._jobValue || 0);
    grandRoadmaps += (data.teamWeekly['Roadmap Booked'] || 0);
    grandDeals += (data.teamWeekly['Deal Closed'] || 0);

    lines.push(`🏢 **${data.company} — ${meta.industry} | ${meta.location}**`);
    lines.push('');

    // Daily activity table
    const totalLabel = totalField === 'Total Calls' ? 'Calls' : 'Contacts';
    lines.push(`**📅 Daily ${totalLabel}**`);
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

    // Per-person metric tables
    for (const person of data.people) {
      const w = data.weeklyStats[person];
      lines.push(`**${person}**`);
      lines.push('');
      lines.push(buildPersonMetrics(person, w, data.companyType));
      lines.push('');

      const attrition = buildAttritionLine(w, company.name);
      if (attrition) {
        lines.push(attrition);
        lines.push('');
      }

      lines.push(`**Sources:** ${formatSources(w._sources)}`);
      lines.push('');
    }

    // Combined team summary (if multiple people)
    if (data.people.length > 1) {
      const t = data.teamWeekly;
      lines.push(`**🏁 ${data.company} — Combined**`);
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`| ---| --- |`);
      lines.push(`| 📞 ${totalLabel} | ${totalActivity} |`);
      lines.push(`| 📱 Answered / No Answer | ${t['Answered'] || 0} / ${t["Didn't Answer"] || 0} |`);
      lines.push(`| ⚡ Pick Up Rate | ${data.rates.pickUp}% |`);

      if (data.companyType === 'trade') {
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

  // ═══ GRAND TOTALS ═══
  const grandPickUp = grandCalls > 0 ? ((grandAnswered / grandCalls) * 100).toFixed(1) : '0';

  lines.push('## 🏆 Grand Totals — All Clients');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| ---| --- |');
  lines.push(`| 🏢 Active Clients | ${companyData.filter(d => d.data && (d.data.teamWeekly[d.data.totalField] || 0) > 0).length} |`);
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
