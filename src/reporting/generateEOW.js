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
      // Fallback to count when detail arrays aren't available (aggregated from daily)
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
 * Calculate efficiency rates dynamically from the eowBlocks computed config.
 */
function calcEfficiencyRates(weeklyCounts, companyName) {
  const { blocks } = loadConfig(companyName);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  if (!computedBlock) return {};

  const rates = {};
  for (const comp of computedBlock.computed) {
    // Parse formula like "Answered / Total Calls * 100"
    try {
      const formula = comp.formula;
      // Extract the parts: (numerator) / denominator * 100
      // Handle optional parens: "(A + B) / C * 100"
      const match = formula.match(/^\(?(.*?)\)?\s*\/\s*(.*?)\s*\*\s*100$/);
      if (!match) { rates[comp.name] = 0; continue; }

      const numExpr = match[1].trim();
      const denomName = match[2].trim();

      // Evaluate numerator (may have + operations)
      let numerator = 0;
      const numParts = numExpr.split('+').map(s => s.trim());
      for (const part of numParts) {
        numerator += (weeklyCounts[part] || 0);
      }

      const denominator = weeklyCounts[denomName] || 0;
      rates[comp.name] = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
    } catch {
      rates[comp.name] = 0;
    }
  }
  return rates;
}

/**
 * Generate EOW report from daily storage data.
 */
async function generateEOW(spreadsheetId, salesPerson, startDate, endDate, companyName, ownerName) {
  const { blocks, formulas } = loadConfig(companyName);
  const dailyTab = salesPerson === 'Team' ? 'Team Daily' : `${salesPerson} Daily`;
  const allRows = await readTab(spreadsheetId, dailyTab);

  if (allRows.length < 2) {
    return { message: 'No daily data found.', counts: {} };
  }

  const dataRows = allRows.slice(1);
  const weekRows = dataRows.filter(row => {
    let rowDate = row[0];
    // Handle Sheets date serial numbers (e.g. 46043 → 2026-01-21)
    if (/^\d{4,5}$/.test(rowDate)) {
      const d = new Date((parseInt(rowDate) - 25569) * 86400000);
      rowDate = d.toISOString().split('T')[0];
    }
    return rowDate >= startDate && rowDate <= endDate;
  });

  if (weekRows.length === 0) {
    return { message: `No daily data found for ${salesPerson} between ${startDate} and ${endDate}.`, counts: {} };
  }

  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const weeklyCounts = {};
  for (const name of outcomeNames) {
    weeklyCounts[name] = 0;
  }

  for (const row of weekRows) {
    let colIdx = 2;
    for (const name of outcomeNames) {
      const countVal = parseInt(row[colIdx] || '0', 10);
      if (!isNaN(countVal)) {
        weeklyCounts[name] += countVal;
      }
      colIdx += 2;
    }
  }

  // Recompute totals
  const totalAnswered = (weeklyCounts['Answered'] || 0) + (weeklyCounts["Didn't Answer"] || 0);
  if ('Total Calls' in weeklyCounts) weeklyCounts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in weeklyCounts) weeklyCounts['Total Contact Attempts'] = totalAnswered;

  const efficiencyRates = calcEfficiencyRates(weeklyCounts, companyName);

  // Pull Job Won and Site Visit details from Activity Log for the date range
  const weeklyData = { quoteDetails: [], siteVisits: [], jobDetails: [] };
  try {
    const activityRows = await readTab(spreadsheetId, 'Activity Log');
    if (activityRows.length >= 2) {
      const headers = activityRows[0];
      // Parse all rows for cross-referencing lead sources
      const allParsed = activityRows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });

      for (const row of activityRows.slice(1)) {
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
    // If Activity Log read fails, we'll fall back to counts only
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

    if (block.computed) {
      for (const comp of block.computed) {
        const rate = efficiencyRates[comp.name];
        if (rate !== undefined) {
          blockLines.push(`• ${comp.name}: ${rate}%`);
        }
      }
    }

    if (blockLines.length > 0) {
      lines.push(blockName);
      lines.push(...blockLines);
      lines.push('------------------------------------------');
    }
  }

  const message = lines.join('\n');
  return { message, counts: weeklyCounts, efficiencyRates };
}

module.exports = { generateEOW, calcEfficiencyRates };
