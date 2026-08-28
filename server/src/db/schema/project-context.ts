import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project context
//
// NFR-7: document text shall never be persisted outside the repository clone —
// only paths and positions are stored here. Every table in this file holds
// metadata (path, size, token counts, threat classification, scan status)
// about context documents (specs/docs/insights/AGENTS.md/SKILL.md), never the
// document body itself.
//
// FK-column indexing: in every table below the FK column is the leading (or
// sole) column of the primary key, so the PK's btree index already covers
// FK-only lookups (e.g. "all documents for repo X") — no redundant single-
// column index is added. This mirrors the `agent_skills` join-table pattern
// (server/src/db/schema/agents.ts) which relies on the same composite-PK
// coverage instead of a separate index.

/**
 * `repo_context_documents` — one row per discovered context document
 * (specs/docs/insights) for a repo. Metadata only: path, size, token
 * estimate, and a threat classification. NO document text is stored.
 */
export const repoContextDocuments = pgTable(
  'repo_context_documents',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    root: text('root', { enum: ['specs', 'docs', 'insights'] }).notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    tokensApproximate: boolean('tokens_approximate').notNull().default(false),
    threatLevel: text('threat_level', {
      enum: ['unknown', 'safe', 'suspicious', 'dangerous'],
    })
      .notNull()
      .default('unknown'),
    excludedReason: text('excluded_reason'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.repoId, t.path] }) }),
);

/**
 * `repo_context_scans` — one row per repo tracking the status of the most
 * recent context-document scan (idle/parsing/done/error).
 */
export const repoContextScans = pgTable('repo_context_scans', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['idle', 'parsing', 'done', 'error'] })
    .notNull()
    .default('idle'),
  fileCount: integer('file_count').notNull().default(0),
  commitSha: text('commit_sha'),
  durationMs: integer('duration_ms'),
  message: text('message'),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
});

/**
 * `agent_context_documents` — ordered set of context document paths attached
 * to an agent. Path + position only, no document text.
 */
export const agentContextDocuments = pgTable(
  'agent_context_documents',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.path] }) }),
);

/**
 * `skill_context_documents` — ordered set of context document paths attached
 * to a skill. Path + position only, no document text.
 */
export const skillContextDocuments = pgTable(
  'skill_context_documents',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.path] }) }),
);
