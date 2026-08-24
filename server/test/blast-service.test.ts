/**
 * blast module — hermetic unit tests (no Docker).
 *
 * Follows the technique in `repo-intel-facade-degraded.test.ts`: build a
 * fake `Container`-shaped object and patch `BlastService`'s private
 * `repo`/`blastRepo` fields directly instead of mocking Drizzle.
 */
import { describe, it, expect } from 'vitest';
import { BlastService, mapIndexState } from '../src/modules/blast/service.js';
import { attributeFacts, groupAndCapCallers, reverseBfs } from '../src/modules/blast/helpers.js';
import type { CallerRow, FileEdgeRow, FileFactsRow, SymbolInFileRow } from '../src/modules/blast/repository.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';
import type { PullRow } from '../src/db/rows.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function fakeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'r1',
    lastIndexedSha: 'sha1',
    indexerVersion: 1,
    status: 'full',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    ...overrides,
  };
}

function buildContainer(opts: {
  repoIntelEnabled?: boolean;
  indexState: IndexState;
  blastResult?: Partial<BlastResult>;
}): Container {
  return {
    config: { repoIntelEnabled: opts.repoIntelEnabled ?? true },
    db: {} as never,
    repoIntel: {
      getIndexState: async () => opts.indexState,
      getBlastRadius: async () =>
        ({
          changedSymbols: [],
          callers: [],
          impactedEndpoints: [],
          ...opts.blastResult,
        }) as BlastResult,
    },
  } as unknown as Container;
}

function patchRepos(
  svc: BlastService,
  opts: {
    pull?: Partial<PullRow> | undefined;
    repoRow?: { id: string; fullName: string } | undefined;
    prFiles?: { path: string }[];
    callerRows?: CallerRow[];
    symbolRows?: SymbolInFileRow[];
    importersOf?: (files: string[]) => Promise<FileEdgeRow[]>;
    factsFor?: (files: string[]) => Promise<FileFactsRow[]>;
    priorPrs?: {
      number: number;
      title: string;
      author: string;
      status: string;
      updatedAt: Date | null;
      overlapFiles: string[];
    }[];
  },
) {
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getPull: async () => opts.pull,
    getRepo: async () => opts.repoRow,
    getPrFiles: async () => opts.prFiles ?? [],
  };
  (svc as unknown as { blastRepo: Record<string, unknown> }).blastRepo = {
    callersForSymbols: async () => opts.callerRows ?? [],
    symbolsInFiles: async () => opts.symbolRows ?? [],
    importersOf: opts.importersOf ?? (async () => []),
    factsFor: opts.factsFor ?? (async () => []),
    priorPrsTouching: async () => opts.priorPrs ?? [],
  };
}

const PULL: PullRow = {
  id: 'pr1',
  workspaceId: 'ws1',
  repoId: 'repo1',
  number: 1,
  title: 't',
  author: 'a',
  branch: 'b',
  base: 'main',
  headSha: 'headsha',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 2,
  status: 'open',
  body: null,
  openedAt: null,
  updatedAt: null,
};

const REPO_ROW = { id: 'repo1', fullName: 'acme/repo' };

// ---------------------------------------------------------------------------
// Regression: per-symbol caller cap (repo-intel's global-slice bug)
// ---------------------------------------------------------------------------

describe('BlastService.forPull — per-symbol caller capping', () => {
  it('caps each changed symbol independently: 25 raw callers -> 20 shown/truncated, 3 raw -> 3 shown/not truncated', async () => {
    const container = buildContainer({
      indexState: fakeIndexState({ status: 'full' }),
      blastResult: {
        changedSymbols: [
          { file: 'a.ts', name: 'foo', kind: 'function' },
          { file: 'b.ts', name: 'bar', kind: 'function' },
        ],
      },
    });
    const svc = new BlastService(container);

    const fooCallers: CallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `caller-foo-${i}.ts`,
      toSymbol: 'foo',
      declFile: 'a.ts',
      line: 1,
      rank: i,
    }));
    const barCallers: CallerRow[] = Array.from({ length: 3 }, (_, i) => ({
      fromPath: `caller-bar-${i}.ts`,
      toSymbol: 'bar',
      declFile: 'b.ts',
      line: 1,
      rank: i,
    }));

    patchRepos(svc, {
      pull: PULL,
      repoRow: REPO_ROW,
      prFiles: [{ path: 'a.ts' }, { path: 'b.ts' }],
      callerRows: [...fooCallers, ...barCallers],
    });

    const result = await svc.forPull('ws1', 'pr1');
    const foo = result.symbols.find((s) => s.name === 'foo')!;
    const bar = result.symbols.find((s) => s.name === 'bar')!;

    expect(foo.callers).toHaveLength(20);
    expect(foo.caller_total).toBe(25);
    expect(foo.callers_truncated).toBe(true);

    expect(bar.callers).toHaveLength(3);
    expect(bar.caller_total).toBe(3);
    expect(bar.callers_truncated).toBe(false);

    // Regression: the top-level `counts.callers` aggregate must reflect the
    // TRUE total (25 + 3 = 28), not the sum of the capped display arrays
    // (20 + 3 = 23) — the bug the user's screenshot caught: the aggregate
    // badge disagreed with the per-symbol "X callers" badge shown right below.
    expect(result.counts.callers).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// helpers.ts — groupAndCapCallers
// ---------------------------------------------------------------------------

describe('groupAndCapCallers', () => {
  it('orders callers within a symbol by rank DESC', () => {
    const rows: CallerRow[] = [
      { fromPath: 'low.ts', toSymbol: 'x', declFile: 'a.ts', line: 1, rank: 1 },
      { fromPath: 'high.ts', toSymbol: 'x', declFile: 'a.ts', line: 1, rank: 9 },
      { fromPath: 'mid.ts', toSymbol: 'x', declFile: 'a.ts', line: 1, rank: 5 },
    ];
    const grouped = groupAndCapCallers(rows, new Map(), 20);
    const group = grouped.get('a.ts::x')!;
    expect(group.callers.map((c) => c.file)).toEqual(['high.ts', 'mid.ts', 'low.ts']);
  });

  it(
    'same-file callers (from_path === decl_file) are excluded at the repository SQL layer ' +
      '(BlastRepository.callersForSymbols filters `fromPath <> declFile`), not in this pure ' +
      'grouping helper — that exclusion is exercised by the Docker-gated blast.it.test.ts, ' +
      'not here (there is no pure extraction of that filter to unit-test in isolation)',
    () => {
      // No-op documentation test — see comment above and blast.it.test.ts.
      expect(true).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// helpers.ts — reverseBfs / attributeFacts
// ---------------------------------------------------------------------------

describe('reverseBfs', () => {
  const edges: FileEdgeRow[] = [
    { fromFile: 'importer1.ts', toFile: 'seed.ts' }, // depth 1
    { fromFile: 'importer2.ts', toFile: 'importer1.ts' }, // depth 2
    { fromFile: 'importer3.ts', toFile: 'importer2.ts' }, // depth 3 — beyond maxDepth=2
    { fromFile: 'seed.ts', toFile: 'importer1.ts' }, // cycle edge — must not loop forever
  ];
  const importersOf = async (files: string[]): Promise<FileEdgeRow[]> =>
    edges.filter((e) => files.includes(e.toFile));

  it('reaches depth 1 and 2, stops at maxDepth, and terminates on a cycle', async () => {
    const depthMap = await reverseBfs(['seed.ts'], 2, importersOf);
    expect(depthMap.get('seed.ts')).toBe(0);
    expect(depthMap.get('importer1.ts')).toBe(1);
    expect(depthMap.get('importer2.ts')).toBe(2);
    expect(depthMap.has('importer3.ts')).toBe(false);
  });
});

describe('attributeFacts', () => {
  const edges: FileEdgeRow[] = [
    { fromFile: 'importer1.ts', toFile: 'seed.ts' }, // depth 1
    { fromFile: 'importer2.ts', toFile: 'importer1.ts' }, // depth 2
    { fromFile: 'importer3.ts', toFile: 'importer2.ts' }, // depth 3 — should contribute nothing
  ];
  const importersOf = async (files: string[]): Promise<FileEdgeRow[]> =>
    edges.filter((e) => files.includes(e.toFile));
  const factsFor = async (files: string[]): Promise<FileFactsRow[]> => {
    const facts: FileFactsRow[] = [];
    if (files.includes('importer1.ts')) {
      facts.push({ filePath: 'importer1.ts', endpoints: ['GET /a'], crons: [] });
    }
    if (files.includes('importer2.ts')) {
      facts.push({ filePath: 'importer2.ts', endpoints: ['GET /b'], crons: ['cron-x'] });
    }
    if (files.includes('importer3.ts')) {
      facts.push({ filePath: 'importer3.ts', endpoints: ['GET /c'], crons: [] });
    }
    return facts;
  };

  it('a file 3 hops away contributes nothing; 1 and 2 hops do', async () => {
    const { endpoints, crons } = await attributeFacts('seed.ts', 2, 20, importersOf, factsFor);
    expect(endpoints.find((e) => e.label === 'GET /a')?.depth).toBe(1);
    expect(endpoints.find((e) => e.label === 'GET /b')?.depth).toBe(2);
    expect(endpoints.some((e) => e.label === 'GET /c')).toBe(false);
    expect(crons.map((c) => c.label)).toEqual(['cron-x']);
  });

  it(
    'reports the TRUE pre-cap totals/labels even when the display arrays are capped — ' +
      'regression for the bug where the top-level counts silently summed only the capped arrays',
    async () => {
      const manyEndpoints = Array.from({ length: 18 }, (_, i) => `GET /e${i}`);
      const manyImportersOf = async (files: string[]) =>
        files.includes('seed.ts') ? [{ fromFile: 'importer1.ts', toFile: 'seed.ts' }] : [];
      const manyFactsFor = async () => [
        { filePath: 'importer1.ts', endpoints: manyEndpoints, crons: ['cron-a', 'cron-b'] },
      ];
      const result = await attributeFacts('seed.ts', 2, 5, manyImportersOf, manyFactsFor);

      expect(result.endpointTotal).toBe(18);
      expect(result.cronTotal).toBe(2);
      expect(result.truncated).toBe(true); // 20 total facts > cap of 5
      expect(result.endpoints.length + result.crons.length).toBe(5); // display arrays honor the cap
      expect(result.allEndpointLabels).toHaveLength(18); // but the full label set is still reported
      expect(result.allCronLabels).toEqual(['cron-a', 'cron-b']);
    },
  );
});

// ---------------------------------------------------------------------------
// mapIndexState — precedence table
// ---------------------------------------------------------------------------

describe('mapIndexState', () => {
  it('full -> { state: full, reason: ok, indexedSha: <sha> }', () => {
    expect(mapIndexState(true, fakeIndexState({ status: 'full' }))).toEqual({
      state: 'full',
      reason: 'ok',
      indexedSha: 'sha1',
    });
  });

  it('partial -> { state: partial, reason: index_partial, indexedSha: <sha> }', () => {
    expect(mapIndexState(true, fakeIndexState({ status: 'partial' }))).toEqual({
      state: 'partial',
      reason: 'index_partial',
      indexedSha: 'sha1',
    });
  });

  it('failed -> { state: degraded, reason: index_failed, indexedSha: null }', () => {
    expect(mapIndexState(true, fakeIndexState({ status: 'failed' }))).toEqual({
      state: 'degraded',
      reason: 'index_failed',
      indexedSha: null,
    });
  });

  it('no row (synthesized degraded fallback) -> { state: degraded, reason: not_indexed, indexedSha: null }', () => {
    const synthesized: IndexState = {
      repoId: 'r1',
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      reason: 'no_data',
      lastIndexedSha: '',
      indexerVersion: 1,
      updatedAt: new Date(0),
      degraded: true,
      degradedReason: 'no_data',
    };
    expect(mapIndexState(true, synthesized)).toEqual({
      state: 'degraded',
      reason: 'not_indexed',
      indexedSha: null,
    });
  });

  it('flag off -> { state: degraded, reason: flag_off, indexedSha: null } regardless of index status', () => {
    expect(mapIndexState(false, fakeIndexState({ status: 'full' }))).toEqual({
      state: 'degraded',
      reason: 'flag_off',
      indexedSha: null,
    });
  });
});

describe('BlastService.forPull — counts.endpoints unions across symbols instead of summing', () => {
  it('two changed symbols in the same file share the same downstream endpoint set once, not twice', async () => {
    const container = buildContainer({
      indexState: fakeIndexState({ status: 'full' }),
      blastResult: {
        changedSymbols: [
          { file: 'shared.ts', name: 'fnA', kind: 'function' },
          { file: 'shared.ts', name: 'TypeB', kind: 'interface' },
        ],
      },
    });
    const svc = new BlastService(container);
    patchRepos(svc, {
      pull: PULL,
      repoRow: REPO_ROW,
      prFiles: [{ path: 'shared.ts' }],
      // fnA has callers; TypeB (a type) has none — mirrors getContext/RequestContext.
      callerRows: [{ fromPath: 'caller.ts', toSymbol: 'fnA', declFile: 'shared.ts', line: 1, rank: 1 }],
      importersOf: async (files) =>
        files.includes('shared.ts') ? [{ fromFile: 'route.ts', toFile: 'shared.ts' }] : [],
      factsFor: async () => [{ filePath: 'route.ts', endpoints: ['GET /x', 'GET /y'], crons: [] }],
    });

    const result = await svc.forPull('ws1', 'pr1');

    // Both symbols independently attribute the SAME 2 endpoints (both seed
    // their BFS from shared.ts) — the top-level count must dedupe, not sum.
    expect(result.symbols).toHaveLength(2);
    for (const s of result.symbols) {
      expect(s.endpoints.map((e) => e.label).sort()).toEqual(['GET /x', 'GET /y']);
    }
    expect(result.counts.endpoints).toBe(2); // not 4
    expect(result.counts.callers).toBe(1); // fnA's 1 caller + TypeB's 0
  });
});

describe('BlastService.forPull — no_symbols overrides reason only', () => {
  it('preserves state/indexed_sha from an otherwise-full index when the PR touches no indexed symbols', async () => {
    const container = buildContainer({
      indexState: fakeIndexState({ status: 'full', lastIndexedSha: 'shafull' }),
      blastResult: { changedSymbols: [] },
    });
    const svc = new BlastService(container);
    patchRepos(svc, {
      pull: PULL,
      repoRow: REPO_ROW,
      prFiles: [{ path: 'untracked.ts' }],
    });

    const result = await svc.forPull('ws1', 'pr1');
    expect(result.reason).toBe('no_symbols');
    expect(result.state).toBe('full');
    expect(result.indexed_sha).toBe('shafull');
    expect(result.symbols).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Only-throw path
// ---------------------------------------------------------------------------

describe('BlastService.forPull — error handling', () => {
  it('throws NotFoundError for an unknown prId (the ONLY throw in forPull)', async () => {
    const container = buildContainer({ indexState: fakeIndexState() });
    const svc = new BlastService(container);
    patchRepos(svc, { pull: undefined });

    await expect(svc.forPull('ws1', 'missing-pr')).rejects.toBeInstanceOf(NotFoundError);
  });
});
