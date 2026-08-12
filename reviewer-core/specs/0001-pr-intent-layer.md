# 0001 — PR Intent Layer: the `intent` prompt slot

Status: accepted
Lesson: L03
Packages: reviewer-core, server

Server slice: [`server/specs/0002-pr-intent-layer.md`](../../server/specs/0002-pr-intent-layer.md)
(where the classification happens — the LLM call, evidence resolution, and
confidence rubric all live in the server; this package only renders a caller-supplied
string). Client slice: [`client/specs/0002-pr-intent-layer.md`](../../client/specs/0002-pr-intent-layer.md).

## Intent

The reviewer never knows *why* a PR exists — every diff is judged as if it appeared
from nowhere. The server now derives a PR's intent (what it's trying to do, what it
deliberately isn't) with a separate cheap model and hands `reviewer-core` a single
pre-rendered string. This package's job is narrow and purity-preserving: place that
string in the prompt, wrap it like every other untrusted section, and add a trusted
sentence ahead of it so the derivation can never claim more authority than a hint.

## Behaviour

### The slot

`PromptParts.intent?: string` (`src/prompt.ts:79-86`) and `ReviewInput.intent?: string`
(`src/review/run.ts:74-79`, forwarded into `promptParts` at `run.ts:144`) — both
optional, both plain strings. `reviewer-core` never formats domain objects (no
`Intent`/`PrIntentRecord` type appears anywhere in this package); the caller
(`server/src/modules/intent/render.ts`'s `renderIntentBlock`, called via
`container.intent.renderBlock`) turns the structured record into this string before
it ever reaches `reviewer-core`.

### Rendering

`assemblePrompt` (`src/prompt.ts:103-165`) renders the block only when
`parts.intent && parts.intent.trim().length > 0` (`prompt.ts:127`):

```
## Derived intent (advisory)
<DERIVED_INTENT_ADVISORY — trusted, prompt.ts:43-46, OUTSIDE the wrapper>
<untrusted source="intent">
<parts.intent, escaped via wrapUntrusted>
</untrusted>
```

- `DERIVED_INTENT_ADVISORY` is a **module constant**, not part of the caller's string —
  it is *our* trusted framing, always the same text, rendered ahead of the wrapper
  (`prompt.ts:128-130`). It states the block is a hint for prioritisation only, is not
  evidence, and can never justify lowering a severity, dismissing, or not reporting a
  finding.
- The payload passes through `wrapUntrusted('intent', parts.intent)` (`prompt.ts:33-34,
  129`) — the same escaping every other repo/PR-derived section gets: any literal
  `</untrusted>` inside the payload is replaced with `<\/untrusted>` so it can't
  prematurely close the delimiter and inject content that reads as trusted.

### Placement in the fixed section order

`prompt.ts:122-143` builds the user message in this order:

```
<task line>
## PR description
## Derived intent (advisory)   ← L03, this spec
## Skills / rules
## Relevant memory
## Repo skeleton
## Project context
## Callers of changed symbols
## Diff to review
```

Intent renders **right after `## PR description` and before `## Skills / rules`**,
because: (1) it is *derived from* the description, so it belongs in the same
"what the author claims" cluster; (2) it comes before any trusted project rule
(skills), so a repo skill is never visually outranked by a model's own derivation of
intent; (3) it stays well ahead of the diff, which remains terminal and the most
salient content in the message. See
[`docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) for the full
order and the rationale for every section, not just this one.

### `INJECTION_GUARD` — no edit needed

`INJECTION_GUARD` (`prompt.ts:16-28`) already named "derived intent/scope" among the
untrusted content kinds it covers (`prompt.ts:18`) and already stated that a claimed
intent can never turn a real defect into zero findings (`prompt.ts:26-28`) — both
written before this feature existed. This spec's tests pin that language rather than
re-editing the guard (`test/prompt.test.ts:152-167`), per
`reviewer-core/AGENTS.md`'s rule against adding keyword/denylist scanning.

### Trace record

`assembly.intent = parts.intent ?? null` (`prompt.ts:160`), part of the
`PromptAssembly` written to `outcome.assembly` for the run trace. Absent → `null`,
never an empty string, matching the contract's `z.string().nullish()`.

### Byte-identical-when-absent guarantee

Per `reviewer-core/AGENTS.md:64-66` (every optional prompt slot must be indistinguishable
from the feature not existing when unused): `messages` produced with `intent`
omitted, `intent: ''`, and `intent: undefined` are all deep-equal
(`test/prompt.test.ts:69-80`). No `## Derived intent` heading appears in the assembled
user message in any of those three cases.

## Acceptance

- [ ] `PromptParts.intent?: string` and `ReviewInput.intent?: string` added; both
      forwarded through `run.ts`'s `promptParts` object with no other change to
      `reviewPullRequest`'s control flow.
- [ ] Section renders in the fixed position: after `## PR description`, before
      `## Skills / rules` and well before `## Diff to review`
      (`test/prompt.test.ts:82-100`).
- [ ] Payload is wrapped in `<untrusted source="intent">…</untrusted>`; the trusted
      advisory sentence sits strictly before the wrapper's open tag
      (`test/prompt.test.ts:102-121`).
- [ ] A literal `</untrusted>` inside the payload is escaped to exactly one real
      closing tag in the assembled message (`test/prompt.test.ts:123-137`).
- [ ] `assembly.intent` carries the payload when present and is `null` (not `''`,
      not `undefined`) when absent (`test/prompt.test.ts:139-149`).
- [ ] Omitting the slot, or passing `''`/`undefined`, produces a `messages` array
      deep-equal to not having the feature at all (`test/prompt.test.ts:69-80`).
- [ ] `INJECTION_GUARD` is unedited and still covers derived intent
      (`test/prompt.test.ts:152-167`).
- [ ] Purity preserved: no DB / GitHub / filesystem access added anywhere in this
      package. The slot is a plain string argument, resolved entirely by the caller.

## Contracts

No new exports from `src/index.ts` are required by this feature — `PromptParts` and
`ReviewInput` are already re-exported as part of `prompt.ts`'s and `run.ts`'s public
surface.

`@devdigest/shared` (edit the SERVER copy `server/src/vendor/shared/`, then mirror
into `client/src/vendor/shared/`): `contracts/trace.ts`'s `PromptAssembly` gains
`intent: z.string().nullish()` — nullish rather than required, because a required
field would break the inline trace fixture in `server/test/contracts.test.ts`. This
package consumes `PromptAssembly` as a type only (`ChatMessage`, `PromptAssembly`
imported at `prompt.ts:1`) — no `Intent`/`IntentSource`/`PrIntentRecord` type is
imported here; those live entirely in the server.

## Out of scope

- Deriving the intent itself — the LLM call, evidence sources, and the
  code-computed confidence rubric are entirely server-side
  (`server/src/modules/intent/`). This package never sees a PR title, body, or
  linked issue directly.
- Formatting the `Intent` record into prose — that's `renderIntentBlock` in
  `server/src/modules/intent/render.ts`. This package only places a string the caller
  already rendered.
- A second, intent-blind LLM call for security-severity findings. Named as residual
  risk in the server spec's Out of scope, not addressed here.
- Any keyword/denylist scanning of the intent payload — explicitly against
  `reviewer-core/AGENTS.md`'s guidance; `wrapUntrusted` + the guard are the only
  defenses.

## Verification

```sh
cd reviewer-core && npm test && npm run typecheck     # npm, NOT pnpm
```
`test/prompt.test.ts`'s `describe('assemblePrompt — ## Derived intent (advisory)
[L03]')` and `describe('assemblePrompt — INJECTION_GUARD still covers derived intent
(L03 regression pin)')` blocks (`test/prompt.test.ts:68-167`) are the hermetic proof:
byte-identical-when-absent, correct placement, the untrusted wrap with escaping, the
trace's `assembly.intent`, and the guard-still-covers-it regression pin — all against
a stubbed `LLMProvider`, no I/O.
