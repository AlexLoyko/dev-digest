/**
 * scanner.ts — Project Context module: clone-tree discovery of context
 * documents (every markdown file in the clone).
 *
 * Walks a repo clone and returns one record per discovered `.md` file
 * anywhere in the clone, except beneath an excluded directory (AC-1). Each
 * record's `root` is a category derived purely from its path by
 * `deriveCategory` (`constants.ts`) — this file only calls that function
 * once per discovered file, it holds none of the category logic itself.
 *
 * Reused verbatim from repo-intel:
 *  - `EXCLUDED_DIRS` / `MAX_FILE_SIZE` / `MAX_INDEXED_FILES` — never
 *    redefined here, imported from `repo-intel/constants.ts`.
 *  - The walk shape (recursive readdir, basename-matched exclusion, never
 *    follow symlinks, unreadable dirs swallowed) mirrors
 *    `repo-intel/pipeline/walk.ts` — deliberately does NOT honor
 *    `.gitignore`, same as that module.
 *
 * Widened scope, added 2026-08-28 (NFR-2): directories whose name begins
 * with `.` (`.claude`, `.github`, `.git`, ...) are never walked, in addition
 * to `EXCLUDED_DIRS` — without this, tooling/config directories would
 * dominate the discovered set now that the walk isn't confined to
 * specs/docs/insights subtrees. `CLAUDE.md` / `AGENTS.md` are excluded the
 * same way by filename, at any depth (`isExcludedFilename`, `constants.ts`)
 * — they are per-package agent tooling files, not directory-shaped, so the
 * dot-directory rule can't catch them. An excluded file is dropped before it
 * becomes a candidate at all — never emitted as a record.
 *
 * Deliberately different from walk.ts: oversize files are NOT dropped
 * silently. They are still emitted as a record with `excludedReason` set and
 * no token count (EC-4 — "reported rather than silent"; `skippedTooLarge` in
 * `ScanStats` mirrors `walk.ts`'s `stats.skippedTooLarge` field).
 *
 * AC-15 (hard constraint): this module never calls an LLM, directly or
 * indirectly. Threat classification uses ONLY `regexScan`
 * (`modules/skills/scanner.ts`) — a pure, synchronous regex layer. `llmScan`
 * from that module is never imported here, and nothing on this path holds an
 * `LLMProvider` reference.
 *
 * NFR-7: document text is read once per kept file, used in-process to derive
 * `tokens`/`tokensApproximate`/`threatLevel`, and then discarded — the text
 * itself is never part of the returned record and is never written anywhere.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS, MAX_FILE_SIZE, MAX_INDEXED_FILES } from '../repo-intel/constants.js';
import { regexScan, type ThreatLevel } from '../skills/scanner.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { deriveCategory, isExcludedFilename, type ContextRoot } from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

/** One discovered context document. Metadata only — see NFR-7 in the module header. */
export interface ContextDocumentRecord {
  /** Path relative to `cloneRoot`, forward-slash separated. */
  path: string;
  /** The category derived from this document's path (see `deriveCategory`). */
  root: ContextRoot;
  sizeBytes: number;
  /** 0 when the file was excluded from scanning (e.g. oversize). */
  tokens: number;
  tokensApproximate: boolean;
  /** 'unknown' when the file was excluded from scanning (never regex-scanned). */
  threatLevel: ThreatLevel;
  /** Set (non-null) when the file was excluded from scanning, e.g. oversize. */
  excludedReason: string | null;
}

export interface ScanStats {
  /** .md files found anywhere in the clone (excluded dirs aside), before size/bound filtering. */
  totalCandidates: number;
  /** Candidates over MAX_FILE_SIZE — still emitted as a record (EC-4), just counted here too. */
  skippedTooLarge: number;
  /** Candidates dropped entirely because the file list exceeded MAX_INDEXED_FILES. */
  bounded: number;
}

export interface ScanCloneResult {
  documents: ContextDocumentRecord[];
  stats: ScanStats;
}

/** Internal: a discovered path, pre-stat/pre-read. */
interface Candidate {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to `cloneRoot`, forward-slash separated. */
  rel: string;
  root: ContextRoot;
}

/**
 * Walk `cloneRoot` and return one record per discovered context document
 * plus aggregate stats. `tokenizer` is used to count tokens for kept files
 * only — oversize files never reach the tokenizer.
 */
export async function scanClone(
  cloneRoot: string,
  tokenizer: Tokenizer,
): Promise<ScanCloneResult> {
  const candidates: Candidate[] = [];
  await walkDir(cloneRoot, cloneRoot, candidates);

  // Stable order (alphabetical relpath), same rationale as walk.ts: keeps
  // "first N when bounded" reproducible across runs.
  candidates.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const stats: ScanStats = {
    totalCandidates: candidates.length,
    skippedTooLarge: 0,
    bounded: 0,
  };

  let kept = candidates;
  if (kept.length > MAX_INDEXED_FILES) {
    stats.bounded = kept.length - MAX_INDEXED_FILES;
    kept = kept.slice(0, MAX_INDEXED_FILES);
  }

  const documents: ContextDocumentRecord[] = [];
  for (const candidate of kept) {
    let size: number;
    try {
      size = (await stat(candidate.abs)).size;
    } catch {
      // Disappeared between walk and stat (race) — skip cleanly, matches
      // walk.ts's stat-failure handling.
      continue;
    }

    if (size > MAX_FILE_SIZE) {
      stats.skippedTooLarge += 1;
      documents.push({
        path: candidate.rel,
        root: candidate.root,
        sizeBytes: size,
        tokens: 0,
        tokensApproximate: false,
        threatLevel: 'unknown',
        excludedReason: `File exceeds ${MAX_FILE_SIZE} byte limit`,
      });
      continue;
    }

    let text: string;
    try {
      text = await readFile(candidate.abs, 'utf8');
    } catch {
      // Unreadable file (permissions, race between walk and read) — reported
      // rather than dropped silently, same EC-4 rationale as the size case.
      documents.push({
        path: candidate.rel,
        root: candidate.root,
        sizeBytes: size,
        tokens: 0,
        tokensApproximate: false,
        threatLevel: 'unknown',
        excludedReason: 'File could not be read',
      });
      continue;
    }

    const { tokens, approximate } = tokenizer.countDetailed(text);
    const { threatLevel } = regexScan(text);

    documents.push({
      path: candidate.rel,
      root: candidate.root,
      sizeBytes: size,
      tokens,
      tokensApproximate: approximate,
      threatLevel,
      excludedReason: null,
    });
  }

  return { documents, stats };
}

async function walkDir(cloneRoot: string, dir: string, out: Candidate[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — swallowed, not
    // thrown, so discovery keeps making progress on the rest of the clone.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escapes)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue; // basename match, any depth
      if (name.startsWith('.')) continue; // NFR-2: dot-directories (.claude, .github, ...) never walked
      await walkDir(cloneRoot, join(dir, name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!name.toLowerCase().endsWith('.md')) continue;
    // Agent tooling files (CLAUDE.md, AGENTS.md), any depth — not a
    // candidate at all, never a record (never `excludedReason`; that's
    // reserved for in-scope files that couldn't be read, EC-4).
    if (isExcludedFilename(name)) continue;

    const abs = join(dir, name);
    const rel = relative(cloneRoot, abs).split(sep).join('/');
    out.push({ abs, rel, root: deriveCategory(rel) });
  }
}
