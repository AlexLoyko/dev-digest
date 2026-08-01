# INSIGHTS — `@devdigest/web`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

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
