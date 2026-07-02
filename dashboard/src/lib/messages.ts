// Live message engine — reads activities from Postgres and produces the same
// formatted EOD / EOW / EOM / EOQ / EOY text that the cron generators send
// to Slack / ClickUp. No node-service round-trip; the dashboard owns the
// rendering, blocks/formulas/outcomes configs are bundled.
//
// Ported from src/reporting/generateEOD.js + generateEOW.js. The two
// generators share data shape; the only differences are (a) block list
// (eodBlocks vs eowBlocks) (b) formula key (eod vs eow) (c) header.

import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz, SYDNEY_TZ } from "./format";
import { mondayOf, addDaysIso, type Period } from "./dates";
import { listCompanies, type CompanyRow } from "./queries";
import { normName, normValue } from "./duplicates";

// Report render format, decoupled from any fixed calendar period:
//   "summary"  → the MONTHLY/PERFORMANCE-style aggregate (📞 Calls, 💰 Revenue
//                Pipeline, Jobs Won list, Top Lead Sources, Attrition).
//   "detailed" → the EOD-style block format (per-contact names, quote-detail
//                lines, the full site-visit list). One report for the range.
export type ReportFormat = "summary" | "detailed";
import blocksConfig from "./configs/blocks.json";
import formulasConfig from "./configs/formulas.json";
import outcomesConfig from "./configs/outcomes.json";

// ─── Types ───────────────────────────────────────────────────────────

type ActivityRow = {
  company_id: string;
  sales_person_id: string | null;
  sales_person_name: string;
  occurred_on: string;
  event_type: string;
  contact_name: string | null;
  contact_id: string | null;
  contact_address: string | null;
  outcome: string | null;
  ad_source: string | null;
  quote_job_value: string | null;
  appointment_at: string | null;
};

type Block = { name: string; outcomes?: string[] };
type BlocksConfig = { eodBlocks: Block[]; eowBlocks: Block[] };
type FormulaEntry = { eod?: number; eow?: number };
type FormulasConfig = { outcomeFormulas: Record<string, FormulaEntry> };
type OutcomesConfig = { outcomes: { name: string; category: string }[] };

const BLOCKS = blocksConfig as BlocksConfig;
const FORMULAS = formulasConfig as FormulasConfig;
const OUTCOMES = outcomesConfig as OutcomesConfig;

type CountedData = {
  counts: Record<string, number>;
  names: Record<string, string[]>;
  quoteDetails: { contactName: string; values: number[] }[];
  siteVisits: { contactName: string; address: string; datetime: string }[];
  jobDetails: { contactName: string; address: string; value: number; source: string }[];
  customNotes: { contactName: string; note: string }[]; // EOD 4 custom outcomes, surfaced verbatim
};

type MessageScope = "personal" | "team";

// ─── Outcome parsing & lookups ───────────────────────────────────────

function parseOutcome(s: string | null) {
  if (!s) return { leadType: "", answerStatus: "", action: "", notes: "", source: "" };
  const parts = s.split("|").map(p => p.trim());
  return {
    leadType: parts[0] || "",
    answerStatus: parts[1] || "",
    action: parts[2] || "",
    notes: parts[3] || "",
    source: parts[4] || "",
  };
}

function normalizeName(name: string | null) {
  return (name || "").split(/[, ]+/).filter(Boolean).map(p => p.toLowerCase()).sort().join(" ");
}

const OUTCOME_ALIASES: Record<string, string> = {
  "Not Ready to Proceed w. Job": "Not Ready Yet - Post Quote",
  "Not Ready for Site Visit": "Not Ready Yet - Pre-Quote",
  "Rescheduled Site Visit": "Not Ready Yet - Pre-Quote",
  "Rough Figures Sent": "Requires Quoting",
  "Disqualified - Extent of Works": "DQ - Extent of Works",
  "Disqualified - Out of Service Area": "DQ - Out of Service Area",
  "Disqualified - Wrong Contact/Number": "DQ - Wrong Contact / Spam",
  "Disqualified - Price": "DQ - Price",
  "Disqualified - Lead Looking for Work": "DQ - Lead Looking for Work",
};

function resolveAlias(name: string) {
  return OUTCOME_ALIASES[name] || name;
}

function resolveLeadSource(contactName: string | null, contactId: string | null, all: ActivityRow[]): string {
  const withSource = all.filter(a => a.ad_source);
  if (contactId) {
    const byId = withSource.find(a => a.contact_id && a.contact_id.trim() === contactId.trim());
    if (byId) return byId.ad_source || "";
  }
  const norm = normalizeName(contactName);
  if (norm.length >= 3) {
    const byName = withSource.find(a => normalizeName(a.contact_name) === norm);
    if (byName) return byName.ad_source || "";
  }
  const parts = (contactName || "").split(/[, ]+/).filter(p => p.length >= 4).map(p => p.toLowerCase());
  if (parts.length > 0) {
    const byPartial = withSource.find(a => {
      const other = (a.contact_name || "").toLowerCase();
      return parts.some(p => other.includes(p));
    });
    if (byPartial) return byPartial.ad_source || "";
  }
  return "";
}

function getOutcomeNames(ownerName: string): string[] {
  return OUTCOMES.outcomes.map(o => o.name.replace("{owner}", ownerName));
}

// ─── Aggregation engine ──────────────────────────────────────────────

function countOutcomes(filtered: ActivityRow[], ownerName: string, allActivities: ActivityRow[]): CountedData {
  const outcomeNames = getOutcomeNames(ownerName);
  const counts: Record<string, number> = {};
  const names: Record<string, string[]> = {};
  for (const n of outcomeNames) { counts[n] = 0; names[n] = []; }

  const quoteDetails: CountedData["quoteDetails"] = [];
  const siteVisits: CountedData["siteVisits"] = [];
  const jobDetails: CountedData["jobDetails"] = [];
  const customNotes: CountedData["customNotes"] = [];

  // Read-layer dedup: collapse exact-duplicate job_won / quote_sent rows (same
  // customer + same value) so a re-delivered GHL webhook (source_row_id=null,
  // ON CONFLICT can't fire) can never double a job in a live report. Same rule
  // as the backend fetchActivityGrid and the Duplicates page (duplicates.ts),
  // so every surface agrees. Site visits are deduped separately below.
  const seenDup = new Set<string>();

  for (const a of filtered) {
    const ev = a.event_type;

    if (ev === "job_won" || ev === "quote_sent") {
      const nm = normName(a.contact_name);
      const val = normValue(a.quote_job_value);
      if (nm && val) {
        const dk = `${ev}|${nm}|${val}`;
        if (seenDup.has(dk)) continue;   // duplicate — first occurrence already counted
        seenDup.add(dk);
      }
    }

    if (ev === "quote_sent") {
      const contactName = (a.contact_name || "").trim();
      if (!contactName) continue;                                 // skip noise: no contact
      const values = (a.quote_job_value || "")
        .split("|")
        .map(v => parseFloat(v.replace(/[$,\s]/g, "")))
        .filter(v => Number.isFinite(v));
      const existing = quoteDetails.find(q => q.contactName === contactName);
      if (existing) existing.values.push(...values);
      else quoteDetails.push({ contactName, values });
      continue;
    }

    if (ev === "site_visit_booked") {
      const contactName = (a.contact_name || "").trim();
      if (!contactName) continue;                                 // skip noise: no contact
      const address = a.contact_address || "";
      const datetime = a.appointment_at || "";
      // Dedupe: same (name, address, time) is the same visit logged twice.
      // Different time keeps the row — that's a genuine second visit.
      const isDuplicate = siteVisits.some(sv =>
        sv.contactName === contactName && sv.address === address && sv.datetime === datetime,
      );
      if (isDuplicate) continue;
      siteVisits.push({ contactName, address, datetime });
      if ("Site Visit Booked" in counts) {
        counts["Site Visit Booked"]++;
        names["Site Visit Booked"].push(contactName);
      }
      continue;
    }

    if (ev === "email_sent") {
      if ("Emails Sent" in counts) {
        counts["Emails Sent"]++;
        names["Emails Sent"].push(a.contact_name || "");
      }
      continue;
    }

    if (ev === "job_won") {
      const contactName = (a.contact_name || "").trim();
      if (!contactName) continue;                                 // skip noise: no contact
      const value = parseFloat((a.quote_job_value || "").replace(/[$,\s]/g, "")) || 0;
      let source = a.ad_source || "";
      if (!source) source = resolveLeadSource(a.contact_name, a.contact_id, allActivities);
      jobDetails.push({
        contactName,
        address: a.contact_address || "",
        value, source,
      });
      if ("Job Won" in counts) {
        counts["Job Won"]++;
        names["Job Won"].push(contactName);
      }
      continue;
    }

    if (ev === "eod_update" || !ev) {
      const p = parseOutcome(a.outcome);
      const contactName = a.contact_name || "";
      const source = p.source || a.ad_source || "";

      if (p.leadType && p.leadType in counts) {
        counts[p.leadType]++;
        names[p.leadType].push(contactName);
      }
      if (p.answerStatus && p.answerStatus in counts) {
        counts[p.answerStatus]++;
        names[p.answerStatus].push(contactName);
      }
      if (p.action) {
        let actionKey = resolveAlias(p.action);
        if (actionKey.startsWith("Passed Onto")) actionKey = `Passed Onto ${ownerName}`;
        if (actionKey in counts) {
          counts[actionKey]++;
          names[actionKey].push(contactName);
        }
      }
      if (source && source in counts) {
        counts[source]++;
        names[source].push(contactName);
      }

      // Custom Outcome (EOD 4) — captured verbatim, surfaced in the Notes section.
      if (p.notes) {
        customNotes.push({ contactName, note: p.notes });
      }
    }
  }

  // Computed totals
  const totalAnswered = (counts["Answered"] || 0) + (counts["Didn't Answer"] || 0);
  if ("Total Calls" in counts) counts["Total Calls"] = totalAnswered;
  if ("Total Contact Attempts" in counts) counts["Total Contact Attempts"] = totalAnswered;
  if ("Quote Sent" in counts) counts["Quote Sent"] = quoteDetails.length;

  let totalIndividualQuotes = 0;
  for (const q of quoteDetails) totalIndividualQuotes += q.values.length;
  if ("Total Individual Quotes" in counts) counts["Total Individual Quotes"] = totalIndividualQuotes;

  let pipelineValue = 0;
  for (const q of quoteDetails) {
    if (q.values.length > 0) pipelineValue += q.values.reduce((a, b) => a + b, 0) / q.values.length;
  }
  if ("Pipeline Value" in counts) counts["Pipeline Value"] = Math.round(pipelineValue);

  // Synthetic display count for the Pipeline Progress block. Set directly (not
  // registered in outcomes.json) so it stays a pure display value — the backend
  // does the same to avoid it becoming a positional sheet-storage column.
  // "Site Visit Booked" (singular, formula 8) still renders the detailed list in
  // the 🏠 Site Visits block.
  counts["Site Visits Booked"] = siteVisits.length;

  return { counts, names, quoteDetails, siteVisits, jobDetails, customNotes };
}

// ─── Formatting ──────────────────────────────────────────────────────

function formatDollar(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-AU");
}

function formatEODDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${days[date.getUTCDay()]} ${dd} ${months[date.getUTCMonth()]}`;
}

function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatVisitDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;
  return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${hours}:${mins}${ampm}`;
}

// Display-only relabels: shorten certain lead-source labels in the printed
// report without changing the matching keys (outcomes.json / counts) that the
// raw data is matched against. Mirrors src/reporting/displayLabels.js.
const DISPLAY_LABELS: Record<string, string> = {
  "Facebook Ad Form": "FB Ad Form",
  "Direct Lead passed on from Client": "Direct Lead from Client",
};
const displayLabel = (name: string): string => DISPLAY_LABELS[name] || name;

function formatEODLine(outcomeName: string, formulaId: number, data: CountedData, isTeam: boolean): string | null {
  const { counts, names, quoteDetails, siteVisits, jobDetails } = data;
  const label = displayLabel(outcomeName);  // printed text only; keys stay raw
  switch (formulaId) {
    case 1: return null;                                          // Hidden
    case 2: { const c = counts[outcomeName] || 0; return c === 0 ? null : `${label} - ${c}`; }
    case 3: { const c = counts[outcomeName] || 0; return c === 0 ? null : `${label}: ${c}`; }
    case 4: {                                                     // Count + Names
      const c = counts[outcomeName] || 0;
      if (c === 0) return null;
      if (isTeam) return `${label} - ${c}`;
      const unique = [...new Set((names[outcomeName] || []).filter(Boolean))];
      if (unique.length === 0) return `${label} - ${c}`;
      return `${label} - ${c} - ${unique.join(", ")}`;
    }
    case 5: { const c = counts[outcomeName] || 0; return c === 0 ? null : `${label}: ${c}`; }
    case 6: {                                                     // Quote Details
      const valid = quoteDetails.filter(q => q.contactName || q.values.length > 0);
      if (valid.length === 0) return null;
      if (isTeam) return `Total Contacts Quoted: ${valid.length}`;
      const lines = [`Total Contacts Quoted: ${valid.length}`];
      for (const q of valid) {
        const valStr = q.values.map(v => formatDollar(v)).join(", ");
        lines.push(`- ${q.contactName} - ${q.values.length} - (${valStr})`);
      }
      return lines.join("\n");
    }
    case 7: {                                                     // Pipeline Value
      const value = counts["Pipeline Value"] || 0;
      return value === 0 ? null : `Pipeline Value (Sum of Averages): ${formatDollar(value)}`;
    }
    case 8: {                                                     // Site Visit
      if (siteVisits.length === 0) return null;
      if (isTeam) return `Site Visits Booked: ${siteVisits.length}`;
      return siteVisits.map(sv =>
        `${sv.contactName} - ${cleanAddress(sv.address) || "TBC"} - ${formatVisitDateTime(sv.datetime) || "TBC"}`).join("\n");
    }
    case 9: {                                                     // Job Details
      if (jobDetails.length === 0) return null;
      const total = jobDetails.reduce((s, j) => s + (j.value || 0), 0);
      if (isTeam) return `Jobs Won: ${jobDetails.length}${total > 0 ? ` - Total Revenue: ${formatDollar(total)}` : ""}`;
      const lines = jobDetails.map(j => `${j.contactName} - ${cleanAddress(j.address) || "N/A"} - ${formatDollar(j.value)} - ${j.source || "N/A"}`);
      if (total > 0) lines.push(`Total Revenue Generated: ${formatDollar(total)}`);
      return lines.join("\n");
    }
    case 10: { const c = counts["Total Individual Quotes"] || 0; return c === 0 ? null : `Total Individual Quotes: ${c}`; }
    default: return null;
  }
}

function formatEOWLine(outcomeName: string, formulaId: number, data: CountedData): string | null {
  const { counts, siteVisits, jobDetails, quoteDetails } = data;
  const label = displayLabel(outcomeName);  // printed text only; keys stay raw
  switch (formulaId) {
    case 1: return null;
    case 11: { const c = counts[outcomeName] || 0; return c === 0 ? null : `${label}: ${c}`; }
    case 12: {
      const total = counts["Total Calls"] || counts["Total Contact Attempts"] || 0;
      if (total === 0) return null;
      const answered = counts["Answered"] || 0;
      const rate = Math.round((answered / total) * 100);
      return `Total Calls: ${total} (${rate}% Answered)`;
    }
    case 6: {
      const qc = quoteDetails.length;
      return qc === 0 ? null : `Total Contacts Quoted: ${qc}`;
    }
    case 7: {
      const value = counts["Pipeline Value"] || 0;
      return value === 0 ? null : `Pipeline Value (Sum of Averages): ${formatDollar(value)}`;
    }
    case 8: {
      if (siteVisits.length > 0) {
        return siteVisits.map(sv =>
          `${sv.contactName} - ${cleanAddress(sv.address) || "TBC"} - ${formatVisitDateTime(sv.datetime) || "TBC"}`).join("\n");
      }
      const c = counts[outcomeName] || 0;
      return c === 0 ? null : `${label}: ${c}`;
    }
    case 9: {
      if (jobDetails.length > 0) {
        const lines = jobDetails.map(j => `${j.contactName} - ${cleanAddress(j.address) || "N/A"} - ${formatDollar(j.value)} - ${j.source || "N/A"}`);
        const total = jobDetails.reduce((s, j) => s + (j.value || 0), 0);
        if (total > 0) lines.push(`Total Revenue Generated: ${formatDollar(total)}`);
        return lines.join("\n");
      }
      const c = counts[outcomeName] || 0;
      return c === 0 ? null : `${label}: ${c}`;
    }
    case 10: { const c = counts["Total Individual Quotes"] || 0; return c === 0 ? null : `Total Individual Quotes: ${c}`; }
    case 2: case 3: case 4: { const c = counts[outcomeName] || 0; return c === 0 ? null : `${label}: ${c}`; }
    default: return null;
  }
}

// ─── Message builders ────────────────────────────────────────────────

function buildHeader(period: Period, companyLabel: string, personLabel: string, rangeStart: string, rangeEnd: string): string[] {
  if (period === "day") {
    return [`EOD Report - ${formatEODDate(rangeEnd)} - ${personLabel} - ${companyLabel}`, "----------------------------"];
  }
  return [
    `SALES EXECUTIVE PERFORMANCE REPORT - ${personLabel} - ${companyLabel}`,
    `Dates: ${formatLongDate(rangeStart)} - ${formatLongDate(rangeEnd)}`,
    "------------------------------------------",
  ];
}

// ─── Month / Quarter / Year formats (ported from generateEOM/EOQ/EOY.js) ──

const MONTH_FULL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export type MonthBreakdown = { month: string; counts: Record<string, number> };

function periodicLabel(period: Period, rangeStart: string): string {
  const [y, m] = rangeStart.split("-").map(Number);
  if (period === "month") return `${MONTH_FULL[m - 1]} ${y}`;
  if (period === "quarter") {
    const q = Math.ceil(m / 3);
    const m1 = (q - 1) * 3 + 1;
    const m3 = q * 3;
    return `Q${q} ${y} (${MONTH_FULL[m1 - 1]} - ${MONTH_FULL[m3 - 1]})`;
  }
  return String(y);
}

function getTopSources(counts: Record<string, number>): { name: string; count: number }[] {
  return OUTCOMES.outcomes
    .filter(o => o.category === "source")
    .map(o => ({ name: o.name, count: counts[o.name] || 0 }))
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Display-only address formatter for reports. Forces one line AND strips the
// trailing Australian state + postcode ("...Kenwick WA 6107" → "...Kenwick");
// either/both may be absent. The full address stays in the DB (Maps links on
// /visits, dedup). Keep byte-identical to the backend src/reporting/addressFormat.js.
const AU_STATES = "NSW|VIC|QLD|SA|WA|TAS|NT|ACT|New South Wales|Victoria|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory";

function cleanAddress(address: string | null): string {
  let s = (address || "")
    .replace(/\s+/g, " ")        // collapse embedded newlines / whitespace runs → one space
    .replace(/\s*,\s*/g, ", ")   // tidy comma spacing
    .replace(/,\s*$/, "")        // drop any trailing comma
    .trim();
  s = s
    .replace(new RegExp(`[,\\s]+(?:(?:${AU_STATES})\\b[,\\s]*)?\\d{4}\\s*$`, "i"), "")  // [state] postcode
    .replace(new RegExp(`[,\\s]+(?:${AU_STATES})\\.?\\s*$`, "i"), "")                    // bare state, no postcode
    .replace(/[,\s]+$/, "")
    .trim();
  return s;
}

/**
 * Mirrors the backend MONTHLY / QUARTERLY / YEARLY PERFORMANCE REPORT
 * formats so the dashboard shows exactly what Slack/ClickUp receive.
 */
function buildPeriodicMessage(opts: {
  period: Period;
  companyLabel: string;
  personLabel: string;
  ownerName: string;
  rangeStart: string;
  data: CountedData;
  monthlyBreakdown?: MonthBreakdown[];
  // Overrides for custom-range rendering (period-agnostic). When omitted the
  // period-derived title/label/isYear are used, preserving the cron formats.
  titleOverride?: string;
  labelOverride?: string;
  isYearOverride?: boolean;
}): string {
  const { period, companyLabel, personLabel, ownerName, rangeStart, data, monthlyBreakdown } = opts;
  const counts = data.counts;
  const outcomeNames = getOutcomeNames(ownerName);
  const has = (n: string) => outcomeNames.includes(n);
  const isYear = opts.isYearOverride ?? (period === "year");

  const title = opts.titleOverride ?? (period === "month" ? "MONTHLY PERFORMANCE REPORT"
    : period === "quarter" ? "QUARTERLY PERFORMANCE REPORT"
    : "YEARLY PERFORMANCE REPORT");

  const lines: string[] = [
    `${title} - ${personLabel} - ${companyLabel}`,
    opts.labelOverride ?? periodicLabel(period, rangeStart),
    "==========================================",
    "",
    "📞 Calls",
  ];

  const totalField = has("Total Calls") ? "Total Calls" : "Total Contact Attempts";
  const totalCallCount = counts[totalField] || 0;
  const answeredCount = counts["Answered"] || 0;
  const pickUpRate = totalCallCount > 0 ? Math.round((answeredCount / totalCallCount) * 100) : 0;
  lines.push(`Total Calls: ${totalCallCount}`);
  lines.push(`Answered: ${answeredCount} | Didn't Answer: ${counts["Didn't Answer"] || 0}`);
  if (totalCallCount > 0) lines.push(`Pick Up Rate: ${pickUpRate}%`);

  if (has("New Leads")) {
    const leadParts = [`New Leads: ${counts["New Leads"] || 0}`];
    if (counts["Pre-Quote Follow Up"]) leadParts.push(`Pre-Quote Follow Up: ${counts["Pre-Quote Follow Up"]}`);
    if (counts["Post Quote Follow Up"]) leadParts.push(`Post Quote Follow Up: ${counts["Post Quote Follow Up"]}`);
    if (counts["Follow Up"]) leadParts.push(`Follow Up: ${counts["Follow Up"]}`);
    lines.push(`📋 ${leadParts.join(" | ")}`);
  }

  const emailCount = counts["Emails Sent"] || 0;
  if (emailCount > 0) {
    lines.push("");
    lines.push(`📧 Emails Sent: ${emailCount}`);
  }

  // Trade-specific metrics
  if (has("Quote Sent")) {
    lines.push("");
    lines.push(isYear ? "💰 Revenue" : "💰 Revenue Pipeline");
    lines.push(`Total Contacts Quoted: ${counts["Quote Sent"] || 0}`);
    lines.push(`Total Individual Quotes: ${counts["Total Individual Quotes"] || 0}`);
    lines.push(`${isYear ? "Total Pipeline Value" : "Pipeline Value"}: ${formatDollar(counts["Pipeline Value"] || 0)}`);
    if (has("Site Visit Booked")) lines.push(`Site Visits: ${counts["Site Visit Booked"] || 0}`);
    if (has("Job Won")) {
      if (isYear) {
        lines.push(`Jobs Won: ${counts["Job Won"] || 0}`);
      } else {
        const jobDetails = data.jobDetails;
        const jobCount = jobDetails.length > 0 ? jobDetails.length : (counts["Job Won"] || 0);
        lines.push(`Jobs Won: ${jobCount}`);
        if (jobDetails.length > 0) {
          for (const j of jobDetails) {
            lines.push(`${j.contactName} - ${cleanAddress(j.address) || "N/A"} - ${formatDollar(j.value)} - ${j.source || "N/A"}`);
          }
          const totalRevenue = jobDetails.reduce((sum, j) => sum + (j.value || 0), 0);
          lines.push(`Total Revenue Generated: ${formatDollar(totalRevenue)}`);
        }
      }
    }
  }

  // Agency-specific metrics
  if (has("Roadmap Booked")) {
    lines.push("");
    lines.push("🗺️ Roadmaps");
    lines.push(`Roadmaps Booked: ${counts["Roadmap Booked"] || 0}`);
    lines.push(`Roadmaps Proposed: ${counts["Roadmap Proposed"] || 0}`);
    if (has("Deal Closed")) lines.push(`Deals Closed: ${counts["Deal Closed"] || 0}`);
  }

  const topSources = getTopSources(counts);
  if (topSources.length > 0) {
    lines.push("");
    lines.push("📣 Top Lead Sources");
    for (const s of topSources) lines.push(`${displayLabel(s.name)}: ${s.count}`);
  }

  // Attrition (dynamic from outcome categories)
  const sumCategory = (cat: string) =>
    OUTCOMES.outcomes.filter(o => o.category === cat).reduce((sum, o) => sum + (counts[o.name] || 0), 0);
  const totalLost = sumCategory("lost");
  const totalAbandoned = sumCategory("abandoned");
  const totalDQ = sumCategory("dq");
  if (totalLost > 0 || totalAbandoned > 0 || totalDQ > 0) {
    lines.push("");
    lines.push("🔴 Attrition");
    if (totalLost > 0) lines.push(`Lost: ${totalLost}`);
    if (totalAbandoned > 0) lines.push(`Abandoned: ${totalAbandoned}`);
    if (totalDQ > 0) lines.push(`Disqualified: ${totalDQ}`);
  }

  // Yearly extras: monthly breakdown table + best/quietest month
  if (isYear && monthlyBreakdown && monthlyBreakdown.length > 1) {
    lines.push("");
    lines.push("📊 Monthly Breakdown");
    const monthTag = (key: string) => {
      const [yr, mo] = key.split("-").map(Number);
      return `${MONTH_FULL[mo - 1]} ${yr}`;
    };
    if (has("Quote Sent")) {
      lines.push("Month | Calls | Answered | Quotes | Site Visits | Jobs Won");
      lines.push("------|-------|----------|--------|-------------|--------");
      for (const mb of monthlyBreakdown) {
        const c = mb.counts;
        lines.push(`${monthTag(mb.month)} | ${c[totalField] || 0} | ${c["Answered"] || 0} | ${c["Quote Sent"] || 0} | ${c["Site Visit Booked"] || 0} | ${c["Job Won"] || 0}`);
      }
    } else {
      lines.push("Month | Contacts | Answered | Roadmaps | Deals");
      lines.push("------|----------|----------|----------|------");
      for (const mb of monthlyBreakdown) {
        const c = mb.counts;
        lines.push(`${monthTag(mb.month)} | ${c[totalField] || 0} | ${c["Answered"] || 0} | ${c["Roadmap Booked"] || 0} | ${c["Deal Closed"] || 0}`);
      }
    }

    let best: MonthBreakdown | null = null;
    let worst: MonthBreakdown | null = null;
    for (const mb of monthlyBreakdown) {
      const calls = mb.counts[totalField] || 0;
      if (!best || calls > (best.counts[totalField] || 0)) best = mb;
      if (!worst || calls < (worst.counts[totalField] || 0)) worst = mb;
    }
    if (best && worst) {
      lines.push("");
      lines.push(`Best Month: ${monthTag(best.month)} (${best.counts[totalField] || 0} ${totalField.toLowerCase()})`);
      lines.push(`Quietest Month: ${monthTag(worst.month)} (${worst.counts[totalField] || 0} ${totalField.toLowerCase()})`);
    }
  }

  lines.push("");
  lines.push("==========================================");
  return lines.join("\n");
}

function buildMessage(opts: {
  period: Period;
  companyLabel: string;
  personLabel: string;
  ownerName: string;
  scope: MessageScope;
  rangeStart: string;
  rangeEnd: string;
  data: CountedData;
  monthlyBreakdown?: MonthBreakdown[];
}): string {
  const { period, companyLabel, personLabel, ownerName, scope, rangeStart, rangeEnd, data } = opts;

  // Month / quarter / year use the backend's structured report format, not
  // the EOW block list.
  if (period === "month" || period === "quarter" || period === "year") {
    return buildPeriodicMessage({
      period, companyLabel, personLabel, ownerName, rangeStart,
      data, monthlyBreakdown: opts.monthlyBreakdown,
    });
  }

  const blocks = period === "day" ? BLOCKS.eodBlocks : BLOCKS.eowBlocks;
  const formulaKey: "eod" | "eow" = period === "day" ? "eod" : "eow";
  const separator = period === "day" ? "----------------------------" : "------------------------------------------";
  const isTeam = scope === "team";

  const lines: string[] = buildHeader(period, companyLabel, personLabel, rangeStart, rangeEnd);

  for (const block of blocks) {
    const blockName = block.name.replace("{owner}", ownerName);
    const blockLines: string[] = [];
    for (const tpl of block.outcomes || []) {
      const outcomeName = tpl.replace("{owner}", ownerName);
      const formulaEntry = FORMULAS.outcomeFormulas[tpl] || {};
      const formulaId = formulaEntry[formulaKey] ?? 1;
      const line = period === "day"
        ? formatEODLine(outcomeName, formulaId, data, isTeam)
        : formatEOWLine(outcomeName, formulaId, data);
      if (line) blockLines.push(line);
    }
    if (blockLines.length > 0) {
      lines.push(blockName);
      lines.push(...blockLines);
      lines.push(separator);
    }
  }

  // 📝 Notes — EOD only: custom outcomes (EOD 4) surfaced verbatim at the very
  // bottom, one per line as "Contact Name - Custom Outcome". Deduped on name+note.
  if (period === "day" && data.customNotes.length > 0) {
    const seen = new Set<string>();
    const noteLines: string[] = [];
    for (const { contactName, note } of data.customNotes) {
      if (!note) continue;
      const key = `${contactName}||${note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      noteLines.push(contactName ? `${contactName} - ${note}` : note);
    }
    if (noteLines.length > 0) {
      lines.push("📝 Notes");
      lines.push(...noteLines);
      lines.push(separator);
    }
  }

  return lines.join("\n");
}

// ─── Custom-range rendering (period-agnostic) ───────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-01" → "1 Jun 2026"; a single date when start === end. */
function rangeLabelText(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return `${day} ${MONTH_SHORT[m - 1]} ${y}`;
  };
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/** EOD-style block report for an arbitrary [start, end] range. */
function buildDetailedRangeMessage(opts: {
  companyLabel: string;
  personLabel: string;
  ownerName: string;
  scope: MessageScope;
  rangeStart: string;
  rangeEnd: string;
  data: CountedData;
}): string {
  const { companyLabel, personLabel, ownerName, scope, rangeStart, rangeEnd, data } = opts;
  const isTeam = scope === "team";
  const separator = "----------------------------";
  const lines: string[] = [
    `PERFORMANCE REPORT - ${personLabel} - ${companyLabel}`,
    `Dates: ${formatLongDate(rangeStart)} - ${formatLongDate(rangeEnd)}`,
    separator,
  ];

  for (const block of BLOCKS.eodBlocks) {
    const blockName = block.name.replace("{owner}", ownerName);
    const blockLines: string[] = [];
    for (const tpl of block.outcomes || []) {
      const outcomeName = tpl.replace("{owner}", ownerName);
      const formulaEntry = FORMULAS.outcomeFormulas[tpl] || {};
      const formulaId = formulaEntry.eod ?? 1;
      const line = formatEODLine(outcomeName, formulaId, data, isTeam);
      if (line) blockLines.push(line);
    }
    if (blockLines.length > 0) {
      lines.push(blockName);
      lines.push(...blockLines);
      lines.push(separator);
    }
  }

  // 📝 Notes — custom outcomes surfaced verbatim, deduped on name+note.
  if (data.customNotes.length > 0) {
    const seen = new Set<string>();
    const noteLines: string[] = [];
    for (const { contactName, note } of data.customNotes) {
      if (!note) continue;
      const key = `${contactName}||${note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      noteLines.push(contactName ? `${contactName} - ${note}` : note);
    }
    if (noteLines.length > 0) {
      lines.push("📝 Notes");
      lines.push(...noteLines);
      lines.push(separator);
    }
  }

  return lines.join("\n");
}

/** Render one report for a [start, end] range in the chosen format. */
function buildRangeMessage(opts: {
  format: ReportFormat;
  companyLabel: string;
  personLabel: string;
  ownerName: string;
  scope: MessageScope;
  rangeStart: string;
  rangeEnd: string;
  data: CountedData;
}): string {
  if (opts.format === "detailed") return buildDetailedRangeMessage(opts);
  return buildPeriodicMessage({
    period: "month",                       // unused: title/label/isYear overridden
    companyLabel: opts.companyLabel,
    personLabel: opts.personLabel,
    ownerName: opts.ownerName,
    rangeStart: opts.rangeStart,
    data: opts.data,
    titleOverride: "PERFORMANCE REPORT",
    labelOverride: rangeLabelText(opts.rangeStart, opts.rangeEnd),
    isYearOverride: false,
  });
}

// ─── Snapshot loader ─────────────────────────────────────────────────

const PAGE_SIZE = 1000;
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

/**
 * Full calendar period containing the anchor date. Used so any historical
 * period can be rendered, not just period-start → today.
 */
export function fullPeriodRange(period: Period, anchor: string): { start: string; end: string } {
  const [y, m] = anchor.split("-").map(Number);
  switch (period) {
    case "day": return { start: anchor, end: anchor };
    case "week": {
      const start = mondayOf(anchor);
      return { start, end: addDaysIso(start, 6) };
    }
    case "month": {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(lastDay)}` };
    }
    case "quarter": {
      const q = Math.ceil(m / 3);
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
      return { start: `${y}-${pad2(startMonth)}-01`, end: `${y}-${pad2(endMonth)}-${pad2(lastDay)}` };
    }
    case "year": return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
}

export type LiveMessage = {
  scope: MessageScope;
  title: string;             // company name or "All companies"
  subtitle?: string;         // exec name, "Team", etc.
  message: string;           // formatted report text
};

export type DashboardMessages = {
  period: Period;
  rangeStart: string;
  rangeEnd: string;
  perCompany: {
    company: CompanyRow;
    personal: LiveMessage | null;     // null when viewer not on roster
    team: LiveMessage;
  }[];
  personalTotal: LiveMessage | null;   // null when viewer on ≤ 1 company
  grandTotal: LiveMessage | null;      // null when ≤ 1 visible company
};

/** Bucket rows per month of the range's year and count each — for EOY reports. */
function monthlyBreakdownFor(rows: ActivityRow[], ownerName: string, all: ActivityRow[], year: string): MonthBreakdown[] {
  const out: MonthBreakdown[] = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = `${year}-${pad2(m)}`;
    const monthRows = rows.filter(r => r.occurred_on.startsWith(prefix));
    if (monthRows.length === 0) continue;
    out.push({ month: prefix, counts: countOutcomes(monthRows, ownerName, all).counts });
  }
  return out;
}

export async function loadDashboardMessages(
  supabase: SupabaseClient,
  opts: {
    period: Period;
    mySalesPersonIds: Set<string>;
    myCompanyIds: Set<string>;
    myDisplayName: string;            // shown as "personLabel" in personal headers
    anchor?: string;                  // any date inside the desired period; defaults to today
  },
): Promise<DashboardMessages> {
  const companies = await listCompanies(supabase);
  const today = todayInTz(SYDNEY_TZ);
  const { start: rangeStart, end: rangeEnd } = fullPeriodRange(opts.period, opts.anchor || today);

  // companies.owner_name comes from the table — listCompanies doesn't fetch
  // it, so pull it via a second targeted query.
  const { data: ownerRows } = await supabase
    .from("companies")
    .select("id, owner_name")
    .in("id", companies.map(c => c.id));
  const ownerByCompany = new Map<string, string>(
    (ownerRows || []).map(r => [r.id as string, (r.owner_name as string) || ""]),
  );

  const ids = companies.map(c => c.id);
  const rows = ids.length === 0 ? [] : await pageAll<ActivityRow>((from, to) =>
    supabase
      .from("activities")
      .select("company_id, sales_person_id, sales_person_name, occurred_on, event_type, contact_name, contact_id, contact_address, outcome, ad_source, quote_job_value, appointment_at")
      .in("company_id", ids)
      .gte("occurred_on", rangeStart)
      .lte("occurred_on", rangeEnd)
      .range(from, to),
  );

  // Bucket rows per company; pull personal/team separately
  const byCompany = new Map<string, ActivityRow[]>();
  for (const c of companies) byCompany.set(c.id, []);
  for (const row of rows) byCompany.get(row.company_id)?.push(row);

  const rangeYear = rangeStart.slice(0, 4);
  const breakdownFor = (subset: ActivityRow[], ownerName: string, all: ActivityRow[]) =>
    opts.period === "year" ? monthlyBreakdownFor(subset, ownerName, all, rangeYear) : undefined;

  // Build per-company messages
  const perCompany: DashboardMessages["perCompany"] = companies.map(c => {
    const all = byCompany.get(c.id) || [];
    const ownerName = ownerByCompany.get(c.id) || "Owner";

    // Team: all activities for this company. countOutcomes treats it the same.
    const teamData = countOutcomes(all, ownerName, all);
    const teamMessage = buildMessage({
      period: opts.period,
      companyLabel: c.name,
      personLabel: "Team",
      ownerName,
      scope: "team",
      rangeStart, rangeEnd,
      data: teamData,
      monthlyBreakdown: breakdownFor(all, ownerName, all),
    });

    let personal: LiveMessage | null = null;
    if (opts.myCompanyIds.has(c.id)) {
      const mine = all.filter(r => r.sales_person_id && opts.mySalesPersonIds.has(r.sales_person_id));
      const personalData = countOutcomes(mine, ownerName, all);
      const personalMessage = buildMessage({
        period: opts.period,
        companyLabel: c.name,
        personLabel: opts.myDisplayName,
        ownerName,
        scope: "personal",
        rangeStart, rangeEnd,
        data: personalData,
        monthlyBreakdown: breakdownFor(mine, ownerName, all),
      });
      personal = {
        scope: "personal",
        title: c.name,
        subtitle: opts.myDisplayName,
        message: personalMessage,
      };
    }

    return {
      company: c,
      personal,
      team: { scope: "team", title: c.name, subtitle: "Team", message: teamMessage },
    };
  });

  // Totals — aggregate across companies (treats whole set as one).
  const onRosterCount = companies.filter(c => opts.myCompanyIds.has(c.id)).length;
  let personalTotal: LiveMessage | null = null;
  let grandTotal: LiveMessage | null = null;

  if (onRosterCount > 1) {
    const mineAll = rows.filter(r =>
      opts.myCompanyIds.has(r.company_id) && r.sales_person_id && opts.mySalesPersonIds.has(r.sales_person_id),
    );
    // ownerName for total — pick the first on-roster owner; format is generic.
    const firstOwner = companies.find(c => opts.myCompanyIds.has(c.id));
    const ownerName = (firstOwner && ownerByCompany.get(firstOwner.id)) || "Owner";
    const data = countOutcomes(mineAll, ownerName, rows);
    personalTotal = {
      scope: "personal",
      title: "All my companies",
      subtitle: opts.myDisplayName,
      message: buildMessage({
        period: opts.period,
        companyLabel: "All My Companies",
        personLabel: opts.myDisplayName,
        ownerName,
        scope: "personal",
        rangeStart, rangeEnd,
        data,
        monthlyBreakdown: breakdownFor(mineAll, ownerName, rows),
      }),
    };
  }

  if (companies.length > 1) {
    const firstOwner = companies[0];
    const ownerName = (firstOwner && ownerByCompany.get(firstOwner.id)) || "Owner";
    const data = countOutcomes(rows, ownerName, rows);
    grandTotal = {
      scope: "team",
      title: "All active companies",
      subtitle: "Grand total",
      message: buildMessage({
        period: opts.period,
        companyLabel: "All Active Companies",
        personLabel: "Team",
        ownerName,
        scope: "team",
        rangeStart, rangeEnd,
        data,
        monthlyBreakdown: breakdownFor(rows, ownerName, rows),
      }),
    };
  }

  return { period: opts.period, rangeStart, rangeEnd, perCompany, personalTotal, grandTotal };
}

// ─── Company live reports (for /reports) ────────────────────────────

export type CompanyLiveReport = {
  company: { id: string; name: string; slug: string; timezone: string };
  format: ReportFormat;
  rangeStart: string;
  rangeEnd: string;
  team: { name: string; message: string; hasActivity: boolean };
  people: { name: string; message: string; hasActivity: boolean }[];
};

/**
 * Compute one company's Team + per-exec reports live from `activities` for an
 * arbitrary [start, end] calendar range, in the chosen format. 100% Postgres —
 * no Sheets, no snapshots. Delete or edit an activity row and the report
 * changes on the next render.
 */
export async function loadCompanyLiveReports(
  supabase: SupabaseClient,
  opts: { companyId: string; start: string; end: string; format: ReportFormat },
): Promise<CompanyLiveReport | null> {
  const { data: c } = await supabase
    .from("companies")
    .select("id, name, slug, timezone, owner_name")
    .eq("id", opts.companyId)
    .single();
  if (!c) return null;

  const { start, end } = opts;
  const ownerName = (c.owner_name as string) || "Owner";

  // Whole company log — lead-source resolution cross-references outside the
  // range, matching the backend generators. Ordered so the earliest copy of a
  // duplicate is the one countOutcomes keeps.
  const all = await pageAll<ActivityRow>((from, to) =>
    supabase
      .from("activities")
      .select("company_id, sales_person_id, sales_person_name, occurred_on, event_type, contact_name, contact_id, contact_address, outcome, ad_source, quote_job_value, appointment_at")
      .eq("company_id", c.id)
      .order("occurred_on", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const inRange = all.filter(r => r.occurred_on >= start && r.occurred_on <= end);

  const { data: roster } = await supabase
    .from("sales_people")
    .select("id, name")
    .eq("company_id", c.id)
    .eq("active", true)
    .order("name");

  const mkReport = (rows: ActivityRow[], personLabel: string, scope: MessageScope) => {
    const data = countOutcomes(rows, ownerName, all);
    const hasActivity = Object.values(data.counts).some(v => v > 0);
    const message = buildRangeMessage({
      format: opts.format,
      companyLabel: c.name as string,
      personLabel,
      ownerName,
      scope,
      rangeStart: start,
      rangeEnd: end,
      data,
    });
    return { message, hasActivity };
  };

  const team = { name: "Team", ...mkReport(inRange, "Team", "team") };
  const people = (roster || []).map(p => {
    const rows = inRange.filter(r =>
      r.sales_person_id === p.id ||
      (!r.sales_person_id && (r.sales_person_name || "").startsWith(p.name as string)),
    );
    return { name: p.name as string, ...mkReport(rows, p.name as string, "personal") };
  });

  return {
    company: { id: c.id as string, name: c.name as string, slug: c.slug as string, timezone: (c.timezone as string) || SYDNEY_TZ },
    format: opts.format,
    rangeStart: start,
    rangeEnd: end,
    team,
    people,
  };
}
