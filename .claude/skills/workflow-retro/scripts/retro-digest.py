#!/usr/bin/env python3
"""
Deterministic telemetry extractor for `/workflow-retro`.

Reads a Claude Code session transcript plus every subagent transcript it spawned
and prints a compact markdown digest: token accounting, agent roster, launch
order, parallelism, tool mix, cross-agent file overlap, and failures.

The model must NOT compute these numbers itself — it reads this digest.
Stdlib only. Usage:

    retro-digest.py                     # most recently modified session
    retro-digest.py --session <uuid>
    retro-digest.py --list              # list candidate sessions
"""

import argparse
import collections
import json
import os
import sys
from datetime import datetime
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"


# ---------------------------------------------------------------- helpers

def slug_for(cwd: Path) -> str:
    """Claude Code encodes the project path by replacing separators with '-'."""
    return str(cwd).replace("/", "-")


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_jsonl(path):
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def fmt_int(n):
    return f"{n:,}".replace(",", " ")


def fmt_dur(seconds):
    if seconds is None:
        return "—"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


# ---------------------------------------------------------------- accounting

class Usage:
    """Token accounting that does not lie.

    Per-message `input_tokens` cannot be summed into a meaningful total: every
    turn re-sends the whole context, so a naive sum counts the same tokens
    dozens of times. Only output, cache-creation and cache-read are additive
    costs; context SIZE is a max, not a sum.
    """

    def __init__(self):
        self.turns = 0
        self.fresh_in = 0
        self.cache_write = 0
        self.cache_read = 0
        self.out = 0
        self.thinking = 0
        self.peak_context = 0

    def add(self, u):
        if not u:
            return
        self.turns += 1
        fin = u.get("input_tokens", 0) or 0
        cw = u.get("cache_creation_input_tokens", 0) or 0
        cr = u.get("cache_read_input_tokens", 0) or 0
        self.fresh_in += fin
        self.cache_write += cw
        self.cache_read += cr
        self.out += u.get("output_tokens", 0) or 0
        det = u.get("output_tokens_details") or {}
        self.thinking += det.get("thinking_tokens", 0) or 0
        self.peak_context = max(self.peak_context, fin + cw + cr)

    @property
    def billable_new(self):
        """Tokens the model actually had to process fresh, plus what it wrote."""
        return self.fresh_in + self.cache_write + self.out


# ---------------------------------------------------------------- extraction

class AgentRun:
    def __init__(self, agent_id, subagent_type, description, model, launched_at, tool_use_id):
        self.agent_id = agent_id
        self.subagent_type = subagent_type or "(unnamed)"
        self.description = description or ""
        self.model = model or "?"
        self.launched_at = launched_at
        self.tool_use_id = tool_use_id
        self.status = "unknown"
        self.usage = Usage()
        self.tools = collections.Counter()
        self.files_read = collections.Counter()
        self.skills = collections.Counter()
        self.nested = []          # subagent_types this agent spawned
        self.first_ts = None
        self.last_ts = None
        self.errors = []
        self.resumes = 0          # how many times it was re-sent a message
        self.transcript = None
        self.parent = None        # subagent_type of the agent that spawned it
        self.depth = 1

    @property
    def duration(self):
        if self.first_ts and self.last_ts:
            return (self.last_ts - self.first_ts).total_seconds()
        return None


PROJECT_ROOT = [Path.cwd()]


def norm_path(p):
    """Repo-relative, so an absolute `Read` path and a relative `Bash` path
    for the same file collapse into one key instead of double-counting."""
    if not p:
        return p
    try:
        return str(Path(p).resolve().relative_to(PROJECT_ROOT[0]))
    except (ValueError, OSError):
        return p


def extract_file_path(tool_name, inp):
    if not isinstance(inp, dict):
        return None
    if tool_name in ("Read", "Edit", "Write", "NotebookEdit"):
        return inp.get("file_path") or inp.get("notebook_path")
    return None


BASH_PATH_RE = __import__("re").compile(
    r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.(?:ts|tsx|js|jsx|json|md|sql|sh|py|yml|yaml))"
)


def bash_paths(cmd):
    """Heuristic: file paths named inside a Bash command (cat/sed/grep/etc.).

    Read/Edit/Write give exact paths; Bash does not, so these are a best-effort
    signal and are labelled as such in the report.
    """
    if not isinstance(cmd, str):
        return []
    return [m.group(1) for m in BASH_PATH_RE.finditer(cmd)]


def scan_transcript(path, run=None):
    """Populate Usage + tool counters + child agent ids from one transcript."""
    usage = Usage()
    tools = collections.Counter()
    files = collections.Counter()
    skills = collections.Counter()
    nested = []
    children = {}          # agentId -> subagent_type, for depth-2+ linking
    pending = {}           # tool_use_id -> subagent_type
    errors = []
    first = last = None

    for d in read_jsonl(path):
        tur = d.get("toolUseResult")
        if isinstance(tur, dict) and tur.get("agentId"):
            m0 = d.get("message") or {}
            c0 = m0.get("content")
            tuid = None
            if isinstance(c0, list):
                for c in c0:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        tuid = c.get("tool_use_id")
            children[tur["agentId"]] = pending.get(tuid, "(unnamed)")
        ts = parse_ts(d.get("timestamp"))
        if ts:
            first = first or ts
            last = ts
        msg = d.get("message") or {}
        if d.get("type") == "assistant":
            usage.add(msg.get("usage"))
            if msg.get("model") == "<synthetic>":
                txt = ""
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "text":
                        txt += c.get("text", "")
                errors.append(txt.strip()[:300] or "(synthetic message)")
        content = msg.get("content")
        if isinstance(content, list):
            for c in content:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                name = c.get("name", "?")
                tools[name] += 1
                inp = c.get("input") or {}
                fp = extract_file_path(name, inp)
                if fp:
                    files[norm_path(fp)] += 1
                if name == "Bash":
                    for bp in bash_paths(inp.get("command")):
                        files[norm_path(bp)] += 1
                if name == "Skill":
                    skills[inp.get("skill", "?")] += 1
                if name == "Agent":
                    st = inp.get("subagent_type") or "(unnamed)"
                    nested.append(st)
                    pending[c.get("id")] = st
    return usage, tools, files, skills, nested, errors, first, last, children


def build(session_file: Path, subagent_dir: Path):
    main_usage = Usage()
    main_tools = collections.Counter()
    main_files = collections.Counter()
    main_skills = collections.Counter()
    runs = []
    by_tool_use = {}
    results = {}
    errors = []
    user_turns = 0
    first = last = None
    branch = None
    version = None

    for d in read_jsonl(session_file):
        ts = parse_ts(d.get("timestamp"))
        if ts:
            first = first or ts
            last = ts
        branch = d.get("gitBranch") or branch
        version = d.get("version") or version
        msg = d.get("message") or {}

        if d.get("type") == "user" and not d.get("isMeta"):
            content = msg.get("content")
            # a genuine user turn carries text, not a tool_result
            if isinstance(content, str) and content.strip():
                user_turns += 1
            elif isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "text" for c in content
            ):
                user_turns += 1

        tur = d.get("toolUseResult")
        if isinstance(tur, dict):
            content = msg.get("content")
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        results[c.get("tool_use_id")] = tur

        if d.get("type") == "assistant":
            main_usage.add(msg.get("usage"))
            if msg.get("model") == "<synthetic>":
                txt = ""
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "text":
                        txt += c.get("text", "")
                errors.append(txt.strip()[:300] or "(synthetic message)")
            content = msg.get("content")
            if isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict) or c.get("type") != "tool_use":
                        continue
                    name = c.get("name", "?")
                    main_tools[name] += 1
                    inp = c.get("input") or {}
                    fp = extract_file_path(name, inp)
                    if fp:
                        main_files[norm_path(fp)] += 1
                    if name == "Bash":
                        for bp in bash_paths(inp.get("command")):
                            main_files[norm_path(bp)] += 1
                    if name == "Skill":
                        main_skills[inp.get("skill", "?")] += 1
                    if name == "Agent":
                        by_tool_use[c.get("id")] = AgentRun(
                            agent_id=None,
                            subagent_type=inp.get("subagent_type"),
                            description=inp.get("description"),
                            model=inp.get("model"),
                            launched_at=ts,
                            tool_use_id=c.get("id"),
                        )
                    if name == "SendMessage":
                        target = (inp.get("to") or "").strip()
                        for r in by_tool_use.values():
                            if r.agent_id and r.agent_id == target:
                                r.resumes += 1

    # attach launch results
    for tuid, run in by_tool_use.items():
        res = results.get(tuid) or {}
        run.agent_id = res.get("agentId") or run.agent_id
        run.status = res.get("status") or run.status
        run.model = res.get("resolvedModel") or run.model
        runs.append(run)

    # read every subagent transcript in the directory, not only the ones the main
    # session launched — an agent that spawns agents is otherwise invisible, and
    # its children's tokens would go uncounted.
    by_id = {r.agent_id: r for r in runs if r.agent_id}
    child_links = {}          # childAgentId -> (parent_run, declared_type)

    def load(run):
        p = subagent_dir / f"agent-{run.agent_id}.jsonl"
        if not p.exists():
            return
        run.transcript = p
        (run.usage, run.tools, run.files_read, run.skills,
         run.nested, run.errors, run.first_ts, run.last_ts, kids) = scan_transcript(p)
        for cid, ctype in kids.items():
            child_links[cid] = (run, ctype)

    for run in list(by_id.values()):
        load(run)

    # breadth-first over discovered children
    frontier = list(child_links.items())
    while frontier:
        cid, (parent, ctype) = frontier.pop(0)
        if cid in by_id:
            continue
        child = AgentRun(agent_id=cid, subagent_type=ctype, description="",
                         model=parent.model, launched_at=None, tool_use_id=None)
        child.parent = parent.subagent_type
        child.depth = parent.depth + 1
        child.status = "nested"
        by_id[cid] = child
        runs.append(child)
        before = set(child_links)
        load(child)
        child.launched_at = child.first_ts
        frontier += [(k, v) for k, v in child_links.items() if k not in before]

    # orphans: a transcript on disk that nothing claimed
    if subagent_dir.is_dir():
        for f in sorted(subagent_dir.glob("agent-*.jsonl")):
            aid = f.stem[len("agent-"):]
            if aid in by_id:
                continue
            orphan = AgentRun(agent_id=aid, subagent_type="(unlinked)", description="",
                              model="?", launched_at=None, tool_use_id=None)
            orphan.status = "unlinked transcript"
            load(orphan)
            orphan.launched_at = orphan.first_ts
            by_id[aid] = orphan
            runs.append(orphan)

    runs.sort(key=lambda r: (r.launched_at or datetime.max.replace(tzinfo=None)))
    return {
        "branch": branch, "version": version,
        "first": first, "last": last,
        "user_turns": user_turns,
        "main_usage": main_usage, "main_tools": main_tools,
        "main_files": main_files, "main_skills": main_skills,
        "runs": runs, "errors": errors,
    }


# ---------------------------------------------------------------- rendering

def overlaps(runs):
    """Pairs of agents whose active windows intersect — i.e. ran in parallel."""
    out = []
    for i, a in enumerate(runs):
        for b in runs[i + 1:]:
            if not (a.first_ts and a.last_ts and b.first_ts and b.last_ts):
                continue
            start = max(a.first_ts, b.first_ts)
            end = min(a.last_ts, b.last_ts)
            if (end - start).total_seconds() > 0:
                out.append((a, b, (end - start).total_seconds()))
    return out


def render(data, session_id):
    L = []
    w = L.append
    mu = data["main_usage"]
    runs = data["runs"]
    span = None
    if data["first"] and data["last"]:
        span = (data["last"] - data["first"]).total_seconds()

    w(f"# Workflow telemetry — session `{session_id}`")
    w("")
    w(f"- Branch: `{data['branch'] or '?'}` · CLI `{data['version'] or '?'}`")
    if data["first"]:
        w(f"- Window: {data['first'].strftime('%Y-%m-%d %H:%M')} → "
          f"{data['last'].strftime('%H:%M')} ({fmt_dur(span)})")
    w(f"- User turns: {data['user_turns']} · main-session assistant turns: {mu.turns}")
    w("")

    w("## Token accounting")
    w("")
    w("> Per-message `input_tokens` is NOT summable — every turn re-sends the whole")
    w("> context. Only output / cache-write / cache-read are additive; context size is a max.")
    w("")
    w("| Scope | Fresh in | Cache write | Cache read | Output | (thinking) | Peak context |")
    w("|---|--:|--:|--:|--:|--:|--:|")
    w(f"| main session | {fmt_int(mu.fresh_in)} | {fmt_int(mu.cache_write)} | "
      f"{fmt_int(mu.cache_read)} | {fmt_int(mu.out)} | {fmt_int(mu.thinking)} | "
      f"{fmt_int(mu.peak_context)} |")
    tot = Usage()
    for r in runs:
        u = r.usage
        tot.fresh_in += u.fresh_in
        tot.cache_write += u.cache_write
        tot.cache_read += u.cache_read
        tot.out += u.out
        tot.thinking += u.thinking
        tot.turns += u.turns
        tot.peak_context = max(tot.peak_context, u.peak_context)
        w(f"| ↳ {r.subagent_type} `{(r.agent_id or '?')[:7]}` | {fmt_int(u.fresh_in)} | "
          f"{fmt_int(u.cache_write)} | {fmt_int(u.cache_read)} | {fmt_int(u.out)} | "
          f"{fmt_int(u.thinking)} | {fmt_int(u.peak_context)} |")
    w(f"| **all subagents** | {fmt_int(tot.fresh_in)} | {fmt_int(tot.cache_write)} | "
      f"{fmt_int(tot.cache_read)} | {fmt_int(tot.out)} | {fmt_int(tot.thinking)} | "
      f"{fmt_int(tot.peak_context)} |")
    grand_new = mu.billable_new + tot.billable_new
    w("")
    w(f"**Fresh-processing total (fresh in + cache write + output): "
      f"{fmt_int(grand_new)} tokens.** Cache reads on top: "
      f"{fmt_int(mu.cache_read + tot.cache_read)}.")
    w("")

    w("## Agents")
    w("")
    if not runs:
        w("_No subagents were launched in this session._")
    else:
        roots = [r for r in runs if r.depth == 1]
        deeper = [r for r in runs if r.depth > 1]
        w(f"{len(runs)} agent transcripts — {len(roots)} launched by the main session, "
          f"{len(deeper)} spawned by other agents (max depth {max(r.depth for r in runs)}).")
        w("")
        w("| # | Agent | Model | Launched | Active | Turns | Tools | Nested | Status |")
        w("|--:|---|---|---|--:|--:|--:|--:|---|")
        for i, r in enumerate(runs, 1):
            t = r.launched_at.strftime("%H:%M:%S") if r.launched_at else "—"
            label = ("↳ " * (r.depth - 1)) + r.subagent_type
            if r.parent:
                label += f"<br><sub>via {r.parent}</sub>"
            w(f"| {i} | {label}<br>`{r.description}` | `{r.model}` | {t} | "
              f"{fmt_dur(r.duration)} | {r.usage.turns} | {sum(r.tools.values())} | "
              f"{len(r.nested)} | {r.status}"
              + (f" · {r.resumes} resume(s)" if r.resumes else "") + " |")
        w("")
        w("### Launch order")
        w("")
        for i, r in enumerate(runs, 1):
            t = r.launched_at.strftime("%H:%M:%S") if r.launched_at else "—"
            nested = f" → spawned {', '.join(r.nested)}" if r.nested else ""
            w(f"{i}. `{t}` **{r.subagent_type}** — {r.description}{nested}")
        w("")
        par = overlaps(runs)
        w("### Parallelism")
        w("")
        if par:
            for a, b, sec in par:
                w(f"- {a.subagent_type} ∥ {b.subagent_type} — overlapped {fmt_dur(sec)}")
        else:
            w("- None. Every agent ran strictly after the previous one finished "
              "(sequential — check whether that was necessary).")
        w("")
        w("### Tool mix per agent")
        w("")
        for r in runs:
            mix = ", ".join(f"{k}×{v}" for k, v in r.tools.most_common())
            w(f"- **{r.subagent_type}**: {mix or '(none)'}"
              + (f" · skills: {', '.join(r.skills)}" if r.skills else ""))
        w("")

    w("### Main session tool mix")
    w("")
    w("- " + (", ".join(f"{k}×{v}" for k, v in data["main_tools"].most_common()) or "(none)"))
    if data["main_skills"]:
        w("- Skills invoked: " + ", ".join(data["main_skills"]))
    w("")

    # ---- duplication
    w("## Duplicated work signals")
    w("")
    owners = collections.defaultdict(set)
    counts = collections.Counter()
    for path, n in data["main_files"].items():
        owners[path].add("main")
        counts[path] += n
    for r in runs:
        for path, n in r.files_read.items():
            owners[path].add(r.subagent_type)
            counts[path] += n
    shared = {p: o for p, o in owners.items() if len(o) > 1}
    if shared:
        w("**Files touched by more than one actor** — each re-read costs its reader full")
        w("tokens. Paths from `Read`/`Edit`/`Write` are exact; paths recovered from `Bash`")
        w("commands are a heuristic and may over- or under-count.")
        w("")
        for p, o in sorted(shared.items(), key=lambda kv: -counts[kv[0]])[:20]:
            w(f"- `{p}` — {counts[p]}× by {', '.join(sorted(o))}")
    else:
        w("- No file was touched by more than one actor.")
    w("")
    rereads = {p: n for p, n in counts.items() if n > 2}
    if rereads:
        w("**Read 3+ times in total** (candidate for passing content in the prompt instead):")
        w("")
        for p, n in sorted(rereads.items(), key=lambda kv: -kv[1])[:10]:
            w(f"- `{p}` — {n}×")
        w("")

    # ---- failures
    w("## Failures, retries and interruptions")
    w("")
    any_err = False
    if data["errors"]:
        any_err = True
        w("**Main session:**")
        for e in data["errors"]:
            w(f"- {e}")
    for r in runs:
        if r.errors:
            any_err = True
            w(f"**{r.subagent_type}:**")
            for e in r.errors:
                w(f"- {e}")
        if r.resumes:
            any_err = True
            w(f"- {r.subagent_type} was resumed {r.resumes}× via SendMessage")
    if not any_err:
        w("- None recorded.")
    w("")

    w("## Transcripts for qualitative reading")
    w("")
    w(f"- main: `{PROJECTS}/<project>/{session_id}.jsonl`")
    for r in runs:
        if r.transcript:
            w(f"- {r.subagent_type}: `{r.transcript}`")
    w("")
    return "\n".join(L)


# ---------------------------------------------------------------- cli

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", help="session uuid (default: most recently modified)")
    ap.add_argument("--project-dir", default=os.getcwd())
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    PROJECT_ROOT[0] = Path(args.project_dir).resolve()
    root = PROJECTS / slug_for(PROJECT_ROOT[0])
    if not root.is_dir():
        sys.exit(f"No transcript directory for {args.project_dir} (looked in {root})")

    sessions = sorted(root.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not sessions:
        sys.exit(f"No session transcripts in {root}")

    if args.list:
        for p in sessions[:15]:
            ts = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            print(f"{p.stem}  {ts}  {p.stat().st_size // 1024} KB")
        return

    session_file = root / f"{args.session}.jsonl" if args.session else sessions[0]
    if not session_file.exists():
        sys.exit(f"No such session transcript: {session_file}")

    session_id = session_file.stem
    data = build(session_file, root / session_id / "subagents")
    print(render(data, session_id))


if __name__ == "__main__":
    main()
