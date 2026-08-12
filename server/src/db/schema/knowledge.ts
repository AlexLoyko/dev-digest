import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, integer, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  /**
   * CONSISTENCY, 0..1 — how uniformly the repo follows this rule, scored by the
   * model against a rubric and clamped down to its own stated evidence
   * (`followingFiles` / `applicableFiles`). Keeps its historical column name;
   * the UI labels it "Consistency".
   */
  confidence: doublePrecision('confidence'),
  accepted: boolean('accepted').notNull().default(false),
  // --- Conventions extractor (L02) ---------------------------------------
  /** Model-assigned bucket (naming, error-handling, structure, …). Used to
   *  sort candidates so related rules cluster; not rendered on the card. */
  category: text('category'),
  /** Evidence location, RECOMPUTED from the snippet match — never the line the
   *  model claimed. Renders as `path:start-end` on the candidate card. */
  evidenceStartLine: integer('evidence_start_line'),
  evidenceEndLine: integer('evidence_end_line'),
  /** How many files the scan that produced this row actually read. Denormalized
   *  onto every row of a scan (they share one value). */
  sampledFiles: integer('sampled_files'),
  /** Size of the ranked pool those samples were selected FROM — the number the
   *  "Detected from N sample files" subtitle shows, since the top-N is chosen
   *  across the whole indexed repo. Frozen at scan time so it always describes
   *  THAT scan, even after a later re-index. */
  consideredFiles: integer('considered_files'),
  /** Clone HEAD at scan time. The evidence line numbers were computed against
   *  THIS revision, so deep links pin to it rather than a moving branch.
   *  Nullable: resolving it is best-effort and must never fail a scan. */
  scannedSha: text('scanned_sha'),
  /** The evidence behind `confidence`: sampled files seen FOLLOWING the rule, and
   *  the total where it was seen at all (following + counterexamples). Rendered
   *  as "Followed in N of M files" so the score is auditable rather than opaque. */
  followingFiles: integer('following_files'),
  applicableFiles: integer('applicable_files'),
  createdAt: now(),
},
(t) => ({
  // Every query this module makes filters on (workspace_id, repo_id) — list,
  // the replace-scan delete, accept and reject. Without this they are all seq
  // scans that grow with the workspace (cf. `memory_ws_idx` on the sibling table).
  wsRepoIdx: index('conventions_ws_repo_idx').on(t.workspaceId, t.repoId),
}));
