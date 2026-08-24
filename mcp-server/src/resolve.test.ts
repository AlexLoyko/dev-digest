import { describe, expect, it } from 'vitest';
import { createApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { createResolver } from './resolve.js';
import {
  AGENT_GENERAL_ID,
  AGENT_LEGACY_ID,
  PR_480_NUMBER,
  PR_481_ID,
  PR_482_ID,
  REPO_API_ID,
  REPO_WEB_ID,
  createFakeApi,
} from '../test/fake-api.js';

/** Builds a resolver on top of a fresh fake API, with an injectable clock. */
function buildResolver(overrides: Parameters<typeof createFakeApi>[0] = {}, ttlMs?: number, now?: () => number) {
  const fake = createFakeApi(overrides);
  const api = createApiClient({ config: loadConfig({}), fetch: fake.fetch });
  const resolver = createResolver(api, { ttlMs, now });
  return { fake, api, resolver };
}

describe('createResolver — resolveRepo', () => {
  it('resolves a known repo by exact "owner/name"', async () => {
    const { resolver } = buildResolver();
    const repo = await resolver.resolveRepo('acme/api');
    expect(repo.id).toBe(REPO_API_ID);
    expect(repo.full_name).toBe('acme/api');
  });

  it('is case-insensitive on both full_name and owner/name forms', async () => {
    const { resolver } = buildResolver();
    expect((await resolver.resolveRepo('ACME/API')).id).toBe(REPO_API_ID);
    expect((await resolver.resolveRepo('Acme/Web')).id).toBe(REPO_WEB_ID);
  });

  it('throws the unknownRepo message, including the known-repo list, for an unmatched repo', async () => {
    const { resolver } = buildResolver();
    await expect(resolver.resolveRepo('nope/nothing')).rejects.toMatchObject({
      kind: 'unknown_repo',
      text: expect.stringContaining('Repository "nope/nothing" is not in DevDigest. Known repositories: acme/api, acme/web.'),
    });
  });
});

describe('createResolver — resolvePr', () => {
  it('resolves a known PR number to its UUID', async () => {
    const { resolver } = buildResolver();
    const pr = await resolver.resolvePr(REPO_API_ID, 482);
    expect(pr.id).toBe(PR_482_ID);
    expect(pr.number).toBe(482);
  });

  it('resolves a second known PR number in the same repo', async () => {
    const { resolver } = buildResolver();
    const pr = await resolver.resolvePr(REPO_API_ID, 481);
    expect(pr.id).toBe(PR_481_ID);
  });

  it('treats a PR with a nullish id as not found (not importable yet)', async () => {
    const { resolver } = buildResolver();
    await expect(resolver.resolvePr(REPO_API_ID, PR_480_NUMBER)).rejects.toMatchObject({
      kind: 'unknown_pr',
      text: expect.stringContaining(`PR #${PR_480_NUMBER} was not found in acme/api.`),
    });
  });

  it('throws the unknownPr message, including the repo label and known PR numbers, for an unmatched number', async () => {
    const { resolver } = buildResolver();
    await expect(resolver.resolvePr(REPO_API_ID, 999)).rejects.toMatchObject({
      kind: 'unknown_pr',
      text: expect.stringContaining('PR #999 was not found in acme/api. Imported PR numbers include: 480, 481, 482.'),
    });
  });
});

describe('createResolver — resolveAgent', () => {
  it('resolves an agent by exact id', async () => {
    const { resolver } = buildResolver();
    const agent = await resolver.resolveAgent(AGENT_GENERAL_ID);
    expect(agent.name).toBe('General');
  });

  it('resolves an agent by name, case-insensitively', async () => {
    const { resolver } = buildResolver();
    const agent = await resolver.resolveAgent('gEnErAl');
    expect(agent.id).toBe(AGENT_GENERAL_ID);
  });

  it('throws the unknownAgent message for an unmatched id/name', async () => {
    const { resolver } = buildResolver();
    await expect(resolver.resolveAgent('nope')).rejects.toMatchObject({
      kind: 'unknown_agent',
      text: 'Agent "nope" not found. Call devdigest_list_agents to get the valid agent ids, then retry.',
    });
  });

  it('throws agentDisabled for a resolved-but-disabled agent, by id or by name', async () => {
    const { resolver } = buildResolver();
    await expect(resolver.resolveAgent(AGENT_LEGACY_ID)).rejects.toMatchObject({
      kind: 'agent_disabled',
      text: expect.stringContaining('Agent "Legacy" is disabled in DevDigest.'),
    });
    await expect(resolver.resolveAgent('legacy')).rejects.toMatchObject({
      kind: 'agent_disabled',
      text: expect.stringContaining('Agent "Legacy" is disabled in DevDigest.'),
    });
  });
});

describe('createResolver — caching', () => {
  it('a cache hit issues no second HTTP call for repos', async () => {
    const { fake, resolver } = buildResolver();
    await resolver.resolveRepo('acme/api');
    await resolver.resolveRepo('acme/web');
    expect(fake.calls.filter((call) => call.path === '/repos').length).toBe(1);
  });

  it('a cache hit issues no second HTTP call for pulls (keyed by repoId)', async () => {
    const { fake, resolver } = buildResolver();
    await resolver.resolvePr(REPO_API_ID, 482);
    await resolver.resolvePr(REPO_API_ID, 481);
    expect(fake.calls.filter((call) => call.path === `/repos/${REPO_API_ID}/pulls`).length).toBe(1);
  });

  it('a cache hit issues no second HTTP call for agents', async () => {
    const { fake, resolver } = buildResolver();
    await resolver.resolveAgent(AGENT_GENERAL_ID);
    await resolver.resolveAgent(AGENT_GENERAL_ID);
    expect(fake.calls.filter((call) => call.path === '/agents').length).toBe(1);
  });

  it('a stale cache miss triggers exactly one refetch', async () => {
    let clock = 0;
    const { fake, resolver } = buildResolver({}, 10, () => clock);

    await resolver.resolveRepo('acme/api');
    expect(fake.calls.filter((call) => call.path === '/repos').length).toBe(1);

    // Advance the injected clock past the 10ms TTL — no real sleep needed.
    clock += 11;
    await resolver.resolveRepo('acme/api');
    expect(fake.calls.filter((call) => call.path === '/repos').length).toBe(2);

    // A third resolution within the same (now-fresh) TTL window is a cache hit again.
    await resolver.resolveRepo('acme/api');
    expect(fake.calls.filter((call) => call.path === '/repos').length).toBe(2);
  });
});
