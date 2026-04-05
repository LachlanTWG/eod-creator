/**
 * Import historical daily call tracking data (June 2025 - Jan 2026) into Activity Log.
 *
 * The TSV has aggregated daily COUNTS per outcome. We generate synthetic EOD Update
 * entries with proper outcome strings: "LeadType | AnswerStatus | Action | | "
 *
 * Usage: node src/scripts/importHistoricalCalls.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1MMJvJPgx5BStabEcOjd2Uphcp9NASPkvDhlXqjWkR0c';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

// Column name mapping: TSV header -> config outcome name
const COLUMN_MAP = {
  'New Leads': 'New Leads',
  'Pre-Quote Follow Up': 'Pre-Quote Follow Up',
  'Post-Quote Follow Up': 'Post Quote Follow Up',
  'Answered': 'Answered',
  "Didn't Answer": "Didn't Answer",
  'Total Calls': null, // computed, skip
  'Not Ready Yet': 'Not Ready Yet - Pre-Quote',
  'Requires Quoting': 'Requires Quoting',
  'Quote Sent': 'Quote Sent',
  'Site Visit Booked': 'Site Visit Booked',
  'Passed Onto Jed': 'Passed Onto Jed',
  'Verbal Confirmation': 'Verbal Confirmation',
  'Rescheduled Site Visit': null, // not in current config, skip
  'Lost - Price': 'Lost - Price',
  'Lost - Time Ralted': 'Lost - Time Related', // typo in TSV
  'Abandoned - Not Responding': 'Abandoned - Not Responding',
  'Abandoned - Headache': 'Abandoned - Headache',
  'Disqualified - Out of Service Area': 'DQ - Out of Service Area',
  'Disqualified - Price': 'DQ - Price',
  'Disqualified - Extent of Works': 'DQ - Extent of Works',
  'Disqualified - Wrong Contact/Number': 'DQ - Wrong Contact / Spam',
  'Disqualified - Spam': 'DQ - Wrong Contact / Spam', // merge into same
};

// Categories for outcome string construction
const LEAD_TYPES = ['New Leads', 'Pre-Quote Follow Up', 'Post Quote Follow Up'];
const ANSWER_STATUSES = ['Answered', "Didn't Answer"];
const ACTIONS = [
  'Not Ready Yet - Pre-Quote', 'Requires Quoting', 'Passed Onto Jed',
  'Verbal Confirmation', 'Lost - Price', 'Lost - Time Related',
  'Abandoned - Not Responding', 'Abandoned - Headache',
  'DQ - Out of Service Area', 'DQ - Price', 'DQ - Extent of Works',
  'DQ - Wrong Contact / Spam',
];
const SEPARATE_EVENTS = ['Quote Sent', 'Site Visit Booked'];

/**
 * Parse date like "Monday, 23 June 2025" to "2025-06-23"
 */
function parseDate(dateStr) {
  const months = {
    'January': '01', 'February': '02', 'March': '03', 'April': '04',
    'May': '05', 'June': '06', 'July': '07', 'August': '08',
    'September': '09', 'October': '10', 'November': '11', 'December': '12',
  };
  // "Monday, 23 June 2025"
  const match = dateStr.match(/(\d+)\s+(\w+)\s+(\d{4})/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = months[match[2]];
  const year = match[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Parse the TSV file into daily count objects.
 */
function parseTSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Parse header
  const headerParts = lines[0].split('    ').map(h => h.trim()).filter(Boolean);
  const headers = headerParts.slice(1); // skip Date column

  const datePattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/;
  const days = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Date') || !datePattern.test(line)) continue;

    const parts = line.split('    ').map(p => p.trim()).filter(p => p !== '');
    const dateStr = parts[0];
    const date = parseDate(dateStr);
    if (!date) {
      console.log(`  Skipping unparseable date: ${dateStr}`);
      continue;
    }

    const counts = {};
    for (let j = 0; j < headers.length; j++) {
      const configName = COLUMN_MAP[headers[j]];
      if (!configName) continue;
      const val = parseInt(parts[j + 1]) || 0;
      // For DQ - Wrong Contact / Spam, accumulate from both TSV columns
      counts[configName] = (counts[configName] || 0) + val;
    }

    days.push({ date, dateStr, counts });
  }

  return days;
}

/**
 * Generate Activity Log entries from daily counts.
 *
 * Strategy:
 * - Each call needs a leadType + answerStatus. Actions only apply to answered calls.
 * - Distribute lead types across answered/unanswered proportionally.
 * - Assign actions to answered calls.
 * - Quote Sent and Site Visit Booked are separate event types.
 */
function generateEntries(day) {
  const { date, counts } = day;
  const entries = [];

  // Get lead type counts
  const leadCounts = {};
  let totalLeads = 0;
  for (const lt of LEAD_TYPES) {
    leadCounts[lt] = counts[lt] || 0;
    totalLeads += leadCounts[lt];
  }

  const answered = counts['Answered'] || 0;
  const didntAnswer = counts["Didn't Answer"] || 0;
  const totalCalls = answered + didntAnswer;

  // Get action counts (these are subsets of answered calls)
  const actionCounts = {};
  let totalActions = 0;
  for (const a of ACTIONS) {
    actionCounts[a] = counts[a] || 0;
    totalActions += actionCounts[a];
  }

  // If no calls and no actions, nothing to generate for EOD Updates
  if (totalCalls === 0 && totalLeads === 0 && totalActions === 0) {
    // Still check for separate events
  } else {
    // Build entries by distributing lead types across answered/unanswered
    // Then assign actions to answered calls

    // Create pools of lead type labels
    const leadPool = [];
    for (const lt of LEAD_TYPES) {
      for (let i = 0; i < leadCounts[lt]; i++) {
        leadPool.push(lt);
      }
    }

    // Create pool of action labels for answered calls (cap at answered count)
    const actionPool = [];
    for (const a of ACTIONS) {
      for (let i = 0; i < actionCounts[a]; i++) {
        actionPool.push(a);
      }
    }

    // The number of EOD Update entries = max(totalLeads, totalCalls)
    // Each entry gets a leadType + answerStatus, and answered entries may get an action.
    // Cap actions at answered count to keep Answered/Didn't Answer counts accurate.
    let answeredRemaining = answered;
    let didntAnswerRemaining = didntAnswer;
    let leadIdx = 0;
    let actionIdx = 0;

    // First: create entries for answered calls with actions (cap at answered count)
    while (actionIdx < actionPool.length && answeredRemaining > 0) {
      const action = actionPool[actionIdx];
      const leadType = leadIdx < leadPool.length ? leadPool[leadIdx] : 'New Leads';
      const outcome = `${leadType} | Answered | ${action} | | `;

      entries.push({
        date,
        salesPerson: SALES_PERSON,
        contactName: '',
        eventType: 'EOD Update',
        outcome,
      });

      leadIdx++;
      actionIdx++;
      answeredRemaining--;
    }

    // Next: remaining answered calls without specific actions
    while (answeredRemaining > 0) {
      const leadType = leadIdx < leadPool.length ? leadPool[leadIdx] : 'New Leads';
      const outcome = `${leadType} | Answered | | | `;

      entries.push({
        date,
        salesPerson: SALES_PERSON,
        contactName: '',
        eventType: 'EOD Update',
        outcome,
      });

      leadIdx++;
      answeredRemaining--;
    }

    // Next: unanswered calls
    while (didntAnswerRemaining > 0) {
      const leadType = leadIdx < leadPool.length ? leadPool[leadIdx] : 'New Leads';
      const outcome = `${leadType} | Didn't Answer | | | `;

      entries.push({
        date,
        salesPerson: SALES_PERSON,
        contactName: '',
        eventType: 'EOD Update',
        outcome,
      });

      leadIdx++;
      didntAnswerRemaining--;
    }

    // If there are remaining lead types not assigned (leadIdx < leadPool.length)
    // This happens when totalLeads > totalCalls — create extra answered entries
    while (leadIdx < leadPool.length) {
      const leadType = leadPool[leadIdx];
      const outcome = `${leadType} | Answered | | | `;

      entries.push({
        date,
        salesPerson: SALES_PERSON,
        contactName: '',
        eventType: 'EOD Update',
        outcome,
      });

      leadIdx++;
    }
  }

  // Separate event types
  for (const eventName of SEPARATE_EVENTS) {
    const count = counts[eventName] || 0;
    for (let i = 0; i < count; i++) {
      entries.push({
        date,
        salesPerson: SALES_PERSON,
        contactName: '',
        eventType: eventName,
        outcome: '',
      });
    }
  }

  return entries;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tsvPath = path.join(__dirname, 'historical_calls.tsv');

  console.log('Parsing historical call data...');
  const days = parseTSV(tsvPath);
  console.log(`Found ${days.length} days of data (${days[0]?.date} to ${days[days.length - 1]?.date})`);

  // Generate all entries
  let allEntries = [];
  for (const day of days) {
    const entries = generateEntries(day);
    allEntries.push(...entries);
  }

  console.log(`Generated ${allEntries.length} Activity Log entries`);

  // Summary by month
  const monthCounts = {};
  for (const e of allEntries) {
    const month = e.date.substring(0, 7);
    monthCounts[month] = (monthCounts[month] || 0) + 1;
  }
  for (const [month, count] of Object.entries(monthCounts).sort()) {
    console.log(`  ${month}: ${count} entries`);
  }

  if (dryRun) {
    console.log('\n=== DRY RUN - no data uploaded ===');
    console.log('\nSample entries (first 5):');
    for (const e of allEntries.slice(0, 5)) {
      console.log(`  ${e.date} | ${e.eventType} | ${e.outcome}`);
    }
    console.log('\nSample entries (last 5):');
    for (const e of allEntries.slice(-5)) {
      console.log(`  ${e.date} | ${e.eventType} | ${e.outcome}`);
    }
    return;
  }

  // Upload in batches
  console.log(`\nUploading ${allEntries.length} entries in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allEntries.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} rows)...`);

    try {
      await logActivities(SHEET_ID, batch);
      console.log(`  Done.`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      console.log('  Waiting 30s and retrying...');
      await new Promise(r => setTimeout(r, 30000));
      try {
        await logActivities(SHEET_ID, batch);
        console.log(`  Retry succeeded.`);
      } catch (err2) {
        console.error(`  Retry FAILED: ${err2.message}`);
        process.exit(1);
      }
    }

    if (i + BATCH_SIZE < allEntries.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n=== Import complete ===');
  console.log('Storage tabs will automatically reflect the new data (formula-driven).');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
