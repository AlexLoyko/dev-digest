# Specifications

This folder holds **cross-module specifications** — specs for features that span two or more
DevDigest packages. It is the first artifact in the Spec-Driven Development pipeline:

```
spec-creator → specs/SPEC-NN-<feature>/SPEC-NN.md
   │  [you approve → Status: approved]        ← the planner refuses a `draft`
   └─ implementation-planner → docs/plans/<feature>.md
        └─ N× implementer-<backend|ui|core|e2e>
             ├─ plan-verifier Mode 1 — is every AC built?
             ├─ architecture-reviewer ∥ test-writer
             └─ plan-verifier Mode 2 — runs each AC's `Verify:` command
                  └─ main session flips Status: implemented
```

The full pipeline, including the review and documentation steps, is in
[`.claude/agents/README.md`](../.claude/agents/README.md).

Specs are authored by the [`spec-creator`](../.claude/agents/spec-creator.md) agent, which is the
only agent allowed to write here.

## Placement rule

**Only cross-module specs live in this folder.** A spec that touches exactly one package belongs
next to that package, not here.

```
Does the feature touch more than one package?
├── YES → specs/SPEC-NN-<kebab-feature>/SPEC-NN.md          ← this folder
└── NO  → <module>/specs/SPEC-NN-<kebab-feature>/SPEC-NN.md
          (server | client | reviewer-core | e2e | mcp-server)
```

"Touches a package" means the feature adds or changes behaviour there — a UI-only feature that
consumes an existing, unchanged API is still single-module (`client`).

## Layout

Every spec is a folder, so design sources sit next to the document that cites them.

```
specs/
  README.md                          ← this file: rule + global SPEC-NN registry
  SPEC-01-blast-radius/
    SPEC-01.md
    design/                          ← only when design assets exist
      01-empty-state.png
      02-loaded.png

server/specs/
  review-flow.md                     ← legacy, untouched
  SPEC-02-github-webhooks/
    SPEC-02.md
```

## SPEC IDs

`SPEC-NN` is **globally sequential across both locations** — a module spec and a cross-module spec
never share a number. To allocate one:

1. Glob `specs/SPEC-*` and `*/specs/SPEC-*`.
2. Read the registry table below.
3. Take `max + 1`, zero-padded to two digits.
4. Write the spec file **and** append its registry row in the same pass — they always land together.

## Registry

| ID | Spec | Location | Modules | Status |
|----|------|----------|---------|--------|
| SPEC-01 | [Project Context](SPEC-01-project-context/SPEC-01.md) | `specs/SPEC-01-project-context/` | server, client | approved |

`Status` is one of `draft`, `approved`, `implemented`, `superseded`. Superseding never deletes: the
replacement names the old spec under `Supersedes:`, and the old row moves to `superseded` with a
pointer to its replacement. The old file stays on disk.

## Template

The canonical spec body. `spec-creator` writes this shape; humans reading or reviewing a spec should
expect it.

```markdown
# Spec: <feature name>
Spec ID: SPEC-NN
Status: draft | approved | implemented | superseded
Supersedes: <link to the spec this replaces, or "none">

## Problem and user
<Who has this problem, what it costs them today. No solution language.>

## Goals / Non-goals
**Goals**
- <outcome>
**Non-goals**
- <explicitly out of scope, so nobody plans it>

## User stories
- US-1: As a <role>, I want <capability>, so that <outcome>.

## Acceptance criteria (EARS)
- AC-1 (US-1): WHEN <trigger>, the system shall <response>.
  Verify: <unit | integration | e2e | manual> — <the concrete check>
- AC-2 (US-1): IF <condition>, THEN the system shall <response>.
  Verify: <…>

## Edge cases
- EC-1 (AC-1): <case> → <expected behaviour>
  Verify: <…>

## Non-functional requirements
- NFR-1 (global): <category> — <measurable bound>
  Verify: <…>
- Not applicable: <categories deliberately skipped, one line each>

## Inputs and provenance
<Every input the feature consumes, tagged by origin and cost.>
- <input> — [reused: <artifact>] — <what it provides>
- <input> — [deterministic: <module>] — <what it provides>
- <input> — [new: N LLM call(s)] — <what it provides, and why a new call is justified>

### Authoring sources
- <design file / doc / conversation> — <path or URL> — <what was taken from it>

## Untrusted inputs
- <input that crosses a trust boundary> — <how it is treated: wrapped, validated, escaped, rejected>

## Open questions
- Q-1: <question> — assumption this spec currently runs on: <assumption>

## Traceability
| US | AC | EC / NFR | Verify level |
|----|----|----------|--------------|
| US-1 | AC-1, AC-2 | EC-1, NFR-1 | e2e, unit |
```

Acceptance criteria are written in [EARS](https://alistairmavin.com/ears/) — see the `## EARS`
section of the [`spec-creator`](../.claude/agents/spec-creator.md) agent for the five patterns and
worked examples.

**This template is the source of truth.** The `spec-creator` agent carries its own copy; if the two
diverge, this file wins and the agent's copy is corrected. Two authoritative copies of the same
content always drift — keep them identical.

### Ids and traceability

`US → AC → EC` inside the spec, `AC → R<n>` in the implementation plan, `R<n> → code` in
`plan-verifier`. The ids are load-bearing: `implementation-planner` copies AC ids into its `R<n>`
list verbatim, and `plan-verifier` traces code back to them. **Never renumber** — retire a dropped
criterion in place (`AC4: removed — see SPEC-07`). Every AC names its parent US; every US has at
least one AC. The closing `## Traceability` table makes the mapping readable at a glance.

### Input provenance tags

DevDigest is an LLM-metered product, so where each input comes from is a design decision, not a
footnote. Every entry in `## Inputs and provenance` carries one tag:

| Tag | Meaning | Cost |
|---|---|---|
| `[reused: <artifact>]` | An already-generated result is read again — e.g. `[reused: L03 intent]` | free |
| `[deterministic: <module>]` | Code computes the fact, no model involved — e.g. `[deterministic: repo-intel]` | cheap, repeatable |
| `[new: N LLM call(s)]` | The feature needs a fresh model call | metered, non-deterministic |

Prefer reuse over deterministic over new, in that order, and justify every `[new: …]` in one line.
`### Authoring sources` is separate: those are inputs to *the spec*, not to the feature.

### Open questions and [NEEDS CLARIFICATION]

`[NEEDS CLARIFICATION: <the exact question>]` is the sanctioned inline marker for a point of doubt —
placed where the doubt bites, and mirrored as a `Q-n` in `## Open questions` with the assumption the
spec currently runs on. It is a `draft`-only construct: no spec moves to `approved`, and none is
handed to `implementation-planner`, while any remain open. `[TODO]` and `[TBD]` are not used.

### Verification hints

Every AC, EC, and NFR carries a one-line `Verify:` naming the cheapest level that can actually
observe the behaviour — `unit` (pure logic, `reviewer-core`), `integration` (`*.it.test.ts`, real
Postgres), `e2e` (deterministic browser flow, no LLM), or `manual` (with exact steps). It is not a
test plan; it is the seam that lets `test-writer` and `plan-verifier` do their jobs. A spec written
retroactively for shipped code names the existing test, or writes `uncovered`.

## Legacy specs

These predate the convention. They are intentionally **unnumbered, unmigrated, and never edited by
`spec-creator`**:

- `client/specs/pages.md`
- `server/specs/review-flow.md`
- `reviewer-core/specs/grounding-spec.md`
- `e2e/specs/coverage.md` (+ the `NN-*.flow.json` files)
