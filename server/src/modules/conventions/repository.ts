import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';

export type { ConventionRow };

/**
 * Conventions data-access layer — the ONLY place that touches the `conventions`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 *
 * Module-local (not on the Container): nothing outside this module reads it.
 */

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  category: string | null;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  confidence: number;
  followingFiles: number;
  applicableFiles: number;
  sampledFiles: number;
  consideredFiles: number;
  scannedSha: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Candidates for a repo, clustered by category then strongest-first. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(asc(t.conventions.category), desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Swap in a fresh scan: a re-scan supersedes the previous set wholesale
   * (including its accept/reject state). Delete + insert run in ONE transaction
   * so a failed insert can never leave the repo with zero conventions.
   */
  async replaceForRepo(
    workspaceId: string,
    repoId: string,
    values: InsertConvention[],
  ): Promise<ConventionRow[]> {
    // An empty batch must NOT reach here — a scan that grounded nothing would
    // otherwise delete the user's curated set. The service guards it; this is
    // the second line of defence.
    if (values.length === 0) return [];
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      return tx.insert(t.conventions).values(values).returning();
    });
  }

  async setAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Reject = hard delete; the card is gone for good. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }
}
