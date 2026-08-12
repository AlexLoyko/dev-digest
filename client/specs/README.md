# `client/specs` — spec-driven development

**The spec is written and accepted before the implementation.** A spec captures intent
and acceptance criteria; it is not documentation of code that already exists (that's
[`../docs/`](../docs/)) and not a list of traps (that's
[`../INSIGHTS.md`](../INSIGHTS.md)).

## Rules

- **One file per feature**, named `NNNN-slug.md` — zero-padded, monotonic within this
  package. `0001-severity-filter.md`, `0002-pr-brief-card.md`.
- **Status lifecycle:** `draft → accepted → shipped`. Implementation starts when a spec
  is `accepted`. A shipped spec is **never deleted** — it is the record of why the code
  looks the way it does.
- **A feature that spans packages gets a spec in each package it touches**, each
  covering that package's slice, cross-referenced by filename. UI specs usually pair
  with a `server/specs/` spec for the endpoint.
- Acceptance criteria must be **checkable**, and should name the states the UI has to
  handle: loading, empty, error, and the happy path.
- This repo's roadmap is the course lessons L01–L08
  ([`../../README.md`](../../README.md)) — name the lesson when a spec implements one.

## Shape

Copy this into a new spec file.

```markdown
# NNNN — <title>

Status: draft
Lesson: L0N | n/a
Packages: client, server

## Intent
What problem, why now, who for.

## Behaviour
The change from the user's point of view. Name the route(s) it appears on.

## Acceptance
- [ ] Checkable criterion
- [ ] Loading / empty / error states

## Contracts
Hooks in `src/lib/hooks/*` and the endpoints they call; @devdigest/shared types
consumed; new `messages/en/*.json` keys.

## Out of scope
Explicit non-goals.

## Verification
Which suite proves it — colocated `*.test.tsx` (vitest + jsdom), or an e2e flow in
`e2e/specs/`.
```

## Index

| Spec | Status | Lesson |
|---|---|---|
| [`0001-run-cost-badge.md`](0001-run-cost-badge.md) — cost on the PR list, the run timeline, and the trace drawer | accepted | L01 |
| [`0002-pr-intent-layer.md`](0002-pr-intent-layer.md) — the Overview "PR BRIEF" grid, `IntentCard`, `IntentConfidencePill`, and the findings/trace surfaces | accepted | L03 |
