import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { RepoRef, IntentSource } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { isSafeRepoPath } from '../_shared/repo-path.js';
import { MAX_DOC_BYTES, MAX_DOC_CHARS, MAX_DOC_READS, MAX_DOC_REFS, type Logger } from './constants.js';

/**
 * Resolve the classifier's evidence — §1 of the L03 plan. Builds
 * `sources: IntentSource[]` (the confidence evidence, also what the UI
 * tooltip shows) plus the actual text of whatever resolved, capped.
 *
 * No HTTP fetching of arbitrary URLs, ever — a doc ref is only ever read via
 * `container.git.readFile` against the local clone, which is what makes this
 * hermetically testable via `MockGitClient`.
 */

interface DocRefCandidate {
  /** What gets recorded as `IntentSource.ref` — the repo-relative path. */
  ref: string;
  path: string;
}

interface DocExtraction {
  candidates: DocRefCandidate[];
  /** Blob URLs whose owner/repo did not match this repo — dropped, never read. */
  foreignDropped: string[];
}

const BLOB_URL_RE =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/[^/\s]+\/([^\s)"'<>]+\.mdx?)\b/gi;
const BARE_MD_RE = /(?:^|[\s(`'"[])([A-Za-z0-9_][\w.\-/]*\.mdx?)\b/g;

/**
 * Extract candidate plan/spec doc references from PR body text: repo-relative
 * `*.md`/`*.mdx` paths, and `github.com/<owner>/<repo>/blob/<ref>/<path>` URLs
 * — but ONLY the latter when owner/name case-insensitively match this repo's
 * `full_name`. Non-GitHub URLs are stripped before the bare-path scan so a
 * path fragment inside an unrelated URL is never mistaken for a doc ref.
 */
function extractDocRefs(body: string, repoFullName: string): DocExtraction {
  const candidates: DocRefCandidate[] = [];
  const foreignDropped: string[] = [];
  const seen = new Set<string>();

  for (const m of body.matchAll(BLOB_URL_RE)) {
    const [, owner, name, path] = m;
    if (!path) continue;
    if (`${owner}/${name}`.toLowerCase() !== repoFullName.toLowerCase()) {
      foreignDropped.push(path);
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    candidates.push({ ref: path, path });
  }

  const withoutUrls = body.replace(/\bhttps?:\/\/\S+/gi, ' ');
  for (const m of withoutUrls.matchAll(BARE_MD_RE)) {
    const path = m[1]!;
    if (seen.has(path)) continue;
    seen.add(path);
    candidates.push({ ref: path, path });
  }

  return { candidates, foreignDropped };
}

export interface SourceResolution {
  sources: IntentSource[];
  /**
   * Doc contents actually read, each capped `MAX_DOC_CHARS`. `sourceChars` is the
   * length BEFORE the cap, so `prompt.ts` can report truncation as a fact rather
   * than inferring it from `text.length === MAX_DOC_CHARS` — which lies for a doc
   * that happens to be exactly that long.
   */
  docTexts: { path: string; text: string; sourceChars: number }[];
}

export async function resolveSources(
  container: Container,
  ref: RepoRef,
  repoFullName: string,
  prId: string,
  title: string,
  body: string | null,
  logger?: Logger,
): Promise<SourceResolution> {
  const sources: IntentSource[] = [];
  const trimmedBody = (body ?? '').trim();

  // Source 1 — PR title. Always present; never alone enough for > 'low'.
  sources.push({ kind: 'pr_title', ref: title.slice(0, 200), resolved: true });

  // Source 2 — PR body.
  sources.push({ kind: 'pr_body', ref: 'body', resolved: trimmedBody.length > 0 });

  // Source 3 — plan/spec docs, local clone only, never HTTP. This resolver
  // makes no network call at all: linked-issue resolution was removed with the
  // input narrowing, and it was the classifier's only outbound request.
  const docTexts: SourceResolution['docTexts'] = [];
  const { candidates, foreignDropped } = extractDocRefs(trimmedBody, repoFullName);
  for (const dropped of foreignDropped) {
    logger?.warn({ prId, ref: dropped, reason: 'foreign_repo' }, 'intent: doc ref dropped');
  }

  const root = container.git.clonePathFor(ref);
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  let reads = 0;
  for (const candidate of candidates.slice(0, MAX_DOC_REFS)) {
    const drop = (reason: 'unsafe_path' | 'cap_exceeded' | 'empty_or_missing') => {
      logger?.warn({ prId, ref: candidate.ref, reason }, 'intent: doc ref dropped');
      sources.push({ kind: 'doc', ref: candidate.ref, resolved: false });
    };

    if (!isSafeRepoPath(candidate.path)) {
      drop('unsafe_path');
      continue;
    }
    const lexical = resolve(root, candidate.path);
    if (lexical !== root && !lexical.startsWith(normalizedRoot)) {
      drop('unsafe_path');
      continue;
    }
    if (reads >= MAX_DOC_READS) {
      drop('cap_exceeded');
      continue;
    }
    reads++;

    try {
      // `isSafeRepoPath` and the `resolve()` above are both LEXICAL — neither
      // can see a symlink, but `container.git.readFile` follows them
      // (adapters/git/simple-git.ts uses fs.readFile). A clone whose default
      // branch contains `docs/plan.md -> ~/.devdigest/secrets.json`, cited from
      // an attacker-controlled PR body, would otherwise be read straight into
      // the classifier prompt and persisted. Resolve the REAL path and
      // re-assert containment before reading. Mirrors conventions/service.ts.
      const realRoot = await realpath(root);
      const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
      const real = await realpath(lexical);
      if (real !== realRoot && !real.startsWith(realRootPrefix)) {
        drop('unsafe_path');
        continue;
      }
      // Bounded in COUNT by MAX_DOC_READS and in SIZE here: a cited path aimed
      // at a huge file — or at a character device such as /dev/zero via the
      // symlink route above — would otherwise be slurped whole into memory.
      const info = await stat(real);
      if (!info.isFile() || info.size > MAX_DOC_BYTES) {
        drop('unsafe_path');
        continue;
      }

      const text = await container.git.readFile(ref, candidate.path);
      // `MockGitClient.readFile` returns '' where the real client throws —
      // treat empty/whitespace as unresolvable under BOTH clients
      // (server/INSIGHTS.md), or every mocked test reports a false `high`.
      if (text.trim().length === 0) {
        drop('empty_or_missing');
        continue;
      }
      docTexts.push({
        path: candidate.path,
        text: text.slice(0, MAX_DOC_CHARS),
        sourceChars: text.length,
      });
      sources.push({ kind: 'doc', ref: candidate.ref, resolved: true });
    } catch {
      drop('empty_or_missing');
    }
  }

  // Source 4 — the code itself: the changed-file list from hunk headers
  // (`digest.ts`), never hunk content. Always available (the caller already
  // loaded the diff), so it can never be empty.
  sources.push({ kind: 'diff', ref: 'diff', resolved: true });

  return { sources, docTexts };
}
