# SPEC-02 — PR Brief card states

Design source for the states the loaded-state screenshot (`../01-loaded-overview.png`) never showed.
Referenced by `../../SPEC-02.md`.

These are **design artboards, not shipped UI**. They show intended behaviour. Each file is a
self-contained HTML document — open one in a browser to view it, or open `canvas.json` in the
design-canvas viewer to see all six laid out together. The convenience pointer to the hosted canvas
is `https://claude.ai/code/artifact/9790aa19-0393-416f-bbd8-13efd3e3821d`, but these files are the
source of record.

## The artboards

| File | State | What it shows |
|---|---|---|
| `Main.dc.html` | 1 · Generating | Spinner in the icon slot, "Generating brief" headline, a chip naming what is being read, shimmer placeholders where the prose will land, regenerate control present but disabled. |
| `NoAgentRun.dc.html` | 2 · No completed agent run | Risk level drives headline and tint ("Medium risk", warning-toned). A "No review run yet" chip occupies the slot the findings/blockers chip would use. "What" and "why" render as two paragraphs in descending emphasis. No score ring, no cost/token row. Regenerate control active. |
| `Stale.dc.html` | 3 · Stale, regenerating | The previous brief — verdict headline, prose, score ring and its label — all held at reduced emphasis, behind a full-emphasis chip with a spinner reading "New commits — updating brief". **No regenerate control:** regeneration is already under way. |
| `Failed.dc.html` | 4 · Generation failed, no prior brief | Neutral headline "Couldn't generate brief", the cause stated in plain language, and a "Try again" control beneath it. No chip and no score ring. The trailing region is present but empty and hidden from assistive technology, with its width reserved so the prose does not reflow. Carries an assertive live-region role. |
| `FailedWithPrior.dc.html` | 5 · Generation failed, prior brief kept | The earlier brief at reduced emphasis — headline, prose, score ring — behind a critical-toned chip reading "Couldn't update — showing the previous brief", with "Try again" beneath the prose. Carries an assertive live-region role. |
| `EmptyReviewFocus.dc.html` | 6 · Review focus, empty | The review-focus card's standard empty state: centred icon, "Nothing to read first", and a sentence explaining that no file was singled out. |
| `canvas.json` | — | Artboard layout, per-state titles, and a scope annotation. Not an artboard itself. |

`canvas.json` numbers these 1–6 in that order; the numbering above matches it.

## The governing rule

Every state keeps the loaded card's anatomy — a leading status slot, a flexible main column, and a
trailing slot — so the card does not restructure as it moves between states. Only the contents of
those regions change. This holds across all six artboards with no exception; `SPEC-02.md` requires it
as AC-20.

A slot with nothing to show keeps its footprint rather than collapsing — see the reserved trailing
region in `Failed.dc.html`. This is the substance of the rule, not a detail of it: an empty flex child
collapses to zero width, which would let the prose reflow to full width and then jump back the moment
a later generation succeeds and the score ring appears. Recovery in both failed states is the inline
"Try again" control alone; no state offers two affordances for one action.

## Provenance

Tokens, spacing, and type are lifted from the product's own stylesheet, and the card anatomy is
reproduced from the existing verdict-banner, card, section-label, badge, score-ring, and empty-state
primitives — so these artboards reflect what the product can already render, not a new visual
language. The states were approved by the user on 2026-08-29.

All animation in these files is disabled under `prefers-reduced-motion`; that is a requirement, not
a demo detail (see NFR-4).
