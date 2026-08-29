/* hooks/brief.ts — React Query hooks for the PR Brief (SPEC-02, AC-7).
   `useBrief` is read-only w.r.t. spend: it never generates on a missing
   brief (an unbriefed PR waits for the user to ask) and it fires at most
   one background regeneration when the server reports the stored brief
   `stale`. `useGenerateBrief` is the explicit, user-triggered mutation. */
"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
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

/** Cross-instance "is a regeneration for this PR running right now" store,
 *  keyed by `prId` alone (unlike `regenerationsTriggered`, this isn't about
 *  which head_sha asked for it — a caller's manual `useGenerateBrief()`
 *  mutation has no head_sha at all). Two separate call sites can start a
 *  generation for the same PR — this hook's own staleness-triggered
 *  background call below, and a component's own `useGenerateBrief()`
 *  mutation instance — and every mounted `useBrief` for that PR (brief card,
 *  review-focus card) needs to reflect BOTH as one signal, not two the
 *  caller has to correlate itself. A plain module store read via
 *  `useSyncExternalStore` gives that cross-instance reactivity without
 *  smuggling a fake, never-fetched entry into the query cache. */
const generatingByPrId = new Map<string, boolean>();
const generatingListeners = new Map<string, Set<() => void>>();

function getGenerating(prId: string | number): boolean {
  return generatingByPrId.get(String(prId)) ?? false;
}

function setGenerating(prId: string | number, value: boolean): void {
  const key = String(prId);
  if (getGenerating(prId) === value) return;
  generatingByPrId.set(key, value);
  for (const listener of generatingListeners.get(key) ?? []) listener();
}

function subscribeGenerating(
  prId: string | number | null | undefined,
  listener: () => void,
): () => void {
  if (prId == null) return () => {};
  const key = String(prId);
  let listeners = generatingListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    generatingListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) generatingListeners.delete(key);
  };
}

function getGeneratingServerSnapshot(): boolean {
  return false;
}

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
    setGenerating(prId, true);
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
        setGenerating(prId, false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prId, stale, headSha, queryClient]);

  // One boolean for callers (BriefCard) to read — true while EITHER this
  // hook's own background call above is running, OR a caller's independent
  // `useGenerateBrief()` mutation instance is (it writes to the same
  // `generatingByPrId` store via `onMutate`/`onSettled`). Callers should
  // never have to OR two separate flags together themselves.
  const isGenerating = useSyncExternalStore(
    useCallback((listener) => subscribeGenerating(prId, listener), [prId]),
    () => (prId != null ? getGenerating(prId) : false),
    getGeneratingServerSnapshot,
  );

  return { ...query, isGenerating };
}

/** Explicit, user-triggered generation (the "Generate brief" / "Regenerate"
 *  controls). Invalidates `["brief", prId]` on settle so the card picks up
 *  the fresh (or still-failed) state regardless of outcome. Also flips the
 *  shared `isGenerating` signal every `useBrief` for this `prId` reads, so
 *  a manual regenerate and the hook's own background regeneration render
 *  identically. */
export function useGenerateBrief(prId: string | number | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => generateBrief(prId as string | number),
    onMutate: () => {
      if (prId != null) setGenerating(prId, true);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["brief", prId] });
      if (prId != null) setGenerating(prId, false);
    },
  });
}
