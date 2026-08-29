# Project Context — design brief (transcribed by the main session)

> The user pasted 5 screenshots into the chat. The macOS temp files behind them
> (`/var/folders/.../TemporaryItems/NSIRD_screencaptureui_*/Screenshot 2026-08-28 at 10.3*.png`)
> no longer exist on disk, so the images CANNOT be read by an agent. This file is a
> verbatim-as-possible transcription of what each screen shows, made by the main session which
> did see them. Treat it as the design source of record, and cite it as such
> ("chat screenshots, transcribed in this brief") in `## Inputs and provenance`.
> If a detail is not in this transcript, it is NOT in the design — ask, do not invent.

---

## Screen 1 — `Project Context` page (window title: "Project Context (N6)")

Three-column dark layout.

**Left sidebar (global app nav, already exists in the product):**
- Repo switcher: `acme/payments-a…` · `main · synced 2m ago`
- WORKSPACE: `Pull Requests (7)`, `Onboarding Tour`, **`Project Context`** (selected, folder icon)
- SKILLS LAB: `Skills`, `Agents`, `Conventions`, `Eval Dashboard`
- GLOBAL: `Memory`, `Multi-Agent Review`, `Agent Performance`, `CI Runs`
- Bottom: `Settings`

**Top bar:** breadcrumb `acme/payments-api  ›  Project Context`; search field "Search or jump to… ⌘K"; refresh icon; bell; avatar.

**Middle column — document tree:**
- Heading `PROJECT CONTEXT`, subtitle in mono: `.devdigest/specs/`
- Toolbar row of 4 icon buttons: `+` (new document), folder (new folder), upload (import file), refresh (re-scan)
- Flat file list (mono font, file icon per row):
  - `public-api.md`   ← selected / highlighted
  - `security-baseline.md`
  - `onboarding-flow.md`
  - `rate-limiting.prd.md`
  - `webhooks.md`
  - `data-retention.md`
- Column footer: green status dot, `Indexed: 12 files · 1,240 chunks`, second line `last 5m ago`

**Right column — document viewer:**
- Header: filename `public-api.md` (mono), segmented control `Preview | Edit` (Preview active).
  Right side of the header: globe icon + `Used by 3 agents`; a circular ring gauge reading `78`
  with the caption `COVERAGE`.
- Body renders the markdown:
  - H1 `Public API — PRD`
  - H2 `Goals` — "The public API namespace (`/api/public/*`) exposes read endpoints for third-party
    integrators without authentication, plus a webhook receiver."
  - H2 `Requirements` — bullets:
    - "All public endpoints MUST be rate-limited per client IP."
    - "Rate-limited responses MUST return 429 with a `Retry-After` header."
    - "Webhook receiver MUST verify the `stripe-signature` header."
    - "No endpoint may expose internal account IDs."
  - H2 `Non-goals` — bullets: "Authentication for public endpoints (out of scope).",
    "GraphQL surface (deferred to Q3)."

---

## Screen 2 — Agents ▸ `Security Reviewer` ▸ **Context** tab

Breadcrumb `Skills Lab › Agents`.

**Middle column — agent list**, header `Agents` + `+ Add Agent` button, search box "Search agents…".
Cards:
- `Security Reviewer` (enabled toggle on) — "Flags secrets, injection, SSRF and the l…" — chips `gpt-4.1`, `3 skills` — footer `142 runs · 78% accept · $0.04 avg`
- `Performance Reviewer` (on) — "Catches N+1 queries, missing indexes, …" — `gpt-4o`, `2 skills` — `87 runs · 64% accept · $0.05 avg`
- `Custom Mentor` (toggle OFF) — "Gentle, teaching-oriented review for ju…" — `gpt-4o-mini`, `1 skills` — `24 runs · 41% accept · $0.03 avg`

**Right pane:**
- Title `Security Reviewer`; tab row `Config | Skills | Context | Evals | Stats | CI` with **Context** active;
  top-right button `Run Review ⌄`.
- Section header `Project context` + pill badge `2 of 7 attached`; right-aligned input `Filter documents…`
- Helper line: "Order matters — earlier docs appear earlier in the assembled `## Project context`
  block. Toggle to attach."
- Seven rows, each: drag handle (⣿) · checkbox · filename (mono) · dim path prefix · right side:
  a coloured source chip and an `👁 Preview` button.
  | file | path prefix | chip | checked |
  |---|---|---|---|
  | `security-baseline.md` | `specs/` | `specs` (blue) | ✅ |
  | `public-api.md` | `specs/` | `specs` (blue) | ✅ |
  | `rate-limiting.md` | `specs/` | `specs` (blue) | ☐ |
  | `architecture.md` | `docs/` | `docs` (green) | ☐ |
  | `deployment.md` | `docs/` | `docs` (green) | ☐ |
  | `incident-2026-04-checkout.md` | `insights/` | `insights` (amber) | ☐ |
  | `perf-budget.md` | `insights/` | `insights` (amber) | ☐ |
  Checked rows are visually highlighted; the two checked ones are ordered first in the list.
- Footer row: left `≈ 317 tokens`; right, dim: "Injected as an untrusted block (`## Project context`)
  into every run."

---

## Screen 3 — Skills ▸ `pr-quality-rubric` ▸ **Context** tab

Breadcrumb `Skills Lab › Skills`. Middle column `Skills` + `+ Add Skill`, search box.
Skill cards (name, description, chips, footer stats):
- `pr-quality-rubric` (on) — "Rubric for evaluating overall PR quality ac…" — chips `rubric`, `✎ Manual` — `3 agents · 71% pull · 74% accept`
- `no-then-chains` (on) — "House rule: always use async/await inste…" — `convention`, `Extracted` — `1 agent · 34% pull · 61% accept`
- `secret-leakage-gate` (on) — "Detects sk_live, service_role, and NEXT_…" — `security`, `Community` — `1 agent · 92% pull · 88% accept`
- `lethal-trifecta` (on) — "Flags PRs combining private data access,…" — `security`, `Community` — `1 agent · 88% pull · 83% accept`
- `phantom-api-gate` (toggle OFF) — "Detects imports of functions/modules tha…" — `security`, `Imported`
- `test-coverage-nudge` (on) — "Suggests tests when new branches lack …"

**Right pane:**
- Title `pr-quality-rubric` + chips `rubric`, `v5`; tabs `Config | Context | Preview | Evals | Stats | Versions`
  with **Context** active; top-right `▷ Run on evals`.
- Section header `Project context to use` + badge `1 attached`; `Filter documents…` input.
- Helper line: "Any agent using this skill inherits these documents."
- The same 7 document rows as Screen 2, same chips/paths, with only `public-api.md` checked
  (and shown first). Row action here is a bare eye icon (preview), no "Preview" label.
- Below the list, a block labelled `SERIALIZES AS` containing a mono code panel:
  ```
  ## Project specifications
  - specs/public-api.md
  ```
  ⚠️ NOTE FOR THE SPEC AUTHOR: this header (`## Project specifications`) contradicts the header shown
  on Screen 2 and Screen 4 (`## Project context`), and it lists paths only, not document text.
  This is a real design contradiction — surface it, do not silently pick one.

---

## Screen 4 — PR #482 ▸ Agent runs ▸ run drawer (`trace` tab)

**Page behind the drawer:** breadcrumb `acme/payments-api › Pull Requests › #482`.
`#482 Add rate limiting to public API endpoints`, author `marisa.koch`, branch
`feat/rate-limit-public → main`, `+247 -38`, `opened 3h`.
Tabs `Overview | Agent runs 7 | Files changed 9` (Agent runs active).
`TIMELINE` entries (status pill, agent, model, score ring, finding counts):
- `reviewed` — Security Reviewer — `openrouter/deeps…` — score `38` — 2 errors, 1 warning · `2 blockers`
- `reviewed` — Performance Reviewer — score `64` — 1 warning, 1 info
- `error` — General Reviewer — `openai/gpt-4.1` — "429 You exceeded your current quota, please check yo…"
- commit rows interleaved: `e694ac8 fix(ci): correct PR-review posting — deterministic ve…`,
  `5f01c7e feat: add rate-limiter middleware + Redis token buc…`, `2ba3303 initial commit: public API namespace`
- `rejected` — Performance Reviewer — score `0` — 2 errors, 2 warnings, 1 info · `2 blockers`
`REVIEW RUNS` section below: `Security Reviewer` · `request changes` · `3 findings · 2 blockers`,
card body "Request changes — 3 findings · 2 blockers … Two critical exposures: a committed live Stripe key an…"

**Right drawer:**
- Header `Agent run · Security Reviewer · PR #482`, subtitle `2026-06-01 09:14:02 · completed`, close ✕.
- Tabs `trace | log` (trace active).
- Collapsible card **Configuration**:
  | label | value |
  |---|---|
  | Model | `gpt-4.1` |
  | Skills loaded | chips `secret-leakage-gate`, `lethal-trifecta`, `pr-quality-rubric` |
  | Memory pulled | `2 items` |
  | **Specs read** | `specs/security-baseline.md specs/public-api.md` |
- Collapsible card **Stats**, badge `✓ 3/3 passed`: `DURATION 8.2s` · `TOKENS 15k→1.2k` ·
  `COST $0.06` · `FINDINGS 3`
- Collapsible card **Prompt assembly** — a list of coloured segment rows, each with a copy icon and
  an `↗ expand` action:
  1. ▪ `System`
  2. ▪ `Skills — enabled skill bodies` (purple)
  3. ▪ **`Project context — attached specs (untrusted)`** (blue)
  4. ▪ `Repo skeleton — repo-intel (dynamic)` (blue)
  5. ▪ `Callers of changed symbols — repo-intel (dynamic)` (amber)
  6. ▪ `User / diff (dynamic)` (green)
- Drawer footer button: `⧉ Copy raw output`.

---

## Screen 5 — written requirements (Ukrainian bullet list, translated)

- **No automatic selection at first.** The user picks the relevant documents manually. An automatic
  selector driven by PR content is deferred to a separate feature.
- **Reader.** The server recursively finds `.md` files under `specs/`, `docs/` and `insights/`.
  The search roots are configurable; the default glob is `**/{specs,docs,insights}/**/*.md`.
- **Manual attachment.** Add a `Context` tab to the agent editor: a list with a checkbox, the path,
  the document type, search, and preview. The skill editor needs the same `Project context to use`
  section.
- **Store paths in the metadata, not text.** Before a run, `run-executor` reads the selected files
  and adds them to `## Project context` as untrusted data, with delimiters and an injection guard.
- **Run transparency.** The trace shows `specs_read`, the list of documents, and their size in
  tokens. Adding context requires no separate LLM call.
- **Verification.** Attach a document carrying the invariant "the `api/` module must not import
  `db/` directly", create a PR that violates it, and check that the reviewer cites that specific
  document.

---

## Requirements stated by the user directly in chat (verbatim intent, translated)

1. The feature is called **Project Context**. Start with it because it is small and immediately
   shows whether a spec influences the reviewer's behaviour.
2. On the Project Context page the user can find **all specifications or other .md documents in the
   project**.
3. From there (via the corresponding tabs shown in the design) the user can **attach those documents
   to skills or to agents**.
4. **Token counting happens in place**, derived from the size of the .md documents, so the user
   understands how many tokens each prompt will grow by.
5. **When an agent starts**, the attached documents (a spec or similar) are **read from the project
   and inserted into the prompt as text**.
6. When the user opens the run to inspect **Prompt Assembly**, it must show a
   **"Project context — attached specs"** segment that can be **expanded to read the full text**
   that was added to the request.
8. "Project Context Folder lets you attach markdown documents from the repository to agents and
   skills."

---

## Answers given by the user during the Step 0 interview (2026-08-28)

- **Q1 — Screen 1 scope.** "The user can edit these documents here — they just have to be added;
  think about how hard it would be to edit these documents on the filesystem. If it turns out to be
  very hard, then we can drop that idea — no editing, view-only access. What happens when an
  attached document no longer exists — we need to skip and record. Coverage and usage — let's just
  write how many agents use this skill. We need to pick the easiest implementation — in this case it
  makes no difference to us whether there is a new version or not, I'd say it isn't needed."
  → Edit / upload / new file / new folder OUT (view-only); `Used by N agents` IN; COVERAGE ring OUT;
  chunking / embeddings OUT; re-scan IN as a plain filesystem scan; no agent version bump on
  attachment change.
- **Q2 — root set.** The written requirement wins: default roots `specs/`, `docs/`, `insights/`
  matching `**/{specs,docs,insights}/**/*.md`. `.devdigest/specs/` is just one path that glob
  happens to match, not a separate managed folder. Roots are not user-configurable in this slice.
- **Q3 — read source and missing files.** Read from the existing default-branch clone; record the
  clone's commit sha in the run trace; no PR-head checkout in this slice. A missing or unreadable
  attached path is skipped, never fails the run, is marked missing in the trace, and shows a
  "missing in repo" badge in the Context tab.
- **Q4 — ordering, dedupe, cap.** "Дефолт, без ліміту" — default ordering and dedupe, but **no total
  token cap**. Agent-attached documents first in their explicit order, then skill-inherited ones;
  dedupe by path with first occurrence winning; tokens counted per document and as a total, updating
  live in the UI; everything attached is injected, with no truncation of the attached set.
- **Recommendations R1–R6 accepted; R7 (agent version bump) rejected; R8 (doc-drift fixes) routed
  away from this spec.**

---

## Transcription verification (2026-08-28, main session)

The user re-supplied all five screenshots after the spec was drafted. The main session compared each
image against the transcription above, screen by screen:

| Screen | Verdict |
|---|---|
| 1 — Project Context page | Accurate. `.devdigest/specs/` root, the six filenames, the four toolbar icons, `Preview \| Edit`, `Used by 3 agents`, the `78 COVERAGE` ring, and `Indexed: 12 files · 1,240 chunks / last 5m ago` all confirmed. |
| 2 — Agent ▸ Context tab | Accurate. `2 of 7 attached`, the "Order matters — earlier docs appear earlier in the assembled `## Project context` block" helper, all seven rows with their path prefixes and source chips, checked rows sorted first, `≈ 317 tokens`, and "Injected as an untrusted block (`## Project context`) into every run." all confirmed. |
| 3 — Skill ▸ Context tab | Accurate. `Project context to use`, `1 attached`, "Any agent using this skill inherits these documents.", and the `SERIALIZES AS` panel reading `## Project specifications` / `- specs/public-api.md` all confirmed — so the header/payload contradiction with Screens 2 and 4 is real, not a transcription error. |
| 4 — PR #482 run drawer | Accurate. `Specs read: specs/security-baseline.md specs/public-api.md` in Configuration, and the six Prompt assembly segments including `Project context — attached specs (untrusted)` with its `expand` action, all confirmed. |
| 5 — written requirements | Accurate, verbatim. |

**No requirement, acceptance criterion, edge case, or open question in SPEC-01 changed as a result of
this verification.** The spec-creator agent's caveat that it never saw the images is therefore
closed: the transcription it worked from was faithful.

The five source images are now checked in beside this file:

| File | Screen |
|---|---|
| `01-project-context-page.png` | Screen 1 — Project Context page |
| `02-agent-context-tab.png` | Screen 2 — Agent ▸ Context tab |
| `03-skill-context-tab.png` | Screen 3 — Skill ▸ Context tab |
| `04-run-trace-prompt-assembly.png` | Screen 4 — PR run drawer, Prompt assembly |
| `05-written-requirements.png` | Screen 5 — written requirements |

(An earlier copy attempt failed with `ENOENT` and was misdiagnosed as a macOS permission problem.
The real cause: macOS screenshot filenames use a narrow no-break space, U+202F, before `AM`/`PM`, so
a literal path typed with an ordinary space does not match. Copying via a glob works.)
