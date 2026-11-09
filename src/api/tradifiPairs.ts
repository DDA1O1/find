import type { CandleData, Timeframe } from "../types";

/**
 * Curated map of popular U.S. Stocks and ETFs that are actively listed
 * or traded as perpetual / synthetic contracts on crypto exchanges.
 */
export const POPULAR_TRADIFI_STOCKS: Record<string, string> = {
  NVDA: "NVIDIA Corporation",
  TSLA: "Tesla, Inc.",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc. Class A",
  GOOG: "Alphabet Inc. Class C",
  META: "Meta Platforms, Inc.",
  COIN: "Coinbase Global, Inc.",
  MSTR: "MicroStrategy Incorporated",
  PLTR: "Palantir Technologies Inc.",
  AMD: "Advanced Micro Devices, Inc.",
  SPY: "SPDR S&P 500 ETF Trust",
  QQQ: "Invesco QQQ Trust",
  NFLX: "Netflix, Inc.",
  INTC: "Intel Corporation",
  BABA: "Alibaba Group Holding Ltd.",
  ARM: "Arm Holdings plc",
  DIS: "The Walt Disney Company",
  BA: "The Boeing Company",
  SMCI: "Super Micro Computer, Inc.",
  AVGO: "Broadcom Inc.",
  CRCL: "Circle Internet Group",
  UBER: "Uber Technologies, Inc.",
  ORCL: "Oracle Corporation",
  WMT: "Walmart Inc.",
  JPM: "JPMorgan Chase & Co.",
  V: "Visa Inc.",
  MA: "Mastercard Incorporated",
  XOM: "Exxon Mobil Corporation",
  CVX: "Chevron Corporation",
  LLY: "Eli Lilly and Company",
  JNJ: "Johnson & Johnson",
  PG: "Procter & Gamble Company",
  HD: "The Home Depot, Inc.",
  ABBV: "AbbVie Inc.",
  MRK: "Merck & Co., Inc.",
  COST: "Costco Wholesale Corporation",
  KO: "The Coca-Cola Company",
  PEP: "PepsiCo, Inc.",
  BAC: "Bank of America Corporation",
  CSCO: "Cisco Systems, Inc.",
  CRM: "Salesforce, Inc.",
  ACN: "Accenture plc",
  MCD: "McDonald's Corporation",
  LIN: "Linde plc",
  ABT: "Abbott Laboratories",
  TMO: "Thermo Fisher Scientific Inc.",
  NKE: "NIKE, Inc.",
  IBM: "International Business Machines Corp.",
  TXN: "Texas Instruments Incorporated",
  PM: "Philip Morris International Inc.",
  MS: "Morgan Stanley",
  UNH: "UnitedHealth Group Incorporated",
  GE: "General Electric Company",
  QCOM: "QUALCOMM Incorporated",
  GS: "The Goldman Sachs Group, Inc.",
  CAT: "Caterpillar Inc.",
  HON: "Honeywell International Inc.",
  AMAT: "Applied Materials, Inc.",
  BKNG: "Booking Holdings Inc.",
  ISRG: "Intuitive Surgical, Inc.",
  NOW: "ServiceNow, Inc.",
  VRTX: "Vertex Pharmaceuticals Incorporated",
  LRCX: "Lam Research Corporation",
  REGN: "Regeneron Pharmaceuticals, Inc.",
  MDLZ: "Mondelez International, Inc.",
  ADI: "Analog Devices, Inc.",
  KLAC: "KLA Corporation",
  PANW: "Palo Alto Networks, Inc.",
  SNPS: "Synopsys, Inc.",
  CDNS: "Cadence Design Systems, Inc.",
  MELI: "MercadoLibre, Inc.",
  CRWD: "CrowdStrike Holdings, Inc.",
  MAR: "Marriott International, Inc.",
  FTNT: "Fortinet, Inc.",
  WDAY: "Workday, Inc.",
  PYPL: "PayPal Holdings, Inc.",
  ABNB: "Airbnb, Inc.",
  NXPI: "NXP Semiconductors N.V.",
  CEG: "Constellation Energy Corporation",
  PDD: "PDD Holdings Inc.",
  MRVL: "Marvell Technology, Inc.",
  DHR: "Danaher Corporation",
  NEE: "NextEra Energy, Inc.",
  RTX: "RTX Corporation",
  LOW: "Lowe's Companies, Inc.",
  SPGI: "S&P Global Inc.",
  PGR: "The Progressive Corporation",
  SYK: "Stryker Corporation",
  ETN: "Eaton Corporation plc",
  BSX: "Boston Scientific Corporation",
  DE: "Deere & Company",
  SOXX: "iShares Semiconductor ETF",
  SMH: "VanEck Semiconductor ETF",
  TLT: "iShares 20+ Year Treasury Bond ETF",
  XLF: "Financial Select Sector SPDR Fund",
  XLK: "Technology Select Sector SPDR Fund",
  XLE: "Energy Select Sector SPDR Fund",
  XBI: "SPDR S&P Biotech ETF",
  ARKK: "ARK Innovation ETF",
  TQQQ: "ProShares UltraPro QQQ",
  SQQQ: "ProShares UltraPro Short QQQ",
  SOXL: "Direxion Daily Semiconductor Bull 3X",
  SOXS: "Direxion Daily Semiconductor Bear 3X",
  IWM: "iShares Russell 2000 ETF",
  DIA: "SPDR Dow Jones Industrial Average ETF",
  VOO: "Vanguard S&P 500 ETF",
};

/**
 * Common crypto-native token symbols to prevent false-positive stock matching.
 */
export const CRYPTO_NATIVE_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "SUI",
  "APT",
  "DOT",
  "NEAR",
  "TON",
  "SHIB",
  "PEPE",
  "WIF",
  "FET",
  "RENDER",
  "TAO",
  "INJ",
  "TIA",
  "SEI",
  "ATOM",
  "ARB",
  "OP",
  "MATIC",
  "POL",
  "FIL",
  "LTC",
  "BCH",
  "UNI",
  "AAVE",
  "MKR",
  "CRV",
  "LDO",
  "PENDLE",
  "ENA",
  "WLD",
  "RUNE",
  "ICP",
  "KAS",
  "STX",
  "IMX",
  "FLOKI",
  "BONK",
  "MEME",
  "GALA",
  "SAND",
  "MANA",
  "AXS",
  "CHZ",
  "FTM",
  "S",
  "ALGO",
  "FLOW",
  "THETA",
  "EGLD",
  "XTZ",
  "EOS",
  "NEO",
  "IOTA",
  "VET",
  "KAVA",
  "ZIL",
  "ENJ",
  "GAS",
  "ONE",
  "MOVE",
  "SAFE",
  "BEAM",
  "KEY",
  "TRX",
  "XLM",
  "HBAR",
  "ETC",
  "BOME",
  "MEW",
  "POPCAT",
  "NEIRO",
  "TURBO",
  "BRETT",
  "GOAT",
  "MOODENG",
  "ACT",
  "PNUT",
  "DRIFT",
  "IO",
  "NOT",
  "REZ",
  "BB",
  "ZERO",
  "OM",
  "RAY",
  "JUP",
  "ORDI",
  "SATS",
  "RATS",
  "BLUR",
  "DYDX",
  "GMX",
  "SNX",
  "COMP",
  "LRC",
  "1INCH",
  "SUSHI",
  "YFI",
  "BAL",
  "RPL",
  "1000PEPE",
  "1000SHIB",
  "1000BONK",
  "1000FLOKI",
  "1000SATS",
  "1000RATS",
  "1000CAT",
  "1000CHEEMS",
  "1000WHY",
  "1000MOG",
]);

/**
 * Dynamic set of confirmed TradFi perpetual symbols discovered from exchangeInfo
 */
const dynamicTradFiSymbols = new Set<string>();

export function registerTradFiPerpetualSymbol(symbol: string): void {
  dynamicTradFiSymbols.add(symbol.toUpperCase());
}

/**
 * Checks whether a given symbol represents a TradFi stock perpetual contract.
 */
export function isTradFiFuturesSymbol(symbol: string, contractType?: string): boolean {
  const upper = symbol.trim().toUpperCase();
  if (contractType === "TRADIFI_PERPETUAL" || dynamicTradFiSymbols.has(upper)) {
    return true;
  }
  if (!upper.endsWith("USDT")) {
    return false;
  }
  const base = upper.replace(/USDT$/, "");
  if (CRYPTO_NATIVE_SYMBOLS.has(base)) {
    return false;
  }
  return base in POPULAR_TRADIFI_STOCKS;
}

/**
 * Extracts the underlying TradFi stock symbol (e.g. "NVDAUSDT" -> "NVDA", "AAPL" -> "AAPL").
 * Returns null if the symbol is a crypto-only contract.
 */
export function getUnderlyingStockSymbol(symbol: string, contractType?: string): string | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper.endsWith("USDT")) {
    return upper;
  }
  if (isTradFiFuturesSymbol(upper, contractType)) {
    return upper.replace(/USDT$/, "");
  }
  return null;
}

/**
 * Returns human-readable stock company/ETF name if available.
 */
export function getTradFiStockName(stockSymbol: string): string | undefined {
  return POPULAR_TRADIFI_STOCKS[stockSymbol.toUpperCase()];
}

/**
 * Normalizes candle timestamp to UTC boundaries for 1D and 1W candles so that
 * TradFi and Binance daily/weekly bars align to the exact same calendar timestamps.
 */
export function normalizeCandleTime(time: number, interval: Timeframe): number {
  if (interval === "1d") {
    const d = new Date(time * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  }
  if (interval === "1w") {
    const d = new Date(time * 1000);
    const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday),
    );
    return Math.floor(monday.getTime() / 1000);
  }
  return time;
}

/**
 * Slices and merges historical TradFi candles (from Yahoo Finance) with Binance's
 * perpetual futures candles.
 *
 * Rules:
 * 1. Binance's data is authoritative from its earliest listed candle onward.
 * 2. Historical Yahoo candles are preserved strictly prior to Binance's listing.
 * 3. Any duplicate or overlapping timestamps prioritize Binance's data.
 * 4. The output is sorted strictly ascending by timestamp with zero duplicates.
 */
export function mergeHistoricalCandles(
  binanceCandles: CandleData[],
  yahooCandles: CandleData[],
  interval: Timeframe,
): CandleData[] {
  if (!binanceCandles || binanceCandles.length === 0) {
    return (yahooCandles || []).map((c) => ({
      ...c,
      source: "yahoo" as const,
      time: normalizeCandleTime(c.time, interval),
    }));
  }

  if (!yahooCandles || yahooCandles.length === 0) {
    return binanceCandles.map((c) => ({
      ...c,
      source: "binance" as const,
      time: normalizeCandleTime(c.time, interval),
    }));
  }

  const normBinance: CandleData[] = binanceCandles.map((c) => ({
    ...c,
    source: "binance" as const,
    time: normalizeCandleTime(c.time, interval),
  }));

  const normYahoo: CandleData[] = yahooCandles.map((c) => ({
    ...c,
    source: "yahoo" as const,
    time: normalizeCandleTime(c.time, interval),
  }));

  const earliestBinanceTime = normBinance[0].time;
  const binanceTimes = new Set(normBinance.map((c) => c.time));

  // Only take Yahoo candles strictly before Binance listing date & not clashing with Binance times
  const filteredYahoo = normYahoo.filter(
    (c) => c.time < earliestBinanceTime && !binanceTimes.has(c.time),
  );

  const combined = [...filteredYahoo, ...normBinance];
  combined.sort((a, b) => a.time - b.time);

  // Deduplicate and guarantee strictly ascending timestamps
  const result: CandleData[] = [];
  for (const candle of combined) {
    if (result.length > 0 && result[result.length - 1].time === candle.time) {
      // If collision occurs, latter (Binance) takes priority
      result[result.length - 1] = candle;
    } else {
      result.push(candle);
    }
  }

  return result;
}
