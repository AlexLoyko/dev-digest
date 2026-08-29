import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BriefResponse, StoredBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService, isBriefGenerationFailure } from './service.js';

/**
 * brief module routes.
 *
 * GET  /pulls/:id/brief          → read-only, ZERO LLM calls in every branch (AC-9).
 * POST /pulls/:id/brief/generate → the only path that spends money (AC-2, AC-8).
 *
 * Onion layer: presentation — thin handlers: getContext → one read/one service
 * call → reply. No business logic here.
 *
 * `BriefService` is constructed ONCE at plugin registration (module-level,
 * mirroring `modules/blast/routes.ts`), NOT per request the way
 * `modules/intent/routes.ts` builds `IntentService` inline. This is
 * deliberate, not stylistic: AC-8's single-flight guard lives on the
 * `BriefService` INSTANCE (`service.ts`'s `private readonly singleFlight`),
 * so a fresh instance per request would silently defeat single-flight
 * coalescing for concurrent POSTs (EC-9) — each request would get its own,
 * always-empty `SingleFlight` map. `app.log` (Fastify's own pino logger,
 * structurally compatible with `service.ts`'s `Logger` type) stands in for
 * the per-request `req.log` other modules pass, exactly as `IntentService`'s
 * own constructor comment anticipates ("Route paths pass Fastify's `app.log`").
 */

/** HTTP-facing mirror of `service.ts`'s `BriefGenerationFailure` (T9). Defined
 *  here, not in `service.ts` (owned by T8/T9/T10, out of this task's scope) —
 *  this is presentation-layer response-shape validation, exactly where a
 *  Zod HTTP schema belongs (see the zod skill's "where does this schema go"
 *  tree). Field-for-field identical to the TS interface it mirrors. */
const BriefGenerationFailureResponse = z.object({
  reason: z.enum(['model_error', 'invalid_result']),
  hasPriorBrief: z.boolean(),
});

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container, app.log);

  // ---- GET: read-only, never computes -------------------------------------
  // AC-9: `BriefService.getBriefView` makes ZERO LLM calls in EVERY branch —
  // see its doc comment (service.ts) for why this deliberately diverges from
  // `intent`'s lazy-compute and `blast`'s always-call-the-LLM routes.
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBriefView(workspaceId, req.params.id);
    },
  );

  // ---- POST: the only path that spends money -------------------------------
  // Rate-limited like `intent`'s recompute route (`modules/intent/routes.ts:36`)
  // — each call fans out to exactly one LLM call (AC-2). This, plus AC-8's
  // single-flight, are the spec's only two spend controls (see GET's comment
  // above for why that matters).
  app.post(
    '/pulls/:id/brief/generate',
    {
      schema: {
        params: IdParams,
        response: { 200: StoredBrief, 422: BriefGenerationFailureResponse, 502: BriefGenerationFailureResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.generate(workspaceId, req.params.id);

      if (isBriefGenerationFailure(result)) {
        // The client picks its presentation branch from `reason` +
        // `hasPriorBrief`, NEVER from the HTTP status alone — both fields
        // travel in the body regardless of which status is chosen here.
        // `invalid_result` (the model responded, but its output didn't
        // validate) maps to 422; `model_error` (the call itself could not be
        // completed) maps to 502, mirroring `ValidationError`'s and
        // `ExternalServiceError`'s status codes in `platform/errors.ts`.
        reply.status(result.reason === 'invalid_result' ? 422 : 502);
        return result;
      }

      reply.status(200);
      return result;
    },
  );
}
