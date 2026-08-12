/* FindingsTab — confidence is display-only removed here [2026-08-12, user:
   "just get rid of confidence for now"], so this tab no longer calls
   usePrIntent or renders any confidence pill next to "Review runs". */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { UseMutationResult } from "@tanstack/react-query";
import messages from "../../../../../../../../messages/en/prReview.json";

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

const fakeCancelMutation = {
  mutate: vi.fn(),
  isPending: false,
} as unknown as UseMutationResult<any, any, string, any>;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr-1"
        prNumber={482}
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={[]}
        prRuns={undefined}
        prCommits={[]}
        cancelMutation={fakeCancelMutation}
        repoFullName={null}
        headSha={null}
        focusFindingId={null}
        onFocusFinding={vi.fn()}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab — Review runs section", () => {
  it("renders the Review runs section with no confidence pill", () => {
    renderTab();
    expect(screen.getByText("Review runs")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no runs and no review is in flight", () => {
    renderTab();
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
  });
});
