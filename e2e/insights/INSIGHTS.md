# e2e Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

## What Doesn't Work

2026-08-29 — Adding `wait --load networkidle` immediately after `open` to make a flow order-independent does not work reliably on a warm dev server: if the redirect's fetch settles before the next `agent-browser` CLI subprocess (each step is a separate process talking to the persistent daemon) attaches its listener, there is no future idle transition left to observe and the wait hangs to the full `E2E_STEP_TIMEOUT` even though the page already navigated correctly. This is why `10-pr-brief.flow.json` still failed — now on the networkidle step itself — after mirroring `01-app-boot.flow.json`'s `open` → `wait --load networkidle` → `wait --url` sequence. `01-app-boot` gets away with it only because it's a cold compile (the fetch is still in flight when the wait attaches). ref: e2e/specs/10-pr-brief.flow.json:5-7.

## Codebase Patterns

## Tool & Library Notes

2026-08-29 — `agent-browser wait --text` is DOM-polled (re-evaluates current page text each poll), while `wait --load networkidle` is event-based (waits on a future busy→idle transition and can miss one that already happened between separate CLI invocations). When a redirect/fetch might already be settled by the time a wait step runs — e.g. a flow that must be independent of what the immediately preceding flow left the browser doing — prefer `wait --text` for a distinguishing heading/string over `wait --load networkidle`. ref: e2e/specs/10-pr-brief.flow.json:6.

## Recurring Errors & Fixes

## Session Notes

2026-08-29 — Fixed `10-pr-brief.flow.json` failing on its first navigation only when run at the end of the full suite (never in isolation, never right after a cold `01-app-boot`). Root cause: it inherited whatever page state `09-context-tabs-and-trace` (a pre-existing, known-failing flow, untouched here) left the browser in. The finding's suggested fix (mirror `01-app-boot`'s `wait --load networkidle` right after `open`) did not resolve it — see What Doesn't Work. Replaced that wait with `wait --text "Pull Requests"` instead, which is DOM-polled rather than event-based and isn't vulnerable to the same race. Verified with two consecutive full `./scripts/e2e.sh` runs: 8/10 flows passed both times, with only `08-project-context` and `09-context-tabs-and-trace` failing (pre-existing, not in scope). Files: e2e/specs/10-pr-brief.flow.json, e2e/specs/coverage.md.

2026-08-28 — Doc pass for SPEC-01 (Project Context): `e2e/docs/flows.md` and `e2e/CLAUDE.md` described a `flows/*.json` directory with `{command, value}` steps and manual registration in `run.ts` — none of that exists. The real, working contract was already correctly documented in `e2e/README.md`: `specs/NN-name.flow.json`, `{ cmd: string[] }` steps, auto-discovered by `run.ts` in lexical filename order, optional `assert.stdoutIncludes`/`assert.stdoutExcludes`. Both stale docs rewritten to match `e2e/run.ts` and `e2e/README.md`. Two implementer agents on the project-context plan lost time to the stale version before this fix. Files: e2e/docs/flows.md, e2e/CLAUDE.md.

## Open Questions

2026-08-28 — `e2e/specs/09-context-tabs-and-trace.flow.json`'s third leg reproducibly fails: after clicking to expand "Prompt assembly" in the run drawer, the step `wait --text "Project context — attached specs (untrusted)"` (the segment label) times out — the label never renders — even though the seeded run's `prompt_assembly.specs` is populated (verified via `server/src/db/seed.ts`'s fixture commit sha row) and `client/messages/en/runs.json`'s `trace.prompt.specs` key is set correctly. Root cause unresolved; the flow file's own steps assert the passing behavior, so this flow is currently red on that leg, not merely uncovered. Investigate starting from `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx`'s conditional render of the `specs` prompt block (`trace.prompt_assembly.specs != null`) against the actual seeded trace JSON. Investigated in: e2e/specs/09-context-tabs-and-trace.flow.json:61-63.
