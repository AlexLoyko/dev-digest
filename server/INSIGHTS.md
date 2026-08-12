# INSIGHTS — `@devdigest/api`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

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

## 2026-06-18 — register `POST /skills/import` BEFORE `GET /skills/:id`

Fastify matches in registration order, so with `/:id` first the literal segment `import`
is parsed as the UUID param and the request dies with a 422 that says nothing about
routing. Register the static path first (`modules/skills/routes.ts:60`). The same trap
applies to any future literal sibling of a param route.

## 2026-06-18 — skills reach the prompt without touching reviewer-core

`run-executor.ts` fetches `agentsRepo.linkedSkills(agent.id)`, filters to
`.skill.enabled`, and passes the bodies as `{ skills: skillBodies }` to
`reviewPullRequest()`. `assemblePrompt` in reviewer-core renders `## Skills / rules`
by itself when the array is non-empty — so wiring a new prompt slot from the server needs
no engine change, only the resolved strings.

## 2026-06-14 — `completeAgentRun`'s `values` shape is declared twice

The shape lives in the repo function (`repository/run.repo.ts`) AND in the interface
wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) to only one fails
typecheck — which is the good case; the bad case is reading one and editing the other.

## 2026-06-14 — PR-list aggregates are computed on read, never denormalized

`GET /repos/:id/pulls` derives every per-PR aggregate at request time with `inArray`
queries plus JS grouping — nothing is written back onto `pull_requests`. The two
aggregates use deliberately different windows: **cost** is `SUM(agent_runs.cost_usd)`
over EVERY run the PR has ever had (a review fans out across N agents, so a single run is
one agent's share), while **findings** are scoped to the latest review batch, approximated
by a 120 s window over `reviews.createdAt` because the schema has no batch id. Don't
"fix" the asymmetry by windowing cost too — the totals are the point. A pre-existing
`rollupSeverities` in `modules/pulls/status.ts` (lowercase keys) was built for a
counts-only variant and is currently unused. `modules/pulls/routes.ts`.

## 2026-06-14 — the PR list ships whole `Finding[]`, not counts

`PrMeta.findings` carries full `Finding` records mapped through
`reviews/helpers.ts#findingRowToDto`, so the client derives severity chips AND renders the
hover popover from one array — no second fetch, and chip↔popover can never disagree. This
is affordable only because the PR list is small/capped; revisit if that stops being true.

## 2026-06-14 — never hand-write migration SQL

Edit `db/schema/*.ts`, then `pnpm db:generate` (drizzle-kit) emits `00NN_*.sql`; apply
with `pnpm db:migrate`. Hand-writing the SQL desynchronizes `meta/*_snapshot.json`, which
is what drizzle-kit diffs against to generate the NEXT migration — the damage surfaces
one migration later, far from the cause.

## 2026-06-14 — adding a required Zod field breaks the inline trace fixture

`RunStats.cost_usd` and friends are asserted by an inline fixture in
`server/test/contracts.test.ts:160` (a `RunTrace` parse). Adding a required contract field
means updating that `stats: {…}` literal in the same change, or the suite fails somewhere
that looks unrelated to your diff.

## 2026-08-03 — never derive a user-facing URL from a clone's git remote

`SimpleGitClient.clone` writes the **authenticated** URL into `.git/config`, so
`git remote get-url origin` inside `<cloneDir>/<owner>/<repo>` returns
`https://x-access-token:github_pat_…@github.com/<owner>/<repo>`. Putting that in an `href`
publishes the PAT into the DOM and into any copied link. Build GitHub URLs from
`repos.full_name` only — which is what `githubBlobUrl`/`githubPrUrl` already expect.
`adapters/git/simple-git.ts:55-68`.

## 2026-08-03 — never pass a model-supplied path to `container.git.readFile` unguarded

It does a bare `join(clonePath, path)` with no containment check
(`adapters/git/simple-git.ts:129`), so an `evidence_path` of `../../../../etc/passwd`
escapes the clone and its contents get rendered in the UI. Guard in two layers — a pure
`isSafeRepoPath` (rejects `..` segments, posix/windows absolutes, NUL) **plus** a
`resolve()` prefix check against the clone root — and cap how many such reads one response
can trigger. `modules/conventions/verify.ts`.

## 2026-08-03 — asking a model for a bare `confidence` returns the ceiling

`confidence: z.number().min(0).max(1)` came back as exactly `1.0` for all 41 candidates
across three real scans (min 1, max 1, avg 1.0000). Four causes, none of them the model
being wrong: the question was leading (it rated a rule it proposed *because* it saw
consistency); the prompt's "report only patterns you can SEE repeated" pre-filtered output
to certainties; there were no anchors separating 0.7 from 0.9; and **the score was the last
field in the object** — JSON generates autoregressively, so it was written after an
assertive rule plus verbatim proof, where the top token is the max. Fix: emit evidence
counts (`occurrences_seen`, `counterexamples_seen`, `enforced_by_config`) BEFORE the score,
give named bands, reserve `1.0` for config-enforced rules, and explicitly invite
inconsistent rules. Same model, same `temperature: 0` → min 0.35 / max 0.95 / mean 0.61
across 8 distinct values. Raising temperature is NOT the fix — that adds noise, not
calibration, and costs reproducibility. `modules/conventions/service.ts`.

## 2026-08-03 — clamp a model's self-score to the counts it just reported, downward only

`enforced_by_config ? claimed : min(claimed, following / (following + counterexamples))`.
The model stays the scorer, but it can no longer contradict its own evidence (claiming 1.0
while admitting 3 counterexamples), and a harsh self-rating survives untouched because the
clamp never raises. Config-enforced rules are exempt — a lint rule holds repo-wide even
when the sampled files show exceptions. `modules/conventions/verify.ts` (`consistencyScore`).

## 2026-08-03 — `MockGitClient.readFile` returns `''` where the real client throws

`SimpleGitClient.readFile` throws ENOENT for a missing path; the mock returns an empty
string (`adapters/mocks.ts:294`). So any code treating "the read succeeded" as "the file
exists" behaves differently in tests than in production, and a hermetic test reports the
wrong reason — a missing file surfaces as "content didn't match". Don't add a `stat`; treat
empty/whitespace-only content as unresolvable, which is correct under both clients.

## 2026-08-03 — `IndexState.filesIndexed` is not a file count

It is a CUMULATIVE parse counter: `pipeline/incremental.ts:257` writes
`state.filesIndexed + filesIndexed`, so a file touched by three refreshes counts three
times and the total can exceed the repo's real size. It also counts files PARSED, not
walked — parse failures and unsupported languages are excluded (they land in `filesSkipped`)
yet still get a `file_rank` row. On a freshly-indexed repo the two agree, which is exactly
how the bug hides. For "how many files does this repo have for ranking purposes" use
`COUNT(*) FROM file_rank WHERE repo_id = ?` — the candidate set `getRankedPaths` orders —
exposed as `repoIntel.countRankedFiles()`.

## 2026-08-03 — a feature that mints a skill needs no endpoint of its own

`POST /skills` already accepts `name`/`description`/`type`/`source`/`body`/`enabled`, and
`SkillsService.create` forwards `source`, so `type:'convention'` + `source:'extracted'` work
today. Build a *draft* endpoint and let the client save through `POST /skills`. The one
field that never reaches the DB is `evidence_files` — the repository persists it but the
route and service never forward it, and nothing reads it beyond `toSkillDto`, so it is dead
weight rather than a gap worth plumbing. `modules/skills/routes.ts:15`, `service.ts:68`.

## 2026-08-03 — routes declare no response schema, so a module may return a superset

Routes here declare `params`/`body` schemas but NOT response schemas, so a module can return
more than a vendored contract without touching `vendor/shared/` (do-not-touch, hand-synced
in two copies). The conventions module adds `category` / `evidence_start_line` /
`evidence_end_line` on top of `ConventionCandidate` by mapping rows in its own `helpers.ts`
— no contract edit, no lock-step client sync.

## 2026-08-03 — `getConventionSamples` returns paths, and filters out configs

It is a one-line pass-through to `getTopFilesByRank`, so reading contents is the caller's
job via `container.git.readFile`. It returns `[]` whenever the repo is unindexed or
`REPO_INTEL_ENABLED=false` — handle "no samples" as a normal outcome, not an error. It also
drops configs (`isJunkPath` filters `eslint`/`prettier`/`.config.`), so config sampling has
to be done separately; root-only config discovery finds nothing in this multi-package repo
(no root `tsconfig.json` or eslint config). `modules/repo-intel/service.ts:630,713`.

## 2026-08-02 — `db:migrate` compares timestamps, not hashes — so branches silently skip

`pnpm db:migrate` applies only journal entries whose `when` is NEWER than the newest
`created_at` in `drizzle.__drizzle_migrations`. It does not diff by hash or tag. Working
several lesson branches against ONE local Postgres therefore skips migrations silently: a
branch migrated at a later wall-clock date raises the DB head above a sibling branch's older
`when`, and that branch's migrations never run — while `db:migrate` still prints
"✓ migrations applied". The symptom is a missing column at runtime, not a migration error.

The same rule bites when MERGING two branches that both added migrations: whichever `when`
sorts lower is dead on any DB already past it. This is why merging `lesson-2-lab/skills`
re-timed `0011_far_stryfe` to sort after main's `0010` (commit `8b6d79e`) — at its original
`when` the skills migration would never have applied on a DB at main's head. Diagnose by
comparing `meta/_journal.json` against `select created_at from drizzle.__drizzle_migrations`;
fix by applying the skipped `00NN_*.sql` by hand (they are additive `ALTER … ADD COLUMN`) or
`docker compose down -v` for a clean rebuild (drops all local data).

## 2026-08-02 — `ERR_MODULE_NOT_FOUND` after a branch switch means stale deps, not a bug

`scripts/dev.sh` installs deps ONLY when `node_modules` is absent (`install_if_needed`), so
a branch that adds a dependency starts against a stale tree: the API dies with
`Cannot find package 'fflate'` while the client still comes up fine on :3000 — easy to
misread as "the stack started". Fix: `cd server && pnpm install`.
