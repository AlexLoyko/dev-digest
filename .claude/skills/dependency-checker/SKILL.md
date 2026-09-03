---
name: dependency-checker
description: >
  Repository-wide dependency audit across DevDigest's packages: inventory every external and
  internal dependency, measure what each one weighs on disk and in the browser bundle, draw the
  package and component graphs, and finish with a prioritised, actionable list of recommendations.
  TRIGGER when: "check our dependencies", "dependency audit", "dependency report", "dependency
  graph", "what do we depend on", "how much does X weigh", "why is node_modules so big", "which
  packages are unused", "can we drop this library", "bundle size", "version drift", "duplicate
  packages", before a dependency upgrade sweep, or when onboarding someone who asks how the
  packages fit together. Use it even when the request covers only one slice (just the diagram,
  just the sizes) — run the collectors and answer from measured data instead of reading
  package.json and guessing.
  Does NOT cover: CVE and vulnerability scanning (use `pnpm audit` or the `security` skill),
  Drizzle/Fastify/Zod API usage (use those skills), or the layer rules inside a server module
  (use onion-architecture).
---

# Dependency Checker

> **Measure first, advise second.** Every number in the report comes from a collector script; every
> recommendation comes from you.

This repo already draws that line for architecture rules: `scripts/arch-check.sh` runs the mechanical
greps for free so that no model spends a context window doing arithmetic it will get subtly wrong.
Dependency auditing works the same way. Two scripts produce the facts; your job is the part a script
cannot do — deciding what matters, in what order, and why.

## When to invoke

- Someone asks what the repo depends on, or how the packages relate to each other
- `node_modules` got big, a build got slow, or a page got heavy, and nobody knows which dependency did it
- Before an upgrade sweep, to see which versions have drifted apart across packages
- Onboarding: a new developer needs the dependency map in one readable page
- A cleanup pass: which dependencies are declared but nothing uses them

## The two collectors

Run both from the repo root. They are hermetic — no network, no installs, no writes outside `--out`.

```bash
# 1. Inventory: packages, sizes, transitive closures, usage, drift, duplicates, component graph
node .claude/skills/dependency-checker/scripts/collect.mjs --out /tmp/dep.json --pretty

# 2. Browser cost: which dependencies reach the client bundle, and measured chunk sizes
node .claude/skills/dependency-checker/scripts/bundle.mjs --app client --out /tmp/bundle.json --pretty
```

`collect.mjs` takes a couple of seconds on this repo. Read the JSON with `jq` rather than dumping it
whole — it is ~70 KB, and pulling all of it into context buys nothing a targeted query doesn't.

Useful queries to start from:

```bash
jq -r '.totals' /tmp/dep.json
jq -r '.packages[] | "\(.dir)\t\(.dependencies|length) deps\t\((.installFootprintBytes/1048576)|floor)MB"' /tmp/dep.json
jq -r '.packages[] | .dir as $d | .dependencies[] | select(.usage=="none" or .usage=="repo-tooling")
        | "\($d)\t\(.name)\t\(.kind)\t\(.usage)"' /tmp/dep.json
jq -r '.drift[] | "\(.name): " + (.uses|map(.pkg+"="+.range)|join(", "))' /tmp/dep.json
jq -r '.duplicates[:10][] | "\(.name)\t\(.copies) copies\t\((.wastedBytes/1048576)|floor)MB"' /tmp/dep.json
jq -r '.packages[] | .dir as $d | .phantomInstalled[] | "\($d)\t\(.name)@\(.version)\t\(.usage)"' /tmp/dep.json
jq -r '.reachability[] | select(.shipsToBrowser)
        | "\(.name)\teager=\(.eagerlyLoaded)\t\(.confidence)"' /tmp/bundle.json
jq -r '.reachability[] | select(.unreferencedSites > 0) | "\(.name)\tdead sites=\(.unreferencedSites)"' /tmp/bundle.json
```

## Workflow

**Step 1 — collect.** Run both scripts. Never quote sizes from a development build — dev chunks are
unminified and would overstate every number several-fold.

If `bundle.json` reports `build.available: false`, static reachability still gives you the shape of
the answer; say in the report that measured sizes are missing rather than quietly dropping the
section. A production build is the only thing that settles a `via-barrel-only` case, so when the
findings hinge on one, *offer* to run it — it takes minutes and it is the user's machine. Build a
copy so the working `.next` survives:

```bash
rsync -a --exclude .next --exclude node_modules client/ /tmp/dc-build/
ln -s "$PWD/client/node_modules" /tmp/dc-build/node_modules
cd /tmp/dc-build && pnpm build   # then point bundle.mjs at --app /tmp/dc-build
```

**Step 2 — read the data honestly.** The table below explains what each signal is worth. The single
most damaging thing you can do here is present a heuristic as a fact: a wrong "this dependency is
unused, delete it" costs someone an afternoon and their trust in the whole report.

**Step 3 — draw the graphs.** Two Mermaid diagrams, per `references/diagrams.md`: the package graph
(how the packages depend on each other) and the component graph for the largest package. Keep each
under ~15 nodes; a diagram nobody can read is decoration, not information.

**Step 4 — prioritise.** Apply the rubric in `references/prioritisation.md`. Rank by impact on people,
not by megabytes: a 2 MB library every visitor downloads outranks a 40 MB dev tool only CI installs.

**Step 5 — write the report** to `docs/dependencies/<YYYY-MM-DD>-dependencies.md`, following
`references/report-template.md`. Then append one row to `docs/dependencies/ledger.md` (create it from
the template's ledger stub if missing) so consecutive audits can be compared — a dependency report is
far more useful as a trend than as a snapshot.

## Reading the data honestly

| Signal | What it really means | How to report it |
|---|---|---|
| `selfBytes` / `closureBytes` | Logical file sizes. pnpm hard-links packages, so real disk use is lower than the sum. | "≈X MB installed", never "X MB of disk" |
| `installFootprintBytes` | Deduped union of a package's dependency closures — what that package costs to install. | Safe to compare between packages |
| Sum of `closureBytes` | Double-counts shared transitives (react, @types) once per dependent. | Never sum these for a total; use the footprint |
| `usage: source` | Imported in source. Strong evidence. | State plainly |
| `usage: runtime-string` | Named as a string, not imported — a pino transport, a plugin looked up by name. | Used; do not propose removal |
| `usage: script` / `types` | Runs from a package script (matched via its `bin` names), or is a `@types/*` package tsc consumes implicitly. | Used |
| `usage: config` | Referenced from a config file in that package. | Used |
| `usage: repo-tooling` | Referenced *only* by root-level tooling, which may belong to a sibling package. Weak evidence. | "Worth a look" — never "delete this" |
| `usage: none` | Nothing in the package, its configs, its scripts, or the root tooling mentions it. | The one honest removal candidate — and still verify with `rg -a` first |
| `phantomInstalled` | Installed at the top level, declared nowhere, and not a transitive of anything declared. Usually a tool invoked as a binary, which no import scan can see. | A P1: it works until someone runs a clean install |
| `staleInstalls` | Count and bytes of top-level packages nothing declares *and* nothing references — leftovers from removed dependencies. | One aggregate line. Listing forty of these buries the phantom that matters |
| `installed: null` | Declared but not resolvable on disk — a stale or never-run install. Its sizes come back as zeros. | A finding in itself. Never read the zeros as "this one is small" |
| `undeclared` | Imported but not declared here; resolves today through a hoisted or sibling install. | Real risk: breaks on a clean CI checkout |
| `shipsToBrowser` | A route reaches this import, across a `'use client'` boundary. Route-reachability is the point: a client component nothing routes to ships nothing. | This is the cost users pay |
| `eagerlyLoaded` | Ships and is not behind `next/dynamic` or `import()` — including files that are themselves only reached lazily. | The actionable bundle finding |
| `confidence: certain` | At least one eager path reaches it without passing through a re-export barrel. | Report as shipping |
| `confidence: via-barrel-only` | Every path runs through a barrel (`export * from …`). The bundler decides these per *export*; this tool only sees whole files, so it cannot tell which side it lands on. Genuinely unknown — measured on this repo, some such packages ship and some do not. | "Reachable, but a barrel hides whether it ships." Never open a P2 bundle finding on one without a production build |
| `unreferencedSites` | Imported, but no route reaches that file. Dead code — and possibly a dead dependency. | A finding in its own right, and a cheaper win than lazy-loading |

**Verify before you accuse.** Any `usage: none` finding is one search away from being confirmed or
withdrawn. Run it. Quote the file and line that settles it — a report that shows its evidence gets
acted on; one that asserts gets argued with.

**Verify with `rg -a`, not bare `grep` and not plain `rg`.** Three TypeScript files here each contain
a stray NUL byte, so every search tool classifies them as binary and skips them — `grep -r` silently,
`rg` silently in recursive mode, and `rg` on an explicit path with only a "binary file matches" line
instead of the match. One of the three is `server/src/adapters/depgraph/index.ts:17`, which holds the
*only* import of `dependency-cruiser`. So the default search "confirms" that a production dependency
is unused, which is the most expensive way this report can be wrong:

```bash
rg -na "dependency-cruiser" server/src   # -a / --text: search them anyway
```

The collectors read files directly and are not affected — which is why `collect.mjs` classifies
`dependency-cruiser` as `usage: source` while a search says nothing uses it. When the script and your
grep disagree in that direction, the script is right.

**Two different questions.** "Heavy on disk" and "heavy for users" are unrelated. `typescript` is
~22 MB installed and 0 bytes in the browser; a charting library is the reverse. Keep the two metrics
in separate tables and never blend them into a single ranking.

## Prioritising findings

Full rubric in `references/prioritisation.md`. In short, rank each finding by who it hurts:

1. **Correctness risk** — undeclared dependencies, version drift on a runtime library, dependency cycles
2. **User-visible cost** — heavy packages shipping eagerly to the browser
3. **Developer cost** — install size, duplicate installs, slow tooling
4. **Hygiene** — unused declarations, drift on dev-only tooling

Every recommendation needs an owner-sized action: the file to open, the command to run, or the line to
delete. "Consider reviewing the bundle" helps nobody.

## Related skills

| Skill | What it covers instead |
|---|---|
| `onion-architecture` | Layer rules and import direction *inside* `server/src/modules` |
| `mermaid-diagram` | General Mermaid syntax, if a diagram needs a shape this skill doesn't describe |
| `security` | Vulnerabilities and CVEs in those dependencies |
| `next-best-practices` | Fixing a bundle finding — RSC boundaries, `next/dynamic`, import optimisation |
