import { describe, expect, it } from 'vitest';
import { createApiClient } from '../api-client.js';
import { createResolver } from '../resolve.js';
import { loadConfig } from '../config.js';
import { unknownPr, unknownRepo } from '../errors.js';
import { createFakeApi, PR_482_ID } from '../../test/fake-api.js';
import type { BlastRadiusView as BlastRadiusViewType } from '@devdigest/shared';

/** Fixture PR numbers registered for `acme/api` in `test/fake-api.ts` (480 has `id: null`, still counted). */
const FIXTURE_PR_NUMBERS = [480, 481, 482];
import { getBlastRadiusTool } from './get-blast-radius.js';
import type { ToolDeps } from './types.js';

function buildDeps(fetchImpl: typeof globalThis.fetch): ToolDeps {
  const config = loadConfig({});
  const api = createApiClient({ config, fetch: fetchImpl });
  const resolver = createResolver(api);
  return { api, resolver, runIndex: undefined, config };
}

/** Builds an N-symbol `BlastRadiusView` fixture, each symbol with `impact` distinct callers,
 *  so tests can construct a specific rank ordering for the symbol-truncation check. */
function manySymbols(count: number): BlastRadiusViewType['symbols'] {
  return Array.from({ length: count }, (_, i) => ({
    name: `fn${i}`,
    file: `src/mod-${i}.ts`,
    kind: 'function',
    callers: [{ file: `src/caller-${i}.ts`, symbol: 'caller', line: 1, rank: 1 }],
    caller_total: count - i, // fn0 has the most callers, fnN-1 the fewest — a deterministic rank order
    callers_truncated: false,
    endpoints: [],
    crons: [],
    endpoint_total: 0,
    cron_total: 0,
    facts_truncated: false,
  }));
}

describe('devdigest_get_blast_radius', () => {
  it('description no longer marks the tool as not implemented', () => {
    expect(getBlastRadiusTool.description).not.toContain('NOT IMPLEMENTED');
    expect(getBlastRadiusTool.description).not.toContain('not_implemented');
  });

  it('declares the read-only, closed-world annotations (R15)', () => {
    expect(getBlastRadiusTool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it('returns the REAL impact map for a known repo/PR — the same data GET /pulls/:id/blast serves', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 482 }, deps);

    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.repo).toBe('acme/api');
    expect(payload.pr).toBe(482);
    expect(payload.state).toBe('full');
    expect(payload.reason).toBe('ok');
    expect(payload.indexed_sha).toBe('sha-indexed-001');
    expect(payload.head_sha).toBe('sha000482');
    expect(payload.counts).toEqual({ symbols: 2, callers: 8, endpoints: 2, crons: 0 });

    const symbols = payload.symbols as Array<Record<string, unknown>>;
    expect(symbols).toHaveLength(2);
    const getContext = symbols.find((s) => s.name === 'getContext')!;
    // TRUE total (8) is preserved even though the display cap shows fewer callers —
    // the exact bug fixed in the Studio UI's Blast Radius card this tool mirrors.
    expect(getContext.caller_total).toBe(8);
    expect(getContext.callers_truncated).toBe(true);
    expect((getContext.callers as unknown[]).length).toBe(5); // MAX_CALLERS_SHOWN_PER_SYMBOL
    expect(getContext.endpoints).toEqual(['GET /agents', 'POST /repos']);

    expect(payload.prior_prs).toEqual([
      {
        number: 401,
        title: expect.stringContaining('Tune rate limit window'),
        author: 'marisa.koch',
        files_overlap_count: 1,
      },
    ]);
    // Third-party PR title is untrusted-wrapped (R11); file paths/symbol names are not.
    const priorPr = (payload.prior_prs as Array<Record<string, unknown>>)[0]!;
    expect(priorPr.title as string).toMatch(/^<untrusted source="/);
  });

  it('is also returned as serialized TextContent, matching structuredContent', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 482 }, deps);

    const textBlock = result.content[0];
    expect(textBlock?.type).toBe('text');
    const parsed = JSON.parse((textBlock as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toEqual(result.structuredContent);
  });

  it('caps shown symbols at 10, ranked by total downstream impact, with a next_step naming the true total', async () => {
    const fakeApi = createFakeApi({
      blast: {
        [PR_482_ID]: {
          pr_id: PR_482_ID,
          repo_full_name: 'acme/api',
          indexed_sha: 'sha-indexed-002',
          head_sha: 'sha000482',
          state: 'full',
          reason: 'ok',
          explanation: '',
          symbols: manySymbols(14),
          counts: { symbols: 14, callers: 105, endpoints: 0, crons: 0 },
          prior_prs: [],
        },
      },
    });
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 482 }, deps);

    const payload = result.structuredContent as Record<string, unknown>;
    const symbols = payload.symbols as Array<{ name: string }>;
    expect(symbols).toHaveLength(10);
    expect(symbols[0]!.name).toBe('fn0'); // highest caller_total sorts first
    expect(symbols.map((s) => s.name)).not.toContain('fn13'); // lowest-impact symbol, dropped
    expect(payload.counts).toEqual({ symbols: 14, callers: 105, endpoints: 0, crons: 0 }); // true total, unaffected by the display cap
    expect(payload.next_step as string).toContain('Showing 10 of 14 changed symbols');
  });

  it('degraded state (not indexed) still returns a valid, non-error envelope', async () => {
    const fakeApi = createFakeApi({
      blast: {
        [PR_482_ID]: {
          pr_id: PR_482_ID,
          repo_full_name: 'acme/api',
          indexed_sha: null,
          head_sha: 'sha000482',
          state: 'degraded',
          reason: 'not_indexed',
          explanation: 'This repository has not been indexed yet — blast radius is unavailable.',
          symbols: [],
          counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
          prior_prs: [],
        },
      },
    });
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 482 }, deps);

    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.state).toBe('degraded');
    expect(payload.reason).toBe('not_indexed');
    expect(payload.symbols).toEqual([]);
    expect(payload.indexed_sha).toBeNull();
  });

  it('still resolves identifiers: unknown repo produces the exact actionable error', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'nope/nope', pr: 1 }, deps);

    expect(result.isError).toBe(true);
    const known = ['acme/api', 'acme/web'];
    expect((result.content[0] as { text: string }).text).toBe(unknownRepo('nope/nope', known));
  });

  it('still resolves identifiers: unknown PR produces the exact actionable error', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 999 }, deps);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe(
      unknownPr('acme/api', 999, FIXTURE_PR_NUMBERS),
    );
  });

  it('a resolved PR with no blast fixture (API-side 404) surfaces as isError, not a crash', async () => {
    const fakeApi = createFakeApi({ blast: {} });
    const deps = buildDeps(fakeApi.fetch);

    const result = await getBlastRadiusTool.handler({ repo: 'acme/api', pr: 482 }, deps);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('No fake route');
  });
});
