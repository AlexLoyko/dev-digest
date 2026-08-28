/* hooks/context-files.ts — React Query hooks for project context (spec) files. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextListResponse, IndexStatus, SpecFile } from "@devdigest/shared";

/** AC-1/EC-1/EC-2: list discovered context documents + current scan status
 * for a repo. `enabled` is gated on `repoId` so no fetch fires before a repo
 * is selected (lazy-enable pattern — see client insights). */
export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextListResponse>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** AC-3: re-scan the repo's clone. Invalidates the document list on success
 * so the viewer picks up the fresh scan without a manual refetch. */
export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}

/** Read one document's full text for the read-only viewer. Gated on both
 * `repoId` and `path` — no fetch until a document is actually selected. */
export function useContextDocument(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId, "document", path],
    queryFn: () =>
      api.get<SpecFile>(`/repos/${repoId}/context/document?path=${encodeURIComponent(path as string)}`),
    enabled: !!repoId && !!path,
  });
}
