/**
 * Public surface of the demo notification service.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
export { deliver, deliverAll, summarise } from './dispatcher.js';
export type {
  Channel,
  DeliveryResult,
  NotificationEvent,
  Subscriber,
  Transport,
} from './dispatcher.js';
export { renderTemplate, knownKinds } from './templates.js';
export { withRetry, isTransient } from './retry.js';
export { config } from './config.js';
export type { NotificationConfig } from './config.js';
export { postNotify, getKinds } from './routes.js';
