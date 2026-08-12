import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import type { IntentSource, IntentType } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

const INTENT_TYPES = [
  'feature',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'chore',
  'security',
  'build',
  'revert',
] as const satisfies readonly IntentType[];

/**
 * Derived PR intent (L03). Deliberately has NO `workspace_id` — it is scoped
 * through the `pr_id` FK to `pull_requests`, which is workspace-scoped. This is a
 * known, intentional exception to the "every domain table carries workspace_id"
 * invariant; don't "fix" it without checking every call site.
 *
 * One row per PR: this is a derived cache, not a history. `head_sha` is the cache
 * key — a row whose head_sha differs from the PR's current head is stale and gets
 * recomputed, replacing this row.
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * Inlined rather than imported from the `IntentType` zod enum: drizzle-kit loads
   * this file through CJS `require`, and importing a runtime VALUE from
   * `@devdigest/shared` pulls in its `index.ts`, whose `./contracts/*.js`
   * re-exports drizzle-kit cannot resolve (`db:generate` dies with
   * MODULE_NOT_FOUND). Type-only imports are erased and stay safe. The satisfies
   * clause keeps this list honest against the contract at compile time.
   */
  type: text('type', { enum: INTENT_TYPES }).notNull().default('chore'),
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
    .notNull()
    .default('low'),
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * NULLABLE on purpose. Rows written before L03 have no head SHA; a NOT NULL
   * default would make them look like a valid cache entry for the wrong commit.
   * NULL always misses the cache and reclassifies once, which is correct.
   */
  headSha: text('head_sha'),
  provider: text('provider'),
  model: text('model'),
  /** Spelled out rather than the `now()` helper, which hardcodes `created_at`. */
  classifiedAt: timestamp('classified_at', { withTimezone: true }).defaultNow(),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
