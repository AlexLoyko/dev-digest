/* IntentCard — the L03 intent surface. The 404 / not-yet-classified case
   must still render an informational empty state, not disappear, and the
   header's Recompute button is present (and is its action) in every state.
   Confidence is display-only removed here [2026-08-12]: no pill anywhere. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import { ApiError } from "../../../../../../../lib/api";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrIntent = vi.fn();
const useRecomputeIntent = vi.fn();
vi.mock("../../../../../../../lib/hooks", () => ({
  usePrIntent: (...args: unknown[]) => usePrIntent(...args),
  useRecomputeIntent: (...args: unknown[]) => useRecomputeIntent(...args),
}));

import { IntentCard } from "./IntentCard";

afterEach(cleanup);
// The mocks are module-level and shared across every test here, so without this
// `expect(mutateFn).toHaveBeenCalled()` can pass on state accumulated by an
// earlier test — a green assertion that proves nothing about this one.
beforeEach(() => vi.clearAllMocks());

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
  confidence: "medium",
  sources: [
    { kind: "pr_title", ref: "Add rate limiting", resolved: true },
    { kind: "doc", ref: "docs/plans/0003-rate-limit.md", resolved: false },
  ],
};

const mutateFn = vi.fn();

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the intent summary and in_scope/out_of_scope entries, with no confidence pill", () => {
    usePrIntent.mockReturnValue({ data: INTENT, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(
      screen.getByText(/Add rate limiting to public API endpoints to prevent abuse\./),
    ).toBeInTheDocument();
    expect(screen.getByText("middleware on /api/public/*")).toBeInTheDocument();
    expect(screen.getByText("authentication changes")).toBeInTheDocument();
    // Assert on the VALUE a pill would render, not the word "confidence". The
    // fixture's confidence is "medium", so a reinstated pill would show
    // "MEDIUM"/"Medium" — `queryByText(/confidence/i)` would never see that and
    // passed vacuously, advertising a guard it did not provide.
    expect(screen.queryByText(/\bmedium\b/i)).not.toBeInTheDocument();
  });

  it("renders no confidence value for a high-confidence intent either", () => {
    usePrIntent.mockReturnValue({ data: { ...INTENT, confidence: "high" }, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.queryByText(/\bhigh\b/i)).not.toBeInTheDocument();
  });

  it("lets the user trigger Recompute, and disables the button while it's pending", async () => {
    usePrIntent.mockReturnValue({ data: INTENT, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    const { rerender } = renderWithIntl(<IntentCard prId="pr-1" />);

    const button = screen.getByRole("button", { name: "Recompute" });
    expect(button).toBeEnabled();
    button.click();
    expect(mutateFn).toHaveBeenCalled();

    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: true });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <IntentCard prId="pr-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Recomputing…" })).toBeDisabled();
  });

  it("renders the skeleton, not the card body, while loading", () => {
    usePrIntent.mockReturnValue({ data: undefined, isLoading: true });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    const { container } = renderWithIntl(<IntentCard prId="pr-1" />);

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Add rate limiting to public API endpoints/),
    ).not.toBeInTheDocument();
  });

  it("renders an informational empty state — not nothing — when there is no intent yet (404), with Recompute as its action", () => {
    usePrIntent.mockReturnValue({ data: undefined, isLoading: false });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    const { container } = renderWithIntl(<IntentCard prId="pr-1" />);

    // The card itself must still be present.
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("INTENT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeInTheDocument();
    expect(screen.getByText(messages.intent.card.emptyState)).toBeInTheDocument();
  });

  it("does NOT claim intent is coming on the next review when the request actually failed", () => {
    // Only a 404 means "not classified yet". A 500 previously fell through to
    // the same empty state, asserting something false about system state.
    usePrIntent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError("boom", 500),
    });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.queryByText(messages.intent.card.emptyState)).not.toBeInTheDocument();
    expect(screen.getByText(messages.intent.card.errorState)).toBeInTheDocument();
  });

  it("still shows the not-classified-yet empty state on a 404", () => {
    usePrIntent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError("not found", 404),
    });
    useRecomputeIntent.mockReturnValue({ mutate: mutateFn, isPending: false });
    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.getByText(messages.intent.card.emptyState)).toBeInTheDocument();
  });
});
