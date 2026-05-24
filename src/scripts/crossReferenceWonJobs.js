// Cross-reference activities.job_won (since 2026-01-01) with existing
// won_jobs rows (invoice imports) and seed missing verbal-confirmation rows.
//
// Pipeline:
//   1. Pull every job_won activity from 2026-01-01 onwards (active clients).
//   2. For each, check if a won_jobs row already references it (source_activity_id).
//   3. If not, fuzzy-match against existing won_jobs by:
//        - same company
//        - normalised contact-name match (case-insensitive, word-set equality)
//        - invoice date within [activity_date - 14d, activity_date + 180d]
//      (value isn't a reliable key — Quotie value drifts from final invoice
//      via discounts/variations, per Lachlan)
//   4. If matched: link the won_job to the source activity. Update contact_id
//      and job_value if the won_job has them blank.
//   5. If unmatched: insert a new won_jobs row at stage='verbal_confirmation',
//      with verbal_at = activity occurred_on.
//
// Defaults to DRY-RUN. Pass --apply to write changes.
//
//   DATABASE_URL=... node src/scripts/crossReferenceWonJobs.js
//   DATABASE_URL=... node src/scripts/crossReferenceWonJobs.js --apply

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

const START_DATE = '2026-01-01';
const MATCH_LOOKBACK_DAYS  = 14;     // invoice can be dated up to 14 days before activity
const MATCH_LOOKAHEAD_DAYS = 180;    // …or up to 180 days after

const APPLY = process.argv.includes('--apply');

function normaliseName(name) {
  return (name || '')
    .split(/[, ]+/)
    .filter(Boolean)
    .map(p => p.toLowerCase())
    .sort()
    .join(' ');
}

function dateAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function quoteValueAsNumber(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .split('|')
    .map(v => parseFloat(v.replace(/[^0-9.]/g, '')))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
  return cleaned > 0 ? cleaned : null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  try {
    // Pull job_won activities since START_DATE (active clients only).
    const { rows: activities } = await c.query(`
      select a.id, a.company_id, co.name as company_name,
             a.sales_person_id, sp.name as sales_person_name,
             a.contact_name, a.contact_id, a.contact_address,
             a.quote_job_value, a.occurred_on
      from activities a
      join companies co on a.company_id = co.id
      left join sales_people sp on a.sales_person_id = sp.id
      where a.event_type = 'job_won'
        and co.active = true
        and a.occurred_on >= $1
      order by a.occurred_on
    `, [START_DATE]);

    // Pull existing won_jobs rows (any stage) for matching.
    const { rows: existingWonJobs } = await c.query(`
      select w.id, w.company_id, co.name as company_name,
             w.sales_person_id, sp.name as sales_person_name,
             w.contact_name, w.contact_id, w.job_value, w.commission_amount,
             w.stage, w.invoiced_at, w.paid_at, w.source_activity_id, w.type, w.invoice_number
      from won_jobs w
      join companies co on w.company_id = co.id
      left join sales_people sp on w.sales_person_id = sp.id
    `);

    console.log(`\nActivities (job_won, since ${START_DATE}, active clients): ${activities.length}`);
    console.log(`Existing won_jobs rows: ${existingWonJobs.length}`);
    console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
    console.log('─'.repeat(70));

    // Index existing won_jobs by (companyId, normalisedName) for fast lookup.
    const byCompanyName = new Map();
    for (const w of existingWonJobs) {
      const key = `${w.company_id}::${normaliseName(w.contact_name)}`;
      if (!byCompanyName.has(key)) byCompanyName.set(key, []);
      byCompanyName.get(key).push(w);
    }

    let matched = 0, alreadyLinked = 0, newInserts = 0, skipped = 0;
    const matchExamples = [];
    const insertExamples = [];

    for (const a of activities) {
      // Skip if no contact name — those can't be matched and aren't useful
      // as standalone verbal rows.
      const aName = (a.contact_name || '').trim();
      if (!aName) {
        skipped++;
        continue;
      }

      // Skip if already linked to a won_job.
      const alreadyMatched = existingWonJobs.find(w => w.source_activity_id === a.id);
      if (alreadyMatched) {
        alreadyLinked++;
        continue;
      }

      // Try fuzzy match against existing won_jobs.
      const normKey = `${a.company_id}::${normaliseName(aName)}`;
      const candidates = byCompanyName.get(normKey) || [];
      // Filter by date proximity + not already linked + same company.
      const aDate = a.occurred_on instanceof Date
        ? a.occurred_on.toISOString().slice(0, 10)
        : String(a.occurred_on).slice(0, 10);
      const windowLow  = dateAddDays(aDate, -MATCH_LOOKBACK_DAYS);
      const windowHigh = dateAddDays(aDate,  MATCH_LOOKAHEAD_DAYS);

      const eligible = candidates.filter(w => {
        if (w.source_activity_id) return false;
        // Use invoice / paid date if available, otherwise we can't date-match.
        const wDate = (w.paid_at || w.invoiced_at)?.toISOString?.()?.slice(0, 10);
        if (!wDate) return false;
        return wDate >= windowLow && wDate <= windowHigh;
      });

      // Pick the match with closest value if multiple candidates.
      let best = eligible[0];
      if (eligible.length > 1) {
        const aValue = quoteValueAsNumber(a.quote_job_value);
        if (aValue) {
          eligible.sort((x, y) => {
            const dx = Math.abs((Number(x.job_value) || 0) - aValue);
            const dy = Math.abs((Number(y.job_value) || 0) - aValue);
            return dx - dy;
          });
          best = eligible[0];
        }
      }

      if (best) {
        // Link this activity to the existing won_job.
        if (matchExamples.length < 8) {
          matchExamples.push({
            activity: `${a.company_name} · ${a.sales_person_name || '—'} · ${aName} (${aDate}, $${quoteValueAsNumber(a.quote_job_value) ?? '?'})`,
            wonJob:   `→ won_job ${best.id.slice(0,8)} · ${best.stage} · invoice ${best.invoice_number || '—'} · $${best.commission_amount || '?'} comm`,
          });
        }
        if (APPLY) {
          await c.query(
            `update won_jobs set
               source_activity_id = $1,
               contact_id   = coalesce(contact_id, $2),
               job_value    = coalesce(job_value,  $3),
               contact_address = coalesce(contact_address, $4)
             where id = $5`,
            [
              a.id,
              a.contact_id || null,
              quoteValueAsNumber(a.quote_job_value),
              a.contact_address || null,
              best.id,
            ]
          );
          // Mark in-memory so next iteration doesn't double-match.
          best.source_activity_id = a.id;
        }
        matched++;
        continue;
      }

      // No match — insert a new verbal_confirmation row.
      if (insertExamples.length < 8) {
        insertExamples.push(`${a.company_name} · ${a.sales_person_name || '—'} · ${aName} (${aDate}, $${quoteValueAsNumber(a.quote_job_value) ?? '?'})`);
      }
      if (APPLY) {
        await c.query(
          `insert into won_jobs (
             company_id, sales_person_id, source_activity_id,
             contact_name, contact_id, contact_address,
             job_value, type, stage, verbal_at, notes
           ) values ($1, $2, $3, $4, $5, $6, $7, 'comms', 'verbal_confirmation', $8, $9)`,
          [
            a.company_id,
            a.sales_person_id || null,
            a.id,
            aName,
            a.contact_id || null,
            a.contact_address || null,
            quoteValueAsNumber(a.quote_job_value),
            `${aDate}T00:00:00+10:00`,
            'auto-seeded from activities.job_won',
          ]
        );
      }
      newInserts++;
    }

    console.log(`\nResults:`);
    console.log(`  matched to existing won_job:   ${matched}`);
    console.log(`  already linked (skipped):      ${alreadyLinked}`);
    console.log(`  new verbal_confirmation rows:  ${newInserts}`);
    console.log(`  skipped (no contact name):     ${skipped}`);

    if (matchExamples.length > 0) {
      console.log(`\nMatch examples (first ${matchExamples.length}):`);
      for (const m of matchExamples) {
        console.log(`  ${m.activity}`);
        console.log(`    ${m.wonJob}`);
      }
    }

    if (insertExamples.length > 0) {
      console.log(`\nWould-insert examples (first ${insertExamples.length}):`);
      for (const i of insertExamples) console.log(`  ${i}`);
    }

    if (!APPLY) {
      console.log(`\n(dry run — no changes written. Re-run with --apply to commit.)`);
    } else {
      console.log(`\n✓ Changes committed.`);
    }
  } finally {
    await c.end();
  }
}

main().catch(err => {
  console.error('FAILED:', err.message);
  console.error(err);
  process.exit(1);
});
