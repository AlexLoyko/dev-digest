# 0002 — Findings badges with a hover preview

Status: accepted
Lesson: L01
Packages: client, server

Server slice: [`server/specs/0002-findings-badges.md`](../../server/specs/0002-findings-badges.md).

## Intent

A review's findings are only visible one card at a time, on the PR detail page, inside the
REVIEW RUNS accordion. Two surfaces that should summarise them don't:

- The **PR list** shows a score ring and nothing else about the review. A 61 tells you
  something is wrong; it doesn't tell you whether it's a committed secret or a magic number.
- The **Agent-runs timeline** shows `2 finding(s) · 2 blockers` — a count with no shape.
  Two criticals and two style nits render identically.

This puts a compact severity breakdown on both, and a hover popup that previews the actual
findings, so a reviewer can triage from the list without opening a PR.

## Behaviour

**1 — PR list** (`/repos/[repoId]/pulls`). A **FINDINGS** column sits between SCORE and
STATUS, showing one badge per severity present — `⊙ 2  ⚠ 2  💡 1` — in the fixed order
CRITICAL → WARNING → SUGGESTION. A severity with no findings gets no badge. A PR with no
outstanding findings shows an empty cell, the way the SCORE cell shows `—` when unreviewed.

**2 — Agent runs timeline** (`/repos/[repoId]/pulls/[number]`, Agent runs tab). Each
settled run's `2 finding(s)` line becomes the same badges for **that run's** findings,
keeping the `· 2 blockers` suffix. A failed run shows its error and no badges. A run whose
review has been deleted keeps the existing text line, so nothing regresses.

**3 — The hover popup**, on both. Hovering the badges opens a floating panel, aligned to
the **left edge of the leftmost badge**, listing every finding behind those badges:
severity icon, title, category tag, `file:line`, confidence, and the first two lines of the
rationale. It is **read-only** — a panel that disappears on mouse-out is a hostile place
for accept or dismiss, which stay on the detail page. The cursor over the badges is `help`
(a question mark), since hovering is the affordance.

The popup scrolls when it outgrows its max height, and closes on a short delay so the
pointer can travel from badge into panel to scroll it. It closes on scroll and on resize.

## Acceptance

- [ ] Badges render in CRITICAL → WARNING → SUGGESTION order, one per severity **present**,
      each showing that severity's count.
- [ ] The PR list renders a FINDINGS header cell and one cell per row between SCORE and
      STATUS, with `GRID` widened to match so no column shifts.
- [ ] A PR with `findings: []` renders no badges and no popup trigger — not a zero, not an
      em dash.
- [ ] The popup is absent until hover, and lists every finding behind the badges, sorted
      CRITICAL first.
- [ ] The popup's left edge aligns with the left edge of the leftmost badge.
- [ ] The popup is **not clipped** by the PR-list card, which sets `overflow: hidden`
      (`pulls/styles.ts`) — so it is positioned `fixed` from the anchor's
      `getBoundingClientRect()`, not `absolute`.
- [ ] Hovering the **last** row flips the popup above the badges rather than off-screen.
- [ ] Clicking inside the popup does not navigate to the PR — PR rows navigate on click and
      the popup overlays sibling rows.
- [ ] Moving the pointer from the badges into the popup does not close it.
- [ ] The badges are focusable, and focus opens the popup / blur closes it.
- [ ] A settled timeline row renders badges plus `· 2 blockers`; a run with no matching
      review keeps the existing `N finding(s)` text.
- [ ] **Loading** — the PR list's skeleton rows still span the full grid with eight columns;
      no popup exists while loading.
- [ ] **Empty** — no findings anywhere ⇒ empty list cell, no badges on the timeline row.
- [ ] **Error** — a failed pulls query still renders the existing `ErrorState`; a
      `status: 'failed'` run shows its error and no badges.
- [ ] Every user-facing string comes from `messages/en/*.json`; none is inlined.

## Contracts

**Hooks — no changes.** Both surfaces already fetch what they need:

- `src/lib/hooks/core.ts` `usePulls` → `GET /repos/:id/pulls` (`PrMeta[]`) — reads the new
  `findings`. Typed by the contract, so widening the contract widens the hook.
- `src/lib/hooks/reviews.ts` `usePrReviews` → `GET /pulls/:id/reviews` (`ReviewRecord[]`) —
  already loaded by the detail page and already carrying `run_id` and full `findings[]`, so
  the timeline badges need **no server change at all**; they join on `run_id`.

No `src/lib/api.ts` change; no `fetch` outside the hooks.

**@devdigest/shared (`src/vendor/shared/`, this package's copy — mirror of the server's):**
`PrMeta.findings` as `z.array(Finding).nullish()` (list-only). This copy is known to lag the
server's ([`../INSIGHTS.md`](../INSIGHTS.md)) — apply the change to both.

**New component** `src/components/findings-badges/` — the cross-route shared-component
convention, alongside `run-cost-badge/` and `diff-viewer/`:

```
findings-badges/
  FindingsBadges.tsx      { findings, popoverLabel } — badges + hover trigger
  FindingsPopover.tsx     the floating panel
  FindingsBadges.test.tsx
  helpers.ts              countBySeverity, sortForDisplay, lineLabel
  constants.ts            SEVERITY_ORDER, POPOVER_WIDTH/MAX_HEIGHT, CLOSE_DELAY_MS
  styles.ts
  index.ts
```

It composes the kit rather than restyling it: `SeverityBadge` already renders exactly the
badge this needs (`<SeverityBadge severity count compact />` — icon + count, no label), and
the popup rows reuse `CategoryTag`, `MonoLink` and `ConfidenceNum`, the same atoms
`FindingCard` uses. No new severity colour map — `SEV` in `vendor/ui/primitives/tokens.ts`
stays the single source.

**New message keys** in `messages/en/prReview.json`:

- `list.columns.findings: "Findings"`
- `findings.popoverTitle: "{count} findings"`
- `findings.popoverTitleRun: "{count} findings in this run"`

**Touched:** `pulls/constants.ts` (`GRID`, `COLUMN_KEYS`), `PRRow/PRRow.tsx`,
`FindingsTab/FindingsTab.tsx`, `RunHistory/RunHistory.tsx`.

## Out of scope

- Accept / dismiss inside the popup, and any change to `FindingCard`'s expand-gated actions.
- Sorting or filtering the PR list by severity — L01's separate severity-filter lab.
- Findings badges anywhere else: the Files-changed tab, the compose-review flow, the agents
  screen.
- Touch devices — hover-only, matching every other hover affordance in the app.
- Deduping findings repeated across re-reviews.

## Verification

Colocated vitest + jsdom, `fetch` untouched — no API or DB (`pnpm test`):

- `src/components/findings-badges/FindingsBadges.test.tsx` — counts per severity, the
  CRITICAL-first order, the empty case rendering nothing, the popup absent until
  `mouseEnter` and then showing title / `file:line` / confidence / rationale, and closing on
  `mouseLeave`. (`@testing-library/user-event` is not installed — use `fireEvent`, as every
  other test here does.)
- `PRRow.test.tsx` — the `pr()` fixture factory gains `findings`; a row with findings renders
  badges, a row with `findings: []` renders none.
- `RunHistory.test.tsx` — the `run()` fixture factory pairs with a findings map; assert
  badges plus the blockers suffix, and the text fallback when a run has no matching review.

Plus e2e (`e2e/specs/`, agent-browser against seeded data, no model in the loop):
`02-repo-pulls-detail.flow.json` gains a `find text` step for the FINDINGS column header,
mirroring the existing `Cost` step; `04-pr-findings.flow.json`'s `2 findings` assertion
becomes `3 findings`, since the reworked seed gives the Security run three findings that
match its `findings_count`.
