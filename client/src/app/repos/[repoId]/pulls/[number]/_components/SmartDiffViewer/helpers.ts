/* Pure helpers for the Smart Diff view. */
import type { FindingRecord, PrFile } from "@devdigest/shared";
import type { Line } from "@/components/diff-viewer";
import { MAX_FINDING_LINE_SPAN, SEVERITY_RANK } from "./constants";

/** path → PrFile, so a group's file entries can find their patch text. */
export function indexByPath(files: PrFile[]): Map<string, PrFile> {
  return new Map(files.map((f) => [f.path, f]));
}

/**
 * The lines ONE finding decorates: the lines in its cited range that actually
 * CHANGED, not every line in between.
 *
 * Models cite generously — a real `SUGGESTION 23-33` on an 11-line hunk covered
 * `id: r.id,` and `cloned: Boolean(…)`, neither of which it had anything to say
 * about. Painting the whole range marks code nobody flagged and turns the bar
 * into noise. Restricting to added lines keeps the decoration on the change the
 * finding is actually about.
 *
 * A range containing no added line at all falls back to the cited `start_line`,
 * so a finding about untouched context still shows up somewhere.
 */
function decoratedLines(f: FindingRecord, addedLines: Set<number>): number[] {
  const start = f.start_line;
  if (start == null) return []; // anchors to nothing
  const rawEnd = f.end_line == null || f.end_line < start ? start : f.end_line;
  // Clamped to the server's cap so the two agree on what a finding covers, and
  // so an absurd `end_line` cannot make this walk a million numbers per render.
  const end = Math.min(rawEnd, start + MAX_FINDING_LINE_SPAN - 1);
  const hit: number[] = [];
  for (let n = start; n <= end; n++) if (addedLines.has(n)) hit.push(n);
  return hit.length > 0 ? hit : [start];
}

/** The new-side numbers of every ADDED row in a parsed patch. */
function addedLinesOf(lines: Line[]): Set<number> {
  const out = new Set<number>();
  for (const ln of lines) if (ln.kind === "add" && ln.newNo != null) out.add(ln.newNo);
  return out;
}

/**
 * new-side line number → the findings decorating it, for ONE file.
 *
 * The server's `finding_lines` deliberately carries no severity and no id, so
 * the decoration is joined here from the findings the page already fetched.
 */
export function findingsByLine(
  findings: FindingRecord[],
  path: string,
  lines: Line[],
): Map<number, FindingRecord[]> {
  const addedLines = addedLinesOf(lines);
  const out = new Map<number, FindingRecord[]>();
  for (const f of findings) {
    if (f.file !== path) continue;
    for (const n of decoratedLines(f, addedLines)) {
      const at = out.get(n);
      if (at) at.push(f);
      else out.set(n, [f]);
    }
  }
  return out;
}

/**
 * The finding that decides a line's colour: the most severe one on it. Ties keep
 * the first, which is the order the findings arrived in.
 */
export function worstOf(findings: FindingRecord[]): FindingRecord | undefined {
  return findings.reduce<FindingRecord | undefined>((worst, f) => {
    if (!worst) return f;
    return (SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[worst.severity] ?? 0) ? f : worst;
  }, undefined);
}

/**
 * anchor line → the findings whose chip belongs there, worst first.
 *
 * The anchor is the FIRST of the lines the finding decorates — so the chip is
 * always on a line the bar marks, and the two can never disagree. That is the
 * first changed line in the cited range (`WARNING 135-142` badges 138, the
 * `.orderBy` that changed, not the untouched `.select()` on 135), or the cited
 * start when the range changed nothing.
 *
 * Deleted lines never anchor: they carry no new-side number, so there is no
 * rendered row to hang a chip on.
 */
export function anchorsByLine(
  findings: FindingRecord[],
  path: string,
  lines: Line[],
): Map<number, FindingRecord[]> {
  const addedLines = addedLinesOf(lines);
  const out = new Map<number, FindingRecord[]>();
  for (const f of findings) {
    if (f.file !== path) continue;
    const anchor = decoratedLines(f, addedLines)[0];
    if (anchor == null) continue;
    const at = out.get(anchor);
    if (at) at.push(f);
    else out.set(anchor, [f]);
  }

  for (const list of out.values()) {
    list.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  }
  return out;
}

/** The severity a whole file should be dotted with — its worst finding's. */
export function worstSeverityForFile(
  findings: FindingRecord[],
  path: string,
): string | undefined {
  return worstOf(findings.filter((f) => f.file === path))?.severity;
}
