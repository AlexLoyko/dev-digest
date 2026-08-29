/* hooks/brief.test.tsx — AC-7. `global.fetch` is stubbed per-test (never a
   real API server, client/insights/gotchas.md). Each test uses its own
   prId/head_sha so the module-level regeneration guard in brief.ts (a
   deliberate cross-instance singleton) can't leak state between tests. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBrief, useGenerateBrief } from "./brief";
import type { BriefMeta, BriefResponse } from "@devdigest/shared";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

const DEFAULT_META: BriefMeta = {
  head_sha: "sha-default",
  generated_at: "2026-01-01T00:00:00.000Z",
  provider: "test",
  model: "test-model",
  tokens_in: 10,
  tokens_out: 5,
  cost_usd: 0.001,
  duration_ms: 100,
  input_tokens_measured: true,
  degraded: [],
};

function makeBriefBody(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: { what: "what", why: "why", risk_level: "low", risks: [], review_focus: [] },
    meta: DEFAULT_META,
    stale: false,
    latest_run: null,
    ...overrides,
  };
}

function methodOf(init?: RequestInit): string {
  return init?.method ?? "GET";
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBrief", () => {
  it("does not POST when the brief is null (no brief generated yet)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(methodOf(init)).not.toBe("POST");
      return jsonResponse({ brief: null, meta: null, stale: false, latest_run: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = createQueryClient();
    const { result } = renderHook(() => useBrief("pr-null"), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Give any (incorrect) fire-and-forget POST a chance to have happened.
    await new Promise((r) => setTimeout(r, 20));

    const postCalls = fetchMock.mock.calls.filter(([, init]) => methodOf(init) === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("fires exactly one POST for stale: true, even across a re-render and a second mount", async () => {
    let postCalls = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (methodOf(init) === "POST") {
        postCalls += 1;
        return jsonResponse(makeBriefBody({ meta: { ...DEFAULT_META, head_sha: "sha-stale" } }));
      }
      return jsonResponse(
        makeBriefBody({ stale: true, meta: { ...DEFAULT_META, head_sha: "sha-stale" } })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = createQueryClient();
    const wrapper = wrapperFor(queryClient);

    const first = renderHook(() => useBrief("pr-stale"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(postCalls).toBe(1));

    // A re-render of the same instance must not fire a second POST.
    first.rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(postCalls).toBe(1);

    // A second component mounting the hook for the same prId + head_sha
    // (e.g. the review-focus card) must not fire a second POST either.
    const second = renderHook(() => useBrief("pr-stale"), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(postCalls).toBe(1);
  });
});

describe("useGenerateBrief", () => {
  it("invalidates [\"brief\", prId] on settle, causing a refetch", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (methodOf(init) === "POST") {
        return jsonResponse(makeBriefBody({ stale: false, meta: { ...DEFAULT_META, head_sha: "sha-gen" } }));
      }
      getCalls += 1;
      return jsonResponse(makeBriefBody({ stale: false, meta: { ...DEFAULT_META, head_sha: "sha-gen" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = createQueryClient();
    const wrapper = wrapperFor(queryClient);

    const briefHook = renderHook(() => useBrief("pr-gen"), { wrapper });
    await waitFor(() => expect(briefHook.result.current.isSuccess).toBe(true));
    const getCallsBeforeMutate = getCalls;

    const genHook = renderHook(() => useGenerateBrief("pr-gen"), { wrapper });
    genHook.result.current.mutate();

    await waitFor(() => expect(genHook.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(getCalls).toBeGreaterThan(getCallsBeforeMutate));
  });
});
