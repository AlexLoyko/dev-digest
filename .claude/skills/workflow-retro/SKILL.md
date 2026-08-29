---
name: workflow-retro
description: >
  Manual post-mortem of a multi-agent run. Summarises what the orchestration cost and what to change,
  from what is already in this conversation by default, or from full session and subagent transcripts
  when asked to go deep. Writes a report plus a ledger row under docs/retro/ and proposes concrete
  edits to agent and skill definitions.
  TRIGGER only when the user explicitly asks: "/workflow-retro", "retro on that run", "how did that
  workflow go", "what did the agents cost". NEVER run it on your own initiative — not after
  /run-plan, not because a session launched several agents, not as a wrap-up step. It is
  user-invoked, always.
  Does NOT cover: recording product-engineering discoveries (engineering-insights owns
  {module}/insights/INSIGHTS.md), reviewing code (pr-self-review), or editing agent definitions
  without the user's approval.
---

# `/workflow-retro` — post-mortem of a multi-agent run

> **Manual only.** This skill runs when the user asks for it, and never otherwise. Do not invoke it
> as a wrap-up, do not chain it after `/run-plan`, do not offer to run it automatically. If you
> think a run deserves a retro, say so in one line and let the user decide.

> **The evidence counts. You judge.** Never estimate a token count, a duration, or an agent count
> from memory, and never repeat a figure an agent claimed about its own run without a source.

This skill answers one question: **was that orchestration worth what it cost, and what should change
before the next one.** Its output is a chat summary, a report file, a ledger row, and a short list of
concrete edits to `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`.

It is deliberately **not** `engineering-insights`. That skill records what we learned about the
*product* into `{module}/insights/INSIGHTS.md`. This one records what we learned about the *agent
system* into `docs/retro/`. A retro finding that is really a product discovery is handed over, not
written in both places.

---

## Output — three places, every time

1. **Chat.** The verdict, the cost, and the proposed changes, in full. The user reads the retro here;
   the files are the record, not the delivery.
2. **`docs/retro/<YYYY-MM-DD>-<short-slug>.md`.** The full report. One file per run, never overwritten.
3. **`docs/retro/ledger.md`.** Append one row to the run table, and one row per module-scoped insight
   to the second table. **Module insights live in this ledger**, not in `{module}/insights/`.

---

## Two data sources

**Default — in context.** Work from what this conversation already holds: the agent results you
received (each carries `subagent_tokens`, `tool_uses` and `duration_ms`), the prompts you dispatched,
the reports that came back, and what you observed going wrong. This costs nothing extra and is the
right depth for most runs.

Its limits are real and must be stated in the report: you get **no main-session token accounting, no
nested-agent visibility, no file-overlap analysis, and no idle-vs-busy split**. Say so rather than
implying the picture is complete.

**On request — deep.** When the user says "deep", or when the in-context picture is missing something
the question actually needs, run the extractor:

```bash
python3 .claude/skills/workflow-retro/scripts/retro-digest.py            # newest session
python3 .claude/skills/workflow-retro/scripts/retro-digest.py --list     # pick another
python3 .claude/skills/workflow-retro/scripts/retro-digest.py --session <uuid>
```

It parses the session transcript and every subagent transcript and produces, deterministically:

| Block | What it answers |
|---|---|
| Token accounting | Fresh input, cache write, cache read, output, thinking, peak context — per actor |
| Agents | Roster with model, launch time, active window, turns, tool count, nesting depth, status |
| Launch order | The actual sequence, including agents spawned by other agents |
| Parallelism | Which agents' active windows overlapped, and for how long |
| Tool mix | What each agent actually did — reads vs greps vs writes |
| Duplicated work | Files touched by more than one actor, and files read 3+ times |
| Failures | API errors, synthetic interruptions, `SendMessage` resumes |

**Read the token table correctly.** Per-message `input_tokens` is not summable — each turn re-sends
the whole context, so a naive sum inflates by an order of magnitude. The honest headline is
**fresh-processing total** (fresh in + cache write + output); cache reads are reported separately
because they are real but an order of magnitude cheaper. Peak context is a **max**, not a sum.

**The `Active` column is wall-clock, not compute.** An agent that waited on a human answer or was
interrupted shows a long window with almost no work in it. Before calling an agent slow, check the
gaps between its own timestamps.

---

## Algorithm

### 1. Pick the depth and say which you used

State in the report which source you worked from. A retro that does not say whether its numbers came
from context or from transcripts cannot be checked.

### 2. Read for the qualitative part

The digest names every transcript path. Do **not** read them whole — a subagent transcript runs to
hundreds of KB and reading it defeats the purpose of having delegated in the first place. Pull
targeted excerpts with `grep`/`jq`-style filters instead:

- **Difficulty** — where an agent retried the same tool call, searched repeatedly for one fact, or
  wrote then rewrote the same file. High tool-count with low output is the signature.
- **Ease** — a phase that finished in one pass, so the next run can budget less for it.
- **Duplication** — start from the digest's overlap list, then check *why*: was the second read a
  deliberate verification, or did an agent simply not receive what an earlier one already found?
- **Misses** — compare what the agent was asked to cover against what its final report covered.
  The gap is the useful part: a question in the prompt that never got an answer.
- **Prompt quality** — how much of the agent's opening turns went to re-deriving context the
  dispatcher already had and could have passed in.

### 3. Judge cost against outcome

For each agent, answer plainly: **did this need to be an agent?** A delegate whose whole job was
three greps cost a full context load to save nothing. A delegate that swept forty files and returned
one paragraph paid for itself many times over.

State it as a ratio the reader can check: tokens spent → what came back that the main session did
not already have.

### 4. Write the report

Write to `docs/retro/<YYYY-MM-DD>-<short-slug>.md`, creating the folder if needed. One file per run;
never overwrite an earlier retro. Then append to `docs/retro/ledger.md`: one row in the run table,
and one row per module-scoped insight in the insights table. Finally, deliver the verdict, the cost
and the proposed changes in chat — the files are the record, the chat is the delivery.

### 5. Propose changes — never apply them

End with concrete, quotable edits to agent and skill definitions. **You do not edit
`.claude/agents/*.md` or another skill's `SKILL.md` in this skill.** Propose; the user decides. That
separation is the point: a retro that silently rewrites the agents it just graded is unauditable.

---

## Report template

```markdown
# Workflow retro — <what the session was trying to do>
Session: <uuid> · <date> · branch `<branch>` · source: in-context | deep (transcripts)

## Verdict
<Two sentences. Was the orchestration worth it, and the single biggest change to make.>

## Cost
<The digest's token table, trimmed to what matters. Fresh-processing total as the headline.
Cache reads noted separately. Peak context per agent, with how close to the window.>

## What ran
<Launch order and parallelism, in prose. Name what was sequential that could have been parallel,
and what was parallel that created duplicated work.>

## What was hard
- <agent> — <the difficulty, with the transcript evidence: N retries, N repeated searches>

## What was easy
- <agent> — <finished in one pass; budget less next time>

## What was duplicated
- <file or fact> — read by <actors>, <N>× — <deliberate verification | avoidable re-derivation>

## What was missed
- <question asked of an agent that its report never answered>

## Proposed changes
- `.claude/agents/<x>.md` — <the exact change, and the evidence for it>
- `.claude/skills/<y>/SKILL.md` — <…>
```

---

## Hard rules

- **Never run unasked.** This skill is manual. No hook, no chained invocation, no "shall I also run
  the retro" as a reflex at the end of every workflow.
- **Never invent a number.** Every figure traces to the digest, or to an agent result already in
  context. If neither has it, say the data is not available and name which depth would get it.
- **Always state the source depth** — in-context or deep — and, for in-context, what it cannot see.
- **Never sum `input_tokens` across turns.** It is the single easiest way to publish a wrong number
  that looks authoritative.
- **An agent's self-report is a claim, not evidence.** Agents describe their own runs
  optimistically. Check the transcript before repeating a claim about what an agent did.
- **Never read a full subagent transcript.** Grep it. Reading it wholesale can cost more than the
  run you are analysing.
- **Never edit agent or skill definitions here.** Propose only.
- **A retro with no proposed change is a valid outcome** — say the run was well shaped, and why.
  Manufacturing findings to look thorough is the failure mode of this skill.
