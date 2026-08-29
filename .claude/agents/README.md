# DevDigest Agents

Custom Claude Code subagents for the DevDigest project. Each agent is a Markdown file with YAML
frontmatter (`name`, `description`, `model`, `tools`, optional `skills:`) plus a system-prompt body.
Claude routes work to an agent based on its `description`, so the descriptions are written as
trigger rules ("Use proactively when…").

| Agent | Model | Role | Writes code? |
|-------|-------|------|--------------|
| [`researcher`](./researcher.md) | sonnet | Read-only research (project + internet), strict structured output | No |
| [`spec-creator`](./spec-creator.md) | opus | Writes EARS specifications; analyses designs for missing states, corner cases, module communication, UX | No (only spec files) |
| [`implementation-planner`](./implementation-planner.md) | opus | Read-only architect — reviews requirements, then produces a structured Implementation Plan | No (only the plan file) |
| [`implementer-backend`](./implementer-backend.md) | sonnet | Implements ONE `Type: backend` task — Fastify / Drizzle / onion | Yes |
| [`implementer-ui`](./implementer-ui.md) | sonnet | Implements ONE `Type: ui` task — Next.js / React / TanStack Query | Yes |
| [`implementer-core`](./implementer-core.md) | sonnet | Implements ONE `Type: core` task — reviewer-core, zero I/O | Yes |
| [`implementer-e2e`](./implementer-e2e.md) | sonnet | Implements ONE `Type: e2e` task — deterministic browser flows | Yes |
| [`test-writer`](./test-writer.md) | sonnet | Writes tests for client + server + reviewer-core; TDD or coverage mode — **currently paused in the pipeline** | Yes (tests only) |
| [`architecture-reviewer`](./architecture-reviewer.md) | sonnet | Read-only structural review — the rules that need judgement | No |
| [`plan-verifier`](./plan-verifier.md) | sonnet | Read-only completeness (Mode 1) / traceability (Mode 2) check | No |
| [`doc-writer`](./doc-writer.md) | sonnet | Writes documentation (Diátaxis + Mermaid), knows where docs belong | Yes (docs only) |

## Intended workflow

The pipeline splits into a **manual half** and an **automated half**. The split is deliberate: the
two upstream agents are the two opus agents and the two human decision points, so they are run by
hand, one at a time, with you reading the artifact in between.

```
── MANUAL — you run these yourself, one at a time ──────────────────

  spec-creator (opus) ──── researcher / Explore in parallel
    → specs/SPEC-NN-<feature>/SPEC-NN.md
    (EARS acceptance criteria · edge cases · untrusted inputs · design-gap analysis)
  [YOU] review it, answer the Step-0 questions, set Status: approved

  implementation-planner (opus) ──── researcher / Explore
    re-runs the six-question spec gate; refuses a spec still in `draft`
    → docs/plans/<feature>.md  (phased tasks + one `dispatch` brief per task)
  [YOU] approve the plan, choose the execution mode

── AUTOMATED — /run-plan, ideally in a fresh chat ─────────────────

  per phase:
    N× implementer-<type>   parallel; each gets its dispatch brief, not the plan
    orchestrator            full suite + typecheck ONCE, then commit the phase

  scripts/arch-check.sh     4 deterministic rules, zero tokens
  plan-verifier (Mode 1)    completeness  ──┐
  architecture-reviewer                   ──┴─→ remediation loop, bounded to 2 rounds

  main session              Status: implemented · fills the Commit column
  doc-writer                only if a documented contract changed
  pr-self-review (skill)    final gate → git push
```

**Run the automated half with [`/run-plan`](../skills/run-plan/SKILL.md).** It resolves the plan,
pre-flights it, dispatches every agent with the right prompt, runs the remediation rounds that apply
the review findings, and stops at every decision that is yours. `/run-plan --dry-run` prints the
dispatch table without spawning anything, and `--from <stage>` resumes after a `/clear` using the
run file it keeps at `docs/plans/<feature>.run.md`.

The pipeline mirrors Claude Code's recommended **Explore → Plan → Implement → Commit** loop, with a
Specify step in front: `spec-creator` decides *what* gets built, `implementation-planner` runs
read-only during Plan to decide *how*, the implementers run during Implement, and review stays a
separate fresh-context step.

**The handoff is the artifact, and the ids are what hold it together.** The spec's `AC-n` ids are
used **verbatim** as the plan's requirement list and again in `plan-verifier`'s matrix — there is no
`R<n>` layer, no renumbering, and no paraphrase when a spec exists. (`R<n>` appears only in a plan
written without a spec.) Renumbering silently breaks traceability in both directions, which is why
all three agents forbid it.

`spec-creator` is skippable for small, already-specified changes; start at the planner in that case.

### Currently switched off: `test-writer`

`test-writer` is not dispatched by `/run-plan` — it is paused to save tokens. The agent file stays;
only the pipeline step is off. Two consequences worth stating plainly rather than discovering later:

- **`typecheck` is the real gate during implementation.** `server/` has one unit test and
  `reviewer-core/` has none, so a green suite proves very little on its own.
- **`plan-verifier` Mode 2 is not run.** Its entire job is executing each AC's `Verify:` command;
  with no tests written there is nothing to execute, and it would degenerate into a second, more
  expensive Mode 1. Completeness is therefore established by *reading code*, not by evidence.

`/run-plan` records every unwritten check in a **Test debt** section of the run file, so the debt is
a list you can hand to `test-writer` when it comes back — not something invisible.

### Model tiering

| Tier | Agents | Why |
|---|---|---|
| **opus** | `spec-creator`, `implementation-planner` | Design analysis and architectural decomposition — open-ended judgement, run once per feature, manually. |
| **sonnet** | everything `/run-plan` dispatches — the four implementers, `architecture-reviewer`, `plan-verifier`, `doc-writer`, `researcher`, `test-writer` | Bounded work against explicit rules, run many times per feature. This is where per-token cost multiplies. |

`architecture-reviewer` moved down when its three grep-shaped rules became `scripts/arch-check.sh` —
what remained was pattern-matching against documented rules, not architecture design.
`plan-verifier` moved down because its work is search-and-quote; its guard against the resulting
risk is mechanical rather than model-dependent — every status must carry a `file:line` and a
verbatim quote **containing the behaviour**, not merely a name that matches, and it re-reads its own
`done` rows before emitting the matrix. A false `done` is the most expensive error in this pipeline,
so the rules that prevent it are written to be checkable by you at a glance.

### Why the review stage loops

`architecture-reviewer` is read-only: it reports, it never fixes. Something has to apply what it
finds, or the stage is a report rather than a gate. `/run-plan` runs a bounded **remediation loop** —
triage every finding into `fix` / `dispute` / `defer`, group the `fix` ones **by file** so three
findings in one file cost one agent, dispatch the owning `implementer-<type>` with a narrow brief,
re-run the phase's tests, then re-review **only the changed files**.

Two things keep it from becoming a token fire or a rubber stamp. It is **bounded** — two rounds by
default, and a finding that reappears identical after a fix attempt escalates immediately instead of
burning a third. And `dispute` is a first-class outcome: this repo has already proved a review rule
can be wrong (`di-discipline` flagged 23 sites of intentional shipped code), so an implementer that
believes a finding contradicts a deliberate decision is told to leave the code alone and say so.

The same loop serves `plan-verifier`'s completeness gaps — one procedure, both gates.

### Why `plan-verifier` has two modes

It has two jobs that want different moments. **Completeness** ("is every AC actually built?") wants
to run early, while sending a gap back to an implementer is still cheap. **Traceability** ("does a
check prove it?") cannot run early — the tests do not exist yet. One run cannot serve both, so the
modes are separate and the caller names which one it wants.

**Only Mode 1 runs today**, because `test-writer` is off and Mode 2 would have nothing to execute.
When tests come back, Mode 2 slots in after the architecture review and the two-pass shape from the
original design applies again.

`architecture-reviewer` runs after Mode 1 rather than before it: there is no point auditing the
structure of code that is about to change to close a gap.

---

## `researcher`

Pre-existing read-only research agent. Finds information inside the project or on the public
internet and returns it in a strict template. Never edits files, never runs deep-research. The
implementation-planner and implementer both follow its writing conventions (YAML frontmatter +
Hard rules + fixed output template).

---

## `spec-creator`

**What it does.** Writes the artifact that comes *before* a plan: a specification with EARS
acceptance criteria, explicit edge cases, non-functional requirements, and a named provenance for
every input. Cross-module specs go to `specs/SPEC-NN-<feature>/SPEC-NN.md`; single-module specs go
to `<module>/specs/`. `SPEC-NN` is globally sequential and allocated from the registry table in
[`specs/README.md`](../../specs/README.md), which the agent appends to in the same pass as the spec
file. The four pre-convention specs (`client/specs/pages.md`, `server/specs/review-flow.md`,
`reviewer-core/specs/grounding-spec.md`, `e2e/specs/coverage.md`) are read-only to it — never
renumbered, never migrated.

**Analyses the design, not just the request.** The user drops in design sources (screenshots under
`specs/SPEC-NN-<feature>/design/`, hosted links, or prose) and the agent runs a four-bucket gap
checklist over every screen: **missing states** (empty, loading, partial, stale, error, offline,
unauthorised, truncation, first-run), **uncovered corner cases** (0/1/N/N-huge, concurrency, slow
and failed requests, retry & idempotency, pagination, locale), **cross-module communication** (which
API contract, which `@devdigest/shared` Zod type, SSE vs request/response, TanStack Query cache
invalidation, the `reviewer-core` zero-I/O boundary), and **UX improvements** (latency feedback,
destructive-action confirmation, a11y, `next-intl` keys, actionable error copy). It then walks an
eight-category **NFR menu** (latency, scale, degradation, accessibility, i18n, observability,
security & privacy, compatibility), recording a bound for what applies and "not applicable" for what
it deliberately skipped — so a reader can tell that apart from "not considered". Every finding is
classified `blocking question` / `open question` / `recommendation`.

**Delegates research, in parallel.** Independent lookups fan out to `researcher` and `Explore` in a
single message rather than being answered serially from the agent's own context. Only those two are
permitted: a write-capable subagent reports its *own* `agent_type`, so it would bypass the path
guard entirely. The agent body also carries the project's hard-won note that **subagents do not
inherit the parent's skills** — a delegated prompt must say `Call the Skill tool with skill: "<name>"`
explicitly (`client/insights/INSIGHTS.md:66`).

**Reads insights, scoped.** Only `<module>/insights/` for the modules the feature actually touches —
never the full set. These files are long and mostly irrelevant to any one feature; reading all of
them buries the signal. What it extracts is narrow: a documented constraint that makes a proposed
behaviour impossible, expensive, or already solved.

**Traceability and verification are first-class.** `US-1 → AC-1 → EC-1` inside the spec,
`AC → task → test` in the plan, `task → commit → code` in `plan-verifier` — one chain, one set of
ids, no parallel `R<n>` numbering when a spec exists. Every AC names its parent US, ids are immutable
(a dropped criterion is retired in place: `AC-4: removed — see SPEC-07`), and a closing
`## Traceability` table makes the mapping readable. Every AC, EC, and NFR carries a `Verify:` hint at
the cheapest level that can observe it — `unit` / `integration` / `e2e` / `manual` — which becomes
the plan task's `Test:` field and the seam `test-writer` and `plan-verifier` work from.

**Inputs are tagged by origin and cost.** `## Inputs and provenance` marks every input the feature
consumes as `[reused: <artifact>]`, `[deterministic: <module>]`, or `[new: N LLM call(s)]` — a
design decision, not a footnote, in an LLM-metered product. Reuse is preferred over deterministic
over new, every `[new: …]` needs a one-line justification, and `plan-verifier` later flags an
implementation that makes a model call where the spec promised a reused or computed fact. Design
screenshots and docs are kept separate under `### Authoring sources`: inputs to the spec, not to the
feature.

**Two review passes before planning.** A 16-box mechanical **self-check** runs before the first
`Write`; then a six-question **spec review gate** asks whether the spec is fit to plan against — one
checkable thing per AC, unambiguous condition and reaction, no contradictions, behaviour rather than
incidental implementation detail, explicit non-goals, and every `[NEEDS CLARIFICATION: …]` closed.
That bracketed marker is the one sanctioned placeholder (`[TODO]`/`[TBD]` are not): it sits inline
where the doubt bites, mirrors to a `Q-n`, and blocks the move out of `draft`.
`implementation-planner` re-runs the same six questions with fresh eyes and hands the spec back
rather than planning around a "no".

**Always asks before writing.** Blocking gaps are bundled into a single Step 0 round (≤4 questions,
each with a recommended default) and no file is created until the user answers. An unchecked
self-check box is a defect to fix, not a caveat to report.

**Two modes.** *New feature* (`draft`, criteria describe intended behaviour) and *retro-spec* for
already-shipped functionality (`implemented` from the start, criteria read out of real behaviour,
every design-vs-reality divergence raised as a finding, `Verify:` naming the existing test or
`uncovered`). It also owns `Supersedes` mechanics — superseding never deletes a spec — and a
splitting rule (≈15 AC, ≤2 packages with independent value).

**Path enforcement is mechanical, not just prose.** Agent frontmatter cannot express path-scoped
permissions (`tools:` takes bare tool names; there is no per-agent `permissions` field), so
[`.claude/hooks/spec-creator-guard.sh`](../hooks/spec-creator-guard.sh) runs as a `PreToolUse` hook
on `Write|Edit|NotebookEdit|Bash|Agent`. Keyed on the payload's `agent_type`, it enforces three
things for this agent only: writes must land inside `specs/**` or `<module>/specs/**`; `Bash` is
refused outright (a shell redirect is an unguarded write); and `Agent` may only spawn `researcher`
or `Explore`. The main session and every other agent pass straight through, and the guard fails open
if `jq` is missing so it can never wedge a session.

**Skill routing.** Deliberately lean, and deliberately *not* the implementer set — loading
`fastify-best-practices`, `drizzle-orm-patterns`, or `next-best-practices` would push the agent
toward solution-shaped acceptance criteria, which its own hard rules forbid. `security` backs the
mandatory `Untrusted inputs` section (diff content, PR bodies, branch names, and LLM output are all
attacker-influenced); `typescript-expert` is what lets it read `@devdigest/shared` contracts
accurately; `onion-architecture` is loaded for **module ownership only**, never to prescribe a layer;
`mermaid-diagram` for the occasional flow or sequence diagram; `engineering-insights` closes the
loop. `frontend-architecture` and `zod` were evaluated and rejected — the former is a code-placement
skill ("WHERE code lives, not HOW to write it") and the latter is schema syntax; neither is what a
behaviour spec needs.

**Based on:**

- **EARS requirement syntax** (five patterns, `shall` as the binding marker) — [EARS — Mavin, Wilkinson, Harwood, Novak, IEEE RE'09](https://alistairmavin.com/ears/)
- **Spec-driven development with AI** — [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **Specs as the durable handoff artifact (requirements → design → tasks)** — [Kiro specs concepts (AWS)](https://kiro.dev/docs/specs/concepts/)
- **Acceptance criteria an agent can actually verify** — [How to write acceptance criteria an AI agent can verify (BrainGrid)](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **`description` as the routing signal, and frontmatter limits** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Requirements traceability matrix structure** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)
- **`agent_type` in the PreToolUse payload, enabling per-agent path guards** — [Claude Code hooks docs](https://code.claude.com/docs/en/hooks)
- **Subagents do not inherit parent skills; delegated prompts must name the Skill tool** — project insight, [`client/insights/INSIGHTS.md`](../../client/insights/INSIGHTS.md)

---

## `implementation-planner`

**What it does.** Turns an already-specified request into a structured, file-specific
**Implementation Plan** written to `docs/plans/<feature>.md`. Knows every DevDigest module
(`server/`, `client/`, `reviewer-core/`, `e2e/`, `@devdigest/shared`) and assigns each task a
`Type`, a skill set, non-overlapping `Owned paths`, dependencies (a DAG), known gotchas from module
insights, and measurable acceptance criteria. Read-only except for the plan file.

**Never writes specs.** Requirements come in from the user; the agent reviews them (missing,
ambiguous, untestable, contradictory, already done), asks up to 4 sharp questions with defaults,
and offers explicit `Recommendations` — but it never authors or edits a specification, PRD, or any
`specs/` file. Anything it derived itself stays under Recommendations / Open questions instead of
being promoted into a requirement.

**Asks for the execution mode.** Before decomposing, it confirms whether the plan will be run
**multi-agent** (N parallel implementers → many small tasks, strictly non-overlapping owned paths,
contracts as a barrier phase) or **single-agent** (one sequential pass → fewer, larger, ordered
tasks). The answer is recorded in the plan's `Execution mode` section; unanswered defaults to
single-agent.

**Carries the full skill set.** It preloads the **union** of every implementer variant's skills
(backend + UI + core practices) plus `mermaid-diagram`, on purpose: it plans the implementation, so
every practice an implementer must follow has to be reflected in the plan. It is the one agent that
still needs all of them — the implementers themselves each load only their own slice.

**`Type` is now routing, not a label.** Each task's `Type: backend | ui | core | e2e` decides which
`implementer-<type>` receives it and therefore which practices that agent can even see. A UI task
mistyped `backend` reaches an agent with no React knowledge loaded, so the planner is told never to
mix two types in one task — split instead.

**It emits a dispatch brief per task.** Plans in this repo run 40–44 KB, and handing the whole file
to each implementer cost ~11 k tokens per instance for information that was mostly another task's
problem. The template now ends with one copy-pasteable `dispatch` block per task, so the orchestrator
can fan out without judgement and without the plan entering any implementer's context.

**It refuses a `draft` spec.** `draft` means the user has not signed off and, by `spec-creator`'s
own rules, an open `[NEEDS CLARIFICATION]` may still be in there. Planning against it produces tasks
built on an unconfirmed assumption — and a provisional plan gets executed. Only `approved` (or
`implemented`, for a retro-spec) may be planned against. This is what makes the `Status` field
load-bearing rather than decorative.

**Based on:**

- **`description` as the routing signal**, written as a trigger rule — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Read-only planning, separated from implementation** (Explore → Plan → Implement) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); modelled on the built-in `Plan` subagent — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Opus for design/architecture** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Handoff via a written plan artifact** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Strong plan structure** (overview, requirements, file-specific steps, phases, dependencies, testing, risks, success criteria) — [affaan-m/everything-claude-code · planner.md](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Plan anti-patterns → the Red-flags check** (measurable acceptance, every requirement maps to a task, dependencies form a DAG) — [Strategic Task Planner (subagents.app)](https://subagents.app/agents/planner)
- **Preloading skills via the `skills:` field** (full skill body injected at startup) — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Delegating heavy discovery to a subagent** to keep planning context clean — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Module-scoped insights** (read `<module>/insights/` rather than the whole repo) — project convention in [`/CLAUDE.md`](../../CLAUDE.md) "Read When", combined with the nested-skills pattern from [Extend Claude with skills](https://code.claude.com/docs/en/skills)

---

## `implementer-backend` · `implementer-ui` · `implementer-core` · `implementer-e2e`

**What they do.** Each implements exactly one task from an Implementation Plan and brings it to
green. They run in parallel on the **same branch** (no worktree isolation), so staying inside the
task's `Owned paths` is what keeps the parallel run safe. The self-check is narrow: write the code
and make the task's own check pass; broad review is left to `architecture-reviewer` and
`pr-self-review`.

**Why four files instead of one.** This was a single `implementer` preloading all twelve skills —
**27,668 tokens injected at startup, per instance, before it read a line of code**. Most of it was
dead weight for any given task: a backend task carried ~9.4 k tokens of React and RTL guidance, a UI
task carried ~8.2 k of Fastify, Drizzle and Postgres, and a `reviewer-core` task carried a
4,020-token PostgreSQL schema-design skill for a package with no database. Splitting by the `Type`
the planner already assigns removes that:

| Variant | Skills | Startup tokens | vs. the single agent |
|---|---|---|---|
| `implementer-backend` | onion · fastify · drizzle · postgresql · zod · ts · security | 16,714 | **−40 %** |
| `implementer-ui` | frontend-architecture · next · react · ts · security | 11,691 | **−58 %** |
| `implementer-core` | zod · ts · security | 8,513 | **−69 %** |
| `implementer-e2e` | ts · security | 7,149 | **−74 %** |

Routing needs no new metadata: every task already carries `Type: backend | ui | core | e2e`.
`engineering-insights` is no longer preloaded anywhere — it is needed at most once per run, so each
variant calls it through the `Skill` tool only when it actually has something to record.
`react-testing-library` was dropped from all four: writing tests is `test-writer`'s job.

**They receive a brief, not the plan.** Plans in this repo run 40–44 KB (~11 k tokens). Handing the
whole file to every implementer meant paying that per instance for information that is 90 % another
task's problem. The planner now emits a copy-pasteable `dispatch` block per task — action, owned
paths, the paths other tasks own, gotchas, the test, and the AC it traces to — and the plan file
path in case the agent is genuinely blocked.

**Tests are scoped.** Each implementer runs `vitest related` on its own changed files plus
`typecheck`; the **full suite runs once per phase, by the orchestrator**. N implementers each running
the whole suite is N times the cost for the same signal. Failure output is bounded to ~50 lines —
an unbounded log was the single largest avoidable token cost in the pipeline.

**Keeping them in sync.** The four bodies are near-identical by design; only the skills, the
conventions section, and the verification commands differ. Each file carries an HTML comment saying
so. When you change the shared part, change it in all four.

**Based on:**

- **`description` as a trigger rule** for auto-delegation — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Sonnet for implementation** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Per-type skill sets injected via `skills:`** — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Owned paths / forbidden files / contracts-first** for safe parallel work — [Parallel Claude Code Agents: Safe Workflow Guide](https://www.aakashx.com/blog/parallel-claude-code-agents/)
- **Self-verification with a runnable check** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Review in a fresh context, separate from the author** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Single-responsibility agent design** — [wshobson/agents](https://github.com/wshobson/agents), [PubNub best practices](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Module-scoped insights read before coding, written back after** — project convention in [`/CLAUDE.md`](../../CLAUDE.md) + the `engineering-insights` skill

**Deliberately not used:** `isolation: worktree` (the project runs implementers on the main branch
by choice, relying on `Owned paths` discipline instead of worktree isolation).

---

## `test-writer`

**What it does.** Adds or extends tests across **all three tested packages** — React components and
hooks in `client/` (vitest + jsdom + RTL), the Fastify/Drizzle backend in `server/`, and the LLM
review engine in `reviewer-core/`. It enforces the project's test split (`*.it.test.ts` = real
Postgres via testcontainers with transaction-rollback isolation; `*.test.ts` = hermetic unit with
fake timers and seeded ids), injects a `FakeLlmProvider` at the `LLMProvider` seam for
reviewer-core tests, and never modifies production `src/` files (only a type export strictly
required to compile a test is permitted). Forbidden anti-patterns are encoded directly in its body:
tautological assertions, over-mocking, snapshot tests on dynamic output, and non-deterministic test
bodies.

**`client/` was a scope bug.** The agent previously restricted itself to `server/` and
`reviewer-core/` while preloading `react-testing-library` — the largest skill in the repo at ~4,847
tokens — which it was then forbidden to use. Meanwhile **all twelve of the project's real tests live
in `client/`**, `server/` has one unit test, and `reviewer-core/` has none. So the one package with
actual coverage had no owner, and the skill paid for on every run was dead weight. Extending the
scope fixes both ends.

**Two modes.** *TDD* — given an AC and its `Verify:` hint, write the failing test **first**, so the
implementer has a real target and the plan's `Test:` column fills itself. Preferred for `backend`
and `core`, where the suites are thin enough that "existing tests stay green" proves almost nothing.
*Coverage* — the default for `ui` and for filling gaps a `plan-verifier` Mode 1 pass flagged. The
report states which mode it ran in, because in TDD mode a failing test is success and in coverage
mode it is not.

**Bounded evidence.** The body used to demand "paste terminal output for every command run — never
omit", which is an unbounded token sink on a red run. It now asks for the summary line per command
and at most ~50 lines of an actual failure.

**Skill routing.** `react-testing-library` supplies RTL and vitest query conventions (now actually
usable); `fastify-best-practices`, `drizzle-orm-patterns`, and `onion-architecture` anchor the
backend test structure to the real layering; `zod` and `typescript-expert` cover schema-level
assertions; `security` and `engineering-insights` are the always-on set. The `Agent` tool was removed
— it was never referenced in the body and only invited unplanned fan-out.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Over-mocking and tautological-test study** — [Are Coding Agents Generating Over-Mocked Tests? (arXiv)](https://arxiv.org/html/2602.00409v1)
- **Tautological-test postmortem (contract-comment-before-assertion rule)** — [When AI-generated tests pass but miss the bug (dev.to)](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- **Mocking LLM calls for deterministic tests** — [Unit testing AI agents: mocking LLM calls (CallSphere)](https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests)
- **Blazing-fast Postgres tests with testcontainers + Vitest** — [Blazing fast Prisma and Postgres tests in Vitest (Codepunkt)](https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/)
- **Flaky-test prevention in Vitest** — [Flaky tests in Vitest (Mergify)](https://mergify.com/flaky-tests/vitest/)

---

## `architecture-reviewer`

**What it does.** A **read-only** structural auditor (no `Edit` or `Write`; `Bash` only to run
`scripts/arch-check.sh` and quote its output). It reads the authoritative docs **scoped to the
modules the file set touches**, then checks the seven rules that need a reader: inward-only
dependencies, business logic in routes, DI wiring drift, the `groundFindings()` gate,
shared-contract deduplication, RSC boundary placement, and one-sided contract edits. Every finding
must cite the exact rule it violates; uncited generic opinions are suppressed. Write tools are
deliberately omitted — a reviewer that can write is tempted to fix rather than report, which destroys
review independence.

**What moved out.** Three of its original rules — `no-process-env-outside-allowlist`,
`reviewer-core-zero-io`, and adapter construction outside the container — were each a single grep
with no judgement in them. They now live in [`scripts/arch-check.sh`](../../scripts/arch-check.sh),
which runs in a second for free. Paying opus tokens to run a grep was the reason this agent was also
downgraded from opus to sonnet: what remains is pattern-matching against documented rules, not
architecture design.

**Two things the split surfaced.** Encoding the rules as an executable script proved that two of
them were wrong as written:

- **`di-discipline` contradicted the codebase.** `server/docs/architecture.md:20-32` documents
  constructor injection with explicit dependencies, but the shipped code passes the whole container
  (`new FooService(container)`, `this.repo = new FooRepository(container.db)`) in ~23 places. A hard
  gate would have been red on day one against intentional code. The script now checks only that
  **adapters** are built in the container — true today — and the doc-vs-code contradiction became a
  `low`-severity judgement rule, because deciding which of the two is authoritative is the user's
  call, not a grep's.
- **The contract-sync check was pure noise.** The client copy imports `'./findings'` where the
  server copy imports `'./findings.js'` in every file, so a raw `diff -r` reported all seven
  contracts as divergent on every push, forever. The script normalises that vendoring transform
  before comparing — and underneath the noise found **five genuinely drifted contracts**.

**Scope.** Does NOT review style nits, naming, runtime bugs, test quality, performance, or security
injection vectors (those belong to `pr-self-review` and the `security` skill). Structural contracts
only. `mcp-server/` has no `CLAUDE.md`, so files there are reported as `missing-reference-doc`
rather than audited against improvised rules.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Parallel AI agents for code review** — [9 Parallel AI Agents That Review My Code (HAMY)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- **Architectural liquefaction and the need for automated guardrails** — [Clean Architecture in the Age of AI (dev.to)](https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction-5d8d)
- **Enforcing Clean Architecture via tooling** — [Enforce Clean Architecture in TypeScript with fresh-onion (dev.to)](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi)
- **Agentic code review patterns** — [Agentic Code Review (Addy Osmani)](https://addyosmani.com/blog/agentic-code-review/)

---

## `plan-verifier`

**What it does.** A **read-only** completeness checker (`tools: Read, Glob, Grep, Bash` — no
`Edit` or `Write`). Given an Implementation Plan, it walks every requirement and acceptance criterion,
searches for the concrete implementing artifact (grep → structural glob → read), quotes verbatim
evidence, and assigns one of four statuses: `done | partial | missing | cannot-verify`. `Bash` is
used only to run search and verification commands and capture output as evidence — never to modify
state. After the per-requirement pass it performs an implicit-concerns sweep (error handling, auth,
idempotency, test coverage, type safety). Output is a traceability matrix followed by a gate verdict.

**It runs in one of two modes, and the caller must say which.** *Mode 1 — completeness* runs right
after implementation, before `test-writer`: is every AC actually built? It ignores the `Test` and
`Commit` columns entirely and biases toward speed, because its whole purpose is to send gaps back
while fixing them is still cheap. *Mode 2 — traceability* runs at the end and **executes** the check
each AC's `Verify:` hint names, so a row is `done` only when its check ran and passed. That is the
difference between "I read the code and it looks right" and evidence, and it is why the agent has
`Bash` at all.

**The `Commit` column was a live bug.** The body used to read "an empty `Commit` cell is
`cannot-verify`, not `missing`" — but nobody in the chain fills that cell: implementers do not commit
or edit the plan, the planner writes the plan before the code exists, and this agent is read-only.
Every row would therefore have been marked `cannot-verify` and every verdict would have come back
`REVIEW`, permanently. The column now has a named owner (the orchestrator, after each phase lands),
and the agent is explicitly instructed never to infer a status from it.

**It no longer sends you to `spec-creator` to change one word.** Flipping the spec's
`Status: implemented` is now the main session's job — the guard hook only restricts `spec-creator`
itself, so the main session can write `specs/**` freely, and booting an opus agent with its full
skill set for a one-line edit was waste.

**Skill routing.** The skill set is intentionally lean: `typescript-expert` to locate TypeScript
artifacts, `onion-architecture` to know where backend artifacts should live, and
`frontend-architecture` to locate UI artifacts. No architecture-quality or security skills are
loaded — those concerns belong to `architecture-reviewer` and `pr-self-review`. The body explicitly
states this agent's mandate is completeness and traceability only.

**Based on:**

- **Spec-driven development with AI** — [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **Writing acceptance criteria AI agents can verify** — [Acceptance criteria an AI agent can verify (BrainGrid)](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **Code search tool selection for AI agents** — [Code search for AI agents — which tool, when (ceaksan.com)](https://ceaksan.com/en/code-search-for-ai-agents-which-tool-when)
- **LLM behavioral failure modes (hallucination, rubber-stamping)** — [LLM behavioral failure modes (ceaksan.com)](https://ceaksan.com/en/llm-behavioral-failure-modes)
- **What AI verification still misses** — [AI coding agents can verify some of their work — here's what they still miss (dev.to)](https://dev.to/moonrunnerkc/ai-coding-agents-can-verify-some-of-their-work-now-heres-what-they-still-miss-58mc)
- **Requirements traceability matrix structure** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)

---

## `doc-writer`

**What it does.** Writes and updates Markdown documentation for the DevDigest codebase. Every
claim is grounded in source (never invented); every doc is classified into a Diátaxis quadrant
(tutorial / how-to / reference / explanation) and placed according to the repo's layout decision
tree (`server/docs/`, `client/docs/`, `docs/adr/`, `docs/plans/`, `<module>/insights/`). ADRs are
append-only — accepted ones are never edited, only superseded. Every generated file is stamped with
`<!-- generated from: <source files> -->` on the second line. Mermaid diagrams are selected by
content type and validated with a post-check (unique node ids, no lowercase `end`, correct arrow
syntax) before publishing.

**Skill routing.** `mermaid-diagram` drives diagram type selection and syntax; `onion-architecture`
and `frontend-architecture` are loaded to accurately describe backend and UI module structure in
reference docs; `typescript-expert` enables accurate reading of TypeScript types and exported
symbols; `engineering-insights` closes the loop — doc-writing discoveries (undocumented constraints,
gotchas) are appended back to `<module>/insights/`.

**Based on:**

- **Diátaxis framework** — [Diátaxis — Start Here](https://diataxis.fr/start-here/)
- **Automated, grounded documentation generation (DocAgent)** — [DocAgent (arXiv)](https://arxiv.org/html/2504.08725v1)
- **AI doc generation: when it helps and when it misleads** — [AI can write your docs, but should it? (Mintlify)](https://www.mintlify.com/blog/ai-can-write-your-docs-but-should-it)
- **Architecture Decision Record conventions** — [Architecture Decision Record (Martin Fowler)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
- **ADR best practices** — [Master ADRs (AWS)](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)
- **Avoiding AI writing pitfalls** — [avoid-ai-writing SKILL.md (GitHub)](https://github.com/conorbronsdon/avoid-ai-writing/blob/main/SKILL.md)

---

## Adding a new agent

1. Create `<name>.md` here with frontmatter (`name`, `description`, `model`, `tools`, optional
   `skills:`).
2. Write the `description` as a trigger rule — it is the only signal Claude uses to route to the agent.
3. If you preload skills, make sure none of them set `disable-model-invocation: true` (that blocks
   preloading).
4. Add a row to the table above and a section here, with sources if the design is based on external
   practices.
5. **Path limits cannot go in frontmatter.** `tools:` takes bare tool names only, and there is no
   per-agent `permissions` field — `Write(specs/**)` is not valid anywhere in an agent file. To
   confine an agent to a directory, add a `PreToolUse` hook that keys on the payload's `agent_type`
   (see [`spec-creator-guard.sh`](../hooks/spec-creator-guard.sh)). Always fail open, so a broken
   guard cannot wedge the session, and always state the rule in the agent's `## Hard rules` too —
   the hook is a backstop, not the instruction.

## Budget discipline

Preloaded skills are injected at **startup, in full, per instance**, before the agent reads
anything. That makes `skills:` the most expensive line in an agent file, and the easiest to pad.
Three rules keep it honest:

1. **Load only what the agent is allowed to act on.** A skill an agent's hard rules forbid it from
   using is pure cost — that was `react-testing-library` in `test-writer`, and the whole React set
   in a backend implementer.
2. **Split by task type before adding a skill.** Four lean variants beat one agent that carries
   every practice in the repo; the planner already emits the routing key.
3. **A deterministic check does not belong in an agent.** If a rule is a grep, put it in
   [`scripts/arch-check.sh`](../../scripts/arch-check.sh). Writing it as a script also *tests* the
   rule — doing exactly that is how two of `architecture-reviewer`'s rules were found to be wrong.

Current startup cost, SKILL.md bodies only (references load on demand):

| Agent | Tokens |
|---|---|
| `implementation-planner` | 24.6 k (union minus RTL — it names tests, never writes them) |
| `implementer-backend` | 16.7 k |
| `implementer-ui` | 11.7 k |
| `implementer-core` | 8.5 k |
| `implementer-e2e` | 7.1 k |
| `spec-creator` | ~12 k |
| `architecture-reviewer` | ~8 k |
| `plan-verifier` | ~7 k |
