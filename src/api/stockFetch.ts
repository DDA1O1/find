import type {
  CandleData,
  CorporateEventsData,
  StockDividendEvent,
  StockSplitEvent,
  Timeframe,
} from "../types";

export interface StockQuoteMeta {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  currency: string;
  exchangeName: string;
}

export interface StockCandleResponse {
  candles: CandleData[];
  meta: StockQuoteMeta;
  events?: CorporateEventsData;
}

interface YahooChartMeta {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  currency?: string;
  exchangeName?: string;
}

interface YahooChartResult {
  meta?: YahooChartMeta;
  timestamp?: number[];
  events?: {
    splits?: Record<
      string,
      { date?: number; numerator?: number; denominator?: number; splitRatio?: string }
    >;
    dividends?: Record<string, { date?: number; amount?: number }>;
  };
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code: string; description: string } | null;
  };
}

export function mapTimeframeToYahoo(tf: Timeframe): { interval: string; range: string } {
  switch (tf) {
    case "1m":
      return { interval: "1m", range: "5d" };
    case "3m":
    case "5m":
      return { interval: "5m", range: "1mo" };
    case "15m":
      return { interval: "15m", range: "1mo" };
    case "30m":
      return { interval: "30m", range: "1mo" };
    case "1h":
      return { interval: "1h", range: "2y" };
    case "2h":
      return { interval: "1h", range: "2y" };
    case "4h":
      return { interval: "1h", range: "2y" };
    case "1d":
      return { interval: "1d", range: "10y" };
    case "1w":
      return { interval: "1wk", range: "10y" };
    default:
      return { interval: "1d", range: "10y" };
  }
}

export function parseYahooChart(data: YahooChartResponse): StockCandleResponse {
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(data?.chart?.error?.description || "No chart result in Yahoo Finance response");
  }

  const metaRaw = result.meta || {};
  const meta: StockQuoteMeta = {
    symbol: metaRaw.symbol || "",
    shortName: metaRaw.shortName || metaRaw.longName || metaRaw.symbol || "",
    regularMarketPrice: metaRaw.regularMarketPrice ?? 0,
    regularMarketChangePercent: metaRaw.regularMarketChangePercent ?? 0,
    regularMarketDayHigh: metaRaw.regularMarketDayHigh ?? 0,
    regularMarketDayLow: metaRaw.regularMarketDayLow ?? 0,
    regularMarketVolume: metaRaw.regularMarketVolume ?? 0,
    currency: metaRaw.currency || "USD",
    exchangeName: metaRaw.exchangeName || "US",
  };

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const candles: CandleData[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i] ?? 0;

    if (
      o != null &&
      h != null &&
      l != null &&
      c != null &&
      !isNaN(o) &&
      !isNaN(h) &&
      !isNaN(l) &&
      !isNaN(c)
    ) {
      candles.push({
        time: timestamps[i],
        open: Number(o.toFixed(4)),
        high: Number(h.toFixed(4)),
        low: Number(l.toFixed(4)),
        close: Number(c.toFixed(4)),
        volume: Number(v.toFixed(2)),
      });
    }
  }

  const todayNow = new Date();
  const todayUtcMidnightSec = Math.floor(
    Date.UTC(todayNow.getUTCFullYear(), todayNow.getUTCMonth(), todayNow.getUTCDate()) / 1000,
  );

  const splits: StockSplitEvent[] = [];
  if (result.events?.splits) {
    for (const s of Object.values(result.events.splits)) {
      if (
        typeof s?.date === "number" &&
        Number.isFinite(s.date) &&
        typeof s.numerator === "number" &&
        Number.isFinite(s.numerator) &&
        s.numerator > 0 &&
        typeof s.denominator === "number" &&
        Number.isFinite(s.denominator) &&
        s.denominator > 0
      ) {
        const splitRatio =
          typeof s.splitRatio === "string" && s.splitRatio.trim().length > 0
            ? s.splitRatio.trim()
            : `${s.numerator}:${s.denominator}`;
        splits.push({
          id: `split-${s.date}-${splitRatio}`,
          type: "split",
          date: s.date,
          numerator: s.numerator,
          denominator: s.denominator,
          splitRatio,
          isUpcoming: s.date >= todayUtcMidnightSec,
        });
      }
    }
    splits.sort((a, b) => a.date - b.date);
  }

  const dividends: StockDividendEvent[] = [];
  if (result.events?.dividends) {
    for (const d of Object.values(result.events.dividends)) {
      if (
        typeof d?.date === "number" &&
        Number.isFinite(d.date) &&
        typeof d.amount === "number" &&
        Number.isFinite(d.amount) &&
        d.amount > 0
      ) {
        const amount = Number(d.amount.toFixed(6));
        dividends.push({
          id: `div-${d.date}-${amount}`,
          type: "dividend",
          date: d.date,
          amount,
          currency: meta.currency,
          isUpcoming: d.date >= todayUtcMidnightSec,
        });
      }
    }
    dividends.sort((a, b) => a.date - b.date);
  }

  const events: CorporateEventsData = {
    symbol: meta.symbol,
    currency: meta.currency,
    splits,
    dividends,
  };

  return { candles, meta, events };
}

function utcDateKey(timestampSec: number): string {
  return new Date(timestampSec * 1000).toISOString().slice(0, 10);
}

/**
 * Merges base Yahoo Finance corporate events with Nasdaq enrichment data
 * (upcoming dividends, payment dates, annualized dividend & yield, upcoming splits).
 */
export function mergeCorporateEvents(
  base: CorporateEventsData | undefined,
  enrichment: CorporateEventsData | null | undefined,
): CorporateEventsData | undefined {
  if (!enrichment) return base;
  if (!base) return enrichment;

  const splitMap = new Map<string, StockSplitEvent>();
  for (const s of base.splits) {
    splitMap.set(utcDateKey(s.date), { ...s });
  }
  for (const s of enrichment.splits) {
    const key = utcDateKey(s.date);
    const existing = splitMap.get(key);
    if (existing) {
      splitMap.set(key, {
        ...existing,
        isUpcoming: existing.isUpcoming || s.isUpcoming,
        splitRatio: existing.splitRatio || s.splitRatio,
      });
    } else {
      splitMap.set(key, { ...s });
    }
  }
  const splits = Array.from(splitMap.values()).sort((a, b) => a.date - b.date);

  const annualizedDividend = enrichment.annualizedDividend ?? base.annualizedDividend;
  const dividendYield = enrichment.dividendYield ?? base.dividendYield;

  const divMap = new Map<string, StockDividendEvent>();
  for (const d of base.dividends) {
    divMap.set(utcDateKey(d.date), {
      ...d,
      annualizedRate: d.annualizedRate ?? annualizedDividend,
      yieldPercent: d.yieldPercent ?? dividendYield,
    });
  }
  for (const d of enrichment.dividends) {
    const key = utcDateKey(d.date);
    const existing = divMap.get(key);
    if (existing) {
      divMap.set(key, {
        ...existing,
        amount: existing.amount > 0 ? existing.amount : d.amount,
        currency: existing.currency || d.currency,
        isUpcoming: existing.isUpcoming || d.isUpcoming,
        paymentDate: d.paymentDate ?? existing.paymentDate,
        declarationDate: d.declarationDate ?? existing.declarationDate,
        annualizedRate: d.annualizedRate ?? annualizedDividend ?? existing.annualizedRate,
        yieldPercent: d.yieldPercent ?? dividendYield ?? existing.yieldPercent,
      });
    } else {
      divMap.set(key, {
        ...d,
        annualizedRate: d.annualizedRate ?? annualizedDividend,
        yieldPercent: d.yieldPercent ?? dividendYield,
      });
    }
  }
  const dividends = Array.from(divMap.values()).sort((a, b) => a.date - b.date);

  return {
    symbol: base.symbol || enrichment.symbol,
    currency: base.currency || enrichment.currency || "USD",
    splits,
    dividends,
    annualizedDividend,
    dividendYield,
  };
}

const EVENTS_CACHE_TTL_MS = 10 * 60 * 1000;
const stockEventsCache = new Map<string, { data: CorporateEventsData; fetchedAt: number }>();
const inFlightStockEvents = new Map<string, Promise<CorporateEventsData | null>>();

/**
 * Fetches upcoming dividends, payment dates, and upcoming splits non-blockingly.
 */
export async function fetchStockEvents(symbol: string): Promise<CorporateEventsData | null> {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!cleanSymbol) return null;

  const cached = stockEventsCache.get(cleanSymbol);
  if (cached && Date.now() - cached.fetchedAt < EVENTS_CACHE_TTL_MS) {
    return cached.data;
  }

  const existing = inFlightStockEvents.get(cleanSymbol);
  if (existing) return existing;

  const promise = (async (): Promise<CorporateEventsData | null> => {
    try {
      const res = await fetch(`/api/stock-events?symbol=${encodeURIComponent(cleanSymbol)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as CorporateEventsData;
      stockEventsCache.set(cleanSymbol, { data, fetchedAt: Date.now() });
      return data;
    } catch {
      return null;
    } finally {
      inFlightStockEvents.delete(cleanSymbol);
    }
  })();

  inFlightStockEvents.set(cleanSymbol, promise);
  return promise;
}

/**
 * Client-side fetch function that calls our local dev or Vercel serverless proxy endpoint
 */
export async function fetchStockCandles(
  symbol: string,
  timeframe: Timeframe,
  range?: string,
): Promise<StockCandleResponse> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const rangeQuery = range ? `&range=${encodeURIComponent(range)}` : "";
  const url = `/api/stock-candles?symbol=${encodeURIComponent(cleanSymbol)}&interval=${timeframe}${rangeQuery}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch stock candles for ${symbol}: HTTP ${res.status}`);
  }

  return (await res.json()) as StockCandleResponse;
}
