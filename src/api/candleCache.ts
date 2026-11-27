import type { CandleData, CorporateEventsData, Timeframe } from "../types";
import { fetchKlines } from "./binance";
import { fetchStockCandles, type StockQuoteMeta } from "./stockFetch";
import {
  getTradFiRefPrice,
  getTradFiUnderlyingType,
  getUnderlyingStockSymbol,
  mergeHistoricalCandles,
  registerTradFiStockName,
  setTradFiRefPrice,
} from "./tradifiPairs";

interface CacheEntry {
  candles: CandleData[];
  meta?: StockQuoteMeta;
  events?: CorporateEventsData;
  cachedAt: number;
}

const MAX_CACHE_ENTRIES = 120;
const CACHE_TTL_MS = 90_000; // 90 seconds TTL before refreshing in background

export class CandleCacheManager {
  private cache = new Map<string, CacheEntry>();
  private inFlightRequests = new Map<
    string,
    Promise<{ candles: CandleData[]; meta?: StockQuoteMeta; events?: CorporateEventsData }>
  >();

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  public isStock(symbol: string): boolean {
    return !symbol.endsWith("USDT");
  }

  public get(
    symbol: string,
    timeframe: Timeframe,
  ): { candles: CandleData[]; meta?: StockQuoteMeta; events?: CorporateEventsData } | null {
    const key = this.getCacheKey(symbol, timeframe);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Return immediately for instant 0ms render
    return { candles: entry.candles, meta: entry.meta, events: entry.events };
  }

  public set(
    symbol: string,
    timeframe: Timeframe,
    candles: CandleData[],
    meta?: StockQuoteMeta,
    events?: CorporateEventsData,
  ): void {
    const key = this.getCacheKey(symbol, timeframe);

    // Evict oldest if exceeding max entries
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      candles,
      meta,
      events,
      cachedAt: Date.now(),
    });
  }

  public updateEvents(symbol: string, timeframe: Timeframe, events: CorporateEventsData): void {
    const key = this.getCacheKey(symbol, timeframe);
    const entry = this.cache.get(key);
    if (entry) {
      entry.events = events;
    }
  }

  public async getOrFetch(
    symbol: string,
    timeframe: Timeframe,
    limit = 500,
  ): Promise<{
    candles: CandleData[];
    meta?: StockQuoteMeta;
    events?: CorporateEventsData;
    isInstant: boolean;
  }> {
    const key = this.getCacheKey(symbol, timeframe);
    const entry = this.cache.get(key);

    // Instant hit: return cached data immediately
    if (entry && entry.candles.length > 0) {
      // If entry is stale, re-fetch in background without blocking
      if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        void this.fetchAndStore(symbol, timeframe, limit);
      }
      return { candles: entry.candles, meta: entry.meta, events: entry.events, isInstant: true };
    }

    // In-flight deduplication
    const result = await this.fetchAndStore(symbol, timeframe, limit);
    return {
      candles: result.candles,
      meta: result.meta,
      events: result.events,
      isInstant: false,
    };
  }

  private async fetchAndStore(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<{ candles: CandleData[]; meta?: StockQuoteMeta; events?: CorporateEventsData }> {
    const key = this.getCacheKey(symbol, timeframe);

    // Deduplicate concurrent requests for same symbol/timeframe
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }

    const request = (async () => {
      if (this.isStock(symbol)) {
        const { candles, meta, events } = await fetchStockCandles(symbol, timeframe);
        this.set(symbol, timeframe, candles, meta, events);
        return { candles, meta, events };
      }

      // Check if this Binance futures pair is a TradFi stock perpetual (e.g. NVDAUSDT, XIAOMIUSDT)
      const tradFiStock = getUnderlyingStockSymbol(symbol);
      if (tradFiStock) {
        const underlyingType = getTradFiUnderlyingType(symbol);
        const initialRefPrice = getTradFiRefPrice(symbol);

        // Fetch Binance candles and Yahoo historical stock candles concurrently
        const [binanceResult, yahooResult] = await Promise.allSettled([
          fetchKlines(symbol, timeframe, limit),
          fetchStockCandles(tradFiStock, timeframe, {
            underlyingType,
            refPrice: initialRefPrice,
          }),
        ]);

        const binanceCandles = binanceResult.status === "fulfilled" ? binanceResult.value : [];
        let yahooCandles = yahooResult.status === "fulfilled" ? yahooResult.value.candles : [];
        let yahooMeta = yahooResult.status === "fulfilled" ? yahooResult.value.meta : undefined;
        let yahooEvents = yahooResult.status === "fulfilled" ? yahooResult.value.events : undefined;

        // If refPrice was unknown on initial load and Yahoo failed to resolve/align,
        // retry once using Binance's live candle close price as refPrice.
        if (yahooCandles.length === 0 && binanceCandles.length > 0 && !initialRefPrice) {
          const fallbackRefPrice = binanceCandles[binanceCandles.length - 1].close;
          if (fallbackRefPrice > 0) {
            setTradFiRefPrice(symbol, fallbackRefPrice);
            try {
              const retryRes = await fetchStockCandles(tradFiStock, timeframe, {
                underlyingType,
                refPrice: fallbackRefPrice,
              });
              yahooCandles = retryRes.candles;
              yahooMeta = retryRes.meta;
              yahooEvents = retryRes.events;
            } catch {
              // Fall back cleanly to Binance-only candles
            }
          }
        }

        if (yahooMeta?.shortName) {
          registerTradFiStockName(tradFiStock, yahooMeta.shortName);
        }

        if (binanceCandles.length > 0 && yahooCandles.length > 0) {
          const merged = mergeHistoricalCandles(binanceCandles, yahooCandles, timeframe);
          this.set(symbol, timeframe, merged, yahooMeta, yahooEvents);
          return { candles: merged, meta: yahooMeta, events: yahooEvents };
        } else if (binanceCandles.length > 0) {
          this.set(symbol, timeframe, binanceCandles, yahooMeta, yahooEvents);
          return { candles: binanceCandles, meta: yahooMeta, events: yahooEvents };
        } else if (yahooCandles.length > 0) {
          this.set(symbol, timeframe, yahooCandles, yahooMeta, yahooEvents);
          return { candles: yahooCandles, meta: yahooMeta, events: yahooEvents };
        } else {
          throw new Error(`Failed to load chart data for ${symbol}`);
        }
      }

      // Pure crypto perpetual contract (e.g. BTCUSDT)
      const candles = await fetchKlines(symbol, timeframe, limit);
      this.set(symbol, timeframe, candles);
      return { candles };
    })().finally(() => {
      this.inFlightRequests.delete(key);
    });

    this.inFlightRequests.set(key, request);
    return request;
  }

  /**
   * Pre-fetches adjacent symbols in background so pressing Spacebar hits the cache with 0ms delay
   */
  public async prefetch(symbols: string[], timeframe: Timeframe, limit = 500): Promise<void> {
    for (const sym of symbols) {
      const key = this.getCacheKey(sym, timeframe);
      if (!this.cache.has(key) && !this.inFlightRequests.has(key)) {
        // Fetch quietly in background
        void this.fetchAndStore(sym, timeframe, limit).catch(() => {});
      }
    }
  }

  public invalidate(symbol: string): void {
    const prefix = `${symbol}_`;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

export const candleCache = new CandleCacheManager();
