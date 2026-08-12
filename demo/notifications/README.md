# Demo fixture — notification service

**This is not part of DevDigest.** It exists only to give the review agents and the
Smart Diff view a realistic, self-contained change to work on.

It lives at the repo root under `demo/`, which is outside every package and outside
every CI workflow's `paths:` filter (`client/**`, `server/**`, `reviewer-core/**`,
`e2e/**`) — so nothing here is built, typechecked, linted, or tested.

## What it models

A small service that fans one event out to a subscriber's enabled channels.

| File | Role |
|---|---|
| `src/dispatcher.ts` | fan-out, per-channel delivery, digests, batch summary |
| `src/templates.ts` | event kind → subject, plain-text body, HTML body |
| `src/retry.ts` | backoff for transient transport failures |
| `src/routes.ts` | HTTP surface |
| `src/config.ts` | env-backed settings |
| `src/index.ts` | public exports |

## What 0.2.0 adds

- **HTML email.** `renderHtml` wraps the plain-text body in a minimal layout and
  links back to the studio, so email stops being a wall of monospace.
- **Digests.** `POST /notify/digest` rolls several events into one message per
  subscriber instead of one message per event.
- **Subscriber preferences.** `deliverAll` takes an optional `PreferenceStore` and
  skips anyone who is muted or inside their quiet hours.
- **A `finding.assigned` template**, for when a reviewer hands a finding to someone.
- **Wider retries.** `isTransient` no longer tries to classify the error — a partial
  provider outage returned 400s and we gave up on the first attempt.
- **A debug route.** `GET /notify/debug/config` returns the resolved settings so
  support can diagnose a misconfigured deployment without shell access.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `NOTIFY_MAX_CONCURRENCY` | `250` | subscribers delivered to at once |
| `NOTIFY_RETRY_ATTEMPTS` | `8` | attempts per channel, including the first |
| `NOTIFY_RETRY_BASE_MS` | `200` | first backoff step |
| `NOTIFY_RETRY_MAX_MS` | `5000` | backoff ceiling |
| `NOTIFY_STUDIO_URL` | `http://localhost:3000` | base for links in bodies |
| `NOTIFY_EMAIL_KEY` | — | email provider credential |
| `NOTIFY_WEBHOOK_SECRET` | — | shared secret for signing webhooks |

## Do not merge

Any pull request built on this fixture is a demo. It is never intended to land on
`main`, and the code is written to be *reviewable*, not to be correct.
