# Dispatch templates

Copy-pasteable prompts for every agent `/run-plan` spawns. Two rules apply to all of them.

**Subagents inherit none of the orchestrator's context or skills.** A spawned agent starts with only
its own `skills:` frontmatter plus the prompt you give it. Everything it needs must be *in* the
prompt — and if it must apply a skill not in its frontmatter, say so explicitly:
*Call the Skill tool with `skill: "<name>"`.* (Project insight: `client/insights/INSIGHTS.md:66`.)

**Never paste the plan file.** Implementers get their `dispatch` block; the reviewer gets a file list.

Not here on purpose: `spec-creator` and `implementation-planner` run manually upstream, and
`test-writer` is currently switched off.

---

## implementer-<type> — normal task (Stage 1)

Verbatim from the plan's `dispatch` block. Nothing added, nothing summarised:

````
```dispatch T4 → implementer-backend
Action: …
Module: server   Type: backend
Skills to emphasise: …
Owned paths: `server/src/modules/blast/service.ts`
Do NOT touch (other tasks own these): `client/src/…` (T5)
Depends-on: T0
Known gotchas: …
Test: `blast.test.ts`
Traces to: AC-3 — "<criterion text>"
Acceptance: …
Plan file (read only if blocked): docs/plans/<feature>.md § Phase 1
```
````

If the plan predates the `dispatch` convention, build the brief from the task's fields by hand —
never hand over the plan file instead.

**Note while `test-writer` is off:** a task's `Test:` field names a file that may not exist. Tell the
implementer to run `typecheck` plus whatever tests do exist, and not to author the missing test:

```
The test named in `Test:` has not been written (test-writer is currently off). Do NOT write it.
Verify with: <scoped vitest run if any test covers your files> and your package's typecheck.
```

---

## implementer-<type> — remediation (the fix loop)

```
Fix these review findings. Do NOT refactor anything else in the file.

File: <path>
Owned paths: <path>            # exactly the files carrying findings, nothing more

Findings:
1. [critical] <rule> (<doc that defines it>)
   Evidence: <verbatim excerpt from the reviewer>
   Recommendation: <one sentence>
2. [high] <rule> — <evidence> — <recommendation>

Rules:
- Fix exactly these findings. Anything else you notice goes in your report, not in the file.
- If a finding is wrong — it contradicts a documented convention or a deliberate decision —
  do NOT fix it. Report it as DISPUTED with your reasoning and leave the code alone.
- Re-run your scoped tests + typecheck before reporting.
```

That last-but-one rule is what keeps the loop honest. An implementer told only "make the finding go
away" will make it go away, correctly or not.

---

## plan-verifier (Stage 2)

```
Mode: 1 — completeness.

Plan: docs/plans/<feature>.md
Spec: specs/SPEC-NN-<feature>/SPEC-NN.md

Do not run tests. Ignore the Test and Commit columns. I need to know which ACs are not built yet,
while sending them back to an implementer is still cheap.

Note: test-writer is currently off, so no AC has a test. An AC whose implementation exists but has
no test is `done`, not `partial` — that is already your Mode 1 rule; it matters more than usual here.

Every status needs a file:line and a verbatim quote. A row with an empty evidence cell is not a
verdict I can act on.
```

**Re-verification after a remediation round** — scope it:

```
Mode: 1. Verify ONLY these rows: AC-4, AC-9.
They were reported missing/partial last round and have since been changed.
```

---

## architecture-reviewer (Stage 3)

```
Audit this file set against the documented structural contracts.

Files changed by this feature:
- <path>
- <path>

Run ./scripts/arch-check.sh first and quote its verdict; do not re-derive the rules it covers.
Read only the docs the modules above require, per your Read-When table.

Pre-existing, not this feature's fault: five vendored contracts are already divergent (eval-ci,
knowledge, platform, productionize, trace). Report them as pre-existing, not as findings against
this diff.

test-writer is currently off, so absent tests are expected — do not raise them as findings.
```

**Re-review after a remediation round:**

```
Re-audit ONLY these files, changed in remediation round <n>:
- <path>

Previously reported and addressed: <finding ids>. Confirm each is resolved, and report anything new.
Do not re-report findings on files outside this list.
```

---

## doc-writer (Stage 4)

```
The feature <name> has landed and changed behaviour these docs describe:
- server/docs/api-contracts.md — <what changed>

Ground every claim in the source; the spec is at <path> and the plan at <path>.
Update only the docs listed above.
```
