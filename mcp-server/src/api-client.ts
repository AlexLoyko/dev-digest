/**
 * Thin HTTP client for the local DevDigest API (http://127.0.0.1:3001 by
 * default). This is the ONLY module in `mcp-server/` that calls `fetch`.
 *
 * `fetch` is an INJECTED parameter (defaulting to `globalThis.fetch`) — this
 * is what makes the whole package hermetically testable: every later layer
 * (resolver, flows, tools) receives an `ApiClient` built on top of a stubbed
 * fetch in tests, and the real global fetch in production. Never import from
 * `server/src` except `@devdigest/shared` types — this client re-implements
 * no service logic, it only shapes HTTP requests/responses.
 */
import type {
  Agent,
  ApiErrorBody,
  BlastRadiusView,
  ConventionCandidate,
  Finding,
  PrMeta,
  RunSummary,
} from '@devdigest/shared';
import type { Repo } from '@devdigest/shared';
import type { McpConfig } from './config.js';
import { ToolError, apiUnreachable, rateLimited } from './errors.js';

/** Default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * `GET /repos/:id/pulls` calls GitHub and back-fills diff stats for up to 10
 * PRs per request (`server/src/modules/pulls/routes.ts`) — it can take many
 * seconds on a cold repo, so it gets a longer budget than every other route.
 */
const LIST_PULLS_TIMEOUT_MS = 30_000;

/** One entry of the `runs` array returned by `POST /pulls/:id/review`. */
export interface RunRef {
  run_id: string;
  agent_id: string;
  agent_name: string;
}

/**
 * A single finding as it appears on a persisted review, i.e. `Finding` plus
 * the review-scoped bookkeeping fields. Mirrors
 * `server/src/modules/reviews/helpers.ts::ReviewDtoFinding` — that interface
 * is server-internal (not a `@devdigest/shared` contract), so it is
 * re-declared here rather than imported from `server/src`.
 */
export interface ReviewDtoFinding extends Finding {
  review_id: string;
  accepted_at: string | null;
  dismissed_at: string | null;
}

/**
 * One persisted review (one agent's pass over a PR), as returned by
 * `GET /pulls/:id/reviews`. Mirrors
 * `server/src/modules/reviews/helpers.ts::ReviewDto` for the same reason as
 * `ReviewDtoFinding` above.
 */
export interface ReviewDto {
  id: string;
  pr_id: string;
  agent_id: string | null;
  run_id: string | null;
  agent_name?: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
  grounding?: string | null;
  created_at: string;
  findings: ReviewDtoFinding[];
}

/** Response body of `POST /pulls/:id/review` (`server/src/modules/reviews/service.ts:103`). */
export interface StartReviewResult {
  pr_id: string;
  runs: RunRef[];
  reviews: ReviewDto[];
}

export interface ApiClient {
  listAgents(): Promise<Agent[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  startReview(prId: string, agentId: string): Promise<StartReviewResult>;
  listRuns(prId: string): Promise<RunSummary[]>;
  listReviews(prId: string): Promise<ReviewDto[]>;
  listConventions(repoId: string): Promise<ConventionCandidate[]>;
  getBlast(prId: string): Promise<BlastRadiusView>;
}

export interface CreateApiClientDeps {
  config: McpConfig;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The whole auth seam (see the L04 plan, "Auth seam (no redesign later)").
 * `LocalNoAuthProvider` means no token is needed locally today; this returns
 * `{}` in that case and adds a bearer token only when `DEVDIGEST_API_TOKEN`
 * is set — the only knob this client ever needs for auth.
 */
function authHeaders(config: McpConfig): Record<string, string> {
  return config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {};
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Runs one HTTP request against the DevDigest API and returns its parsed
 * JSON body, or throws a `ToolError` built from `errors.ts`:
 *  - any exception thrown by `fetch` itself (connection refused, DNS
 *    failure, our own `AbortSignal.timeout` firing, …) → `apiUnreachable()`.
 *    The API process is either down or unreachable; from this client's POV
 *    all of these look the same, so they are not distinguished further.
 *  - HTTP 429 → `rateLimited()` (the API's 10 review-runs/min limit).
 *  - any other non-2xx status → the API's own `ApiErrorBody.error.message`
 *    (falling back to a generic message if the body isn't JSON) plus a
 *    next-step sentence.
 */
async function request<T>(
  fetchImpl: typeof globalThis.fetch,
  config: McpConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = `${config.apiUrl}${path}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(config),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Covers ECONNREFUSED / DNS failure / "fetch failed" / our own timeout
    // firing (AbortSignal.timeout rejects fetch with an AbortError/
    // TimeoutError) — all mean "the API is not reachable right now".
    throw new ToolError(apiUnreachable(), 'api_unreachable');
  }

  if (response.status === 429) {
    throw new ToolError(rateLimited(), 'rate_limited');
  }

  if (!response.ok) {
    throw await toolErrorFromErrorResponse(response);
  }

  return (await response.json()) as T;
}

/** Builds the `ToolError` for a non-2xx, non-429 response. */
async function toolErrorFromErrorResponse(response: Response): Promise<ToolError> {
  let message = `DevDigest API returned HTTP ${response.status}.`;
  try {
    const parsed = (await response.json()) as ApiErrorBody;
    if (parsed?.error?.message) {
      message = parsed.error.message;
    }
  } catch {
    // Non-JSON or empty error body — fall back to the generic message above.
  }
  // Deliberately untagged: a generic non-2xx is not one of the modelled kinds.
  // Callers treat an absent `kind` as "unclassified API failure".
  return new ToolError(
    `${message} If this persists, check the DevDigest API log, or call devdigest_list_agents to confirm the API is reachable.`,
  );
}

/**
 * Builds the API client. `fetch` defaults to `globalThis.fetch`; tests pass
 * a stub instead (see `mcp-server/test/fake-api.ts`).
 */
export function createApiClient({ config, fetch: fetchImpl = globalThis.fetch }: CreateApiClientDeps): ApiClient {
  return {
    listAgents: () => request<Agent[]>(fetchImpl, config, '/agents'),

    listRepos: () => request<Repo[]>(fetchImpl, config, '/repos'),

    listPulls: (repoId: string) =>
      request<PrMeta[]>(fetchImpl, config, `/repos/${repoId}/pulls`, {
        timeoutMs: LIST_PULLS_TIMEOUT_MS,
      }),

    startReview: (prId: string, agentId: string) =>
      request<StartReviewResult>(fetchImpl, config, `/pulls/${prId}/review`, {
        method: 'POST',
        body: { agentId },
      }),

    listRuns: (prId: string) => request<RunSummary[]>(fetchImpl, config, `/pulls/${prId}/runs`),

    listReviews: (prId: string) => request<ReviewDto[]>(fetchImpl, config, `/pulls/${prId}/reviews`),

    listConventions: (repoId: string) =>
      request<ConventionCandidate[]>(fetchImpl, config, `/repos/${repoId}/conventions`),

    getBlast: (prId: string) => request<BlastRadiusView>(fetchImpl, config, `/pulls/${prId}/blast`),
  };
}
