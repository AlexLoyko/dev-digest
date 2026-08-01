# INSIGHTS — `@devdigest/api`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

## 2026-08-01 — `pnpm db:seed` cannot fix demo data an older seed already wrote

The seed is insert-only and gated on existence, so changing a fixture is a no-op on any
database that already has it. Worse, one gate covered four tables — `if (!anyRun)` sat
above runs, reviews, findings *and* traces — so a single pre-existing `agent_runs` row
made the whole block unreachable. There is no `db:reset`; the only escape was
`docker compose down -v`, which also destroys every repo the developer has imported.

This is structurally invisible to CI. `.github/workflows/e2e-web.yml` and every
`*.it.test.ts` seed an **empty** database, so the only state that can be wrong is the one
no suite ever constructs. The bug shipped with 137 green tests: reviews written by the
old seed had `run_id = NULL`, and the Agent-runs timeline attributes findings to a run
through exactly that column, so the badges silently vanished for every existing install
while the PR list (which joins on `pr_id`) kept working.

→ Repairing data an older seed wrote is a **migration's** job, not the seed's. `0012` is
a custom `drizzle-kit generate --custom` migration doing UPDATEs only; it targets
`model = 'seed' AND run_id IS NULL`, a fingerprint no real review can match because
`ReviewRunExecutor` creates the run before the review and always passes `runId`
(`modules/reviews/run-executor.ts:219-229`). It is a strict no-op on a fresh DB, since
migrations run before the seed and there are no rows to match yet.
→ Gate fixtures **individually** (per PR, then per run), not with one condition over
several tables, so a fixture added later still lands on an existing database
(`src/db/seed.ts`, `src/db/seed-prs.ts`).
→ Derive denormalized counters from their source rows in the seed rather than typing
them: the old fixture hand-wrote `findingsCount: 3` beside two findings, and once the UI
rendered both numbers on one line the disagreement became visible to users.
→ When a change alters data the seed already produced, prove it against a *reproduced*
legacy database — no suite will.

## 2026-07-31 — a `jsonb` column accepts any object, so `tsc` cannot guard a trace

Drizzle types a `jsonb` column's value as `unknown`, so an object literal written into
`run_traces.trace` type-checks no matter which fields it is missing. `RunTrace` requires
`memory_pulled` and `specs_read` (`vendor/shared/contracts/trace.ts:73-89`) and
`run-executor.ts` always writes `[]` for both — but a seed that omitted them passed
`pnpm typecheck` and `pnpm db:seed` without complaint.

`GET /runs/:id/trace` compounds it: the handler casts the stored jsonb straight to
`RunTrace` with no `.parse()` (`repository/run.repo.ts:183-186`), so the invalid document
travelled all the way to the browser. The symptom was a client crash —
`Cannot read properties of undefined (reading 'length')` in `TraceBody.tsx:37`, pointing
at the component rather than at the seed that produced the data.

→ Annotate any literal destined for a jsonb column with its contract type
(`const seedTrace: RunTrace = {…}`) so the compiler checks it at the write site.
(`src/db/seed.ts:265-300`)

## 2026-07-31 — `reviewer-core/node_modules` is a boot dependency of this API

The API imports `@devdigest/reviewer-core` as **raw TypeScript source** through a
tsconfig path alias (`tsconfig.json:22-25`), so reviewer-core's own dependencies must
be installed or the server dies at startup with `ERR_MODULE_NOT_FOUND` — even though
nothing in `server/package.json` mentions it. It uses **npm**, not pnpm.
→ `scripts/dev.sh` runs `npm ci` there when `node_modules` is absent (commit `66727c8`).

## 2026-07-31 — migrations are not applied on boot

`pnpm dev` starts the server without migrating. A fresh DB therefore serves
`relation ... does not exist` on the first request. Run `pnpm db:migrate` explicitly;
pgvector is enabled by migration `0000`, so a missed migration also shows up as
`vector` type errors.

## 2026-07-31 — the `cloneDir` default disagrees with the docs

`platform/config.ts:66-67` defaults `cloneDir` to `~/.devdigest/workspace`, but
`.env.example` ships `DEVDIGEST_CLONE_DIR=./clones` and the README env table calls
`./clones` the default. Both are "true" depending on whether a `.env` exists — and
`scripts/dev.sh` creates one from `.env.example` on first run, so in practice most
setups land on `./clones`. Check the resolved value before assuming where a clone is.

## 2026-07-31 — `instanceof z.ZodError` is unreliable here

Packages carry their own `zod`, so a `ZodError` thrown across a package boundary can
fail `instanceof` against this package's `zod`. The error handler therefore also
matches by shape (`name === 'ZodError'` plus an `issues`/`errors` array) —
`app.ts:135-142`. Any new code branching on a zod error must do the same.

## 2026-07-31 — boot reaps every `running` agent_run, assuming one API per DB

`buildApp()` awaits `reapStaleRuns()` before accepting requests, on the reasoning that
a fresh process has no in-flight runs of its own (`app.ts:70-82`). Correct for the
single-instance local studio; with two replicas against one database they would kill
each other's live runs. Revisit before any multi-instance deployment.

## 2026-07-31 — the global rate limit is off under `NODE_ENV=test`

`app.ts` skips registering `@fastify/rate-limit` in test so integration suites can
hammer endpoints via `inject()`. Per-route limits still apply. A test that means to
assert rate limiting has to register the plugin itself.

## 2026-07-31 — `db/schema.ts` declares every table, most of them unused

The schema is complete from day 1 (~36 tables: skills, eval, ci, memory, plugins,
digests, …) but the starter only writes to a fraction. **The existence of a table is
not evidence a feature is wired.** Same for several `vendor/shared/contracts/*`. Check
for an actual reader/writer before assuming.

## 2026-07-31 — two claims in `TESTING.md` are stale

- It says `server/package.json` is `skip-worktree`. No skip-worktree bit is set in this
  repo (`git ls-files -v | grep '^S'` is empty). CI still invokes the split with
  `pnpm exec vitest run …`, which is what actually matters.
- It says the typecheck job also runs on Windows as the `@ast-grep/napi` prebuilt gate.
  That matrix was dropped in `b7838c8` — both jobs in `server-unit.yml` are
  `runs-on: ubuntu-latest`, and the only remaining mention of Windows is the header
  comment explaining why it is deliberately excluded. There is no prebuilt gate;
  `@ast-grep/napi` is exact-pinned instead.

Related: `.gitignore:3-5` carves out `agent-runner/dist/` for a package that doesn't
exist in the starter — it arrives with the Export-to-CI lesson (L06).
