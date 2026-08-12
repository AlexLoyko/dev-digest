# INSIGHTS — `@devdigest/web`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

## 2026-08-03 — one `NAV` entry lights up three surfaces at once

Adding an item to `NAV` (`vendor/ui/nav.ts`) gives you the sidebar row, the command-palette
command, and the `g`-shortcut together — the group heading in the palette is the entry's
`section` string, so moving an item between groups moves its palette grouping too. Two
things must line up or it half-works: the `key` has to match what `activeKeyFor` returns
(`app-shell/helpers.ts`) or the row never highlights, and `messages/en/shell.json` needs a
`nav.<key>` label or the sidebar renders the raw key.

## 2026-08-03 — `MonoLink` with no `href` ships a dead control

It does not fall back to text — it renders a `<button className="mono">`, i.e. something
focusable that does nothing when there's also no `onClick`
(`vendor/ui/primitives/MonoLink.tsx:32`). So `<MonoLink href={maybeUndefined}>` is the wrong
shape for an OPTIONAL link: keyboard and AT users get a control that goes nowhere. Branch
instead: `href ? <MonoLink href={href}>…</MonoLink> : <span className="mono">…</span>`.
Test with `expect(queryByRole("link")).toBeNull()` **plus** a
`queryByRole("button", { name: label })` null-check — a plain-text assertion passes either
way and hides the bug. Evidence:
`app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx`.

## 2026-08-03 — `githubBlobUrl` with an empty sha yields a silently broken link

`sha` is interpolated as a RAW path segment (`lib/github-urls.ts:35`), so `''` produces
`…/blob//path` — a 404, not an error you can catch. Guard on **truthiness**, never
`!= null`: `IndexState.lastIndexedSha` is `''` (not null) for a repo with no index row.
Passing `undefined` for `start` is fine and correctly omits the `#L` anchor.

## 2026-08-03 — the Create-skill modal reuses the generic skill endpoint

It saves through the existing `useCreateSkill()` / `POST /skills`, not a conventions-specific
route; only the draft (name/description/body) comes from the conventions API. Reach for the
existing mutation before adding a feature-scoped endpoint.

## 2026-07-31 — this package's `@devdigest/shared` copy lags the server's

`src/vendor/shared/` and `server/src/vendor/shared/` are independent copies and have
drifted in five files (`adapters.ts`, `contracts/{eval-ci,knowledge,productionize,trace}.ts`).
The client copy is **behind**: its `Provider` union is `'openai' | 'anthropic'` with no
`'openrouter'`, and it lacks `sessionId`, `CommitFile`/`CommitFilesPayload`, and
`AgentManifest`.

Consequence: an agent configured with the `openrouter` provider is served fine by the
API but fails validation on the client. Any contract change must be applied to **both**
copies — see the repo-wide invariants in [`../CLAUDE.md`](../CLAUDE.md).

## 2026-07-31 — `messages/en/` describes far more app than exists

Eighteen namespaces ship (`blast`, `brief`, `conformance`, `eval`, `memory`, `skills`,
`agentPerformance`, …) against roughly five built screens. They are placeholders for
course lessons L01–L08. A namespace existing does not mean the screen does — check
`src/app/**/page.tsx` before assuming a route is live. The same applies to parts of
`src/vendor/ui/` (`LiveLogStream`, `ExportWizardSteps`, `AutoTriggerStatus`).

## 2026-07-31 — component tests never touch the network

`pnpm test` runs vitest + jsdom with `fetch` mocked in `src/test/setup.ts`, so no API,
DB, or browser is needed. Don't add a test that expects a live server — the real
full-stack journeys belong in [`../e2e`](../e2e/README.md), which runs against seeded
data with no LLM in the loop.

## 2026-06-18 — the AgentEditor tab list lives in two files

Adding a tab means editing BOTH `TABS` in `_components/AgentEditor/constants.ts` (draws
the tab bar) and `VALID_TABS` in `app/agents/[id]/page.tsx:15` (validates the `?tab=`
param). Miss the second and the new tab silently redirects to `config` — no error, no
warning.

## 2026-06-18 — a wrong `Icon` name renders nothing, silently

`Icon` is a proxy object, so `<Icon.BarChart2 />` is not a type error — it just draws
nothing. `BarChart2` and `GripVertical` do NOT exist in the registry: use `BarChart`, and
a unicode glyph (e.g. `⠿`) for a drag handle. Verify every name against
`src/vendor/ui/icons.tsx` before using it. Contrast with the vendored `Toggle`, whose
prop is `on`, not `checked` — that one typecheck does catch.

## 2026-06-17 — a hover popover inside the PR list needs a portal, not `position:absolute`

The PR-list `tableCard` sets `overflow: hidden` (`pulls/styles.ts`), which CLIPS an
absolutely-positioned panel opening downward from the bottom rows — upper rows look
fine, so the bug hides during casual testing. `FindingsHoverCard` therefore renders its
panel through `createPortal(document.body)` with `position: fixed`, measuring the
anchor's `getBoundingClientRect()` on open, recomputing on resize, closing on scroll.
Because the panel then lives outside the anchor's subtree, BOTH the anchor and the portal
panel carry the open/close handlers (shared 120 ms timer) so the pointer can cross the
gap between them. `src/components/FindingsHoverCard/FindingsHoverCard.tsx`.

## 2026-06-17 — finding deep-links thread through four components

A findings popover navigates to `…/pulls/:number?tab=findings&finding=:id`. The PR-detail
page reads `?finding`, forces the findings tab, and threads `focusFindingId` →
`FindingsTab` (resolves finding→run, reuses the `targetRunId` open+scroll) →
`ReviewRunAccordion` (opens if it owns the finding) → `FindingsPanel` (scrolls to
`[data-finding-id]`, `defaultExpanded`). A finding's file:line link opens the PR's Files
tab (`githubPrFilesUrl`), not the standalone blob.

## 2026-06-14 — `COLUMN_KEYS` and `GRID` must stay length-aligned

The PR-list table is driven by two parallel constants in
`app/repos/[repoId]/pulls/constants.ts`: `COLUMN_KEYS` (header keys + order) and `GRID`
(CSS grid-template tracks). Adding a column means adding to **both** and rendering a
matching cell in `PRRow.tsx` — otherwise headers and cells misalign silently, with no
error anywhere.

## 2026-06-14 — where a shared component lives depends on what it is

Cross-route app components live in `src/components/<name>/` with an `index.ts` barrel and
are imported as `@/components/<name>` (e.g. `run-cost-badge`, `diff-viewer`). Vendored UI
primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` behind `@devdigest/ui` — a
different home with different rules. Don't add an app component to the vendored kit.

## 2026-06-14 — `formatCost` separates "no data" from "free"

`formatCost` (`src/components/run-cost-badge/helpers.ts`) renders `null`/`undefined` as
an em dash and a genuine `0` as `$0.00` — they are different facts and must not collapse.
It widens precision for sub-cent values (~2 significant figures) and trims trailing zeros
to a 2dp floor: `$0.06`, not `$0.060`; `$0.0013`, not `$0.00`. Reuse it for any per-run
money display rather than formatting inline.

## 2026-06-14 — a missing i18n key renders the key, not an error

Only the `en` locale exists (`client/messages/en/`). A new string needs a key in the
right namespace file (`prReview.json`, `runs.json`, …) read via `useTranslations("<ns>")`.
Forget it and the UI displays the raw key path — nothing throws, and tests that assert on
visible text will happily match it.
