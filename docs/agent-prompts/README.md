# Writing agent prompts

How a review agent's `system_prompt` is turned into the messages a model sees, and
the conventions that keep findings, scores, and verdicts consistent.

These are the prompts that drive each reviewer agent (stored on `agents.system_prompt`
in the DB). The canonical, reviewable copies live next to this file:

- [`general-reviewer.md`](./general-reviewer.md)
- [`security-reviewer.md`](./security-reviewer.md)
- [`performance-reviewer.md`](./performance-reviewer.md)
- [`api-contract-reviewer.md`](./api-contract-reviewer.md)

Skill bodies linked to an agent live in [`skills/`](./skills/), one file per skill.
Their YAML frontmatter carries the UI/DB metadata (`name`, `description`, `type`,
`source`); the skill **body** is everything below the closing `---`.

> The DB is the source of truth at run time. These files are the human-readable
> originals — when you change a prompt, edit the file here **and** push it to the
> agent (`PUT /agents/:id`, which versions the change into `agent_versions`).

## How a prompt is assembled

Assembly happens in `reviewer-core/src/prompt.ts` (`assemblePrompt`). The model
receives exactly two messages:

**System message** = your agent prompt **+** a fixed injection guard:

```
<your system_prompt>

<INJECTION_GUARD>   // appended verbatim to EVERY agent, every run
```

`INJECTION_GUARD` (`prompt.ts:16`) tells the model that everything inside
`<untrusted>…</untrusted>` is data, never instructions, and that claims like "test
fixture / not for production / ignore this" never descope the review. You do not
need to repeat any of this in your prompt — it is always there.

**User message** = the task and all context, in this order, each untrusted block
delimiter-wrapped (`prompt.ts:122-143`):

```
<task line, e.g. "Review PR #7 '…'">
## PR description             (untrusted, author-controlled, truncated to 4000 chars)
## Derived intent (advisory)  (L03 — trusted advisory sentence + untrusted payload)
## Skills / rules             (linked skill bodies)
## Relevant memory            (curated memory items)
## Repo skeleton              (untrusted, repo-derived)
## Project context            (untrusted spec chunks)
## Callers of changed symbols (untrusted, repo-derived)
## Diff to review             (untrusted)
```

Sections with no content are omitted. Everything repo- or author-derived is wrapped
in `<untrusted source="…">…</untrusted>` so the model can tell instructions
(system) from data (user).

### `## Derived intent (advisory)` — the trusted/untrusted split (L03)

Server-side (`server/src/modules/intent/`, see
[`server/specs/0002-pr-intent-layer.md`](../../server/specs/0002-pr-intent-layer.md))
classifies a PR's intent — what it's trying to do, and what it deliberately is not —
with a cheap model, and hands `reviewer-core` a single pre-rendered string via
`PromptParts.intent` (`prompt.ts:79-86`). `reviewer-core` never formats domain
objects; it only places the string.

The rendered section has a deliberate two-part structure (`prompt.ts:127-131`):

```
## Derived intent (advisory)
<DERIVED_INTENT_ADVISORY — trusted, OUTSIDE the wrapper>
<untrusted source="intent">
<the classifier's payload — type, summary, in/out of scope, confidence>
</untrusted>
```

- The advisory sentence (`DERIVED_INTENT_ADVISORY`, `prompt.ts:43-46`) is **our own
  trusted text**, rendered *outside* `<untrusted>`. It tells the model the block is a
  hint for prioritisation only, never evidence, and can never justify lowering a
  severity or dropping a finding. Because it sits outside the wrapper, the
  PR-derived payload inside can never claim that weight for itself.
- The payload itself goes through `wrapUntrusted('intent', …)` (`prompt.ts:33-34,
  129`) like every other repo/PR-derived section, so `</untrusted>` injection
  attempts are escaped the same way as the diff or the PR description.
- `INJECTION_GUARD` (`prompt.ts:16-28`) already names "derived intent/scope"
  explicitly among the untrusted categories it covers (`prompt.ts:18`) and already
  states that stated intent can never turn a real defect into zero findings
  (`prompt.ts:26-28`) — this slot needed no guard changes, only a placement.
- Placement is right after `## PR description` and before `## Skills / rules`: it is
  *derived from* the description, so it sits in the same "what the author claims"
  cluster, ahead of trusted project rules so a repo skill is never visually
  outranked by a model's derivation, and well ahead of the diff, which stays
  terminal and most salient.
- **Omit-when-empty is preserved**: the section only renders when
  `parts.intent && parts.intent.trim().length > 0` (`prompt.ts:127`), matching
  `repoMap`/`callers`. With the slot absent, `assemblePrompt`'s output is
  byte-identical to the pre-L03 shape.

This is the concrete mitigation for a real failure mode: published research
(arXiv:2603.18740) shows attacker-crafted PR metadata can bias an LLM reviewer into
clearing vulnerable code. A confidently-worded intent summary is *worse* than raw
untrusted text, because a summary reads like a conclusion — hence trusting only our
own framing sentence, never the derived content, and computing confidence in code
rather than letting the model self-report it (`server/src/modules/intent/confidence.ts`).

**The classifier's own request is observable.** The upstream call that produces this
block logs what it sent, verbatim and attributed per source, at `info` on
`intent: prompt` — so an embedded instruction in a PR body, or a doc ref that resolved
to a file nobody meant, is visible on the line rather than inferred from a token count
(`server/src/modules/intent/prompt.ts`, and the Logging section of
[`server/specs/0002-pr-intent-layer.md`](../../server/specs/0002-pr-intent-layer.md)).
Logging it whole is safe by construction, not by scrubbing: the classifier prompt holds
only the PR title, body, linked docs and the changed-**file** list, so it contains no
hunk content to leak. The model's own output and `res.raw` stay out of the logs.

## The output schema is NOT in the prompt

This is the most common source of confusion. The structure of the response — the
`{ verdict, summary, score, findings[] }` object and every field type — is enforced
**out of band** by the provider, not by prompt text:

```ts
// reviewer-core/src/llm/openrouter.ts
response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }
```

The schema is the Zod `Review` contract in
`server/src/vendor/shared/contracts/findings.ts`, converted to JSON Schema and sent
as a separate API parameter. In `strict` mode the model **cannot** return anything
that doesn't match it. Consequences for prompt authors:

- **Do not describe the JSON shape, field names, or a markdown layout in the prompt.**
  It is redundant at best and actively harmful when it disagrees with the schema
  (e.g. a prompt that asks for `### [SEVERITY]` markdown sections while the schema
  demands a JSON object — the model gets two conflicting specs and produces garbage
  in the fields the prompt didn't pin down).
- **Use the schema's own vocabulary.** Severity is exactly `CRITICAL | WARNING |
  SUGGESTION`. Verdict is exactly `request_changes | approve | comment`. Do not
  introduce a different scale ("High/Medium/Low") in the prompt — the model will map
  it onto the enum inconsistently and inflate severities.
- **Field *meaning* belongs in the schema's `.describe()`, field *judgment* belongs
  in the prompt.** The prompt's job is to tell the model *what to flag and at what
  severity*, and *when each verdict applies* — not what the JSON looks like.

## Required conventions (every reviewer prompt)

Every reviewer prompt must end with three blocks, because the engine derives
numbers and gates from what the model returns:

1. **Severity rubric** mapped to the three enum levels, with an explicit
   anti-inflation rule. Only `CRITICAL` blocks merge, so a model that calls
   everything CRITICAL turns every PR into a blocker. State plainly that speculative
   issues ("might be", "if not already handled") are at most `WARNING`.

2. **Verdict semantics.** The model owns `verdict`, so it must be told the mapping:
   `request_changes` ⇔ at least one CRITICAL; `comment` ⇔ only non-blocking
   findings; `approve` ⇔ empty findings list. **No findings ⇒ approve.** Without
   this, models default `verdict` arbitrarily (we have observed `request_changes`
   returned with zero findings and a summary saying "no issues found").

3. **Findings discipline.** No duplicate findings; no padding toward a count. There
   is no minimum or target — zero is a good answer. Models treat "return at most N
   findings" as a quota and pad the list with repeats to hit N, which also corrupts
   the score. State that the count is free and repeats are forbidden.

## How the engine uses the output (why the conventions matter)

`reviewer-core/src/review/run.ts` + `reduce.ts`:

- **`score` is recomputed**, never trusted from the model:
  `scoreFromFindings(grounded)` (`reduce.ts:27`). 0 findings ⇒ 100; each CRITICAL
  −35, WARNING −12, SUGGESTION −3. So the number on screen always matches the
  findings list. The model's self-reported score is ignored.
- **Findings are citation-grounded**: a finding whose line range doesn't intersect a
  real diff hunk is dropped (`grounding.ts`). Cite real `file:line` from the diff or
  the finding disappears.
- **`verdict` is currently passed through from the model** (`run.ts:208`). That is
  why a wrong verdict reaches the UI unchanged — and why the verdict convention
  above is load-bearing until/unless the verdict is also derived deterministically.

## Severity / verdict / gate at a glance

| Model returns | Engine does |
|---|---|
| `findings[].severity` | recompute `score`; count CRITICAL as blockers |
| `score` | **ignored** — recomputed from findings |
| `verdict` | passed through to the review record (shown in the UI) |
| `findings[]` | citation-grounded; ungrounded ones dropped |

The per-agent merge gate (`agents.ciFailOn`, default `critical`) decides when a CI
review **blocks**: it is deterministic from finding severities, independent of the
model's `verdict`. Keep your severities honest and the gate behaves.

## Checklist before shipping a prompt

- [ ] Role + concrete "what to look for", in priority order.
- [ ] "Analyze along the execution path; state the mechanism" guidance.
- [ ] Quality bar: precision over volume; empty list is allowed.
- [ ] Severity rubric using `CRITICAL/WARNING/SUGGESTION` + anti-inflation rule.
- [ ] Verdict mapping incl. "no findings ⇒ approve".
- [ ] Findings discipline: distinct only, no count target.
- [ ] No JSON shape / markdown layout / alternate severity scale described in prose.
- [ ] No "return at most N findings" quota.
- [ ] File updated here **and** pushed to the agent (versioned).
