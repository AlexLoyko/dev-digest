import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { StoredBrief } from '@devdigest/shared';
import type { AgentRunWithReview } from './latest-run.js';

/**
 * The ONLY file in this module issuing Drizzle. Everything else (service.ts,
 * routes.ts) goes through here — see the onion-architecture skill.
 *
 * NO MIGRATION / NO SCHEMA EDIT: `pr_brief.json` is a free-form `jsonb NOT
 * NULL` column (server/src/db/schema/reviews.ts:57). `.$type<>()` is
 * deliberately NOT added there — `StoredBrief.safeParse()` below is the
 * mapper that gives the column a shape, at read time.
 */

/** `pr_files` metadata only — callers of this repository must never see
 *  `patch` (the large diff blob is out of scope for brief grounding). */
export interface ChangedFileRef {
  path: string;
  additions: number;
  deletions: number;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /**
   * Primary-key select on `pr_brief`, then `StoredBrief.safeParse(row.json)`.
   * A row whose `json` doesn't match the envelope shape (e.g. corrupted by a
   * previous schema version, or hand-edited garbage) degrades to "no brief"
   * — returns `null` instead of throwing, so callers never see a 500 from an
   * unreadable row.
   */
  async getStored(prId: string): Promise<StoredBrief | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return null;

    const parsed = StoredBrief.safeParse(row.json);
    if (!parsed.success) {
      console.warn(
        `[brief] pr_brief.json for pr ${prId} failed StoredBrief.safeParse — treating as no brief`,
        parsed.error.flatten(),
      );
      return null;
    }
    return parsed.data;
  }

  /** Insert-or-replace the stored envelope for a PR. `pr_id` is the PK, so a
   *  second call for the same PR (regeneration) always overwrites cleanly. */
  async upsert(prId: string, stored: StoredBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: stored })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: stored } });
  }

  /** The PR's current head sha, workspace-scoped. `null` if the PR doesn't
   *  exist (or belongs to a different workspace). */
  async getPullHeadSha(workspaceId: string, prId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ headSha: t.pullRequests.headSha })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row?.headSha ?? null;
  }

  /** Changed-file metadata ONLY — `path`/`additions`/`deletions`. Never
   *  selects `pr_files.patch` (the diff text is not needed for brief
   *  grounding and would blow up the query payload for large PRs). */
  async getChangedFiles(prId: string): Promise<ChangedFileRef[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /** Raw `agent_runs ⋈ reviews` (+ `agents` for the display name) rows for a
   *  PR, newest first, mapped to the snake_case `AgentRunWithReview` shape
   *  that `latest-run.ts`'s `selectLatestCompletedRun` expects — the mapping
   *  happens here, in infrastructure, so Drizzle's camelCase `$inferSelect`
   *  shape never leaves this file. T6 does the "which one counts as the
   *  latest completed run" selection. */
  async getLatestRunRows(workspaceId: string, prId: string): Promise<AgentRunWithReview[]> {
    const rows = await this.db
      .select({
        runId: t.agentRuns.id,
        status: t.agentRuns.status,
        ranAt: t.agentRuns.ranAt,
        verdict: t.reviews.verdict,
        findingsCount: t.agentRuns.findingsCount,
        blockers: t.agentRuns.blockers,
        score: t.agentRuns.score,
        costUsd: t.agentRuns.costUsd,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        agentName: t.agents.name,
      })
      .from(t.agentRuns)
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
      .orderBy(desc(t.agentRuns.ranAt));

    return rows.map((row) => ({
      run_id: row.runId,
      ran_at: row.ranAt,
      status: row.status,
      score: row.score,
      cost_usd: row.costUsd,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      findings_count: row.findingsCount,
      blockers: row.blockers,
      agent_name: row.agentName,
      verdict: row.verdict,
    }));
  }

  /** A stored brief is stale once the PR has moved past the head sha it was
   *  generated for. Pure comparison — no I/O — so T6/service.ts can call it
   *  after fetching both values independently. */
  isStale(stored: StoredBrief, headSha: string): boolean {
    return stored.head_sha !== headSha;
  }
}
