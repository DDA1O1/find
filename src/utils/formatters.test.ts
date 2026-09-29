import { describe, expect, it } from "vite-plus/test";
import { formatPercent, formatPrice, formatVolume } from "./formatters";

describe("formatPrice", () => {
  it("formats large crypto prices with 2 decimals and commas", () => {
    expect(formatPrice(84250.75)).toBe("84,250.75");
    expect(formatPrice(1000)).toBe("1,000.00");
  });

  it("formats medium crypto prices with appropriate precision", () => {
    expect(formatPrice(12.3456)).toBe("12.3456");
    expect(formatPrice(0.5678)).toBe("0.5678");
  });

  it("formats micro-cap crypto prices with extended decimals", () => {
    expect(formatPrice(0.001234)).toBe("0.001234");
    expect(formatPrice(0.00001234)).toBe("0.00001234");
  });

  it("handles NaN gracefully", () => {
    expect(formatPrice(NaN)).toBe("0.00");
  });
});

describe("formatPercent", () => {
  it("formats positive and negative percentages with signs", () => {
    expect(formatPercent(5.234)).toBe("+5.23%");
    expect(formatPercent(-3.456)).toBe("-3.46%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});

describe("formatVolume", () => {
  it("formats billions, millions, and thousands", () => {
    expect(formatVolume(2_500_000_000)).toBe("$2.50B");
    expect(formatVolume(45_200_000)).toBe("$45.20M");
    expect(formatVolume(12_500)).toBe("$12.50K");
    expect(formatVolume(50)).toBe("$50.00");
  });
});
