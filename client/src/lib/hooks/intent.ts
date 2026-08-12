/* hooks/intent.ts — React Query hooks for the L03 Intent Layer.
     GET  /pulls/:id/intent → PrIntentRecord (404 = not classified yet, a normal
     state, not a transient error — hence retry: false so the empty state
     settles immediately instead of retrying a 404 three times). Classification
     is also a step of every review run, so the PR-detail page invalidates
     ["pr-intent", prId] when a run finishes so the card appears without a
     manual reload.
     POST /pulls/:id/intent → force reclassification, ignoring the (pr_id,
     head_sha) cache — powers the Recompute button in the card header. On
     success the fresh record is written straight into the query cache so the
     card updates without an extra round trip. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "../types";

export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntentRecord>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    retry: false,
  });
}

export function useRecomputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-intent", prId], data);
    },
  });
}
