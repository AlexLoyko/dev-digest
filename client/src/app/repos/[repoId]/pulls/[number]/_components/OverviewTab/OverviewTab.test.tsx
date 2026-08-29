/* OverviewTab.test.tsx — the first place `BriefCard` and `ReviewFocusCard`
   actually mount together on one page. Both call `useBrief(prId)`
   independently (`client/src/lib/hooks/brief.ts`), and that hook's
   automatic stale-brief regeneration is guarded by a MODULE-LEVEL
   `Set<string>` keyed by `${prId}:${head_sha}` — deliberately not per
   component/hook-instance — so that two mounts of `useBrief` for the same
   PR cost exactly ONE paid `/brief/generate` call, never two. Nothing in
   the codebase has rendered both together before this tab, so nothing has
   ever proven that guard end to end.

   Real `useBrief`/`useIntent`/`useBlastRadius` hooks throughout — only
   `global.fetch` is stubbed (client/insights/gotchas.md) — because the
   module-level dedup guard lives inside the real hook, not something a
   mocked hook could exercise.

   Distinct `prId`/`head_sha` pairs per test: the dedup guard's `Set` is
   module-level and persists for the lifetime of this file's process, so a
   second test reusing a pair a previous test already regenerated would
   see the guard already tripped and pass for the wrong reason. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  BriefResponse,
  BriefMeta,
  PrBrief,
  Risk,
  ReviewFocusEntry,
  PrIntentRecord,
  BlastRadiusResult,
} from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const META: BriefMeta = {
  head_sha: "sha-placeholder",
  generated_at: "2026-01-01T00:00:00.000Z",
  provider: "test",
  model: "test-model",
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.01,
  duration_ms: 500,
  input_tokens_measured: true,
  degraded: [],
};

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: "auth",
    title: "Auth surface touched",
    explanation: "The middleware now sits in front of every public route.",
    severity: "high",
    file_refs: [{ path: "src/middleware/ratelimit.ts", start_line: 12, end_line: 18 }],
    ...overrides,
  };
}

function pr(overrides: Partial<PrBrief> = {}): PrBrief {
  return {
    what: "Adds a Redis-backed rate limiter as middleware on every public route.",
    why: "Unauthenticated clients can currently call the public endpoints without limit.",
    risk_level: "medium",
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

function makeBriefResponse(headSha: string, overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: pr(),
    meta: { ...META, head_sha: headSha },
    stale: false,
    latest_run: null,
    ...overrides,
  };
}

const INTENT_STUB: PrIntentRecord = {
  pr_id: "irrelevant",
  intent: "Rate-limit the public API surface.",
  in_scope: [],
  out_of_scope: [],
};

const BLAST_STUB: BlastRadiusResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** Routes every fetch this tab's hooks can issue: the brief GET/POST, the
 *  intent GET the sibling `IntentCard` fires, and the blast-radius GET
 *  `OverviewTab` itself fires — so none of those unrelated, out-of-scope
 *  hooks throw an "unexpected fetch" from this router while their card
 *  renders inside its own `ErrorBoundary`.
 *
 *  `onGenerate` is the tripwire hook: pass `"throw"` to fail the test the
 *  moment `/brief/generate` is requested (EC-12), or a `BriefResponse` to
 *  answer it like a real regeneration would. */
function makeFetchMock(briefResponse: BriefResponse, onGenerate: "throw" | BriefResponse) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/brief/generate")) {
      if (onGenerate === "throw") {
        throw new Error("unexpected call to /brief/generate");
      }
      return jsonResponse(onGenerate);
    }
    if (url.endsWith("/brief")) return jsonResponse(briefResponse);
    if (url.endsWith("/intent")) return jsonResponse(INTENT_STUB);
    if (url.endsWith("/blast")) return jsonResponse(BLAST_STUB);
    throw new Error(`unexpected fetch in OverviewTab test: ${url}`);
  });
}

function generateCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/brief/generate")).length;
}

function renderOverviewTab(
  prId: string,
  fetchMock: ReturnType<typeof makeFetchMock>,
  props: { repoFullName?: string | null; headSha?: string | null; prBody?: string | null } = {},
) {
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={{ brief: briefMessages, prReview: prReviewMessages, common: commonMessages }}
      >
        <OverviewTab
          prBody={props.prBody ?? null}
          prId={prId}
          repoFullName={props.repoFullName ?? "acme/widgets"}
          headSha={props.headSha ?? "sha-placeholder"}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("OverviewTab", () => {
  it("AC-1: renders the stored, non-stale brief's what/why prose", async () => {
    const headSha = "sha-overview-1";
    const response = makeBriefResponse(headSha, { stale: false });
    const fetchMock = makeFetchMock(response, "throw");

    renderOverviewTab("pr-overview-1", fetchMock, { headSha });

    expect(await screen.findByText(response.brief!.what)).toBeInTheDocument();
    expect(screen.getByText(response.brief!.why)).toBeInTheDocument();
  });

  it("AC-1 / EC-12: fires zero POSTs to /brief/generate for a non-stale brief", async () => {
    const headSha = "sha-overview-2";
    const response = makeBriefResponse(headSha, { stale: false });
    // The tripwire: any request to /brief/generate throws, turning a
    // regression into a failing assertion rather than a silent extra call
    // that only a call-count check afterwards would catch.
    const fetchMock = makeFetchMock(response, "throw");

    renderOverviewTab("pr-overview-2", fetchMock, { headSha });

    expect(await screen.findByText(response.brief!.what)).toBeInTheDocument();
    // Give any errant background effect a chance to run before asserting
    // the tripwire never fired.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(generateCallCount(fetchMock)).toBe(0);
  });

  it("issues EXACTLY ONE POST to /brief/generate for a stale brief, even though both BriefCard and ReviewFocusCard mount useBrief for the same PR", async () => {
    const headSha = "sha-overview-3";
    // review_focus non-empty so ReviewFocusCard actually mounts its list
    // (and its own `useBrief` instance) rather than short-circuiting to
    // the empty state — both components must be genuinely live for this
    // to prove anything.
    const response = makeBriefResponse(headSha, {
      stale: true,
      brief: pr({ review_focus: [{ file: { path: "src/a.ts", start_line: 1 }, reason: "why" }] }),
    });
    const regenerated = makeBriefResponse(headSha, { stale: false });
    const fetchMock = makeFetchMock(response, regenerated);

    renderOverviewTab("pr-overview-3", fetchMock, { headSha });

    // The brief renders while a background regeneration for the stale
    // brief is (or will be) in flight.
    await screen.findByText(response.brief!.what);

    // Wait for the regeneration to actually fire...
    await waitFor(() => expect(generateCallCount(fetchMock)).toBeGreaterThan(0));
    // ...and confirm it never fires a second time for the second mount.
    expect(generateCallCount(fetchMock)).toBe(1);
  });

  it("threads repoFullName and headSha through to the review-focus links", async () => {
    const headSha = "sha-overview-4";
    const repoFullName = "acme/threaded-repo";
    const entries: ReviewFocusEntry[] = [
      { file: { path: "src/config.ts", start_line: 12 }, reason: "Secret committed in plaintext" },
    ];
    const response = makeBriefResponse(headSha, {
      stale: false,
      brief: pr({ review_focus: entries }),
    });
    const fetchMock = makeFetchMock(response, "throw");

    renderOverviewTab("pr-overview-4", fetchMock, { headSha, repoFullName });

    const link = await screen.findByRole("link", { name: /src\/config\.ts:12/ });
    expect(link).toHaveAttribute("href", expect.stringContaining(repoFullName));
    expect(link).toHaveAttribute("href", expect.stringContaining(headSha));
  });

  it("renders the brief prose, the risk areas, and the review-focus card together from one stored brief", async () => {
    const headSha = "sha-overview-5";
    const risks = [risk({ title: "New dependency: ioredis", kind: "dependency" })];
    const reviewFocus: ReviewFocusEntry[] = [
      { file: { path: "src/api/users.ts", start_line: 46, end_line: 48 }, reason: "N+1 query" },
    ];
    const response = makeBriefResponse(headSha, {
      stale: false,
      brief: pr({ risks, review_focus: reviewFocus }),
    });
    const fetchMock = makeFetchMock(response, "throw");

    renderOverviewTab("pr-overview-5", fetchMock, { headSha });

    // The brief's own prose (BriefCard).
    expect(await screen.findByText(response.brief!.what)).toBeInTheDocument();
    expect(screen.getByText(response.brief!.why)).toBeInTheDocument();

    // The risks section (RiskAreas, mounted inside IntentCard).
    expect(await screen.findByText("New dependency: ioredis")).toBeInTheDocument();
    expect(screen.getByText(briefMessages.risks.sectionLabel)).toBeInTheDocument();

    // The review-focus card.
    expect(screen.getByText(briefMessages.reviewFocus.sectionLabel)).toBeInTheDocument();
    expect(screen.getByText(/N\+1 query/)).toBeInTheDocument();
  });
});
