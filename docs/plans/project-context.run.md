# Run — project-context

Plan: docs/plans/project-context.md — 20 tasks / 5 phases
Spec: specs/SPEC-01-project-context/SPEC-01.md — Status: approved
Mode: multi-agent (per plan `Execution mode`; not overridden)
Started: 2026-08-28

## Stages
- [x] implement — P1 T1 → f23e055 · P2 T2–T7 → a901c4a · P3 T8,T9,T13 → cac509a ·
      P3 T10–T12 → c23f425 · P4 T14,T15,T18 → 30e55c8 · P4 T16,T17 → dc31af8 ·
      P5 T19,T20 → 3abbcdb
- [x] verify — arch-check: 3 violations, all pre-existing (5 before this feature; T1 fixed
      platform.ts and trace.ts). plan-verifier Mode 1: 35/36 criteria implementation-done,
      EC-4 partial → fixed in 6ac584f. Re-gated clean.
- [x] review — architecture-reviewer: PASS, 0 critical / 0 high / 1 low. The low is another
      occurrence of di-wiring-drift (`new ContextService(container)`), matching ~23 shipped
      sites; the reviewer explicitly did not ask for reconciliation. Deferred, no fix round run.
- [ ] close — spec Status set to implemented; matrix Commit column filled; doc-writer running
- [ ] verify
- [ ] review
- [ ] close

## Pre-flight (Stage 0)

Passed:
- Concurrent `Owned paths` — no overlap in any phase. The only shared pair
  (T10/T11 on `modules/context/service.ts` + `routes.ts`) is separated by a
  `Depends-on` edge, so the two never run at once.
- Dependency graph — acyclic; every `Depends-on` points at an earlier task that exists.
- Criteria coverage — all 36 (AC-1…18, EC-1…10, NFR-1…8) have an owning task.
  No orphan criterion, no orphan task.
- Symbols the briefs tell implementers to import all exist:
  `MAX_FILE_SIZE`/`MAX_INDEXED_FILES`/`EXCLUDED_DIRS` (`repo-intel/constants.ts:17,42,43`),
  `regexScan` (`skills/scanner.ts:58`), `currentHead` (`git/simple-git.ts:90`).
- Migration `0011` is genuinely the next slot — journal ends at `0010_skill_threat_level`.

Resolved by the user on 2026-08-28 — "run as planned":
- **B-1 — two tasks edit a module their `Type` does not route to.**
  - T1 `Type: backend` owns `client/src/vendor/shared/contracts/trace.ts` and `platform.ts`.
  - T5 `Type: core` owns `server/src/platform/prompt.ts` and `server/test/prompt-structured.test.ts`.
  Both are deliberate in the plan (contract copies must stay byte-identical; the server file is a
  re-export shim). Splitting either across two agents would guarantee the drift `arch-check.sh`
  rule `contracts-in-sync` exists to catch. Recommendation was to proceed as planned;
  the user agreed, so T1 and T5 dispatch unsplit.

Nits folded into dispatch, not blocking:
- N-1 — the plan writes `container.git.currentHead()`; the real signature is
  `currentHead(repo: RepoRef)` (`simple-git.ts:90`). Corrected in the T10 and T12 briefs.
- N-2 — the working tree carries 22 unrelated uncommitted entries (the lesson-5 `.claude/`
  tooling, `specs/`, `scripts/arch-check.sh`, this plan). Phase commits are staged by explicit
  owned path — never `git commit -a`.

## Open
- **Plan defect, non-blocking:** T1's `Acceptance` demands "server, client, mcp-server and
  reviewer-core typecheck all pass". That is unsatisfiable for a barrier task that widens a
  contract while its two consumers are owned by T12 and T18. The bar was replaced with
  "no new error beyond the recorded baseline" and every Phase 2 brief carries the baseline.

## Typecheck baseline (compare every phase gate against THIS, not against zero)
Recorded after T1 landed. T1 widened a shared contract without its two consumers,
which are owned by downstream tasks — so the tree is legitimately red until T18.
- server: 10 errors = 9 pre-existing in `modules/reviews/repository/run.repo.severity.test.ts`
  + 1 in `platform/trace-builder.ts` (clears at T12)
- client: 1 error in `.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx` (clears at T18)
- reviewer-core: clean, must stay clean
Suites at baseline: server 110 pass / client 37 pass / reviewer-core 23 pass.

## Test debt (test-writer is off)
Phase 1:
- NFR-8 — `server/test/contracts.test.ts` — WRITTEN (pre-existing file, updated by T1)
Phase 2 (dispatched with an explicit "do not author tests" instruction):
- AC-16 — unit, `server/test/context-path-guard.test.ts` — NOT WRITTEN
  ⚠ security-critical: path containment is the only guard between a stored path and an
  arbitrary host-file read reaching a prompt. Shipping unverified.
  Note: T3 exercised every Acceptance case with a throwaway scratchpad script and DELETED it,
  so the module behaves correctly but no reproducible evidence survives in the repo.
- AC-12 / AC-13 / EC-9 — unit, `server/test/context-ordering.test.ts` — NOT WRITTEN
- EC-5 — unit, `server/test/tokenizer.test.ts` — NOT WRITTEN
- EC-6 / EC-8 — unit, 3 tests in `reviewer-core/test/prompt.test.ts` — NOT WRITTEN
  (EC-6's mechanism, `wrapUntrusted` escaping, pre-dates this feature and is unchanged)
- NFR-7 (schema half) — no test of its own; behavioural cover is T9's `.it.test.ts`
Phase 3:
- NFR-2 / EC-3 / EC-4 — unit, `server/test/context-scanner.test.ts` — NOT WRITTEN
  (T8 verified every Acceptance case against a live mkdtemp fixture, then discarded it)
- AC-4 — integration, `server/test/context-repo.it.test.ts` — NOT WRITTEN
  ⚠ AC-4's entire acceptance IS that fixture (direct on A + skill on B,C = 3). The DISTINCT
  aggregation was hand-traced against the fixture by T9, never executed.
- AC-1 / AC-3 / EC-1 / EC-2 / NFR-1 — integration, `server/test/context-api.it.test.ts` — NOT WRITTEN

## Deferred
- **Backfill `server/src/db/migrations/meta/0010_snapshot.json`** — never committed (commit
  86178b4 added 0010's SQL and 0009's snapshot but no 0010 snapshot), so `drizzle-kit` diffs
  against 0009 and re-emits a `skills.threat_level` ALTER that already ran. T2 trimmed that one
  statement out of 0011 by hand; verified 0011_snapshot.json does carry the column, and a fresh
  DB replays 0000→0011 correctly. Anyone generating the next migration hits this again.
  Out of scope for SPEC-01 — it is pre-existing migration hygiene.
- **`scripts/e2e.sh` header comment is now stale** — it states `acme/payments-api` is the only
  seeded repo; T13 added a second, clone-less one. Outside T13's Owned paths, so left alone.

## Open questions raised by implementers (need the user's call)
- **Multiple matching roots in one path.** T8 hit `docs/specs/x.md`, where two context-root
  segments match. No AC covers it. T8 chose "outermost wins" (`root: 'docs'`) and documented
  the choice in `scanner.ts` rather than deciding silently. Confirm or overturn.

## Notes for the record
- T5 also migrated `server/test/prompt-callers.test.ts` (not in its Owned paths) because the
  `specs` type change stopped it compiling. No other task owns that file; accepted.
- T2 ran `pnpm db:migrate` against the already-running local Postgres container, so the dev
  database now carries the four new tables.
- T13 ran `pnpm db:seed` twice against that same live database, so it now holds the fixture
  clone rows. That database also has a hand-added `AlexLoyko/dev-digest` repo older than any
  seeded row, which sorts before `acme/payments-api` there — the isolated e2e DB is unaffected.
- **Caught at the wave-1 gate:** T8 and T9, running in parallel, each declared their own
  `ContextRoot` and their own copy of the threat-level union. Typecheck could not see it — the
  members were identical. Sent back to T9; `constants.ts` now owns `ContextRoot` (derived from
  `CONTEXT_ROOT_DIRS`, so type and runtime cannot drift) and the threat level reuses
  `skills/scanner.ts`'s existing union.
