# Report template

The report has one job: a developer who has never thought about this repo's dependencies should be
able to read it top to bottom and know what to do on Monday. Follow this order — it moves from
"what have we got" to "what should I do about it", and each section earns the next one.

Write to `docs/dependencies/<YYYY-MM-DD>-dependencies.md`. Keep the section numbering; it makes
findings citable in review comments ("see §6, F3").

Placeholders in `<angle brackets>` get replaced. Sections marked *(omit if empty)* should be dropped
entirely rather than left with "None found" — except §7, where "no findings at this level" is itself
worth stating.

---

````markdown
# Dependency report — <repo name>

**Date:** <YYYY-MM-DD> · **Packages:** <n> · **Distinct installed packages:** <n> · **Direct dependencies:** <n>

## 1. Summary

<Three to five bullets. Each one states a fact and its consequence — not a category heading.
Lead with whatever a maintainer would want to know if they read nothing else.>

- <e.g. "One production dependency, `@fastify/autoload`, is declared but never imported — server/src/modules/index.ts:23 explains why it was abandoned. Safe to drop.">
- <e.g. "`server` and `reviewer-core` import each other through path aliases, so neither can be extracted without the other.">
- <e.g. "Six copies of esbuild across the packages account for ~48 MB of duplicated install.">

## 2. Scale at a glance

| Metric | Value |
|---|---|
| Packages | <n> |
| Direct dependencies (prod / dev) | <n> / <n> |
| Distinct installed packages | <n> |
| Installed footprint (logical, deduped) | <n> MB |
| Names installed at 2+ versions | <n> |
| Names with version drift across packages | <n> |

## 3. Package map

<Mermaid package graph — see references/diagrams.md. Edges are tsconfig path aliases, not
workspace links; say so in one line beneath the diagram so nobody goes looking for `workspace:*`.>

| Package | Path | Manager | Direct deps | Install footprint | Source files |
|---|---|---|---|---|---|
| <@scope/name> | `<dir>` | <pnpm> | <n> | <n> MB | <n> |

<One or two sentences on what the shape of the graph means — a cycle, a hub, an isolated package.>

## 4. Component map — `<largest package>`

<Mermaid component graph for the package with the most source files. Top edges only.>

<One or two sentences: which component is the hub, which direction the dependencies run, anything
that contradicts the documented architecture.>

## 5. What each dependency weighs (installed)

Sizes are logical file sizes of the package plus its transitive closure. pnpm hard-links shared
files, so real disk use is lower; the numbers are for comparing dependencies against each other,
not for predicting free space.

### <package name>

| Dependency | Kind | Version | Own size | With transitives | Transitive count | Usage |
|---|---|---|---|---|---|---|
| <name> | prod | <x.y.z> | <n> MB | <n> MB | <n> | source |

<Repeat per package, or — if there are many packages — one table of the top 15 dependencies
repo-wide plus a per-package footprint summary. Do not sum the "with transitives" column: shared
transitives are counted once per dependent and the total would be meaningless.>

## 6. What the browser downloads *(omit if there is no client app)*

<If only a dev build exists, state that plainly and say which command would populate this section.>

| Dependency | Ships to browser | Loaded eagerly | Client import sites | Example site |
|---|---|---|---|---|
| <name> | yes | yes | <n> | `<path>` |

<When a production build is available, add measured per-route First Load JS and the largest chunks.
"Ships" means the import is reachable from a `'use client'` boundary — including files that carry no
directive of their own but are imported by one.>

## 7. Findings

<Ranked, most consequential first. One block each. Severity from references/prioritisation.md.>

### F1 · <short title> — `P<n> · <category>`

- **What:** <one sentence stating the problem>
- **Evidence:** <file:line, a measured number, or the collector field that shows it>
- **Impact:** <who pays for this, and how much>
- **Action:** <the concrete change — a command, an edit, a file to open>
- **Effort:** <S | M | L>

## 8. Action plan

| Priority | Finding | Action | Effort | Owner |
|---|---|---|---|---|
| Now | F1 | <action> | S | <blank for the team to fill> |
| Next | F3 | <action> | M | |
| Later | F5 | <action> | L | |

## 9. Method and caveats

- Data collected by `.claude/skills/dependency-checker/scripts/collect.mjs` and `bundle.mjs` on <date>.
- Sizes are logical bytes, excluding nested `node_modules` so transitives are never double-counted.
- Usage detection is static: imports, string literals, package scripts (matched via `bin` names),
  config files, and root-level tooling. <List anything you verified by hand, and anything you could not.>
- <Any package that could not be measured, and why.>
````

---

## Ledger stub

`docs/dependencies/ledger.md` — one row per audit, so the next run shows direction rather than a
fresh snapshot. Create it on the first run:

````markdown
# Dependency audit ledger

| Date | Packages | Direct deps | Installed (MB) | Duplicated names | Drifted names | Findings (P1/P2) | Report |
|---|---|---|---|---|---|---|---|
| <YYYY-MM-DD> | <n> | <n> | <n> | <n> | <n> | <n>/<n> | [report](<YYYY-MM-DD>-dependencies.md) |
````

## Tone

Write for a colleague who will act on this, not for a dashboard.

- Numbers carry units and a comparison: "≈48 MB, about a third of the server install" beats "48234112 bytes".
- Findings name a file, not a vibe.
- If a signal is weak, say it is weak in the finding itself rather than in a footnote nobody reads.
- Resist padding. A report with four real findings is more useful than one with twenty, eleven of
  which are "consider upgrading to the latest version".
