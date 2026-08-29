#!/usr/bin/env bash
# Deterministic architecture checks for DevDigest.
#
# These rules used to live inside the `architecture-reviewer` agent, where each one cost model
# tokens to run a check that is literally a grep. They are mechanical and have no judgement in
# them, so they belong in a script that runs in a second for free — not in an opus context window.
#
# The agent keeps the three rules that genuinely need judgement:
#   inward-only-dependencies · business-logic-in-routes · shared-contract-not-duplicated
#
#   ./scripts/arch-check.sh                 # all rules
#   ./scripts/arch-check.sh --no-contracts  # skip the contract-sync rule (see NOTE below)
#
# Exit 0 = clean, exit 1 = violations.
#
# NOTE on contracts-in-sync: as of this writing the two vendored copies have REAL drift
# (server is ahead: AgentManifest, the 'openrouter' provider, and different validators in
# knowledge.ts). Until that is reconciled the rule is red. Use --no-contracts to run the
# other rules as a per-phase gate in the meantime.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

violations=0
skip_contracts=0
[ "${1:-}" = "--no-contracts" ] && skip_contracts=1

report() { # $1 = rule, $2 = location, $3 = evidence
  printf '  \033[31m✗\033[0m %-32s %s\n      %s\n' "$1" "$2" "$3"
  violations=$((violations + 1))
}
trim() { sed 's/^[[:space:]]*//' | cut -c1-110; }

echo "arch-check — deterministic structural rules"
echo

# ---------------------------------------------------------------------------
# RULE: no-process-env-outside-allowlist
# Source: server/CLAUDE.md — "LocalSecretsProvider is the only place that reads process.env.
#         Everywhere else uses the injected SecretsProvider."
#
# Allowlist = the documented chokepoints. config.ts takes process.env as a default parameter for
# non-secret config; local.ts IS the LocalSecretsProvider; migrate/seed are standalone scripts;
# simple-git WRITES env for git subprocesses rather than reading secrets from it.
# ---------------------------------------------------------------------------
env_allow='server/src/adapters/secrets/local\.ts|server/src/platform/config\.ts|server/src/db/migrate\.ts|server/src/db/seed\.ts|server/src/adapters/git/simple-git\.ts'

while IFS=: read -r f l rest; do
  [ -n "${f:-}" ] || continue
  report "no-process-env-outside-allowlist" "$f:$l" "$(printf '%s' "$rest" | trim)"
done < <(grep -rn "process\.env" server/src --include="*.ts" 2>/dev/null \
          | grep -Ev "$env_allow" \
          | grep -vE ':[0-9]+:\s*(\*|//)' || true)

# ---------------------------------------------------------------------------
# RULE: reviewer-core-zero-io
# Source: reviewer-core/CLAUDE.md — "no I/O except the injected LLMProvider"
# ---------------------------------------------------------------------------
while IFS=: read -r f l rest; do
  [ -n "${f:-}" ] || continue
  report "reviewer-core-zero-io" "$f:$l" "$(printf '%s' "$rest" | trim)"
done < <(grep -rnE "^\s*import .*from\s+['\"](node:)?(fs|fs/promises|http|https|net|dns|child_process|pg|axios|node-fetch|undici|@octokit/)" \
          reviewer-core/src --include="*.ts" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# RULE: adapters-built-only-in-container
# Source: server/docs/architecture.md — "platform/container.ts is the single DI container.
#         It wires all adapters at startup."
#
# Scoped deliberately to ADAPTERS (the outer ring: DB/GitHub/LLM/git/secrets clients), which is
# the invariant that actually holds in this codebase today.
#
# Services and repositories are NOT checked here: the shipped pattern is `new FooService(container)`
# / `this.repo = new FooRepository(container.db)` in ~23 places, which contradicts the constructor-
# injection example in architecture.md:20-32. That contradiction is a judgement call about which of
# the two is authoritative — it belongs to architecture-reviewer and the user, not to a grep gate.
# ---------------------------------------------------------------------------
while IFS=: read -r f l rest; do
  [ -n "${f:-}" ] || continue
  report "adapters-built-only-in-container" "$f:$l" "$(printf '%s' "$rest" | trim)"
done < <(grep -rnE "new [A-Z][A-Za-z0-9_]*(Adapter|Provider|Client)\(" \
          server/src --include="*.ts" 2>/dev/null \
          | grep -v "server/src/platform/container\.ts" \
          | grep -vE "\.test\.ts|/mocks\.ts|/adapters/index\.ts" || true)

# ---------------------------------------------------------------------------
# RULE: contracts-in-sync
# Source: server/CLAUDE.md — "@devdigest/shared is the single source of truth for cross-package
#         Zod contracts"; pr-self-review Step 6 raises any divergence as CRITICAL.
#
# Import extensions are normalised before comparing: the client copy imports './findings' and the
# server copy './findings.js' across every file. That is a systematic vendoring transform, not
# drift — comparing raw would fire on all 7 files forever and train everyone to ignore the rule.
# ---------------------------------------------------------------------------
if [ "$skip_contracts" -eq 0 ] \
   && [ -d client/src/vendor/shared/contracts ] && [ -d server/src/vendor/shared/contracts ]; then
  tmp=$(mktemp -d) || tmp=""
  if [ -n "$tmp" ]; then
    mkdir -p "$tmp/client" "$tmp/server"
    for f in client/src/vendor/shared/contracts/*.ts; do
      sed -E "s#(from '\./[A-Za-z0-9_./-]+)\.js'#\1'#" "$f" > "$tmp/client/$(basename "$f")"
    done
    for f in server/src/vendor/shared/contracts/*.ts; do
      sed -E "s#(from '\./[A-Za-z0-9_./-]+)\.js'#\1'#" "$f" > "$tmp/server/$(basename "$f")"
    done
    while read -r line; do
      [ -n "$line" ] || continue
      name=$(printf '%s' "$line" | sed -E 's#.*/([A-Za-z0-9_.-]+\.ts) and .*#\1#; s#^Only in .*: ##')
      report "contracts-in-sync" "vendor/shared/contracts/$name" \
             "client and server copies diverge beyond the .js import transform"
    done < <(diff -rq "$tmp/client" "$tmp/server" 2>&1 || true)
    rm -rf "$tmp"
  fi
fi

# ---------------------------------------------------------------------------
echo
if [ "$violations" -eq 0 ]; then
  printf '\033[32m✓ arch-check passed\033[0m — 0 violations\n'
  exit 0
fi
printf '\033[31m✗ arch-check failed\033[0m — %d violation(s)\n' "$violations"
echo
echo "These rules are mechanical — fix them before spending a review agent on judgement rules."
exit 1
