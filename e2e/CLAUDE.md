# CLAUDE.md — e2e

Deterministic browser flows using `agent-browser`. No Playwright, no LLM, no API keys required. Flows are JSON specs with CLI-driven steps.

## Running

```bash
# Hermetic (isolated stack — preferred for CI)
./scripts/e2e.sh

# Against a running stack (must be seeded first)
./scripts/dev.sh    # in another terminal
cd e2e && npm test
```

## Flow Step Format

<!-- updated from: e2e/run.ts, e2e/docs/flows.md -->

Each flow is `specs/NN-name.flow.json`. Steps are `{ "cmd": string[] }` arrays passed verbatim to
`agent-browser` — not `{command, value}` pairs. `run.ts` auto-discovers every `*.flow.json` file in
`specs/` and runs them in lexical filename order; there is no separate registration step and no
`flows/` directory.

```json
{ "cmd": ["open", "{BASE}/"] }
{ "cmd": ["wait", "--text", "Expected text on page"] }
{ "cmd": ["find", "role", "button", "click", "--name", "Context"] }
```

Steps are executed sequentially. A flow fails on the first failing step. Full format, an optional
`assert.stdoutIncludes` / `assert.stdoutExcludes`, and debugging notes: `e2e/docs/flows.md`.

## Coverage

See `e2e/specs/coverage.md` for the current flow list and what each one verifies.

## Do Not Touch Without Reading

- `run.ts` — orchestrates all flows. Read `e2e/docs/flows.md` before adding new ones.

## Read When

- **Writing a new flow** → `e2e/docs/flows.md`
- **Understanding what is and is not covered** → `e2e/specs/coverage.md`
- **Hit unexpected behavior (agent-browser install, hermetic teardown, CI)** → `e2e/insights/gotchas.md`

## Session Context

Before starting any work in this module, read `insights/INSIGHTS.md` and treat it as high-confidence guidance unless explicitly told otherwise. To confirm active loading: summarize the top 3 most relevant points before beginning.

## End of Session

After completing work in this module, run `/engineering-insights` to update `insights/INSIGHTS.md`. Do not skip — if capture requires a human trigger it will not happen consistently enough to compound.
