# Agents

Project subagents for DevDigest. Canonical location is `.claude/agents/`; each file is a
Markdown system prompt with YAML frontmatter, checked into version control and shared with the
team.

## Catalog

| Agent | Model | Writes? | Purpose |
|-------|-------|---------|---------|
| [researcher](researcher.md) | sonnet | no | Finds and reports information — in this repo or on the public internet — with a locator on every claim and an explicit list of what it could not find. |
| [planner](planner.md) | opus | `docs/plans/` only | Turns a request into a structured **Development Plan** grounded in the touched packages' `AGENTS.md`, `INSIGHTS.md`, and `specs/`, naming per step the skills the implementer must load. |
| [implementer](implementer.md) | sonnet | yes | Executes an accepted plan across `client/` and `server/`, loads the right project skills per file bucket, and verifies its own changes with the light test lanes. |
| [test-writer](test-writer.md) | sonnet | `tests only` | Writes and extends tests for already-implemented code — React component tests in `client/`, hermetic unit tests in `server/` and `reviewer-core/` — and verifies them with the light test lanes. |
| [architecture-reviewer](architecture-reviewer.md) | opus | no | Read-only check of the onion dependency rule, module boundaries, and `@devdigest/shared` contract drift, scoped to changed lines, with a mandatory adversarial-refutation pass before anything counts as blocking. |
| [plan-verifier](plan-verifier.md) | opus | no | Read-only conformance checker: enumerates every requirement in a plan or spec and returns one evidence-backed verdict per requirement, never a general quality opinion. |
| [doc-writer](doc-writer.md) | sonnet | `docs/ only` | Turns an already-shipped feature into durable documentation, routed to the right destination (`<package>/docs/`, a README, `AGENTS.md`, or root `docs/`), with diagrams only where they earn their place. |

## The chain

```
researcher  →  planner  →  implementer  →  test-writer  →  plan-verifier  →
 (facts)      (the plan)   (the change)    (tests it)      (checks the plan
                                                              was actually met)
          →  architecture-reviewer / security  →  doc-writer
             (separate agents, after)             (writes the lasting record)
```

Each agent returns its report to the main session, which passes the relevant part to the next.
`planner` may additionally delegate sideways — it holds `Agent` so it can send fact-finding to
`researcher` or `Explore` mid-plan, but its prompt restricts that to **read-only** agents so
delegation cannot widen what it is allowed to do. None of `implementer`, `test-writer`,
`architecture-reviewer`, `plan-verifier`, or `doc-writer` holds `Agent` at all: every hop in the
chain is launched by the main session, which keeps the routing visible in the conversation.

`planner` also writes — but only `docs/plans/NNNN-slug.md`, never source. Two agents that can
both edit the packages would race; the boundary is what keeps the plan a stable target.
`test-writer` and `doc-writer` are the only other two agents with write access, and each is
confined to its own path prefix by its prompt — tests only, and `docs/` only, respectively.
`architecture-reviewer` and `plan-verifier` are read-only: they report evidence for a human or a
later agent to act on, never edit anything themselves.

## Design rules

These follow the [subagents documentation](https://code.claude.com/docs/en/sub-agents) and are
worth keeping if you add an agent.

- **One clear responsibility per agent.** Planning, implementing, and reviewing are three jobs,
  not one.
- **Always set `tools` explicitly.** An omitted `tools` field inherits *every* tool available to
  subagents — including web access and the ability to spawn more agents. Grant the minimum.
- **The frontmatter grants a tool; only the prompt can scope it.** `tools` is all-or-nothing per
  tool — it cannot say "Bash but read-only" or "Write but only under `docs/plans/`". Both of
  those boundaries live in the agent's body, so an agent that gets `Write`, `Bash`, or `Agent`
  must state in its prompt exactly how far it may go. For enforcement rather than instruction,
  use a `PreToolUse` hook (this repo already has one:
  `skills/pr-self-review/scripts/check-gate.sh`).
- **`Agent` is an escalation path.** A restricted agent that can spawn an unrestricted one is not
  restricted. If you grant `Agent`, name in the prompt which agents may be spawned and forbid
  delegating anything the parent may not do itself.
- **The body is the whole system prompt.** A subagent does not see Claude Code's own system
  prompt, so anything project-specific — package managers, paths, commands, invariants — has to
  be written out in the body.
- **The `description` drives delegation.** Write it in third person with concrete triggers, and
  state what the agent must *not* do.
- **Prefer runtime `Skill` calls over the `skills:` preload field**, which injects each skill's
  full body at startup. The agents here carry a routing table instead and load on demand.
- **Don't set `permissionMode`.** A permissive parent mode overrides it, so the `tools` allowlist
  is the boundary that actually holds.
- **An agent that writes names its path prefix in the prompt.** `tools: Write` alone cannot say
  "only under `docs/`" — that scoping only exists if the body states it and the agent follows
  it. `planner` already does this for `docs/plans/`; `test-writer` and `doc-writer` do it for
  their own prefixes.
- **A review agent reports evidence, not impressions.** Every finding carries `path:line` and a
  verbatim quote, and a blocking verdict only follows a separate verification pass that tried to
  refute the finding first. `architecture-reviewer` and `plan-verifier` both hold to this.

## Related

- [`../skills/README.md`](../skills/README.md) — the on-demand skill catalog these agents draw
  from, plus how skills differ from rules, commands, and agents.
- [`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) — the file→skill
  map that `planner` and `implementer` both mirror.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide invariants and the per-package guides.
