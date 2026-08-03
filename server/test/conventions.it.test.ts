import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const USERS_TS = [
  "import { db } from '../lib/db';",
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  return user;',
  '}',
].join('\n');

const FILES: Record<string, string> = {
  'src/api/users.ts': USERS_TS,
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
};

/**
 * Two grounded candidates and two that must be dropped: one citing a file that
 * was never sampled, one quoting code that does not exist.
 */
const EXTRACTION = {
  conventions: [
    {
      category: 'async',
      rule: 'Always use async/await instead of .then() chains',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 1, // wrong on purpose — must be corrected to 4
      evidence_end_line: 1,
      evidence_snippet: '  const user = await db.users.find(id);',
      occurrences_seen: 6,
      counterexamples_seen: 1,
      enforced_by_config: false,
      confidence: 0.91,
    },
    {
      category: 'config',
      rule: 'TypeScript runs in strict mode',
      evidence_path: 'tsconfig.json',
      evidence_start_line: 1,
      evidence_end_line: 1,
      evidence_snippet: '"strict": true',
      occurrences_seen: 1,
      counterexamples_seen: 0,
      enforced_by_config: true,
      confidence: 0.8,
    },
    {
      category: 'ghost',
      rule: 'This cites a file that was never sampled',
      evidence_path: 'src/does/not/exist.ts',
      evidence_start_line: 1,
      evidence_end_line: 1,
      evidence_snippet: 'whatever',
      occurrences_seen: 3,
      counterexamples_seen: 0,
      enforced_by_config: false,
      confidence: 0.9,
    },
    {
      category: 'ghost',
      rule: 'This quotes code that is not in the file',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 2,
      evidence_end_line: 2,
      evidence_snippet: 'const totallyInvented = 42;',
      occurrences_seen: 3,
      counterexamples_seen: 0,
      enforced_by_config: false,
      confidence: 0.9,
    },
  ],
};

/**
 * Minimal RepoIntel: this flow exercises only sample selection and the size of
 * the pool that selection came from. `ranked` is deliberately much larger than
 * the sample set — the two numbers must never be conflated.
 */
function mockRepoIntel(paths: string[], ranked = 312): RepoIntel {
  return {
    getConventionSamples: async () => paths,
    countRankedFiles: async () => ranked,
  } as unknown as RepoIntel;
}

d('conventions extractor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api-conv',
        fullName: 'acme/payments-api-conv',
      })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, samplePaths = ['src/api/users.ts'], ranked = 312) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        repoIntel: mockRepoIntel(samplePaths, ranked),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: structured },
          }),
        },
      },
    });
  }

  it('extracts, grounds evidence, and persists only the survivors', async () => {
    const app = await appWith(EXTRACTION);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 2 of 4 grounded: the ghost file and the invented snippet are gone.
    expect(body.candidates).toHaveLength(2);
    expect(body.dropped).toBe(2);
    expect(body.dropped_reasons).toEqual({ file_not_found: 1, snippet_not_found: 1 });

    // tsconfig.json is picked up as a config sample without repo-intel's help.
    expect(body.sampled_files).toBe(2);
    // …and the subtitle number is the POOL those 2 were chosen from, not 2.
    expect(body.considered_files).toBe(312);
    // The revision the evidence lines refer to, so deep links can pin to it.
    expect(body.scanned_sha).toBe('a1b2c3d4');

    // The claimed line (1) is replaced by the real one (4).
    const asyncRule = body.candidates.find((c: { category: string }) => c.category === 'async');
    expect(asyncRule.evidence_start_line).toBe(4);
    expect(asyncRule.accepted).toBe(false);

    // The score is reconciled with the counts the model itself reported:
    // it claimed 0.91 while admitting 1 of 7 files differ → clamped to 6/7.
    expect(asyncRule.following_files).toBe(6);
    expect(asyncRule.applicable_files).toBe(7);
    expect(asyncRule.confidence).toBeCloseTo(6 / 7, 5);

    // A config-enforced rule keeps its score — a lint rule holds beyond the sample.
    const configRule = body.candidates.find((c: { category: string }) => c.category === 'config');
    expect(configRule.confidence).toBeCloseTo(0.8, 5);
  });

  it('lists persisted candidates with scan metadata', async () => {
    const app = await appWith(EXTRACTION);
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(2);
    expect(body.sampled_files).toBe(2);
    expect(body.considered_files).toBe(312);
    expect(body.scanned_at).toBeTruthy();
    expect(body.scanned_sha).toBe('a1b2c3d4');
  });

  it('falls back to the sampled count when the ranked pool is unavailable', async () => {
    // countRankedFiles degrades to 0 on an unindexed repo / flag off. The
    // subtitle must not then read "0 sample files" next to real candidates.
    const app = await appWith(EXTRACTION, ['src/api/users.ts'], 0);
    const body = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    expect(body.sampled_files).toBe(2);
    expect(body.considered_files).toBe(2);
  });

  it('accepts, rejects, and builds a skill draft from the accepted set', async () => {
    const app = await appWith(EXTRACTION);
    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const [first, second] = listed.candidates;

    // No accepted candidates yet → the draft is refused, not empty.
    const early = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/skill-draft`,
    });
    expect(early.statusCode).toBe(422);

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${first.id}`,
      payload: { accepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().accepted).toBe(true);

    const rejected = await app.inject({ method: 'DELETE', url: `/conventions/${second.id}` });
    expect(rejected.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(after.candidates).toHaveLength(1);

    const draft = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/skill-draft`,
    });
    expect(draft.statusCode).toBe(200);
    const d = draft.json();
    expect(d.name).toBe('payments-api-conv-conventions');
    expect(d.type).toBe('convention');
    expect(d.accepted_count).toBe(1);
    expect(d.body).toContain('# payments-api-conv-conventions');
    expect(d.body).toContain('Detected in `');
  });

  it('the draft saves through the existing POST /skills', async () => {
    const app = await appWith(EXTRACTION);
    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();

    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        source: 'extracted',
        body: draft.body,
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.type).toBe('convention');
    expect(skill.source).toBe('extracted');
    expect(skill.version).toBe(1);
  });

  it('a re-scan replaces the previous set wholesale', async () => {
    const app = await appWith({
      conventions: [
        {
          category: 'imports',
          rule: 'Database access goes through src/lib/db',
          evidence_path: 'src/api/users.ts',
          evidence_start_line: 1,
          evidence_end_line: 1,
          evidence_snippet: "import { db } from '../lib/db';",
          occurrences_seen: 3,
          counterexamples_seen: 0,
          enforced_by_config: false,
          confidence: 0.85,
        },
      ],
    });

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(after.candidates).toHaveLength(1);
    expect(after.candidates[0].rule).toBe('Database access goes through src/lib/db');
    // The previously accepted candidate is gone — a re-scan supersedes curation.
    expect(after.candidates[0].accepted).toBe(false);
  });

  it('refuses to call the model when nothing is readable', async () => {
    const app = buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: {} }),
        repoIntel: mockRepoIntel([]),
        llm: { openrouter: new MockLLMProvider('openai', { structured: EXTRACTION }) },
      },
    });
    const res = await (await app).inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('Nothing to scan');
  });
});
