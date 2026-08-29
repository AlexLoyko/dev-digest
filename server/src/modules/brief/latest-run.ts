import { Verdict, type BriefLatestRun } from '@devdigest/shared';

/**
 * One `agent_runs` row already left-joined to its `reviews` row (on
 * `reviews.run_id`) and to its `agents` row (for the display name). This is
 * exactly the shape `repository.ts`'s `getLatestRunRows` must return — this
 * file and `repository.ts` share this contract; do not diverge from it
 * without updating both.
 *
 * `status`/`verdict` are typed as raw `string | null` (not the narrower
 * `Verdict` enum) because they come straight off `text()` columns with no DB
 * constraint — this module is the one place that validates them.
 */
export interface AgentRunWithReview {
  run_id: string;
  ran_at: Date | string;
  status: string | null;
  score: number | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  findings_count: number | null;
  blockers: number | null;
  agent_name: string | null;
  verdict: string | null;
}

/** The only status value that counts as "terminal-successful" (AC-12, EC-5). */
const TERMINAL_SUCCESSFUL_STATUS = 'done';

/**
 * Picks the run that should drive the brief card's headline/colour treatment
 * and its finding/blocker/score/cost/token numbers (AC-12).
 *
 * A row only "counts" as a completed run when BOTH hold:
 *   - its status is terminal-successful (`done`) — `running`/`failed`/
 *     `cancelled` are excluded outright, and
 *   - it carries a genuinely valid `verdict` — `reviews.verdict` is a free
 *     `text()` column with no DB-level enum constraint, so a null, missing,
 *     or corrupt value is treated the same as "no verdict" (EC-5).
 *
 * A failed or cancelled run must never contribute a zero score or a zero
 * cost, and must never override the card's risk-level headline — excluding
 * it from the candidate set entirely (rather than defaulting its fields)
 * is what guarantees that.
 *
 * Newest by `ran_at` wins among the remaining candidates. Pure: no I/O, no
 * Container.
 */
export function selectLatestCompletedRun(rows: readonly AgentRunWithReview[]): BriefLatestRun | null {
  const completed = rows.filter((row): row is AgentRunWithReview & { verdict: Verdict } => {
    if (row.status !== TERMINAL_SUCCESSFUL_STATUS) return false;
    return Verdict.safeParse(row.verdict).success;
  });

  if (completed.length === 0) return null;

  const newest = completed.reduce((latest, row) =>
    new Date(row.ran_at).getTime() > new Date(latest.ran_at).getTime() ? row : latest,
  );

  return {
    run_id: newest.run_id,
    verdict: newest.verdict,
    // A completed run always has a findings count and a blocker count in
    // practice (the app only writes these together with status='done'); the
    // `?? 0` here is a defensive fallback for the null column type, not a
    // substitute for score/cost/tokens' "never coerce" rule below — those
    // three genuinely can be unmeasured for a completed run and must stay
    // null to say so.
    findings_count: newest.findings_count ?? 0,
    blockers: newest.blockers ?? 0,
    score: newest.score,
    cost_usd: newest.cost_usd,
    tokens_in: newest.tokens_in,
    tokens_out: newest.tokens_out,
    agent_name: newest.agent_name ?? 'Unknown agent',
  };
}
