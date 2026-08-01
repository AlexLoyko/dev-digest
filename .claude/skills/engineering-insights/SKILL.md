---
name: engineering-insights
description: "Capture a non-obvious engineering lesson into the INSIGHTS.md of the package it belongs to. Use whenever work in this repo surfaces a surprise, a footgun, an approach that failed and why, a project convention that is not written down, or a bug whose symptom pointed away from its cause. Trigger terms: that was surprising, I did not expect, gotcha, footgun, turns out, root cause, red herring, doesn't work because, had to instead, record this, remember this for next time."
allowed-tools: Read, Edit, Grep, Glob
---

# Engineering insights

Each package keeps a dated append-log of things learned the hard way. Sessions are
disposable; that file is not. When this session learns something the next one would
otherwise have to rediscover, write it down where it belongs.

## When to write

1. **Surprise / footgun** — the system behaved differently than a competent dev would
   predict, and the gap cost time.
2. **Failed approach** — a path tried and abandoned, *with the reason it failed*.
3. **Undocumented convention** — a project rule learned by reading code, absent from
   `CLAUDE.md` and `README.md`.
4. **Root cause far from symptom** — record the symptom → cause → fix chain.

## The bar

The entry must be actionable **cold**: an agent that reads it with no other context
knows what to do or avoid, and where.

Test before writing: *if this would be obvious to anyone reading the code, don't write
it.*

> Illustrative only — the two rows below describe a fictional project. Never file an
> example from this skill as an entry.

| ❌ Noise | ✅ Insight |
|---|---|
| "Careful with the queue worker." | "`drainQueue()` acks before the handler resolves, so a throw loses the message silently. Ack in the handler's `finally`, not at dequeue (`worker/queue.ts:88`)." |
| "Watch out for the date parsing." | "The importer stores timestamps as naive local time; comparing them to `NOW()` in Postgres is off by the host's UTC offset. Parse to UTC at the boundary (`import/normalize.ts:41`)." |

For tone, density and hard-wrap width, skim the real entries already in the target
`INSIGHTS.md` — but treat them as *style reference and duplicate check*, never as
material to restate.

## Where it goes

| Files you touched | Write to |
|---|---|
| `client/**` | `client/INSIGHTS.md` |
| `server/**` (incl. `src/modules/repo-intel/`) | `server/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| `scripts/`, `.github/workflows/`, root docs, both `vendor/shared` copies | the `INSIGHTS.md` of the package where the problem actually **bit**; cross-link the other with a relative path |

**Do not create a root `INSIGHTS.md`.** A genuinely repo-wide rule belongs in root
`CLAUDE.md` under *Repo-wide invariants* — say so to the user instead of filing it. One
root cause that bit two packages → one entry where it surfaced, plus a one-line
`Related:` pointer in the other.

## Not for this

- **Generic engineering knowledge.** "N+1 queries are slow" is not a DevDigest insight.
- **Anything already written down** — an existing `INSIGHTS.md` entry (grep first), a
  `CLAUDE.md` invariant, `README.md`, or `docs/`. The four files already carry 18 entries
  between them; restating one in different words is the most likely failure mode here.
- **Task status or narration.** "Refactored the routes today" is a commit message.
- **Secrets.** Never put an API key, token, or the contents of `~/.devdigest/secrets.json`
  into an entry — `INSIGHTS.md` is committed. Describe the mechanism, not the value.
- **A rule you have now hit twice.** See below.

## Promote on the second hit

If the trap already has an entry, it has stopped being a gotcha and become a rule of the
package. Do not file a near-duplicate: tell the user it belongs in that package's
`CLAUDE.md` under `## Invariants`, and leave the original entry alone. Repo-wide, it goes
to root `CLAUDE.md` under *Repo-wide invariants*. Propose it; do not edit `CLAUDE.md`
yourself.

## How to write it

1. `Read` the target `INSIGHTS.md` and `Grep` it for the key identifier —
   `grep -ni '<symbol-or-filename>' <pkg>/INSIGHTS.md`. If something similar exists, show
   it to the user and ask whether to extend or promote it, rather than adding a second.
2. Insert the new entry **directly after the `---` on line 9** — the files are
   newest-first. Do not append at the bottom.
3. Match the header contract these files declare: a dated title, the trap, the fix, and a
   `file:line` or commit reference.

```markdown
## YYYY-MM-DD — <one-line claim, backtick the identifier or file>

<The trap: what happened, what the system actually does, why that is not what you would
expect. 1–3 short paragraphs, hard-wrapped at ~88 columns.>
→ <The fix, or the rule to follow instead.> (`path/file.ts:12-18`, commit `abc1234`)
```

4. Every entry carries at least one `file:line` or commit SHA. No evidence → not an entry.
5. **Never rewrite or delete an existing entry.** The one permitted edit: when an entry
   stops being true, append `[resolved YYYY-MM-DD]` to its title and add a line saying
   what changed.
6. Use today's real date. One entry per distinct lesson — don't batch unrelated findings
   under one heading.
7. Confirm in one line so the write is visible without opening the file:

```
✅ client/INSIGHTS.md — "SSE reconnect replays findings into the run panel"  (4 entries)
```
