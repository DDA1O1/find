export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1d" | "1w";

export interface BinanceTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

export type MarketMode = "crypto_futures" | "tradifi_stocks";

export interface StockItem {
  s: string; // Symbol
  n: string; // Company / ETF Name
  t: "STOCK" | "ETF"; // Type
  p?: number; // Snapshot price
  c?: number; // Snapshot 24h change %
  v?: number; // Daily volume
}

export interface WatchlistTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  name?: string;
  market?: MarketMode;
  price: number;
  prevPrice?: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  isFavorite: boolean;
}

export interface CandleData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WsKlineMessage {
  e: string;
  E: number;
  s: string;
  k: {
    t: number; // Kline start time ms
    T: number; // Kline close time ms
    s: string; // Symbol
    i: string; // Interval
    o: string; // Open price
    c: string; // Close price
    h: string; // High price
    l: string; // Low price
    v: string; // Base asset volume
    q: string; // Quote asset volume
    x: boolean; // Is kline closed
  };
}

export interface WsTickerMessage {
  s: string; // Symbol
  c: string; // Close / last price
  P: string; // 24h price change percent
  h: string; // 24h high
  l: string; // 24h low
  v: string; // 24h base volume
  q: string; // 24h quote volume
}

export interface IndicatorSettings {
  ema20: boolean;
  ema50: boolean;
  sma200: boolean;
  bollingerBands: boolean;
  volume: boolean;
}
