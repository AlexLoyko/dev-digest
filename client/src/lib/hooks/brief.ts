/* hooks/brief.ts — React Query hooks for the PR Brief (SPEC-02, AC-7).
   `useBrief` is read-only w.r.t. spend: it never generates on a missing
   brief (an unbriefed PR waits for the user to ask) and it fires at most
   one background regeneration when the server reports the stored brief
   `stale`. `useGenerateBrief` is the explicit, user-triggered mutation. */
"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchBrief, generateBrief } from "../api";

/** AC-7's one-shot regeneration guard. Two components mount `useBrief` for
 *  the same PR on one page (the brief card and the review-focus card) —
 *  each gets its own `useEffect`, so a per-component guard (a ref/useState)
 *  would let both fire a POST. This has to live outside any single hook
 *  instance, and it can't live in the query cache either: the cache is
 *  shared but doesn't survive reloads and isn't a "have we already asked
 *  for this exact state" ledger (client/insights/gotchas.md). A
 *  module-level `Set` keyed by `${prId}:${head_sha}` is shared by every
 *  hook instance in this tab and naturally resets on reload. */
const regenerationsTriggered = new Set<string>();

export function useBrief(prId: string | number | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["brief", prId],
    queryFn: () => fetchBrief(prId as string | number),
    enabled: prId != null,
  });

  const stale = query.data?.stale ?? false;
  const headSha = query.data?.meta?.head_sha;

  // External system sync: when the server reports the stored brief no
  // longer matches the PR's current state, ask it to regenerate — exactly
  // once per prId+head_sha, never on a `brief: null` read (nothing is
  // stale if nothing has ever been generated).
  useEffect(() => {
    if (prId == null || !stale || !headSha) return;

    const key = `${prId}:${headSha}`;
    if (regenerationsTriggered.has(key)) return;
    regenerationsTriggered.add(key);

    let cancelled = false;
    void (async () => {
      try {
        await generateBrief(prId);
      } catch {
        // A failed background regeneration just leaves the stale brief on
        // screen — the card's own retry control (T21) is where the user
        // acts on a failure, not this hook.
      } finally {
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ["brief", prId] });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prId, stale, headSha, queryClient]);

  return query;
}

/** Explicit, user-triggered generation (the "Generate brief" / "Regenerate"
 *  controls). Invalidates `["brief", prId]` on settle so the card picks up
 *  the fresh (or still-failed) state regardless of outcome. */
export function useGenerateBrief(prId: string | number | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => generateBrief(prId as string | number),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["brief", prId] });
    },
  });
}
