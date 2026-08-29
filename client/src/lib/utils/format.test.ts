import { describe, it, expect } from "vitest";
import { formatTokens, formatCost } from "./format";

describe("formatTokens", () => {
  it("formats token in→out with lowercase k suffix", () => {
    expect(formatTokens(8200, 1300)).toBe("8k→1.3k");
  });

  it("rounds the in-count to whole thousands and keeps one decimal on out-count", () => {
    expect(formatTokens(12000, 1500)).toBe("12k→1.5k");
  });
});

describe("formatCost", () => {
  it("formats a USD amount to three decimal places", () => {
    expect(formatCost(0.014)).toBe("$0.014");
  });

  it("returns 'n/a' for null", () => {
    expect(formatCost(null)).toBe("n/a");
  });

  it("returns 'n/a' for undefined", () => {
    expect(formatCost(undefined)).toBe("n/a");
  });
});
