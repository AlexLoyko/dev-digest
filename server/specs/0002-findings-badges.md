# 0002 — Findings on the PR list: serve them per PR

Status: accepted
Lesson: L01
Packages: server

Client slice: [`client/specs/0002-findings-badges.md`](../../client/specs/0002-findings-badges.md).

## Intent

Findings are the product. They are stored properly — a first-class `findings` table, one
row per finding, with severity, category, title, file, line range, confidence, and a
markdown rationale — and they are reachable from exactly one place: `GET /pulls/:id/reviews`,
which the PR **detail** page calls.

The PR list therefore cannot say anything about what a review found. `routes.ts` says so
deliberately:

> `// (The per-severity FINDINGS breakdown is intentionally not surfaced on the list —`
> `// findings live on the PR detail page.)`

That was the right call when the list had no room for them. It stops being right once the
list is the triage surface: deciding which of seven PRs to open is exactly the moment you
want to know that one has two criticals and another has a style nit. This spec reverses
that comment and serves each PR's findings on the list endpoint.

The client renders them as severity badges with a hover preview, so it needs the findings
themselves, not just counts — the preview shows title, `file:line`, confidence and
rationale without a second request.

## Behaviour

- `GET /repos/:id/pulls` returns `findings` per PR: every finding from **every** review on
  that PR, minus the ones the user dismissed.
- **Dismissed findings are excluded.** Dismissing is the one signal that a finding is not
  worth carrying, so the list count reads as "still outstanding" and dismissing a finding
  visibly drops the badge. Accepted findings still count — accepting means the issue is
  real, not that it is gone.
- **Lifetime, not latest.** A review fans out across N agents into N `reviews` rows
  (`kind = 'review'`), so serving only the newest would show one agent's findings and hide
  the rest. Same reasoning as `total_cost_usd` in
  [`0001-run-cost-badge.md`](0001-run-cost-badge.md). Re-reviewing therefore accumulates
  findings; nothing correlates a finding across runs, so nothing dedupes them.
- A PR that has never been reviewed, and a PR whose every finding is dismissed, both return
  `[]`. **Never `null`.** Unlike cost, absence here is not "no data" — both PRs genuinely
  have zero outstanding findings, and both render no badges.
- `reviews.kind = 'summary'` rows are excluded; only `'review'` rows carry findings.

The seed is reworked so these surfaces have data before the first real review, and so the
demo stops contradicting itself: today's single seeded `reviews` row sets no `run_id` and
no `agent_id`, and its two findings disagree with the seeded runs' `findings_count` of 3
and 2. The timeline badges join findings to a run through `reviews.run_id`, which makes
that inconsistency visible, so it gets fixed here rather than papered over.

## Acceptance

- [ ] `GET /repos/:id/pulls` includes `findings` on every element.
- [ ] For a PR with two `kind='review'` rows (one per agent), the array contains the
      findings of **both**, not just the newest review's.
- [ ] A finding with `dismissed_at` set is absent from the array; setting it via
      `POST /findings/:id/dismiss` removes it from the next list response.
- [ ] A finding with `accepted_at` set is still present.
- [ ] A PR with no reviews returns `findings: []`, not `null` and not absent.
- [ ] `reviews` rows with `kind='summary'` contribute nothing.
- [ ] Each element matches the existing `Finding` contract and is produced by the existing
      `findingRowToDto` — no second row→DTO mapper is introduced.
- [ ] `PrMeta` parses a payload carrying `findings` in **both** vendored copies, and
      `PrDetail` still parses without it.
- [ ] `findings.review_id` is indexed, via a generated migration; `0010` is untouched.
- [ ] `pnpm db:seed` produces one `reviews` row per completed run on PR #482, each with
      `run_id` and `agent_id` set, whose findings match that run's `findings_count` and
      `blockers`; repeated invocations stay idempotent.
- [ ] No new route, and no new outbound model call.

## Contracts

**@devdigest/shared — apply to BOTH `server/src/vendor/shared/` and
`client/src/vendor/shared/`** (independent copies; the server's is the de-facto source
since `reviewer-core` aliases it):

- `contracts/platform.ts` — `PrMeta` gains `findings: z.array(Finding).nullish()`, importing
  `Finding` from `./findings.js` the way `observability.ts` imports `Severity`.

  `Finding`, not `FindingRecord`: dismissed rows are filtered server-side and the list
  surfaces no accept/dismiss state, so the base contract suffices and `platform.ts` avoids
  a dependency on `review-api.ts`. `findings.ts` imports only zod, so no cycle.

  `nullish()` for the same reason `total_cost_usd` uses it — `PrDetail` extends `PrMeta`
  (`platform.ts:204`) and `GET /pulls/:id` does not set the field.

**DB:** no new column. One index on `findings(review_id)` — the table has only the cascade
FK today, and the list now joins through it on every load while `usePulls` refetches every
60s. Generated with `pnpm db:generate` as `0011_*`, with its `meta/0011_snapshot.json` and
`_journal.json` entry committed. Not applied on boot; `pnpm db:migrate` is explicit.

**Routes:** no new routes, no signature changes. One existing response gains a field —
`GET /repos/:id/pulls`.

**Internal:** `ReviewRepository` gains `findingsForPulls(prIds): Promise<Map<string, Finding[]>>`,
delegating to `review.repo.ts`. The pulls module reaches it through `container.reviewRepo`,
never by importing the reviews module's folder.

`reviewer-core` is **not modified**.

## Out of scope

- Per-severity counters denormalized onto `agent_runs` — the counts derive from `findings`.
- Deduping findings repeated across re-reviews; nothing correlates them between runs.
- Sorting or filtering the list by severity (L01's separate severity-filter lab).
- Capping how many findings one PR contributes to the payload.
- Any change to the finding action routes or to `GET /pulls/:id/reviews`.
- Backfilling `reviews.run_id` for rows that predate the seed rework.

## Follow-up — repairing databases seeded before this spec

Shipping the above left every **already-seeded** install showing no badges on the
Agent-runs timeline, while the PR list showed them. The two surfaces join differently:
the list on `reviews.pr_id`, the timeline on `reviews.run_id`. The pre-0002 seed wrote a
single review with `run_id` and `agent_id` both NULL, so nothing could attach to a run.

`pnpm db:seed` could not fix it — runs, reviews, findings and traces all sat behind one
`if (!anyRun)` gate, false on any seeded DB — and there is no reset command. CI never saw
it because it always seeds an empty database.

Two changes:

- **`0012_relink_demo_review.sql`** — a custom (hand-written) data migration that attaches
  the orphan to the newest completed run on its PR and realigns that run's
  `findings_count` / `blockers` / `score` with the review it now owns. `UPDATE` only:
  nothing is deleted, and both statements are strict no-ops on a fresh database, where no
  `agent_runs` rows exist when migrations run. `model = 'seed' AND run_id IS NULL` targets
  exactly what the old seed wrote — `ReviewRunExecutor` creates the run *before* the
  review and always passes `runId`, so no real review can match.

  Known limitation: a legacy DB has one review and two completed runs, so the second run
  keeps its plain count line. `UPDATE` cannot invent the missing review, and inventing one
  was judged worse than leaving it.

- **Per-fixture seed guards** — `seed.ts` now loops `SEED_PRS` (`./seed-prs.ts`) with a
  guard per PR and per PR's runs, so a fixture added later lands on an existing database.
  A run's `findings_count` / `blockers` / `score` are **derived from its review's
  findings**, never written by hand: hand-maintained counters drifting from the findings
  are what produced the contradiction this feature made visible.

## Verification

- **Unit** (`pnpm exec vitest run --exclude '**/*.it.test.ts'`) — `test/contracts.test.ts`
  parses a `PrMeta` fixture carrying `findings`, and a `PrDetail` fixture without it.
- **Integration** (`pnpm exec vitest run .it.test`) — against a real Postgres: seed a PR
  with two `kind='review'` rows from different agents and assert `GET /repos/:id/pulls`
  returns the union; dismiss one finding and assert it disappears; assert a PR with no
  reviews returns `[]`; and assert a `run_id IS NULL` review still serves its findings on
  the list, so old data degrades rather than breaks.
- **The 0012 repair** cannot be covered by the suites, which only ever see a fresh DB.
  Prove it by reproducing the legacy shape on a scratch database (one `model='seed'`
  review with `run_id IS NULL` plus run-less runs), applying the migration, and asserting
  the review is relinked **and still present**, the counters agree, re-applying changes
  nothing, and a fresh DB reports `UPDATE 0`.
- Touching `server/src/vendor/shared/**` also fires the `reviewer-core` workflow — its
  `paths:` filter includes that directory. Expect it green with no engine changes.
