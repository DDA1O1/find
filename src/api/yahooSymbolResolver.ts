import type { CandleData, Timeframe } from "../types";

export interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
  score?: number;
}

export interface FxRatePoint {
  time: number; // Unix timestamp in seconds
  rate: number; // Local currency units per 1 USD (e.g., HKD=X ~ 7.82, KRW=X ~ 1338)
}

/**
 * Authoritative Yahoo Finance ticker overrides for Binance TradFi contracts whose
 * base asset either does not match Yahoo's ticker format or collides with a different
 * US-listed company on Yahoo Finance (e.g. BYD -> 1211.HK instead of Boyd Gaming,
 * CL -> CL=F instead of Colgate-Palmolive, BZ -> BZ=F instead of Kanzhun).
 */
export const EXPLICIT_YAHOO_SYMBOL_MAP: Record<string, string> = {
  // Commodities (Futures)
  XAU: "GC=F",
  XAG: "SI=F",
  XPT: "PL=F",
  XPD: "PA=F",
  COPPER: "HG=F",
  CL: "CL=F",
  BZ: "BZ=F",
  NATGAS: "NG=F",

  // FX
  USDBRL: "BRL=X",

  // US hyphenated / class-share tickers
  BRKB: "BRK-B",

  // Hong Kong equities & leveraged ETFs traded by name on Binance
  XIAOMI: "1810.HK",
  TENCENT: "0700.HK",
  BYD: "1211.HK",
  MEITUAN: "3690.HK",
  KUAISHOU: "1024.HK",
  POPMART: "9992.HK",
  MINIMAX: "0100.HK",
  ZHIPU: "2513.HK",
  GIGADEV: "3986.HK",
  ZHONGJI: "3308.HK",
  CSOPSKHYNIX2L: "7709.HK",
  CSOPSAMSUNG2L: "7747.HK",

  // Korean equities & ETFs traded by name on Binance
  SAMSUNG: "005930.KS",
  SKHYNIX: "000660.KS",
  HYUNDAI: "005380.KS",
  SAMSUNGEM: "009150.KS",
  HANMI: "042700.KS",
  LGELECTRONICS: "066570.KS",
  NAVER: "035420.KS",
  KODEX200: "069500.KS",
};

const US_EXCHANGES = new Set([
  "NMS",
  "NYQ",
  "NGM",
  "NCM",
  "PCX",
  "BTS",
  "ASE",
  "ARCX",
  "BATS",
  "NAS",
]);

const ALLOWED_QUOTE_TYPES = new Set(["EQUITY", "ETF", "FUTURE", "INDEX", "CURRENCY"]);

/**
 * Resolves a Binance TradFi base symbol (e.g. "XIAOMI", "HK1888", "BRKB", "NVDA")
 * to its primary Yahoo Finance ticker using explicit overrides and algorithmic
 * exchange-code patterns so newly listed symbols matching regional formats resolve
 * automatically without requiring manual edits.
 */
export function resolveStaticYahooSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return clean;

  if (clean in EXPLICIT_YAHOO_SYMBOL_MAP) {
    return EXPLICIT_YAHOO_SYMBOL_MAP[clean];
  }

  // Already a formatted Yahoo symbol (e.g. "1810.HK", "005930.KS", "GC=F", "BRK-B")
  if (clean.includes(".") || clean.includes("=") || clean.includes("-") || clean.startsWith("^")) {
    return clean;
  }

  // Hong Kong numeric ticker prefix: HK1810 -> 1810.HK, HK0700 -> 0700.HK, HK1888 -> 1888.HK
  const hkMatch = /^HK(\d{1,5})$/.exec(clean);
  if (hkMatch) {
    return `${hkMatch[1].padStart(4, "0")}.HK`;
  }

  // South Korea numeric ticker prefix: KR005930 -> 005930.KS
  const krMatch = /^KR(\d{6})$/.exec(clean);
  if (krMatch) {
    return `${krMatch[1]}.KS`;
  }

  // Japan numeric ticker prefix: JP7203 -> 7203.T
  const jpMatch = /^JP(\d{4})$/.exec(clean);
  if (jpMatch) {
    return `${jpMatch[1]}.T`;
  }

  // Taiwan numeric ticker prefix: TW2330 -> 2330.TW
  const twMatch = /^TW(\d{4})$/.exec(clean);
  if (twMatch) {
    return `${twMatch[1]}.TW`;
  }

  // Mainland China numeric ticker prefix: CN600519 -> 600519.SS, CN300308 -> 300308.SZ
  const cnMatch = /^CN(\d{6})$/.exec(clean);
  if (cnMatch) {
    const code = cnMatch[1];
    return `${code}.${code.startsWith("6") ? "SS" : "SZ"}`;
  }

  return clean;
}

/**
 * Generates secondary Yahoo ticker candidates to try when a direct lookup fails
 * (e.g. hyphenated US share classes like "BFB" -> "BF-B", "BRKA" -> "BRK-A").
 */
export function getSecondaryYahooCandidates(symbol: string, underlyingType?: string): string[] {
  const clean = symbol.trim().toUpperCase();
  const candidates: string[] = [];

  if (/^[A-Z]{2,4}[AB]$/.test(clean) && (!underlyingType || underlyingType === "EQUITY")) {
    candidates.push(`${clean.slice(0, -1)}-${clean.slice(-1)}`);
  }

  if (underlyingType === "COMMODITY" && !clean.includes("=")) {
    candidates.push(`${clean}=F`);
  }

  if (underlyingType === "FX" && /^[A-Z]{6}$/.test(clean)) {
    candidates.push(`${clean}=X`);
    if (clean.startsWith("USD")) {
      candidates.push(`${clean.slice(3)}=X`);
    }
  }

  return candidates;
}

/**
 * Checks if a Binance symbol is explicitly quoted in local currency rather than USD
 * (e.g. HK1810, HK0700, HK1888 trade in HKD on Binance, while XIAOMI, TENCENT trade in USD).
 */
export function isLocalCurrencyPrefixedSymbol(symbol: string): boolean {
  return /^(HK|KR|JP|TW|CN)\d{4,6}$/.test(symbol.trim().toUpperCase());
}

/**
 * Ranks Yahoo Finance search quotes for a newly listed / unmapped Binance TradFi symbol.
 * Prefers primary exchange listings matching Binance's `underlyingType` and filters out
 * crypto derivatives (e.g. `XIAOMI-USD`, `MINIMAX-USD`).
 */
export function rankYahooSearchQuotes(
  quotes: YahooSearchQuote[],
  query: string,
  underlyingType?: string,
): string[] {
  const cleanQuery = query.trim().toUpperCase();
  const type = underlyingType?.trim().toUpperCase();

  const scored: Array<{ symbol: string; score: number }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const sym = q.symbol?.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;

    const quoteType = (q.quoteType || "").toUpperCase();
    if (quoteType && !ALLOWED_QUOTE_TYPES.has(quoteType)) continue;
    // Never pick crypto pairs (e.g. MINIMAX-USD, ZHIPU-USD)
    if (sym.endsWith("-USD") || sym.endsWith("-USDT")) continue;

    seen.add(sym);

    const exchange = (q.exchange || "").toUpperCase();
    const shortName = (q.shortname || q.longname || "").toUpperCase();
    let score = 100 - i * 4;

    // Exact symbol or name match bonus
    if (sym === cleanQuery) score += 35;
    if (shortName.includes(cleanQuery)) score += 20;

    if (type === "HK_EQUITY") {
      if (sym.endsWith(".HK") || exchange === "HKG") score += 120;
      else if (exchange === "PNK") score += 10;
      else if (US_EXCHANGES.has(exchange)) score += 25;
    } else if (type === "KR_EQUITY") {
      if (sym.endsWith(".KS") || sym.endsWith(".KQ") || exchange === "KSC" || exchange === "KOE") {
        score += 120;
      } else if (US_EXCHANGES.has(exchange)) {
        score += 20;
      }
    } else if (type === "CN_EQUITY") {
      if (sym.endsWith(".HK") || exchange === "HKG") score += 110;
      else if (
        sym.endsWith(".SS") ||
        sym.endsWith(".SZ") ||
        exchange === "SHH" ||
        exchange === "SHZ"
      ) {
        score += 100;
      } else if (US_EXCHANGES.has(exchange)) {
        score += 40;
      }
    } else if (type === "JP_EQUITY") {
      if (sym.endsWith(".T") || exchange === "TYO" || exchange === "JPX") score += 120;
    } else if (type === "COMMODITY") {
      if (quoteType === "FUTURE" || sym.endsWith("=F")) score += 120;
    } else if (type === "FX") {
      if (quoteType === "CURRENCY" || sym.endsWith("=X")) score += 120;
    } else {
      // General EQUITY / unknown underlyingType
      if (US_EXCHANGES.has(exchange)) score += 60;
      else if (sym.endsWith(".HK") || sym.endsWith(".KS") || sym.endsWith(".T")) score += 45;
      else if (exchange === "PNK") score -= 15;
    }

    // Prefer equities/ETFs over options/misc
    if (quoteType === "EQUITY" || quoteType === "ETF") score += 15;
    // Deprioritize illiquid German/Frankfurt secondary listings (.F, .DU, .MU, .BE, .SG, .HM)
    if (/\.(F|DU|MU|BE|SG|HM|HA)$/.test(sym)) score -= 45;

    scored.push({ symbol: sym, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.symbol);
}

/**
 * Checks whether a Yahoo Finance price is on a compatible scale with Binance's
 * contract price. Used both to detect when FX conversion is needed and to reject
 * wrong-company or wrong-ADR-ratio matches.
 */
export function isPriceCompatible(yahooPrice: number, refPrice: number): boolean {
  if (!Number.isFinite(yahooPrice) || !Number.isFinite(refPrice)) return false;
  if (yahooPrice <= 0 || refPrice <= 0) return false;
  const ratio = yahooPrice / refPrice;
  return ratio >= 0.45 && ratio <= 2.2;
}

/**
 * Determines whether Yahoo Finance candles in `currency` should be converted to USD
 * to match a Binance USDT perpetual contract.
 */
export function shouldConvertCurrencyToUsd(params: {
  currency: string;
  yahooPrice: number;
  refPrice?: number;
  baseSymbol: string;
  underlyingType?: string;
}): boolean {
  const currency = params.currency.trim().toUpperCase();
  if (!currency || currency === "USD" || currency === "USDT") return false;
  if (params.underlyingType?.toUpperCase() === "FX") return false;

  // If we have Binance's live reference price, check whether Binance already quotes
  // in the local currency (e.g. HK1810USDT ~ 27.65 vs 1810.HK ~ 27.70 HKD).
  if (params.refPrice && Number.isFinite(params.refPrice) && params.refPrice > 0) {
    if (params.yahooPrice > 0 && isPriceCompatible(params.yahooPrice, params.refPrice)) {
      return false;
    }
    return true;
  }

  // Without a reference price, convert non-USD stocks unless the symbol uses a
  // local-currency prefix convention like HK1810 / HK0700 / HK1888.
  return !isLocalCurrencyPrefixedSymbol(params.baseSymbol);
}

function roundPrice(val: number): number {
  if (val >= 100) return Number(val.toFixed(4));
  if (val >= 1) return Number(val.toFixed(4));
  if (val >= 0.01) return Number(val.toFixed(6));
  return Number(val.toFixed(8));
}

function lookupFxRate(
  fxPoints: FxRatePoint[],
  targetTimeSec: number,
  fallbackRate: number,
): number {
  if (fxPoints.length === 0) return fallbackRate;
  if (targetTimeSec <= fxPoints[0].time) return fxPoints[0].rate;
  const lastIdx = fxPoints.length - 1;
  if (targetTimeSec >= fxPoints[lastIdx].time) return fxPoints[lastIdx].rate;

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = fxPoints[mid].time;
    if (t === targetTimeSec) return fxPoints[mid].rate;
    if (t < targetTimeSec) lo = mid + 1;
    else hi = mid - 1;
  }

  // `hi` is the latest FX point <= targetTimeSec
  return hi >= 0 ? fxPoints[hi].rate : fallbackRate;
}

/**
 * Converts OHLC candles from a foreign currency (e.g. HKD, KRW, CNY, JPY) into USD
 * by dividing each bar by the matching historical USD/<CURRENCY> FX rate.
 */
export function convertCandlesWithFx(
  candles: CandleData[],
  fxPoints: FxRatePoint[],
  fallbackRate: number,
): CandleData[] {
  const sortedFx = [...fxPoints]
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.rate) && p.rate > 0)
    .sort((a, b) => a.time - b.time);

  const safeFallback =
    Number.isFinite(fallbackRate) && fallbackRate > 0
      ? fallbackRate
      : sortedFx.length > 0
        ? sortedFx[sortedFx.length - 1].rate
        : 0;

  if (safeFallback <= 0) return candles;

  return candles.map((c) => {
    const rate = lookupFxRate(sortedFx, c.time, safeFallback);
    return {
      ...c,
      open: roundPrice(c.open / rate),
      high: roundPrice(c.high / rate),
      low: roundPrice(c.low / rate),
      close: roundPrice(c.close / rate),
    };
  });
}

/**
 * Resamples finer Yahoo candles (e.g. 1h) into coarser UTC-aligned buckets (e.g. 2h, 4h)
 * so historical candlesticks match Binance's interval spacing.
 */
export function resampleCandles(candles: CandleData[], targetInterval: Timeframe): CandleData[] {
  const bucketSec = targetInterval === "2h" ? 7200 : targetInterval === "4h" ? 14400 : 0;

  if (bucketSec === 0 || candles.length === 0) {
    return candles;
  }

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const buckets: CandleData[] = [];

  for (const c of sorted) {
    const bucketTime = Math.floor(c.time / bucketSec) * bucketSec;
    const prev = buckets[buckets.length - 1];
    if (prev && prev.time === bucketTime) {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume = Number((prev.volume + c.volume).toFixed(2));
    } else {
      buckets.push({
        ...c,
        time: bucketTime,
      });
    }
  }

  return buckets;
}

/**
 * Returns true only for plain US-listed equity/ETF tickers suitable for Nasdaq
 * corporate events enrichment (prevents polluting HK/KR/commodity charts with
 * unrelated US tickers that share the same symbol).
 */
export function isUsEquityYahooSymbol(yahooSymbol: string, currency?: string): boolean {
  const clean = yahooSymbol.trim().toUpperCase();
  if (!clean) return false;
  if (clean.includes(".") || clean.includes("=") || clean.startsWith("^")) return false;
  if (currency && currency.trim().toUpperCase() !== "USD") return false;
  return /^[A-Z][A-Z0-9-]{0,5}$/.test(clean);
}
