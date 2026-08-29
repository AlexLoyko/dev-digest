# E2E Flows

<!-- updated from: e2e/run.ts, e2e/lib/assert.ts, e2e/specs/*.flow.json, e2e/README.md -->

How to write, run, and debug agent-browser flow specs.

## What is agent-browser

A CLI tool ([Vercel **agent-browser**](https://github.com/vercel-labs/agent-browser)) that drives a
real Chrome via CDP. No Playwright, no LLM, no API key. Install once:

```bash
npm i -g agent-browser && agent-browser install
```

## Flow file format

Each flow is `e2e/specs/NN-name.flow.json`. `run.ts` auto-discovers every `*.flow.json` file in
`specs/` and runs them in **lexical filename order** — the `NN-` prefix is what controls run order;
there is no separate registration step, and no `flows/` directory.

```jsonc
{
  "name": "App boots and lands on the seeded repo's PR list",
  "steps": [
    { "cmd": ["open", "{BASE}/"],         "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"], "label": "root redirects to PRs" },
    { "cmd": ["wait", "--text", "#482"],  "label": "seeded PR row visible" }
  ]
}
```

- Each step's `cmd` is an **array of arguments** passed verbatim to `agent-browser` — not a
  `{ "command": ..., "value": ... }` pair.
- `{BASE}` is substituted with `E2E_BASE_URL` (default `http://localhost:3000`).
- A non-zero exit from `agent-browser` fails the step and the flow, so `wait --text` / `wait --url`
  **are** the assertions — they time out and exit non-zero if the condition never holds.
- `label` is optional (falls back to the joined `cmd`) and is used only in console output.
- An optional `"assert"` object adds a substring check on the command's stdout:
  `{ "stdoutIncludes": "…" }` and/or `{ "stdoutExcludes": "…" }`. `get text <selector>` steps use
  this to assert page text does or does not contain a string — e.g. asserting no "Upload", "Delete",
  or "Edit" control renders on a read-only page.
- Locators are deterministic only (`--url`, `--text`, `find role|text|label`). The AI `chat` command
  is never used, so runs are stable and require no API key.

## Adding a new flow

1. Create `e2e/specs/NN-name.flow.json`, picking `NN` after the highest existing prefix. No
   registration step — `run.ts` discovers it automatically by scanning `specs/`.
2. Write steps as `agent-browser` command arrays; prefer `wait --text` / `wait --url` as the
   assertion itself over a separate `find` plus a manual check.
3. Run it locally against a seeded stack (below) and confirm it passes before committing.

**Rules:**
- Flows must be deterministic — same seed data, same result every time.
- Do not depend on dynamic content (timestamps, generated IDs) in text assertions.
- Keep flows independent — each flow opens its own pages; do not rely on state a prior flow left
  behind. Flows run in filename order inside one shared browser session (the agent-browser daemon
  keeps the page between invocations), but a flow's assertions should hold regardless of what ran
  before it.
- Target only routes and seeded data that require no LLM call — no flow should trigger a real model
  request.

## Running locally

```bash
# Against a running stack (fastest for development)
./scripts/dev.sh          # in another terminal
cd e2e && npm test

# Hermetic (isolated stack, no side effects on your dev DB)
./scripts/e2e.sh
```

See `e2e/README.md` for the precondition that makes the hermetic runner the safer default (flows that
assume the seeded demo repo is the *first* repo need a freshly-seeded DB with nothing else imported)
and the full list of env var knobs.

## Debugging a failing flow

`run.ts` prints a `✓`/`✗` per step as it runs. On the first failing step it writes a screenshot to
`e2e/test-results/<flow-id>-fail.png` (git-ignored; uploaded as a CI artifact by
`.github/workflows/e2e-web.yml`) and stops the flow. A `wait --text` failure means the expected text
never appeared within the timeout; a `find` failure means the selector/locator never matched. To
debug interactively: run the app (`./scripts/dev.sh`), open the page in a real browser, and verify the
text/selector by hand before adding it to a flow.

## Coverage

See `e2e/specs/coverage.md` for the current flow list and what each one verifies.
