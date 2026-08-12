import type { UnifiedDiff } from '@devdigest/shared';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import { buildCodeDigest } from './digest.js';
import { MAX_BODY_CHARS, MAX_DIGEST_FILES, SYSTEM_PROMPT } from './constants.js';

/**
 * Assembly of the intent classifier's request — extracted out of `service.ts` so
 * the exact bytes sent to the model can be logged, attributed part by part.
 *
 * Same shape as `assemblePrompt` one layer up in `reviewer-core/src/prompt.ts`:
 * return the `messages` for the model AND a descriptor for observability, so the
 * two can never drift.
 *
 * PURE: no I/O, no container. Every input is already resolved by the caller
 * (`sources.ts` for the docs, the caller's `UnifiedDiff` for the digest).
 *
 * On what may be logged from here: the parts carry their text VERBATIM and
 * un-abridged, because a truncated log is exactly what would hide the thing this
 * exists to reveal — an injected instruction in a PR body, or a doc ref that
 * resolved to something nobody meant. That is safe by construction, not by
 * scrubbing: the four inputs below are the whole prompt, and none of them is
 * diff content (`digest.ts` reads only path/additions/deletions from the hunk
 * headers — never `diff.raw`, never a hunk body).
 */

export type PromptPartKind = 'system' | 'pr_title' | 'pr_body' | 'doc' | 'code_digest';

export interface PromptPart {
  kind: PromptPartKind;
  /** Repo-relative doc path — set only for `kind: 'doc'`. */
  ref?: string;
  /** Verbatim, exactly as it goes into the request. Never abridged for logging. */
  text: string;
  chars: number;
  estTokens: number;
  /** A cap bit: `MAX_BODY_CHARS` / `MAX_DOC_CHARS` / `MAX_DIGEST_FILES`. */
  truncated: boolean;
  /** Length before any cap was applied; equals `chars` when `truncated` is false. */
  sourceChars: number;
}

export interface IntentPrompt {
  system: string;
  user: string;
  /** `parts[0]` is always the system prompt; the rest are the user message, in order. */
  parts: PromptPart[];
  systemChars: number;
  userChars: number;
  estTokensIn: number;
  digestFilesListed: number;
  digestFilesTotal: number;
  digestOverflow: number;
}

export interface IntentPromptInput {
  title: string;
  body: string | null;
  docTexts: { path: string; text: string; sourceChars: number }[];
  diff: UnifiedDiff;
}

function part(
  kind: PromptPartKind,
  text: string,
  opts: { ref?: string; sourceChars?: number } = {},
): PromptPart {
  const sourceChars = opts.sourceChars ?? text.length;
  return {
    kind,
    ...(opts.ref !== undefined ? { ref: opts.ref } : {}),
    text,
    chars: text.length,
    estTokens: approxTokens(text),
    truncated: sourceChars > text.length,
    sourceChars,
  };
}

/**
 * Builds the classifier's two messages and the descriptor of how they were
 * composed. The user message is the parts (minus `system`) joined with a blank
 * line — the same `\n\n` join the assembly used inline before this extraction,
 * so the model sees byte-identical input.
 */
export function buildIntentPrompt(input: IntentPromptInput): IntentPrompt {
  const { title, body, docTexts, diff } = input;

  const userParts: PromptPart[] = [part('pr_title', `PR title: ${title}`)];

  // NOTE — one deliberate divergence from the inline assembly this replaced.
  // That code branched on `pull.body ?` (raw truthiness) but then sent
  // `body.trim()`, so a whitespace-only body produced a dangling
  // `PR description:\n` with nothing after it — while `sources.ts:91` recorded
  // the same body as `resolved: false` via `trimmedBody.length > 0`. Branching
  // on the trimmed value aligns the two: one body, one verdict.
  const trimmedBody = (body ?? '').trim();
  userParts.push(
    trimmedBody
      ? part('pr_body', `PR description:\n${trimmedBody.slice(0, MAX_BODY_CHARS)}`, {
          // The cap applies to the body, not to the `PR description:\n` label, so
          // the pre-cap length is measured the same way — label included — or a
          // body of exactly MAX_BODY_CHARS would report itself truncated.
          sourceChars: `PR description:\n${trimmedBody}`.length,
        })
      : part('pr_body', 'PR description: (none given)'),
  );

  for (const doc of docTexts) {
    userParts.push(part('doc', `Doc "${doc.path}":\n${doc.text}`, {
      ref: doc.path,
      sourceChars: `Doc "${doc.path}":\n`.length + doc.sourceChars,
    }));
  }

  // Always the changed-file list from hunk headers — never hunk content, never
  // conditional (L03 §1).
  const digestFilesTotal = diff.files.length;
  const digestFilesListed = Math.min(digestFilesTotal, MAX_DIGEST_FILES);
  const digestOverflow = digestFilesTotal - digestFilesListed;
  const digestText = `Code digest:\n${buildCodeDigest(diff)}`;
  userParts.push({
    ...part('code_digest', digestText),
    // The digest's cap is on FILES, not chars, so its truncation cannot be
    // derived from a length comparison the way the others' can.
    truncated: digestOverflow > 0,
  });

  // Docs are the only multi-part slot, so the previous inline `.filter(Boolean)`
  // over four fixed sections and this join produce the same string.
  const user = userParts.map((p) => p.text).join('\n\n');
  const systemPart = part('system', SYSTEM_PROMPT);

  return {
    system: SYSTEM_PROMPT,
    user,
    parts: [systemPart, ...userParts],
    systemChars: SYSTEM_PROMPT.length,
    userChars: user.length,
    estTokensIn: systemPart.estTokens + approxTokens(user),
    digestFilesListed,
    digestFilesTotal,
    digestOverflow,
  };
}
