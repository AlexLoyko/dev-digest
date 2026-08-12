# `@devdigest/web` — the studio (Next.js 15)

Import repos, browse PRs, run and read reviews, author agents. App Router + React 19,
data via TanStack Query over the Fastify API. Package manager: **pnpm**.

## Before answering

Search `client/docs/`, `client/specs/`, and `client/INSIGHTS.md` first — they are
curated and may already answer the question — then read code.

## Read first

- [`README.md`](README.md) — the UI route map (routes → the API surface each leans on)
  and the stack. Don't restate it; link to it.
- [`INSIGHTS.md`](INSIGHTS.md) — accumulated gotchas. **Read before debugging**, and
  add to it via `engineering-insights` when you learn something non-obvious here.
- [`docs/`](docs/) · [`specs/`](specs/) · [`../TESTING.md`](../TESTING.md)

## Commands

```sh
pnpm install
pnpm dev          # :3000  (needs the API on :3001 — see ../scripts/dev.sh)
pnpm build
pnpm test         # vitest + jsdom, fetch mocked — no API, DB, or browser needed
pnpm typecheck
```

## Invariants

- **All data flows through `src/lib/hooks/*` → `src/lib/api.ts`.** No `fetch` in a
  component, no direct URL construction outside `api.ts`. The API base is
  `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).
- **Types/contracts come from `@devdigest/shared`** (Zod) — never hand-duplicate them.
- **UI comes from the vendored kit `@devdigest/ui`** (`src/vendor/ui/`) — primitives,
  kit inputs, shell, charts, icons. Check it before writing a new button, modal,
  dropdown, or badge; hand-rolling a duplicate is the most common mistake here.
- **User-facing strings live in `messages/en/*.json`** and are read via `next-intl`.
  Never inline a display string in a component.
- **`src/vendor/shared/` is a copy, not a package.** The server has its own copy and
  the two have already drifted. Changing a contract means changing both — see the
  repo-wide invariants in [`../AGENTS.md`](../AGENTS.md).

## Conventions

Pages (`src/app/**/page.tsx`) stay thin. Feature logic lives in a colocated
`_components/<Name>/` folder following the existing shape:

```
_components/FindingCard/
  FindingCard.tsx      component
  FindingCard.test.tsx colocated test
  index.ts             re-export
  styles.ts            class strings
  constants.ts         static config
  helpers.ts           pure logic
```

Only the files you actually need — but keep the names. Cross-cutting chrome (nav,
breadcrumbs, `g`-then-key shortcuts) lives in `src/components/app-shell`.

## Skills

`next-best-practices` · `react-best-practices` · `react-testing-library` · `zod` ·
`engineering-insights` —
see [`../.claude/skills/README.md`](../.claude/skills/README.md).
