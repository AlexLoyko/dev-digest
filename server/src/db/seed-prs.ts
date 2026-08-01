/**
 * Demo pull requests for `acme/payments-api`, consumed by `./seed.ts`.
 *
 * Kept out of seed.ts the way `./seed-prompts.ts` holds the agent prompt bodies:
 * this is content, not seeding logic.
 *
 * The fixtures exist so the PR list, the Agent-runs timeline and the findings
 * badges all have data on a fresh install, before any model key is configured.
 * Between them they cover every state those surfaces have to render:
 *
 *  - #482 needs_review, three runs (two priced + one failed) — the cost fixtures
 *  - #479 twelve findings across all three severities — the findings popover has
 *         a 340px max height (~4 rows), so this is the one that must SCROLL
 *  - #477 a single SUGGESTION — one badge on its own
 *  - #471 four findings, warning-heavy — two badges
 *  - #468 three findings — a mid-range row
 *  - #460 stale and clean — ZERO findings, so the cell is empty and there is
 *         no hover target at all
 *  - #455 six findings and stale — a second scrolling case
 *
 * Statuses land as needs_review (#482, #479), reviewed (#477, #471, #468) and
 * stale (#460, #455) — every chip the list can draw for an open PR.
 *
 * A run's `findings_count` / `blockers` / `score` are NOT declared here: seed.ts
 * derives them from the review's own findings. Hand-written counters are what
 * let the old seed drift out of agreement with its findings (three "findings"
 * on a review that had two), which the badges then rendered as a contradiction.
 */

export interface SeedFinding {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: 'bug' | 'security' | 'perf' | 'style' | 'test';
  title: string;
  rationale: string;
  suggestion?: string;
  confidence: number;
}

export interface SeedRun {
  /** Matches an agent seeded by name; falls back to General Reviewer. */
  agent: string;
  minutesAgo: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  /** null = unpriced (an unknown model, or a run that never reached one). */
  costUsd: number | null;
  status: 'done' | 'failed';
  error?: string;
  grounding: string;
  /** Absent for a run that produced no review (a failure). */
  review?: {
    verdict: 'request_changes' | 'approve' | 'comment';
    summary: string;
    score: number;
    findings: SeedFinding[];
  };
}

export interface SeedPr {
  number: number;
  title: string;
  author: string;
  branch: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
  body: string;
  files: { path: string; additions: number; deletions: number; patch?: string }[];
  commits: { sha: string; message: string; author: string }[];
  /**
   * Inputs to `deriveReviewStatus` (modules/pulls/status.ts), which computes the
   * list's STATUS chip rather than reading a column:
   *   headReviewed=false            → needs_review
   *   headReviewed=true, age < 7d   → reviewed
   *   headReviewed=true, age >= 7d  → stale
   */
  headReviewed: boolean;
  /** Days back for `updated_at`; also drives the UPDATED column. */
  ageDays: number;
  runs: SeedRun[];
}

export const SEED_PRS: SeedPr[] = [
  // ---- #482 — the primary demo PR (cost fixtures + the multi-agent example) --
  {
    number: 482,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit-public',
    headSha: 'a1b2c3d4e5f6',
    additions: 247,
    deletions: 38,
    filesCount: 9,
    body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
    files: [
      { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { path: 'src/config.ts', additions: 4, deletions: 0 },
      { path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ],
    commits: [
      { sha: 'a1b2c3d4e5f6', message: 'Add token-bucket rate limiter', author: 'marisa.koch' },
    ],
    headReviewed: false,
    ageDays: 0,
    runs: [
      {
        agent: 'Security Reviewer',
        minutesAgo: 12,
        durationMs: 8200,
        tokensIn: 8100,
        tokensOut: 1019,
        costUsd: 0.0013,
        status: 'done',
        grounding: '3/3 passed',
        review: {
          verdict: 'request_changes',
          summary:
            'Two critical exposures: a committed live Stripe key and an SSRF-shaped webhook forwarder. Block before merge.',
          score: 38,
          findings: [
            {
              file: 'src/config.ts',
              startLine: 12,
              endLine: 12,
              severity: 'CRITICAL',
              category: 'security',
              title: 'Hardcoded Stripe secret key in commit',
              rationale:
                'Line 12 contains a literal string starting with `sk_live_`, which appears to be a Stripe secret key. Committing this exposes it to anyone with read access to the repo — including via git history even after a later removal.',
              suggestion:
                'Move the key to an environment variable and reference it via `process.env.STRIPE_SECRET_KEY`. Rotate the key immediately — assume it is already compromised.',
              confidence: 0.98,
            },
            {
              file: 'src/api/public/webhooks.ts',
              startLine: 61,
              endLine: 74,
              severity: 'CRITICAL',
              category: 'security',
              title: 'Lethal trifecta: untrusted input reaches exfil path',
              rationale:
                "The webhook handler reads attacker-controllable `req.body.callback_url` (untrusted input), loads the account's stored credentials (private data), and then issues an outbound request to that URL (exfil path). All three in one request.",
              suggestion:
                'Allow-list the callback host, or drop the caller-supplied URL entirely and use the destination registered on the account.',
              confidence: 0.79,
            },
            {
              file: 'src/middleware/ratelimit.ts',
              startLine: 52,
              endLine: 52,
              severity: 'WARNING',
              category: 'bug',
              title: 'Retry-After header omitted on 429',
              rationale:
                'The limiter returns 429 without a `Retry-After` header, so a well-behaved client has no way to know when to retry and will most likely hammer the endpoint on a fixed interval.',
              suggestion: 'Set `Retry-After` to the remaining window in seconds.',
              confidence: 0.81,
            },
          ],
        },
      },
      {
        agent: 'Performance Reviewer',
        minutesAgo: 25,
        durationMs: 6400,
        tokensIn: 10600,
        tokensOut: 1411,
        costUsd: 0.0014,
        status: 'done',
        grounding: '2/2 passed',
        review: {
          verdict: 'comment',
          summary:
            'No blockers. One real N+1 under the new limiter, plus a magic number worth naming.',
          score: 64,
          findings: [
            {
              file: 'src/api/users.ts',
              startLine: 45,
              endLine: 52,
              severity: 'WARNING',
              category: 'perf',
              title: 'N+1 query in user list endpoint',
              rationale:
                'The loop on line 46 calls `db.posts.findMany({ userId })` once per user. For a user list of N items, this creates N+1 queries. Under the new rate limiter this endpoint is also the one most likely to be retried.',
              suggestion: 'Use a single `IN` query and group the rows in memory.',
              confidence: 0.86,
            },
            {
              file: 'src/middleware/ratelimit.ts',
              startLine: 28,
              endLine: 28,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Extract magic number 3600',
              rationale:
                'The number 3600 appears twice without explanation. A reader has to infer it means seconds-in-an-hour.',
              suggestion: 'Name it `WINDOW_SECONDS = 3600`.',
              confidence: 0.62,
            },
          ],
        },
      },
      // A failed run: no cost data at all. Proves "—" ≠ "$0.00" on every
      // surface, and that a null-cost run adds nothing to the PR total.
      {
        agent: 'General Reviewer',
        minutesAgo: 4,
        durationMs: 320,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
        status: 'failed',
        error: '429 You exceeded your current quota, please check your plan and billing details.',
        grounding: '0/0 passed',
      },
    ],
  },

  // ---- #479 — the scroll case: twelve findings in one run ------------------
  {
    number: 479,
    title: 'Migrate sessions table to UUID primary key',
    author: 'deepak.r',
    branch: 'chore/sessions-uuid-pk',
    headSha: 'b2c3d4e5f6a7',
    additions: 980,
    deletions: 260,
    filesCount: 22,
    body: 'Swap the sessions table from a bigserial primary key to UUIDv7. Includes a backfill migration.',
    files: [
      { path: 'src/db/migrations/0031_sessions_uuid.sql', additions: 210, deletions: 0 },
      { path: 'src/db/schema/sessions.ts', additions: 46, deletions: 31 },
      { path: 'src/auth/session-store.ts', additions: 188, deletions: 96 },
      { path: 'src/auth/cookie.ts', additions: 34, deletions: 18 },
    ],
    commits: [
      { sha: 'b2c3d4e5f6a7', message: 'Backfill sessions.uuid and swap the PK', author: 'deepak.r' },
      { sha: 'c3d4e5f6a7b8', message: 'Drop the old bigserial column', author: 'deepak.r' },
    ],
    headReviewed: false,
    ageDays: 0,
    runs: [
      {
        agent: 'Security Reviewer',
        minutesAgo: 180,
        durationMs: 21400,
        tokensIn: 31200,
        tokensOut: 4180,
        costUsd: 0.0068,
        status: 'done',
        grounding: '12/12 passed',
        review: {
          verdict: 'request_changes',
          summary:
            'A destructive migration with no rollback, session fixation during the cutover, and nine smaller issues. Do not merge on a Friday.',
          score: 44,
          findings: [
            {
              file: 'src/db/migrations/0031_sessions_uuid.sql',
              startLine: 4,
              endLine: 9,
              severity: 'CRITICAL',
              category: 'bug',
              title: 'Destructive migration drops the old PK before the backfill verifies',
              rationale:
                'The `ALTER TABLE … DROP COLUMN id` on line 7 runs in the same transaction as the backfill but before any row-count assertion. If the backfill silently skips rows, the old identifiers are gone and there is no way back.',
              suggestion:
                'Assert `count(*) WHERE uuid IS NULL = 0` before dropping, and ship the drop as a separate migration one release later.',
              confidence: 0.94,
            },
            {
              file: 'src/auth/session-store.ts',
              startLine: 88,
              endLine: 104,
              severity: 'CRITICAL',
              category: 'security',
              title: 'Session fixation window during the key cutover',
              rationale:
                'During the dual-read window the store accepts a session id in either format and does not rotate the cookie on privilege change, so an attacker who plants a pre-migration id keeps it valid after the cutover.',
              suggestion: 'Rotate the session identifier on every privilege change, in both formats.',
              confidence: 0.88,
            },
            {
              file: 'src/auth/session-store.ts',
              startLine: 142,
              endLine: 147,
              severity: 'CRITICAL',
              category: 'security',
              title: 'Session ids generated with Math.random()',
              rationale:
                '`Math.random()` is not a cryptographically secure source. Session identifiers derived from it are predictable given enough samples.',
              suggestion: 'Use `crypto.randomUUID()` or `crypto.randomBytes`.',
              confidence: 0.96,
            },
            {
              file: 'src/db/migrations/0031_sessions_uuid.sql',
              startLine: 22,
              endLine: 22,
              severity: 'WARNING',
              category: 'perf',
              title: 'Backfill rewrites the whole table in one statement',
              rationale:
                'A single `UPDATE sessions SET uuid = …` takes an ACCESS EXCLUSIVE lock for the duration. On the production row count this is minutes of downtime.',
              suggestion: 'Batch the backfill in chunks of 10k with a short sleep between batches.',
              confidence: 0.9,
            },
            {
              file: 'src/db/schema/sessions.ts',
              startLine: 18,
              endLine: 18,
              severity: 'WARNING',
              category: 'perf',
              title: 'Random UUID primary key fragments the btree index',
              rationale:
                'UUIDv4 inserts land at random points in the index, causing page splits and a much larger index than a monotonic key. The PR description says UUIDv7 but the code calls `randomUUID()`.',
              suggestion: 'Use a time-ordered UUIDv7 generator, as the description intends.',
              confidence: 0.83,
            },
            {
              file: 'src/auth/session-store.ts',
              startLine: 61,
              endLine: 70,
              severity: 'WARNING',
              category: 'bug',
              title: 'Dual-read path has no expiry on the legacy branch',
              rationale:
                'The legacy id branch never checks `expires_at`, so a pre-migration session stays valid indefinitely once the new branch is in place.',
              suggestion: 'Apply the same expiry check on both branches.',
              confidence: 0.87,
            },
            {
              file: 'src/auth/cookie.ts',
              startLine: 29,
              endLine: 33,
              severity: 'WARNING',
              category: 'security',
              title: 'SameSite dropped from the session cookie',
              rationale:
                'The rewritten cookie helper sets `httpOnly` and `secure` but no longer sets `sameSite`, so the browser default applies and CSRF protection weakens.',
              suggestion: "Set `sameSite: 'lax'` explicitly.",
              confidence: 0.85,
            },
            {
              file: 'src/auth/session-store.ts',
              startLine: 205,
              endLine: 214,
              severity: 'WARNING',
              category: 'test',
              title: 'No test covers the dual-read window',
              rationale:
                'Every test seeds a new-format id. The branch that reads a legacy id is unexercised, which is precisely the code that only runs during the risky window.',
              suggestion: 'Add a case that reads a legacy id and asserts it is rotated.',
              confidence: 0.78,
            },
            {
              file: 'src/db/schema/sessions.ts',
              startLine: 41,
              endLine: 41,
              severity: 'WARNING',
              category: 'bug',
              title: 'Foreign key left pointing at the dropped column',
              rationale:
                '`session_events.session_id` still references the old bigint column. After the swap the constraint refers to a column that no longer exists.',
              suggestion: 'Migrate the dependent table in the same change.',
              confidence: 0.91,
            },
            {
              file: 'src/auth/session-store.ts',
              startLine: 24,
              endLine: 24,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Session TTL duplicated in three places',
              rationale:
                'The value 1209600 appears in the store, the cookie helper, and the migration. Changing the TTL means finding all three.',
              suggestion: 'Export a single `SESSION_TTL_SECONDS`.',
              confidence: 0.7,
            },
            {
              file: 'src/auth/cookie.ts',
              startLine: 12,
              endLine: 16,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Cookie name is a bare string literal',
              rationale:
                'The name `sid` is typed out at each call site rather than shared, so a typo silently creates a second cookie.',
              suggestion: 'Hoist it to a constant.',
              confidence: 0.64,
            },
            {
              file: 'src/db/migrations/0031_sessions_uuid.sql',
              startLine: 1,
              endLine: 1,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Migration has no comment explaining the cutover order',
              rationale:
                'The statement order in this file matters a great deal, and the next reader has no way to know why it is the way it is.',
              suggestion: 'Add a header comment describing the dual-read window.',
              confidence: 0.58,
            },
          ],
        },
      },
    ],
  },

  // ---- #477 — a single suggestion; one badge on its own -------------------
  {
    number: 477,
    title: 'Fix flaky checkout integration test',
    author: 'tomek.w',
    branch: 'fix/flaky-checkout-test',
    headSha: 'd4e5f6a7b8c9',
    additions: 34,
    deletions: 8,
    filesCount: 2,
    body: 'The checkout test raced the webhook fixture. Await the settle instead of sleeping.',
    files: [
      { path: 'test/checkout.it.test.ts', additions: 28, deletions: 8 },
      { path: 'test/helpers/webhooks.ts', additions: 6, deletions: 0 },
    ],
    commits: [
      { sha: 'd4e5f6a7b8c9', message: 'Await the webhook settle instead of sleeping', author: 'tomek.w' },
    ],
    headReviewed: true,
    ageDays: 1,
    runs: [
      {
        agent: 'General Reviewer',
        minutesAgo: 1500,
        durationMs: 3100,
        tokensIn: 4200,
        tokensOut: 610,
        costUsd: 0.0006,
        status: 'done',
        grounding: '1/1 passed',
        review: {
          verdict: 'approve',
          summary: 'Correct fix for the race. One readability nit.',
          score: 92,
          findings: [
            {
              file: 'test/helpers/webhooks.ts',
              startLine: 4,
              endLine: 4,
              severity: 'SUGGESTION',
              category: 'test',
              title: 'Fixed 5s timeout will bite on a slow CI runner',
              rationale:
                'The helper waits up to 5 seconds. That is comfortable locally and marginal on a loaded CI runner, which is how the original flake started.',
              suggestion: 'Make the budget configurable, defaulting higher under CI.',
              confidence: 0.66,
            },
          ],
        },
      },
    ],
  },

  // ---- #471 — warning-heavy; two badges -----------------------------------
  {
    number: 471,
    title: 'Refactor invoice PDF renderer',
    author: 'sara.lin',
    branch: 'refactor/invoice-pdf',
    headSha: 'e5f6a7b8c9d0',
    additions: 612,
    deletions: 268,
    filesCount: 14,
    body: 'Split the monolithic renderer into layout, typography, and export stages.',
    files: [
      { path: 'src/invoices/render/layout.ts', additions: 240, deletions: 0 },
      { path: 'src/invoices/render/export.ts', additions: 190, deletions: 12 },
      { path: 'src/invoices/renderer.ts', additions: 44, deletions: 256 },
    ],
    commits: [
      { sha: 'e5f6a7b8c9d0', message: 'Split renderer into stages', author: 'sara.lin' },
    ],
    headReviewed: true,
    ageDays: 2,
    runs: [
      {
        agent: 'Performance Reviewer',
        minutesAgo: 2900,
        durationMs: 11200,
        tokensIn: 18400,
        tokensOut: 2260,
        costUsd: 0.0039,
        status: 'done',
        grounding: '4/4 passed',
        review: {
          verdict: 'comment',
          summary: 'Cleaner split, but the export stage buffers whole documents in memory.',
          score: 73,
          findings: [
            {
              file: 'src/invoices/render/export.ts',
              startLine: 77,
              endLine: 92,
              severity: 'WARNING',
              category: 'perf',
              title: 'Whole PDF buffered in memory before writing',
              rationale:
                'The export stage concatenates every page into one Buffer before the first byte is written. A 400-page invoice run holds all of it at once.',
              suggestion: 'Pipe the page stream straight to the destination.',
              confidence: 0.89,
            },
            {
              file: 'src/invoices/render/layout.ts',
              startLine: 130,
              endLine: 138,
              severity: 'WARNING',
              category: 'bug',
              title: 'Column widths computed from the wrong font metrics',
              rationale:
                'Layout measures with the default font, but export substitutes the embedded one. Wide glyphs overflow the cell on non-Latin invoices.',
              suggestion: 'Measure with the same font instance the exporter embeds.',
              confidence: 0.82,
            },
            {
              file: 'src/invoices/render/export.ts',
              startLine: 21,
              endLine: 21,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Stage boundaries are not typed',
              rationale:
                'Each stage takes and returns `any`, so the split gains structure without gaining safety.',
              suggestion: 'Give each stage an explicit input/output interface.',
              confidence: 0.71,
            },
            {
              file: 'src/invoices/renderer.ts',
              startLine: 9,
              endLine: 9,
              severity: 'SUGGESTION',
              category: 'test',
              title: 'Golden-file test still covers only the old path',
              rationale:
                'The single snapshot exercises the legacy entry point, so a regression inside the new stages would not be caught.',
              suggestion: 'Add a snapshot per stage.',
              confidence: 0.68,
            },
          ],
        },
      },
    ],
  },

  // ---- #468 — a mid-range row ---------------------------------------------
  {
    number: 468,
    title: 'Add idempotency keys to charge endpoint',
    author: 'marisa.koch',
    branch: 'feat/idempotency-keys',
    headSha: 'f6a7b8c9d0e1',
    additions: 218,
    deletions: 92,
    filesCount: 7,
    body: 'Accept an Idempotency-Key header on POST /charges and replay the stored response.',
    files: [
      { path: 'src/api/charges.ts', additions: 128, deletions: 62 },
      { path: 'src/db/schema/idempotency.ts', additions: 54, deletions: 0 },
    ],
    commits: [
      { sha: 'f6a7b8c9d0e1', message: 'Store and replay idempotent responses', author: 'marisa.koch' },
    ],
    headReviewed: true,
    ageDays: 2,
    runs: [
      {
        agent: 'General Reviewer',
        minutesAgo: 3000,
        durationMs: 9400,
        tokensIn: 14100,
        tokensOut: 1780,
        costUsd: 0.0029,
        status: 'done',
        grounding: '3/3 passed',
        review: {
          verdict: 'comment',
          summary: 'Sound approach. The key scope and the replay window both need tightening.',
          score: 81,
          findings: [
            {
              file: 'src/api/charges.ts',
              startLine: 54,
              endLine: 63,
              severity: 'WARNING',
              category: 'bug',
              title: 'Idempotency key is not scoped to the account',
              rationale:
                'The key is looked up globally, so two accounts using the same key value collide and one receives the other account‘s stored response.',
              suggestion: 'Make the unique constraint `(account_id, key)`.',
              confidence: 0.93,
            },
            {
              file: 'src/db/schema/idempotency.ts',
              startLine: 31,
              endLine: 31,
              severity: 'WARNING',
              category: 'perf',
              title: 'Stored responses are never expired',
              rationale:
                'Rows accumulate forever; nothing prunes them and the table has no TTL index.',
              suggestion: 'Expire after 24h and add a partial index on the expiry.',
              confidence: 0.84,
            },
            {
              file: 'src/api/charges.ts',
              startLine: 96,
              endLine: 96,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Replay path duplicates the serializer',
              rationale:
                'The replay branch rebuilds the response body instead of returning the stored one verbatim.',
              suggestion: 'Return the stored payload as-is.',
              confidence: 0.65,
            },
          ],
        },
      },
    ],
  },

  // ---- #460 — CLEAN: the empty-cell case (stale, at 9 days old) -----------
  {
    number: 460,
    title: 'Bump node 18 → 20 in CI',
    author: 'deepak.r',
    branch: 'chore/node-20',
    headSha: 'a7b8c9d0e1f2',
    additions: 14,
    deletions: 4,
    filesCount: 2,
    body: 'Node 18 is out of maintenance in April. Move the CI matrix to 20.',
    files: [
      { path: '.github/workflows/ci.yml', additions: 10, deletions: 4 },
      { path: 'package.json', additions: 4, deletions: 0 },
    ],
    commits: [{ sha: 'a7b8c9d0e1f2', message: 'Bump CI matrix to node 20', author: 'deepak.r' }],
    headReviewed: true,
    ageDays: 9,
    runs: [
      {
        agent: 'General Reviewer',
        minutesAgo: 12_960,
        durationMs: 2200,
        tokensIn: 2600,
        tokensOut: 340,
        costUsd: 0.0004,
        status: 'done',
        grounding: '0/0 passed',
        review: {
          verdict: 'approve',
          summary: 'Nothing to flag. Version bump only.',
          score: 95,
          findings: [],
        },
      },
    ],
  },

  // ---- #455 — stale, and a second scrolling case --------------------------
  {
    number: 455,
    title: 'Webhook retry with exponential backoff',
    author: 'tomek.w',
    branch: 'feat/webhook-retry',
    headSha: 'b8c9d0e1f2a3',
    additions: 176,
    deletions: 64,
    filesCount: 6,
    body: 'Retry failed webhook deliveries with jittered exponential backoff, up to six attempts.',
    files: [
      { path: 'src/webhooks/retry.ts', additions: 118, deletions: 20 },
      { path: 'src/webhooks/queue.ts', additions: 44, deletions: 40 },
    ],
    commits: [
      { sha: 'b8c9d0e1f2a3', message: 'Add jittered backoff to the delivery queue', author: 'tomek.w' },
    ],
    headReviewed: true,
    ageDays: 14,
    runs: [
      {
        agent: 'Performance Reviewer',
        minutesAgo: 20_160,
        durationMs: 13800,
        tokensIn: 16900,
        tokensOut: 2040,
        costUsd: 0.0035,
        status: 'done',
        grounding: '6/6 passed',
        review: {
          verdict: 'comment',
          summary: 'Backoff is right in shape. The retry budget and the jitter source both need work.',
          score: 68,
          findings: [
            {
              file: 'src/webhooks/retry.ts',
              startLine: 44,
              endLine: 52,
              severity: 'WARNING',
              category: 'bug',
              title: 'Backoff has no ceiling',
              rationale:
                'The delay doubles without a cap, so attempt six waits over half an hour and the queue entry outlives its own visibility timeout.',
              suggestion: 'Clamp the delay to a maximum of five minutes.',
              confidence: 0.88,
            },
            {
              file: 'src/webhooks/queue.ts',
              startLine: 71,
              endLine: 78,
              severity: 'WARNING',
              category: 'perf',
              title: 'Retries are not spread across the poll window',
              rationale:
                'All failures from one batch requeue with the same base timestamp, so every retry lands in the same second and reproduces the original spike.',
              suggestion: 'Scatter the base timestamp across the poll interval.',
              confidence: 0.8,
            },
            {
              file: 'src/webhooks/retry.ts',
              startLine: 19,
              endLine: 19,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Jitter uses Math.random() directly',
              rationale:
                'Fine for jitter, but the call is inline and untestable, so the backoff sequence cannot be asserted.',
              suggestion: 'Inject the random source.',
              confidence: 0.6,
            },
            {
              file: 'src/webhooks/retry.ts',
              startLine: 88,
              endLine: 88,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Attempt limit is a magic 6',
              rationale: 'The literal 6 appears in the retry loop and again in the queue guard.',
              suggestion: 'Name it `MAX_DELIVERY_ATTEMPTS`.',
              confidence: 0.63,
            },
            {
              file: 'src/webhooks/queue.ts',
              startLine: 12,
              endLine: 12,
              severity: 'SUGGESTION',
              category: 'test',
              title: 'No test asserts the delay sequence',
              rationale:
                'Tests assert that a retry happens, never that the delays grow as intended, so a regression to a constant delay would pass.',
              suggestion: 'Assert the full sequence with a fake clock.',
              confidence: 0.72,
            },
            {
              file: 'src/webhooks/retry.ts',
              startLine: 103,
              endLine: 110,
              severity: 'SUGGESTION',
              category: 'bug',
              title: 'Dead-letter payload drops the original error',
              rationale:
                'When attempts are exhausted the entry is dead-lettered with a generic message, losing the last delivery failure.',
              suggestion: 'Persist the final error alongside the payload.',
              confidence: 0.69,
            },
          ],
        },
      },
    ],
  },
];
