/**
 * Public surface of the demo notification service.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
export { deliver, deliverAll, deliverDigest, summarise, configuredConcurrency } from './dispatcher.js';
export type {
  Channel,
  DeliveryResult,
  NotificationEvent,
  PreferenceStore,
  Subscriber,
  Transport,
} from './dispatcher.js';
export { renderTemplate, renderHtml, knownKinds } from './templates.js';
export { withRetry, withRetryAll, isTransient } from './retry.js';
export { config, describeConfig } from './config.js';
export type { NotificationConfig } from './config.js';
export { postNotify, postDigest, getKinds, getDebugConfig } from './routes.js';
export { MemoryAuditSink, record, toEntries, formatEntry } from './audit.js';
export type { AuditEntry, AuditSink } from './audit.js';
export { resolve, parseChannels, chunk } from './subscribers.js';
export type { SubscriptionRow, SubscriptionStore } from './subscribers.js';
