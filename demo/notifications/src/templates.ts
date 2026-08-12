/**
 * Notification templates — turns an event kind + payload into a subject line
 * and a plain-text body, plus an HTML variant for email.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { config } from './config.js';

export interface Rendered {
  subject: string;
  body: string;
}

type Renderer = (payload: Record<string, unknown>) => Rendered;

/** Read a payload field as a display string, never leaking `undefined`. */
function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const v = payload[key];
  if (v == null) return fallback;
  return String(v);
}

/** Link back into the studio for a given pull request. */
function prLink(payload: Record<string, unknown>): string {
  const repo = str(payload, 'repoId');
  const number = str(payload, 'prNumber');
  return `${config.studioBaseUrl}/repos/${repo}/pulls/${number}`;
}

const RENDERERS: Record<string, Renderer> = {
  'review.completed': (p) => ({
    subject: `Review finished on #${str(p, 'prNumber', '?')}`,
    body: [
      `The review of pull request #${str(p, 'prNumber', '?')} has finished.`,
      `Verdict: ${str(p, 'verdict', 'unknown')}`,
      `Findings: ${str(p, 'findingCount', '0')}`,
      `Open it: ${prLink(p)}`,
    ].join('\n'),
  }),

  'review.failed': (p) => ({
    subject: `Review failed on #${str(p, 'prNumber', '?')}`,
    body: [
      `The review of pull request #${str(p, 'prNumber', '?')} could not be completed.`,
      `Reason: ${str(p, 'reason', 'not reported')}`,
      `Open it: ${prLink(p)}`,
    ].join('\n'),
  }),

  'digest.weekly': (p) => ({
    subject: 'Your weekly review digest',
    body: [
      `Pull requests reviewed: ${str(p, 'reviewed', '0')}`,
      `Blockers found: ${str(p, 'blockers', '0')}`,
    ].join('\n'),
  }),

  'finding.assigned': (p) => ({
    subject: `A ${str(p, 'severity', 'finding')} was assigned to you`,
    body: [
      `${str(p, 'title', 'A finding')} was assigned to you.`,
      `File: ${str(p, 'file')}:${str(p, 'line')}`,
      `Open it: ${prLink(p)}`,
    ].join('\n'),
  }),
};

/**
 * Render an event. An unknown kind is rejected so a typo in a publisher shows
 * up immediately rather than sending a vague message.
 */
export function renderTemplate(kind: string, payload: Record<string, unknown>): Rendered {
  const renderer = RENDERERS[kind];
  if (!renderer) {
    throw new Error(`no template registered for event kind "${kind}"`);
  }
  return renderer(payload);
}

/**
 * HTML variant for the email channel. Wraps the plain-text body in a minimal
 * layout and links back to the studio.
 */
export function renderHtml(kind: string, payload: Record<string, unknown>): string {
  const rendered = renderTemplate(kind, payload);
  const author = str(payload, 'author', 'someone');
  const title = str(payload, 'title', rendered.subject);

  return `
    <html>
      <body style="font-family: system-ui, sans-serif; line-height: 1.5;">
        <h2>${title}</h2>
        <p>Raised by ${author}</p>
        <pre style="white-space: pre-wrap;">${rendered.body}</pre>
        <p><a href="${prLink(payload)}">Open in DevDigest</a></p>
        <hr />
        <small>You are receiving this because you subscribed to ${kind}.</small>
      </body>
    </html>
  `;
}

/** The event kinds this module renders explicitly. */
export function knownKinds(): string[] {
  return Object.keys(RENDERERS);
}
