# `@devdigest/reviewer-core` — the review engine

Pure review logic: diff → prompt → LLM → grounded findings. Package manager: **npm**
(not pnpm — this package has a `package-lock.json`).

## Iron rule

No I/O — no DB, fs, GitHub, or persistence. Only the injected `LLMProvider`. The same
code runs in the studio (server) and in CI. Keep it pure.

## Before answering

Search `reviewer-core/docs/`, `reviewer-core/specs/`, and `reviewer-core/INSIGHTS.md`
first — then read code.

## Read first

- [`README.md`](README.md) — the pipeline diagram and the public API surface. Don't
  restate it; link to it.
- [`../docs/agent-prompts/README.md`](../docs/agent-prompts/README.md) — how an agent's
  system prompt becomes the messages a model actually sees.
- [`INSIGHTS.md`](INSIGHTS.md) — accumulated gotchas. **Read before debugging**, and
  add to it via `engineering-insights` when you learn something non-obvious here.
- [`docs/`](docs/) · [`specs/`](specs/) · [`../TESTING.md`](../TESTING.md)

## Commands

```sh
npm ci                # npm, NOT pnpm
npm test              # vitest, hermetic — stubbed LLMProvider, no keys, no network
npm run typecheck     # this IS the build; the package never emits JS
```

## Invariants

- **Purity is the point.** No database, no GitHub, no filesystem. The only side effect
  is an LLM call through an **injected** `LLMProvider`. This is what makes the engine
  mock-testable and reusable from CI. A new dependency on I/O belongs in the server.
- **Never emits JS.** `build` is `tsc --noEmit`; the server imports the raw `src/`
  through a tsconfig path alias. Consequence: this package's `node_modules` is a
  **runtime boot dependency of the API**.
- **`INJECTION_GUARD` (`src/prompt.ts:16-28`) is the one shared defense.** It is
  appended to every agent's system prompt on every review path. Do **not** add
  keyword or denylist scanning of untrusted text — a denylist only ever catches one
  phrasing, in one language.
- **All external content goes through `wrapUntrusted()`** before entering the prompt:
  the diff, PR description, repo map, callers, specs.
- **The grounding gate is mandatory.** A finding that doesn't cite a real line in the
  diff is dropped (`src/grounding.ts`), and the score is recomputed from the
  survivors — the model's self-reported score is discarded.
- **skills/memory/specs arrive as RESOLVED strings** — turning a slug into a body is
  the caller's job, not this package's.
- **Contracts come from the server's copy** of `@devdigest/shared`
  (`../server/src/vendor/shared`, aliased in `tsconfig.json:22-23`). Changing a contract
  for this package means editing the server's files, and the client's copy too.

## Conventions

`src/` is grouped by pipeline stage: `prompt.ts` (assembly), `llm/` (provider +
structured output), `grounding.ts` (the gate), `review/` (`run`, `reduce`),
`output/` (CI payload). Everything public is re-exported from `src/index.ts` — add
new exports there. Tests are hermetic units in `test/` with a stubbed provider.

Optional prompt slots (`skills`, `memory`, `specs`, `callers`, `repoMap`) are omitted
when empty, which must stay true: an unused slot has to produce a byte-identical
prompt to not having the feature at all.

## Skills

`zod` · `typescript-expert` · `security` · `engineering-insights` — see
[`../.claude/skills/README.md`](../.claude/skills/README.md).
