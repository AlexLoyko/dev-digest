/**
 * Stubbed `fetch` + canned, contract-shaped fixtures for the eight API
 * routes `mcp-server/src/api-client.ts` consumes. Used by every hermetic
 * test in `mcp-server/` from T7 onward so no test has to hand-roll a fetch
 * stub for the happy-path fixtures.
 *
 * Every fixture is run through the REAL Zod schema from `@devdigest/shared`
 * (`.parse()`, not `.safeParse()`) at module load, so a breaking change to a
 * shared contract fails LOUDLY here instead of silently drifting.
 */
import {
  Agent,
  BlastRadiusView,
  ConventionCandidate,
  Finding,
  PrMeta,
  Repo,
  RunSummary,
} from '@devdigest/shared';
import type {
  Agent as AgentType,
  BlastRadiusView as BlastRadiusViewType,
  ConventionCandidate as ConventionCandidateType,
  Finding as FindingType,
  PrMeta as PrMetaType,
  Repo as RepoType,
  RunSummary as RunSummaryType,
} from '@devdigest/shared';
import type { ReviewDto } from '../src/api-client.js';

// ---- Fixed ids, so tests can assert on them directly -----------------------

export const REPO_API_ID = 'a0000000-0000-0000-0000-000000000001';
export const REPO_WEB_ID = 'a0000000-0000-0000-0000-000000000002';
export const AGENT_GENERAL_ID = 'ag000000-0000-0000-0000-000000000001';
export const AGENT_LEGACY_ID = 'ag000000-0000-0000-0000-000000000002';
export const PR_482_ID = 'p0000000-0000-0000-0000-000000000482';
export const PR_481_ID = 'p0000000-0000-0000-0000-000000000481';
/** PR 480 is intentionally NOT importable yet — `id` is nullish (`PrMeta.id`,
 * `platform.ts:158`) — so resolver tests can exercise the "not found" guard. */
export const PR_480_NUMBER = 480;
export const RUN_ID = 'run00000-0000-0000-0000-000000000001';
export const REVIEW_ID = 'review00-0000-0000-0000-000000000001';

const FINDING_CATEGORIES = ['bug', 'security', 'perf', 'style', 'test'] as const;

// ---- Fixture builders --------------------------------------------------

function buildRepos(): RepoType[] {
  return [
    Repo.parse({
      id: REPO_API_ID,
      workspace_id: 'w0000000-0000-0000-0000-000000000001',
      owner: 'acme',
      name: 'api',
      full_name: 'acme/api',
      default_branch: 'main',
      clone_path: '/tmp/devdigest/acme/api',
      last_polled_at: '2026-08-20T12:00:00.000Z',
      created_by: 'user-1',
    }),
    Repo.parse({
      id: REPO_WEB_ID,
      workspace_id: 'w0000000-0000-0000-0000-000000000001',
      owner: 'acme',
      name: 'web',
      full_name: 'acme/web',
      default_branch: 'main',
      clone_path: null,
      last_polled_at: null,
      created_by: null,
    }),
  ];
}

function buildPulls(): PrMetaType[] {
  return [
    // PR_480_NUMBER: `id: null` — imported into GitHub search results but not
    // yet persisted with a DevDigest PR row. Resolver must treat this as "not
    // importable yet" (unknownPr), not crash on a null id.
    PrMeta.parse({
      id: null,
      number: PR_480_NUMBER,
      title: 'Add rate limiter',
      author: 'alice',
      branch: 'feat/rate-limit',
      base: 'main',
      head_sha: 'sha000480',
      additions: 10,
      deletions: 2,
      files_count: 2,
      status: 'open',
      opened_at: '2026-08-15T09:00:00.000Z',
      updated_at: '2026-08-15T09:00:00.000Z',
      score: null,
      findings_critical: null,
      findings_warning: null,
      findings_suggestion: null,
      last_run_cost_usd: null,
    }),
    PrMeta.parse({
      id: PR_481_ID,
      number: 481,
      title: 'Fix flaky auth test',
      author: 'bob',
      branch: 'fix/flaky-auth',
      base: 'main',
      head_sha: 'sha000481',
      additions: 20,
      deletions: 5,
      files_count: 3,
      status: 'reviewed',
      opened_at: '2026-08-16T09:00:00.000Z',
      updated_at: '2026-08-17T09:00:00.000Z',
      score: 88,
      findings_critical: 0,
      findings_warning: 1,
      findings_suggestion: 2,
      last_run_cost_usd: 0.12,
    }),
    PrMeta.parse({
      id: PR_482_ID,
      number: 482,
      title: 'Add GitHub webhook ingestion',
      author: 'carol',
      branch: 'feat/webhook-ingestion',
      base: 'main',
      head_sha: 'sha000482',
      additions: 340,
      deletions: 12,
      files_count: 9,
      status: 'needs_review',
      opened_at: '2026-08-19T09:00:00.000Z',
      updated_at: '2026-08-20T09:00:00.000Z',
      score: null,
      findings_critical: null,
      findings_warning: null,
      findings_suggestion: null,
      last_run_cost_usd: null,
    }),
  ];
}

function buildAgents(): AgentType[] {
  return [
    Agent.parse({
      id: AGENT_GENERAL_ID,
      name: 'General',
      description: 'General-purpose reviewer for bugs, security and style.',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'Review this PR for bugs, security issues and style problems.',
      output_schema: null,
      enabled: true,
      version: 1,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skill_count: 0,
    }),
    Agent.parse({
      id: AGENT_LEGACY_ID,
      name: 'Legacy',
      description: 'Deprecated reviewer, kept for history only.',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'Review this PR against the legacy style guide.',
      output_schema: null,
      enabled: false,
      version: 1,
      strategy: 'single-pass',
      ci_fail_on: 'never',
      repo_intel: false,
      skill_count: 0,
    }),
  ];
}

/** 47 findings across all three severities: 5 CRITICAL, 20 WARNING, 22 SUGGESTION. */
function buildFindings(): FindingType[] {
  const plan: { severity: FindingType['severity']; count: number }[] = [
    { severity: 'CRITICAL', count: 5 },
    { severity: 'WARNING', count: 20 },
    { severity: 'SUGGESTION', count: 22 },
  ];
  const findings: FindingType[] = [];
  let n = 0;
  for (const { severity, count } of plan) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      findings.push(
        Finding.parse({
          id: `finding-${n}`,
          severity,
          category: FINDING_CATEGORIES[n % FINDING_CATEGORIES.length],
          title: `${severity} finding #${n}`,
          file: `src/module-${n % 5}.ts`,
          start_line: 10 + n,
          end_line: 12 + n,
          rationale: `Rationale for finding ${n}.`,
          suggestion: n % 3 === 0 ? `Suggested fix for finding ${n}.` : null,
          confidence: 0.5 + (n % 5) / 10,
          kind: 'finding',
          trifecta_components: null,
          evidence: null,
        }),
      );
    }
  }
  return findings;
}

function buildReview(findings: FindingType[]): ReviewDto {
  return {
    id: REVIEW_ID,
    pr_id: PR_482_ID,
    agent_id: AGENT_GENERAL_ID,
    run_id: RUN_ID,
    agent_name: 'General',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'This PR adds webhook ingestion but has several critical security gaps.',
    score: 62,
    model: 'gpt-4.1',
    grounding: '47/47 grounded',
    created_at: '2026-08-20T12:05:00.000Z',
    findings: findings.map((finding) => ({
      ...finding,
      review_id: REVIEW_ID,
      accepted_at: null,
      dismissed_at: null,
    })),
  };
}

function buildConventions(): ConventionCandidateType[] {
  return [
    ConventionCandidate.parse({
      id: 'conv-0001',
      rule: 'Get dependencies through platform/container.ts (constructor injection).',
      evidence_path: 'src/platform/container.ts',
      evidence_snippet: 'export class Container { constructor(private readonly deps: Deps) {} }',
      confidence: 0.92,
      accepted: true,
    }),
    ConventionCandidate.parse({
      id: 'conv-0002',
      rule: 'Validate every route body/params with a Zod schema.',
      evidence_path: 'src/modules/agents/routes.ts',
      evidence_snippet: "app.post('/agents', { schema: { body: CreateAgentBody } }, ...)",
      confidence: 0.85,
      accepted: true,
    }),
    ConventionCandidate.parse({
      id: 'conv-0003',
      rule: 'Prefer early returns over nested conditionals in service methods.',
      evidence_path: 'src/modules/reviews/service.ts',
      evidence_snippet: 'if (!pull) throw new NotFoundError(...);',
      confidence: 0.61,
      accepted: false,
    }),
  ];
}

/** 8 raw callers (> the tool's 5-per-symbol display cap) so tests can exercise `callers_truncated`. */
function buildBlastRadius(prId: string): BlastRadiusViewType {
  return BlastRadiusView.parse({
    pr_id: prId,
    repo_full_name: 'acme/api',
    indexed_sha: 'sha-indexed-001',
    head_sha: 'sha000482',
    state: 'full',
    reason: 'ok',
    explanation: '',
    symbols: [
      {
        name: 'getContext',
        file: 'server/src/modules/_shared/context.ts',
        kind: 'function',
        callers: Array.from({ length: 8 }, (_, i) => ({
          file: `server/src/modules/route-${i}/routes.ts`,
          symbol: `handler${i}`,
          line: 10 + i,
          rank: 8 - i,
        })),
        caller_total: 8,
        callers_truncated: true,
        endpoints: [
          { label: 'GET /agents', file: 'server/src/modules/route-0/routes.ts', depth: 1 },
          { label: 'POST /repos', file: 'server/src/modules/route-1/routes.ts', depth: 1 },
        ],
        crons: [],
        endpoint_total: 2,
        cron_total: 0,
        facts_truncated: false,
      },
      {
        name: 'RequestContext',
        file: 'server/src/modules/_shared/context.ts',
        kind: 'interface',
        callers: [],
        caller_total: 0,
        callers_truncated: false,
        endpoints: [],
        crons: [],
        endpoint_total: 0,
        cron_total: 0,
        facts_truncated: false,
      },
    ],
    counts: { symbols: 2, callers: 8, endpoints: 2, crons: 0 },
    prior_prs: [
      {
        number: 401,
        title: 'Tune rate limit window',
        author: 'marisa.koch',
        status: 'merged',
        updated_at: '2026-03-18T00:00:00Z',
        files_overlap: ['server/src/modules/_shared/context.ts'],
      },
    ],
  });
}

const RUN_STATUS_VALUES = ['running', 'done', 'failed', 'cancelled', null] as const;

function buildRunSummary(status: string | null): RunSummaryType {
  const done = status === 'done';
  return RunSummary.parse({
    run_id: RUN_ID,
    agent_id: AGENT_GENERAL_ID,
    agent_name: 'General',
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    error: status === 'failed' ? 'LLM provider returned a 500' : null,
    duration_ms: done ? 45_000 : null,
    tokens_in: done ? 12_000 : null,
    tokens_out: done ? 3_000 : null,
    cost_usd: done ? 0.42 : null,
    findings_count: done ? 47 : null,
    grounding: done ? '47/47 grounded' : null,
    ran_at: '2026-08-20T12:00:00.000Z',
    score: done ? 62 : null,
    blockers: done ? 5 : null,
    findings_critical: done ? 5 : null,
    findings_warning: done ? 20 : null,
    findings_suggestion: done ? 22 : null,
  });
}

// Module-load validation (contract-drift guard): every distinct fixture shape
// this module can hand out is parsed against the real shared schema right
// now, not lazily on first use, so a breaking shared-contract change fails
// as soon as this module is imported.
const REPO_FIXTURES = buildRepos();
const PULL_FIXTURES = buildPulls();
const AGENT_FIXTURES = buildAgents();
const CONVENTION_FIXTURES = buildConventions();
const FINDING_FIXTURES = buildFindings();
const REVIEW_FIXTURE = buildReview(FINDING_FIXTURES);
const BLAST_FIXTURE = buildBlastRadius(PR_482_ID);
for (const status of RUN_STATUS_VALUES) {
  buildRunSummary(status);
}

// ---- Fake API ---------------------------------------------------------

export interface FakeApiCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface FakeApiState {
  repos: RepoType[];
  pulls: Record<string, PrMetaType[]>;
  agents: AgentType[];
  conventions: Record<string, ConventionCandidateType[]>;
  review: ReviewDto;
  /** Keyed by PR id (not repo id) — matches `GET /pulls/:id/blast`. */
  blast: Record<string, BlastRadiusViewType>;
}

export interface FakeApiOverrides {
  repos?: RepoType[];
  pulls?: Record<string, PrMetaType[]>;
  agents?: AgentType[];
  conventions?: Record<string, ConventionCandidateType[]>;
  review?: ReviewDto;
  blast?: Record<string, BlastRadiusViewType>;
  /** Script for consecutive `GET /pulls/:id/runs` calls; the last entry
   * repeats once the script is exhausted. Defaults to `['running', 'running', 'done']`. */
  runStatuses?: (string | null)[];
}

export interface FakeApi {
  /** Pass as the injected `fetch` to `createApiClient({ config, fetch })`. */
  fetch: typeof globalThis.fetch;
  /** Every request the stub handled, in order — for call-count assertions (e.g. caching). */
  calls: FakeApiCall[];
  /** Re-scripts the `GET /pulls/:id/runs` status sequence and resets its cursor. */
  setRunStatus(statuses: (string | null)[]): void;
  /** Shallow-merges into the fixture state (e.g. to add/remove a repo mid-test). */
  setState(partial: Partial<FakeApiState>): void;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function notFound(method: string, path: string): Response {
  return jsonResponse(
    { error: { code: 'not_found', message: `No fake route for ${method} ${path}` } },
    404,
  );
}

/** Builds a stubbed `fetch` + canned fixtures for all eight consumed routes. */
export function createFakeApi(overrides: FakeApiOverrides = {}): FakeApi {
  const state: FakeApiState = {
    repos: overrides.repos ?? REPO_FIXTURES,
    pulls: overrides.pulls ?? { [REPO_API_ID]: PULL_FIXTURES, [REPO_WEB_ID]: [] },
    agents: overrides.agents ?? AGENT_FIXTURES,
    conventions: overrides.conventions ?? { [REPO_API_ID]: CONVENTION_FIXTURES, [REPO_WEB_ID]: [] },
    review: overrides.review ?? REVIEW_FIXTURE,
    blast: overrides.blast ?? { [PR_482_ID]: BLAST_FIXTURE },
  };

  let runStatuses = overrides.runStatuses ?? ['running', 'running', 'done'];
  let runCallCount = 0;
  const calls: FakeApiCall[] = [];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (method === 'GET' && url.pathname === '/agents') {
      return jsonResponse(state.agents);
    }
    if (method === 'GET' && url.pathname === '/repos') {
      return jsonResponse(state.repos);
    }

    const pullsMatch = /^\/repos\/([^/]+)\/pulls$/.exec(url.pathname);
    if (method === 'GET' && pullsMatch?.[1]) {
      return jsonResponse(state.pulls[pullsMatch[1]] ?? []);
    }

    const conventionsMatch = /^\/repos\/([^/]+)\/conventions$/.exec(url.pathname);
    if (method === 'GET' && conventionsMatch?.[1]) {
      return jsonResponse(state.conventions[conventionsMatch[1]] ?? []);
    }

    const reviewStartMatch = /^\/pulls\/([^/]+)\/review$/.exec(url.pathname);
    if (method === 'POST' && reviewStartMatch?.[1]) {
      const prId = reviewStartMatch[1];
      return jsonResponse({
        pr_id: prId,
        runs: [{ run_id: RUN_ID, agent_id: AGENT_GENERAL_ID, agent_name: 'General' }],
        reviews: [],
      });
    }

    const runsMatch = /^\/pulls\/([^/]+)\/runs$/.exec(url.pathname);
    if (method === 'GET' && runsMatch?.[1]) {
      const index = Math.min(runCallCount, runStatuses.length - 1);
      const status = runStatuses[index] ?? null;
      runCallCount += 1;
      return jsonResponse([buildRunSummary(status)]);
    }

    const reviewsMatch = /^\/pulls\/([^/]+)\/reviews$/.exec(url.pathname);
    if (method === 'GET' && reviewsMatch?.[1]) {
      return jsonResponse([state.review]);
    }

    const blastMatch = /^\/pulls\/([^/]+)\/blast$/.exec(url.pathname);
    if (method === 'GET' && blastMatch?.[1]) {
      const blast = state.blast[blastMatch[1]];
      if (!blast) {
        return notFound(method, url.pathname);
      }
      return jsonResponse(blast);
    }

    return notFound(method, url.pathname);
  };

  return {
    fetch: fetchImpl,
    calls,
    setRunStatus(statuses) {
      runStatuses = statuses;
      runCallCount = 0;
    },
    setState(partial) {
      Object.assign(state, partial);
    },
  };
}
