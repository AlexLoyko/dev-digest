# Design source — PR Why + Risk Brief

**The loaded state is captured in `01-loaded-overview.png` (1906×1350), committed alongside this
file.** That image is the design source of record. This document is a written transcription of it,
originally made from transient screenshots before any image was on disk, and since **verified
against `01-loaded-overview.png` point by point** — the PR Brief card's anatomy, the RISK AREAS
block inside the Intent card, and the Review Focus card all render as described below.

The transcription remains useful because it is searchable and diffable, and because it also covers
the second scroll position of the original screenshots. **It describes only the loaded state.** No
image has ever shown the generating, failed, stale, no-completed-run, or empty-review-focus states;
those are specified in `../SPEC-02.md` by reasoning from the product's existing conventions, not
from any design source.

The screenshots show the same screen at two scroll positions: the **PR Overview tab** of a
pull request detail page, dark theme. Left nav (existing): Workspace → Pull Requests (7),
Onboarding Tour, Project Context; Skills Lab → Skills, Agents, Conventions, Eval Dashboard;
Global → Memory, Multi-Agent Review, Agent Performance, CI Runs; Settings pinned at bottom.
Repo switcher at top of nav: `acme/payments-a…`, `main · synced 2m ago`.

## Page header (existing, unchanged)

`#482  Add rate limiting to public API endpoints`
Row beneath: avatar + `marisa.koch` · branch `feat/rate-limit-public → main` ·
`+247 −38` · `opened 3h ago` · status pill `● Needs review`.
Top-right actions: `View on GitHub` (external-link icon), `Run Review` (split button with
caret), `Compose review` (primary blue, split button with caret).
Tabs: `Overview` (active) · `Agent runs 7` · `Files changed 9`.

## NEW CARD 1 — "PR BRIEF" (topmost card in the Overview tab)

Section label above the card, small caps with a document icon: `PR BRIEF`.

The card is a single wide panel, tinted red/danger because the verdict is "Request changes":

- Left: circular red icon (⊗).
- Headline in red: **Request changes**. Immediately right of it a neutral chip:
  `6 findings · 2 blockers`, then a small ⓘ info icon.
- Body paragraph, two lines of prose:
  "Solid middleware approach, but a Stripe secret key is committed in plaintext and the
  user-list endpoint introduces an N+1 query under the new limiter. Two blockers before merge."
- Right side, top: a circular refresh/regenerate icon button (↻).
- Right side: a circular gauge/ring reading `61` with the ring partially filled in amber,
  label under it in small caps: `PR SCORE`.
- Under the gauge, a small muted meta row: `$ $0.014   8.2K→1.3K`
  (cost in dollars, then input→output token volume).

> **Superseded (2026-08-29) — token suffix case.** The image renders the token volume with an
> **uppercase** suffix (`8.2K→1.3K`). The product's existing convention for token counts uses a
> **lowercase** suffix, and the user decided the existing convention wins: it is already applied
> consistently wherever token volumes appear, so matching it costs nothing, while adopting the
> image's form would mean changing every such surface for a cosmetic gain. **The implementation
> follows the product convention, not this transcription or the screenshot, on this one point**
> (`../SPEC-02.md`, AC-22 and Q-8). Do not "correct" the implementation back to the uppercase form.
> Everything else in the loaded state was verified accurate against `01-loaded-overview.png`.

## The two-card row below the brief — part existing, part NEW

> **Correction (2026-08-29).** An earlier revision of this file labelled this whole row "shown for
> layout context only". That was wrong for the `⚠ RISK AREAS` block: **no risk presentation exists
> anywhere in the product today**, and RISK AREAS is part of *this* feature — it is where the
> brief's `risks[]` are rendered. Only the surrounding INTENT card and the whole BLAST RADIUS card
> are pre-existing. The rest of this file was verified accurate against `01-loaded-overview.png`.

- Left card `◎ INTENT` — **existing**: quoted intent sentence in italics, then two columns
  `✓ IN SCOPE` / `✕ OUT OF SCOPE` as bullet lists.
- `⚠ RISK AREAS` — **NEW**, a sub-section *inside* the existing INTENT card, below the two scope
  columns. Three collapsible rows, each an icon plus a title plus a monospace file+line reference,
  with a chevron to expand:
  "Auth surface touched" `src/middleware/ratelimit.ts:12-18`;
  "New dependency: ioredis" `package.json:34`;
  "Adds Redis round-trip per request" `src/middleware/ratelimit.ts:40-52`.
- Right card `⛬ BLAST RADIUS` — **existing**: counter row `2 symbols · 14 callers · 3 endpoints · 1 cron`,
  a `Tree | Graph` toggle, an expandable symbol tree (`rateLimit()` with 4 callers listed as
  `src/api/public/index.ts:23` etc.), endpoint chips (`GET /api/public/items`,
  `POST /api/public/webhooks`, `GET /api/public/health`), a cron chip
  `reset-rate-buckets (hourly)`, and a collapsed row `Prior PRs touching these files  3`.

## NEW CARD 2 — "REVIEW FOCUS — READ THESE FIRST" (full-width card below the two-column row)

Header row: list icon + small-caps `REVIEW FOCUS — READ THESE FIRST` + count badge `4`.

Body is a bulleted list; each item is a monospace, blue, clickable `path:line` link followed by
an em dash and a one-line plain-text reason:

- `src/config.ts:12` — live Stripe key (sk_live_…) committed in plaintext
- `src/api/public/webhooks.ts:61` — request callback_url forwards the account token to a
  caller-controlled URL
- `src/middleware/ratelimit.ts:52` — 429 branch omits the Retry-After header the PR scope promises
- `src/api/users.ts:46` — N+1 query — one posts lookup per user, hit harder under the new limiter

Nothing below this card; the page ends there.
