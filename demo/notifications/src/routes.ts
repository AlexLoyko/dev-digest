/**
 * HTTP surface of the notification service.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { deliverAll, summarise, type NotificationEvent, type Subscriber, type Transport } from './dispatcher.js';
import { knownKinds } from './templates.js';

export interface NotifyRequest {
  event: NotificationEvent;
  subscribers: Subscriber[];
}

export interface RouteDeps {
  transport: Transport;
}

/** Reject a request that could never be delivered, before doing any work. */
function validate(body: NotifyRequest): string | null {
  if (!body.event || typeof body.event.kind !== 'string') return 'event.kind is required';
  if (!Array.isArray(body.subscribers)) return 'subscribers must be an array';
  if (body.subscribers.length === 0) return 'subscribers must not be empty';
  return null;
}

/** POST /notify — fan one event out to the given subscribers. */
export async function postNotify(deps: RouteDeps, body: NotifyRequest) {
  const invalid = validate(body);
  if (invalid) {
    return { status: 422, body: { error: invalid } };
  }

  const results = await deliverAll(deps.transport, body.subscribers, body.event);

  return {
    status: 200,
    body: { ...summarise(results), results },
  };
}

/** GET /notify/kinds — the event kinds with a dedicated template. */
export async function getKinds() {
  return { status: 200, body: { kinds: knownKinds() } };
}
