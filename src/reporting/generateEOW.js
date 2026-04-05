const { readTab } = require('../sheets/readSheet');
const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');
const { resolveLeadSource, normalizeName } = require('./generateEOD');

function formatFullDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+10:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDollar(value) {
  return '$' + Math.round(value).toLocaleString('en-AU');
}

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

function formatEOWLine(outcomeName, formulaTypeId, weeklyCounts, weeklyData) {
  switch (formulaTypeId) {
    case 1: return null;

    case 11: {
      const count = weeklyCounts[outcomeName] || 0;
      if (count === 0) return null;
      return `• ${outcomeName}: ${count}`;
    }

    case 12: {
      // Calls Summary — works with both "Total Calls" and "Total Contact Attempts"
      const totalCalls = weeklyCounts['Total Calls'] || weeklyCounts['Total Contact Attempts'] || 0;
      if (totalCalls === 0) return null;
      const answered = weeklyCounts['Answered'] || 0;
      const rate = Math.round((answered / totalCalls) * 100);
      return `• Total Calls: ${totalCalls} (${rate}% Answered)`;
    }

    case 6: {
      if (weeklyData.quoteDetails && weeklyData.quoteDetails.length > 0) {
        const lines = weeklyData.quoteDetails.map(q => {
          const valStr = q.values.map(v => formatDollar(v)).join(', ');
          return `• ${q.contactName} - ${q.values.length} - (${valStr})`;
        });
        return lines.join('\n');
      }
      const quoteCount = weeklyCounts[outcomeName] || 0;
      if (quoteCount === 0) return null;
      return `• ${outcomeName}: ${quoteCount}`;
    }

    case 7: {
      const value = weeklyCounts['Pipeline Value'] || 0;
      if (value === 0) return null;
      return `Pipeline Value (Sum of Averages): ${formatDollar(value)}`;
    }

    case 8: {
      if (weeklyData.siteVisits && weeklyData.siteVisits.length > 0) {
        const lines = weeklyData.siteVisits.map(sv => {
          return `• ${sv.contactName} - ${sv.address || 'TBC'} - ${sv.datetime || 'TBC'}`;
        });
        return lines.join('\n');
      }
      const svCount = weeklyCounts[outcomeName] || 0;
      if (svCount === 0) return null;
      return `• ${outcomeName}: ${svCount}`;
    }

    case 9: {
      if (weeklyData.jobDetails && weeklyData.jobDetails.length > 0) {
        const lines = weeklyData.jobDetails.map(j => {
          return `• ${j.contactName} - ${j.address || 'N/A'} - ${formatDollar(j.value)} - ${j.source || 'N/A'}`;
        });
        const totalRevenue = weeklyData.jobDetails.reduce((sum, j) => sum + (j.value || 0), 0);
        if (totalRevenue > 0) {
          lines.push(`Total Revenue Generated: ${formatDollar(totalRevenue)}`);
        }
        return lines.join('\n');
      }
      const jobCount = weeklyCounts[outcomeName] || 0;
      if (jobCount === 0) return null;
      return `• ${outcomeName}: ${jobCount}`;
    }

    case 10: {
      const count = weeklyCounts['Total Individual Quotes'] || 0;
      if (count === 0) return null;
      return `Total Individual Quotes: ${count}`;
    }

    case 2:
    case 3: {
      const count = weeklyCounts[outcomeName] || 0;
      if (count === 0) return null;
      return `• ${outcomeName}: ${count}`;
    }

    case 4: {
      const count = weeklyCounts[outcomeName] || 0;
      if (count === 0) return null;
      return `• ${outcomeName}: ${count}`;
    }

    default:
      return null;
  }
}

/**
 * Generate EOW report from live Weekly Storage formulas.
 * Falls back to Activity Log aggregation if the weekly row doesn't exist.
 */
async function generateEOW(spreadsheetId, salesPerson, startDate, endDate, companyName, ownerName, activityData) {
  const { blocks, formulas } = loadConfig(companyName);
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const weeklyTab = salesPerson === 'Team' ? 'Team Weekly' : `${salesPerson} Weekly`;

  // Read live counts from Weekly Storage (formula-driven)
  const weeklyRows = await readTab(spreadsheetId, weeklyTab);
  let weeklyCounts = null;

  if (weeklyRows.length >= 2) {
    const weekRow = weeklyRows.slice(1).find(row => {
      return parseSerialDate(row[0]) === startDate;
    });

    if (weekRow) {
      weeklyCounts = {};
      let colIdx = 3; // Weekly: Start | End | Message | counts...
      for (const name of outcomeNames) {
        const val = parseFloat(weekRow[colIdx] || '0');
        weeklyCounts[name] = isNaN(val) ? 0 : val;
        colIdx++;
      }
    }
  }

  // Fall back to Activity Log if weekly row doesn't exist
  if (!weeklyCounts) {
    weeklyCounts = {};
    for (const name of outcomeNames) {
      weeklyCounts[name] = 0;
    }

    if (activityData && activityData.length >= 2) {
      const headers = activityData[0];
      for (const row of activityData.slice(1)) {
        const rowDate = row[0];
        if (rowDate < startDate || rowDate > endDate) continue;
        if (salesPerson !== 'Team' && row[1] !== salesPerson) continue;
        // Basic counting from Activity Log as fallback
        const eventType = row[3] || '';
        const outcome = row[4] || '';
        if (eventType === 'EOD Update') {
          const { outcomes } = loadConfig(companyName);
          for (const o of outcomes.outcomes) {
            const name = o.name.replace('{owner}', ownerName);
            if (!(name in weeklyCounts)) continue;
            switch (o.category) {
              case 'leadType': if (outcome.startsWith(`${name} |`)) weeklyCounts[name]++; break;
              case 'answerStatus': if (outcome.includes(`| ${name} |`)) weeklyCounts[name]++; break;
              case 'source': if (outcome.includes(`| ${name}`)) weeklyCounts[name]++; break;
              default: if (outcome.includes(`| ${name} |`) || outcome.includes(`| ${name}`)) weeklyCounts[name]++; break;
            }
          }
        } else if (eventType === 'Job Won') { weeklyCounts['Job Won'] = (weeklyCounts['Job Won'] || 0) + 1; }
        else if (eventType === 'Quote Sent') { weeklyCounts['Quote Sent'] = (weeklyCounts['Quote Sent'] || 0) + 1; }
        else if (eventType === 'Site Visit Booked') { weeklyCounts['Site Visit Booked'] = (weeklyCounts['Site Visit Booked'] || 0) + 1; }
        else if (eventType === 'Email Sent') { weeklyCounts['Emails Sent'] = (weeklyCounts['Emails Sent'] || 0) + 1; }
      }
    }

    // Recompute totals for fallback path
    const totalAnswered = (weeklyCounts['Answered'] || 0) + (weeklyCounts["Didn't Answer"] || 0);
    if ('Total Calls' in weeklyCounts) weeklyCounts['Total Calls'] = totalAnswered;
    if ('Total Contact Attempts' in weeklyCounts) weeklyCounts['Total Contact Attempts'] = totalAnswered;
  }

  // Pull Job Won and Site Visit details from Activity Log
  const weeklyData = { quoteDetails: [], siteVisits: [], jobDetails: [] };
  try {
    if (activityData && activityData.length >= 2) {
      const headers = activityData[0];
      const allParsed = activityData.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });

      for (const row of activityData.slice(1)) {
        const rowDate = row[0];
        if (rowDate < startDate || rowDate > endDate) continue;
        if (salesPerson !== 'Team' && row[1] !== salesPerson) continue;
        const eventType = row[3];
        if (eventType === 'Job Won') {
          const valStr = (row[6] || '').replace(/[$,\s]/g, '');
          let source = row[5] || '';
          if (!source) {
            source = resolveLeadSource(row[2], row[8], allParsed);
          }
          weeklyData.jobDetails.push({
            contactName: row[2] || '',
            address: (row[7] || '').replace(/,\s*$/, '').trim(),
            value: parseFloat(valStr) || 0,
            source,
          });
        } else if (eventType === 'Site Visit Booked') {
          weeklyData.siteVisits.push({
            contactName: row[2] || '',
            address: (row[7] || '').replace(/,\s*$/, '').trim(),
            datetime: row[9] || '',
          });
        }
      }
    }
  } catch (e) {
    console.error('  Could not read Activity Log for EOW details:', e.message);
  }

  const startFormatted = formatFullDate(startDate);
  const endFormatted = formatFullDate(endDate);
  const lines = [
    `SALES EXECUTIVE PERFORMANCE REPORT - ${companyName}`,
    `Dates: ${startFormatted} - ${endFormatted}`,
    '------------------------------------------',
  ];

  for (const block of blocks.eowBlocks) {
    const blockName = block.name.replace('{owner}', ownerName);
    const blockLines = [];

    if (block.outcomes) {
      for (let outcomeTpl of block.outcomes) {
        const outcomeName = outcomeTpl.replace('{owner}', ownerName);
        const formulaEntry = formulas.outcomeFormulas[outcomeTpl] || { eow: 1 };
        const formulaTypeId = formulaEntry.eow;
        const line = formatEOWLine(outcomeName, formulaTypeId, weeklyCounts, weeklyData);
        if (line) blockLines.push(line);
      }
    }

    if (blockLines.length > 0) {
      lines.push(blockName);
      lines.push(...blockLines);
      lines.push('------------------------------------------');
    }
  }

  const message = lines.join('\n');
  return { message, counts: weeklyCounts };
}

module.exports = { generateEOW };
