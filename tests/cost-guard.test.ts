import { describe, it, expect } from "vitest";
import { estimateAnthropicCost, checkBudget } from "../scripts/lib/cost-guard";

describe("cost-guard", () => {
  it("estimates opus cost correctly", () => {
    // 100k input, 10k output → 0.1*15 + 0.01*75 = 1.5 + 0.75 = 2.25
    const c = estimateAnthropicCost("opus", 100_000, 10_000);
    expect(c).toBeCloseTo(2.25, 2);
  });

  it("estimates sonnet cheaper than opus", () => {
    const sonnet = estimateAnthropicCost("sonnet", 100_000, 10_000);
    const opus = estimateAnthropicCost("opus", 100_000, 10_000);
    expect(sonnet).toBeLessThan(opus);
  });

  it("checkBudget returns ok when under limits", () => {
    const c = checkBudget({ estimatedUsd: 0.01 });
    expect(c.ok).toBe(true);
  });
});
