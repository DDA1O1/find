import { describe, expect, it } from "vite-plus/test";
import { calculateBollingerBands, calculateEMA, calculateSMA } from "./ma";
import type { CandleData } from "../types";

describe("Indicator Calculations", () => {
  const dummyCandles: CandleData[] = [
    { time: 100, open: 10, high: 12, low: 9, close: 10, volume: 100 },
    { time: 101, open: 10, high: 13, low: 9, close: 12, volume: 110 },
    { time: 102, open: 12, high: 15, low: 11, close: 14, volume: 120 },
    { time: 103, open: 14, high: 16, low: 13, close: 16, volume: 130 },
    { time: 104, open: 16, high: 19, low: 15, close: 18, volume: 140 },
  ];

  it("calculates SMA correctly", () => {
    const sma3 = calculateSMA(dummyCandles, 3);
    expect(sma3).toHaveLength(3);
    // index 2: (10 + 12 + 14) / 3 = 36 / 3 = 12
    expect(sma3[0].value).toBe(12);
    // index 3: (12 + 14 + 16) / 3 = 42 / 3 = 14
    expect(sma3[1].value).toBe(14);
    // index 4: (14 + 16 + 18) / 3 = 48 / 3 = 16
    expect(sma3[2].value).toBe(16);
  });

  it("calculates EMA correctly", () => {
    const ema3 = calculateEMA(dummyCandles, 3);
    expect(ema3).toHaveLength(3);
    // Initial EMA is SMA = 12
    expect(ema3[0].value).toBe(12);
    // Multiplier = 2 / (3 + 1) = 0.5
    // Next: (16 - 12) * 0.5 + 12 = 14
    expect(ema3[1].value).toBe(14);
    // Next: (18 - 14) * 0.5 + 14 = 16
    expect(ema3[2].value).toBe(16);
  });

  it("calculates Bollinger Bands correctly", () => {
    const bb3 = calculateBollingerBands(dummyCandles, 3, 2);
    expect(bb3.middle).toHaveLength(3);
    expect(bb3.upper).toHaveLength(3);
    expect(bb3.lower).toHaveLength(3);

    // For linear increasing values, upper > middle > lower
    for (let i = 0; i < bb3.middle.length; i++) {
      expect(bb3.upper[i].value).toBeGreaterThan(bb3.middle[i].value);
      expect(bb3.middle[i].value).toBeGreaterThan(bb3.lower[i].value);
    }
  });

  it("returns empty array when candle count is less than period", () => {
    const sma10 = calculateSMA(dummyCandles, 10);
    expect(sma10).toEqual([]);

    const ema10 = calculateEMA(dummyCandles, 10);
    expect(ema10).toEqual([]);

    const bb10 = calculateBollingerBands(dummyCandles, 10);
    expect(bb10.middle).toEqual([]);
  });
});
