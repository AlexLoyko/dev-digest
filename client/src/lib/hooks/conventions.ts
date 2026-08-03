/* hooks/conventions.ts — React Query hooks for the Conventions extractor.

   Skill creation is NOT here: `POST /skills` already accepts every field the
   Create-skill modal edits, so the modal saves through `useCreateSkill()` from
   ./skills. This file only supplies the draft. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

/** `ConventionCandidate` from @devdigest/shared plus the columns this feature added. */
export interface ConventionCandidate {
  id: string;
  rule: string;
  category: string | null;
  evidence_path: string;
  evidence_snippet: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  /** Consistency 0..1 — how uniformly the repo follows the rule. */
  confidence: number;
  /** The evidence behind the score: followed in N of M files where it applied. */
  following_files: number | null;
  applicable_files: number | null;
  accepted: boolean;
}

export interface ConventionList {
  candidates: ConventionCandidate[];
  /** Files actually read and sent to the model (configs + top-N code). */
  sampled_files: number;
  /** Ranked files those were selected FROM — the number the subtitle shows. */
  considered_files: number;
  scanned_at: string | null;
  /** Revision the evidence lines refer to — deep links pin to it. */
  scanned_sha: string | null;
}

export interface ExtractResult extends ConventionList {
  dropped: number;
  dropped_reasons: Record<string, number>;
  cost_usd: number | null;
}

export interface SkillDraft {
  name: string;
  description: string;
  type: "convention";
  body: string;
  accepted_count: number;
}

const listKey = (repoId: string) => ["conventions", repoId];

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: listKey(repoId ?? ""),
    queryFn: () => api.get<ConventionList>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      // The scan returns the fresh set — seed the cache with it rather than refetching.
      qc.setQueryData(listKey(repoId), {
        candidates: data.candidates,
        sampled_files: data.sampled_files,
        considered_files: data.considered_files,
        scanned_at: data.scanned_at,
        scanned_sha: data.scanned_sha,
      } satisfies ConventionList);
    },
  });
}

export function useSetConventionAccepted(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { accepted }),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionList>(listKey(repoId), (prev) =>
        prev
          ? {
              ...prev,
              candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)),
            }
          : prev
      );
    },
  });
}

/** Reject — a hard delete on the server; the card is gone for good. */
export function useRejectConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/conventions/${id}`),
    onSuccess: (_res, id) => {
      qc.setQueryData<ConventionList>(listKey(repoId), (prev) =>
        prev ? { ...prev, candidates: prev.candidates.filter((c) => c.id !== id) } : prev
      );
    },
  });
}

/**
 * Prefill for the Create-skill modal. 422s when nothing is accepted yet, so it
 * is only fetched once the modal opens.
 */
export function useSkillDraft(repoId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<SkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: enabled && !!repoId,
    staleTime: 0,
    gcTime: 0,
  });
}
