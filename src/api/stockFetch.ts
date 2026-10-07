import type { CandleData, Timeframe } from "../types";

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
      return { interval: "1h", range: "3mo" };
    case "2h":
      return { interval: "1h", range: "6mo" };
    case "4h":
      return { interval: "1h", range: "1y" };
    case "1d":
      return { interval: "1d", range: "5y" };
    case "1w":
      return { interval: "1wk", range: "10y" };
    default:
      return { interval: "1d", range: "5y" };
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

  return { candles, meta };
}

/**
 * Client-side fetch function that calls our local dev or Vercel serverless proxy endpoint
 */
export async function fetchStockCandles(
  symbol: string,
  timeframe: Timeframe,
): Promise<StockCandleResponse> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const url = `/api/stock-candles?symbol=${encodeURIComponent(cleanSymbol)}&interval=${timeframe}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch stock candles for ${symbol}: HTTP ${res.status}`);
  }

  return (await res.json()) as StockCandleResponse;
}
