# Evals for the dependency-checker skill

These ship with the skill so it stays self-contained: whoever receives the skill also receives the
cases that prove it works. The harness that *executes* them lives outside, in `skill-evals/` at the
repo root, so the delivered skill carries no runner, no results and no dependencies.

## Layout

| Path | What it is |
|---|---|
| `evals.json` | 3 cases, 22 assertions |
| `answer-key.md` | Hand-verified ground truth. **Never shown to a run.** |

## Why there are no fixtures

The other skills here plant defects in a synthetic module and check whether a run finds them. That
shape does not fit this skill. A hand-built fixture repository would be small enough to audit by
reading its `package.json` files — which is exactly the behaviour the skill exists to replace, so a
run could reach the right answer by the wrong method and score full marks.

These cases therefore run against the real repository, and the assertions are anchored to facts
verified by hand and recorded in `answer-key.md`.

The cost is that the cases age: they assert things about this repo at a point in time. When one
starts failing for both arms, check `answer-key.md` against the repo before assuming the skill
regressed — the repo may simply have moved.

## What the cases are actually testing

Recall is the easy half. Any capable run lists the dependencies; the assertions that separate a good
audit from a plausible-looking one are all about **precision**:

| Trap | Case | The confident wrong answer |
|---|---|---|
| `pino-pretty` is named as a string, not imported | 0, 2 | "unused, delete it" |
| `@vscode/ripgrep` is behind a dynamic import with a bundler pragma | 0, 2 | "unused, delete it" |
| `recharts` reaches the browser through files that carry no `'use client'` | 1 | "server-only, costs nothing" |
| `mermaid` is already lazy | 1 | "recommend lazy-loading it" |
| `client/.next` holds a development build | 0, 1 | quoting dev chunk sizes as bundle sizes |
| `server/clones/` is a full checkout of this repo | 0 | every size roughly doubled |

A run that finds every dependency and falls into three of these has produced a worse artefact than
one that finds fewer things and is right about them — because someone will act on it.

## Grading

Assertions here are about the prose of a report, so they are graded by a model against
`answer-key.md`. The mechanical parts (does the report exist, does it contain a Mermaid block, does
it name all six packages) can be checked with a script; the judgement parts cannot, and pretending
otherwise makes the numbers look sharper than they are.

One run per cell is not a measurement. Run 3× per cell before believing a delta, and keep the
per-case breakdown — the aggregate hides which case carried the difference.

## Known non-discriminating assertion

Case 0's "runs the bundled collector scripts" **cannot** pass in the baseline arm, which is forbidden
from reading `.claude/skills/`. It measures whether the skill was followed, not whether the answer
improved. Keep it for the with_skill arm as a compliance check and exclude it from any reported
pass-rate delta.
