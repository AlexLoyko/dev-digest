# `reviewer-core/specs` — spec-driven development

**The spec is written and accepted before the implementation.** A spec captures intent
and acceptance criteria; it is not documentation of code that already exists (that's
[`../docs/`](../docs/)) and not a list of traps (that's
[`../INSIGHTS.md`](../INSIGHTS.md)).

## Rules

- **One file per feature**, named `NNNN-slug.md` — zero-padded, monotonic within this
  package. `0001-map-reduce-strategy.md`, `0002-phantom-gate.md`.
- **Status lifecycle:** `draft → accepted → shipped`. Implementation starts when a spec
  is `accepted`. A shipped spec is **never deleted** — it is the record of why the code
  looks the way it does.
- **A feature that spans packages gets a spec in each package it touches**, each
  covering that package's slice, cross-referenced by filename. An engine change almost
  always pairs with a `server/specs/` spec for the I/O that feeds it.
- Because this package is **pure**, every spec must state how the change stays free of
  DB, GitHub, and filesystem access — new inputs arrive as arguments, not as lookups.
- A spec that adds a prompt slot must state the **omit-when-empty** guarantee: with the
  slot unused, the assembled prompt is byte-identical to not having the feature.

## Shape

Copy this into a new spec file.

```markdown
# NNNN — <title>

Status: draft
Lesson: L0N | n/a
Packages: reviewer-core, server

## Intent
What problem, why now, who for.

## Behaviour
What changes in the pipeline: assembly → LLM → structured output → grounding.

## Acceptance
- [ ] Checkable criterion
- [ ] Purity preserved: no DB / GitHub / FS
- [ ] Unused slot → identical prompt (if it adds one)

## Contracts
New exports from `src/index.ts`; @devdigest/shared changes (edit the SERVER copy,
then mirror into the client copy).

## Out of scope
Explicit non-goals.

## Verification
Which hermetic test in `test/` proves it, with a stubbed `LLMProvider`.
```

## Index

_Nothing here yet._ List accepted and shipped specs here as they land.
