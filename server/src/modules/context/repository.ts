import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextRoot } from './constants.js';
import type { ThreatLevel } from '../skills/scanner.js';

/**
 * T9 — Project Context data-access. Owns `repo_context_documents`,
 * `repo_context_scans`, `agent_context_documents`, and
 * `skill_context_documents` (T2's schema). All Drizzle `$inferSelect` /
 * `$inferInsert` types stay behind the `toDomain`/`toDb` mappers below —
 * services (T10/T11) only ever see the plain domain interfaces exported
 * from this file.
 *
 * NFR-7 reminder (see db/schema/project-context.ts): only path/metadata is
 * stored here, never document text.
 */

// ---------------------------------------------------------------- Domain types

export type ContextScanStatus = 'idle' | 'parsing' | 'done' | 'error';

/** One discovered context document (metadata only, never body text). */
export interface ContextDocument {
  path: string;
  root: ContextRoot;
  sizeBytes: number;
  tokens: number;
  tokensApproximate: boolean;
  threatLevel: ThreatLevel;
  excludedReason: string | null;
  scannedAt: Date;
}

/**
 * Insert shape for `replaceDocuments` — mirrors `repo_context_documents`'
 * insert columns (minus `repoId`, passed separately, and `scannedAt`, which
 * defaults to `now()`). This is the contract the scanner (T8) writes
 * records against.
 */
export interface ContextDocumentInput {
  path: string;
  root: ContextRoot;
  sizeBytes?: number;
  tokens?: number;
  tokensApproximate?: boolean;
  threatLevel?: ThreatLevel;
  excludedReason?: string | null;
}

/** Current scan status for a repo's context documents. */
export interface ContextScan {
  repoId: string;
  status: ContextScanStatus;
  fileCount: number;
  commitSha: string | null;
  durationMs: number | null;
  message: string | null;
  scannedAt: Date | null;
}

export interface UpsertScanInput {
  status: ContextScanStatus;
  fileCount?: number;
  commitSha?: string | null;
  durationMs?: number | null;
  message?: string | null;
  scannedAt?: Date | null;
}

/** One document path attached directly to an agent or a skill, in order. */
export interface ContextAttachmentRow {
  path: string;
  position: number;
}

/**
 * One document inherited by an agent through a linked skill. `skillOrder`
 * carries `agent_skills.order` so callers (T10/T11's `buildEffectiveSet`)
 * can order skill-inherited documents by skill order, then position.
 */
export interface SkillAttachmentRow {
  skillId: string;
  skillOrder: number;
  path: string;
  position: number;
}

// ---------------------------------------------------------------- Mappers

type DocumentRow = typeof t.repoContextDocuments.$inferSelect;
type ScanRow = typeof t.repoContextScans.$inferSelect;

function toDomainDocument(row: DocumentRow): ContextDocument {
  return {
    path: row.path,
    root: row.root,
    sizeBytes: row.sizeBytes,
    tokens: row.tokens,
    tokensApproximate: row.tokensApproximate,
    threatLevel: row.threatLevel,
    excludedReason: row.excludedReason,
    scannedAt: row.scannedAt,
  };
}

function toDbDocument(
  repoId: string,
  input: ContextDocumentInput,
): typeof t.repoContextDocuments.$inferInsert {
  return {
    repoId,
    path: input.path,
    root: input.root,
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    ...(input.tokensApproximate !== undefined
      ? { tokensApproximate: input.tokensApproximate }
      : {}),
    ...(input.threatLevel !== undefined ? { threatLevel: input.threatLevel } : {}),
    ...(input.excludedReason !== undefined ? { excludedReason: input.excludedReason } : {}),
  };
}

function toDomainScan(row: ScanRow): ContextScan {
  return {
    repoId: row.repoId,
    status: row.status,
    fileCount: row.fileCount,
    commitSha: row.commitSha,
    durationMs: row.durationMs,
    message: row.message,
    scannedAt: row.scannedAt,
  };
}

// ---------------------------------------------------------------- Repository

export class ContextRepository {
  constructor(private db: Db) {}

  // ---- repo_context_documents ---------------------------------------------

  /**
   * Replace the full set of discovered documents for a repo (transactional
   * delete-then-insert). Called by the scanner (T8) after a fresh scan.
   */
  async replaceDocuments(repoId: string, records: ContextDocumentInput[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.repoContextDocuments).where(eq(t.repoContextDocuments.repoId, repoId));
      if (records.length === 0) return;
      await tx
        .insert(t.repoContextDocuments)
        .values(records.map((r) => toDbDocument(repoId, r)));
    });
  }

  async listDocuments(repoId: string): Promise<ContextDocument[]> {
    const rows = await this.db
      .select()
      .from(t.repoContextDocuments)
      .where(eq(t.repoContextDocuments.repoId, repoId))
      .orderBy(asc(t.repoContextDocuments.path));
    return rows.map(toDomainDocument);
  }

  // ---- repo_context_scans --------------------------------------------------

  async getScan(repoId: string): Promise<ContextScan | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repoContextScans)
      .where(eq(t.repoContextScans.repoId, repoId));
    return row ? toDomainScan(row) : undefined;
  }

  /** Upsert the scan status row for a repo (one row per repo — PK is repoId). */
  async upsertScan(repoId: string, status: UpsertScanInput): Promise<ContextScan> {
    const patch = {
      status: status.status,
      ...(status.fileCount !== undefined ? { fileCount: status.fileCount } : {}),
      ...(status.commitSha !== undefined ? { commitSha: status.commitSha } : {}),
      ...(status.durationMs !== undefined ? { durationMs: status.durationMs } : {}),
      ...(status.message !== undefined ? { message: status.message } : {}),
      ...(status.scannedAt !== undefined ? { scannedAt: status.scannedAt } : {}),
    };
    const [row] = await this.db
      .insert(t.repoContextScans)
      .values({ repoId, ...patch })
      .onConflictDoUpdate({ target: t.repoContextScans.repoId, set: patch })
      .returning();
    return toDomainScan(row!);
  }

  // ---- agent_context_documents ---------------------------------------------

  async agentAttachments(agentId: string): Promise<ContextAttachmentRow[]> {
    return this.db
      .select({ path: t.agentContextDocuments.path, position: t.agentContextDocuments.position })
      .from(t.agentContextDocuments)
      .where(eq(t.agentContextDocuments.agentId, agentId))
      .orderBy(asc(t.agentContextDocuments.position));
  }

  /**
   * Replace the full set of documents attached directly to an agent
   * (transactional delete-then-insert). Position = index in `paths`.
   */
  async setAgentAttachments(agentId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocuments).where(eq(t.agentContextDocuments.agentId, agentId));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocuments)
        .values(paths.map((path, position) => ({ agentId, path, position })));
    });
  }

  // ---- skill_context_documents ----------------------------------------------

  async skillAttachments(skillId: string): Promise<ContextAttachmentRow[]> {
    return this.db
      .select({ path: t.skillContextDocuments.path, position: t.skillContextDocuments.position })
      .from(t.skillContextDocuments)
      .where(eq(t.skillContextDocuments.skillId, skillId))
      .orderBy(asc(t.skillContextDocuments.position));
  }

  /**
   * Replace the full set of documents attached to a skill (transactional
   * delete-then-insert). Position = index in `paths`.
   */
  async setSkillAttachments(skillId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocuments).where(eq(t.skillContextDocuments.skillId, skillId));
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocuments)
        .values(paths.map((path, position) => ({ skillId, path, position })));
    });
  }

  /**
   * Documents an agent inherits through its linked skills, joined against
   * `agent_skills` so each row carries the skill's `order` on the agent
   * (needed to order skill-inherited documents deterministically — AC-12).
   */
  async skillAttachmentsForAgent(agentId: string): Promise<SkillAttachmentRow[]> {
    return this.db
      .select({
        skillId: t.skillContextDocuments.skillId,
        skillOrder: t.agentSkills.order,
        path: t.skillContextDocuments.path,
        position: t.skillContextDocuments.position,
      })
      .from(t.agentSkills)
      .innerJoin(
        t.skillContextDocuments,
        eq(t.skillContextDocuments.skillId, t.agentSkills.skillId),
      )
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order), asc(t.skillContextDocuments.position));
  }

  // ---- usage counts -----------------------------------------------------------

  /**
   * AC-4: for every path reachable by at least one agent in `workspaceId`
   * (directly attached OR inherited via a linked skill), count the number
   * of DISTINCT agents that reach it.
   *
   * Strategy: build the full set of (agent_id, path) "reachability" pairs
   * from two sources — direct attachment (`agent_context_documents` joined
   * to `agents` for the workspace scope) and skill inheritance
   * (`skill_context_documents` joined through `agent_skills` to `agents`)
   * — combined with `UNION ALL`, then `COUNT(DISTINCT agent_id)` grouped by
   * `path` in an outer query.
   *
   * This cannot double-count: an agent that reaches a path both directly
   * AND via a skill contributes two rows to the unioned set (one per
   * source), but `COUNT(DISTINCT agent_id)` collapses them back to one
   * agent for that path — the union produces (agent_id, path) rows to sum
   * OVER, and only the count is de-duplicated per agent, not per row. Two
   * agents reached via a skill linked twice, or a skill also linked to the
   * same agent directly, still count each distinct agent exactly once.
   *
   * Agents are workspace-scoped (not repo-scoped, see `agents.workspace_id`),
   * so this intentionally has no repo filter — a path's agent count is
   * workspace-wide, matching how the agent picker/editor is scoped.
   */
  async usedByAgentCounts(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db.execute<{ path: string; agent_count: number }>(sql`
      SELECT path, COUNT(DISTINCT agent_id)::int AS agent_count
      FROM (
        SELECT acd.path AS path, acd.agent_id AS agent_id
        FROM agent_context_documents acd
        INNER JOIN agents a ON a.id = acd.agent_id
        WHERE a.workspace_id = ${workspaceId}

        UNION ALL

        SELECT scd.path AS path, ags.agent_id AS agent_id
        FROM skill_context_documents scd
        INNER JOIN agent_skills ags ON ags.skill_id = scd.skill_id
        INNER JOIN agents a ON a.id = ags.agent_id
        WHERE a.workspace_id = ${workspaceId}
      ) reachable
      GROUP BY path
    `);

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.path, Number(row.agent_count));
    }
    return counts;
  }
}
