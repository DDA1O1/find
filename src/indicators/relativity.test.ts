import { describe, expect, it } from "vite-plus/test";
import {
  calculateRollingRelativity,
  classifyCorrelation,
  getSuggestedBenchmarks,
  lookupRelativityAtTime,
  resolveDefaultBenchmark,
} from "./relativity";
import type { CandleData } from "../types";

function makeDailySeries(closes: number[], startSec = Date.UTC(2025, 0, 1) / 1000): CandleData[] {
  return closes.map((close, idx) => ({
    time: startSec + idx * 86400,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  }));
}

describe("Relativity (100D Correlation & Beta)", () => {
  it("resolves two-tier benchmarks by true market cap sector leaders and underlying drivers", () => {
    // Tier 0: Exact underlyings
    expect(resolveDefaultBenchmark("GDXUSDT").symbol).toBe("XAUUSDT");
    expect(resolveDefaultBenchmark("NVDLUSDT").symbol).toBe("NVDAUSDT");
    expect(resolveDefaultBenchmark("AMDLUSDT").symbol).toBe("AMDUSDT");
    expect(resolveDefaultBenchmark("SQQQUSDT").symbol).toBe("QQQUSDT");
    expect(resolveDefaultBenchmark("IBITUSDT").symbol).toBe("BTCUSDT");

    // Tier 1: True market-cap sector leaders
    expect(resolveDefaultBenchmark("AMDUSDT").symbol).toBe("NVDAUSDT");
    expect(resolveDefaultBenchmark("MUUSDT").symbol).toBe("NVDAUSDT");
    expect(resolveDefaultBenchmark("TSMUSDT").symbol).toBe("NVDAUSDT");
    expect(resolveDefaultBenchmark("BYDUSDT").symbol).toBe("TSLAUSDT");
    expect(resolveDefaultBenchmark("RIVNUSDT").symbol).toBe("TSLAUSDT");
    expect(resolveDefaultBenchmark("NIOUSDT").symbol).toBe("TSLAUSDT");
    expect(resolveDefaultBenchmark("XIAOMIUSDT").symbol).toBe("AAPLUSDT");
    expect(resolveDefaultBenchmark("ETHUSDT").symbol).toBe("BTCUSDT");

    // Tier 2: Sector leaders step up to Sector ETF or Macro Benchmark
    expect(resolveDefaultBenchmark("NVDAUSDT").symbol).toBe("SMHUSDT");
    expect(resolveDefaultBenchmark("TSLAUSDT").symbol).toBe("QQQUSDT");
    expect(resolveDefaultBenchmark("AAPLUSDT").symbol).toBe("QQQUSDT");
    expect(resolveDefaultBenchmark("JPMUSDT").symbol).toBe("XLFUSDT");
    expect(resolveDefaultBenchmark("XAUUSDT").symbol).toBe("SPYUSDT");
    expect(resolveDefaultBenchmark("BTCUSDT").symbol).toBe("QQQUSDT");
    expect(resolveDefaultBenchmark("SMHUSDT").symbol).toBe("QQQUSDT");
  });

  it("provides unique suggested benchmark presets excluding the active symbol", () => {
    const amdPresets = getSuggestedBenchmarks("AMDUSDT").map((b) => b.symbol);
    expect(amdPresets[0]).toBe("NVDAUSDT");
    expect(amdPresets).toContain("SMHUSDT");
    expect(amdPresets).toContain("QQQUSDT");
    expect(amdPresets).not.toContain("AMDUSDT");

    const nvdaPresets = getSuggestedBenchmarks("NVDAUSDT").map((b) => b.symbol);
    expect(nvdaPresets[0]).toBe("SMHUSDT");
    expect(nvdaPresets).not.toContain("NVDAUSDT");
  });

  it("computes accurate rolling 100D correlation and beta for leveraged & inverse assets", () => {
    // Generate 125 days of benchmark returns with realistic alternating oscillation
    const benchCloses: number[] = [100];
    const leveragedCloses: number[] = [50];
    const inverseCloses: number[] = [50];

    for (let i = 1; i <= 125; i++) {
      const r = 0.015 * Math.sin(i * 0.7) + 0.008 * Math.cos(i * 1.9);
      benchCloses.push(benchCloses[i - 1] * Math.exp(r));
      // 2x beta positively correlated
      leveragedCloses.push(leveragedCloses[i - 1] * Math.exp(2.0 * r));
      // -3x beta inversely correlated
      inverseCloses.push(inverseCloses[i - 1] * Math.exp(-3.0 * r));
    }

    const bench = makeDailySeries(benchCloses);
    const lev = makeDailySeries(leveragedCloses);
    const inv = makeDailySeries(inverseCloses);

    const levSeries = calculateRollingRelativity(lev, bench, 100);
    expect(levSeries.length).toBeGreaterThan(100);
    const latestLev = levSeries[levSeries.length - 1];
    expect(latestLev.sampleSize).toBe(100);
    expect(latestLev.correlation).toBeCloseTo(1.0, 5);
    expect(latestLev.beta).toBeCloseTo(2.0, 5);

    const invSeries = calculateRollingRelativity(inv, bench, 100);
    const latestInv = invSeries[invSeries.length - 1];
    expect(latestInv.sampleSize).toBe(100);
    expect(latestInv.correlation).toBeCloseTo(-1.0, 5);
    expect(latestInv.beta).toBeCloseTo(-3.0, 5);
  });

  it("aligns cross-timezone daily candles strictly by UTC calendar date (ignoring mismatched holidays)", () => {
    const startSec = Date.UTC(2025, 0, 1) / 1000;
    const benchCloses: number[] = [100];
    const assetCloses: number[] = [20];

    for (let i = 1; i <= 40; i++) {
      const r = 0.02 * Math.sin(i * 0.9);
      benchCloses.push(benchCloses[i - 1] * Math.exp(r));
      assetCloses.push(assetCloses[i - 1] * Math.exp(1.5 * r));
    }

    // Benchmark has US timestamps (14:30 UTC), asset has HK timestamps (01:30 UTC) + skips 3 holidays
    const bench = benchCloses.map((c, idx) => ({
      time: startSec + idx * 86400 + 14.5 * 3600,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 100,
    }));
    const asset = assetCloses
      .map((c, idx) => ({
        time: startSec + idx * 86400 + 1.5 * 3600,
        open: c,
        high: c,
        low: c,
        close: c,
        volume: 100,
      }))
      .filter((_, idx) => idx !== 5 && idx !== 15 && idx !== 25);

    const series = calculateRollingRelativity(asset, bench, 100);
    expect(series.length).toBeGreaterThan(20);
    const latest = series[series.length - 1];
    expect(latest.correlation).toBeCloseTo(1.0, 4);
    expect(latest.beta).toBeCloseTo(1.5, 4);
  });

  it("looks up the exact historical rolling point for intraday or daily hover timestamps", () => {
    const startSec = Date.UTC(2025, 0, 1) / 1000;
    const benchCloses: number[] = [100];
    const assetCloses: number[] = [100];

    // First 20 days positively correlated, next 20 days inversely correlated
    for (let i = 1; i <= 40; i++) {
      const r = 0.02 * Math.sin(i * 1.1);
      benchCloses.push(benchCloses[i - 1] * Math.exp(r));
      const mult = i <= 20 ? 1.0 : -1.0;
      assetCloses.push(assetCloses[i - 1] * Math.exp(mult * r));
    }

    const series = calculateRollingRelativity(
      makeDailySeries(assetCloses, startSec),
      makeDailySeries(benchCloses, startSec),
      15,
    );

    // Intraday timestamp (e.g. 16:00 UTC) on day 18 -> positive correlation
    const earlyPoint = lookupRelativityAtTime(series, startSec + 18 * 86400 + 16 * 3600);
    expect(earlyPoint).not.toBeNull();
    expect(earlyPoint!.correlation).toBeGreaterThan(0.95);

    // Intraday timestamp on day 38 -> negative correlation
    const latePoint = lookupRelativityAtTime(series, startSec + 38 * 86400 + 8 * 3600);
    expect(latePoint).not.toBeNull();
    expect(latePoint!.correlation).toBeLessThan(-0.95);

    // Before minimum window -> null
    expect(lookupRelativityAtTime(series, startSec + 2 * 86400)).toBeNull();
  });

  it("classifies correlation levels into coupled, moderate, independent, and inverse tags", () => {
    expect(classifyCorrelation(0.84)).toEqual({ label: "Coupled", tone: "coupled" });
    expect(classifyCorrelation(0.55)).toEqual({ label: "Moderate", tone: "moderate" });
    expect(classifyCorrelation(0.18)).toEqual({ label: "Independent", tone: "independent" });
    expect(classifyCorrelation(-0.52)).toEqual({ label: "Inverse", tone: "inverse" });
    expect(classifyCorrelation(-0.88)).toEqual({
      label: "Strong Inverse",
      tone: "strong-inverse",
    });
  });
});
