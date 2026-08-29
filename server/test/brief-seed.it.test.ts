import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { StoredBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-seed] Docker not available — skipping Testcontainers integration test.');
}

d('seed(): PR #482 pr_intent + pr_brief fixture (AC-1)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('inserts exactly one pr_brief row after two seed() runs, with a valid, non-stale StoredBrief grounded in the PR\'s pr_files', async () => {
    const { db } = pg.handle;

    // Run twice — seed() must be re-runnable (e.g. ./scripts/dev.sh) without
    // duplicating the fixture.
    const { workspaceId } = await seed(db);
    await seed(db);

    const [repo] = await db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    expect(repo).toBeDefined();

    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    expect(pr).toBeDefined();

    // exactly one pr_brief row for PR #482
    const briefRows = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr!.id));
    expect(briefRows).toHaveLength(1);

    // exactly one pr_intent row for PR #482
    const intentRows = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr!.id));
    expect(intentRows).toHaveLength(1);
    expect(intentRows[0]!.intent.length).toBeGreaterThan(0);
    expect(intentRows[0]!.inScope.length).toBeGreaterThan(0);
    expect(intentRows[0]!.outOfScope.length).toBeGreaterThan(0);

    // StoredBrief.parse succeeds
    const stored = StoredBrief.parse(briefRows[0]!.json);
    expect(stored.schema_version).toBe(1);

    // head_sha equals the PR's current head_sha → reads non-stale
    expect(stored.head_sha).toBe(pr!.headSha);

    // populated generation metadata
    expect(stored.model.length).toBeGreaterThan(0);
    expect(stored.tokens_in).toBeGreaterThan(0);
    expect(stored.tokens_out).toBeGreaterThan(0);
    expect(stored.cost_usd).toBeGreaterThan(0);

    // no degraded inputs in the seeded fixture
    expect(stored.degraded).toEqual([]);

    // every file path referenced by the brief is a real seeded pr_files path
    const fileRows = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr!.id));
    const realPaths = new Set(fileRows.map((f) => f.path));
    expect(realPaths.size).toBeGreaterThan(0);

    for (const risk of stored.brief.risks) {
      expect(risk.file_refs.length).toBeGreaterThan(0);
      for (const ref of risk.file_refs) {
        expect(realPaths.has(ref.path)).toBe(true);
      }
    }
    for (const entry of stored.brief.review_focus) {
      expect(realPaths.has(entry.file.path)).toBe(true);
    }
  });
});
