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
