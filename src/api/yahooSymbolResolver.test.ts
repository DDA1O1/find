import { describe, expect, it } from "vite-plus/test";
import {
  convertCandlesWithFx,
  getSecondaryYahooCandidates,
  isPriceCompatible,
  isUsEquityYahooSymbol,
  rankYahooSearchQuotes,
  resampleCandles,
  resolveStaticYahooSymbol,
  shouldConvertCurrencyToUsd,
} from "./yahooSymbolResolver";
import type { CandleData } from "../types";

describe("yahooSymbolResolver", () => {
  it("resolves explicit overrides for Xiaomi, Asian stocks, commodities, FX, and hyphenated tickers", () => {
    expect(resolveStaticYahooSymbol("XIAOMI")).toBe("1810.HK");
    expect(resolveStaticYahooSymbol("TENCENT")).toBe("0700.HK");
    expect(resolveStaticYahooSymbol("BYD")).toBe("1211.HK");
    expect(resolveStaticYahooSymbol("SAMSUNG")).toBe("005930.KS");
    expect(resolveStaticYahooSymbol("SKHYNIX")).toBe("000660.KS");
    expect(resolveStaticYahooSymbol("XAU")).toBe("GC=F");
    expect(resolveStaticYahooSymbol("CL")).toBe("CL=F");
    expect(resolveStaticYahooSymbol("BZ")).toBe("BZ=F");
    expect(resolveStaticYahooSymbol("BRKB")).toBe("BRK-B");
    expect(resolveStaticYahooSymbol("USDBRL")).toBe("BRL=X");
    expect(resolveStaticYahooSymbol("NVDA")).toBe("NVDA");
  });

  it("algorithmically resolves regional exchange prefixes for newly listed stocks", () => {
    expect(resolveStaticYahooSymbol("HK1810")).toBe("1810.HK");
    expect(resolveStaticYahooSymbol("HK1888")).toBe("1888.HK");
    expect(resolveStaticYahooSymbol("HK700")).toBe("0700.HK");
    expect(resolveStaticYahooSymbol("HK9988")).toBe("9988.HK");
    expect(resolveStaticYahooSymbol("KR005930")).toBe("005930.KS");
    expect(resolveStaticYahooSymbol("JP7203")).toBe("7203.T");
    expect(resolveStaticYahooSymbol("TW2330")).toBe("2330.TW");
    expect(resolveStaticYahooSymbol("CN600519")).toBe("600519.SS");
    expect(resolveStaticYahooSymbol("CN300308")).toBe("300308.SZ");
  });

  it("generates secondary Yahoo candidates for share classes, commodities, and FX", () => {
    expect(getSecondaryYahooCandidates("BFB", "EQUITY")).toContain("BF-B");
    expect(getSecondaryYahooCandidates("NG", "COMMODITY")).toContain("NG=F");
    expect(getSecondaryYahooCandidates("USDJPY", "FX")).toEqual(["USDJPY=X", "JPY=X"]);
  });

  it("ranks Yahoo search quotes by underlyingType and excludes crypto derivatives", () => {
    const quotes = [
      {
        symbol: "XIAOMI-USD",
        shortname: "Xiaomi Synthetic",
        exchange: "CCC",
        quoteType: "CRYPTOCURRENCY",
      },
      { symbol: "3CP.F", shortname: "Xiaomi Corp.", exchange: "FRA", quoteType: "EQUITY" },
      { symbol: "XIACY", shortname: "Xiaomi Corp.", exchange: "PNK", quoteType: "EQUITY" },
      { symbol: "1810.HK", shortname: "XIAOMI-W", exchange: "HKG", quoteType: "EQUITY" },
    ];

    const ranked = rankYahooSearchQuotes(quotes, "XIAOMI", "HK_EQUITY");
    expect(ranked[0]).toBe("1810.HK");
    expect(ranked).not.toContain("XIAOMI-USD");
    expect(ranked.indexOf("1810.HK")).toBeLessThan(ranked.indexOf("3CP.F"));
  });

  it("detects USD conversion needs cleanly for XIAOMIUSDT vs HK1810USDT and SAMSUNGUSDT", () => {
    // XIAOMIUSDT trades in USD (~3.54) while Yahoo 1810.HK is in HKD (~27.70) -> convert!
    expect(
      shouldConvertCurrencyToUsd({
        currency: "HKD",
        yahooPrice: 27.7,
        refPrice: 3.542,
        baseSymbol: "XIAOMI",
        underlyingType: "HK_EQUITY",
      }),
    ).toBe(true);

    // HK1810USDT trades in HKD (~27.65) matching Yahoo 1810.HK (~27.70) -> do NOT convert!
    expect(
      shouldConvertCurrencyToUsd({
        currency: "HKD",
        yahooPrice: 27.7,
        refPrice: 27.65,
        baseSymbol: "HK1810",
        underlyingType: "HK_EQUITY",
      }),
    ).toBe(false);

    // SAMSUNGUSDT trades in USD (~133.93) while 005930.KS is in KRW (~178,700) -> convert!
    expect(
      shouldConvertCurrencyToUsd({
        currency: "KRW",
        yahooPrice: 178700,
        refPrice: 133.93,
        baseSymbol: "SAMSUNG",
        underlyingType: "KR_EQUITY",
      }),
    ).toBe(true);

    // FX contracts are never converted
    expect(
      shouldConvertCurrencyToUsd({
        currency: "BRL",
        yahooPrice: 5.65,
        refPrice: 5.63,
        baseSymbol: "USDBRL",
        underlyingType: "FX",
      }),
    ).toBe(false);
  });

  it("converts historical OHLC candles using date-aligned FX rates", () => {
    const hkdCandles: CandleData[] = [
      { time: 1700000000, open: 15.6, high: 16.0, low: 15.2, close: 15.8, volume: 100000 },
      { time: 1700086400, open: 27.3, high: 28.0, low: 27.0, close: 27.7, volume: 120000 },
    ];
    const fxPoints = [
      { time: 1700000000, rate: 7.8 },
      { time: 1700086400, rate: 7.82 },
    ];

    const converted = convertCandlesWithFx(hkdCandles, fxPoints, 7.82);
    expect(converted[0].open).toBeCloseTo(2.0, 4);
    expect(converted[0].close).toBeCloseTo(15.8 / 7.8, 3);
    expect(converted[1].close).toBeCloseTo(27.7 / 7.82, 3);
    expect(converted[1].volume).toBe(120000);
  });

  it("resamples 1h Yahoo candles into 4h UTC buckets cleanly", () => {
    const hourly: CandleData[] = [
      { time: 1700006400, open: 10, high: 12, low: 9, close: 11, volume: 100 }, // 00:00
      { time: 1700010000, open: 11, high: 15, low: 10, close: 14, volume: 200 }, // 01:00
      { time: 1700020800, open: 14, high: 16, low: 13, close: 15, volume: 150 }, // 04:00
    ];

    const resampled = resampleCandles(hourly, "4h");
    expect(resampled).toHaveLength(2);
    expect(resampled[0]).toEqual({
      time: Math.floor(1700006400 / 14400) * 14400,
      open: 10,
      high: 15,
      low: 9,
      close: 14,
      volume: 300,
    });
    expect(resampled[1].close).toBe(15);
  });

  it("checks price compatibility and US equity eligibility accurately", () => {
    expect(isPriceCompatible(3.54, 3.536)).toBe(true);
    expect(isPriceCompatible(27.7, 3.536)).toBe(false);
    expect(isPriceCompatible(10.05, 507.35)).toBe(false);

    expect(isUsEquityYahooSymbol("NVDA", "USD")).toBe(true);
    expect(isUsEquityYahooSymbol("BRK-B", "USD")).toBe(true);
    expect(isUsEquityYahooSymbol("1810.HK", "HKD")).toBe(false);
    expect(isUsEquityYahooSymbol("1810.HK", "USD")).toBe(false);
    expect(isUsEquityYahooSymbol("CL=F", "USD")).toBe(false);
    expect(isUsEquityYahooSymbol("BRL=X", "BRL")).toBe(false);
  });
});
