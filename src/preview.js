// preview.js — returns report data as JSON, without sending to Slack/ClickUp or archiving.
// Used by external tools (e.g. Agentic OS web dashboard) to render reports without firing them.

const { readTab } = require('./sheets/readSheet');
const { generateEOD } = require('./reporting/generateEOD');
const { generateEOW } = require('./reporting/generateEOW');
const { generateEOM } = require('./reporting/generateEOM');
const { generateEOQ } = require('./reporting/generateEOQ');
const { generateEOY } = require('./reporting/generateEOY');

function todayInTz(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function getSundayOfWeek(dateStr) {
  const monday = getMondayOfWeek(dateStr);
  const d = new Date(monday + 'T12:00:00Z');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function activePeople(company) {
  return (company.salesPeople || []).filter(p => p.active);
}

async function loadActivityData(company) {
  return readTab(company.sheetId, 'Activity Log');
}

async function previewEOD(company, opts = {}) {
  const tz = company.timezone || 'Australia/Sydney';
  const date = opts.date || todayInTz(tz);
  const activityData = await loadActivityData(company);

  const people = [];
  for (const person of activePeople(company)) {
    const { message, counts, names } = await generateEOD(
      company.sheetId, person.name, date, company.name, company.ownerName, activityData
    );
    people.push({ name: person.name, formatted: message, counts: counts || {}, names: names || {} });
  }

  const team = await generateEOD(
    company.sheetId, 'Team', date, company.name, company.ownerName, activityData
  );

  return {
    company: company.name,
    report: 'eod',
    period: { date },
    team: { formatted: team.message, counts: team.counts || {}, names: team.names || {} },
    people,
  };
}

async function previewEOW(company, opts = {}) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const startDate = opts.startDate || getMondayOfWeek(today);
  const endDate = opts.endDate || getSundayOfWeek(today);
  const activityData = await loadActivityData(company);

  const people = [];
  for (const person of activePeople(company)) {
    const { message, counts } = await generateEOW(
      company.sheetId, person.name, startDate, endDate, company.name, company.ownerName, activityData
    );
    people.push({ name: person.name, formatted: message, counts: counts || {} });
  }

  const team = await generateEOW(
    company.sheetId, 'Team', startDate, endDate, company.name, company.ownerName, activityData
  );

  return {
    company: company.name,
    report: 'eow',
    period: { startDate, endDate },
    team: { formatted: team.message, counts: team.counts || {} },
    people,
  };
}

async function previewEOM(company, opts = {}) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const year = opts.year ? parseInt(opts.year) : parseInt(today.split('-')[0]);
  const month = opts.month ? parseInt(opts.month) : parseInt(today.split('-')[1]);
  const activityData = await loadActivityData(company);

  const people = [];
  for (const person of activePeople(company)) {
    const { message, counts } = await generateEOM(
      company.sheetId, person.name, year, month, company.name, company.ownerName, activityData
    );
    people.push({ name: person.name, formatted: message, counts: counts || {} });
  }

  const team = await generateEOM(
    company.sheetId, 'Team', year, month, company.name, company.ownerName, activityData
  );

  return {
    company: company.name,
    report: 'eom',
    period: { year, month },
    team: { formatted: team.message, counts: team.counts || {} },
    people,
  };
}

async function previewEOQ(company, opts = {}) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const year = opts.year ? parseInt(opts.year) : parseInt(today.split('-')[0]);
  const quarter = opts.quarter
    ? parseInt(opts.quarter)
    : Math.ceil(parseInt(today.split('-')[1]) / 3);
  const activityData = await loadActivityData(company);

  const people = [];
  for (const person of activePeople(company)) {
    const { message, counts } = await generateEOQ(
      company.sheetId, person.name, year, quarter, company.name, company.ownerName, activityData
    );
    people.push({ name: person.name, formatted: message, counts: counts || {} });
  }

  const team = await generateEOQ(
    company.sheetId, 'Team', year, quarter, company.name, company.ownerName, activityData
  );

  return {
    company: company.name,
    report: 'eoq',
    period: { year, quarter },
    team: { formatted: team.message, counts: team.counts || {} },
    people,
  };
}

async function previewEOY(company, opts = {}) {
  const tz = company.timezone || 'Australia/Sydney';
  const today = todayInTz(tz);
  const year = opts.year ? parseInt(opts.year) : parseInt(today.split('-')[0]);

  const people = [];
  for (const person of activePeople(company)) {
    const { message, counts, monthlyBreakdown } = await generateEOY(
      company.sheetId, person.name, year, company.name, company.ownerName
    );
    people.push({
      name: person.name,
      formatted: message,
      counts: counts || {},
      monthlyBreakdown: monthlyBreakdown || [],
    });
  }

  const team = await generateEOY(
    company.sheetId, 'Team', year, company.name, company.ownerName
  );

  return {
    company: company.name,
    report: 'eoy',
    period: { year },
    team: {
      formatted: team.message,
      counts: team.counts || {},
      monthlyBreakdown: team.monthlyBreakdown || [],
    },
    people,
  };
}

module.exports = { previewEOD, previewEOW, previewEOM, previewEOQ, previewEOY };
