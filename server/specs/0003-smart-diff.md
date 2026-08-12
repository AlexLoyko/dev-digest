# 0003 — Smart Diff: role-grouped, reviewer-ordered changed files

Status: accepted
Lesson: L03
Packages: server

Client slice: [`client/specs/0003-smart-diff.md`](../../client/specs/0003-smart-diff.md).

## Intent

A PR's changed files arrive as one flat list ordered by whatever GitHub returned. A
9-file PR mixes the two files carrying the substance of the change with a lockfile, a
barrel re-export, and a snapshot — and nothing in the payload says which is which. The
reviewer pays the same attention cost per file regardless of what the file is worth.

Smart Diff groups changed files into **core / wiring / boilerplate** and orders them so
the files most worth reading come first, then annotates each with the lines that already
carry findings.

The classification is **pure logic over `pr_files`** — path, additions, deletions. No
model call, no cached artifact, no new table. That is a deliberate constraint, not a
simplification: it means the grouping is available the instant a PR is imported, long
before any review has run, and it costs nothing to recompute on every request. The
second half — `finding_lines` — fills in on its own once any agent review completes,
because it is derived from the findings already persisted for that PR.

This is the second half of L03; the first half is the intent layer
([`0002-pr-intent-layer.md`](0002-pr-intent-layer.md)).

## Behaviour

### `GET /pulls/:id/smart-diff` → `SmartDiff`

Workspace-scoped like every other `/pulls/:id/*` route; an unknown or foreign PR is a
404. Computed per request from two existing reads — `getPrFiles` and `reviewsForPull` —
with no write of any kind.

### Classification

`classifyFile(path)` tests in a fixed order, first match wins:

1. `BOILERPLATE_RE` — lockfiles, `package.json`, `tsconfig`, `.md`, `.snap`, licences,
   `.gitignore`, `dist/`, `.generated.`, `migrations/`, **and tests**
   (`*.test.*` / `*.spec.*`, `test/`, `tests/`, `__tests__/`).
2. `WIRING_RE` — `index.ts`/`index.tsx`/`index.js`, `route.ts`/`routes.ts`, `config.`,
   `.module.`, `setup.`, `register`, `barrel`.
3. otherwise `core`.

Order is load-bearing: `dist/index.ts` is boilerplate, not wiring, and a
`migrations/0001_x.sql` stays boilerplate even though it sits under a folder a wiring
rule might otherwise claim. Both patterns are case-insensitive.

Tests are boilerplate deliberately. They are not generated, but they are not the
substance of the change either, and they are the largest source of changed lines in
this repo: classifying them `core` put a 746-line `intent-service.test.ts` above the
233-line service it tests, which is backwards for a "review closely" bucket. The
segment anchors matter — `src/latest/value.ts` must not match.

### `finding_lines`

Per file, the union of `start_line..end_line` over every persisted finding whose `file`
equals that path — deduped, ascending.

- A finding with a null `start_line` is skipped: it cannot be anchored to a line.
- A null `end_line` collapses to the single `start_line`.
- An inverted range (`end < start`) collapses to `start_line` rather than producing an
  empty span.
- The span is clamped to `MAX_FINDING_LINE_SPAN = 500` lines. A model can emit
  `1..99999`; without the clamp one bad finding allocates a 99 999-element array and
  paints an entire file as findings.
- **No filtering by accepted/dismissed.** The client renders severity chips from its
  own findings query, and a server that silently dropped dismissed findings would
  disagree with it about which files auto-expand.

### Ordering

Groups are emitted in the fixed order `core → wiring → boilerplate`, and a role with no
files is **omitted** rather than emitted empty.

Within a group, files sort by: finding-line count **desc** → `additions + deletions`
**desc** → `path` **asc**. The path tiebreak makes the response deterministic for a
given input, which is what makes it assertable in a test.

### Split nudge

- `total_lines` = Σ(`additions` + `deletions`) over every changed file.
- `too_big` = `total_lines > 400` **or** file count `> 12`.
- `proposed_splits` = one entry per non-empty group when `too_big`
  (`{ name: role, files: [paths] }`); `[]` otherwise.

### Not derived

`pseudocode_summary` is always `null`. The contract carries the field and the response
always populates it explicitly, so the shape is honest; filling it needs a model and is
out of scope (below).

## Acceptance

- [ ] `GET /pulls/:id/smart-diff` returns a document that `SmartDiff.parse` accepts.
- [ ] A PR with zero reviews returns groups with `finding_lines: []` on every file —
      i.e. the endpoint is useful before any review has run.
- [ ] `classifyFile` maps `dist/index.ts` → `boilerplate`, `src/api/index.ts` →
      `wiring`, `src/middleware/ratelimit.ts` → `core`.
- [ ] A finding spanning lines 28–30 on `a.ts` yields `finding_lines: [28, 29, 30]`;
      two overlapping findings yield each line once.
- [ ] A finding with `start_line: 1, end_line: 99999` yields exactly 500 lines.
- [ ] A role with no changed files does not appear in `groups`.
- [ ] Within a group, a file with findings sorts above a larger file without them.
- [ ] 401 changed lines sets `too_big: true`; 400 does not. 13 files sets `too_big:
      true`; 12 does not.
- [ ] `proposed_splits` is `[]` whenever `too_big` is false.
- [ ] An unknown PR id returns 404.

## Contracts

**No contract change.** `SmartDiff`, `SmartDiffRole`, `SmartDiffFile`, `SmartDiffGroup`
and `ProposedSplit` already exist in both vendored copies
(`src/vendor/shared/contracts/brief.ts`), as does the `SmartDiffResponse` alias
(`contracts/review-api.ts`) — this spec is their first consumer. `contracts.test.ts` is
untouched.

**No DB change.** No table, no column, no migration. Nothing is persisted.

**Routes:** `GET /pulls/:id/smart-diff` added to the existing `reviews` module. No new
module, so `src/modules/index.ts` is untouched.

## Out of scope

- `pseudocode_summary` — a per-file "what this does" line. Needs a model call, a
  feature-model slot, and a cache keyed by head SHA; it would also defeat the
  available-on-import property above.
- Feeding the role grouping into the review prompt. Smart Diff is a reading aid for the
  human; the agent still receives the whole diff.
- `repo-intel` rank as a classification input (e.g. demoting a low-percentile `core`
  file to `wiring`). It would make the result depend on whether the repo happens to be
  indexed, and on `REPO_INTEL_ENABLED`.
- Severity on `finding_lines`. The client joins severity from its own findings query —
  see the client slice.

## Verification

Unit (`pnpm exec vitest run --exclude '**/*.it.test.ts'`):
`test/smart-diff.test.ts` covers the pure functions against the acceptance table above;
`test/smart-diff-routes.test.ts` covers route wiring and the 404. Both are hermetic —
the pure module takes rows, not a container, so no Docker lane is needed.
