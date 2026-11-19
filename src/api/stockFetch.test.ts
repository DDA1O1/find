import { describe, expect, it } from "vite-plus/test";
import { mergeCorporateEvents, parseYahooChart } from "./stockFetch";
import {
  parseDollarAmount,
  parseSplitRatio,
  parseUsDateToUtcSeconds,
} from "./corporateEventParsers";
import type { CorporateEventsData } from "../types";

describe("stockFetch & corporate events parsing", () => {
  it("extracts sorted historical splits and dividends from Yahoo chart responses", () => {
    const mockYahooResponse = {
      chart: {
        result: [
          {
            meta: {
              symbol: "NVDA",
              shortName: "NVIDIA Corporation",
              currency: "USD",
              exchangeName: "NMS",
            },
            timestamp: [1718026200, 1789047000],
            events: {
              splits: {
                "1718026200": {
                  date: 1718026200,
                  numerator: 10,
                  denominator: 1,
                  splitRatio: "10:1",
                },
              },
              dividends: {
                "1789047000": {
                  date: 1789047000,
                  amount: 0.25,
                },
                "1773235800": {
                  date: 1773235800,
                  amount: 0.01,
                },
              },
            },
            indicators: {
              quote: [
                {
                  open: [120, 130],
                  high: [125, 135],
                  low: [119, 128],
                  close: [122, 134],
                  volume: [1000000, 1200000],
                },
              ],
            },
          },
        ],
        error: null,
      },
    };

    const parsed = parseYahooChart(mockYahooResponse);
    expect(parsed.candles).toHaveLength(2);
    expect(parsed.events?.symbol).toBe("NVDA");
    expect(parsed.events?.currency).toBe("USD");
    expect(parsed.events?.splits).toEqual([
      {
        id: "split-1718026200-10:1",
        type: "split",
        date: 1718026200,
        numerator: 10,
        denominator: 1,
        splitRatio: "10:1",
        isUpcoming: false,
      },
    ]);
    expect(parsed.events?.dividends.map((d) => d.date)).toEqual([1773235800, 1789047000]);
    expect(parsed.events?.dividends[1].amount).toBe(0.25);
  });

  it("merges Yahoo historical events with Nasdaq upcoming & enriched dividend metadata", () => {
    const yahooBase: CorporateEventsData = {
      symbol: "AAPL",
      currency: "USD",
      splits: [
        {
          id: "split-1598880600-4:1",
          type: "split",
          date: 1598880600,
          numerator: 4,
          denominator: 1,
          splitRatio: "4:1",
          isUpcoming: false,
        },
      ],
      dividends: [
        {
          id: "div-1794493800-0.27",
          type: "dividend",
          date: 1794493800, // 2026-11-12T14:30:00Z
          amount: 0.27,
          currency: "USD",
          isUpcoming: false,
        },
      ],
    };

    const nasdaqEnrichment: CorporateEventsData = {
      symbol: "AAPL",
      currency: "USD",
      annualizedDividend: 1.08,
      dividendYield: "0.31%",
      splits: [
        {
          id: "split-1801440000-2:1",
          type: "split",
          date: 1801440000,
          numerator: 2,
          denominator: 1,
          splitRatio: "2:1",
          isUpcoming: true,
        },
      ],
      dividends: [
        {
          id: "div-1794441600-0.27",
          type: "dividend",
          date: 1794441600, // 2026-11-12T00:00:00Z (same UTC day as Yahoo 14:30Z)
          amount: 0.27,
          currency: "USD",
          isUpcoming: false,
          paymentDate: "11/16/2026",
          declarationDate: "11/02/2026",
          annualizedRate: 1.08,
          yieldPercent: "0.31%",
        },
        {
          id: "div-1802304000-0.28",
          type: "dividend",
          date: 1802304000, // future upcoming ex-date
          amount: 0.28,
          currency: "USD",
          isUpcoming: true,
          paymentDate: "02/15/2027",
        },
      ],
    };

    const merged = mergeCorporateEvents(yahooBase, nasdaqEnrichment);
    expect(merged).toBeDefined();
    expect(merged!.annualizedDividend).toBe(1.08);
    expect(merged!.dividendYield).toBe("0.31%");

    // Splits include both historical and upcoming
    expect(merged!.splits).toHaveLength(2);
    expect(merged!.splits[1].isUpcoming).toBe(true);
    expect(merged!.splits[1].splitRatio).toBe("2:1");

    // Same-day dividend was deduplicated & enriched instead of duplicated
    expect(merged!.dividends).toHaveLength(2);
    expect(merged!.dividends[0].paymentDate).toBe("11/16/2026");
    expect(merged!.dividends[0].declarationDate).toBe("11/02/2026");
    expect(merged!.dividends[0].yieldPercent).toBe("0.31%");
    expect(merged!.dividends[1].isUpcoming).toBe(true);
    expect(merged!.dividends[1].amount).toBe(0.28);
  });

  it("parses Nasdaq US date strings, dollar amounts, and split ratios accurately", () => {
    expect(parseUsDateToUtcSeconds("11/19/2026")).toBe(Date.UTC(2026, 10, 19) / 1000);
    expect(parseUsDateToUtcSeconds("2026-12-09")).toBe(Date.UTC(2026, 11, 9) / 1000);
    expect(parseUsDateToUtcSeconds("N/A")).toBeNull();
    expect(parseUsDateToUtcSeconds("02/30/2026")).toBeNull();

    expect(parseDollarAmount("$0.27")).toBe(0.27);
    expect(parseDollarAmount(1.08)).toBe(1.08);
    expect(parseDollarAmount("N/A")).toBeNull();

    expect(parseSplitRatio("10 : 1")).toEqual({
      numerator: 10,
      denominator: 1,
      splitRatio: "10:1",
    });
    expect(parseSplitRatio("1 : 50")).toEqual({
      numerator: 1,
      denominator: 50,
      splitRatio: "1:50",
    });
    expect(parseSplitRatio("4 for 1")).toEqual({
      numerator: 4,
      denominator: 1,
      splitRatio: "4:1",
    });
    expect(parseSplitRatio("Stock Dividend")).toBeNull();
  });
});
