import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  CandleData,
  CorporateEventsData,
  StockDividendEvent,
  StockSplitEvent,
  Timeframe,
} from "../src/types";
import {
  convertCandlesWithFx,
  getSecondaryYahooCandidates,
  isPriceCompatible,
  rankYahooSearchQuotes,
  resampleCandles,
  resolveStaticYahooSymbol,
  shouldConvertCurrencyToUsd,
  type FxRatePoint,
  type YahooSearchQuote,
} from "../src/api/yahooSymbolResolver";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const YAHOO_HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"] as const;

const RESOLVED_SYMBOL_TTL_MS = 60 * 60 * 1000; // 1 hour
const FX_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const resolvedSymbolCache = new Map<string, { yahooSymbol: string; cachedAt: number }>();
const fxSeriesCache = new Map<
  string,
  { points: FxRatePoint[]; latestRate: number; cachedAt: number }
>();

interface YahooRawSplit {
  date?: number;
  numerator?: number;
  denominator?: number;
  splitRatio?: string;
}

interface YahooRawDividend {
  date?: number;
  amount?: number;
}

interface YahooChartMetaRaw {
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

interface YahooChartResultRaw {
  meta?: YahooChartMetaRaw;
  timestamp?: number[];
  events?: {
    splits?: Record<string, YahooRawSplit>;
    dividends?: Record<string, YahooRawDividend>;
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

interface YahooChartPayload {
  chart?: {
    result?: YahooChartResultRaw[];
    error?: { code?: string; description?: string } | null;
  };
}

interface ParsedChartCandidate {
  candles: CandleData[];
  meta: {
    symbol: string;
    shortName: string;
    regularMarketPrice: number;
    regularMarketChangePercent: number;
    regularMarketDayHigh: number;
    regularMarketDayLow: number;
    regularMarketVolume: number;
    currency: string;
    originalCurrency?: string;
    exchangeName: string;
  };
  events: CorporateEventsData;
}

function getTodayUtcMidnightSec(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function parseYahooEvents(
  rawEvents:
    | {
        splits?: Record<string, YahooRawSplit>;
        dividends?: Record<string, YahooRawDividend>;
      }
    | undefined,
  symbol: string,
  currency: string,
): CorporateEventsData {
  const todayUtcMidnightSec = getTodayUtcMidnightSec();
  const splits: StockSplitEvent[] = [];
  const dividends: StockDividendEvent[] = [];

  if (rawEvents?.splits) {
    for (const s of Object.values(rawEvents.splits)) {
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

  if (rawEvents?.dividends) {
    for (const d of Object.values(rawEvents.dividends)) {
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
          currency,
          isUpcoming: d.date >= todayUtcMidnightSec,
        });
      }
    }
    dividends.sort((a, b) => a.date - b.date);
  }

  return {
    symbol,
    currency,
    splits,
    dividends,
  };
}

async function fetchYahooJsonWithFallback(pathAndQuery: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
}> {
  let lastStatus = 502;
  let lastData: unknown = null;
  let lastError: unknown = null;

  for (const host of YAHOO_HOSTS) {
    const yahooUrl = `https://${host}${pathAndQuery}`;
    try {
      const yahooRes = await fetch(yahooUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      lastStatus = yahooRes.status;
      if (yahooRes.ok) {
        const json = await yahooRes.json();
        return { ok: true, status: yahooRes.status, data: json };
      }
      try {
        lastData = await yahooRes.json();
      } catch {
        lastData = null;
      }
      if (yahooRes.status !== 429 && yahooRes.status < 500) {
        return { ok: false, status: yahooRes.status, data: lastData };
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError && lastStatus === 502) {
    throw lastError instanceof Error ? lastError : new Error("Failed to reach Yahoo Finance");
  }
  return { ok: false, status: lastStatus, data: lastData };
}

async function searchYahooSymbols(query: string, underlyingType?: string): Promise<string[]> {
  try {
    const path = `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    const res = await fetchYahooJsonWithFallback(path);
    if (!res.ok || !res.data || typeof res.data !== "object") return [];
    const quotes = (res.data as { quotes?: YahooSearchQuote[] }).quotes;
    if (!Array.isArray(quotes) || quotes.length === 0) return [];
    return rankYahooSearchQuotes(quotes, query, underlyingType);
  } catch {
    return [];
  }
}

function fxRangeForChartRange(chartRange: string): string {
  switch (chartRange) {
    case "5d":
      return "1mo";
    case "1mo":
      return "3mo";
    case "2y":
      return "2y";
    default:
      return "10y";
  }
}

async function fetchFxRateSeries(
  currency: string,
  chartRange: string,
): Promise<{ points: FxRatePoint[]; latestRate: number } | null> {
  const cleanCurrency = currency.trim().toUpperCase();
  if (!cleanCurrency || cleanCurrency === "USD") return null;

  const fxRange = fxRangeForChartRange(chartRange);
  const cacheKey = `${cleanCurrency}_${fxRange}`;
  const cached = fxSeriesCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < FX_CACHE_TTL_MS) {
    return { points: cached.points, latestRate: cached.latestRate };
  }

  const fxSymbol = `${cleanCurrency}=X`;
  const path = `/v8/finance/chart/${encodeURIComponent(fxSymbol)}?interval=1d&range=${encodeURIComponent(fxRange)}`;
  const res = await fetchYahooJsonWithFallback(path);
  if (!res.ok) return null;

  const payload = res.data as YahooChartPayload;
  const result = payload?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points: FxRatePoint[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c != null && Number.isFinite(c) && c > 0) {
      points.push({ time: timestamps[i], rate: c });
    }
  }

  const metaPrice = result.meta?.regularMarketPrice;
  const latestRate =
    typeof metaPrice === "number" && Number.isFinite(metaPrice) && metaPrice > 0
      ? metaPrice
      : points.length > 0
        ? points[points.length - 1].rate
        : 0;

  if (latestRate <= 0) return null;

  fxSeriesCache.set(cacheKey, { points, latestRate, cachedAt: Date.now() });
  return { points, latestRate };
}

function parseYahooChartResult(
  result: YahooChartResultRaw,
  requestedSymbol: string,
): ParsedChartCandidate {
  const metaRaw = result.meta || {};

  // Handle British pence (GBp / GBX) by scaling to GBP
  const rawCurrency = metaRaw.currency || "USD";
  const isPence = rawCurrency === "GBp" || rawCurrency === "GBX";
  const scaleFactor = isPence ? 0.01 : 1;
  const normalizedCurrency = isPence ? "GBP" : rawCurrency.toUpperCase();

  const meta = {
    symbol: metaRaw.symbol || requestedSymbol,
    shortName: metaRaw.shortName || metaRaw.longName || requestedSymbol,
    regularMarketPrice: (metaRaw.regularMarketPrice ?? 0) * scaleFactor,
    regularMarketChangePercent: metaRaw.regularMarketChangePercent ?? 0,
    regularMarketDayHigh: (metaRaw.regularMarketDayHigh ?? 0) * scaleFactor,
    regularMarketDayLow: (metaRaw.regularMarketDayLow ?? 0) * scaleFactor,
    regularMarketVolume: metaRaw.regularMarketVolume ?? 0,
    currency: normalizedCurrency,
    exchangeName: metaRaw.exchangeName || "US",
  };

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens: (number | null)[] = quote.open || [];
  const highs: (number | null)[] = quote.high || [];
  const lows: (number | null)[] = quote.low || [];
  const closes: (number | null)[] = quote.close || [];
  const volumes: (number | null)[] = quote.volume || [];

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
        open: Number((o * scaleFactor).toFixed(4)),
        high: Number((h * scaleFactor).toFixed(4)),
        low: Number((l * scaleFactor).toFixed(4)),
        close: Number((c * scaleFactor).toFixed(4)),
        volume: Number(v.toFixed(2)),
      });
    }
  }

  const events = parseYahooEvents(result.events, meta.symbol, normalizedCurrency);
  return { candles, meta, events };
}

async function fetchAndAlignCandidate(params: {
  yahooSymbol: string;
  baseSymbol: string;
  interval: string;
  range: string;
  underlyingType?: string;
  refPrice?: number;
}): Promise<{ candidate: ParsedChartCandidate | null; lastStatus: number }> {
  const path = `/v8/finance/chart/${encodeURIComponent(params.yahooSymbol)}?interval=${encodeURIComponent(params.interval)}&range=${encodeURIComponent(params.range)}&events=div,split`;
  const res = await fetchYahooJsonWithFallback(path);
  if (!res.ok) {
    return { candidate: null, lastStatus: res.status };
  }

  const payload = res.data as YahooChartPayload;
  const result = payload?.chart?.result?.[0];
  if (!result) {
    return { candidate: null, lastStatus: 404 };
  }

  const parsed = parseYahooChartResult(result, params.yahooSymbol);
  if (parsed.candles.length === 0) {
    return { candidate: null, lastStatus: 404 };
  }

  const yahooLatestPrice =
    parsed.meta.regularMarketPrice > 0
      ? parsed.meta.regularMarketPrice
      : parsed.candles[parsed.candles.length - 1].close;

  const needsUsdConversion = shouldConvertCurrencyToUsd({
    currency: parsed.meta.currency,
    yahooPrice: yahooLatestPrice,
    refPrice: params.refPrice,
    baseSymbol: params.baseSymbol,
    underlyingType: params.underlyingType,
  });

  if (needsUsdConversion) {
    const fx = await fetchFxRateSeries(parsed.meta.currency, params.range);
    if (!fx || fx.latestRate <= 0) {
      return { candidate: null, lastStatus: 404 };
    }

    const convertedLatestPrice = yahooLatestPrice / fx.latestRate;
    if (
      params.refPrice &&
      params.refPrice > 0 &&
      !isPriceCompatible(convertedLatestPrice, params.refPrice)
    ) {
      return { candidate: null, lastStatus: 404 };
    }

    const originalCurrency = parsed.meta.currency;
    parsed.candles = convertCandlesWithFx(parsed.candles, fx.points, fx.latestRate);
    parsed.meta.originalCurrency = originalCurrency;
    parsed.meta.currency = "USD";
    parsed.meta.regularMarketPrice = Number(convertedLatestPrice.toFixed(4));
    if (parsed.meta.regularMarketDayHigh > 0) {
      parsed.meta.regularMarketDayHigh = Number(
        (parsed.meta.regularMarketDayHigh / fx.latestRate).toFixed(4),
      );
    }
    if (parsed.meta.regularMarketDayLow > 0) {
      parsed.meta.regularMarketDayLow = Number(
        (parsed.meta.regularMarketDayLow / fx.latestRate).toFixed(4),
      );
    }
    return { candidate: parsed, lastStatus: 200 };
  }

  // No FX conversion needed — validate price compatibility when refPrice is provided
  if (
    params.refPrice &&
    params.refPrice > 0 &&
    !isPriceCompatible(yahooLatestPrice, params.refPrice)
  ) {
    return { candidate: null, lastStatus: 404 };
  }

  return { candidate: parsed, lastStatus: 200 };
}

function mapTimeframeToYahoo(tf: string): { interval: string; range: string } {
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

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse,
): Promise<void> {
  // Enable CORS for frontend requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const symbol = (req.query?.symbol || urlObj.searchParams.get("symbol") || "AAPL")
      .trim()
      .toUpperCase();
    const intervalParam = req.query?.interval || urlObj.searchParams.get("interval") || "1d";
    const rangeParam = req.query?.range || urlObj.searchParams.get("range");
    const underlyingType =
      (req.query?.underlyingType || urlObj.searchParams.get("underlyingType") || "")
        .trim()
        .toUpperCase() || undefined;
    const rawRefPrice = req.query?.refPrice || urlObj.searchParams.get("refPrice");
    const parsedRefPrice = rawRefPrice ? Number(rawRefPrice) : undefined;
    const refPrice =
      parsedRefPrice !== undefined && Number.isFinite(parsedRefPrice) && parsedRefPrice > 0
        ? parsedRefPrice
        : undefined;

    const { interval, range: defaultRange } = mapTimeframeToYahoo(intervalParam);
    const range = rangeParam || defaultRange;

    // 1. Build ordered static candidates (cached dynamic resolution -> explicit/pattern -> secondary)
    const cacheKey = `${symbol}::${underlyingType || ""}`;
    const cachedResolution = resolvedSymbolCache.get(cacheKey);
    const initialCandidates: string[] = [];

    if (cachedResolution && Date.now() - cachedResolution.cachedAt < RESOLVED_SYMBOL_TTL_MS) {
      initialCandidates.push(cachedResolution.yahooSymbol);
    }

    const staticSym = resolveStaticYahooSymbol(symbol);
    if (!initialCandidates.includes(staticSym)) {
      initialCandidates.push(staticSym);
    }

    for (const sec of getSecondaryYahooCandidates(symbol, underlyingType)) {
      if (!initialCandidates.includes(sec)) {
        initialCandidates.push(sec);
      }
    }

    const tried = new Set<string>();
    let matched: ParsedChartCandidate | null = null;
    let lastStatus = 404;

    for (const candidateSym of initialCandidates) {
      tried.add(candidateSym);
      const { candidate, lastStatus: st } = await fetchAndAlignCandidate({
        yahooSymbol: candidateSym,
        baseSymbol: symbol,
        interval,
        range,
        underlyingType,
        refPrice,
      });
      lastStatus = st;
      if (candidate) {
        matched = candidate;
        resolvedSymbolCache.set(cacheKey, {
          yahooSymbol: candidate.meta.symbol || candidateSym,
          cachedAt: Date.now(),
        });
        break;
      }
    }

    // 2. Dynamic Yahoo Finance Search fallback for any newly listed / unmapped TradFi stock
    if (!matched && underlyingType !== "PREMARKET") {
      const searchCandidates = await searchYahooSymbols(symbol, underlyingType);
      let searchTries = 0;
      for (const candidateSym of searchCandidates) {
        if (tried.has(candidateSym)) continue;
        if (searchTries >= 4) break;
        tried.add(candidateSym);
        searchTries++;

        const { candidate, lastStatus: st } = await fetchAndAlignCandidate({
          yahooSymbol: candidateSym,
          baseSymbol: symbol,
          interval,
          range,
          underlyingType,
          refPrice,
        });
        lastStatus = st;
        if (candidate) {
          matched = candidate;
          resolvedSymbolCache.set(cacheKey, {
            yahooSymbol: candidate.meta.symbol || candidateSym,
            cachedAt: Date.now(),
          });
          break;
        }
      }
    }

    if (!matched) {
      res.statusCode = lastStatus >= 400 ? lastStatus : 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: `No compatible Yahoo Finance chart data found for symbol ${symbol}`,
        }),
      );
      return;
    }

    const finalCandles = resampleCandles(matched.candles, intervalParam as Timeframe);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=15, s-maxage=30");
    res.end(
      JSON.stringify({
        candles: finalCandles,
        meta: matched.meta,
        events: matched.events,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
