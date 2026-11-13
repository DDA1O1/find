import type {
  BinanceTicker24hr,
  CandleData,
  Timeframe,
  WatchlistTicker,
  WsKlineMessage,
  WsTickerMessage,
} from "../types";
import {
  getTradFiStockName,
  isTradFiFuturesSymbol,
  registerTradFiPerpetualSymbol,
} from "./tradifiPairs";
import { ReconnectingWebSocket } from "./reconnectingWebSocket";
import { eventBus, type ConnectionStatus } from "../core/eventBus";

const REST_BASE = "https://fapi.binance.com";
const WS_BASE = "wss://fstream.binance.com/market";

export class RateLimitError extends Error {
  public retryAfterMs: number;
  constructor(message: string, retryAfterMs = 30000) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// Track rate limit timestamp to protect against IP bans (E2)
let rateLimitedUntil = 0;

export function getRateLimitStatus(): { isRateLimited: boolean; remainingSec: number } {
  const now = Date.now();
  if (now < rateLimitedUntil) {
    return { isRateLimited: true, remainingSec: Math.ceil((rateLimitedUntil - now) / 1000) };
  }
  return { isRateLimited: false, remainingSec: 0 };
}

/**
 * Safe fetch wrapper that handles HTTP 429 / 418 rate limiting gracefully (E2)
 */
async function fetchWithRateLimit(url: string, init?: RequestInit): Promise<Response> {
  const limitStatus = getRateLimitStatus();
  if (limitStatus.isRateLimited) {
    throw new RateLimitError(
      `Binance API rate limit active. Please wait ${limitStatus.remainingSec}s`,
      limitStatus.remainingSec * 1000,
    );
  }

  const res = await fetch(url, init);

  if (res.status === 429 || res.status === 418) {
    // Check Retry-After header (seconds)
    const retryAfterHeader = res.headers.get("Retry-After");
    const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 30;
    const cooldownMs = (isNaN(retrySec) ? 30 : retrySec) * 1000;
    rateLimitedUntil = Date.now() + cooldownMs;

    eventBus.emit("toast:show", {
      type: "warning",
      title: "Rate Limit Exceeded",
      message: `Binance rate limit triggered. Pausing API requests for ${Math.round(cooldownMs / 1000)}s.`,
      duration: 8000,
    });

    throw new RateLimitError(`Binance API rate limit exceeded (HTTP ${res.status}).`, cooldownMs);
  }

  return res;
}

interface ExchangeSymbolInfo {
  symbol: string;
  status: string;
  contractType: string;
  quoteAsset: string;
}

/**
 * Fetches 24h ticker data for all active Binance USDT-M Futures pairs.
 */
export async function fetchFutures24hTickers(): Promise<WatchlistTicker[]> {
  const [infoRes, tickerRes] = await Promise.all([
    fetchWithRateLimit(`${REST_BASE}/fapi/v1/exchangeInfo`).catch(() => null),
    fetchWithRateLimit(`${REST_BASE}/fapi/v1/ticker/24hr`),
  ]);

  if (!tickerRes.ok) {
    throw new Error(`Failed to fetch tickers: HTTP ${tickerRes.status}`);
  }

  const rawTickers: BinanceTicker24hr[] = await tickerRes.json();
  const savedFavorites = getSavedFavorites();

  // Valid perpetual contracts currently TRADING
  let validPerpetualSymbols: Set<string> | null = null;
  const contractTypeMap = new Map<string, string>();
  if (infoRes && infoRes.ok) {
    const exchangeInfo: { symbols: ExchangeSymbolInfo[] } = await infoRes.json();
    for (const s of exchangeInfo.symbols) {
      if (
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        (s.contractType === "PERPETUAL" || s.contractType === "TRADIFI_PERPETUAL")
      ) {
        if (s.contractType === "TRADIFI_PERPETUAL") {
          registerTradFiPerpetualSymbol(s.symbol);
        }
        contractTypeMap.set(s.symbol, s.contractType);
      }
    }
    validPerpetualSymbols = new Set(contractTypeMap.keys());
  }

  // Filter for active USDT perpetual contracts only
  const usdtTickers = rawTickers
    .filter((t) => {
      if (validPerpetualSymbols) {
        return validPerpetualSymbols.has(t.symbol);
      }
      return t.symbol.endsWith("USDT") && !t.symbol.includes("_");
    })
    .map((t) => {
      const base = t.symbol.replace(/USDT$/, "");
      const isTradFi = isTradFiFuturesSymbol(t.symbol, contractTypeMap.get(t.symbol));
      const contractType = isTradFi
        ? "TRADIFI_PERPETUAL"
        : contractTypeMap.get(t.symbol) || "PERPETUAL";
      const stockName = isTradFi ? getTradFiStockName(base) : undefined;

      return {
        symbol: t.symbol,
        baseAsset: base,
        quoteAsset: "USDT",
        name: stockName,
        contractType,
        price: parseFloat(t.lastPrice),
        prevPrice: parseFloat(t.lastPrice),
        change24h: parseFloat(t.priceChangePercent),
        high24h: parseFloat(t.highPrice),
        low24h: parseFloat(t.lowPrice),
        volume24h: parseFloat(t.volume),
        quoteVolume24h: parseFloat(t.quoteVolume),
        isFavorite: savedFavorites.has(t.symbol),
      };
    });

  // Sort by volume descending by default
  return usdtTickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
}

/**
 * Fetches historical candlestick data
 */
export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
): Promise<CandleData[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetchWithRateLimit(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch klines for ${symbol}: HTTP ${res.status}`);
  }

  const data: Array<[number, string, string, string, string, string, ...unknown[]]> =
    await res.json();

  return data.map((d) => ({
    time: Math.floor(d[0] / 1000), // convert ms to seconds
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  }));
}

// Local storage for favorite symbols
const FAVORITES_STORAGE_KEY = "tv_favorites_v1";

export function getSavedFavorites(): Set<string> {
  try {
    if (typeof localStorage === "undefined") {
      return new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
    }
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favorites)));
    }
  } catch (e) {
    console.error("Failed to save favorites to localStorage", e);
  }
}

/**
 * WebSocket client for real-time Kline / Candlestick stream of active symbol
 * Built on ReconnectingWebSocket (C6, C5)
 */
export class KlineSocketClient {
  private rws: ReconnectingWebSocket | null = null;
  private symbol: string;
  private interval: Timeframe;
  private onCandleUpdate: (candle: CandleData, isClosed: boolean) => void;
  private onStatusChange: (status: ConnectionStatus) => void;
  private isDestroyed = false;

  constructor(
    symbol: string,
    interval: Timeframe,
    onCandleUpdate: (candle: CandleData, isClosed: boolean) => void,
    onStatusChange: (status: ConnectionStatus) => void,
  ) {
    this.symbol = symbol;
    this.interval = interval;
    this.onCandleUpdate = onCandleUpdate;
    this.onStatusChange = onStatusChange;
    this.connect();
  }

  public updateSubscription(symbol: string, interval: Timeframe): void {
    if (this.symbol === symbol && this.interval === interval) return;
    this.symbol = symbol;
    this.interval = interval;
    this.rws?.updateUrl(this.getStreamUrl());
  }

  private getStreamUrl(): string {
    const streamName = `${this.symbol.toLowerCase()}@kline_${this.interval}`;
    return `${WS_BASE}/ws/${streamName}`;
  }

  private connect(): void {
    if (this.isDestroyed) return;

    this.rws = new ReconnectingWebSocket({
      url: () => this.getStreamUrl(),
      initialReconnectInterval: 1200,
      maxReconnectInterval: 8000,
      staleTimeout: 15000, // 15 seconds stale check (E3)
      onStatusChange: (status) => {
        if (!this.isDestroyed) {
          this.onStatusChange(status);
        }
      },
      onMessage: (event) => {
        if (this.isDestroyed) return;
        try {
          const msg: WsKlineMessage = JSON.parse(event.data);
          if (msg.e === "kline" && msg.k) {
            const k = msg.k;
            const candle: CandleData = {
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            };
            this.onCandleUpdate(candle, k.x);
          }
        } catch (err) {
          console.error("Error parsing kline ws message:", err);
        }
      },
    });
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.rws) {
      this.rws.destroy();
      this.rws = null;
    }
  }
}

/**
 * WebSocket client for all-market ticker stream to keep watchlist updated in real-time
 * Built on ReconnectingWebSocket (C6, C5, E3) with exponential backoff REST fallback
 */
export class AllTickersSocketClient {
  private rws: ReconnectingWebSocket | null = null;
  private onTickersUpdate: (updates: Map<string, Partial<WatchlistTicker>>) => void;
  private watchdogInterval: number | null = null;
  private lastMessageTime = 0;
  private isDestroyed = false;
  private isRestFallbackRunning = false;

  constructor(onTickersUpdate: (updates: Map<string, Partial<WatchlistTicker>>) => void) {
    this.onTickersUpdate = onTickersUpdate;
    this.connect();
    this.startWatchdog();
  }

  /**
   * E3: Tuned Watchdog: checks every 4s, but only triggers REST fallback
   * after 12s of total socket silence.
   */
  private startWatchdog(): void {
    this.watchdogInterval = window.setInterval(async () => {
      if (this.isDestroyed || this.isRestFallbackRunning) return;

      const idleMs = Date.now() - this.lastMessageTime;
      // If we haven't received a live WS message in 12 seconds, poll REST as backup
      if (idleMs > 12000 && this.lastMessageTime > 0) {
        this.isRestFallbackRunning = true;
        try {
          const fresh = await fetchFutures24hTickers();
          const updatesMap = new Map<string, Partial<WatchlistTicker>>();
          for (const item of fresh) {
            updatesMap.set(item.symbol, {
              price: item.price,
              change24h: item.change24h,
              high24h: item.high24h,
              low24h: item.low24h,
              volume24h: item.volume24h,
              quoteVolume24h: item.quoteVolume24h,
            });
          }
          if (updatesMap.size > 0 && !this.isDestroyed) {
            this.onTickersUpdate(updatesMap);
          }
        } catch {
          // Ignore background polling errors
        } finally {
          this.isRestFallbackRunning = false;
        }
      }
    }, 4000);
  }

  private connect(): void {
    if (this.isDestroyed) return;

    this.rws = new ReconnectingWebSocket({
      url: `${WS_BASE}/ws/!ticker@arr`,
      initialReconnectInterval: 1500,
      maxReconnectInterval: 10000,
      staleTimeout: 15000,
      onOpen: () => {
        this.lastMessageTime = Date.now();
      },
      onMessage: (event) => {
        if (this.isDestroyed) return;
        this.lastMessageTime = Date.now();
        try {
          const rawList: WsTickerMessage[] = JSON.parse(event.data);
          if (Array.isArray(rawList)) {
            const updatesMap = new Map<string, Partial<WatchlistTicker>>();
            for (const item of rawList) {
              if (item.s && item.s.endsWith("USDT")) {
                updatesMap.set(item.s, {
                  price: parseFloat(item.c),
                  change24h: parseFloat(item.P),
                  high24h: parseFloat(item.h),
                  low24h: parseFloat(item.l),
                  volume24h: parseFloat(item.v),
                  quoteVolume24h: parseFloat(item.q),
                });
              }
            }
            if (updatesMap.size > 0) {
              this.onTickersUpdate(updatesMap);
            }
          }
        } catch (err) {
          console.error("Error parsing all tickers ws message:", err);
        }
      },
    });
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    if (this.rws) {
      this.rws.destroy();
      this.rws = null;
    }
  }
}
