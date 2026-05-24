// Read helpers for the won_jobs pipeline. RLS-scoped via the passed client.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Stage = "verbal_confirmation" | "client_approved" | "invoiced" | "paid";

export const STAGES: Stage[] = [
  "verbal_confirmation",
  "client_approved",
  "invoiced",
  "paid",
];

export const STAGE_LABEL: Record<Stage, string> = {
  verbal_confirmation: "Verbal",
  client_approved:     "Approved",
  invoiced:            "Invoiced",
  paid:                "Paid",
};

export type StageStat = { stage: Stage; count: number; commission: number; jobValue: number };

export type WonJobsSummary = {
  byStage: StageStat[];                // ordered verbal → paid
  totalCommission: number;
  totalJobValue: number;
  totalJobs: number;
};

const EMPTY_STAGE_STAT = (s: Stage): StageStat => ({ stage: s, count: 0, commission: 0, jobValue: 0 });

/**
 * Per-stage rollup for one exec across all companies they're on. RLS
 * naturally scopes admin (sees all) vs exec (sees own only).
 */
export async function loadExecWonJobsSummary(
  supabase: SupabaseClient,
  execName: string,
): Promise<WonJobsSummary> {
  const { data: salesRows } = await supabase
    .from("sales_people")
    .select("id")
    .ilike("name", execName);
  const ids = (salesRows || []).map(r => r.id as string);
  if (ids.length === 0) {
    return {
      byStage: STAGES.map(EMPTY_STAGE_STAT),
      totalCommission: 0, totalJobValue: 0, totalJobs: 0,
    };
  }

  const { data: rows } = await supabase
    .from("won_jobs")
    .select("stage, commission_amount, job_value")
    .in("sales_person_id", ids);

  const map = new Map<Stage, StageStat>(STAGES.map(s => [s, EMPTY_STAGE_STAT(s)]));
  for (const r of rows || []) {
    const s = r.stage as Stage;
    const stat = map.get(s);
    if (!stat) continue;
    stat.count++;
    stat.commission += Number(r.commission_amount || 0);
    stat.jobValue   += Number(r.job_value || 0);
  }

  const byStage = STAGES.map(s => map.get(s)!);
  return {
    byStage,
    totalCommission: byStage.reduce((s, x) => s + x.commission, 0),
    totalJobValue:   byStage.reduce((s, x) => s + x.jobValue, 0),
    totalJobs:       byStage.reduce((s, x) => s + x.count, 0),
  };
}
