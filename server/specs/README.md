# `server/specs` — spec-driven development

**The spec is written and accepted before the implementation.** A spec captures intent
and acceptance criteria; it is not documentation of code that already exists (that's
[`../docs/`](../docs/)) and not a list of traps (that's
[`../INSIGHTS.md`](../INSIGHTS.md)).

## Rules

- **One file per feature**, named `NNNN-slug.md` — zero-padded, monotonic within this
  package. `0001-run-cost-badge.md`, `0002-severity-filter.md`.
- **Status lifecycle:** `draft → accepted → shipped`. Implementation starts when a spec
  is `accepted`. A shipped spec is **never deleted** — it is the record of why the code
  looks the way it does.
- **A feature that spans packages gets a spec in each package it touches**, each
  covering that package's slice, cross-referenced by filename.
- Acceptance criteria must be **checkable**. "Fast" is not a criterion; "the findings
  list re-renders in under one frame for 200 findings" is.
- This repo's roadmap is the course lessons L01–L08
  ([`../../README.md`](../../README.md)) — name the lesson when a spec implements one.

## Shape

Copy this into a new spec file.

```markdown
# NNNN — <title>

Status: draft
Lesson: L0N | n/a
Packages: server

## Intent
What problem, why now, who for.

## Behaviour
The change from the user's point of view.

## Acceptance
- [ ] Checkable criterion
- [ ] Checkable criterion

## Contracts
@devdigest/shared additions (BOTH vendored copies), DB tables/columns + migration,
new or changed routes.

## Out of scope
Explicit non-goals.

## Verification
Which suite proves it — unit (`vitest --exclude '**/*.it.test.ts'`), integration
(`*.it.test.ts`), or an e2e flow.
```

## Index

| Spec | Status | Lesson |
|---|---|---|
| [`0001-run-cost-badge.md`](0001-run-cost-badge.md) — persist run cost and serve it on three routes | accepted | L01 |
| [`0002-pr-intent-layer.md`](0002-pr-intent-layer.md) — derive PR intent from title/body/ticket/docs/diff, cache by head SHA, serve `GET /pulls/:id/intent` | accepted | L03 |
