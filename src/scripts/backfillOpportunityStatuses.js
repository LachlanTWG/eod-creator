// One-off backfill: every opportunity sitting in a dead stage of a client's
// EOD pipeline gets the matching GHL status, per the popup mover's mapping:
//   Lost stage → status "lost"
//   Abandoned stage → status "abandoned"
//   Disqualified stage → status "abandoned"  (GHL has no DQ status; "lost"
//   would drag win rates, so DQ stays distinct via its stage only)
//
// The old "Contact Changed" workflows set these inconsistently (plenty of
// dead-stage opps still "open"; HDK marked DQs "lost") — this makes history
// match what the popup writes from now on.
//
// Usage:
//   node src/scripts/backfillOpportunityStatuses.js            dry run (report only)
//   node src/scripts/backfillOpportunityStatuses.js --apply    write the changes

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { loadCompanies } = require('../config/companiesStore');

const GHL = 'https://services.leadconnectorhq.com';
const H = (t, json) => ({
  Authorization: `Bearer ${t}`, Version: '2021-07-28',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const STAGE_STATUS = { lost: 'lost', abandoned: 'abandoned', disqualified: 'abandoned' };

const apply = process.argv.includes('--apply');

async function allOpportunities(loc, token, pipelineId) {
  const opps = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${GHL}/opportunities/search?location_id=${loc}&pipeline_id=${pipelineId}&limit=100&page=${page}`,
      { headers: H(token) });
    if (!res.ok) throw new Error(`search ${res.status}`);
    const batch = (await res.json()).opportunities || [];
    opps.push(...batch);
    if (batch.length < 100) break;
  }
  return opps;
}

async function main() {
  const tokens = JSON.parse(process.env.GHL_LOCATION_TOKENS || '{}');
  const { companies } = loadCompanies();
  let totalFixed = 0, totalFailed = 0;

  for (const c of companies) {
    const token = tokens[c.ghlLocationId];
    if (!token) { console.log(`■ ${c.name}: no token, skipped`); continue; }

    const pr = await fetch(`${GHL}/opportunities/pipelines?locationId=${c.ghlLocationId}`, { headers: H(token) });
    const pipe = ((await pr.json()).pipelines || []).find(p => (p.stages || []).some(s => norm(s.name) === 'day1'));
    if (!pipe) { console.log(`■ ${c.name}: no EOD pipeline, skipped`); continue; }

    const deadStages = new Map(); // stageId → wanted status
    for (const s of pipe.stages) {
      const status = STAGE_STATUS[norm(s.name)];
      if (status) deadStages.set(s.id, { status, name: s.name });
    }

    const opps = await allOpportunities(c.ghlLocationId, token, pipe.id);
    const wrong = opps.filter(o => {
      const dead = deadStages.get(o.pipelineStageId);
      return dead && (o.status || 'open') !== dead.status;
    });

    console.log(`■ ${c.name}: ${opps.length} opps in pipeline, ${wrong.length} need a status fix`);
    for (const o of wrong) {
      const dead = deadStages.get(o.pipelineStageId);
      const label = `   ${o.name || o.id} | ${dead.name}: ${o.status || 'open'} → ${dead.status}`;
      if (!apply) { console.log(label); continue; }
      const res = await fetch(`${GHL}/opportunities/${o.id}`, {
        method: 'PUT', headers: H(token, true),
        body: JSON.stringify({ pipelineId: pipe.id, pipelineStageId: o.pipelineStageId, status: dead.status }),
      });
      if (res.ok) { totalFixed++; console.log(label + ' ✓'); }
      else { totalFailed++; console.log(label + ` ✗ HTTP ${res.status}`); }
    }
  }

  console.log(apply
    ? `\nDone: ${totalFixed} fixed, ${totalFailed} failed.`
    : '\nDry run only — re-run with --apply to write.');
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
