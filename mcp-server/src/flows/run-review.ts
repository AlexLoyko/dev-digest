/**
 * `runReview` — the application-layer use-case behind `devdigest_run_agent_on_pr`.
 *
 * Per the L04 plan's "Architecture changes" section, `mcp-server/` maps the
 * onion layers onto a different transport: tool handler (`src/tools/*.ts`,
 * presentation) -> use-case (`src/flows/*.ts`, application) -> orchestration
 * helpers (`src/wait.ts`, `src/resolve.ts`) -> I/O adapter (`src/api-client.ts`,
 * `src/run-index.ts`). This module is the use-case: the whole seven-step
 * sequence — resolve repo -> resolve PR -> resolve agent -> start the review
 * -> record the run in the run index -> wait for completion -> collect the
 * finished review — lives here, so the tool handler (T12) can stay a
 * three-step mapping with no branching of its own.
 *
 * Two rules this file exists to enforce (both asserted by `run-review.test.ts`):
 *  1. It NEVER throws for an expected condition. Every failure — an unknown
 *     repo/PR/agent, a disabled agent, a 429, a failed run, a missing review
 *     row, an unreachable API — comes back as `{ status: 'failed', kind, text }`
 *     carrying an already-built, actionable message from `errors.ts`, so the
 *     tool layer stays a pure mapping instead of a try/catch tree.
 *  2. It NEVER formats. This file must not serialize its result to a JSON
 *     string, nor import the response-formatting module that lives one
 *     directory up — turning a `RunOutcome` into a `ToolResult` (JSON
 *     envelope, `ok()`/`fail()`, untrusted-wrapping) is exclusively the tool
 *     handler's (T12's) job.
 */
import type { ApiClient, ReviewDto } from '../api-client.js';
import type { Resolver } from '../resolve.js';
import type { RunIndex } from '../run-index.js';
import type { ToolDeps } from '../tools/types.js';
import { ToolError, apiUnreachable, noReviewForRun, runFailed } from '../errors.js';
import { waitForRun } from '../wait.js';

/**
 * The discriminated set of "expected" ways a review can fail to produce
 * finished findings. `unknown_run` is not reachable from `runReview` itself
 * (it has no `run_id` to look up yet) — it is carried here, rather than
 * redeclared in `read-findings.ts` (T10b), because `RunOutcome` is shared
 * between both flows and T10b's own acceptance criterion requires it to
 * import this type rather than redeclare it.
 *
 * This union must list exactly the same values as `errors.ts`'s
 * `ToolErrorKind` — `run-review.test.ts` asserts the two stay in sync (a
 * type-level assertion plus a runtime array comparison against
 * `RUN_OUTCOME_FAILED_KINDS` below), so adding a kind to one union without
 * the other fails the suite instead of silently drifting.
 */
export type RunOutcomeFailedKind =
  | 'unknown_repo'
  | 'unknown_pr'
  | 'unknown_agent'
  | 'agent_disabled'
  | 'rate_limited'
  | 'run_failed'
  | 'no_review'
  | 'api_unreachable'
  | 'unknown_run';

/** Runtime mirror of `RunOutcomeFailedKind`, for the sync test against `errors.ts`'s `TOOL_ERROR_KINDS`. */
export const RUN_OUTCOME_FAILED_KINDS: readonly RunOutcomeFailedKind[] = [
  'unknown_repo',
  'unknown_pr',
  'unknown_agent',
  'agent_disabled',
  'rate_limited',
  'run_failed',
  'no_review',
  'api_unreachable',
  'unknown_run',
] as const;

export interface RunOutcomeDone {
  status: 'done';
  runId: string;
  prId: string;
  repo: string;
  pr: number;
  agentId: string;
  agentName: string;
  review: ReviewDto;
}

export interface RunOutcomeRunning {
  status: 'running';
  runId: string;
  repo: string;
  pr: number;
  agentId: string;
  agentName: string;
  elapsedS: number;
}

export interface RunOutcomeFailed {
  status: 'failed';
  kind: RunOutcomeFailedKind;
  text: string;
}

/**
 * The discriminated outcome of a review use-case, shared between
 * `runReview` (T10a) and `readFindings` (T10b) — see `read-findings.ts`,
 * which imports this type rather than redeclaring it.
 */
export type RunOutcome = RunOutcomeDone | RunOutcomeRunning | RunOutcomeFailed;

export interface RunReviewInput {
  repo: string;
  pr: number;
  agentId: string;
}

function failed(kind: RunOutcomeFailedKind, text: string): RunOutcomeFailed {
  return { status: 'failed', kind, text };
}

/** Extracts the already-built, actionable message from a caught error. */
function errText(err: unknown): string {
  if (err instanceof ToolError) {
    return err.text;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * FALLBACK ONLY — do not add new call sites of this function. It re-derives
 * a `RunOutcomeFailedKind` from an already-built error message's text by
 * substring matching, which is exactly the "no compile-time link" hazard
 * this module's hardening pass exists to close: reword a builder in
 * `errors.ts` and this stops matching, silently, with no test failing.
 *
 * `classifyError()` below only calls this when a caught error did not
 * already carry a `ToolError.kind` — today that is exactly the throws in
 * `api-client.ts` (`rate_limited`, `api_unreachable`, and the generic
 * non-2xx HTTP error), which are outside this task's owned paths. Every
 * other throw site (`resolve.ts`) sets `.kind` explicitly and never reaches
 * this function. See this implementer's final report for the follow-up:
 * `api-client.ts` should be updated to set `.kind` too, at which point this
 * function can be deleted entirely.
 */
function classify(text: string): RunOutcomeFailedKind {
  if (text.includes('is not in DevDigest')) {
    return 'unknown_repo';
  }
  if (text.includes('was not found in')) {
    return 'unknown_pr';
  }
  if (text.includes('is disabled in DevDigest')) {
    return 'agent_disabled';
  }
  if (text.includes('not found. Call devdigest_list_agents')) {
    return 'unknown_agent';
  }
  if (text.includes('review runs per minute')) {
    return 'rate_limited';
  }
  return 'api_unreachable';
}

/**
 * Resolves the `RunOutcomeFailedKind` for a caught error: prefers the
 * explicit discriminant a `ToolError` was thrown with (`err.kind`), and
 * only falls back to the text-substring `classify()` above when the caught
 * error is untagged. `ToolErrorKind` and `RunOutcomeFailedKind` share the
 * same nine literal values (enforced by `run-review.test.ts`), so `err.kind`
 * is always a valid `RunOutcomeFailedKind` when present.
 */
function classifyError(err: unknown, text: string): RunOutcomeFailedKind {
  if (err instanceof ToolError && err.kind) {
    return err.kind;
  }
  return classify(text);
}

/**
 * Runs one full review use-case: resolve identifiers, start the review,
 * record it in the run index (BEFORE waiting — see below), wait for it to
 * reach a terminal status within the configured budget, then collect the
 * matching finished review.
 *
 * Ordering requirement (T10a): `runIndex.put(...)` happens before
 * `waitForRun(...)` is even called, so a budget timeout still leaves the
 * caller a usable `run_id` — `run-review.test.ts` asserts this ordering
 * explicitly.
 */
export async function runReview(deps: ToolDeps, input: RunReviewInput): Promise<RunOutcome> {
  const api = deps.api as ApiClient;
  const resolver = deps.resolver as Resolver;
  const runIndex = deps.runIndex as RunIndex;
  const { config } = deps;

  let repo;
  try {
    repo = await resolver.resolveRepo(input.repo);
  } catch (err) {
    const text = errText(err);
    return failed(classifyError(err, text), text);
  }

  let pr;
  try {
    pr = await resolver.resolvePr(repo.id, input.pr);
  } catch (err) {
    const text = errText(err);
    return failed(classifyError(err, text), text);
  }

  let agent;
  try {
    agent = await resolver.resolveAgent(input.agentId);
  } catch (err) {
    const text = errText(err);
    return failed(classifyError(err, text), text);
  }

  let startResult;
  try {
    startResult = await api.startReview(pr.id, agent.id);
  } catch (err) {
    const text = errText(err);
    return failed(classifyError(err, text), text);
  }

  const runRef = startResult.runs[0];
  if (!runRef) {
    // Defensive: `POST /pulls/:id/review` with a single `agentId` is
    // documented to always return at least one `runs[]` entry
    // (`reviews/service.ts:103`). If the API contract is ever violated,
    // this is indistinguishable from the API being unreachable/misbehaving
    // from this flow's point of view.
    return failed('api_unreachable', apiUnreachable());
  }

  // Recorded BEFORE waitForRun() is called — see the ordering requirement
  // in the doc comment above and this rule's test in run-review.test.ts.
  runIndex.put({
    run_id: runRef.run_id,
    pr_id: pr.id,
    repo: repo.full_name,
    pr: input.pr,
    agent_id: agent.id,
    agent_name: agent.name,
    started_at: Date.now(),
  });

  const waitResult = await waitForRun({
    api,
    prId: pr.id,
    runId: runRef.run_id,
    budgetMs: config.runTimeoutMs,
    pollMs: config.pollIntervalMs,
    // Forwarded from ToolDeps (see types.ts) so the assembled server's real
    // clock/sleep — or a test's injected fake ones — actually reach
    // waitForRun(), instead of every caller above wait.ts always getting its
    // internal Date.now()/setTimeout defaults regardless of what was passed
    // in. `deps.now`/`deps.sleep` are `undefined` for any ToolDeps literal
    // that doesn't set them (e.g. run-review.test.ts's buildDeps()), and
    // waitForRun's own default parameters take over in that case — no
    // behaviour change there.
    now: deps.now,
    sleep: deps.sleep,
  });

  if (waitResult.outcome === 'timeout') {
    return {
      status: 'running',
      runId: runRef.run_id,
      repo: repo.full_name,
      pr: input.pr,
      agentId: agent.id,
      agentName: agent.name,
      elapsedS: Math.round(waitResult.elapsedMs / 1000),
    };
  }

  if (waitResult.outcome === 'error') {
    // `waitResult.error` is already an actionable message built from
    // `errors.ts` (`apiUnreachable()` or `runVanished()`) — see `wait.ts`.
    // Neither has a more specific `RunOutcomeFailedKind` than
    // `api_unreachable` from this flow's point of view.
    return failed('api_unreachable', waitResult.error ?? apiUnreachable());
  }

  if (waitResult.outcome === 'failed' || waitResult.outcome === 'cancelled') {
    const errorText = waitResult.run?.error ?? 'unknown error';
    return failed('run_failed', runFailed(runRef.run_id, errorText));
  }

  // waitResult.outcome === 'done'
  let reviews: ReviewDto[];
  try {
    reviews = await api.listReviews(pr.id);
  } catch (err) {
    const text = errText(err);
    return failed(classifyError(err, text), text);
  }

  const review = reviews.find((candidate) => candidate.run_id === runRef.run_id);
  if (!review) {
    return failed('no_review', noReviewForRun(runRef.run_id));
  }

  return {
    status: 'done',
    runId: runRef.run_id,
    prId: pr.id,
    repo: repo.full_name,
    pr: input.pr,
    agentId: agent.id,
    agentName: agent.name,
    review,
  };
}
