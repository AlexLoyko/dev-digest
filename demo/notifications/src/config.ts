/**
 * Notification service configuration.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */

export interface NotificationConfig {
  /** How many subscribers to deliver to at once. */
  maxConcurrency: number;
  /** Total attempts per channel, including the first. */
  retryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Base URL of the studio, used to build links in message bodies. */
  studioBaseUrl: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config: NotificationConfig = {
  maxConcurrency: intFromEnv('NOTIFY_MAX_CONCURRENCY', 4),
  retryAttempts: intFromEnv('NOTIFY_RETRY_ATTEMPTS', 3),
  retryBaseDelayMs: intFromEnv('NOTIFY_RETRY_BASE_MS', 200),
  retryMaxDelayMs: intFromEnv('NOTIFY_RETRY_MAX_MS', 5000),
  studioBaseUrl: process.env.NOTIFY_STUDIO_URL ?? 'http://localhost:3000',
};
