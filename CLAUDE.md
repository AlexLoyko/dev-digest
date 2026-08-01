# DevDigest

Local-first AI pull-request review studio. Import a repo and a PR, run an agent review,
get grounded structured findings. This is the **course starter** — lessons L01–L08 add
features back (see [`README.md`](README.md)).

## Which file to read

This repo is four independent packages. **Read the `CLAUDE.md` of the package you are
editing** — it carries that package's commands, invariants, and conventions.

| Folder | Package | PM | Agent guide |
|---|---|---|---|
| `server/` | `@devdigest/api` — Fastify + Drizzle/Postgres, `:3001` | pnpm | [`server/CLAUDE.md`](server/CLAUDE.md) |
| `client/` | `@devdigest/web` — Next.js 15 studio, `:3000` | pnpm | [`client/CLAUDE.md`](client/CLAUDE.md) |
| `reviewer-core/` | `@devdigest/reviewer-core` — the pure review engine | npm | [`reviewer-core/CLAUDE.md`](reviewer-core/CLAUDE.md) |
| `e2e/` | `@devdigest/e2e` — deterministic browser flows | npm | [`e2e/CLAUDE.md`](e2e/CLAUDE.md) |

Each package also has `docs/` (long-form), `specs/` (spec-driven development), and
`INSIGHTS.md` (accumulated gotchas). Read a package's `INSIGHTS.md` before debugging
anything surprising in it, and use the `engineering-insights` skill to add to it when a
session learns something non-obvious.

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

## Also read

- [`README.md`](README.md) — architecture, quick start, what the course adds
- [`TESTING.md`](TESTING.md) — suite map and the per-package CI strategy
- [`docs/agent-prompts/README.md`](docs/agent-prompts/README.md) — how a review agent's
  system prompt becomes the messages a model sees
- [`.claude/skills/README.md`](.claude/skills/README.md) — the on-demand skill catalog
