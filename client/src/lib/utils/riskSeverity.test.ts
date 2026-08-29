import { describe, it, expect } from "vitest";
import { RiskSeverity } from "@devdigest/shared";
import { SEV } from "@devdigest/ui";
import { riskLevelToSeverity } from "./riskSeverity";

describe("riskLevelToSeverity", () => {
  it("maps each risk level to the finding severity of equivalent weight", () => {
    expect(riskLevelToSeverity("high")).toBe("CRITICAL");
    expect(riskLevelToSeverity("medium")).toBe("WARNING");
    expect(riskLevelToSeverity("low")).toBe("SUGGESTION");
  });

  it("maps every risk level to a distinct severity", () => {
    const mapped = RiskSeverity.options.map(riskLevelToSeverity);
    expect(new Set(mapped).size).toBe(RiskSeverity.options.length);
  });

  it("never maps to INFO — there is no risk level of that weight", () => {
    for (const level of RiskSeverity.options) {
      expect(riskLevelToSeverity(level)).not.toBe("INFO");
    }
  });

  it("resolves to a key SEV actually has, for colour/icon/label lookup", () => {
    for (const level of RiskSeverity.options) {
      const severity = riskLevelToSeverity(level);
      expect(Object.keys(SEV)).toContain(severity);
    }
  });

  it("is exhaustive over RiskSeverity — every option is handled, none throws", () => {
    expect(RiskSeverity.options).toEqual(["high", "medium", "low"]);
    for (const level of RiskSeverity.options) {
      expect(() => riskLevelToSeverity(level)).not.toThrow();
    }
  });
});
