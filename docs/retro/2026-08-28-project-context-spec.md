# Workflow retro — authoring SPEC-01 (Project Context) from screenshots
Session: `43f29700-25c5-4a52-b1e4-ca56f22be6da` · 2026-08-28 · branch `lesson-5-work` · source: deep (transcripts)

## Verdict

The orchestration was worth it: one `spec-creator` fan-out produced an approved 18-criterion spec and,
as a by-product, the discovery that half the feature already exists in shipped code — which no
unaided reading of the design would have found. The single biggest change to make is to **bound the
verification pass**: `spec-creator` re-read 17 of the 23 files its own researchers had already
quoted with `path:line`, roughly doubling the read cost for claims that were already checkable.

## Cost

| Scope | Cache write | Cache read | Output | (thinking) | Peak context |
|---|--:|--:|--:|--:|--:|
| main session | 395 476 | 16 219 093 | 169 404 | 53 290 | 205 372 |
| ↳ spec-creator | 1 768 953 | 7 375 203 | 46 158 | 14 990 | 192 911 |
| ↳ researcher ×4 | 536 (k) total | 4 478 710 | 47 564 | 9 667 | 53 102 max |
| **all subagents** | 2 304 949 | 11 853 913 | 93 722 | 24 657 | 192 911 |

**Fresh-processing total: 2 964 283 tokens.** Cache reads on top: 28 073 006 — an order of magnitude
larger and an order of magnitude cheaper, which is why it is not the headline.

`spec-creator` ran on `claude-opus-5[1m]` and peaked at 192 911 tokens of context — about 19 % of its
window, so the 1M model was not the constraint. The four researchers peaked between 36 993 and
53 102: each was a cheap, disposable context, which is exactly the shape delegation should have.

Fresh input was 236 tokens for the main session and 496 across all five agents combined. Practically
everything was cache write and cache read — the cost of this session was **loading context, not
reading new material**.

## What ran

One root agent, four nested — max depth 2. `spec-creator` launched at 14:43:08 and immediately fanned
out four `researcher` agents between 14:43:34 and 14:44:01, all four overlapping each other and their
parent. Every researcher finished inside 2m 05s. That is a well-shaped fan-out: four independent
questions, dispatched in one message, answered in parallel, nothing serialised that did not need to be.

**The `Active` column in the digest is misleading and should be read with care.** `spec-creator` shows
1h 01m, but the gaps between its own timestamps account for 53 of those 61 minutes: 8m 57s, 17m 29s,
10m 30s, 5m 29s, 5m 21s, 3m 04s and 2m 16s of idle. Those gaps are the Step 0 interview waiting on a
human answer plus two machine-sleep interruptions — not compute. Actual busy time was roughly **8
minutes**. Wall-clock and busy time are different measurements and the digest currently conflates them.

## What was hard

- **`spec-creator` — interrupted twice mid-response** by `API Error: Your computer went to sleep`. It
  lost the entire drafting pass both times; on the second resume it had written the design brief to
  `design/` but not the spec itself. It took **3 `SendMessage` resumes** to finish. The recovery
  worked, but only because the resume messages restated the decisions; nothing in the agent's own
  definition tells it to persist a draft before a long write.
- **The dispatcher (main session), not the agent, lost the design.** The five screenshots lived in
  macOS temp paths that were deleted before the agent ran, so `spec-creator` worked entirely from a
  transcription and said so honestly. It was never able to verify its own primary source.

## What was easy

- **The four researchers.** 46, 53, 43 and 11 turns; 11k–18k characters returned each; one pass, no
  retries, no re-dispatch. Budget less for this stage next time — the whole fan-out finished in about
  two minutes of wall clock.
- **Registry reconciliation.** No drift between the file set and `specs/README.md`; `SPEC-01` was
  genuinely free. The reconciliation step cost a `Glob` and a read.

## What was duplicated

- **17 files read by both a researcher and `spec-creator`** — `reviewer-core/src/prompt.ts`,
  `server/src/vendor/shared/contracts/trace.ts`, `server/src/db/schema/agents.ts`,
  `server/src/adapters/git/simple-git.ts`, `server/src/modules/skills/scanner.ts` and twelve more.
  This was **deliberate verification**, and `spec-creator` said so in its report. But
  `.claude/agents/researcher.md:17` already requires *"Every project claim points to a `path:line`"*
  and line 92 requires a verbatim excerpt — so the claims arrived already checkable. Re-reading 17 of
  23 files is not verification of a citation; it is repeating the research.
- **`specs/SPEC-01-project-context/SPEC-01.md` — 17 reads** and `specs/README.md` — 8, across the main
  session and the agent. Mostly my own post-hoc verification passes, each one a fresh `sed`/`grep`.
- **The main session re-derived what a researcher had already found.** When answering Q-4 I grepped
  `server/src/modules/agents/helpers.ts` and `agent_versions` myself — ground a researcher had covered.

## What was missed

- **Q-4 was raised without checking the two facts that defuse it.** `spec-creator` flagged that
  attachment changes create no version snapshot, but did not check that (a) linking *skills* already
  does not bump the version either — the field set at `server/src/modules/agents/helpers.ts:28`
  excludes skill links — or (b) that `agent_versions` is written and **never read anywhere** in
  `server/src`. Both took two greps to establish afterwards, and together they turn Q-4 from "a
  reproducibility hole" into "consistent with existing product behaviour". An open question that
  overstates its own severity costs the user a decision round.
- **No researcher was asked what the *existing* Project Context dead code was for.** The staged
  `SpecFile` / `IndexStatus` contracts and the `context.json` message catalogue were found, but the
  question of whether they were a prior design intended to be resumed never got asked, and it became
  `Q-1` instead of an answer.

## Judgement — did each delegate earn its keep?

- **`spec-creator`: yes, decisively.** 1.77M cache-write tokens returned a 25 KB approved spec plus the
  session's most valuable finding — that `prompt.ts:121` already emits the `## Project context` block
  and `run-executor.ts:415` hardcodes it empty. That single discovery reshaped the spec from greenfield
  to half-built and removed `reviewer-core` from scope entirely.
- **The four researchers: yes, but the value was partly refunded.** ~536k cache-write tokens for four
  parallel sweeps is cheap, and 11k–18k characters of cited findings each is a good return. The refund
  is the 17-file re-read that followed.

## Proposed changes

- **`.claude/agents/spec-creator.md` — bound the verification pass.** Its "Delegating research" section
  ends with *"Subagents gather; you decide"* but sets no limit on re-reading. Add: verify a researcher's
  claim by opening the cited `path:line` only when the claim becomes load-bearing for an AC or a
  non-goal, and never re-read a file wholesale to confirm a citation that already carries a verbatim
  excerpt. Evidence: 17 of 23 file reads were duplicates of researcher reads.
- **`.claude/agents/spec-creator.md` — check before raising a reproducibility question.** Add to the
  `## Open questions` rules: before recording a question about versioning, persistence or
  reproducibility, check whether the adjacent existing feature already behaves the same way, and state
  that in the question. Evidence: Q-4 above.
- **`.claude/agents/spec-creator.md` — persist the draft before a long write.** Add to Method step 7:
  write the spec file first, then the registry row, then the report. Evidence: two sleep interruptions
  destroyed a completed draft that had never touched disk; the third attempt only succeeded because the
  resume message ordered exactly that.
- **`.claude/skills/workflow-retro/scripts/retro-digest.py` — separate wall span from busy time.** Add
  a `Busy` column (wall span minus idle gaps over ~2 min) next to `Active`. Evidence: 53 of
  `spec-creator`'s 61 minutes were idle, so the current column overstates compute by ~7×.
- **Dispatcher discipline, for the next run of this shape.** Copy design assets to a durable path
  *before* spawning the agent that needs them. Evidence: the screenshots were gone by launch time and
  the whole spec rested on a transcription until they were re-supplied two hours later.
