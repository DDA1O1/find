import { describe, expect, it } from "vite-plus/test";
import { CandleCacheManager } from "./candleCache";
import type { CandleData } from "../types";

describe("CandleCacheManager", () => {
  const dummyCandles: CandleData[] = [
    { time: 100, open: 10, high: 15, low: 8, close: 12, volume: 100 },
    { time: 101, open: 12, high: 16, low: 11, close: 14, volume: 120 },
  ];

  it("stores and retrieves cached candle data synchronously", () => {
    const manager = new CandleCacheManager();
    expect(manager.get("BTCUSDT", "15m")).toBeNull();

    manager.set("BTCUSDT", "15m", dummyCandles);
    const retrieved = manager.get("BTCUSDT", "15m");
    expect(retrieved?.candles).toEqual(dummyCandles);
  });

  it("returns null on cache miss", () => {
    const manager = new CandleCacheManager();
    expect(manager.get("ETHUSDT", "1h")).toBeNull();
  });

  it("differentiates between timeframes for the same symbol", () => {
    const manager = new CandleCacheManager();
    manager.set("BTCUSDT", "15m", dummyCandles);

    expect(manager.get("BTCUSDT", "15m")?.candles).toEqual(dummyCandles);
    expect(manager.get("BTCUSDT", "1h")).toBeNull();
  });

  it("detects stock vs futures symbols correctly", () => {
    const manager = new CandleCacheManager();
    expect(manager.isStock("AAPL")).toBe(true);
    expect(manager.isStock("NVDA")).toBe(true);
    expect(manager.isStock("SPY")).toBe(true);
    expect(manager.isStock("BTCUSDT")).toBe(false);
  });

  it("clears all cache entries on clear()", () => {
    const manager = new CandleCacheManager();
    manager.set("BTCUSDT", "15m", dummyCandles);
    manager.clear();

    expect(manager.get("BTCUSDT", "15m")).toBeNull();
  });
});
