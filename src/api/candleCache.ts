import type { CandleData, Timeframe } from "../types";
import { fetchKlines } from "./binance";

interface CacheEntry {
  candles: CandleData[];
  cachedAt: number;
}

const MAX_CACHE_ENTRIES = 100;
const CACHE_TTL_MS = 90_000; // 90 seconds TTL before refreshing in background

export class CandleCacheManager {
  private cache = new Map<string, CacheEntry>();
  private inFlightRequests = new Map<string, Promise<CandleData[]>>();

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  public get(symbol: string, timeframe: Timeframe): CandleData[] | null {
    const key = this.getCacheKey(symbol, timeframe);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Even if slightly older than TTL, return it immediately for instant 0ms render
    return entry.candles;
  }

  public set(symbol: string, timeframe: Timeframe, candles: CandleData[]): void {
    const key = this.getCacheKey(symbol, timeframe);

    // Evict oldest if exceeding max entries
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      candles,
      cachedAt: Date.now(),
    });
  }

  public async getOrFetch(
    symbol: string,
    timeframe: Timeframe,
    limit = 500,
  ): Promise<{ candles: CandleData[]; isInstant: boolean }> {
    const key = this.getCacheKey(symbol, timeframe);
    const entry = this.cache.get(key);

    // Instant hit: return cached data immediately
    if (entry && entry.candles.length > 0) {
      // If entry is stale, re-fetch in background without blocking
      if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        void this.fetchAndStore(symbol, timeframe, limit);
      }
      return { candles: entry.candles, isInstant: true };
    }

    // In-flight deduplication
    const candles = await this.fetchAndStore(symbol, timeframe, limit);
    return { candles, isInstant: false };
  }

  private async fetchAndStore(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<CandleData[]> {
    const key = this.getCacheKey(symbol, timeframe);

    // Deduplicate concurrent requests for same symbol/timeframe
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }

    const request = fetchKlines(symbol, timeframe, limit)
      .then((data) => {
        this.set(symbol, timeframe, data);
        return data;
      })
      .finally(() => {
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

  public clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

export const candleCache = new CandleCacheManager();
