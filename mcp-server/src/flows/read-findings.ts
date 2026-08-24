/**
 * `readFindings` — the application-layer use-case behind
 * `devdigest_get_findings`.
 *
 * There is no `GET /runs/:id` route and `RunTrace` carries no `pr_id` (see
 * `run-index.ts`'s header comment), so the run index built by `runReview`
 * (T10a) is the ONLY path from a bare `run_id` back to its PR context. This
 * flow therefore starts at `runIndex.get(runId)`: a miss is the honest,
 * actionable R6 error (the model must call `devdigest_run_agent_on_pr`
 * first), never a repo+PR fallback.
 *
 * Like `runReview`, this function never throws for an expected condition —
 * it returns `status: 'failed'` carrying an already-built message from
 * `errors.ts` — and it never formats a `ToolResult`; that is exclusively
 * `src/tools/get-findings.ts` (T13)'s job.
 */
import type { ApiClient, ReviewDto } from '../api-client.js';
import type { RunIndex, RunIndexEntry } from '../run-index.js';
import type { ToolDeps } from '../tools/types.js';
import { noReviewForRun, runFailed, runVanished, unknownRunId } from '../errors.js';
import type { RunOutcome } from './run-review.js';

export interface ReadFindingsInput {
  runId: string;
}

/** Extracts the underlying error message, whether it came as a `ToolError` or a plain `Error`. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Builds the "running" outcome from the run index entry — its `started_at` is the only clock this flow has. */
function stillRunning(entry: RunIndexEntry, runId: string): RunOutcome {
  return {
    status: 'running',
    runId,
    repo: entry.repo,
    pr: entry.pr,
    agentId: entry.agent_id,
    agentName: entry.agent_name,
    elapsedS: Math.round((Date.now() - entry.started_at) / 1000),
  };
}

/**
 * Reads the current status and, once finished, the findings of a review run
 * previously started by `runReview` (T10a).
 *
 * Sequence (R6): `runIndex.get(runId)` -> miss is `unknown_run` -> hit ->
 * `api.listRuns(prId)` to find the current status -> `running` stays
 * `running`; `failed`/`cancelled` -> `run_failed`; `done` ->
 * `api.listReviews(prId)` matched on `run_id` (never "the latest", since
 * several `ReviewDto` rows can share a PR).
 */
export async function readFindings(deps: ToolDeps, input: ReadFindingsInput): Promise<RunOutcome> {
  const api = deps.api as ApiClient;
  const runIndex = deps.runIndex as RunIndex;
  const { runId } = input;

  const entry = runIndex.get(runId);
  if (!entry) {
    return { status: 'failed', kind: 'unknown_run', text: unknownRunId(runId) };
  }

  let runs;
  try {
    runs = await api.listRuns(entry.pr_id);
  } catch (err) {
    return { status: 'failed', kind: 'api_unreachable', text: errText(err) };
  }

  const run = runs.find((candidate) => candidate.run_id === runId);
  if (!run) {
    // The run index knows about this run_id, but the API no longer lists it
    // for its PR (e.g. deleted mid-review). Distinct from `unknown_run`
    // (this server never started it at all) and from `no_review` (the run
    // finished but has no review row).
    return { status: 'failed', kind: 'api_unreachable', text: runVanished(runId, entry.pr_id) };
  }

  if (run.status === 'failed' || run.status === 'cancelled') {
    return { status: 'failed', kind: 'run_failed', text: runFailed(runId, run.error ?? 'unknown error') };
  }

  if (run.status !== 'done') {
    return stillRunning(entry, runId);
  }

  let reviews: ReviewDto[];
  try {
    reviews = await api.listReviews(entry.pr_id);
  } catch (err) {
    return { status: 'failed', kind: 'api_unreachable', text: errText(err) };
  }

  const review = reviews.find((candidate) => candidate.run_id === runId);
  if (!review) {
    return { status: 'failed', kind: 'no_review', text: noReviewForRun(runId) };
  }

  return {
    status: 'done',
    runId,
    prId: entry.pr_id,
    repo: entry.repo,
    pr: entry.pr,
    agentId: entry.agent_id,
    agentName: entry.agent_name,
    review,
  };
}
