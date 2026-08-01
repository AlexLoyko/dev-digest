# `@devdigest/e2e` — browser end-to-end suite

Deterministic UI flows driven by Vercel **agent-browser** (Rust + CDP). No Playwright,
no LLM, no API key. Package manager: **npm**.

## Read first

- [`README.md`](README.md) — the flow format, the locator rules, and the
  freshly-seeded-DB precondition. Don't restate it; link to it.
- [`INSIGHTS.md`](INSIGHTS.md) — accumulated gotchas. **Read before debugging**, and
  add to it via `engineering-insights` when you learn something non-obvious here.
- [`docs/`](docs/) · [`../TESTING.md`](../TESTING.md)

## Commands

```sh
npm i -g agent-browser && agent-browser install   # once — downloads Chrome for Testing
npm install

npm run e2e:hermetic    # RECOMMENDED — isolated stack on alt ports, freshly seeded
npm test                # pure runner; needs a stack already up AND a fresh DB
npm run typecheck
```

Use `e2e:hermetic` locally. `npm test` against your dev stack usually fails flows
02/04/05, because they follow the home redirect to the *first* repo and assume the
seeded demo repo is the only one — your dev DB normally has other imported repos.

> **Never `docker compose down -v` to "fix" a failing flow.** `-v` deletes the
> `devdigest_pgdata` volume and every repo and review you have imported. The hermetic
> runner exists precisely so you never need to touch the dev DB.

## Invariants

- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`. The AI
  `chat` command is never used — that is what keeps runs stable and key-free.
- **`wait` is the assertion.** A non-zero exit fails the step and the flow, so
  `wait --text` / `wait --url` are how a flow asserts. Optional
  `"assert": { "stdoutIncludes": … }` adds a substring check on top.
- **Flows target read-only seeded data** (`acme/payments-api`, PR #482, the seeded
  agents), so nothing triggers a model call or needs an API key.
- **`specs/` here means browser flows, not feature specs.** This package is the one
  exception to the repo-wide meaning of `specs/` — see [`../CLAUDE.md`](../CLAUDE.md).
  A forward-looking spec for a journey belongs in the package that owns the feature.

## Conventions

A new journey is a new `specs/NN-name.flow.json`; `run.ts` picks up the directory in
lexical filename order, so the number controls sequencing. Keep flows independent of
each other where possible, and keep each one focused on a single journey. Shared
assertion helpers live in `lib/assert.ts`.

## Skills

`engineering-insights` — see [`../.claude/skills/README.md`](../.claude/skills/README.md).
