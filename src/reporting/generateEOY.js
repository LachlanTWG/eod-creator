const { readTab } = require('../sheets/readSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { calcEfficiencyRates } = require('./generateEOW');
const { formatMonth, getTopSources } = require('./generateEOM');
const { loadConfig } = require('../config/configLoader');

function formatDollar(value) {
  return '$' + Math.round(value).toLocaleString('en-AU');
}

/**
 * Generate EOY report by aggregating monthly storage data for a given year.
 */
async function generateEOY(spreadsheetId, salesPerson, year, companyName, ownerName) {
  const monthlyTab = salesPerson === 'Team' ? 'Team Monthly' : `${salesPerson} Monthly`;
  const allRows = await readTab(spreadsheetId, monthlyTab);

  if (allRows.length < 2) {
    return { message: 'No monthly data found.', counts: {}, efficiencyRates: {}, monthlyBreakdown: [] };
  }

  const dataRows = allRows.slice(1);
  const yearStr = String(year);
  const yearRows = dataRows.filter(row => row[0] && row[0].startsWith(yearStr));

  if (yearRows.length === 0) {
    return { message: `No monthly data found for ${year}.`, counts: {}, efficiencyRates: {}, monthlyBreakdown: [] };
  }

  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const { outcomes } = loadConfig(companyName);
  const yearlyCounts = {};
  for (const name of outcomeNames) {
    yearlyCounts[name] = 0;
  }

  const monthlyBreakdown = [];

  for (const row of yearRows) {
    const monthField = row[0];
    const monthCounts = {};
    let colIdx = 2;
    for (const name of outcomeNames) {
      const countVal = parseInt(row[colIdx] || '0', 10);
      monthCounts[name] = isNaN(countVal) ? 0 : countVal;
      yearlyCounts[name] += monthCounts[name];
      colIdx++;
    }
    const totalAnswered = (monthCounts['Answered'] || 0) + (monthCounts["Didn't Answer"] || 0);
    if ('Total Calls' in monthCounts) monthCounts['Total Calls'] = totalAnswered;
    if ('Total Contact Attempts' in monthCounts) monthCounts['Total Contact Attempts'] = totalAnswered;
    monthlyBreakdown.push({ month: monthField, counts: monthCounts });
  }

  // Recompute totals
  const totalAnswered = (yearlyCounts['Answered'] || 0) + (yearlyCounts["Didn't Answer"] || 0);
  if ('Total Calls' in yearlyCounts) yearlyCounts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in yearlyCounts) yearlyCounts['Total Contact Attempts'] = totalAnswered;

  const efficiencyRates = calcEfficiencyRates(yearlyCounts, companyName);
  const topSources = getTopSources(yearlyCounts, companyName);

  const has = (name) => outcomeNames.includes(name);
  const totalField = has('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';

  // Find best and worst months
  let bestMonth = null, worstMonth = null;
  for (const m of monthlyBreakdown) {
    const calls = m.counts[totalField] || 0;
    if (!bestMonth || calls > (bestMonth.counts[totalField] || 0)) bestMonth = m;
    if (!worstMonth || calls < (worstMonth.counts[totalField] || 0)) worstMonth = m;
  }

  const lines = [
    `YEARLY PERFORMANCE REPORT - ${companyName}`,
    `${year}`,
    '==========================================',
    '',
    `📞 Total Activity`,
    `${totalField}: ${yearlyCounts[totalField] || 0}`,
    `Answered: ${yearlyCounts['Answered'] || 0} | Didn't Answer: ${yearlyCounts["Didn't Answer"] || 0}`,
  ];

  if (has('New Leads')) {
    const followUps = (yearlyCounts['Pre-Quote Follow Up'] || 0) + (yearlyCounts['Post Quote Follow Up'] || 0) + (yearlyCounts['Follow Up'] || 0);
    lines.push(`New Leads: ${yearlyCounts['New Leads'] || 0}${followUps ? ` | Follow Ups: ${followUps}` : ''}`);
  }

  // Trade metrics
  if (has('Quote Sent')) {
    lines.push('');
    lines.push(`💰 Revenue`);
    lines.push(`Quotes Sent: ${yearlyCounts['Quote Sent'] || 0} (${yearlyCounts['Total Individual Quotes'] || 0} individual)`);
    lines.push(`Total Pipeline Value: ${formatDollar(yearlyCounts['Pipeline Value'] || 0)}`);
    if (has('Site Visit Booked')) lines.push(`Site Visits: ${yearlyCounts['Site Visit Booked'] || 0}`);
    if (has('Job Won')) lines.push(`Jobs Won: ${yearlyCounts['Job Won'] || 0}`);
  }

  // Agency metrics
  if (has('Roadmap Booked')) {
    lines.push('');
    lines.push(`🗺️ Roadmaps`);
    lines.push(`Roadmaps Booked: ${yearlyCounts['Roadmap Booked'] || 0}`);
    lines.push(`Roadmaps Proposed: ${yearlyCounts['Roadmap Proposed'] || 0}`);
    if (has('Deal Closed')) lines.push(`Deals Closed: ${yearlyCounts['Deal Closed'] || 0}`);
  }

  // Efficiency rates (dynamic)
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

  // Attrition (dynamic from outcome categories)
  const totalLost = outcomes.outcomes.filter(o => o.category === 'lost').reduce((sum, o) => sum + (yearlyCounts[o.name] || 0), 0);
  const totalAbandoned = outcomes.outcomes.filter(o => o.category === 'abandoned').reduce((sum, o) => sum + (yearlyCounts[o.name] || 0), 0);
  const totalDQ = outcomes.outcomes.filter(o => o.category === 'dq').reduce((sum, o) => sum + (yearlyCounts[o.name] || 0), 0);

  if (totalLost > 0 || totalAbandoned > 0 || totalDQ > 0) {
    lines.push('');
    lines.push('🔴 Attrition');
    if (totalLost > 0) lines.push(`Lost: ${totalLost}`);
    if (totalAbandoned > 0) lines.push(`Abandoned: ${totalAbandoned}`);
    if (totalDQ > 0) lines.push(`Disqualified: ${totalDQ}`);
  }

  // Monthly breakdown table (dynamic columns)
  if (monthlyBreakdown.length > 1) {
    lines.push('');
    lines.push('📊 Monthly Breakdown');

    if (has('Quote Sent')) {
      lines.push('Month | Calls | Answered | Quotes | Site Visits | Jobs Won');
      lines.push('------|-------|----------|--------|-------------|--------');
      for (const m of monthlyBreakdown) {
        const parts = m.month.split('-');
        const label = formatMonth(parseInt(parts[0]), parseInt(parts[1]));
        const c = m.counts;
        lines.push(`${label} | ${c[totalField] || 0} | ${c['Answered'] || 0} | ${c['Quote Sent'] || 0} | ${c['Site Visit Booked'] || 0} | ${c['Job Won'] || 0}`);
      }
    } else {
      lines.push('Month | Contacts | Answered | Roadmaps | Deals');
      lines.push('------|----------|----------|----------|------');
      for (const m of monthlyBreakdown) {
        const parts = m.month.split('-');
        const label = formatMonth(parseInt(parts[0]), parseInt(parts[1]));
        const c = m.counts;
        lines.push(`${label} | ${c[totalField] || 0} | ${c['Answered'] || 0} | ${c['Roadmap Booked'] || 0} | ${c['Deal Closed'] || 0}`);
      }
    }
  }

  if (bestMonth && worstMonth && monthlyBreakdown.length > 1) {
    const bestParts = bestMonth.month.split('-');
    const worstParts = worstMonth.month.split('-');
    lines.push('');
    lines.push(`Best Month: ${formatMonth(parseInt(bestParts[0]), parseInt(bestParts[1]))} (${bestMonth.counts[totalField]} ${totalField.toLowerCase()})`);
    lines.push(`Quietest Month: ${formatMonth(parseInt(worstParts[0]), parseInt(worstParts[1]))} (${worstMonth.counts[totalField]} ${totalField.toLowerCase()})`);
  }

  lines.push('');
  lines.push('==========================================');

  const message = lines.join('\n');
  return { message, counts: yearlyCounts, efficiencyRates, monthlyBreakdown };
}

module.exports = { generateEOY };
