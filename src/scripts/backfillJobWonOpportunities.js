// Backfill GHL opportunities from recent activities.job_won rows:
//   - status → "won"
//   - stage → Accepted / Deposit Paid / Job Won / Verbal Confirmation (when found)
//   - monetaryValue → activity quote_job_value
//
// Mirrors dashboard/src/app/eod-entry/ghlPipeline.ts job-won path.
//
// Usage:
//   node src/scripts/backfillJobWonOpportunities.js                 dry run
//   node src/scripts/backfillJobWonOpportunities.js --apply         write
//   node src/scripts/backfillJobWonOpportunities.js --days 60       last N days (default 90)
//   node src/scripts/backfillJobWonOpportunities.js --company HDK   filter by company name substring

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');

const GHL = 'https://services.leadconnectorhq.com';
const H = (t, json) => ({
  Authorization: `Bearer ${t}`,
  Version: '2021-07-28',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.find((a, i, arr) => arr[i - 1] === '--days');
const DAYS = daysArg ? Math.max(1, parseInt(daysArg, 10) || 90) : 90;
const companyArg = process.argv.find((a, i, arr) => arr[i - 1] === '--company');
const COMPANY_FILTER = companyArg ? companyArg.toLowerCase() : '';

const WON_STAGES = [
  'Accepted',
  'Accepted - Needs Scheduling',
  'Deposit Paid / Job Won',
  'Verbal Confirmation',
];

function parseMonetaryValue(raw) {
  if (raw == null || raw === '') return null;
  const first = String(raw).split('|')[0].replace(/[$,\s]/g, '').trim();
  if (!first) return null;
  const n = Number(first);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function findStage(stages, candidates) {
  for (const c of candidates) {
    const prefix = c.endsWith('*');
    const n = norm(prefix ? c.slice(0, -1) : c);
    const hit = prefix
      ? stages.find(s => norm(s.name).startsWith(n))
      : stages.find(s => norm(s.name) === n);
    if (hit) return hit;
  }
  return null;
}

async function findOpportunity(loc, token, contactId, pipelineId) {
  const res = await fetch(
    `${GHL}/opportunities/search?location_id=${loc}&contact_id=${encodeURIComponent(contactId)}&limit=20`,
    { headers: H(token) },
  );
  if (!res.ok) throw new Error(`search ${res.status}`);
  const opps = (await res.json()).opportunities || [];
  const inPipe = opps.filter(o => o.pipelineId === pipelineId);
  // Prefer open, else most recent any-status (re-patch already-won).
  const open = inPipe.filter(o => (o.status || 'open') === 'open');
  const pool = open.length ? open : inPipe;
  pool.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return pool[0] || null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const tokens = JSON.parse(process.env.GHL_LOCATION_TOKENS || '{}');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: activities } = await c.query(
    `
    select a.id, a.occurred_on::text as occurred_on,
           a.contact_name, a.contact_id, a.quote_job_value,
           co.name as company_name, co.ghl_location_id
    from activities a
    join companies co on a.company_id = co.id
    where a.event_type = 'job_won'
      and co.active = true
      and a.occurred_on >= current_date - ($1::int * interval '1 day')
      and a.contact_id is not null
      and trim(a.contact_id) <> ''
    -- Oldest first so a contact with multiple wins ends on the *latest*
    -- job's stage/value (each apply overwrites the previous).
    order by a.occurred_on asc, co.name, a.contact_name
    `,
    [DAYS],
  );

  let rows = activities;
  if (COMPANY_FILTER) {
    rows = rows.filter(r => r.company_name.toLowerCase().includes(COMPANY_FILTER));
  }

  console.log(`\nJob Won → GHL opportunity backfill`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  ·  last ${DAYS} days  ·  ${rows.length} activities with contact_id`);
  if (COMPANY_FILTER) console.log(`Company filter: ${COMPANY_FILTER}`);
  console.log('─'.repeat(72));

  // Cache pipeline per location
  const pipeCache = new Map(); // loc → { id, stages, stageById } | null | 'no-token'

  async function getPipeline(loc, token) {
    if (pipeCache.has(loc)) return pipeCache.get(loc);
    const pr = await fetch(`${GHL}/opportunities/pipelines?locationId=${loc}`, { headers: H(token) });
    if (pr.status === 401 || pr.status === 403) {
      pipeCache.set(loc, 'unauthorized');
      return 'unauthorized';
    }
    if (!pr.ok) {
      pipeCache.set(loc, null);
      return null;
    }
    const pipes = (await pr.json()).pipelines || [];
    const eod = pipes.find(p => (p.stages || []).some(s => norm(s.name) === 'day1'));
    if (!eod) {
      pipeCache.set(loc, null);
      return null;
    }
    const stages = eod.stages || [];
    const stageById = new Map(stages.map(s => [s.id, s]));
    const info = { id: eod.id, stages, stageById };
    pipeCache.set(loc, info);
    return info;
  }

  let updated = 0, skipped = 0, failed = 0, already = 0, noOpp = 0;

  for (const a of rows) {
    const loc = a.ghl_location_id;
    const token = tokens[loc];
    const value = parseMonetaryValue(a.quote_job_value);
    const label = `${a.occurred_on} | ${a.company_name} | ${(a.contact_name || '?').slice(0, 28)} | $${value ?? '—'}`;

    if (!loc || !token) {
      console.log(`SKIP  ${label}  (no location token)`);
      skipped++;
      continue;
    }

    let pipe;
    try {
      pipe = await getPipeline(loc, token);
    } catch (e) {
      console.log(`FAIL  ${label}  (pipeline: ${e.message})`);
      failed++;
      continue;
    }
    if (pipe === 'unauthorized') {
      console.log(`SKIP  ${label}  (token missing opportunity scopes)`);
      skipped++;
      continue;
    }
    if (!pipe) {
      console.log(`SKIP  ${label}  (no EOD pipeline)`);
      skipped++;
      continue;
    }

    let opp;
    try {
      opp = await findOpportunity(loc, token, a.contact_id, pipe.id);
    } catch (e) {
      console.log(`FAIL  ${label}  (search: ${e.message})`);
      failed++;
      continue;
    }

    const wonStage = findStage(pipe.stages, [
      'Accepted',
      'Accepted - Needs Scheduling*',
      'Deposit Paid / Job Won',
      'Verbal Confirmation',
    ]);

    if (!opp) {
      // Create a won opportunity so the deal isn't missing from the pipeline.
      const stage = wonStage || findStage(pipe.stages, ['Day 1']);
      if (!stage) {
        console.log(`SKIP  ${label}  (no opp + no stage to create)`);
        noOpp++;
        continue;
      }
      const body = {
        locationId: loc,
        contactId: a.contact_id,
        pipelineId: pipe.id,
        pipelineStageId: stage.id,
        name: a.contact_name || 'Job Won',
        status: 'won',
        ...(value != null ? { monetaryValue: value } : {}),
      };
      const action = `CREATE at ${stage.name} · won${value != null ? ` · $${value}` : ''}`;
      if (!APPLY) {
        console.log(`WOULD ${label}  → ${action}`);
        updated++;
        continue;
      }
      try {
        const res = await fetch(`${GHL}/opportunities/`, {
          method: 'POST',
          headers: H(token, true),
          body: JSON.stringify(body),
        });
        if (res.ok) {
          console.log(`OK    ${label}  → ${action}`);
          updated++;
        } else {
          const t = await res.text().catch(() => '');
          console.log(`FAIL  ${label}  create HTTP ${res.status} ${t.slice(0, 80)}`);
          failed++;
        }
      } catch (e) {
        console.log(`FAIL  ${label}  create ${e.message}`);
        failed++;
      }
      // small pace so we don't hammer GHL
      await new Promise(r => setTimeout(r, 80));
      continue;
    }

    const currentStage = pipe.stageById.get(opp.pipelineStageId);
    const targetStage = wonStage || currentStage;
    if (!targetStage) {
      console.log(`SKIP  ${label}  (opp stage missing from pipeline)`);
      skipped++;
      continue;
    }

    const curStatus = opp.status || 'open';
    const curValue = opp.monetaryValue == null || opp.monetaryValue === ''
      ? null
      : Number(opp.monetaryValue);
    const sameStage = opp.pipelineStageId === targetStage.id;
    const sameStatus = curStatus === 'won';
    const sameValue = value == null || (curValue != null && Number(curValue) === value);

    if (sameStage && sameStatus && sameValue) {
      console.log(`OK    ${label}  already won @ ${targetStage.name}${value != null ? ` $${value}` : ''}`);
      already++;
      continue;
    }

    const body = {
      pipelineId: pipe.id,
      pipelineStageId: targetStage.id,
      status: 'won',
      ...(value != null ? { monetaryValue: value } : {}),
    };
    const bits = [];
    if (!sameStage) bits.push(`${currentStage?.name || '?'} → ${targetStage.name}`);
    else bits.push(`@ ${targetStage.name}`);
    if (!sameStatus) bits.push(`${curStatus} → won`);
    else bits.push('won');
    if (value != null && !sameValue) bits.push(`value ${curValue ?? '—'} → $${value}`);
    else if (value != null) bits.push(`$${value}`);
    const action = bits.join(' · ');

    if (!APPLY) {
      console.log(`WOULD ${label}  → ${action}`);
      updated++;
      continue;
    }

    try {
      const res = await fetch(`${GHL}/opportunities/${opp.id}`, {
        method: 'PUT',
        headers: H(token, true),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        console.log(`OK    ${label}  → ${action}`);
        updated++;
      } else {
        const t = await res.text().catch(() => '');
        console.log(`FAIL  ${label}  HTTP ${res.status} ${t.slice(0, 80)}`);
        failed++;
      }
    } catch (e) {
      console.log(`FAIL  ${label}  ${e.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 80));
  }

  await c.end();
  console.log('─'.repeat(72));
  console.log(
    APPLY
      ? `Done: ${updated} updated/created, ${already} already correct, ${skipped} skipped, ${noOpp} no-opp, ${failed} failed.`
      : `Dry run: ${updated} would update/create, ${already} already correct, ${skipped} skipped, ${noOpp} no-opp, ${failed} failed.\nRe-run with --apply to write.`,
  );
}

main().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
