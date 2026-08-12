/* OverviewTab — a single full-width IntentCard at the top of the tab (no "PR
   BRIEF" label, no grid), with the Description section below it.
   `VerdictBanner` is not on this tab (it lives in the Findings tab, per
   ReviewRunAccordion). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrIntent = vi.fn();
const useRecomputeIntent = vi.fn();
vi.mock("../../../../../../../lib/hooks", () => ({
  usePrIntent: (...args: unknown[]) => usePrIntent(...args),
  useRecomputeIntent: (...args: unknown[]) => useRecomputeIntent(...args),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

const INTENT: PrIntentRecord = {
  pr_id: "pr-1",
  head_sha: "abc1234",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  classified_at: new Date().toISOString(),
  intent: "Add rate limiting to public API endpoints to prevent abuse.",
  in_scope: ["middleware on /api/public/*"],
  out_of_scope: ["authentication changes"],
  type: "feature",
  confidence: "high",
  sources: [{ kind: "pr_title", ref: "Add rate limiting", resolved: true }],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab", () => {
  it("renders the full-width intent card with no PR BRIEF label", () => {
    usePrIntent.mockReturnValue({ data: INTENT, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
    renderWithIntl(<OverviewTab prId="pr-1" prBody={null} />);

    expect(screen.queryByText("PR BRIEF")).not.toBeInTheDocument();
    // The IntentCard itself, composed in — not re-tested here in depth
    // (see IntentCard.test.tsx), just proven present.
    expect(screen.getByText("INTENT")).toBeInTheDocument();
    expect(
      screen.getByText(/Add rate limiting to public API endpoints to prevent abuse\./),
    ).toBeInTheDocument();
  });

  it("omits the Description section when the PR has no body", () => {
    usePrIntent.mockReturnValue({ data: INTENT, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
    renderWithIntl(<OverviewTab prId="pr-1" prBody={null} />);
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("renders the Description section when the PR has a body", () => {
    usePrIntent.mockReturnValue({ data: INTENT, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
    renderWithIntl(<OverviewTab prId="pr-1" prBody="Adds rate limiting to the public API." />);
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
  });
});
