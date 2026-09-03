# Prioritisation rubric

A dependency report fails in one of two ways: it lists everything and ranks nothing, or it ranks by
the metric that was easiest to measure (megabytes) rather than the one that matters (who is hurt, and
how often). This rubric exists to prevent both.

## Severity

Assign exactly one level per finding. The question is always **who pays, and how often** — not how
large the number is.

| Level | Meaning | Typical findings |
|---|---|---|
| **P1 — breaks or will break** | Something is already wrong, or a clean checkout / next install will make it wrong. | Undeclared dependency that resolves only through a hoisted install; two packages pinned to incompatible majors of a shared runtime library; a dependency cycle that blocks a documented plan |
| **P2 — users pay for it** | Every visitor downloads or waits for it. | A heavy library shipping eagerly to the browser; a large dependency pulled into the client graph by an unnecessary `'use client'` boundary |
| **P3 — developers pay for it** | Install time, CI time, disk, or cognitive load on everyone working in the repo. | Multiple installed versions of the same library; a very large dev dependency used by one script; drift that makes local behaviour differ from CI |
| **P4 — hygiene** | Nothing is broken; the repo is untidy. | A dependency declared but unused; dev-tool version drift; a package with no owner |

A finding that only *might* be true is not automatically lower severity — it is either verified and
ranked, or reported as a question. Do not invent a middle ground where a guess is presented as a P3.

## Thresholds

Absolute byte counts are meaningless without a reference point. Use ratios against the repo you are
actually looking at.

- **Heavy in the browser:** a single dependency contributing more than ~10% of the eagerly-loaded
  client graph, or any charting / markdown / editor library loaded eagerly on a route that does not
  always render it.
- **Heavy on disk:** a dependency whose closure exceeds ~15% of its package's install footprint.
- **Duplication worth reporting:** a name installed at 3+ versions, or 2 versions where the wasted
  bytes exceed ~5% of the total install.
- **Drift worth reporting:** different ranges for a *runtime* library, always. For dev tooling
  (`typescript`, `tsx`, `vitest`, `@types/node`), report it once as a single grouped hygiene finding
  rather than one finding per package — six near-identical P4s bury the P1.

Say which threshold you used when it is close. "1.9 MB of a 6 MB client graph" is arguable; "1.9 MB"
alone is not even checkable.

**An unmeasured bundle claim cannot be a P2.** P2 means users are paying, and if you have not measured
the bundle you do not know that they are. A dependency reached only through a re-export barrel
(`confidence: via-barrel-only`) is a candidate, not a finding: on this repo, measuring turned half of
those into nothing at all. Either run the build and promote it on the evidence, or file it at P4 as
"worth measuring" with the command to do so. Putting an unverified bundle claim in the "Now" column
is how a report gets someone to spend a day deleting code that was never shipped.

Note that a dead-code finding often survives the measurement anyway: if nothing routes to a
component, deleting it is right whether or not its library was being bundled. Make that the finding,
and leave the bundle question out of it.

## Choosing the recommendation

For each problem dependency, pick the *cheapest* intervention that actually solves it, in this order:

1. **Defer it** — `next/dynamic` or `import()`. No API changes, no migration. Almost always right for
   a heavy client library used on one route or behind an interaction.
2. **Narrow the import** — import the submodule rather than the barrel; move the import behind the
   RSC boundary so it never reaches the browser.
3. **Deduplicate or align** — a single version range, an override, or a shared config. Cheap, and it
   removes a class of "works on my machine" bugs.
4. **Remove it** — only when usage is `none` *and* you have grepped and found nothing.
5. **Replace it** — the most expensive option, and the one most often proposed carelessly. Only
   recommend a replacement when you can name the specific alternative, the API surface actually used,
   and roughly what the migration costs. If you cannot, write the finding as "worth evaluating" and
   say what evidence would settle it.

Never recommend removing or replacing something whose usage signal is `repo-tooling`,
`runtime-string`, `config`, or `script` — those exist precisely because static import scanning misses
real uses, and acting on them is how a tool loses its credibility.

## Effort

- **S** — one file, no behaviour change (delete a line, add a range, wrap in `dynamic()`).
- **M** — several files or a config change that needs a test run.
- **L** — migration, API change, or anything touching a public contract.

Effort is not severity. A P1 can be S (add a missing dependency), and a P4 can be L (replacing a
library nobody likes). Report both so the team can pick the cheap wins first — that is the whole
point of the action plan table.

## What not to report

- "Package X has a newer version available." That is a changelog, not an audit — unless the current
  version is the *cause* of a finding you are already making.
- Transitive dependencies nobody chose, unless they are duplicated, enormous, or the reason a direct
  dependency is heavy. Then report the direct dependency, with the transitive as evidence.
- A finding you could not verify. Ask instead, in the report's own words: "`x` appears unused, but it
  is referenced by root tooling — is it still needed by `scripts/dev.sh`?"
