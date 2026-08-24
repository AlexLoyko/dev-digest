import { describe, expect, it } from 'vitest';
import { createApiClient } from '../api-client.js';
import type { McpConfig } from '../config.js';
import { createResolver } from '../resolve.js';
import type { ToolDeps } from './types.js';
import { createFakeApi } from '../../test/fake-api.js';
import { getConventionsTool } from './get-conventions.js';

function testConfig(): McpConfig {
  return {
    apiUrl: 'http://127.0.0.1:3001',
    runTimeoutMs: 5_000,
    pollIntervalMs: 5,
    maxFindings: 20,
    debug: undefined,
    apiToken: undefined,
  };
}

function buildDeps(fakeApi: ReturnType<typeof createFakeApi>): ToolDeps {
  const config = testConfig();
  const api = createApiClient({ config, fetch: fakeApi.fetch });
  const resolver = createResolver(api);
  return { api, resolver, runIndex: undefined, config };
}

/** Parses a tool's `content[0].text` (the serialized JSON envelope) back into an object. */
function parseText(result: Awaited<ReturnType<typeof getConventionsTool.handler>>): Record<string, unknown> {
  const block = result.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('expected a text content block');
  }
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('devdigest_get_conventions', () => {
  it('declares R15 read-only, closed-world annotations', () => {
    expect(getConventionsTool.annotations.readOnlyHint).toBe(true);
    expect(getConventionsTool.annotations.openWorldHint).toBe(false);
  });

  it('concise (default): returns accepted rules only, with rule wrapped as untrusted', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi);

    const result = await getConventionsTool.handler(
      { repo: 'acme/api', response_format: 'concise' },
      deps,
    );

    expect(result.isError).toBeFalsy();
    const payload = parseText(result);
    expect(payload.repo).toBe('acme/api');
    expect(payload.accepted_count).toBe(2);
    expect(payload.pending_count).toBe(1);

    const conventions = payload.conventions as Array<Record<string, unknown>>;
    expect(conventions).toHaveLength(2);
    for (const convention of conventions) {
      expect(convention.accepted).toBe(true);
      expect(convention.rule as string).toMatch(/^<untrusted source="/);
      // concise mode never leaks pending-only fields
      expect(convention.confidence).toBeUndefined();
      expect(convention.evidence_snippet).toBeUndefined();
    }

    expect(result.structuredContent).toEqual(payload);
  });

  it('detailed: adds pending candidates with confidence + untrusted-wrapped evidence_snippet', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi);

    const result = await getConventionsTool.handler(
      { repo: 'acme/api', response_format: 'detailed' },
      deps,
    );

    expect(result.isError).toBeFalsy();
    const payload = parseText(result);
    expect(payload.accepted_count).toBe(2);
    expect(payload.pending_count).toBe(1);

    const conventions = payload.conventions as Array<Record<string, unknown>>;
    expect(conventions).toHaveLength(3);

    const pending = conventions.find((c) => c.accepted === false);
    expect(pending).toBeDefined();
    expect(typeof pending!.confidence).toBe('number');
    expect(pending!.evidence_snippet as string).toMatch(/^<untrusted source="/);

    // Every rule across the full (accepted + pending) set is untrusted-wrapped.
    for (const convention of conventions) {
      expect(convention.rule as string).toMatch(/^<untrusted source="/);
    }
  });

  it('empty: non-error envelope with a next_step pointing at Conventions → Scan', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi);

    const result = await getConventionsTool.handler(
      { repo: 'acme/web', response_format: 'concise' },
      deps,
    );

    expect(result.isError).toBeFalsy();
    const payload = parseText(result);
    expect(payload).toEqual({
      repo: 'acme/web',
      conventions: [],
      next_step:
        'No conventions have been extracted for acme/web yet. Ask the user to open ' +
        'http://localhost:3000 → the repo → Conventions → Scan, then call devdigest_get_conventions again.',
    });
  });

  it('unknown repo -> isError with the known-repositories message', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi);

    const result = await getConventionsTool.handler(
      { repo: 'nope/nope', response_format: 'concise' },
      deps,
    );

    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('expected a text content block');
    }
    expect(block.text).toContain('is not in DevDigest');
    expect(block.text).toContain('acme/api');
    expect(block.text).toContain('acme/web');
  });
});
