const { getOutcomeNames } = require('../sheets/createCompanySheet');
const { loadConfig } = require('../config/configLoader');

/**
 * Parse a pipe-delimited outcome string.
 * Format: "Lead Type | Answer Status | Action/Outcome | Notes | Source"
 * @returns {{ leadType, answerStatus, action, notes, source }}
 */
function parseOutcome(outcomeStr) {
  if (!outcomeStr) return {};
  const parts = outcomeStr.split('|').map(s => s.trim());
  return {
    leadType: parts[0] || '',
    answerStatus: parts[1] || '',
    action: parts[2] || '',
    notes: parts[3] || '',
    source: parts[4] || '',
  };
}

/**
 * Parse activity log rows into structured objects.
 */
function parseActivityRows(rows, headers) {
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] || '';
    });
    return obj;
  });
}

/**
 * Filter activity log by date and optional sales person.
 */
function filterActivities(activities, targetDate, salesPerson) {
  return activities.filter(a => {
    if (a['Date'] !== targetDate) return false;
    if (salesPerson && salesPerson !== 'Team' && a['Sales Person'] !== salesPerson) return false;
    return true;
  });
}

/**
 * Normalize a contact name for fuzzy matching.
 * "Bradburn, Jody" and "Jody Bradburn" both become "bradburn jody".
 */
function normalizeName(name) {
  return (name || '').split(/[, ]+/).filter(Boolean).map(p => p.toLowerCase()).sort().join(' ');
}

/**
 * Look up the lead source for a contact from all activity rows.
 * Tries in order: contactId → normalized name → partial/first-name match.
 * Gives benefit of the doubt — shortened names, reversed order, etc.
 */
function resolveLeadSource(contactName, contactId, allActivities) {
  const withSource = allActivities.filter(a => a['Ad Source']);

  // 1. Try contactId match
  if (contactId) {
    const byId = withSource.find(a =>
      a['Contact ID'] && a['Contact ID'].trim() === contactId.trim()
    );
    if (byId) return byId['Ad Source'];
  }

  // 2. Try normalized name match (handles "Bradburn, Jody" ↔ "Jody Bradburn")
  const norm = normalizeName(contactName);
  if (norm.length >= 3) {
    const byName = withSource.find(a => normalizeName(a['Contact Name']) === norm);
    if (byName) return byName['Ad Source'];
  }

  // 3. Partial match — if any name part (4+ chars) appears in another contact's name
  const parts = (contactName || '').split(/[, ]+/).filter(p => p.length >= 4).map(p => p.toLowerCase());
  if (parts.length > 0) {
    const byPartial = withSource.find(a => {
      const other = (a['Contact Name'] || '').toLowerCase();
      return parts.some(p => other.includes(p));
    });
    if (byPartial) return byPartial['Ad Source'];
  }

  return '';
}

/**
 * Count outcomes from filtered EOD Update activities.
 * @param {Array} allActivities - ALL activity log rows (for cross-referencing lead sources)
 * @returns {{ counts: {name: count}, names: {name: [contactNames]}, quoteDetails: [...], siteVisits: [...], jobDetails: [...] }}
 */
function countOutcomes(filtered, ownerName, companyName, allActivities) {
  const outcomeNames = getOutcomeNames(ownerName, companyName);
  const counts = {};
  const names = {};
  for (const name of outcomeNames) {
    counts[name] = 0;
    names[name] = [];
  }

  const quoteDetails = []; // { contactName, values: [number] }
  const siteVisits = [];   // { contactName, address, datetime }
  const jobDetails = [];   // { contactName, address, value, source }

  for (const activity of filtered) {
    const eventType = activity['Event Type'];

    if (eventType === 'Quote Sent') {
      const contactName = activity['Contact Name'];
      const valuesStr = activity['Quote/Job Value'] || '';
      const values = valuesStr.split('|').map(v => parseFloat(v.replace(/[$,\s]/g, ''))).filter(v => !isNaN(v));

      // Find existing entry for this contact or create new
      let existing = quoteDetails.find(q => q.contactName === contactName);
      if (existing) {
        existing.values.push(...values);
      } else {
        quoteDetails.push({ contactName, values });
      }

      const outcomeName = `Quote Sent`;
      if (outcomeName in counts) {
        // We count quote events, not individual quote values here
      }
      continue;
    }

    if (eventType === 'Site Visit Booked') {
      siteVisits.push({
        contactName: activity['Contact Name'],
        address: activity['Contact Address'],
        datetime: activity['Appointment Date Time'],
      });
      const outcomeName = 'Site Visit Booked';
      if (outcomeName in counts) {
        counts[outcomeName]++;
        names[outcomeName].push(activity['Contact Name']);
      }
      continue;
    }

    if (eventType === 'Email Sent') {
      const outcomeName = 'Emails Sent';
      if (outcomeName in counts) {
        counts[outcomeName]++;
        names[outcomeName].push(activity['Contact Name']);
      }
      continue;
    }

    if (eventType === 'Job Won') {
      const valuesStr = activity['Quote/Job Value'] || '';
      const value = parseFloat(valuesStr.replace(/[$,\s]/g, '')) || 0;
      let source = activity['Ad Source'] || '';
      if (!source && allActivities) {
        source = resolveLeadSource(activity['Contact Name'], activity['Contact ID'], allActivities);
      }
      jobDetails.push({
        contactName: activity['Contact Name'],
        address: activity['Contact Address'],
        value,
        source,
      });
      const outcomeName = 'Job Won';
      if (outcomeName in counts) {
        counts[outcomeName]++;
        names[outcomeName].push(activity['Contact Name']);
      }
      continue;
    }

    // EOD Update — parse pipe-delimited outcome
    if (eventType === 'EOD Update' || !eventType) {
      const parsed = parseOutcome(activity['Outcome']);
      const contactName = activity['Contact Name'];
      const source = parsed.source || activity['Ad Source'] || '';

      // Lead Type
      if (parsed.leadType && parsed.leadType in counts) {
        counts[parsed.leadType]++;
        names[parsed.leadType].push(contactName);
      }

      // Answer Status
      if (parsed.answerStatus && parsed.answerStatus in counts) {
        counts[parsed.answerStatus]++;
        names[parsed.answerStatus].push(contactName);
      }

      // Action/Outcome
      if (parsed.action) {
        // Handle "Passed Onto {owner}" matching
        let actionKey = parsed.action;
        const passedOntoKey = `Passed Onto ${ownerName}`;
        if (actionKey.startsWith('Passed Onto')) {
          actionKey = passedOntoKey;
        }
        if (actionKey in counts) {
          counts[actionKey]++;
          names[actionKey].push(contactName);
        }
      }

      // Source
      if (source && source in counts) {
        counts[source]++;
        names[source].push(contactName);
      }
    }
  }

  // Compute total calls/contact attempts (works for both "Total Calls" and "Total Contact Attempts")
  const totalAnswered = (counts['Answered'] || 0) + (counts["Didn't Answer"] || 0);
  if ('Total Calls' in counts) counts['Total Calls'] = totalAnswered;
  if ('Total Contact Attempts' in counts) counts['Total Contact Attempts'] = totalAnswered;

  // Compute Quote Sent count and Total Individual Quotes (trade companies)
  if ('Quote Sent' in counts) {
    counts['Quote Sent'] = quoteDetails.length;
  }
  let totalIndividualQuotes = 0;
  for (const q of quoteDetails) {
    totalIndividualQuotes += q.values.length;
  }
  if ('Total Individual Quotes' in counts) {
    counts['Total Individual Quotes'] = totalIndividualQuotes;
  }

  // Compute Pipeline Value (trade companies)
  let pipelineValue = 0;
  for (const q of quoteDetails) {
    if (q.values.length > 0) {
      const avg = q.values.reduce((a, b) => a + b, 0) / q.values.length;
      pipelineValue += avg;
    }
  }
  if ('Pipeline Value' in counts) {
    counts['Pipeline Value'] = Math.round(pipelineValue);
  }

  return { counts, names, quoteDetails, siteVisits, jobDetails };
}

/**
 * Format a date string for the EOD header.
 * "Wednesday 01 Apr"
 */
function formatEODDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+10:00'); // AEST
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  return `${dayName} ${dd} ${mon}`;
}

/**
 * Format a site visit datetime for display.
 * "Fri 06 Feb 9:00am"
 */
function formatVisitDateTime(datetimeStr) {
  if (!datetimeStr) return '';
  try {
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) return datetimeStr;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${hours}:${mins}${ampm}`;
  } catch {
    return datetimeStr;
  }
}

/**
 * Format a dollar value with commas.
 */
function formatDollar(value) {
  return '$' + Math.round(value).toLocaleString('en-AU');
}

/**
 * Build a formatted EOD line for a given outcome based on its formula type.
 */
function formatEODLine(outcomeName, formulaTypeId, data) {
  const { counts, names, quoteDetails, siteVisits, jobDetails } = data;

  switch (formulaTypeId) {
    case 1: // Hidden
      return null;

    case 2: { // Count Only
      const count = counts[outcomeName] || 0;
      if (count === 0) return null;
      return `${outcomeName} - ${count}`;
    }

    case 3: { // Total Count
      const count = counts[outcomeName] || 0;
      if (count === 0) return null;
      return `${outcomeName}: ${count}`;
    }

    case 4: { // Count + Names
      const count = counts[outcomeName] || 0;
      if (count === 0) return null;
      const contactNames = names[outcomeName] || [];
      const uniqueNames = [...new Set(contactNames)].filter(n => n);
      if (uniqueNames.length === 0) return `- ${outcomeName} - ${count}`;
      return `- ${outcomeName} - ${count} - ${uniqueNames.join(', ')}`;
    }

    case 5: { // Section Header
      const count = counts[outcomeName] || 0;
      if (count === 0) return null;
      return `${outcomeName}: ${count}`;
    }

    case 6: { // Quote Details
      const validQuotes = quoteDetails.filter(q => q.contactName || q.values.length > 0);
      if (validQuotes.length === 0) return null;
      const lines = validQuotes.map(q => {
        const valStr = q.values.map(v => formatDollar(v)).join(', ');
        return `- ${q.contactName} - ${q.values.length} - (${valStr})`;
      });
      return lines.join('\n');
    }

    case 7: { // Pipeline Value
      const value = counts['Pipeline Value'] || 0;
      if (value === 0) return null;
      return `Pipeline Value (Sum of Averages): ${formatDollar(value)}`;
    }

    case 8: { // Site Visit
      if (siteVisits.length === 0) return null;
      const lines = siteVisits.map(sv => {
        const dt = formatVisitDateTime(sv.datetime);
        return `- ${sv.contactName} - ${sv.address || 'TBC'} - ${dt || 'TBC'}`;
      });
      return lines.join('\n');
    }

    case 9: { // Job Details
      if (jobDetails.length === 0) return null;
      const lines = jobDetails.map(j => {
        return `- ${j.contactName} - ${j.address || 'N/A'} - ${formatDollar(j.value)} - ${j.source || 'N/A'}`;
      });
      const totalRevenue = jobDetails.reduce((sum, j) => sum + (j.value || 0), 0);
      if (totalRevenue > 0) {
        lines.push(`Total Revenue Generated: ${formatDollar(totalRevenue)}`);
      }
      return lines.join('\n');
    }

    case 10: { // Total Individual Quotes
      const count = counts['Total Individual Quotes'] || 0;
      if (count === 0) return null;
      return `Total Individual Quotes: ${count}`;
    }

    default:
      return null;
  }
}

/**
 * Build the full EOD message.
 */
function buildEODMessage(companyName, dateStr, ownerName, data) {
  const { blocks, formulas } = loadConfig(companyName);
  const dateFormatted = formatEODDate(dateStr);
  const lines = [`EOD Report - ${dateFormatted} - ${companyName}`];
  lines.push('----------------------------');

  for (const block of blocks.eodBlocks) {
    const blockName = block.name.replace('{owner}', ownerName);
    const blockLines = [];

    for (let outcomeTpl of block.outcomes) {
      const outcomeName = outcomeTpl.replace('{owner}', ownerName);
      const formulaEntry = formulas.outcomeFormulas[outcomeTpl] || { eod: 1 };
      const formulaTypeId = formulaEntry.eod;

      const line = formatEODLine(outcomeName, formulaTypeId, data);
      if (line) blockLines.push(line);
    }

    if (blockLines.length > 0) {
      lines.push(blockName);
      lines.push(...blockLines);
      lines.push('----------------------------');
    }
  }

  return lines.join('\n');
}

/**
 * Generate an EOD report for a specific person (or 'Team' for all).
 * @param {string} spreadsheetId
 * @param {string} salesPerson - person name or 'Team'
 * @param {string} targetDate - YYYY-MM-DD
 * @param {string} companyName
 * @param {string} ownerName
 * @returns {Promise<{message: string, counts: object, names: object}>}
 */
async function generateEOD(spreadsheetId, salesPerson, targetDate, companyName, ownerName, activityData) {
  const allRows = activityData;
  if (allRows.length < 2) {
    return { message: 'No activity data found.', counts: {}, names: {} };
  }

  const headers = allRows[0];
  const activities = parseActivityRows(allRows.slice(1), headers);
  const filtered = filterActivities(activities, targetDate, salesPerson);

  if (filtered.length === 0) {
    return { message: `No activities found for ${salesPerson} on ${targetDate}.`, counts: {}, names: {} };
  }

  const data = countOutcomes(filtered, ownerName, companyName, activities);
  const message = buildEODMessage(companyName, targetDate, ownerName, data);

  return { message, counts: data.counts, names: data.names };
}

module.exports = { generateEOD, countOutcomes, parseOutcome, buildEODMessage, resolveLeadSource, normalizeName };
