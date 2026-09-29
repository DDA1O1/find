import type {
  BinanceTicker24hr,
  CandleData,
  Timeframe,
  WatchlistTicker,
  WsKlineMessage,
  WsTickerMessage,
} from "../types";

const REST_BASE = "https://fapi.binance.com";
const WS_BASE = "wss://fstream.binance.com/market";

interface ExchangeSymbolInfo {
  symbol: string;
  status: string;
  contractType: string;
  quoteAsset: string;
}

/**
 * Fetches 24h ticker data for all active Binance USDT-M Futures pairs.
 * Cross-references with exchangeInfo to automatically filter out settled/delisted
 * contracts and include newly trading perpetuals.
 */
export async function fetchFutures24hTickers(): Promise<WatchlistTicker[]> {
  const [infoRes, tickerRes] = await Promise.all([
    fetch(`${REST_BASE}/fapi/v1/exchangeInfo`).catch(() => null),
    fetch(`${REST_BASE}/fapi/v1/ticker/24hr`),
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
      return {
        symbol: t.symbol,
        baseAsset: base,
        quoteAsset: "USDT",
        contractType: contractTypeMap.get(t.symbol) || "PERPETUAL",
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
  const res = await fetch(url);
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
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favorites)));
  } catch (e) {
    console.error("Failed to save favorites to localStorage", e);
  }
}

/**
 * WebSocket client for real-time Kline / Candlestick stream of active symbol
 */
export class KlineSocketClient {
  private ws: WebSocket | null = null;
  private symbol: string;
  private interval: Timeframe;
  private onCandleUpdate: (candle: CandleData, isClosed: boolean) => void;
  private onStatusChange: (status: "connecting" | "connected" | "disconnected") => void;
  private reconnectTimeout: number | null = null;
  private isDestroyed = false;

  constructor(
    symbol: string,
    interval: Timeframe,
    onCandleUpdate: (candle: CandleData, isClosed: boolean) => void,
    onStatusChange: (status: "connecting" | "connected" | "disconnected") => void,
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
    this.reconnect();
  }

  private connect(): void {
    if (this.isDestroyed) return;

    this.onStatusChange("connecting");
    const streamName = `${this.symbol.toLowerCase()}@kline_${this.interval}`;
    const wsUrl = `${WS_BASE}/ws/${streamName}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.isDestroyed) {
          this.ws?.close();
          return;
        }
        this.onStatusChange("connected");
      };

      this.ws.onmessage = (event) => {
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
      };

      this.ws.onerror = (e) => {
        console.warn("Kline WebSocket error:", e);
      };

      this.ws.onclose = () => {
        this.onStatusChange("disconnected");
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      console.error("Failed to create WebSocket:", e);
      this.onStatusChange("disconnected");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.isDestroyed) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 2500);
  }

  private reconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * WebSocket client for all-market ticker stream to keep watchlist updated in real-time
 */
export class AllTickersSocketClient {
  private ws: WebSocket | null = null;
  private onTickersUpdate: (updates: Map<string, Partial<WatchlistTicker>>) => void;
  private reconnectTimeout: number | null = null;
  private watchdogInterval: number | null = null;
  private lastMessageTime = 0;
  private isDestroyed = false;

  constructor(onTickersUpdate: (updates: Map<string, Partial<WatchlistTicker>>) => void) {
    this.onTickersUpdate = onTickersUpdate;
    this.connect();
    this.startWatchdog();
  }

  private startWatchdog(): void {
    this.watchdogInterval = window.setInterval(async () => {
      if (this.isDestroyed) return;
      // If we haven't received a live WS message in the last 4 seconds, poll REST as backup
      if (Date.now() - this.lastMessageTime > 4000) {
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
        }
      }
    }, 3000);
  }

  private connect(): void {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(`${WS_BASE}/ws/!ticker@arr`);

      this.ws.onopen = () => {
        // Connected to all tickers stream
      };

      this.ws.onmessage = (event) => {
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
      };

      this.ws.onerror = () => {
        // Handled in onclose
      };

      this.ws.onclose = () => {
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.isDestroyed) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 4000);
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
