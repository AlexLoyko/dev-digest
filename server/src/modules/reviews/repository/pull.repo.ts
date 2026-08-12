import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PrIntent, IntentSource, PrIntentRecord } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/** Provenance stamped alongside the classification: the cache key plus which model
    produced it. */
export interface IntentMeta {
  headSha: string | null;
  provider: string | null;
  model: string | null;
}

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: PrIntent,
  meta: IntentMeta,
): Promise<void> {
  // The `sources` literal is annotated because a jsonb column type-checks against
  // anything — without this, a malformed shape would only surface at read time.
  const sources: IntentSource[] = intent.sources;
  const values = {
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    type: intent.type,
    confidence: intent.confidence,
    sources,
    headSha: meta.headSha,
    provider: meta.provider,
    model: meta.model,
    classifiedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...values })
    // One row per PR: a head-SHA move replaces the stale classification.
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

function toIntent(row: typeof t.prIntent.$inferSelect): PrIntent {
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    type: row.type,
    confidence: row.confidence,
    sources: row.sources,
  };
}

/** The full persisted record including provenance — what the cache check and the
    `GET /pulls/:id/intent` route need. */
export async function getIntentRecord(
  db: Db,
  prId: string,
): Promise<PrIntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    ...toIntent(row),
    pr_id: row.prId,
    head_sha: row.headSha,
    provider: row.provider,
    model: row.model,
    classified_at: row.classifiedAt?.toISOString() ?? null,
  };
}
