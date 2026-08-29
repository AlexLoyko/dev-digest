#!/usr/bin/env bash
# PreToolUse guard: confines the `spec-creator` agent's writes to spec folders.
#
# Claude Code agent frontmatter cannot express path-scoped permissions (`tools:` takes bare tool
# names only, and there is no per-agent `permissions` field). PreToolUse payloads DO carry
# `agent_type`, so this hook enforces the restriction for one agent without affecting the main
# session or any other agent.
#
# Three guards, all scoped to agent_type == "spec-creator":
#   1. Agent  — only read-only subagents (a write-capable child bypasses this hook entirely).
#   2. Bash   — refused outright (a shell redirect is an unguarded write).
#   3. Write/Edit/NotebookEdit — path must be inside a spec folder.
#
# Contract: stdin = PreToolUse JSON. exit 0 = allow, exit 2 = block (stderr is shown to the model).

set -uo pipefail

payload=$(cat)

# Fail open if jq is unavailable — a broken guard must never wedge the session.
if ! command -v jq >/dev/null 2>&1; then
  echo "spec-creator-guard: jq not found; write restriction NOT enforced" >&2
  exit 0
fi

agent_type=$(printf '%s' "$payload" | jq -r '.agent_type // ""')
tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // ""')

# Only this agent. Everything else passes straight through.
[ "$agent_type" = "spec-creator" ] || exit 0

# --- Delegation guard -------------------------------------------------------
# Spawning a write-capable subagent is a write by proxy: the child reports its own
# agent_type, so this hook would never see it. Only read-only agents are allowed.
if [ "$tool_name" = "Agent" ]; then
  subagent=$(printf '%s' "$payload" | jq -r '.tool_input.subagent_type // "general-purpose"')
  case "$subagent" in
    researcher|Explore) exit 0 ;;
    *)
      cat >&2 <<MSG
BLOCKED by spec-creator-guard: spec-creator may only delegate to read-only agents.

  attempted: subagent_type = $subagent
  allowed:   researcher, Explore

A write-capable subagent would bypass this guard entirely, since it reports its own
agent_type. Gather information with researcher/Explore and decide for yourself.
MSG
      exit 2 ;;
  esac
fi

# --- Shell guard ------------------------------------------------------------
# Bash is not in this agent's tools, but if that ever changes a shell redirect would
# be an unguarded write. Refuse outright rather than trying to parse shell safely.
if [ "$tool_name" = "Bash" ]; then
  cat >&2 <<'MSG'
BLOCKED by spec-creator-guard: spec-creator may not run shell commands.

Shell redirects are unguarded writes. Use Read, Glob, and Grep to inspect the repo,
and Write/Edit inside spec folders to author the spec.
MSG
  exit 2
fi

# --- File-write guard -------------------------------------------------------
case "$tool_name" in
  Write|Edit|NotebookEdit) ;;
  *) exit 0 ;;
esac

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
[ -n "$file_path" ] && [ "$file_path" != "null" ] || exit 0

# Normalise to a project-relative path so `specs/` matches whether the tool passed an absolute
# path or a relative one.
project_dir=${CLAUDE_PROJECT_DIR:-$PWD}
rel_path=${file_path#"$project_dir"/}
rel_path=${rel_path#./}

# Allowed: the root specs/ tree and any <module>/specs/ tree.
if [[ "$rel_path" == specs/* || "$rel_path" == */specs/* ]]; then
  exit 0
fi

cat >&2 <<MSG
BLOCKED by spec-creator-guard: the spec-creator agent may only write inside spec folders.

  attempted: $rel_path
  allowed:   specs/**  and  <module>/specs/**

A spec says what and why. Implementation plans belong to implementation-planner (docs/plans/),
product code to implementer. Report this as out of scope instead of creating the file.
MSG
exit 2
