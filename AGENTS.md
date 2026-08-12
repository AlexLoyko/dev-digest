# DevDigest

Local-first AI pull-request review studio. Import a repo and a PR, run an agent review,
get grounded structured findings. This is the **course starter** — lessons L01–L08 add
features back (see [`README.md`](README.md)).

## Before answering

Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` for what the
user asks about FIRST — these are curated and may already answer it — then read code.

## Which file to read

This repo is four independent packages. **Read the `AGENTS.md` of the package you are
editing** — it carries that package's commands, invariants, and conventions.
(`CLAUDE.md` is a symlink to `AGENTS.md` in every package, so either path works.)

| Folder | Package | PM | Agent guide |
|---|---|---|---|
| `server/` | `@devdigest/api` — Fastify + Drizzle/Postgres, `:3001` | pnpm | [`server/AGENTS.md`](server/AGENTS.md) |
| `client/` | `@devdigest/web` — Next.js 15 studio, `:3000` | pnpm | [`client/AGENTS.md`](client/AGENTS.md) |
| `reviewer-core/` | `@devdigest/reviewer-core` — the pure review engine | npm | [`reviewer-core/AGENTS.md`](reviewer-core/AGENTS.md) |
| `e2e/` | `@devdigest/e2e` — deterministic browser flows | npm | [`e2e/AGENTS.md`](e2e/AGENTS.md) |

Each package also has `docs/` (long-form), `specs/` (spec-driven development), and
`INSIGHTS.md` (accumulated gotchas).

## Session protocol (engineering-insights loop)

- **Start:** before touching a package, read its `INSIGHTS.md` and summarize the top 3
  relevant points back — this forces an active read and catches a silently-failed load.
- **Before recording an insight:** re-read that package's `INSIGHTS.md` and do not duplicate
  what's already there.
- **End of session:** run `/engineering-insights`. Record only substantial, file-grounded,
  non-duplicate findings; if nothing substantial came up, write nothing — but don't skip the
  check. Writes are strictly append-only (never overwrite an `INSIGHTS.md`).

## Repo-wide invariants

These belong to no single package. Everything else lives in the package guides.

- **Not a monorepo.** There is no workspace and no root install. `server` and `client`
  use **pnpm**; `reviewer-core` and `e2e` use **npm**. Install per package, with that
  package's manager. `./scripts/dev.sh` does this correctly from zero.
- **`@devdigest/shared` is vendored twice** — `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are independent copies that have **already drifted**.
  A contract change must be applied to **both**. `reviewer-core` aliases the *server*
  copy (`reviewer-core/tsconfig.json:22-23`), so the server copy is the de-facto source.
- **Cross-package imports resolve to raw TypeScript source**, not built packages, via
  tsconfig `paths` (`server/tsconfig.json:22-25`) mirrored in each `vitest.config.ts`.
  Adding or changing an alias means updating three places: the tsconfig, the vitest
  config, and the `paths:` filter of the affected workflows in `.github/workflows/`
  (e.g. `reviewer-core/**` is in `server-unit.yml` because the server type-checks
  against it).
- **Modules are registered statically** in `server/src/modules/index.ts` — no filesystem
  autoload. A new feature is a new module plus one line there.
- **ESM:** relative imports carry the `.js` extension.

## Do-not-touch

- `server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit without
  coordination.

## Also read

- [`README.md`](README.md) — architecture, quick start, what the course adds
- [`TESTING.md`](TESTING.md) — suite map and the per-package CI strategy
- [`docs/agent-prompts/README.md`](docs/agent-prompts/README.md) — how a review agent's
  system prompt becomes the messages a model sees
- [`.claude/skills/README.md`](.claude/skills/README.md) — the on-demand skill catalog
