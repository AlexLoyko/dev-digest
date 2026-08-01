/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function finding(o: Partial<FindingRecord>): FindingRecord {
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
    review_id: "rv-1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRunId?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRunId={findingsByRunId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — usage line (L01 run cost)", () => {
  it("a settled run shows its token total and cost", () => {
    renderRuns([run({ status: "done", tokens_in: 8100, tokens_out: 1019, cost_usd: 0.0013 })]);
    expect(screen.getByText(/9,119 tok/)).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("an unpriced run shows tokens but an em dash for cost — never $0.00", () => {
    renderRuns([run({ status: "done", tokens_in: 100, tokens_out: 50, cost_usd: null })]);
    expect(screen.getByText(/150 tok/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("a run with no tokens shows no usage line at all", () => {
    renderRuns([run({ status: "failed", tokens_in: 0, tokens_out: 0, cost_usd: null, error: "429 quota" })]);
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — severity badges (L01 findings)", () => {
  it("breaks a settled run's findings down by severity, keeping the blockers suffix", () => {
    renderRuns(
      [run({ run_id: "run-1", status: "done", findings_count: 3, blockers: 2, score: 38 })],
      new Map([
        [
          "run-1",
          [
            finding({ id: "a", severity: "CRITICAL" }),
            finding({ id: "b", severity: "CRITICAL" }),
            finding({ id: "c", severity: "WARNING" }),
          ],
        ],
      ]),
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
    // The badges replace the plain count, they don't sit next to it.
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
  });

  it("previews that run's findings on hover", () => {
    const { container } = renderRuns(
      [run({ run_id: "run-1", status: "done", findings_count: 1, blockers: 1, score: 38 })],
      new Map([["run-1", [finding({})]]]),
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector('[tabindex="0"]')!);
    const popover = screen.getByRole("tooltip");
    expect(popover).toHaveTextContent("1 findings in this run");
    expect(popover).toHaveTextContent("Hardcoded Stripe secret key in commit");
  });

  it("falls back to the count line for a run whose review is gone", () => {
    renderRuns(
      [run({ run_id: "run-1", status: "done", findings_count: 3, blockers: 0, score: 72 })],
      new Map(),
    );
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();
  });
});
