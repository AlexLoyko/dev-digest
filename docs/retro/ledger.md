# Workflow retro ledger

Append-only. One row per `/workflow-retro` run, newest last. The full report for each row lives
beside this file as `<date>-<slug>.md`.

This ledger is where **retro insights land, including module-scoped ones**. It is not
`{module}/insights/INSIGHTS.md` — that file is owned by `engineering-insights` and records what we
learned about the *product* while building it. This ledger records what we learned about the *agent
system* while running it. When a retro finding is really a product discovery, say so and hand it to
`engineering-insights` rather than writing it in both places.

| Date | Run | Mode | Agents | Fresh tokens | Wall / busy | Headline finding | Report |
|---|---|---|--:|--:|---|---|---|
| 2026-08-28 | SPEC-01 Project Context — spec authoring | deep | 1 root + 4 nested | 2 964 283 | 2h 37m / ~8m agent busy | `spec-creator` re-read 17 of 23 files its own researchers had already cited with `path:line` — the verification pass roughly doubled read cost | [report](2026-08-28-project-context-spec.md) |

## Module-scoped insights

Findings from retros that attach to a specific package. Newest last.

| Date | Module | Insight | From |
|---|---|---|---|
| 2026-08-28 | server | `agent_versions` is written on every config change but **never read anywhere** in `server/src`; and linking skills does not bump `agents.version` either (field set at `server/src/modules/agents/helpers.ts:28`). Any spec question about attachment reproducibility must account for both. | [report](2026-08-28-project-context-spec.md) |
| 2026-08-28 | reviewer-core | `prompt.ts:121` already emits the wrapped `## Project context` section from `parts.specs`; the slot was never filled because `run-executor.ts:415` hardcodes `specs_read: []`. Half of SPEC-01 was already shipped. | [report](2026-08-28-project-context-spec.md) |
