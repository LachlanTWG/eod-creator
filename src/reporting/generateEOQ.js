const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');
const { resolveLeadSource } = require('./generateEOD');

const QUARTER_MONTHS = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

function formatQuarter(year, quarter) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const [m1, , m3] = QUARTER_MONTHS[quarter];
  return `Q${quarter} ${year} (${months[m1 - 1]} - ${months[m3 - 1]})`;
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
 * Generate EOQ report by reading directly from Activity Log with exact quarter boundaries.
 */
async function generateEOQ(spreadsheetId, salesPerson, year, quarter, companyName, ownerName, activityData) {
  const [m1] = QUARTER_MONTHS[quarter];
  const quarterStart = `${year}-${String(m1).padStart(2, '0')}-01`;
  const nextQ = quarter === 4
    ? `${year + 1}-01-01`
    : `${year}-${String(m1 + 3).padStart(2, '0')}-01`;

  const activityRows = activityData;
  if (activityRows.length < 2) {
    return { message: `No data found for ${formatQuarter(year, quarter)}.`, counts: {} };
  }

  const headers = activityRows[0];
  const allParsed = activityRows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });

  // Filter Activity Log rows for this quarter and person
  const quarterRows = activityRows.slice(1).filter(row => {
    const rowDate = row[0] || '';
    if (rowDate < quarterStart || rowDate >= nextQ) return false;
    if (salesPerson !== 'Team' && row[1] !== salesPerson) return false;
    return true;
  });

  if (quarterRows.length === 0) {
    return { message: `No data found for ${formatQuarter(year, quarter)}.`, counts: {} };
  }

  // Count outcomes from Activity Log
  const { outcomes, formulas } = loadConfig(companyName);
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const quarterlyCounts = {};
  for (const name of outcomeNames) {
    quarterlyCounts[name] = 0;
  }

  // Collect Job Won details, quote details
  const jobDetails = [];
  let totalQuoteValues = 0;
  let totalIndividualQuotes = 0;

  for (const row of quarterRows) {
    const eventType = row[3] || '';
    const outcome = row[4] || '';

    if (eventType === 'EOD Update') {
      for (const o of outcomes.outcomes) {
        const name = o.name.replace('{owner}', ownerName);
        if (!(name in quarterlyCounts)) continue;

        switch (o.category) {
          case 'leadType':
            if (outcome.startsWith(`${name} |`)) quarterlyCounts[name]++;
            break;
          case 'answerStatus':
            if (outcome.includes(`| ${name} |`)) quarterlyCounts[name]++;
            break;
          case 'source':
            if (outcome.includes(`| ${name}`)) quarterlyCounts[name]++;
            break;
          default:
            if (outcome.includes(`| ${name} |`) || outcome.includes(`| ${name}`)) quarterlyCounts[name]++;
            break;
        }
      }
    } else if (eventType === 'Job Won') {
      quarterlyCounts['Job Won'] = (quarterlyCounts['Job Won'] || 0) + 1;
      const valStr = (row[6] || '').replace(/[$,\s]/g, '');
      let source = row[5] || '';
      if (!source) source = resolveLeadSource(row[2], row[8], allParsed);
      jobDetails.push({
        contactName: row[2] || '',
        address: (row[7] || '').replace(/,\s*$/, '').trim(),
        value: parseFloat(valStr) || 0,
        source,
      });
    } else if (eventType === 'Email Sent') {
      quarterlyCounts['Emails Sent'] = (quarterlyCounts['Emails Sent'] || 0) + 1;
    } else if (eventType === 'Quote Sent') {
      quarterlyCounts['Quote Sent'] = (quarterlyCounts['Quote Sent'] || 0) + 1;
      const valField = (row[6] || '').replace(/[$\s]/g, '');
      if (valField) {
        const parts = valField.split('|').map(v => parseFloat(v.replace(/,/g, '')) || 0);
        totalIndividualQuotes += parts.length;
        const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
        totalQuoteValues += avg;
      }
    } else if (eventType === 'Site Visit Booked') {
      quarterlyCounts['Site Visit Booked'] = (quarterlyCounts['Site Visit Booked'] || 0) + 1;
    }
  }

  // Set computed counts
  const totalAnswered = (quarterlyCounts['Answered'] || 0) + (quarterlyCounts["Didn't Answer"] || 0);
  if ('Total Calls' in quarterlyCounts) quarterlyCounts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in quarterlyCounts) quarterlyCounts['Total Contact Attempts'] = totalAnswered;
  if ('Pipeline Value' in quarterlyCounts) quarterlyCounts['Pipeline Value'] = totalQuoteValues;
  if ('Total Individual Quotes' in quarterlyCounts) quarterlyCounts['Total Individual Quotes'] = totalIndividualQuotes;

  const topSources = getTopSources(quarterlyCounts, companyName);
  const has = (name) => outcomeNames.includes(name) || (quarterlyCounts[name] !== undefined);

  const quarterStr = formatQuarter(year, quarter);
  const lines = [
    `QUARTERLY PERFORMANCE REPORT - ${salesPerson || 'Team'} - ${companyName}`,
    `${quarterStr}`,
    '==========================================',
    '',
    `📞 Calls`,
  ];

  const totalField = has('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';
  const totalCallCount = quarterlyCounts[totalField] || 0;
  const answeredCount = quarterlyCounts['Answered'] || 0;
  const pickUpRate = totalCallCount > 0 ? Math.round((answeredCount / totalCallCount) * 100) : 0;
  lines.push(`Total Calls: ${totalCallCount}`);
  lines.push(`Answered: ${answeredCount} | Didn't Answer: ${quarterlyCounts["Didn't Answer"] || 0}`);
  if (totalCallCount > 0) lines.push(`Pick Up Rate: ${pickUpRate}%`);

  if (has('New Leads')) {
    const leadParts = [`New Leads: ${quarterlyCounts['New Leads'] || 0}`];
    if (quarterlyCounts['Pre-Quote Follow Up']) leadParts.push(`Pre-Quote Follow Up: ${quarterlyCounts['Pre-Quote Follow Up']}`);
    if (quarterlyCounts['Post Quote Follow Up']) leadParts.push(`Post Quote Follow Up: ${quarterlyCounts['Post Quote Follow Up']}`);
    if (quarterlyCounts['Follow Up']) leadParts.push(`Follow Up: ${quarterlyCounts['Follow Up']}`);
    lines.push(`📋 ${leadParts.join(' | ')}`);
  }

  const emailCount = quarterlyCounts['Emails Sent'] || 0;
  if (emailCount > 0) {
    lines.push('');
    lines.push(`📧 Emails Sent: ${emailCount}`);
  }

  // Trade-specific metrics
  if (has('Quote Sent')) {
    lines.push('');
    lines.push(`💰 Revenue Pipeline`);
    lines.push(`Quotes Sent: ${quarterlyCounts['Quote Sent'] || 0} (${quarterlyCounts['Total Individual Quotes'] || 0} individual)`);
    lines.push(`Pipeline Value: ${formatDollar(quarterlyCounts['Pipeline Value'] || 0)}`);
    if (has('Site Visit Booked')) lines.push(`Site Visits: ${quarterlyCounts['Site Visit Booked'] || 0}`);
    if (has('Job Won')) {
      const jobCount = jobDetails.length > 0 ? jobDetails.length : (quarterlyCounts['Job Won'] || 0);
      lines.push(`Jobs Won: ${jobCount}`);
      if (jobDetails.length > 0) {
        for (const j of jobDetails) {
          lines.push(`• ${j.contactName} - ${j.address || 'N/A'} - ${formatDollar(j.value)} - ${j.source || 'N/A'}`);
        }
        const totalRevenue = jobDetails.reduce((sum, j) => sum + (j.value || 0), 0);
        lines.push(`Total Revenue Generated: ${formatDollar(totalRevenue)}`);
      }
    }
  }

  // Agency-specific metrics
  if (has('Roadmap Booked')) {
    lines.push('');
    lines.push(`🗺️ Roadmaps`);
    lines.push(`Roadmaps Booked: ${quarterlyCounts['Roadmap Booked'] || 0}`);
    lines.push(`Roadmaps Proposed: ${quarterlyCounts['Roadmap Proposed'] || 0}`);
    if (has('Deal Closed')) lines.push(`Deals Closed: ${quarterlyCounts['Deal Closed'] || 0}`);
  }

  if (topSources.length > 0) {
    lines.push('');
    lines.push('📣 Top Lead Sources');
    for (const s of topSources) {
      lines.push(`${s.name}: ${s.count}`);
    }
  }

  // Attrition
  const lostOutcomes = outcomes.outcomes.filter(o => o.category === 'lost');
  const abandonedOutcomes = outcomes.outcomes.filter(o => o.category === 'abandoned');
  const dqOutcomes = outcomes.outcomes.filter(o => o.category === 'dq');

  const totalLost = lostOutcomes.reduce((sum, o) => sum + (quarterlyCounts[o.name] || 0), 0);
  const totalAbandoned = abandonedOutcomes.reduce((sum, o) => sum + (quarterlyCounts[o.name] || 0), 0);
  const totalDQ = dqOutcomes.reduce((sum, o) => sum + (quarterlyCounts[o.name] || 0), 0);

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
  return { message, counts: quarterlyCounts };
}

module.exports = { generateEOQ, formatQuarter, QUARTER_MONTHS };
