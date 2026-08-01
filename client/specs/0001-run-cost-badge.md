# 0001 — Run cost badge on three surfaces

Status: accepted
Lesson: L01
Packages: client, server

Server slice: [`server/specs/0001-run-cost-badge.md`](../../server/specs/0001-run-cost-badge.md).

## Intent

Running reviews locally spends real money, and the studio currently shows none of it. The
number is available on every completed run once the server slice lands; this spec puts it
in front of the user at the three moments they'd ask "what did that cost" — scanning the
PR list, reading a PR's run history, and inspecting a single run.

Cost is deliberately absent today (`d45ab0d` removed the COST stat and `formatCost`,
`58c6ac7` stripped the `tok · $cost` line off the timeline) because L01 is where it comes
back.

## Behaviour

**1 — PR list** (`/repos/[repoId]/pulls`). A **COST** column sits between STATUS and
UPDATED, showing the **total** spent on that PR across every run, e.g. `$0.031`. A review
fans out across N agents, so showing any single run would report one agent's share as the
PR's cost. A PR that has never been reviewed, or whose runs all failed, shows `—`.

The total is cumulative over the PR's lifetime, not "the most recent review round" —
isolating a round would need a batch identifier on the N runs of one invocation, and none
exists (see `server/specs/0001-run-cost-badge.md`). Re-reviewing therefore increases the
number.

**2 — Agent runs timeline** (`/repos/[repoId]/pulls/[number]`, Agent runs tab). Each
settled run row regains its usage line under the timestamp: `9,119 tok · $0.0013`. A run
with no tokens shows no line; a run with tokens but no price shows the token count and
`—`. The failed run row keeps showing its error and no usage line.

**3 — Run trace drawer** (same route, trace icon on a run row). The Stats section grows a
fourth tile, **COST**, between TOKENS and FINDINGS, e.g. `$0.062`.

**Formatting is identical on all three** and adapts to magnitude, because a run can cost
a tenth of a cent or several dollars and a fixed 2-decimal format would render both as
`$0.00` and `$1.24`:

| Value | Renders |
|---|---|
| `0.0013` | `$0.0013` |
| `0.014` | `$0.014` |
| `1.238` | `$1.24` |
| `null` | `—` |

## Acceptance

- [ ] `formatCost` returns 4 decimals below `$0.01`, 3 below `$1`, 2 at or above `$1`,
      and an em dash for `null`/`undefined` — it never returns `$0.00`.
- [ ] The PR list renders a COST header cell and one cost cell per row, positioned
      between STATUS and UPDATED, with the grid template widened to match so no column
      shifts.
- [ ] A PR with `total_cost_usd: null` renders `—` in that cell, not a blank and not
      `$0.00`.
- [ ] A PR with three completed runs renders their sum, not any one of them.
- [ ] A settled timeline row with tokens renders `9,119 tok · $0.0013`, thousands
      separator included.
- [ ] A timeline row with `tokens_in + tokens_out === 0` renders no usage line at all.
- [ ] The trace drawer's Stats section renders four tiles, COST among them, with no
      layout override — `s.statsRow` is flex and `s.stat` is `flex: 1`.
- [ ] **Loading** — the PR list's existing skeleton rows already span the full grid and
      must still do so with seven columns; the drawer shows its existing
      `loadingTrace` state, no cost tile.
- [ ] **Empty** — no completed runs anywhere ⇒ `—` in the list cell, no usage line in the
      timeline. The drawer's existing `tracePending` / `noTrace` states are unchanged.
- [ ] **Error** — a failed pulls query still renders the existing `ErrorState`; a run with
      `status: 'failed'` shows its error text and no cost.
- [ ] Every user-facing string comes from `messages/en/*.json`; none is inlined.

## Contracts

**Hooks — no changes.** All three surfaces already fetch what they need; the fields
simply start being populated:

- `src/lib/hooks/core.ts` → `GET /repos/:id/pulls` (`PrMeta[]`) — reads the new
  `total_cost_usd`
- `src/lib/hooks/reviews.ts` `usePrRuns` → `GET /pulls/:id/runs` (`RunSummary[]`) — reads
  the new `cost_usd`
- `src/lib/hooks/trace.ts` `useRunTrace` → `GET /runs/:id/trace` (`RunTrace`) — reads the
  new `stats.cost_usd`

No `src/lib/api.ts` change; no `fetch` outside the hooks.

**@devdigest/shared (`src/vendor/shared/`, this package's copy — mirror of the server's):**
`RunStats.cost_usd` and `RunSummary.cost_usd` as `z.number().nullable()`, and
`PrMeta.total_cost_usd` as `z.number().nullish()` (list-only). This copy is known to lag the server's
([`../INSIGHTS.md`](../INSIGHTS.md)) — apply the change to both.

**New component** `src/components/run-cost-badge/` — the cross-route shared-component
convention, alongside `diff-viewer/` and `app-shell/`:

```
run-cost-badge/
  RunCostBadge.tsx       { costUsd, variant: "cell" | "inline" }
  RunCostBadge.test.tsx
  helpers.ts             formatCost
  styles.ts
  index.ts
```

`cell` is the PR-list column; `inline` is the mono, muted, 11px timeline variant. The
trace drawer does **not** use the component — it feeds `formatCost` into the existing
`Stat` atom (`RunTraceDrawer/_components/atoms.tsx`).

**New message keys:**

- `messages/en/prReview.json` → `list.columns.cost: "Cost"`
- `messages/en/runs.json` → `trace.stat.cost: "COST"` (restores the key `d45ab0d` removed)

**Touched:** `pulls/constants.ts` (`GRID`, `COLUMN_KEYS`), `PRRow/PRRow.tsx`,
`RunHistory/RunHistory.tsx`, `RunTraceDrawer/_components/TraceBody/TraceBody.tsx`.

## Out of scope

- Per-review-round cost ("what did the last review cost"), which needs a batch
  identifier that does not exist in the schema.
- Sorting or filtering the PR list by cost.
- Cost anywhere else: the Files-changed tab, the compose-review flow, the agents screen,
  or the unbuilt `agentPerformance` aggregates.
- Cost budgets, caps, or warning thresholds.
- Currency other than USD, and any locale-aware currency formatting.

## Verification

Colocated vitest + jsdom, `fetch` mocked — no API or DB (`pnpm test`):

- `src/components/run-cost-badge/RunCostBadge.test.tsx` — the four formatter branches,
  the `null → —` case, and both variants rendering.
- `PRRow.test.tsx` — a row with a cost and a row with `null` render `$0.014` and `—`
  respectively.
- `RunHistory.test.tsx` — the `run()` fixture factory regains `cost_usd`; assert the
  usage line appears for a settled run and is absent at zero tokens.
- `RunTraceDrawer.test.tsx` — the `TRACE` fixture's `stats` regains `cost_usd`; assert the
  COST tile renders.

Plus one e2e assertion in `e2e/specs/02-repo-pulls-detail.flow.json` — a `find text` step
for the seeded cost in the PR list, proving the value survives the real server round-trip
against seeded data with no LLM in the loop.
