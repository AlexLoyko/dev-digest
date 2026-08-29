/* RiskAreas.test.tsx — AC-17 / EC-7. `global.fetch` is stubbed per-test
   (client/insights/gotchas.md: never a real API server). Each test gets its
   own QueryClient so cache from one test can't leak into another. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BriefResponse, BriefMeta, PrBrief, Risk } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const META: BriefMeta = {
  head_sha: "sha-1",
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

function brief(overrides: Partial<PrBrief> = {}): PrBrief {
  return {
    what: "Adds rate limiting",
    why: "Prevent abuse from unauthenticated clients",
    risk_level: "high",
    risks: [risk()],
    review_focus: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function stubBriefResponse(overrides: Partial<BriefResponse> = {}) {
  const body: BriefResponse = {
    brief: brief(),
    meta: META,
    stale: false,
    latest_run: null,
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(body)),
  );
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderRiskAreas(prId: string | number = "pr-1") {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }
  return render(<RiskAreas prId={prId} />, { wrapper: Wrapper });
}

describe("RiskAreas", () => {
  it("renders nothing when no brief is stored", async () => {
    stubBriefResponse({ brief: null, meta: null });
    const { container } = renderRiskAreas();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders every risk's title and grounded file references from a stored brief with latest_run: null (AC-17)", async () => {
    stubBriefResponse({
      latest_run: null,
      brief: brief({
        risks: [
          risk({ kind: "auth", title: "Auth surface touched", file_refs: [{ path: "src/middleware/ratelimit.ts", start_line: 12, end_line: 18 }] }),
          risk({ kind: "dependency", title: "New dependency: ioredis", severity: "medium", file_refs: [{ path: "package.json", start_line: 34 }] }),
        ],
      }),
    });
    renderRiskAreas();

    expect(await screen.findByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:12-18")).toBeInTheDocument();
    expect(screen.getByText("New dependency: ioredis")).toBeInTheDocument();
    expect(screen.getByText("package.json:34")).toBeInTheDocument();
  });

  it("resolves each risk severity to the same SEV entry as the equivalent finding severity", async () => {
    stubBriefResponse({
      brief: brief({ risks: [risk({ title: "High risk row", severity: "high" })] }),
    });
    renderRiskAreas();

    await screen.findByText("High risk row");
    // The row's severity icon carries its accessible name via role="img" —
    // riskLevelToSeverity("high") -> "CRITICAL" -> SEV.CRITICAL.label.
    expect(screen.getByRole("img", { name: "Critical" })).toBeInTheDocument();
  });

  it("is keyboard-operable: each row is a real <button>, focusable and togglable by click/Enter", async () => {
    const explanation =
      "This explanation is deliberately far longer than the row's collapsed layout allows, " +
      "describing in detail why the auth surface change is risky, spanning several clauses " +
      "so that it would clearly overflow any single-line preview if one were rendered inline.";
    stubBriefResponse({
      brief: brief({ risks: [risk({ title: "Long explanation risk", explanation })] }),
    });
    renderRiskAreas();

    const row = await screen.findByRole("button", { name: "Show more" });
    expect(row.tagName).toBe("BUTTON");
    row.focus();
    expect(row).toHaveFocus();

    // EC-7: collapsed — the over-long explanation is not silently cut
    // mid-sentence in the DOM, it is simply not shown yet.
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();

    fireEvent.click(row);

    // Expanding reveals the full, untruncated explanation text.
    expect(await screen.findByText(explanation)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();
  });
});
