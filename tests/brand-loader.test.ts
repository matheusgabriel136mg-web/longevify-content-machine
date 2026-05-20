import { describe, it, expect } from "vitest";
import { brand } from "../scripts/lib/brand-loader";

describe("brand-loader (longevify default)", () => {
  it("loads longevify brand", () => {
    expect(brand.id).toBe("longevify");
    expect(brand.language).toBe("pt-BR");
  });

  it("has 4 pillars", () => {
    expect(brand.pillars.length).toBe(4);
  });

  it("forbidden palette includes white and warm colors", () => {
    expect(brand.palette.forbidden).toContain("#FFFFFF");
    expect(brand.palette.forbidden).toContain("red");
  });

  it("budget caps are non-zero", () => {
    expect(brand.budget.daily_usd).toBeGreaterThan(0);
    expect(brand.budget.per_run_usd).toBeGreaterThan(0);
  });
});
