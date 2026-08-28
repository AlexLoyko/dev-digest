import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachment,
  ContextListResponse,
  ContextPreview,
  EffectiveContextDoc,
  IndexStatus,
  SetContextBody,
  SpecFile,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ContextService } from './service.js';

/**
 * T10/T11 — context module. Transport layer only: validate → one service
 * call → reply. No business logic here (onion layering).
 *
 *   GET  /repos/:id/context           → list documents + scan status (AC-1)
 *   POST /repos/:id/context/reindex   → rescan the clone (AC-3)
 *   GET  /repos/:id/context/document  → read one document's text
 *
 *   GET  /agents/:id/context          → attached + effective set (AC-5)
 *   PUT  /agents/:id/context          → replace attached paths (AC-5/AC-6/AC-16)
 *   GET  /skills/:id/context          → a skill's attached documents (AC-7)
 *   PUT  /skills/:id/context          → replace a skill's attached paths (AC-7/AC-16)
 *   GET  /skills/:id/context/preview  → verbatim `## Project context` block (AC-9)
 */

const DocumentQuery = z.object({ path: z.string().min(1) });

/** Shared response shape for get/set on both agents and skills — composed
 * entirely from existing `@devdigest/shared` pieces, not a new contract. */
const ContextGetResponse = z.object({
  attached: z.array(ContextAttachment),
  effective: z.array(EffectiveContextDoc),
  tokens_total: z.number().int(),
});

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ContextService(container);

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: ContextListResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.list(workspaceId, req.params.id);
    },
  );

  // Body-less POST — no `body` schema, so no content-type: application/json
  // is required of the caller.
  app.post(
    '/repos/:id/context/reindex',
    { schema: { params: IdParams, response: { 200: IndexStatus } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.rescan(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/document',
    {
      schema: {
        params: IdParams,
        querystring: DocumentQuery,
        response: { 200: SpecFile },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.readDocument(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, response: { 200: ContextGetResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getAgentContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        body: SetContextBody,
        response: { 200: ContextGetResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setAgentContext(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, response: { 200: ContextGetResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSkillContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/skills/:id/context',
    {
      schema: {
        params: IdParams,
        body: SetContextBody,
        response: { 200: ContextGetResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setSkillContext(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.get(
    '/skills/:id/context/preview',
    { schema: { params: IdParams, response: { 200: ContextPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.previewSkillContext(workspaceId, req.params.id);
    },
  );
}
