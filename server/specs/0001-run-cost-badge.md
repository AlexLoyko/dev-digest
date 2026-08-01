# 0001 — Run cost: persist it and serve it

Status: accepted
Lesson: L01
Packages: server

Client slice: [`client/specs/0001-run-cost-badge.md`](../../client/specs/0001-run-cost-badge.md).

## Intent

Every review run already knows what it cost. `reviewer-core` requests usage from
OpenRouter (`usage: { include: true }`), accumulates the provider's real `usage.cost`
across repair attempts, falls back to the `PriceBook` estimate when the provider doesn't
report one, and returns `costUsd` on `ReviewOutcome`. The server then drops it on the
floor: `run-executor.ts` destructures `{ tokensIn, tokensOut, grounding }` and ignores
`outcome.costUsd`.

Nobody running reviews locally can answer "what did this PR cost me". The number exists,
travels the whole pipeline, and dies one line before the database. This spec re-attaches
it — **zero additional model calls**, one column, one field on three contracts.

Cost was removed deliberately in `d45ab0d` (column, contracts, UI) so that L01 could put
it back as the lesson's hands-on lab. This is that work.

## Behaviour

- A completed run stores the USD cost it incurred alongside its token counts.
- `GET /pulls/:id/runs` returns `cost_usd` on every run summary, so the PR-detail
  timeline can show `9,119 tok · $0.0013` per run.
- `GET /runs/:id/trace` returns `cost_usd` in `stats`, so the run-trace drawer can show a
  COST tile beside DURATION and TOKENS.
- `GET /repos/:id/pulls` returns `total_cost_usd` per PR — the sum of `cost_usd` across
  **every** run on that PR — so the PR list can carry a COST column. A review fans out
  across N agents (N run rows), so any single run is only one agent's share.

  It is a lifetime total, not "the most recent review round". Isolating a round would
  need a batch identifier stamped on the N runs of one invocation; none exists
  (`multi_agent_runs` is declared but never read or written, `agent_runs` carries no SHA
  or group column, and the runs' `ran_at` differ by milliseconds since each INSERT is its
  own transaction).
- A run that never reached a model (no diff, cancelled, failed before the first call) and
  a model the price book doesn't know both store `null`. `null` means "no cost data",
  which the client renders as an em dash — it never means zero.
- The sum is unfiltered by status. Failed, cancelled, and in-flight runs store `null`
  and SQL `SUM` skips nulls, so they contribute nothing without being excluded — and a
  PR whose only runs failed still totals `null`, never `0`.

## Acceptance

- [ ] `agent_runs.cost_usd` exists (`double precision`, nullable) via a `drizzle-kit
      generate` migration; `0009` is left untouched.
- [ ] A run completed through `ReviewRunExecutor` persists `outcome.costUsd` verbatim —
      the provider's `usage.cost` when reported, the `PriceBook` estimate otherwise.
- [ ] The three non-model paths (no diff, cancelled, pre-call failure) persist
      `cost_usd = null`, not `0`.
- [ ] `GET /pulls/:id/runs` includes `cost_usd` on every element and it round-trips the
      stored value.
- [ ] `GET /runs/:id/trace` includes `stats.cost_usd`.
- [ ] `GET /repos/:id/pulls` includes `total_cost_usd`; for a PR with runs
      `[done $0.0031, done $0.0033, done $0.0242, failed]` it returns `0.0306` — equal to
      no single run — and for a PR with no priced run it returns `null`, not `0`.
- [ ] `RunStats` and `RunSummary` parse payloads carrying `cost_usd`, and `PrMeta` parses
      `total_cost_usd`, in **both** vendored copies.
- [ ] `pnpm db:seed` inserts completed, priced runs for the demo PR plus one failed
      unpriced run, and stays idempotent across repeated invocations.
- [ ] No new outbound model call is introduced anywhere in the path.

## Contracts

**@devdigest/shared — apply to BOTH `server/src/vendor/shared/` and
`client/src/vendor/shared/`** (independent copies; the server's is the de-facto source
since `reviewer-core` aliases it):

- `contracts/trace.ts` — `RunStats` gains `cost_usd: z.number().nullable()`
- `contracts/trace.ts` — `RunSummary` gains `cost_usd: z.number().nullable()`
- `contracts/platform.ts` — `PrMeta` gains `total_cost_usd: z.number().nullish()`
  (list-only, so `nullish()` — `PrDetail` extends `PrMeta` without setting it)

**DB:** `agent_runs.cost_usd double precision` — a new `0010_*` migration from
`pnpm db:generate`, with its `meta/0010_snapshot.json` and `_journal.json` entry
committed. Not applied on boot; `pnpm db:migrate` is explicit.

**Routes:** no new routes and no signature changes. Three existing responses gain a
field — `GET /repos/:id/pulls`, `GET /pulls/:id/runs`, `GET /runs/:id/trace`.

**Internal:** `completeAgentRun`'s value object and `ReviewRepository`'s delegating
signature regain `costUsd: number | null`.

`reviewer-core` is **not modified** — it already returns `costUsd` on `ReviewOutcome`.

## Out of scope

- Workspace-level or per-agent cost aggregates (`AgentStats.total_cost_usd` and friends
  already exist as unwired contracts; leave them unwired).
- Cost budgets, caps, or warnings.
- Backfilling cost for runs that predate the column — they stay `null`.
- Any change to `eval_runs.cost_usd` / `ci_runs.cost_usd`, which are a separate lineage.
- The static price table and `PriceBook` themselves, which were kept by `d45ab0d` and
  need no change.

## Verification

- **Unit** (`pnpm exec vitest run --exclude '**/*.it.test.ts'`) — `test/contracts.test.ts`
  parses a `RunTrace` fixture whose `stats` carries `cost_usd`.
- **Integration** (`pnpm exec vitest run .it.test`) — extend `test/reviews.it.test.ts`:
  drive a run to completion against a real Postgres with `MockLLMProvider`, then assert
  `cost_usd` on the stored row, on `GET /pulls/:id/runs`, and `total_cost_usd` on
  `GET /repos/:id/pulls` — including a multi-agent PR whose total equals no single run,
  and the `null` case for a PR with no priced run.
- Touching `server/src/vendor/shared/**` also fires the `reviewer-core` workflow — its
  `paths:` filter includes that directory. Expect it green with no engine changes.
