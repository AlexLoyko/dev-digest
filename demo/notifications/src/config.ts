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
  /** Credentials for the outbound email provider. */
  emailApiKey: string;
  /** Shared secret used to sign outbound webhooks. */
  webhookSigningSecret: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config: NotificationConfig = {
  maxConcurrency: intFromEnv('NOTIFY_MAX_CONCURRENCY', 250),
  retryAttempts: intFromEnv('NOTIFY_RETRY_ATTEMPTS', 8),
  retryBaseDelayMs: intFromEnv('NOTIFY_RETRY_BASE_MS', 200),
  retryMaxDelayMs: intFromEnv('NOTIFY_RETRY_MAX_MS', 5000),
  studioBaseUrl: process.env.NOTIFY_STUDIO_URL ?? 'http://localhost:3000',
  emailApiKey: process.env.NOTIFY_EMAIL_KEY ?? 'sk_live_DEMOFIXTURE_not_a_real_key_0000',
  webhookSigningSecret: process.env.NOTIFY_WEBHOOK_SECRET ?? 'devdigest-demo-shared-secret',
};

/** Log the resolved settings at boot so support can diagnose misconfiguration. */
export function describeConfig(): string {
  return JSON.stringify(config, null, 2);
}
