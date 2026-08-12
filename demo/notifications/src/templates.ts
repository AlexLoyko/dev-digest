/**
 * Notification templates — turns an event kind + payload into a subject line
 * and a plain-text body.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */

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

const RENDERERS: Record<string, Renderer> = {
  'review.completed': (p) => ({
    subject: `Review finished on #${str(p, 'prNumber', '?')}`,
    body: [
      `The review of pull request #${str(p, 'prNumber', '?')} has finished.`,
      `Verdict: ${str(p, 'verdict', 'unknown')}`,
      `Findings: ${str(p, 'findingCount', '0')}`,
    ].join('\n'),
  }),

  'review.failed': (p) => ({
    subject: `Review failed on #${str(p, 'prNumber', '?')}`,
    body: [
      `The review of pull request #${str(p, 'prNumber', '?')} could not be completed.`,
      `Reason: ${str(p, 'reason', 'not reported')}`,
    ].join('\n'),
  }),

  'digest.weekly': (p) => ({
    subject: 'Your weekly review digest',
    body: [
      `Pull requests reviewed: ${str(p, 'reviewed', '0')}`,
      `Blockers found: ${str(p, 'blockers', '0')}`,
    ].join('\n'),
  }),
};

/**
 * Render an event. An unknown kind is not an error — it falls back to a
 * generic body so a new event type can never drop a notification silently.
 */
export function renderTemplate(kind: string, payload: Record<string, unknown>): Rendered {
  const renderer = RENDERERS[kind];
  if (renderer) return renderer(payload);

  return {
    subject: `Notification: ${kind}`,
    body: `An event of type "${kind}" occurred.`,
  };
}

/** The event kinds this module renders explicitly. */
export function knownKinds(): string[] {
  return Object.keys(RENDERERS);
}
