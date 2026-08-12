# 0002 — PR Intent Layer: the Overview "PR BRIEF" surface

Status: accepted
Lesson: L03
Packages: client, server

Server slice: [`server/specs/0002-pr-intent-layer.md`](../../server/specs/0002-pr-intent-layer.md).
reviewer-core slice: [`reviewer-core/specs/0001-pr-intent-layer.md`](../../reviewer-core/specs/0001-pr-intent-layer.md).

## Intent

A reviewer opening a PR has no compact summary of what it's trying to do or how
confident the system is that it correctly read the author's intent. This surfaces the
server's derived intent (`GET /pulls/:id/intent`) at the top of the PR detail page's
Overview tab, with a confidence signal that is visible both where intent is shown and
— when weak — where findings are read, since a low-confidence read is exactly the
moment a reader should double-check the reviewer's framing themselves.

## Behaviour

### Route

`client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — the PR detail page. Intent
appears on the **Overview** tab only, plus a confidence pill on the **Findings** tab
when confidence is not `high`, plus a block in the **Run Trace** drawer for any run
that had an intent slot.

### `PR BRIEF` grid — top of the Overview tab

`OverviewTab.tsx` (`_components/OverviewTab/OverviewTab.tsx:14-38`) renders a
`SectionLabel icon="FileText"` reading `PR BRIEF`, then a grid
(`_components/OverviewTab/styles.ts:5-9`,
`gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))'`) containing the
`IntentCard`, with the existing Description section unchanged below it.

`auto-fit`, not `auto-fill`: inline style objects can't carry media queries, so
`auto-fit`/`minmax` is the only way this grid collapses to one column on a narrow
viewport. With exactly one child (`IntentCard`, today), `auto-fit` collapses the empty
track so the card fills the available width; `auto-fill` would instead leave a visible
empty gap. When L04 adds a Blast Radius card as the grid's second child, the two
columns appear automatically — zero changes needed to this file for that lesson.

**`VerdictBanner` is deliberately not part of this change and was not touched.**
Verified in source: `VerdictBanner` has exactly one call site,
`_components/ReviewRunAccordion/ReviewRunAccordion.tsx:149`, inside the **Findings**
tab, per review run — not on Overview. (An earlier mockup showed it on Overview; the
shipped code does not put it there, and this spec does not move it.)

`page.tsx` passes `prId` into `OverviewTab` (`page.tsx:145`,
`<OverviewTab prId={prId} prBody={pr.body} />`).

### `IntentCard`

`_components/IntentCard/IntentCard.tsx` — `useTranslations("prReview")` +
`usePrIntent(prId)`. Header is `SectionLabel icon="Target"` reading `t("intent.card.title")`
("INTENT"), with the `IntentConfidencePill` in the label's built-in `right` slot when
data has loaded (`IntentCard.tsx:22-29`).

Body states:
- **Loading** → `Skeleton` placeholders (`IntentCard.tsx:31-35`).
- **Loaded** → the summary as an italic quoted sentence (`“{data.intent}”`), then a
  two-column `IN SCOPE` / `OUT OF SCOPE` row using the same `auto-fit` grid trick —
  `IN SCOPE` items marked with `Icon.CheckCircle` colored `var(--ok)`, `OUT OF SCOPE`
  items marked with `Icon.XCircle` colored `var(--text-muted)` with dimmer body text
  (`IntentCard.tsx:39-66`, `styles.ts`).
- **No intent yet (404)** → `usePrIntent` resolves `data: undefined` and the card
  renders `EmptyState icon="Info" title={t("intent.card.emptyState")}`
  ("Intent is derived automatically on the next review.") — **not hidden**
  (`IntentCard.tsx:68-70`). Hiding the card would collapse the `auto-fit` grid track
  and, once L04 ships, strand the Blast Radius card alone in what should be a
  two-column row.
- No action button in any state — classification is automatic only (see Out of scope).

### `usePrIntent` hook

`client/src/lib/hooks/intent.ts` — `useQuery({ queryKey: ["pr-intent", prId], queryFn:
() => api.get<PrIntentRecord>(\`/pulls/${prId}/intent\`), enabled: !!prId, retry: false
})`. `retry: false` is deliberate: a 404 here means "not classified yet," a normal
steady state, not a transient failure — retrying it three times would just delay the
empty state settling. `page.tsx` invalidates `["pr-intent", prId]` when a run
completes (`page.tsx:59-62`, wired at `page.tsx:170`) so the card refreshes without a
manual reload once a review's intent classification finishes.

### `IntentConfidencePill`

`_components/IntentConfidencePill/` — one component, two call sites (`IntentCard`
header and the Findings tab's "Review runs" label), so they can never render
differently for the same record. Renders `Badge` (not `Chip`, which is a `<button>`
and this isn't interactive) with per-band color/icon from `CONFIDENCE_META`
(`constants.ts:8-15`):

| Band | Color / bg | Icon |
|---|---|---|
| `high` | `var(--ok)` / `var(--ok-bg)` | `CheckCircle` |
| `medium` | `var(--warn)` / `var(--warn-bg)` | `Info` |
| `low` | `var(--warn)` / `var(--warn-bg)` | `AlertTriangle` |

`medium` and `low` share the same amber tone but **must differ by icon** — the kit's
own rule is "WCAG AA: never color alone" (`@devdigest/ui`'s `Badge` primitive), and two
amber badges distinguished only by tone are unreadable to a colour-blind reader.

There is no `Tooltip` primitive in the vendored kit; the house idiom is the native
`title` attribute (as in `RunReviewDropdown.tsx`). `IntentConfidencePill` wraps the
`Badge` in a `<span title={tooltip}>` (`IntentConfidencePill.tsx:41-46`) composed from
which source kinds resolved vs. did not (`helpers.ts`'s `resolvedKinds`/
`unresolvedKinds`, deduped by kind since a record can carry several `doc` sources) plus
a fixed closing sentence: *"Confidence is computed from which sources resolved, not
self-reported by the model."* (`messages/en/prReview.json`'s
`intent.pill.tooltipNote`).

### Findings-list badge

`FindingsTab.tsx` calls `usePrIntent(prId)` and shows the pill in the "Review runs"
`SectionLabel`'s `right` slot **only when `intent != null && intent.confidence !==
"high"`** (`FindingsTab.tsx:56-57,183-185`). The surface's job is to make a *weak*
intent visible while reading findings; a `high` pill there would be noise the reader
doesn't need to act on.

### Run Trace

`RunTraceDrawer/constants.ts` adds `PROMPT_COLORS.intent: "var(--accent-text)"`
(`constants.ts:21-22`). `TraceBody.tsx` conditionally renders a `PromptBlock` when
`trace.prompt_assembly.intent != null`, labeled via the `trace.prompt.intent`
translation key (`TraceBody.tsx:91-92`) — so a completed run's trace shows exactly the
advisory block that was sent to the model, or nothing when the slot was omitted.

### Settings — verified, not changed

`client/src/lib/feature-models.ts` already listed `review_intent` in its registry
before this spec, so the Settings model picker already rendered a "PR Review · Intent"
row. This spec did not add that row; it only relies on `resolveFeatureModel` picking
up the registry's default (`openrouter` / `deepseek/deepseek-v4-flash`, matching the
server contract). `feature-models.ts` is deliberately not imported from
`src/vendor/shared` (webpack resolution), so it is a hand-mirrored copy that must stay
in sync with `contracts/platform.ts` if the default ever changes.

## Acceptance

- [ ] `IntentCard` renders type/summary/in-scope/out-of-scope + the confidence pill
      once `usePrIntent` resolves data.
- [ ] Loading state shows `Skeleton`; empty state (404) shows an `EmptyState`, never
      hides the card.
- [ ] `IntentConfidencePill` uses a **different icon** per band, not tone alone.
- [ ] Findings-tab badge is absent when confidence is `high`, present otherwise.
- [ ] `OverviewTab`'s brief grid uses `auto-fit` (verified in `styles.ts`, not
      `auto-fill`); `VerdictBanner` is unchanged and still only renders inside
      `ReviewRunAccordion`.
- [ ] `page.tsx` passes `prId` into `OverviewTab` and invalidates `["pr-intent",
      prId]` when a run completes.
- [ ] Run Trace shows an intent block only when `trace.prompt_assembly.intent` is
      non-null.
- [ ] All display strings for this feature are in `client/messages/en/prReview.json`
      under the `intent` key — none inline in a component.

## Contracts

**Hooks:** `usePrIntent(prId)` in `src/lib/hooks/intent.ts`, calling
`GET /pulls/:id/intent` (returns `PrIntentRecord`, 404 when unclassified) via
`api.get`. Re-exported through `src/lib/hooks/index.ts`.

**@devdigest/shared types consumed** (`client/src/vendor/shared/` — the client's
independent copy): `PrIntentRecord`, `PrIntent`, `IntentType`, `IntentConfidence`,
`IntentSource`, `IntentSourceKind` from `contracts/review-api.ts` — the bare `Intent`
triple in `contracts/brief.ts` is untouched by this feature;
`PromptAssembly.intent` from `contracts/trace.ts` (consumed by `TraceBody`).

**New `messages/en/*.json` keys** — all under `prReview.intent` in
`messages/en/prReview.json`: `intent.brief.title`, `intent.card.{title,inScope,
outOfScope,emptyState}`, `intent.pill.confidence.{high,medium,low}`,
`intent.pill.{tooltipResolved,tooltipUnresolved,tooltipNote}`,
`intent.pill.source.{pr_title,pr_body,linked_issue,doc,diff}`. Plus
`trace.prompt.intent` (Run Trace label) in the trace-drawer's message namespace.

## Out of scope

- **RISK AREAS** (the mockup's chip row) — deferred to L05; belongs to the existing
  `Risks` contract, not this card.
- **BLAST RADIUS** — L04; the reserved second track of the `PR BRIEF` `auto-fit` grid.
  This spec ships the grid ready for it but does not add the card.
- **A manual re-derive button or route.** Classification is automatic only — the
  `IntentCard` has no action in any state, by explicit product decision (mirroring the
  server spec's "no POST" contract). A reader who wants a fresh classification pushes
  a new commit.
- **Intent history in the UI.** The card shows the current cached record only; there
  is no way to see a PR's past intent classifications.
- Moving, copying, or restyling `VerdictBanner`.

## Verification

Colocated `*.test.tsx` (vitest + jsdom, `pnpm test`) for `IntentCard` and
`IntentConfidencePill` covering: loading / empty (404) / happy-path states; the
per-band icon difference (not color alone); the findings-tab badge's
`confidence !== 'high'` gating. No e2e flow is named by this spec.
