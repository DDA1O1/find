import { describe, expect, it } from "vite-plus/test";
import {
  isTradFiFuturesSymbol,
  getUnderlyingStockSymbol,
  getTradFiStockName,
  normalizeCandleTime,
  mergeHistoricalCandles,
  registerTradFiPerpetualSymbol,
} from "./tradifiPairs";
import type { CandleData } from "../types";

describe("TradFi Pairs & Chart Splicing", () => {
  it("identifies TradFi perpetual symbols vs crypto symbols correctly", () => {
    expect(isTradFiFuturesSymbol("NVDAUSDT")).toBe(true);
    expect(isTradFiFuturesSymbol("TSLAUSDT")).toBe(true);
    expect(isTradFiFuturesSymbol("AAPLUSDT")).toBe(true);
    expect(isTradFiFuturesSymbol("MSFTUSDT")).toBe(true);
    expect(isTradFiFuturesSymbol("SPYUSDT")).toBe(true);

    // Crypto native pairs must not be identified as stock perpetuals
    expect(isTradFiFuturesSymbol("BTCUSDT")).toBe(false);
    expect(isTradFiFuturesSymbol("ETHUSDT")).toBe(false);
    expect(isTradFiFuturesSymbol("SOLUSDT")).toBe(false);
    expect(isTradFiFuturesSymbol("SUIUSDT")).toBe(false);
    expect(isTradFiFuturesSymbol("APTUSDT")).toBe(false);
  });

  it("recognizes explicitly flagged TRADIFI_PERPETUAL contracts", () => {
    expect(isTradFiFuturesSymbol("CUSTOMPAIRUSDT", "TRADIFI_PERPETUAL")).toBe(true);
    registerTradFiPerpetualSymbol("NEWTRADIFIUSDT");
    expect(isTradFiFuturesSymbol("NEWTRADIFIUSDT")).toBe(true);
  });

  it("extracts underlying stock symbols correctly", () => {
    expect(getUnderlyingStockSymbol("NVDAUSDT")).toBe("NVDA");
    expect(getUnderlyingStockSymbol("TSLAUSDT")).toBe("TSLA");
    expect(getUnderlyingStockSymbol("AAPL")).toBe("AAPL"); // Direct stock symbol
    expect(getUnderlyingStockSymbol("BTCUSDT")).toBeNull();
  });

  it("retrieves official stock company names", () => {
    expect(getTradFiStockName("NVDA")).toBe("NVIDIA Corporation");
    expect(getTradFiStockName("TSLA")).toBe("Tesla, Inc.");
    expect(getTradFiStockName("UNKNOWN")).toBeUndefined();
  });

  it("normalizes daily (1d) and weekly (1w) timestamps to UTC boundaries", () => {
    // 2024-08-30 13:30:00 UTC (1725024600) -> 2024-08-30 00:00:00 UTC (1724976000)
    const normDay = normalizeCandleTime(1725024600, "1d");
    const d = new Date(normDay * 1000);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCDate()).toBe(30);

    // Weekly normalization should land on Monday 00:00:00 UTC
    const normWeek = normalizeCandleTime(1725024600, "1w");
    const w = new Date(normWeek * 1000);
    expect(w.getUTCDay()).toBe(1); // 1 = Monday
    expect(w.getUTCHours()).toBe(0);
  });

  it("merges Yahoo Finance history before Binance listing while preserving Binance authoritative data", () => {
    // Yahoo historical candles (prior to and during listing)
    const yahooCandles: CandleData[] = [
      { time: 1724803200, open: 100, high: 105, low: 99, close: 102, volume: 1000 }, // Aug 28
      { time: 1724889600, open: 102, high: 106, low: 101, close: 105, volume: 1100 }, // Aug 29
      { time: 1724976000, open: 105, high: 108, low: 104, close: 107, volume: 1200 }, // Aug 30
      { time: 1725235200, open: 107, high: 110, low: 106, close: 109, volume: 1300 }, // Sept 2 (Listing day)
    ];

    // Binance candles start from listing day
    const binanceCandles: CandleData[] = [
      { time: 1725235200, open: 108, high: 111, low: 107, close: 110, volume: 500 }, // Sept 2 (Binance listing)
      { time: 1725321600, open: 110, high: 112, low: 109, close: 111, volume: 600 }, // Sept 3
    ];

    const merged = mergeHistoricalCandles(binanceCandles, yahooCandles, "1d");

    // Total candles should be 3 from Yahoo + 2 from Binance = 5
    expect(merged.length).toBe(5);

    // First 3 candles must be sourced from Yahoo
    expect(merged[0].source).toBe("yahoo");
    expect(merged[0].close).toBe(102);

    expect(merged[1].source).toBe("yahoo");
    expect(merged[1].close).toBe(105);

    expect(merged[2].source).toBe("yahoo");
    expect(merged[2].close).toBe(107);

    // On the listing day (Sept 2), Binance candle must be used, NOT Yahoo's
    expect(merged[3].source).toBe("binance");
    expect(merged[3].close).toBe(110);
    expect(merged[3].volume).toBe(500);

    // Newest candle must be from Binance
    expect(merged[4].source).toBe("binance");
    expect(merged[4].close).toBe(111);

    // Must be strictly ascending in time with no duplicates
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].time).toBeGreaterThan(merged[i - 1].time);
    }
  });

  it("handles empty Binance or empty Yahoo datasets gracefully", () => {
    const candles: CandleData[] = [
      { time: 1725235200, open: 100, high: 105, low: 99, close: 102, volume: 500 },
    ];

    const onlyBinance = mergeHistoricalCandles(candles, [], "1d");
    expect(onlyBinance.length).toBe(1);
    expect(onlyBinance[0].source).toBe("binance");

    const onlyYahoo = mergeHistoricalCandles([], candles, "1d");
    expect(onlyYahoo.length).toBe(1);
    expect(onlyYahoo[0].source).toBe("yahoo");
  });
});
