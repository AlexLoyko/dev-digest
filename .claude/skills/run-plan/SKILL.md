---
name: run-plan
description: >
  Executes an approved DevDigest Implementation Plan end to end. Dispatches the plan's tasks to
  parallel implementer-<type> agents phase by phase, runs the phase gate once, then arch-check,
  plan-verifier for completeness, and architecture-reviewer — each followed by a bounded remediation
  loop that actually FIXES the findings instead of just reporting them. Closes by flipping the spec
  to implemented and updating docs. Never pushes.
  TRIGGER when: "/run-plan", "run the plan", "execute the implementation plan", "implement
  docs/plans/<x>.md", "build out this plan", or the user hands over an approved plan and asks to
  build it.
  Does NOT cover: writing specs (run spec-creator manually), writing plans (run
  implementation-planner manually), writing tests (test-writer is currently off), or git push
  (pr-self-review owns that gate).
---

# `/run-plan` — run an approved Implementation Plan

> **Вхід — готовий план. Ти оркеструєш виконання, не пишеш код сам.**

You are the **orchestrator**. You dispatch agents, run the phase gate, carry findings between
stages, drive the remediation rounds, and keep a run journal. You never write product code, specs,
plans, or tests yourself.

**Upstream is manual and stays manual.** `spec-creator` and `implementation-planner` are run by the
user by hand, deliberately — they are the two opus agents and the two human decision points. This
skill starts where they finish. If you are handed a request with no plan, say so and stop; do not
improvise a plan.

**`test-writer` is currently switched off** to save tokens. It is not dispatched at any stage. This
weakens the gates in a specific way — see *Test debt* below — and you must surface that honestly
rather than reporting a green run as if it were fully verified.

Prompts for every agent are in [dispatch-templates](rules/dispatch-templates.md) — use them
verbatim, especially the remediation brief. **Subagents inherit none of your context or skills**;
whatever an agent needs must be in its prompt.

## Invocation

```
/run-plan                                   # newest plan in docs/plans/
/run-plan docs/plans/blast-radius.md
/run-plan --from review                    # resume after a /clear
/run-plan --phase 2                        # run one phase only
/run-plan --dry-run                        # print the dispatch table, spawn nothing
```

| Flag | Meaning |
|---|---|
| `--plan <path>` | The plan to execute. Also accepted bare as the first argument. |
| `--from <stage>` | Resume at `implement` / `verify` / `review` / `close`. |
| `--phase N` | Execute only that phase, then stop. |
| `--mode single\|multi` | Override the plan's `Execution mode`. |
| `--max-rounds N` | Remediation rounds per gate. Default 2, hard ceiling 3. |
| `--dry-run` | Print the dispatch table and stop. |

## Stage 0 — Resolve and sanity-check

State your resolution back in three lines before doing anything.

1. **Find the plan.** Given path, or the most recently modified file in `docs/plans/` (excluding
   `*.run.md`). If you had to guess, name it and ask for confirmation.
2. **Find the spec.** From the plan's requirement ids; `specs/README.md` maps `SPEC-NN` to its file.
   A plan with `R<n>` requirements has no spec — that is legal, just note it.
3. **Pre-flight the plan.** Stop and report rather than working around any of these:
   - Tasks that would run concurrently share an `Owned path` → serialise them and say so.
   - A task has no `Type`, or its `Type` does not match the module it edits → it would route to an
     agent with the wrong skills loaded.
   - A `Depends-on` cycle, or a dependency on a task that does not exist.
   - An AC in the spec with no row in the traceability matrix → the plan already dropped it.
4. **Create the run file** `docs/plans/<feature>.run.md` (template below). This is what makes
   `--from` work after a `/clear`. The plan belongs to the planner and no agent edits it; the run
   file is yours.

```markdown
# Run — <feature>
Plan: docs/plans/<feature>.md
Spec: specs/SPEC-NN-<feature>/SPEC-NN.md (or "none — R-list plan")
Mode: multi-agent (4 implementers)

## Stages
- [x] implement — phase 1 (T0–T3) → a1b2c3d · phase 2 (T4–T7) → e4f5g6h
- [ ] verify    — 9/11 done · AC-4 partial · AC-9 missing
- [ ] review    — round 1: 6 findings (2 critical) → 4 fixed, 1 disputed, 1 deferred

## Open
- AC-9 missing → implementer-backend, round 2
- DISPUTED `di-wiring-drift` in reviews/service.ts — needs your call

## Test debt (test-writer is off)
- AC-3 — Verify: unit, reviewer-core stubbed LLMProvider — NOT WRITTEN
- AC-7 — Verify: integration, *.it.test.ts — NOT WRITTEN

## Deferred
- <finding> — <why out of scope>
```

## Stage 1 — Implement

For each phase, in DAG order:

1. **Dispatch the implementers in parallel — one message, all tasks in the phase.** One agent per
   task, routed by `Type`. Each gets **only its `dispatch` brief** from the plan, never the plan
   file. Pass the `Owned paths` of every concurrent task as the do-not-touch list.
2. **Run the phase gate once, yourself.** Only the packages the phase touched:
   ```
   cd server        && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot && pnpm typecheck
   cd client        && pnpm test --reporter=dot && pnpm typecheck
   cd reviewer-core && npm test && npm run typecheck
   ```
   N implementers each running the full suite is N times the cost for the same signal — that is why
   they run scoped checks and you run this one.

   **With `test-writer` off, `typecheck` is the real gate here.** `server/` has one unit test and
   `reviewer-core/` has none, so a green suite proves very little. Treat a typecheck failure as
   blocking and do not read a green suite as verification.
3. **Record the test debt.** For every task in the phase, copy its AC's `Verify:` hint into the run
   file's *Test debt* section marked `NOT WRITTEN`. This costs nothing and turns invisible debt into
   a list you can hand to `test-writer` later.
4. **Commit the phase**, then write the SHA into the plan's `Commit` column and the run file. You
   own that column — no agent in the chain fills it.

## Stage 2 — Verify completeness

```
./scripts/arch-check.sh
```
Four deterministic rules, zero tokens. Quote the verdict. Five vendored contracts are already
divergent before this feature (`eval-ci`, `knowledge`, `platform`, `productionize`, `trace`) —
report those as pre-existing, and only treat a contract as this feature's fault if this diff touched
one side without the other.

Then dispatch `plan-verifier` **in Mode 1**. Say "Mode 1" explicitly.

- All `done` → Stage 3.
- Any `missing` / `partial` → **remediation loop**. Fixing a gap here is far cheaper than after the
  architecture review has been written against incomplete code.

> **Mode 2 is not run while `test-writer` is off.** Mode 2's entire job is executing each AC's
> `Verify:` command; with no tests written, there is nothing to execute and it would degenerate into
> a second, more expensive Mode 1. When `test-writer` comes back, add it after Stage 3.

## Stage 3 — Review, then fix what it finds

Dispatch `architecture-reviewer` with the changed file set for this feature. It runs `arch-check.sh`
itself and covers only the rules that need judgement.

Then run the **remediation loop** over its findings. This is the stage that most often needs more
than one pass, and the loop is what makes the review worth running — an architecture review whose
findings nobody applies is a report, not a gate.

## Stage 4 — Close

1. Edit the spec's `Status: implemented` — you are the main session; the guard hook only restricts
   `spec-creator`. Skip if there is no spec.
2. Fill any remaining `Commit` cells in the traceability matrix.
3. Dispatch `doc-writer` **only if** the feature changed something a doc claims is true —
   `server/docs/api-contracts.md`, `server/docs/architecture.md`, `client/docs/ui-architecture.md`,
   `reviewer-core/docs/pipeline.md`, `e2e/docs/flows.md`. A stale doc poisons the next architecture
   review, which grounds every finding in exactly these files.
4. Report, including the test-debt list. **Do not push** — `pr-self-review` owns that gate and fires
   on `git push`. Tell the user it is ready and let them run it.

---

# The remediation loop

Used by both gates: `plan-verifier` gaps (Stage 2) and `architecture-reviewer` findings (Stage 3).
One procedure, two callers.

A gate that reports without fixing is a report. A loop that fixes without a bound is a token fire.
This is the shape that is neither.

## 1 — Triage every finding into exactly one class

Nothing is dropped silently; every finding lands in a class, and the class goes in the run file.

| Class | When | What happens |
|---|---|---|
| **fix** | Actionable, in scope, clear file owner | Dispatched this round |
| **dispute** | Contradicts a documented convention, the spec, or a deliberate decision | Escalated to the user. **Never auto-fixed.** |
| **defer** | Real, but outside this feature's scope | Recorded under `## Deferred` with a one-line reason |

Bias by severity: `critical` and `high` are `fix` unless genuinely disputable. `medium` and `low`
are `fix` when the change is small and local, `defer` otherwise.

**Dispute is a first-class outcome, not a failure.** This project has already proved a review rule
can be wrong: `di-discipline` flagged 23 sites of intentional, shipped code because the rule
contradicted the codebase. A loop that mechanically "fixes" every finding would have rewritten all
23. If a finding conflicts with what the code deliberately does, mark it `dispute`, quote both
sides, and let the user decide.

## 2 — Group by file, not by finding

Three findings in `reviews/service.ts` is **one** task with three bullets, not three agents fighting
over one file.

| File pattern | Owner |
|---|---|
| `server/**` | `implementer-backend` |
| `client/**` | `implementer-ui` |
| `reviewer-core/**` | `implementer-core` |
| `e2e/**` | `implementer-e2e` |
| `server/src/vendor/shared/contracts/**` | `implementer-backend`, **and the task must update the `client/` copy too** |
| `**/*.test.ts(x)` | Not dispatched while `test-writer` is off — record under *Test debt* |

Then the same rule the plan follows: **concurrently dispatched fix tasks must not share a file.** If
two groups need the same file, run them sequentially.

## 3 — Dispatch narrow fix briefs

One message, all groups in parallel. Use the remediation template verbatim. Its two load-bearing
rules:

- *Fix exactly these findings. Anything else you notice goes in your report, not in the file.*
- *If a finding is wrong — it contradicts a documented convention or a deliberate decision — do NOT
  fix it. Report it as DISPUTED with your reasoning and leave the code alone.*

An implementer told only "make the finding go away" will make it go away, correctly or not.

## 4 — Regression guard

After every round, re-run the phase gate. Fixes break typechecks; catching that now is cheaper than
at Stage 4.

## 5 — Re-verify, scoped

Re-dispatch the **same** gate agent pointed at **only the files that changed this round** — never
the whole diff again. A second full-diff review costs as much as the first and re-reports everything
you already triaged.

## 6 — Converge or escalate

- **Clean** → next stage.
- **Fixes introduced new findings** → counts as a fresh round, and say so: fixes that create findings
  mean the change was too broad.
- **A finding reappears identical after a fix attempt** → **escalate immediately.** Either the fix
  did not land or the finding is wrong; both need a human, and a third round will not discover which.
- **Round limit reached** (default 2, ceiling 3) → stop. Report what remains, what was tried, and
  each implementer's reasoning. Never continue to the next stage with open `critical` or `high`
  findings without saying plainly that the gate did not clear.

| Gate | Default rounds | On exhaustion |
|---|---|---|
| Stage 2 completeness | 2 | Report unmet ACs; ask whether to descope or continue |
| Stage 3 architecture | 2 | Report open findings; ask for a decision on each |

---

# Stop conditions

Stop and ask — do not improvise past any of these:

- No plan was given and none can be resolved unambiguously.
- The plan fails pre-flight (overlapping owned paths, missing `Type`, dependency cycle, dropped AC).
- A finding is `dispute`d.
- A round limit is hit with `critical` or `high` findings open.
- `arch-check.sh` reports a **new** violation this feature introduced.
- Any stage would require you to write product code, a spec, a plan, or a test yourself.

**Never** `git push`. **Never** write or amend the spec's requirements — only its `Status` line.

# Budget discipline

- Implementers get their `dispatch` brief, never the plan file (~11 k tokens saved per agent).
- The full suite runs **once per phase**, by you — not once per implementer.
- Re-reviews are scoped to the files changed in that round.
- Findings are grouped per file: N findings in one file cost one agent, not N.
- Every agent this skill dispatches runs on **sonnet**. The two opus agents (`spec-creator`,
  `implementation-planner`) are upstream and run manually.
- `--dry-run` prints the dispatch table so an expensive run can be checked before it starts.

# Output format

```
## Implement run — <feature>

### Artifacts
- Plan: docs/plans/<feature>.md — N tasks / M phases
- Spec: specs/SPEC-NN-<feature>/SPEC-NN.md — Status: implemented
- Run:  docs/plans/<feature>.run.md

### Stages
| Stage | Result |
|---|---|
| implement | 4 phases — commits a1b2c3d…e4f5g6h · typecheck green |
| verify | 11/11 ACs after 1 remediation round |
| review | 6 findings → 4 fixed, 1 disputed, 1 deferred (2 rounds) |
| close | api-contracts.md updated |

### Needs your decision
- **DISPUTED** <finding> — <both sides, one line each>

### Test debt (test-writer is off)
- AC-3 — unit, reviewer-core stubbed LLMProvider — NOT WRITTEN
- AC-7 — integration, *.it.test.ts — NOT WRITTEN
> No AC was verified by an executed check this run. Completeness was established by reading code.

### Deferred
- <finding> — <why out of scope>

### Next step
Ready for `git push`, which fires the pr-self-review gate. Not pushed.
```
