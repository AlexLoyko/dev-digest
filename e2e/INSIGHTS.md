# INSIGHTS — `@devdigest/e2e`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

## 2026-07-31 — `specs/` here means browser flows, not feature specs

Every other package uses `specs/` for spec-driven development. This one was already
using it for the `*.flow.json` files, which are read by `run.ts` and referenced by
`scripts/e2e.sh` and `.github/workflows/e2e-web.yml`. It was left as-is deliberately.
A forward-looking spec for a journey belongs in the package that owns the feature.

## 2026-07-31 — `npm test` against your dev DB fails flows 02/04/05

Those flows follow the home redirect to the **first** repo and assume the seeded demo
repo (`acme/payments-api`) is the only one. Your dev DB normally has other imported
repos, so they land on the wrong one. Use `npm run e2e:hermetic` — it spins up an
isolated, freshly-seeded stack on alternate ports (Postgres 5433, API 3101, web 3100)
and leaves the dev DB untouched. CI gets the same guarantee from an empty Postgres.

**Never `docker compose down -v` to "reset" a failing run.** `-v` deletes the
`devdigest_pgdata` volume along with every repo and review that has been imported.

## 2026-07-31 — `wait` is the assertion; there is no assertion library

agent-browser is a CLI, not a test framework. A non-zero exit fails the step and the
flow, so `wait --text` / `wait --url` *are* the assertions — they time out and exit
non-zero when the condition never holds. `"assert": { "stdoutIncludes": … }` is only a
light substring check on top. Locators stay deterministic (`--url`, `--text`,
`find role|text|label`); the AI `chat` command is never used, which is what keeps the
suite stable and key-free.

## 2026-08-03 — `agent-browser` does not have to be installed globally

`npm install --no-save agent-browser` inside `e2e/` leaves `package.json` and
`package-lock.json` untouched (verified: `git status` clean afterwards) and gives a real
binary at `e2e/node_modules/.bin/agent-browser`. Point the runner at it:

```sh
AGENT_BROWSER_BIN="$PWD/e2e/node_modules/.bin/agent-browser" ./scripts/e2e.sh
```

Chrome for Testing still downloads once (~178 MB) to `~/.agent-browser/browsers/`, but that
is a cache, not an installed package.

`npx agent-browser` does **not** work here: `run.ts:38-40` hands `BIN` to `execFile`, which
takes a single executable and no shell, so a two-word command can never resolve.

## 2026-08-03 — `scripts/e2e.sh` is the right local runner, and it cannot touch your dev DB

It stands up a fully isolated stack — ephemeral `docker run --rm` Postgres on :5433 with NO
volume mount, API :3101, web :3100 — that runs CONCURRENTLY with the dev stack on :3000/:3001
and cannot reach the `devdigest_pgdata` volume. It hard-refuses to migrate or seed when
`DATABASE_URL` isn't on the isolated port, and its cleanup trap `lsof`s only
`$WEB_PORT`/`$API_PORT`, never 3000/3001. Verified: after a full run the e2e container is gone
and the dev DB still holds its rows. It does NOT install `e2e/node_modules` (only
server/client/reviewer-core), so `cd e2e && npm install` first.
`scripts/e2e.sh:26-33,84-87,123`.

## 2026-08-03 — don't run `npm test` against the dev stack once you have a second repo

Flows 02/04/05 open `/` and assume the seeded `acme/payments-api` is the landing repo, but
`client/src/app/page.tsx:17` navigates to `repos[0]` and
`server/src/modules/repos/repository.ts:33` selects with **no `ORDER BY`** — so which repo is
"first" is whatever Postgres happens to return. Those three flows then fail
nondeterministically for environment reasons that look exactly like regressions. Use
`./scripts/e2e.sh` instead. Data is never at risk either way: all 7 specs are strictly
read-only and `db:seed` is insert-if-missing.
