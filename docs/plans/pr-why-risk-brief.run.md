# Run — PR Why + Risk Brief
Plan: docs/plans/pr-why-risk-brief.md (31 tasks / 6 phases)
Spec: specs/SPEC-02-pr-why-risk-brief/SPEC-02.md (23 ACs, Status: approved)
Mode: multi-agent

Pre-run commits: 42f60c8 spec · c6d5dc9 AC-23 · 0ef1464 plan

## Pre-flight
- 31 tasks (T1–T31), all with Type and Owned paths
- No dependency cycles, no dependencies on missing tasks
- No concurrent owned-path conflicts (service.ts and BriefCard.tsx are sequential chains)
- Traceability: 23/23 ACs, 12/12 ECs, 8/8 NFRs

## Stages
- [~] implement — phase 1 (T1) → ae57af3 · gate green (server 114 tests, client 37, typecheck clean vs baseline)
- [ ] phase 2 in flight — done: T4 T5 T13 · running: T2 T6 T7 T12 T14 T15 T28 T30 · held: T3 (depends on T2)
- [ ] verify
- [ ] review
- [ ] close

## Open
- PLAN INCONSISTENCY: Phase 2's header says "every task here depends only on T1
  (or nothing)", but T3 declares Depends-on: T2. Owned paths do not collide, but
  T3 imports T2's types/constants. T3 held back and dispatched after T2 lands.

## Interface notes for later tasks (cross-boundary tracking)
- T25 ReviewFocusCard props: `prId`, `repoFullName?: string | null`, `headSha?: string | null`
  — matching the FindingsTab/FindingCard convention. T27 must thread all three from
  page.tsx through OverviewTab, which today passes only prBody + prId.
- T16 BriefCard takes repoFullName + headSha as props for the same reason.
- T8 consumes fitToBudget's THIRD field `tokens` for BriefMeta.input_tokens_measured.

## For plan-verifier (Stage 2)
- AC-16 says "present a plain-language statement of why generation failed" for BOTH
  failure branches. The no-prior branch now renders reason-keyed copy. The WITH-PRIOR
  branch renders only the chip "Couldn't update - showing the previous brief" and no
  cause sentence - which matches design/states/FailedWithPrior.dc.html exactly.
  Judge whether the chip satisfies the criterion or whether that branch needs a cause
  sentence too (which would deviate from the approved artboard). Flagged by the
  implementer, not silently expanded.

## For the architecture review
- T9 service.ts `classifyThrow()` separates invalid_result from model_error by testing
  the error message for the substring "schema". Defensible (MockLLMProvider and the real
  adapters both use that wording) but brittle — a provider rewording its errors would
  silently reclassify every validation failure as a model error. Raise at Stage 3.
- T31 added `if (data === undefined) return null` in BriefCard.tsx; it is load-bearing
  (without it the shared testids race the mocked fetch and T16's anatomy tests break).
  Recorded in client/insights/INSIGHTS.md. Do not let a later task strip it.

## Test debt (test-writer is off)
Phase 1 — T1 DID write contract assertions in server/test/contracts.test.ts,
so AC-4 and EC-10 are genuinely executed, not debt.

## Notes
- Server typecheck baseline: 9 pre-existing TS18048 errors in
  src/modules/reviews/repository/run.repo.severity.test.ts. Verified at HEAD
  before T1. Not this feature's; do not let a later phase "fix" them silently.
- T1 also edited server/insights/INSIGHTS.md, outside its declared Owned paths.
  Benign (documentation of a nullable-vs-nullish decision) and kept, but the
  owned-path discipline did not hold. Watch for this in wider phases.
- The run-plan skill claims server/ has one unit test; it actually has 18 files
  / 114 tests. The phase gate is more meaningful than the skill assumes.

## Deferred
- Pre-existing arch-check contracts-in-sync violations: eval-ci.ts, knowledge.ts,
  productionize.ts — real drift, out of SPEC-02 scope. NFR-8 narrowed to
  "count does not increase (3) and brief.ts is not among them" (plan T30).
