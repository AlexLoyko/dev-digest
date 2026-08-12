# 0003 — Smart Diff: the two-view "Files changed" tab

Status: accepted
Lesson: L03
Packages: client, server

Server slice: [`server/specs/0003-smart-diff.md`](../../server/specs/0003-smart-diff.md).

## Intent

The Files tab renders one flat list of `PrFile.patch` with no signal about which files
matter, and findings live in a different tab entirely — so the reviewer reads the code
in one place and the critique of that code in another, and has to hold the mapping in
their head.

This adds a **Smart order / Original order** toggle. Smart order groups the diff by
role, opens only the files that carry findings, marks the exact finding lines inline
with a severity chip, and makes each chip a link back to that finding in the Agent-runs
tab.

## Behaviour

### The toggle

The Files tab's section label becomes **"Reviewer-ordered diff"**, with a
`N files · +adds −dels` summary row and a right-aligned segmented control:
`Smart order` (default) | `Original order`.

`Original order` renders today's `DiffViewer` **unchanged** — flat file list, inline
GitHub comments, no decorations. It is the escape hatch when the grouping gets in the
way, and it deliberately stays boring.

Smart order falls back to `DiffViewer` while `GET /pulls/:id/smart-diff` is in flight or
when it returns no groups, so the tab never renders empty.

### Smart order

One section per role group, in the order the server sent them:

| Role | Label | Description |
|---|---|---|
| `core` | Core logic | The substance of the change — review closely |
| `wiring` | Wiring | Hooks the core into the app |
| `boilerplate` | Boilerplate | Generated / mechanical — skim |

Each section header carries a role-coloured dot, the label, the description, and a
right-aligned file count.

Each file is a collapsible card: chevron, path, a severity-coloured dot when the file
has findings, and `+adds −dels`. **A file is open by default iff it has findings** — so
opening the tab after a review shows exactly the code that was flagged, and nothing
else.

### Finding decoration

Decorations are **Smart order only**.

Severity comes from the client's existing `usePrReviews` data, joined to lines by
`file` + `start_line..end_line` — not from the server's `finding_lines`, which carries
no severity and no finding id. The server's array still drives the file dot and the
auto-open decision.

**A finding decorates only the lines in its cited range that actually changed.** Models
cite generously — a real `SUGGESTION 23-33` on an 11-line hunk covered `id: r.id,` and
`cloned: Boolean(…)`, saying nothing about either — so painting the whole range marks
code nobody flagged and the bar stops being a signal. A range that changed nothing falls
back to its `start_line`, so a finding about untouched context is still visible. Where
findings overlap, the bar takes the worst severity, so a blocker is never hidden under a
suggestion spanning it.

A decorated line gets a severity-coloured left edge bar and a right-aligned chip:

| `Severity` | Chip |
|---|---|
| `CRITICAL` | blocker |
| `WARNING` | warning |
| `SUGGESTION` | suggestion |

**One chip per anchor line** — not one per covered line, or a 1-to-196 finding stamps
196 chips.

A finding's anchor is **the first added line inside its range**, not its cited
`start_line`. Models routinely cite a whole method: `WARNING 135-142` on
`skills/repository.ts` starts at an untouched `.select()`, while the line that actually
changed is `.orderBy(asc(…))` on 138. Anchoring to the start puts the badge on code
nobody edited and leaves the edited line bare. When a finding's range covers no added
line at all, the anchor falls back to `start_line`. Deleted lines never anchor — they
have no new-side number, so there is no row to hang a chip on.

When several findings anchor to the same line (routine: multiple agents flag one
statement) they render as **one chip carrying the worst severity and nothing else** —
its tooltip lists every title. No count is shown: a number beside a severity label reads
as a count *of that severity*, and the findings on a line often differ, so a WARNING
plus a CRITICAL rendered as "blocker ×2" would assert two blockers. Nothing is hidden —
the click lands on the Agent-runs tab, which lists all of them.

**The chip is a button, not a label.** Clicking it navigates to
`?tab=findings&finding=<id>`, which the PR-detail page already understands: it forces
the findings tab, opens the run that owns the finding, scrolls to
`[data-finding-id]`, and expands the card. Both params must be written in **one**
`router.replace` — two sequential `setParam` calls race on a stale `search`.

Findings whose file is not in the diff, or whose `start_line` is null, decorate nothing
and are silently ignored.

### Split nudge

When `split_suggestion.too_big`, a banner renders above the sections using the existing
`smartDiff.largeTitle` / `largeBody` keys, listing the proposed split names and their
file counts.

### Links

A file card's path links to `githubBlobUrl(repoFullName, headSha, path)` — guarded on
truthiness of both, since an empty sha silently yields a `…/blob//path` 404
(`INSIGHTS.md`), and rendered as plain text rather than a dead `MonoLink` when they are
missing.

## Acceptance

- [ ] The Files tab shows a `Smart order` / `Original order` toggle, defaulting to
      Smart order.
- [ ] `Original order` renders the same `DiffViewer` output as before this change,
      inline comments included.
- [ ] Smart order renders one section per non-empty group with the right label,
      description, and file count.
- [ ] A file with `finding_lines` is expanded on first render; a file without is
      collapsed.
- [ ] A line in `finding_lines` shows a chip whose label matches the finding's
      severity.
- [ ] A finding citing `24-28` where only 25-27 changed decorates 25-27 and leaves the
      context lines 24 and 28 undecorated.
- [ ] That finding's chip lands on 25 — the first line it decorates, never a line the
      bar does not mark.
- [ ] A finding whose range contains no added line decorates (and anchors to) its cited
      `start_line`.
- [ ] Two findings anchoring to one line render ONE chip whose text is exactly the
      worse severity label — no count, no suffix.
- [ ] Clicking a chip calls the focus handler with that finding's id.
- [ ] The split banner appears only when `too_big` is true.
- [ ] While the query is loading, the plain `DiffViewer` renders — never an empty tab.

## Contracts

**No contract change.** `SmartDiff` is already re-exported from `src/lib/types.ts`; the
hook consumes `GET /pulls/:id/smart-diff` through `src/lib/api.ts` like every other
read. New i18n keys extend the existing `smartDiff` namespace in
`messages/en/prReview.json` (only `en` exists; a missing key renders the raw key
path — `INSIGHTS.md`).

## Out of scope

- The design's "✨ What this does:" per-file summary line and its `summary` badge. That
  is the contract's `pseudocode_summary`, which the server always returns as `null` —
  see the server slice's Out of scope.
- Decorations in `Original order`.
- Inline commenting inside Smart order — comments stay on the `Original order` view,
  which owns the `DiffCommentApi` wiring.
- Persisting the chosen view across navigations.

## Verification

Colocated `*.test.tsx` (vitest + jsdom, fetch mocked):
`SmartDiffViewer.test.tsx` covers sections, auto-open, chip severity, chip → focus
callback, and the split banner; `DiffTab.test.tsx` covers the toggle and the fallback.
