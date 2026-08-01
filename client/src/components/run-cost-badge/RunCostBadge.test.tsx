/**
 * RunCostBadge — the money formatter is the whole point of this component, and
 * its failure mode is silent: a fixed precision renders a real sub-cent run as
 * "$0.00", which reads as free. Pin the boundaries.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost } from "./helpers";

afterEach(cleanup);

describe("formatCost", () => {
  it("uses 4 decimals below a cent, so a sub-cent run never reads as $0.00", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.00009)).toBe("$0.0001");
  });

  it("uses 3 decimals between a cent and a dollar", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.9994)).toBe("$0.999");
  });

  it("uses 2 decimals at a dollar and above", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.238)).toBe("$1.24");
    expect(formatCost(42)).toBe("$42.00");
  });

  it("renders an em dash for missing data — never a zero amount", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(Number.NaN)).toBe("—");
  });

  it("still formats a genuine zero as money, since 0 is a real measurement", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("RunCostBadge", () => {
  it("renders the formatted cost in both variants", () => {
    const { rerender } = render(<RunCostBadge costUsd={0.014} />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    rerender(<RunCostBadge costUsd={0.0013} variant="inline" />);
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("shows the empty tooltip only when there is no cost data", () => {
    const { rerender } = render(<RunCostBadge costUsd={null} emptyTitle="No completed run" />);
    expect(screen.getByTitle("No completed run")).toBeInTheDocument();
    rerender(<RunCostBadge costUsd={0.5} emptyTitle="No completed run" />);
    expect(screen.queryByTitle("No completed run")).not.toBeInTheDocument();
  });
});
