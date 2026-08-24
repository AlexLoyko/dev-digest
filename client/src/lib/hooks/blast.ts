/* hooks/blast.ts — React Query hook for PR blast radius (impact analysis). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusView } from "@devdigest/shared";

/** Fetch the blast radius for a PR (lazily computed server-side on first access). */
export function useBlastRadius(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusView>(`/pulls/${prId}/blast`),
    enabled: prId != null,
  });
}
