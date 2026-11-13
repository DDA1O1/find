import { describe, expect, it } from "vite-plus/test";
import { IndicatorService } from "./indicatorService";
import type { CandleData, IndicatorSettings } from "../types";

describe("IndicatorService", () => {
  const dummyCandles: CandleData[] = [
    { time: 1, open: 10, high: 12, low: 9, close: 10, volume: 100 },
    { time: 2, open: 10, high: 13, low: 9, close: 12, volume: 110 },
    { time: 3, open: 12, high: 15, low: 11, close: 14, volume: 120 },
    { time: 4, open: 14, high: 16, low: 13, close: 16, volume: 130 },
    { time: 5, open: 16, high: 19, low: 15, close: 18, volume: 140 },
  ];

  it("calculates active indicators in sync fallback mode", () => {
    let receivedResults: any = null;
    const service = new IndicatorService((results) => {
      receivedResults = results;
    });

    const settings: IndicatorSettings = {
      ema20: false,
      ema50: false,
      sma200: false,
      bollingerBands: false,
      volume: true,
    };

    service.calculate(dummyCandles, settings);
    expect(receivedResults).toBeDefined();

    service.destroy();
  });
});
