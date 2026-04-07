const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');
const { resolveLeadSource } = require('./generateEOD');

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
 * Generate EOM report by reading directly from Activity Log with exact month boundaries.
 */
async function generateEOM(spreadsheetId, salesPerson, year, month, companyName, ownerName, activityData) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const activityRows = activityData;
  if (activityRows.length < 2) {
    return { message: `No data found for ${formatMonth(year, month)}.`, counts: {} };
  }

  const headers = activityRows[0];
  const allParsed = activityRows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });

  // Filter Activity Log rows for this month and person
  const monthRows = activityRows.slice(1).filter(row => {
    const rowDate = row[0] || '';
    if (rowDate < monthStart || rowDate >= nextMonth) return false;
    if (salesPerson !== 'Team' && row[1] !== salesPerson) return false;
    return true;
  });

  if (monthRows.length === 0) {
    return { message: `No data found for ${formatMonth(year, month)}.`, counts: {} };
  }

  // Count outcomes from Activity Log
  const { outcomes, formulas } = loadConfig(companyName);
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const monthlyCounts = {};
  for (const name of outcomeNames) {
    monthlyCounts[name] = 0;
  }

  // Collect Job Won details, site visits, quote details
  const jobDetails = [];
  let totalQuoteValues = 0;
  let totalIndividualQuotes = 0;

  for (const row of monthRows) {
    const eventType = row[3] || '';
    const outcome = row[4] || '';

    if (eventType === 'EOD Update') {
      // Parse outcome: "LeadType | AnswerStatus | Action | Notes | Source"
      for (const o of outcomes.outcomes) {
        const name = o.name.replace('{owner}', ownerName);
        if (!(name in monthlyCounts)) continue;

        switch (o.category) {
          case 'leadType':
            if (outcome.startsWith(`${name} |`)) monthlyCounts[name]++;
            break;
          case 'answerStatus':
            if (outcome.includes(`| ${name} |`)) monthlyCounts[name]++;
            break;
          case 'source':
            if (outcome.includes(`| ${name}`)) monthlyCounts[name]++;
            break;
          default:
            // action, lost, abandoned, dq, etc.
            if (outcome.includes(`| ${name} |`) || outcome.includes(`| ${name}`)) monthlyCounts[name]++;
            break;
        }
      }
    } else if (eventType === 'Job Won') {
      monthlyCounts['Job Won'] = (monthlyCounts['Job Won'] || 0) + 1;
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
      monthlyCounts['Emails Sent'] = (monthlyCounts['Emails Sent'] || 0) + 1;
    } else if (eventType === 'Quote Sent') {
      monthlyCounts['Quote Sent'] = (monthlyCounts['Quote Sent'] || 0) + 1;
      // Count individual quotes and pipeline value from column G (pipe-separated values)
      const valField = (row[6] || '').replace(/[$\s]/g, '');
      if (valField) {
        const parts = valField.split('|').map(v => parseFloat(v.replace(/,/g, '')) || 0);
        totalIndividualQuotes += parts.length;
        const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
        totalQuoteValues += avg;
      }
    } else if (eventType === 'Site Visit Booked') {
      monthlyCounts['Site Visit Booked'] = (monthlyCounts['Site Visit Booked'] || 0) + 1;
    }
  }

  // Set computed counts
  const totalAnswered = (monthlyCounts['Answered'] || 0) + (monthlyCounts["Didn't Answer"] || 0);
  if ('Total Calls' in monthlyCounts) monthlyCounts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in monthlyCounts) monthlyCounts['Total Contact Attempts'] = totalAnswered;
  if ('Pipeline Value' in monthlyCounts) monthlyCounts['Pipeline Value'] = totalQuoteValues;
  if ('Total Individual Quotes' in monthlyCounts) monthlyCounts['Total Individual Quotes'] = totalIndividualQuotes;

  const topSources = getTopSources(monthlyCounts, companyName);

  // Determine what metrics exist for this company
  const has = (name) => outcomeNames.includes(name) || (monthlyCounts[name] !== undefined);

  const monthStr = formatMonth(year, month);
  const lines = [
    `MONTHLY PERFORMANCE REPORT - ${salesPerson || 'Team'} - ${companyName}`,
    `${monthStr}`,
    '==========================================',
    '',
    `📞 Calls`,
  ];

  const totalField = has('Total Calls') ? 'Total Calls' : 'Total Contact Attempts';
  const totalCallCount = monthlyCounts[totalField] || 0;
  const answeredCount = monthlyCounts['Answered'] || 0;
  const pickUpRate = totalCallCount > 0 ? Math.round((answeredCount / totalCallCount) * 100) : 0;
  lines.push(`Total Calls: ${totalCallCount}`);
  lines.push(`Answered: ${answeredCount} | Didn't Answer: ${monthlyCounts["Didn't Answer"] || 0}`);
  if (totalCallCount > 0) lines.push(`Pick Up Rate: ${pickUpRate}%`);

  if (has('New Leads')) {
    const leadParts = [`New Leads: ${monthlyCounts['New Leads'] || 0}`];
    if (monthlyCounts['Pre-Quote Follow Up']) leadParts.push(`Pre-Quote Follow Up: ${monthlyCounts['Pre-Quote Follow Up']}`);
    if (monthlyCounts['Post Quote Follow Up']) leadParts.push(`Post Quote Follow Up: ${monthlyCounts['Post Quote Follow Up']}`);
    if (monthlyCounts['Follow Up']) leadParts.push(`Follow Up: ${monthlyCounts['Follow Up']}`);
    lines.push(`📋 ${leadParts.join(' | ')}`);
  }

  const emailCount = monthlyCounts['Emails Sent'] || 0;
  if (emailCount > 0) {
    lines.push('');
    lines.push(`📧 Emails Sent: ${emailCount}`);
  }

  // Trade-specific metrics
  if (has('Quote Sent')) {
    lines.push('');
    lines.push(`💰 Revenue Pipeline`);
    lines.push(`Quotes Sent: ${monthlyCounts['Quote Sent'] || 0} (${monthlyCounts['Total Individual Quotes'] || 0} individual)`);
    lines.push(`Pipeline Value: ${formatDollar(monthlyCounts['Pipeline Value'] || 0)}`);
    if (has('Site Visit Booked')) lines.push(`Site Visits: ${monthlyCounts['Site Visit Booked'] || 0}`);
    if (has('Job Won')) {
      const jobCount = jobDetails.length > 0 ? jobDetails.length : (monthlyCounts['Job Won'] || 0);
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
    lines.push(`Roadmaps Booked: ${monthlyCounts['Roadmap Booked'] || 0}`);
    lines.push(`Roadmaps Proposed: ${monthlyCounts['Roadmap Proposed'] || 0}`);
    if (has('Deal Closed')) lines.push(`Deals Closed: ${monthlyCounts['Deal Closed'] || 0}`);
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
  return { message, counts: monthlyCounts };
}

module.exports = { generateEOM, formatMonth, getTopSources };
