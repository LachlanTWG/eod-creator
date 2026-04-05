/**
 * Backfill HDK Activity Log with synthetic entries from historical daily aggregate counts.
 * Each daily row of totals produces individual Activity Log entries so storage formulas work.
 *
 * Strategy: for each day, create one EOD Update per call (matching lead type, answer status,
 * and action counts) plus separate Quote Sent entries.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { logActivities } = require('../sheets/logActivity');

const SHEET_ID = '1zVBa27pdR-jGqXLRPkjCzVmYNnsFxv4UlV9AvJwKmd0';
const SALES_PERSON = 'Lachlan';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 3000;

/** Parse "Thursday, 26 June 2025" → "2025-06-26" */
function parseLongDate(str) {
  const months = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
    July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
  // "Thursday, 26 June 2025" or "Monday, 4 August 2025"
  const match = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const mm = months[monthName];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

/** Convert Excel serial number to YYYY-MM-DD */
function excelSerialToDate(serial) {
  const num = parseInt(serial, 10);
  if (isNaN(num) || num < 1) return null;
  const ms = Date.UTC(1900, 0, 1) + (num - 2) * 86400000;
  return new Date(ms).toISOString().split('T')[0];
}

function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (/^\d{5}$/.test(raw)) return excelSerialToDate(raw);
  return parseLongDate(raw);
}

// Column indices (0-based, after Date column)
const COL = {
  newLeads: 1,
  preQuoteFollowUp: 2,
  postQuoteFollowUp: 3,
  answered: 4,
  didntAnswer: 5,
  totalCalls: 6,
  notReadyYet: 7,
  roughFiguresSent: 8,
  siteVisitBooked: 9,
  passedOntoJesse: 10,
  verbalConfirmation: 11,
  rescheduledSiteVisit: 12,
  quoteSent: 13,
  lostPrice: 14,
  lostTimeRelated: 15,
  abandonedNotResponding: 16,
  abandonedHeadache: 17,
  dqOutOfServiceArea: 18,
  dqPrice: 19,
  dqExtentOfWorks: 20,
  dqWrongContactNumber: 21,
  dqSpam: 22,
};

function getVal(parts, idx) {
  return parseInt(parts[idx] || '0', 10) || 0;
}

/**
 * Generate synthetic Activity Log entries for one day's aggregate counts.
 */
function generateDayEntries(date, parts) {
  const entries = [];

  const newLeads = getVal(parts, COL.newLeads);
  const preQuote = getVal(parts, COL.preQuoteFollowUp);
  const postQuote = getVal(parts, COL.postQuoteFollowUp);
  const answered = getVal(parts, COL.answered);
  const didntAnswer = getVal(parts, COL.didntAnswer);

  // Actions (for answered calls)
  const actions = [];
  const notReadyYet = getVal(parts, COL.notReadyYet);
  const roughFigs = getVal(parts, COL.roughFiguresSent);
  const siteVisit = getVal(parts, COL.siteVisitBooked);
  const passedJesse = getVal(parts, COL.passedOntoJesse);
  const verbalConf = getVal(parts, COL.verbalConfirmation);
  const rescheduled = getVal(parts, COL.rescheduledSiteVisit);

  for (let i = 0; i < notReadyYet; i++) actions.push('Not a Good Time');
  for (let i = 0; i < roughFigs; i++) actions.push('Rough Figures Sent');
  for (let i = 0; i < siteVisit; i++) actions.push('Book Site Visit');
  for (let i = 0; i < passedJesse; i++) actions.push('Passed Onto Jesse');
  for (let i = 0; i < verbalConf; i++) actions.push('Verbal Confirmation');
  for (let i = 0; i < rescheduled; i++) actions.push('Rescheduled Site Visit');

  // Loss/Abandoned/DQ actions (also for answered calls typically)
  const lostPrice = getVal(parts, COL.lostPrice);
  const lostTime = getVal(parts, COL.lostTimeRelated);
  const abandNotResp = getVal(parts, COL.abandonedNotResponding);
  const abandHeadache = getVal(parts, COL.abandonedHeadache);
  const dqOOS = getVal(parts, COL.dqOutOfServiceArea);
  const dqPrice = getVal(parts, COL.dqPrice);
  const dqExtent = getVal(parts, COL.dqExtentOfWorks);
  const dqWrong = getVal(parts, COL.dqWrongContactNumber);
  const dqSpam = getVal(parts, COL.dqSpam);

  for (let i = 0; i < lostPrice; i++) actions.push('Lost - Price');
  for (let i = 0; i < lostTime; i++) actions.push('Lost - Time Related');
  for (let i = 0; i < abandNotResp; i++) actions.push('Abandoned - Not Responding');
  for (let i = 0; i < abandHeadache; i++) actions.push('Abandoned - Headache');
  for (let i = 0; i < dqOOS; i++) actions.push('DQ - Out of Service Area');
  for (let i = 0; i < dqPrice; i++) actions.push('DQ - Price');
  for (let i = 0; i < dqExtent; i++) actions.push('DQ - Extent of Works');
  for (let i = 0; i < dqWrong; i++) actions.push('DQ - Wrong Contact / Spam');
  for (let i = 0; i < dqSpam; i++) actions.push('DQ - Wrong Contact / Spam');

  // Build call pool: lead types
  const callPool = [];
  for (let i = 0; i < newLeads; i++) callPool.push('New Leads');
  for (let i = 0; i < preQuote; i++) callPool.push('Pre-Quote Follow Up');
  for (let i = 0; i < postQuote; i++) callPool.push('Post Quote Follow Up');

  // Assign answer statuses
  let answeredRemaining = answered;
  let didntAnswerRemaining = didntAnswer;
  let actionIdx = 0;

  for (let i = 0; i < callPool.length; i++) {
    const leadType = callPool[i];
    let answerStatus, action;

    if (answeredRemaining > 0) {
      answerStatus = 'Answered';
      answeredRemaining--;
      // Assign an action if available
      action = actionIdx < actions.length ? actions[actionIdx++] : '';
    } else if (didntAnswerRemaining > 0) {
      answerStatus = "Didn't Answer";
      didntAnswerRemaining--;
      action = '';
    } else {
      answerStatus = 'Answered';
      action = actionIdx < actions.length ? actions[actionIdx++] : '';
    }

    const outcome = `${leadType} | ${answerStatus} | ${action} |  | `;

    entries.push({
      date,
      salesPerson: SALES_PERSON,
      contactName: '',
      eventType: 'EOD Update',
      outcome,
      adSource: '',
      quoteJobValue: '',
      contactAddress: '',
      contactId: '',
      appointmentDateTime: '',
      appointmentDate: '',
    });
  }

  // If there are remaining answered/didn't answer calls not covered by lead types
  // (shouldn't happen if data is consistent, but handle gracefully)
  while (answeredRemaining > 0) {
    const action = actionIdx < actions.length ? actions[actionIdx++] : '';
    entries.push({
      date, salesPerson: SALES_PERSON, contactName: '', eventType: 'EOD Update',
      outcome: `New Leads | Answered | ${action} |  | `,
      adSource: '', quoteJobValue: '', contactAddress: '', contactId: '',
      appointmentDateTime: '', appointmentDate: '',
    });
    answeredRemaining--;
  }
  while (didntAnswerRemaining > 0) {
    entries.push({
      date, salesPerson: SALES_PERSON, contactName: '', eventType: 'EOD Update',
      outcome: "New Leads | Didn't Answer |  |  | ",
      adSource: '', quoteJobValue: '', contactAddress: '', contactId: '',
      appointmentDateTime: '', appointmentDate: '',
    });
    didntAnswerRemaining--;
  }

  // Quote Sent entries (separate event type)
  const quoteSent = getVal(parts, COL.quoteSent);
  for (let i = 0; i < quoteSent; i++) {
    entries.push({
      date, salesPerson: SALES_PERSON, contactName: '', eventType: 'Quote Sent',
      outcome: 'Quote Sent', adSource: '', quoteJobValue: '',
      contactAddress: '', contactId: '', appointmentDateTime: '', appointmentDate: '',
    });
  }

  return entries;
}

async function main() {
  const tsvPath = path.join(__dirname, 'hdk_historical_counts.tsv');
  const raw = fs.readFileSync(tsvPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const allEntries = [];
  let dayCount = 0;

  for (const line of lines) {
    const parts = line.split(/ {4,}/).map(s => s.trim());
    if (parts[0] === 'Date' || !parts[0]) continue;

    const date = parseDate(parts[0]);
    if (!date) {
      console.log(`  SKIP unparseable date: "${parts[0]}"`);
      continue;
    }

    // Stop before 2026-01-20 — the activity log TSV covers from that date onwards
    if (date >= '2026-01-20') {
      continue;
    }

    const dayEntries = generateDayEntries(date, parts);
    if (dayEntries.length > 0) {
      allEntries.push(...dayEntries);
      dayCount++;
    }
  }

  console.log(`Generated ${allEntries.length} synthetic entries for ${dayCount} days.`);
  if (allEntries.length > 0) {
    console.log(`Date range: ${allEntries[0].date} to ${allEntries[allEntries.length - 1].date}`);
  }

  // Upload in batches
  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allEntries.length / BATCH_SIZE);

    console.log(`Uploading batch ${batchNum}/${totalBatches} (${batch.length} rows)...`);

    try {
      await logActivities(SHEET_ID, batch);
      console.log(`  Batch ${batchNum} done.`);
    } catch (err) {
      console.error(`  Batch ${batchNum} FAILED: ${err.message}`);
      console.log('  Waiting 30s and retrying...');
      await new Promise(r => setTimeout(r, 30000));
      try {
        await logActivities(SHEET_ID, batch);
        console.log(`  Batch ${batchNum} retry succeeded.`);
      } catch (err2) {
        console.error(`  Batch ${batchNum} retry FAILED: ${err2.message}`);
        process.exit(1);
      }
    }

    if (i + BATCH_SIZE < allEntries.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n=== HDK Historical counts backfill complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
