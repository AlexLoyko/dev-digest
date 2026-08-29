# e2e Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

2026-08-28 — Doc pass for SPEC-01 (Project Context): `e2e/docs/flows.md` and `e2e/CLAUDE.md` described a `flows/*.json` directory with `{command, value}` steps and manual registration in `run.ts` — none of that exists. The real, working contract was already correctly documented in `e2e/README.md`: `specs/NN-name.flow.json`, `{ cmd: string[] }` steps, auto-discovered by `run.ts` in lexical filename order, optional `assert.stdoutIncludes`/`assert.stdoutExcludes`. Both stale docs rewritten to match `e2e/run.ts` and `e2e/README.md`. Two implementer agents on the project-context plan lost time to the stale version before this fix. Files: e2e/docs/flows.md, e2e/CLAUDE.md.

## Open Questions

2026-08-28 — `e2e/specs/09-context-tabs-and-trace.flow.json`'s third leg reproducibly fails: after clicking to expand "Prompt assembly" in the run drawer, the step `wait --text "Project context — attached specs (untrusted)"` (the segment label) times out — the label never renders — even though the seeded run's `prompt_assembly.specs` is populated (verified via `server/src/db/seed.ts`'s fixture commit sha row) and `client/messages/en/runs.json`'s `trace.prompt.specs` key is set correctly. Root cause unresolved; the flow file's own steps assert the passing behavior, so this flow is currently red on that leg, not merely uncovered. Investigate starting from `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx`'s conditional render of the `specs` prompt block (`trace.prompt_assembly.specs != null`) against the actual seeded trace JSON. Investigated in: e2e/specs/09-context-tabs-and-trace.flow.json:61-63.
