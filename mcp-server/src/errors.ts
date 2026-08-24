/**
 * Actionable error builders for mcp-server tools.
 *
 * Design principle 4 — "an error leads somewhere": every builder in this
 * module must produce a message that ends with a directive sentence naming
 * a concrete next action — a `devdigest_*` tool to call, a shell command to
 * run, or a URL to open. A bare "not found" is a failure of this module's
 * contract. `errors.test.ts` enforces this automatically for every export.
 *
 * These strings are specified verbatim in
 * `docs/plans/l04-devdigest-mcp.md` under "The five tools (exact contracts)".
 * Do not reword them without updating that plan section too.
 */

/**
 * The full set of discriminants a tool-facing failure can carry. This is the
 * single source of truth: `run-review.ts`'s `RunOutcomeFailedKind` must list
 * exactly these same nine values (`run-review.test.ts` asserts the two stay
 * in sync, at both the type level and the runtime-array level) so that
 * rewording an error builder's text can never silently change which kind a
 * caller observes — see `ToolError.kind` below and `flows/run-review.ts`'s
 * `classify()`, which is now only a documented fallback for un-tagged errors.
 */
export const TOOL_ERROR_KINDS = [
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

export type ToolErrorKind = (typeof TOOL_ERROR_KINDS)[number];

/** Enumerated lists (known repos, known PR numbers) are capped at this many items. */
const MAX_LIST_ITEMS = 20;

/** Joins a list, capping at MAX_LIST_ITEMS with a "(+N more)" suffix when truncated. */
function capList(items: string[]): string {
  if (items.length <= MAX_LIST_ITEMS) {
    return items.join(', ');
  }
  const shown = items.slice(0, MAX_LIST_ITEMS);
  const more = items.length - MAX_LIST_ITEMS;
  return `${shown.join(', ')} (+${more} more)`;
}

/**
 * Carries a pre-formatted, user/model-facing error message for MCP tool
 * responses, plus an optional `kind` discriminant (`ToolErrorKind`).
 *
 * `kind` is optional, not required, because not every throw site in the
 * codebase can be updated by this module alone — `api-client.ts`'s three
 * `ToolError` throws (`rate_limited`, `api_unreachable`, and the generic
 * non-2xx HTTP error) are outside this task's owned paths and still
 * construct a `ToolError` with only a message. Callers that need a kind
 * (`flows/run-review.ts`) prefer `err.kind` when present and fall back to
 * `classify(text)` — a documented, explicitly-commented last resort — only
 * when it is absent.
 */
export class ToolError extends Error {
  readonly text: string;
  readonly kind: ToolErrorKind | undefined;

  constructor(text: string, kind?: ToolErrorKind) {
    super(text);
    this.name = 'ToolError';
    this.text = text;
    this.kind = kind;
  }
}

/** The local DevDigest API process could not be reached at all. */
export function apiUnreachable(): string {
  return (
    'DevDigest API is not reachable at http://127.0.0.1:3001. ' +
    'Ask the user to start it with ./scripts/dev.sh, then retry. Do not retry in a loop.'
  );
}

/** `repo` (as "owner/name") does not match any repository registered in DevDigest. */
export function unknownRepo(input: string, known: string[]): string {
  return (
    `Repository "${input}" is not in DevDigest. Known repositories: ${capList(known)}. ` +
    'Add it at http://localhost:3000/repos, then retry.'
  );
}

/**
 * `pr` is not among the PR numbers imported for `repo`.
 *
 * Note: the plan's verbatim text for this error ("Open the repo in
 * DevDigest to import more PRs, then retry.") has no directive token
 * (no `devdigest_*` tool, no `./scripts/dev.sh`, no `http://localhost:3000`
 * URL) — see this implementer's final report for the inconsistency this
 * creates against T4's own acceptance regex. This builder adds the
 * `http://localhost:3000` URL, consistent with every other builder's
 * pattern of naming the concrete DevDigest UI location.
 */
export function unknownPr(repo: string, pr: number, knownNumbers: number[]): string {
  return (
    `PR #${pr} was not found in ${repo}. ` +
    `Imported PR numbers include: ${capList(knownNumbers.map(String))}. ` +
    'Open the repo in DevDigest at http://localhost:3000 to import more PRs, then retry.'
  );
}

/** `agent_id`/agent name does not match any configured agent. */
export function unknownAgent(input: string): string {
  return `Agent "${input}" not found. Call devdigest_list_agents to get the valid agent ids, then retry.`;
}

/** The resolved agent exists but its `enabled` field is false. */
export function agentDisabled(name: string): string {
  return (
    `Agent "${name}" is disabled in DevDigest. Enable it at http://localhost:3000/agents, ` +
    'or call devdigest_list_agents and pick one whose "enabled" is true.'
  );
}

/** The API rejected the request with HTTP 429 (10 review runs/min limit). */
export function rateLimited(): string {
  return (
    'DevDigest allows at most 10 review runs per minute. Wait ~60 seconds and call ' +
    'devdigest_run_agent_on_pr again — or, if you already started a run, call ' +
    'devdigest_get_findings with its run_id.'
  );
}

/** `run_id` is missing or was never produced by this server (devdigest_get_findings, R6). */
export function unknownRunId(runId: string): string {
  return (
    `Unknown run_id "${runId}". This server only knows runs it started. ` +
    'Call devdigest_run_agent_on_pr(repo, pr, agent_id) to start a review — ' +
    'it returns a run_id and waits for the findings.'
  );
}

/**
 * The run ended with status `failed` or `cancelled`.
 *
 * Note: `runId` is accepted for symmetry with the other run-scoped builders
 * (`unknownRunId`, `noReviewForRun`) but is intentionally not interpolated
 * into the message — the plan's verbatim text for this error (under
 * `devdigest_run_agent_on_pr`) does not reference the run id, only
 * `run.error`. See this implementer's final report for the plan
 * inconsistency this reveals.
 */
export function runFailed(runId: string, error: string): string {
  void runId;
  return `The review run failed: ${error}. Check the DevDigest API log, then call devdigest_run_agent_on_pr again to retry.`;
}

/**
 * The run vanished: `listRuns` succeeded but no longer contains this run_id,
 * for several consecutive polls. Distinct from `apiUnreachable()` (the call
 * itself failed) and from `unknownRunId()` (this server never started it).
 * Reachable by the model through the wait loop, so it carries a next step.
 */
export function runVanished(runId: string, prId: string): string {
  return (
    `Run "${runId}" is no longer listed for pull request ${prId} — it may have been ` +
    'deleted while the review was in progress. Call devdigest_run_agent_on_pr(repo, pr, agent_id) ' +
    'to start a fresh review.'
  );
}

/** The run finished but its review row is missing (devdigest_get_findings). */
export function noReviewForRun(runId: string): string {
  return `Run "${runId}" finished but produced no review. Call devdigest_run_agent_on_pr(repo, pr, agent_id) to run it again.`;
}
