# Answer key

**Never shown to a run.** Verified by hand on 2026-09-03 against the repository at commit `cd73e3e`.

These are the facts the assertions in `evals.json` are graded against. Where a fact is a judgement
call rather than an observation, that is marked — a grader should not penalise a run for disagreeing
with a judgement, only for getting an observation wrong.

## Structure

| Fact | Evidence |
|---|---|
| Six packages | `client`, `server`, `reviewer-core`, `e2e`, `mcp-server`, `evals` |
| Not a workspace | No `workspace:*`, no root `package.json`. Packages are wired by tsconfig `paths` only |
| Mixed package managers | pnpm in five packages, npm (`package-lock.json`) in `e2e` and also in `reviewer-core`, which carries *both* lockfiles |
| `server` ↔ `reviewer-core` cycle | `server/tsconfig.json` maps `@devdigest/reviewer-core` → `../reviewer-core/src`; `reviewer-core/tsconfig.json` maps `@devdigest/shared` → `../server/src/vendor/shared` |
| `mcp-server` → `server` | Same `@devdigest/shared` alias into `server/src/vendor/shared` |
| `client` vendors its own copy | `client/src/vendor/shared/` is a second copy of the contracts, not an alias into `server`. `scripts/arch-check.sh` has a `contracts-in-sync` rule for exactly this, and its header notes the two copies have **real drift** today |
| `server/clones/` | Contains a full checkout of this repo. Any analysis that does not exclude it double-counts everything |

## Dependency usage — the traps

The interesting part of this skill is precision, not recall. These four are where a static import
scan gets it wrong:

| Package | Verdict | Evidence |
|---|---|---|
| `@fastify/autoload` (server, **prod**) | **Genuinely unused.** The only true removal candidate in the repo | Nothing imports it. `server/src/modules/index.ts:23` documents the decision to register modules explicitly "rather than via filesystem autoload so the same code path works under tsx" |
| `pino-pretty` (server, dev) | **Used.** Must not be proposed for removal | `server/src/app.ts:57` — `{ target: 'pino-pretty', options: { colorize: true } }`. A string, not an import |
| `@vscode/ripgrep` (server, **prod**) | **Used.** Must not be proposed for removal | `server/src/adapters/codeindex/ripgrep.ts:33` — `await import(/* @vite-ignore */ '@vscode/ripgrep' as string)`. A dynamic import carrying a bundler pragma |
| `testcontainers` (server, dev) | **Ambiguous — raise, do not delete.** The bare package is never imported; `@testcontainers/postgresql` is the one used in integration tests | Correct handling is to ask, since the bare package is a peer of the scoped one |

`@types/*`, `typescript`, `tsx`, `vitest`, `tailwindcss`, `postcss`, `jsdom` are all used through
config or scripts. A run that proposes deleting any of them on "nothing imports it" grounds has
failed the case regardless of what else it found.

## Version drift

Five names carry different ranges across packages. `mcp-server` is the outlier throughout, pinning
loose majors where every other package pins a minor:

- `typescript` — `^5.7.2` in four packages, `^5.6.0` in `evals`, `^5` in `mcp-server`
- `@types/node` — `^22.10.0`, `^22.0.0`, `^22`
- `tsx` — `^4.19.2`, `^4.19.0`, `^4`
- `vitest` — `^2.1.8`, `^2.1.0`
- `zod` — `^3.24.1` in three packages, `^3` in `mcp-server`

`zod` is the one that matters: it is a **runtime** contract library shared across the package
boundary, so a resolved-version split is a correctness risk rather than tooling untidiness. The
others are dev tooling and belong in a single grouped hygiene finding.

## Duplication

Measured across all six trees (logical bytes; pnpm hard-links, so real disk is lower):

| Name | Copies | Wasted |
|---|---|---|
| `@esbuild/darwin-arm64` | 6 | ≈48 MB |
| `esbuild` | 6 | ≈20 MB |
| `@types/node` | 6 | ≈11 MB |
| `rollup` | 3 | ≈5 MB |

## Browser cost

There is **no production build** — `client/.next` holds a dev build (no `BUILD_ID`,
`static/development` present). Any per-route or chunk byte figure quoted from it is wrong by several
multiples. The correct handling is to say the section needs a production build.

Static reachability, which does not need a build:

| Dependency | Ships | Eager | Note |
|---|---|---|---|
| `react`, `next`, `next-intl`, `@tanstack/react-query` | yes | yes | Reached directly, not through a barrel. Expected; not findings |
| `recharts` | **no** | — | Its consumers `client/src/vendor/ui/charts/{LineChart,Donut}.tsx` are reached only through the `vendor/ui` barrel, and their only real consumer is `components/showcase/Showcase.tsx`, which **no route renders**. Absent from every built chunk |
| `mermaid` | **no** | — | `MermaidDiagram.tsx` is imported only by its own `index.ts`. Nothing routes to it — dead code, and the heaviest install in the client. Absent from every built chunk |
| `react-markdown`, `lucide-react`, `d3` | **yes** | yes | Also reached only through the barrel — and they *do* ship. Present in the built chunks |

Measured from a real production build (`rsync` copy + `pnpm build`, repo `.next` untouched): **102 kB
shared First Load JS**, worst route `/repos/[repoId]/pulls/[number]` at **258 kB**.

**Corrected after iteration 1.** This table originally claimed `recharts` and friends ship, on the
reasoning that their files carry no `'use client'` directive but are imported by components that do.
The transitive part of that is right; the conclusion was not. A production build settled it: the
shared First Load JS is ~102 kB and the barrels tree-shake cleanly. Two separate errors were hiding
behind one plausible sentence:

1. Treating every `'use client'` file as a bundle root. A client component no route reaches ships
   nothing, and the chart components are exactly that.
2. Ignoring re-export barrels. Reaching a dependency through `export * from` says nothing on its own,
   because the bundler resolves barrels per export.

The second point cuts both ways, and the build proves it: `recharts` and `mermaid` are dropped while
`react-markdown`, `lucide-react` and `d3` ship — all of them barrel-only. So "reached through a
barrel" is a **question**, not an answer, and any static tool that turns it into a verdict is wrong
about half the time here.

The graded expectation is therefore **not** "says recharts ships". It is that a run distinguishes
*reachable in the import graph* from *present in the bundle*, and does not open a P2 bundle finding
on a barrel-only path without measuring. Both arms of iteration 1 got closer to this than the
answer key did.

## Judgement calls — not graded

Reasonable reports may differ on: whether the `server` ↔ `reviewer-core` cycle is worth fixing or is
an accepted consequence of vendoring; whether to deduplicate esbuild at all given pnpm hard-links;
whether the `client` vendored copy should become an alias. Grade the evidence, not the conclusion.
