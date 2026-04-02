const { readTab } = require('../sheets/readSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { calcEfficiencyRates } = require('./generateEOW');
const { loadConfig } = require('../config/configLoader');

function formatMonth(year, month) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[month - 1]} ${year}`;
}

function getTopSources(counts, companyName) {
  const { outcomes } = loadConfig(companyName);
  const sources = outcomes.outcomes
    .filter(o => o.category === 'source')
    .map(o => o.name);

  return sources
    .map(s => ({ name: s, count: counts[s] || 0 }))
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function formatDollar(value) {
  return '$' + Math.round(value).toLocaleString('en-AU');
}

/**
 * Generate EOM report by aggregating weekly storage data for a given month.
 */
async function generateEOM(spreadsheetId, salesPerson, year, month, companyName, ownerName) {
  const weeklyTab = salesPerson === 'Team' ? 'Team Weekly' : `${salesPerson} Weekly`;
  const allRows = await readTab(spreadsheetId, weeklyTab);

  if (allRows.length < 2) {
    return { message: 'No weekly data found.', counts: {}, efficiencyRates: {} };
  }

  const dataRows = allRows.slice(1);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const monthRows = dataRows.filter(row => {
    const weekStart = row[0];
    const weekEnd = row[1];
    return weekEnd >= monthStart && weekStart < nextMonth;
  });

  if (monthRows.length === 0) {
    return { message: `No weekly data found for ${formatMonth(year, month)}.`, counts: {}, efficiencyRates: {} };
  }

  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const monthlyCounts = {};
  for (const name of outcomeNames) {
    monthlyCounts[name] = 0;
  }

  for (const row of monthRows) {
    let colIdx = 3;
    for (const name of outcomeNames) {
      const countVal = parseInt(row[colIdx] || '0', 10);
      if (!isNaN(countVal)) {
        monthlyCounts[name] += countVal;
      }
      colIdx++;
    }
  }

  // Recompute totals
  const totalAnswered = (monthlyCounts['Answered'] || 0) + (monthlyCounts["Didn't Answer"] || 0);
  if ('Total Calls' in monthlyCounts) monthlyCounts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in monthlyCounts) monthlyCounts['Total Contact Attempts'] = totalAnswered;

  const efficiencyRates = calcEfficiencyRates(monthlyCounts, companyName);
  const topSources = getTopSources(monthlyCounts, companyName);
  const { outcomes } = loadConfig(companyName);

  // Determine what metrics exist for this company
  const has = (name) => outcomeNames.includes(name) || (monthlyCounts[name] !== undefined);

  const monthStr = formatMonth(year, month);
  const lines = [
    `MONTHLY PERFORMANCE REPORT - ${companyName}`,
    `${monthStr}`,
    '==========================================',
    '',
    `📞 Activity`,
  ];

  const totalField = has('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';
  lines.push(`${totalField}: ${monthlyCounts[totalField] || 0}`);
  lines.push(`Answered: ${monthlyCounts['Answered'] || 0} | Didn't Answer: ${monthlyCounts["Didn't Answer"] || 0}`);

  if (has('New Leads')) {
    const followUps = (monthlyCounts['Pre-Quote Follow Up'] || 0) + (monthlyCounts['Post Quote Follow Up'] || 0) + (monthlyCounts['Follow Up'] || 0);
    lines.push(`New Leads: ${monthlyCounts['New Leads'] || 0}${followUps ? ` | Follow Ups: ${followUps}` : ''}`);
  }

  // Trade-specific metrics
  if (has('Quote Sent')) {
    lines.push('');
    lines.push(`💰 Revenue Pipeline`);
    lines.push(`Quotes Sent: ${monthlyCounts['Quote Sent'] || 0} (${monthlyCounts['Total Individual Quotes'] || 0} individual)`);
    lines.push(`Pipeline Value: ${formatDollar(monthlyCounts['Pipeline Value'] || 0)}`);
    if (has('Site Visit Booked')) lines.push(`Site Visits: ${monthlyCounts['Site Visit Booked'] || 0}`);
    if (has('Job Won')) lines.push(`Jobs Won: ${monthlyCounts['Job Won'] || 0}`);
  }

  // Agency-specific metrics
  if (has('Roadmap Booked')) {
    lines.push('');
    lines.push(`🗺️ Roadmaps`);
    lines.push(`Roadmaps Booked: ${monthlyCounts['Roadmap Booked'] || 0}`);
    lines.push(`Roadmaps Proposed: ${monthlyCounts['Roadmap Proposed'] || 0}`);
    if (has('Deal Closed')) lines.push(`Deals Closed: ${monthlyCounts['Deal Closed'] || 0}`);
  }

  // Efficiency rates (dynamic from config)
  if (Object.keys(efficiencyRates).length > 0) {
    lines.push('');
    lines.push(`⚡ Efficiency Rates`);
    for (const [name, rate] of Object.entries(efficiencyRates)) {
      lines.push(`${name}: ${rate}%`);
    }
  }

  if (topSources.length > 0) {
    lines.push('');
    lines.push('📣 Top Lead Sources');
    for (const s of topSources) {
      lines.push(`${s.name}: ${s.count}`);
    }
  }

  // Attrition (dynamic — sum all lost/abandoned/dq categories)
  const lostOutcomes = outcomes.outcomes.filter(o => o.category === 'lost');
  const abandonedOutcomes = outcomes.outcomes.filter(o => o.category === 'abandoned');
  const dqOutcomes = outcomes.outcomes.filter(o => o.category === 'dq');

  const totalLost = lostOutcomes.reduce((sum, o) => sum + (monthlyCounts[o.name] || 0), 0);
  const totalAbandoned = abandonedOutcomes.reduce((sum, o) => sum + (monthlyCounts[o.name] || 0), 0);
  const totalDQ = dqOutcomes.reduce((sum, o) => sum + (monthlyCounts[o.name] || 0), 0);

  if (totalLost > 0 || totalAbandoned > 0 || totalDQ > 0) {
    lines.push('');
    lines.push('🔴 Attrition');
    if (totalLost > 0) lines.push(`Lost: ${totalLost}`);
    if (totalAbandoned > 0) lines.push(`Abandoned: ${totalAbandoned}`);
    if (totalDQ > 0) lines.push(`Disqualified: ${totalDQ}`);
  }

  lines.push('');
  lines.push('==========================================');

  const message = lines.join('\n');
  return { message, counts: monthlyCounts, efficiencyRates };
}

module.exports = { generateEOM, formatMonth, getTopSources };
