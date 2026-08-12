# `@devdigest/api` — the engine (Fastify + Postgres)

Imports repos and PRs, indexes repos with `repo-intel`, stores agents, runs the
reviewer. Package manager: **pnpm**.

## Before answering

Search `server/docs/`, `server/specs/`, and `server/INSIGHTS.md` for the topic before
reading code — they are curated and may already answer it.

## Read first

- [`README.md`](README.md) — API map, request/DI flow, the full env-var table, and the
  non-obvious review-context notes. Don't restate it; link to it.
- [`src/modules/repo-intel/README.md`](src/modules/repo-intel/README.md) — the indexer
  pipeline and the `repoIntel.*` facade.
- [`INSIGHTS.md`](INSIGHTS.md) — accumulated gotchas. **Read before debugging**, and
  add to it via `engineering-insights` when you learn something non-obvious here.
- [`docs/`](docs/) · [`specs/`](specs/) · [`../TESTING.md`](../TESTING.md)

## Commands

```sh
pnpm install
pnpm db:migrate      # REQUIRED — migrations are NOT applied on boot
pnpm db:seed         # idempotent demo data
pnpm dev             # :3001
pnpm typecheck

pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, hermetic, no Docker
pnpm exec vitest run .it.test                      # integration, needs Docker
pnpm test                                          # both
```

## Invariants

- **Secrets go through `SecretsProvider` only** — never `process.env`, never
  `AppConfig`. `src/adapters/secrets/local.ts` is the single read chokepoint
  (`~/.devdigest/secrets.json`, mode 0600). See the note at `platform/config.ts:8-15`.
  After persisting a key, call `container.invalidateSecretCaches()` or cached clients
  keep the old one.
- **Modules are registered statically** in `src/modules/index.ts` — deliberately not
  autoloaded, because native dynamic `import()` of `.ts` isn't portable across tsx,
  the bundler, and vitest.
- **Validation is schema-first.** Routes declare zod `params`/`body` schemas via
  `fastify-type-provider-zod`; invalid input is rejected with 422 before the handler
  runs. Do not hand-roll `Schema.parse(req.body)` in a handler.
- **Plugins register before modules** (`src/app.ts`) so encapsulated module plugins
  inherit helmet/cors/rate-limit/SSE and the shared error handler.
- **A DB-backed test must be named `*.it.test.ts`.** The CI lanes split purely on that
  suffix — a misnamed test silently runs in the wrong lane or not at all.
- **Every domain table carries `workspace_id`**; queries scope by it via the
  base-repository guard. New columns and tables come from `drizzle-kit generate` —
  write your own migration, never edit an already-applied one.
- **`repo-intel` is reached ONLY through the facade `container.repoIntel.*`** — never
  touch the pipeline directly.
- **Context enrichment is best-effort:** on error or an unindexed repo, omit the
  section — don't throw.

## Conventions

New feature → `src/modules/<name>/` with `routes.ts` (a default Fastify plugin),
`service.ts`, `repository.ts`, then one import + one entry in `src/modules/index.ts`.
Nothing else changes. External systems go behind an adapter resolved through the
`Container` (`src/platform/container.ts`) so tests can inject
`src/adapters/mocks.ts` via `ContainerOverrides`; services depend on interfaces from
`@devdigest/shared`, not on classes. Cross-module entities are reached via
`container.<x>Repo`, never by importing another module's folder.

## Skills

`fastify-best-practices` · `drizzle-orm-patterns` · `postgresql-table-design` · `zod` ·
`security` · `engineering-insights` —
see [`../.claude/skills/README.md`](../.claude/skills/README.md).
