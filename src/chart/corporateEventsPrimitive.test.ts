import { describe, expect, it } from "vite-plus/test";
import {
  countWeekdaysBetween,
  formatDividendAmount,
  formatDividendBadgeText,
  formatSplitBadgeText,
  mapEventToLogicalIndex,
} from "./corporateEventsPrimitive";
import type { CandleData, StockDividendEvent, StockSplitEvent } from "../types";

function utcSec(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000);
}

describe("corporateEventsPrimitive helpers", () => {
  it("formats split and dividend badges cleanly in full and compact modes", () => {
    const split: StockSplitEvent = {
      id: "s1",
      type: "split",
      date: utcSec(2024, 6, 10),
      numerator: 10,
      denominator: 1,
      splitRatio: "10:1",
      isUpcoming: false,
    };

    expect(formatSplitBadgeText(split, false)).toBe("S 10:1");
    expect(formatSplitBadgeText(split, true)).toBe("S");

    const usdDiv: StockDividendEvent = {
      id: "d1",
      type: "dividend",
      date: utcSec(2026, 9, 10),
      amount: 0.27,
      currency: "USD",
      isUpcoming: false,
    };
    expect(formatDividendAmount(0.27, "USD")).toBe("$0.27");
    expect(formatDividendAmount(0.005, "USD")).toBe("$0.005");
    expect(formatDividendAmount(1.25, "EUR")).toBe("EUR 1.25");
    expect(formatDividendBadgeText(usdDiv, false)).toBe("D $0.27");
    expect(formatDividendBadgeText(usdDiv, true)).toBe("D");
  });

  it("counts trading weekdays accurately across weekends", () => {
    // Thursday Nov 19, 2026 -> Wednesday Nov 25, 2026: Fri(20), Mon(23), Tue(24), Wed(25) = 4
    expect(countWeekdaysBetween(utcSec(2026, 11, 19), utcSec(2026, 11, 25))).toBe(4);
    expect(countWeekdaysBetween(utcSec(2026, 11, 19), utcSec(2026, 11, 19))).toBe(0);
  });

  it("aligns Yahoo 13:30 UTC split/dividend timestamps onto UTC-midnight 1d and Monday 1w candles", () => {
    const dailyCandles: CandleData[] = [
      { time: utcSec(2024, 6, 7), open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { time: utcSec(2024, 6, 10), open: 10, high: 12, low: 10, close: 11, volume: 200 },
      { time: utcSec(2024, 6, 11), open: 11, high: 12, low: 11, close: 12, volume: 150 },
    ];

    const nvdaSplit: StockSplitEvent = {
      id: "split-nvda",
      type: "split",
      date: utcSec(2024, 6, 10, 13, 30), // Yahoo market-open timestamp
      numerator: 10,
      denominator: 1,
      splitRatio: "10:1",
      isUpcoming: false,
    };

    expect(mapEventToLogicalIndex(nvdaSplit, dailyCandles, "1d")).toEqual({
      logicalIndex: 1,
      isFuture: false,
    });

    // Weekly candle starts Monday June 10, 2024; a Wednesday June 12 dividend should snap to Monday June 10
    const weeklyCandles: CandleData[] = [
      { time: utcSec(2024, 6, 3), open: 10, high: 11, low: 9, close: 10, volume: 500 },
      { time: utcSec(2024, 6, 10), open: 10, high: 12, low: 10, close: 11, volume: 600 },
    ];
    const wedDiv: StockDividendEvent = {
      id: "div-wed",
      type: "dividend",
      date: utcSec(2024, 6, 12, 13, 30),
      amount: 0.25,
      currency: "USD",
      isUpcoming: false,
    };

    expect(mapEventToLogicalIndex(wedDiv, weeklyCandles, "1w")).toEqual({
      logicalIndex: 1,
      isFuture: false,
    });
  });

  it("filters out historical events older than the loaded intraday window and matches same-day intraday bars", () => {
    const intradayCandles: CandleData[] = [
      { time: utcSec(2026, 11, 18, 14, 30), open: 100, high: 101, low: 99, close: 100, volume: 10 },
      {
        time: utcSec(2026, 11, 18, 14, 45),
        open: 100,
        high: 102,
        low: 100,
        close: 101,
        volume: 20,
      },
      {
        time: utcSec(2026, 11, 19, 14, 30),
        open: 101,
        high: 103,
        low: 101,
        close: 102,
        volume: 30,
      },
    ];

    const oldSplit: StockSplitEvent = {
      id: "split-old",
      type: "split",
      date: utcSec(2024, 6, 10, 13, 30),
      numerator: 10,
      denominator: 1,
      splitRatio: "10:1",
      isUpcoming: false,
    };
    expect(mapEventToLogicalIndex(oldSplit, intradayCandles, "15m")).toBeNull();

    const sameDayDiv: StockDividendEvent = {
      id: "div-today",
      type: "dividend",
      date: utcSec(2026, 11, 19, 0, 0),
      amount: 0.98,
      currency: "USD",
      isUpcoming: true,
    };
    expect(mapEventToLogicalIndex(sameDayDiv, intradayCandles, "15m")).toEqual({
      logicalIndex: 2,
      isFuture: false,
    });
  });

  it("extrapolates future upcoming dividends beyond the last daily candle using weekday offsets", () => {
    const dailyCandles: CandleData[] = [
      { time: utcSec(2026, 11, 18), open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { time: utcSec(2026, 11, 19), open: 101, high: 103, low: 100, close: 102, volume: 1100 },
    ];

    const futureDiv: StockDividendEvent = {
      id: "div-future",
      type: "dividend",
      date: utcSec(2026, 11, 25), // 4 weekdays after Thu Nov 19
      amount: 0.27,
      currency: "USD",
      isUpcoming: true,
    };

    expect(mapEventToLogicalIndex(futureDiv, dailyCandles, "1d")).toEqual({
      logicalIndex: 5, // last index (1) + 4 weekdays
      isFuture: true,
    });
  });
});
