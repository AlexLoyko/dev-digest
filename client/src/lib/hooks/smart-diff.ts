/* hooks/smart-diff.ts — React Query hook for the L03 Smart Diff.
     GET /pulls/:id/smart-diff → SmartDiff (changed files grouped into
     core/wiring/boilerplate and ordered for review).

     The server computes this from pr_files with no model call, so it answers
     the moment a PR is imported — unlike ["pr-intent"], there is no "not
     classified yet" empty state to wait through, and no recompute mutation.

     Its `finding_lines` come from persisted findings, so a completed review
     changes the answer: the PR-detail page invalidates ["smart-diff", prId]
     when a run finishes, alongside the reviews it already refetches. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "../types";

export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
