# INSIGHTS — `@devdigest/web`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

## 2026-08-01 — a "close on scroll" overlay also catches its own internal scroll

An overlay positioned once from `getBoundingClientRect()` has to close when the page
scrolls, or it detaches from its anchor. The obvious listener —
`window.addEventListener('scroll', close, true)` — uses capture, so it fires for scrolls
of *any* element, including the overlay itself. A panel with `maxHeight` + `overflowY:
auto` then becomes unscrollable: the first wheel tick over it closes it, and because the
panel is gone the wheel lands on the page instead. It looks like the overlay "flickers
away when you try to read it", which points at the hover logic rather than the scroll
listener.

Two further traps in the same handler. `Node.contains()` **throws** on a non-Node
argument, and a page scroll dispatches with `e.target === window`, so
`panel.contains(e.target as Node)` throws for exactly the case that should close the
overlay — the throw swallows the close and strands it on screen. And once the panel
scrolls to its end the wheel chains to the page unless it sets `overscrollBehavior:
contain`.

→ Check the scroll's origin, guarding the type first:
`if (e.target instanceof Node && panel.contains(e.target)) return;` — `instanceof` is
load-bearing, not defensive. (`src/components/findings-badges/FindingsBadges.tsx:60-75`,
`styles.ts`)
→ jsdom has no layout, so a component test cannot catch this by scrolling for real.
`fireEvent.scroll(panel)` vs `fireEvent.scroll(window)` does pin both branches
(`FindingsBadges.test.tsx`); confirming it actually scrolls needs a real browser —
compare `scrollHeight` to `clientHeight`.

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
