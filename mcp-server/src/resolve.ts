/**
 * Identifier resolution layer (R8): maps the semantic identifiers tools
 * accept — `"owner/name"` repos, integer PR numbers, and agent id-or-name —
 * onto the API's internal UUIDs.
 *
 * This is an orchestration helper (the onion skill's "application layer"
 * flavour for the MCP transport): it depends only on the `ApiClient`
 * interface (`api-client.ts`), never on `fetch` directly, and never throws a
 * raw `Error` — every miss is a `ToolError` built from the exact,
 * plan-specified builders in `errors.ts` so a tool handler can surface it
 * verbatim as `isError: true` text. Every throw here also sets `ToolError`'s
 * `kind` (its `ToolErrorKind`, e.g. `'unknown_agent'` vs `'agent_disabled'`)
 * explicitly, so callers like `flows/run-review.ts` never have to re-derive
 * it from the message text.
 *
 * Caching: each lookup kind (repos, pulls-per-repo, agents) has its own
 * 60s-TTL, in-process cache. A cache miss by identifier (not by staleness)
 * always retries once against a forced refetch before the error is raised —
 * so a repo/PR/agent that was added seconds ago is still found without
 * waiting out the TTL. The TTL and clock are both injectable so tests can
 * control expiry deterministically instead of sleeping.
 */
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import { ToolError, agentDisabled, unknownAgent, unknownPr, unknownRepo } from './errors.js';

/** Default cache TTL for every lookup kind (R8: "60 s TTL, per-process"). */
const DEFAULT_TTL_MS = 60_000;

/**
 * A `PrMeta` whose `id` is guaranteed non-null. `resolvePr` never returns a
 * `PrMeta` with a nullish `id` (`platform.ts:158`) — a PR that GitHub search
 * surfaced but DevDigest has not persisted yet is treated as "not found",
 * exactly like an unknown PR number, so `id` narrows to `string` here.
 */
export type ResolvedPr = PrMeta & { id: string };

export interface Resolver {
  /** `input` is `"owner/name"`, matched against `full_name` or `${owner}/${name}`, case-insensitively. */
  resolveRepo(input: string): Promise<Repo>;
  /** `repoId` must already be a resolved repo UUID — PR numbers are unique only per repo. */
  resolvePr(repoId: string, number: number): Promise<ResolvedPr>;
  /** `input` is an agent UUID or a name, matched case-insensitively (R14). */
  resolveAgent(input: string): Promise<Agent>;
}

export interface ResolverOptions {
  /** Cache TTL in milliseconds. Defaults to 60s. Override (e.g. to 0) in tests for deterministic expiry. */
  ttlMs?: number;
  /** Injectable clock, defaults to `Date.now`. Override in tests to simulate TTL expiry without real waits. */
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function matchesRepo(repo: Repo, needle: string): boolean {
  return repo.full_name.toLowerCase() === needle || `${repo.owner}/${repo.name}`.toLowerCase() === needle;
}

/** A PR counts as resolved only when its number matches AND it has been persisted (`id` non-null). */
function findResolvedPr(pulls: PrMeta[], number: number): ResolvedPr | undefined {
  const match = pulls.find((pr) => pr.number === number);
  if (!match || match.id == null) {
    return undefined;
  }
  return match as ResolvedPr;
}

/**
 * `id` is matched exactly (UUIDs are not case-folded); `name` is matched
 * case-insensitively (R14: "match `id` first, then `name` case-insensitively").
 */
function matchesAgent(agent: Agent, input: string): boolean {
  return agent.id === input || agent.name.toLowerCase() === normalize(input);
}

/** Builds the identifier resolver over an already-constructed `ApiClient`. */
export function createResolver(api: ApiClient, options: ResolverOptions = {}): Resolver {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  let repoCache: CacheEntry<Repo[]> | null = null;
  const pullsCache = new Map<string, CacheEntry<PrMeta[]>>();
  let agentCache: CacheEntry<Agent[]> | null = null;

  async function getRepos(forceRefresh = false): Promise<Repo[]> {
    if (!forceRefresh && repoCache && repoCache.expiresAt > now()) {
      return repoCache.value;
    }
    const repos = await api.listRepos();
    repoCache = { value: repos, expiresAt: now() + ttlMs };
    return repos;
  }

  async function getPulls(repoId: string, forceRefresh = false): Promise<PrMeta[]> {
    const cached = pullsCache.get(repoId);
    if (!forceRefresh && cached && cached.expiresAt > now()) {
      return cached.value;
    }
    const pulls = await api.listPulls(repoId);
    pullsCache.set(repoId, { value: pulls, expiresAt: now() + ttlMs });
    return pulls;
  }

  async function getAgents(forceRefresh = false): Promise<Agent[]> {
    if (!forceRefresh && agentCache && agentCache.expiresAt > now()) {
      return agentCache.value;
    }
    const agents = await api.listAgents();
    agentCache = { value: agents, expiresAt: now() + ttlMs };
    return agents;
  }

  /** Best-effort human-readable label for a repo UUID, for use in `unknownPr`'s message. Falls back to the raw id. */
  async function repoLabelFor(repoId: string): Promise<string> {
    const repos = await getRepos();
    return repos.find((repo) => repo.id === repoId)?.full_name ?? repoId;
  }

  async function resolveRepo(input: string): Promise<Repo> {
    const needle = normalize(input);
    let repos = await getRepos();
    let match = repos.find((repo) => matchesRepo(repo, needle));
    if (!match) {
      repos = await getRepos(true);
      match = repos.find((repo) => matchesRepo(repo, needle));
    }
    if (!match) {
      throw new ToolError(unknownRepo(input, repos.map((repo) => repo.full_name)), 'unknown_repo');
    }
    return match;
  }

  async function resolvePr(repoId: string, number: number): Promise<ResolvedPr> {
    let pulls = await getPulls(repoId);
    let match = findResolvedPr(pulls, number);
    if (!match) {
      pulls = await getPulls(repoId, true);
      match = findResolvedPr(pulls, number);
    }
    if (!match) {
      const label = await repoLabelFor(repoId);
      throw new ToolError(unknownPr(label, number, pulls.map((pr) => pr.number)), 'unknown_pr');
    }
    return match;
  }

  async function resolveAgent(input: string): Promise<Agent> {
    let agents = await getAgents();
    let match = agents.find((agent) => matchesAgent(agent, input));
    if (!match) {
      agents = await getAgents(true);
      match = agents.find((agent) => matchesAgent(agent, input));
    }
    if (!match) {
      throw new ToolError(unknownAgent(input), 'unknown_agent');
    }
    if (!match.enabled) {
      throw new ToolError(agentDisabled(match.name), 'agent_disabled');
    }
    return match;
  }

  return { resolveRepo, resolvePr, resolveAgent };
}
