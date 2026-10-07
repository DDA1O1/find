import type { StockItem, WatchlistTicker } from "../types";

const STOCK_FAVORITES_KEY = "tv_favorites_stocks_v1";

const DEFAULT_STOCK_FAVORITES = ["NVDA", "AAPL", "MSFT", "TSLA", "SPY", "QQQ", "MSTR", "PLTR"];

export function getSavedStockFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STOCK_FAVORITES_KEY);
    if (!raw) return new Set(DEFAULT_STOCK_FAVORITES);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(DEFAULT_STOCK_FAVORITES);
  }
}

export function saveStockFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(STOCK_FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
  } catch (e) {
    console.error("Failed to save stock favorites to localStorage", e);
  }
}

let cachedStocksCatalog: WatchlistTicker[] | null = null;

/**
 * Loads the curated high-liquidity U.S. Stocks & ETFs catalog
 */
export async function fetchStocksCatalog(): Promise<WatchlistTicker[]> {
  if (cachedStocksCatalog && cachedStocksCatalog.length > 0) {
    return cachedStocksCatalog;
  }

  const res = await fetch("/stocks.json");
  if (!res.ok) {
    throw new Error(`Failed to load stocks catalog: HTTP ${res.status}`);
  }

  const rawList: StockItem[] = await res.json();
  const savedFavorites = getSavedStockFavorites();

  const tickers: WatchlistTicker[] = rawList.map((item) => ({
    symbol: item.s,
    baseAsset: item.s,
    quoteAsset: "USD",
    contractType: item.t,
    name: item.n,
    market: "tradifi_stocks",
    price: item.p || 0,
    prevPrice: item.p || 0,
    change24h: item.c || 0,
    high24h: 0,
    low24h: 0,
    volume24h: item.v || 0,
    quoteVolume24h: item.v ? item.v * (item.p || 1) : 0,
    isFavorite: savedFavorites.has(item.s),
  }));

  cachedStocksCatalog = tickers;
  return tickers;
}

/**
 * Fetches batch quotes (price + 24h change) for up to 20 symbols at once
 */
export async function fetchBatchStockQuotes(
  symbols: string[],
): Promise<Record<string, { price: number; change24h: number }>> {
  if (symbols.length === 0) return {};

  const clean = symbols.slice(0, 20).join(",");
  const res = await fetch(`/api/stock-batch-quotes?symbols=${encodeURIComponent(clean)}`);
  if (!res.ok) return {};

  const data = (await res.json()) as {
    quotes?: Record<string, { price: number; change24h: number }>;
  };
  return data.quotes || {};
}
