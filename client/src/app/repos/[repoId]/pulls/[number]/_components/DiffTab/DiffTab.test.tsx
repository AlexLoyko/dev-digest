/* DiffTab — the Smart order / Original order switch on the "Files changed" tab.
   Smart order renders the role sections; Original order renders the plain
   viewer, which is also the fallback while the smart-diff query is in flight. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

const files: PrFile[] = [
  {
    path: "src/middleware/ratelimit.ts",
    additions: 84,
    deletions: 0,
    patch: "@@ -24,1 +24,2 @@\n+  const key = bucketKey(req);",
  },
] as PrFile[];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 84, proposed_splits: [] },
};

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr-1" filesCount={1} files={files} smartDiff={SMART_DIFF} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("shows the reviewer-ordered section label and the change summary", () => {
    renderTab();
    expect(screen.getByText("Reviewer-ordered diff")).toBeInTheDocument();
    expect(screen.getByText("1 files · +84 −0")).toBeInTheDocument();
  });

  it("defaults to Smart order, rendering the role sections", () => {
    renderTab();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
  });

  it("switches to the plain viewer on Original order", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("switches back to Smart order", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByText("Core logic")).toBeInTheDocument();
  });

  it("falls back to the plain viewer while the smart-diff query is loading", () => {
    renderTab({ smartDiff: undefined });
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("falls back to the plain viewer when the response has no groups", () => {
    renderTab({
      smartDiff: { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } },
    });
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });
});
