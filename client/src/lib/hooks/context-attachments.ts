/* hooks/context-attachments.ts — React Query hooks for the documents
   attached to an agent's or a skill's Project Context (T10/T11 endpoints).
   Distinct from `context-files.ts` (T14), which lists the documents
   discovered by scanning a repo — this file is about which of those
   documents a given agent/skill has chosen to attach, in what order. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextAttachment, ContextPreview, EffectiveContextDoc } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shared response shape for GET/PUT on both `/agents/:id/context` and
 *  `/skills/:id/context` — mirrors the server's inline `ContextGetResponse`
 *  (server/src/modules/context/routes.ts), composed from `@devdigest/shared`
 *  pieces rather than a new contract. */
export interface ContextAttachmentSet {
  attached: ContextAttachment[];
  effective: EffectiveContextDoc[];
  tokens_total: number;
}

// ---------------------------------------------------------------------------
// Agent context
// ---------------------------------------------------------------------------

export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<ContextAttachmentSet>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

export function useSetAgentContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, paths }: { agentId: string; paths: string[] }) =>
      api.put<ContextAttachmentSet>(`/agents/${agentId}/context`, { paths }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-context", agentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Skill context
// ---------------------------------------------------------------------------

export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ContextAttachmentSet>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

export function useSetSkillContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, paths }: { skillId: string; paths: string[] }) =>
      api.put<ContextAttachmentSet>(`/skills/${skillId}/context`, { paths }),
    onSuccess: (_data, { skillId }) => {
      qc.invalidateQueries({ queryKey: ["skill-context", skillId] });
    },
  });
}

/** Verbatim `## Project context` block a skill would inject — read-only
 *  preview, no mutation. */
export function useSkillContextPreview(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-preview", skillId],
    queryFn: () => api.get<ContextPreview>(`/skills/${skillId}/context/preview`),
    enabled: !!skillId,
  });
}
