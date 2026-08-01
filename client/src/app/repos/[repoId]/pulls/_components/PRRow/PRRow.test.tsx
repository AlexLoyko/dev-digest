/**
 * PRRow — the COST column (L01). A PR that was never reviewed and a PR whose
 * review was free are different facts, so the empty case must not render money.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Finding } from "@devdigest/shared";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3d4",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T18:44:34.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 61,
    total_cost_usd: null,
    findings: [],
    ...o,
  };
}

function finding(o: Partial<Finding>): Finding {
  return {
    id: "f-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal sk_live_ Stripe secret key.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    ...o,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — cost column", () => {
  it("renders the PR's total cost across all runs", () => {
    renderRow(pr({ total_cost_usd: 0.014 }));
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("renders an em dash when the PR has no completed run", () => {
    renderRow(pr({ total_cost_usd: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});

describe("PRRow — findings column", () => {
  it("renders one badge per severity present, with its count", () => {
    renderRow(
      pr({
        findings: [
          finding({ id: "a", severity: "CRITICAL" }),
          finding({ id: "b", severity: "CRITICAL" }),
          finding({ id: "c", severity: "WARNING" }),
        ],
      }),
    );
    // Two severities present ⇒ two badges; SUGGESTION has none and gets none.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders no badges for a PR with nothing outstanding", () => {
    const { container } = renderRow(pr({ findings: [] }));
    // Nothing at all — not a zero, and no hover target.
    expect(container.querySelector('[tabindex="0"]')).toBeNull();
  });

  it("previews the finding only on hover", () => {
    const { container } = renderRow(pr({ findings: [finding({})] }));
    const title = "Hardcoded Stripe secret key in commit";
    // The PR title is also on the row, so scope the assertion to the popover.
    expect(screen.queryByText(title)).not.toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector('[tabindex="0"]')!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(title);
    expect(screen.getByRole("tooltip")).toHaveTextContent("src/config.ts:12");
  });
});
