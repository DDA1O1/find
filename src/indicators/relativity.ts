import { getTradFiIndustry, isTradFiFuturesSymbol, normalizeCandleTime } from "../api/tradifiPairs";
import type { CandleData } from "../types";

export const DEFAULT_RELATIVITY_WINDOW = 100;
export const MIN_RELATIVITY_BARS = 10;

export interface BenchmarkChoice {
  symbol: string; // e.g. "NVDAUSDT"
  baseAsset: string; // e.g. "NVDA"
  reason: string; // e.g. "Sector Leader", "Underlying", "Semis ETF"
}

export type CorrelationTone = "coupled" | "moderate" | "independent" | "inverse" | "strong-inverse";

export interface CorrelationBadge {
  label: string;
  tone: CorrelationTone;
}

export interface RelativityPoint {
  time: number; // UTC midnight timestamp in seconds
  correlation: number; // -1 to +1
  beta: number; // Cov(asset, bench) / Var(bench)
  rSquared: number; // 0 to 1
  sampleSize: number; // Actual number of daily returns used (up to 100)
}

export interface RelativitySeriesResult {
  assetSymbol: string;
  benchmarkSymbol: string;
  benchmarkReason: string;
  points: RelativityPoint[];
  latest: RelativityPoint | null;
}

/**
 * Tier 0: Exact underlying driver overrides for ETFs, leveraged/inverse products,
 * and commodity/metal derivatives.
 */
const EXACT_UNDERLYING_MAP: Record<string, { symbol: string; reason: string }> = {
  // Gold / Silver / Metals
  GDX: { symbol: "XAUUSDT", reason: "Underlying Gold" },
  PAXG: { symbol: "XAUUSDT", reason: "Underlying Gold" },
  XAUT: { symbol: "XAUUSDT", reason: "Underlying Gold" },
  XAG: { symbol: "XAUUSDT", reason: "Gold Benchmark" },
  XPT: { symbol: "XAUUSDT", reason: "Gold Benchmark" },
  XPD: { symbol: "XAUUSDT", reason: "Gold Benchmark" },
  COPPER: { symbol: "XAUUSDT", reason: "Metals Leader" },

  // Energy / Oil
  BZ: { symbol: "CLUSDT", reason: "WTI Crude Benchmark" },
  XLE: { symbol: "CLUSDT", reason: "Underlying Crude Oil" },
  NATGAS: { symbol: "CLUSDT", reason: "Energy Benchmark" },

  // Leveraged / Inverse / Direct-Proxy ETFs
  NVDL: { symbol: "NVDAUSDT", reason: "Underlying 1x" },
  AMDL: { symbol: "AMDUSDT", reason: "Underlying 1x" },
  TSLL: { symbol: "TSLAUSDT", reason: "Underlying 1x" },
  MUU: { symbol: "MUUSDT", reason: "Underlying 1x" },
  MW: { symbol: "MUUSDT", reason: "Underlying 1x" },
  MSTU: { symbol: "MSTRUSDT", reason: "Underlying 1x" },
  CSOPSAMSUNG2L: { symbol: "SAMSUNGUSDT", reason: "Underlying 1x" },
  CSOPSKHYNIX2L: { symbol: "SKHYNIXUSDT", reason: "Underlying 1x" },
  SKUU: { symbol: "SKHYNIXUSDT", reason: "Underlying 1x" },
  SKDD: { symbol: "SKHYNIXUSDT", reason: "Underlying 1x" },
  SKHY: { symbol: "SKHYNIXUSDT", reason: "Underlying 1x" },
  TQQQ: { symbol: "QQQUSDT", reason: "Underlying 1x" },
  SQQQ: { symbol: "QQQUSDT", reason: "Underlying 1x" },
  SOXL: { symbol: "SOXXUSDT", reason: "Underlying 1x" },
  SOXS: { symbol: "SOXXUSDT", reason: "Underlying 1x" },
  TZA: { symbol: "IWMUSDT", reason: "Underlying 1x" },
  TMF: { symbol: "TLTUSDT", reason: "Underlying 1x" },
  TBT: { symbol: "TLTUSDT", reason: "Underlying 1x" },
  KORU: { symbol: "EWYUSDT", reason: "Underlying 1x" },
  UVXY: { symbol: "SPYUSDT", reason: "Broad Market" },
  SNXX: { symbol: "SNDKUSDT", reason: "Underlying 1x" },
  MVLL: { symbol: "MRVLUSDT", reason: "Underlying 1x" },
  INTW: { symbol: "INTCUSDT", reason: "Underlying 1x" },
  LYTE: { symbol: "LITEUSDT", reason: "Underlying 1x" },
  DRAM: { symbol: "MUUSDT", reason: "Memory Leader" },
  RAM: { symbol: "MUUSDT", reason: "Memory Leader" },
  IBIT: { symbol: "BTCUSDT", reason: "Underlying BTC" },
  BITO: { symbol: "BTCUSDT", reason: "Underlying BTC" },
};

/**
 * Tier 1: Deterministic sector leaders chosen by true market capitalization
 * (never Binance 24h futures volume).
 */
const SECTOR_LEADER_MAP: Record<string, { symbol: string; reason: string }> = {
  SEMI: { symbol: "NVDAUSDT", reason: "Semi Leader" },
  AI: { symbol: "NVDAUSDT", reason: "AI Leader" },
  "DATA CENTER": { symbol: "NVDAUSDT", reason: "AI Infra Leader" },
  NETWORKS: { symbol: "NVDAUSDT", reason: "AI Infra Leader" },
  OPTICS: { symbol: "NVDAUSDT", reason: "AI Infra Leader" },
  QUANTUM: { symbol: "NVDAUSDT", reason: "Compute Leader" },
  EV: { symbol: "TSLAUSDT", reason: "EV Leader" },
  AUTO: { symbol: "TSLAUSDT", reason: "Auto Leader" },
  MOBILITY: { symbol: "TSLAUSDT", reason: "Mobility Leader" },
  TECH: { symbol: "AAPLUSDT", reason: "Tech Leader" },
  CLOUD: { symbol: "AMZNUSDT", reason: "Cloud Leader" },
  ECOMM: { symbol: "AMZNUSDT", reason: "E-Comm Leader" },
  CYBER: { symbol: "PANWUSDT", reason: "Cyber Leader" },
  FINANCE: { symbol: "JPMUSDT", reason: "Finance Leader" },
  FINTECH: { symbol: "VUSDT", reason: "Fintech Leader" },
  HEALTH: { symbol: "LLYUSDT", reason: "Health Leader" },
  RETAIL: { symbol: "WMTUSDT", reason: "Retail Leader" },
  CONSUMER: { symbol: "PGUSDT", reason: "Consumer Leader" },
  MEDIA: { symbol: "NFLXUSDT", reason: "Media Leader" },
  GAMING: { symbol: "NFLXUSDT", reason: "Media Leader" },
  TRAVEL: { symbol: "BKNGUSDT", reason: "Travel Leader" },
  INDUSTRIAL: { symbol: "GEUSDT", reason: "Industrial Leader" },
  DEFENSE: { symbol: "GEUSDT", reason: "Aerospace Leader" },
  AEROSPACE: { symbol: "GEUSDT", reason: "Aerospace Leader" },
  SATELLITE: { symbol: "GEUSDT", reason: "Aerospace Leader" },
  DRONES: { symbol: "GEUSDT", reason: "Aerospace Leader" },
  ROBOTICS: { symbol: "TSLAUSDT", reason: "Robotics Leader" },
  MATERIALS: { symbol: "LINUSDT", reason: "Materials Leader" },
  SHIPPING: { symbol: "SPYUSDT", reason: "Broad Market" },
  METALS: { symbol: "XAUUSDT", reason: "Gold Benchmark" },
  PETROLEUM: { symbol: "CLUSDT", reason: "Crude Oil Driver" },
  ENERGY: { symbol: "NEEUSDT", reason: "Energy Leader" },
  CRYPTO: { symbol: "BTCUSDT", reason: "Bitcoin Driver" },
  "CRYPTO ETF": { symbol: "BTCUSDT", reason: "Bitcoin Driver" },
  ETF: { symbol: "SPYUSDT", reason: "S&P 500" },
  "2X ETF": { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  "3X ETF": { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  "2X INVERSE": { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  "3X INVERSE": { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  "INVERSE ETF": { symbol: "SPYUSDT", reason: "S&P 500" },
  VOLATILITY: { symbol: "SPYUSDT", reason: "S&P 500" },
  FOREX: { symbol: "SPYUSDT", reason: "Macro Benchmark" },
  TELECOM: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
};

/**
 * Tier 2: Sector ETF or Macro Benchmark fallback when inspecting a Sector Leader
 * itself (or broad index ETFs / BTC / Gold).
 */
const LEADER_FALLBACK_MAP: Record<string, { symbol: string; reason: string }> = {
  NVDA: { symbol: "SMHUSDT", reason: "Semis ETF" },
  SMH: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  SOXX: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  TSLA: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  AAPL: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  AMZN: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  PANW: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  NFLX: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  JPM: { symbol: "XLFUSDT", reason: "Financials ETF" },
  V: { symbol: "XLFUSDT", reason: "Financials ETF" },
  LLY: { symbol: "SPYUSDT", reason: "S&P 500" },
  WMT: { symbol: "SPYUSDT", reason: "S&P 500" },
  PG: { symbol: "SPYUSDT", reason: "S&P 500" },
  BKNG: { symbol: "SPYUSDT", reason: "S&P 500" },
  GE: { symbol: "SPYUSDT", reason: "S&P 500" },
  LIN: { symbol: "SPYUSDT", reason: "S&P 500" },
  NEE: { symbol: "SPYUSDT", reason: "S&P 500" },
  XAU: { symbol: "SPYUSDT", reason: "Macro Benchmark" },
  CL: { symbol: "XLEUSDT", reason: "Energy ETF" },
  BTC: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  QQQ: { symbol: "SPYUSDT", reason: "S&P 500" },
  SPY: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  VOO: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  XLK: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
  ARKK: { symbol: "QQQUSDT", reason: "Nasdaq 100" },
};

const SECTOR_ETF_BY_INDUSTRY: Record<string, { symbol: string; reason: string }> = {
  SEMI: { symbol: "SMHUSDT", reason: "Semis ETF" },
  TECH: { symbol: "XLKUSDT", reason: "Tech ETF" },
  CLOUD: { symbol: "IGVUSDT", reason: "Software ETF" },
  AI: { symbol: "SMHUSDT", reason: "Semis ETF" },
  FINANCE: { symbol: "XLFUSDT", reason: "Financials ETF" },
  FINTECH: { symbol: "XLFUSDT", reason: "Financials ETF" },
  HEALTH: { symbol: "XBIUSDT", reason: "Biotech ETF" },
  PETROLEUM: { symbol: "XLEUSDT", reason: "Energy ETF" },
  ENERGY: { symbol: "XLEUSDT", reason: "Energy ETF" },
  METALS: { symbol: "XAUUSDT", reason: "Gold Benchmark" },
};

function toBaseAsset(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "");
}

/**
 * Resolves the default 2-tier benchmark for any symbol:
 * - Tier 0: Exact underlying asset (for leveraged ETFs, GDX -> XAU, IBIT -> BTC, etc.)
 * - Tier 1: Largest true market-cap sector leader (e.g. SEMI -> NVDA, EV -> TSLA)
 * - Tier 2: Sector ETF or Macro Benchmark when the active symbol IS the sector leader
 * - Crypto perpetuals default to BTCUSDT (and BTCUSDT defaults to QQQUSDT).
 */
export function resolveDefaultBenchmark(symbol: string): BenchmarkChoice {
  const upper = symbol.trim().toUpperCase();
  const base = toBaseAsset(upper);

  // Tier 0: Exact underlying override
  const exact = EXACT_UNDERLYING_MAP[base];
  if (exact && exact.symbol !== upper) {
    return {
      symbol: exact.symbol,
      baseAsset: toBaseAsset(exact.symbol),
      reason: exact.reason,
    };
  }

  // Tier 2: Active symbol is itself a leader / major benchmark -> step up to Sector ETF or Macro
  const leaderFallback = LEADER_FALLBACK_MAP[base];
  if (leaderFallback && leaderFallback.symbol !== upper) {
    return {
      symbol: leaderFallback.symbol,
      baseAsset: toBaseAsset(leaderFallback.symbol),
      reason: leaderFallback.reason,
    };
  }

  // Tier 1: Sector leader by true market cap (for TradFi equities)
  const isTradFi = !upper.endsWith("USDT") || isTradFiFuturesSymbol(upper);
  if (isTradFi) {
    const industry = getTradFiIndustry(base);
    if (industry) {
      const sectorLeader = SECTOR_LEADER_MAP[industry];
      if (sectorLeader && sectorLeader.symbol !== upper) {
        return {
          symbol: sectorLeader.symbol,
          baseAsset: toBaseAsset(sectorLeader.symbol),
          reason: sectorLeader.reason,
        };
      }
    }

    // Generic TradFi fallback -> S&P 500
    const fallback = upper === "SPYUSDT" ? "QQQUSDT" : "SPYUSDT";
    return {
      symbol: fallback,
      baseAsset: toBaseAsset(fallback),
      reason: fallback === "SPYUSDT" ? "S&P 500" : "Nasdaq 100",
    };
  }

  // Crypto perpetual fallback -> Bitcoin
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    reason: "Crypto Leader",
  };
}

/**
 * Returns quick-switch benchmark presets for the clickable benchmark popover.
 */
export function getSuggestedBenchmarks(symbol: string): BenchmarkChoice[] {
  const upper = symbol.trim().toUpperCase();
  const base = toBaseAsset(upper);
  const defaultChoice = resolveDefaultBenchmark(upper);
  const industry = getTradFiIndustry(base);
  const isTradFi = !upper.endsWith("USDT") || isTradFiFuturesSymbol(upper);

  const raw: BenchmarkChoice[] = [defaultChoice];

  if (industry && SECTOR_ETF_BY_INDUSTRY[industry]) {
    const etf = SECTOR_ETF_BY_INDUSTRY[industry];
    raw.push({ symbol: etf.symbol, baseAsset: toBaseAsset(etf.symbol), reason: etf.reason });
  }

  if (isTradFi) {
    raw.push(
      { symbol: "QQQUSDT", baseAsset: "QQQ", reason: "Nasdaq 100" },
      { symbol: "SPYUSDT", baseAsset: "SPY", reason: "S&P 500" },
      { symbol: "XAUUSDT", baseAsset: "XAU", reason: "Gold" },
      { symbol: "BTCUSDT", baseAsset: "BTC", reason: "Bitcoin" },
    );
  } else {
    raw.push(
      { symbol: "BTCUSDT", baseAsset: "BTC", reason: "Crypto Leader" },
      { symbol: "ETHUSDT", baseAsset: "ETH", reason: "Ethereum" },
      { symbol: "SOLUSDT", baseAsset: "SOL", reason: "Solana" },
      { symbol: "QQQUSDT", baseAsset: "QQQ", reason: "Nasdaq 100" },
      { symbol: "SPYUSDT", baseAsset: "SPY", reason: "S&P 500" },
    );
  }

  const seen = new Set<string>([upper]);
  const deduped: BenchmarkChoice[] = [];
  for (const item of raw) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    deduped.push(item);
    if (deduped.length >= 5) break;
  }

  return deduped;
}

export function classifyCorrelation(r: number): CorrelationBadge {
  if (r >= 0.7) {
    return { label: "Coupled", tone: "coupled" };
  }
  if (r >= 0.4) {
    return { label: "Moderate", tone: "moderate" };
  }
  if (r > -0.4) {
    return { label: "Independent", tone: "independent" };
  }
  if (r > -0.7) {
    return { label: "Inverse", tone: "inverse" };
  }
  return { label: "Strong Inverse", tone: "strong-inverse" };
}

function buildDailyCloseMap(candles: CandleData[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of candles) {
    if (Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0) {
      const dayKey = normalizeCandleTime(c.time, "1d");
      map.set(dayKey, c.close);
    }
  }
  return map;
}

/**
 * Computes rolling institutional-grade 1D Correlation (Pearson r) and Beta (β)
 * using daily log returns strictly inner-joined on UTC calendar dates.
 *
 * - Uses an exact trailing `window` (default 100 daily return bars) once available.
 * - For early post-IPO dates with `MIN_RELATIVITY_BARS <= n < window`, computes
 *   over the available `n` bars and reports `sampleSize: n` transparently.
 */
export function calculateRollingRelativity(
  assetDailyCandles: CandleData[],
  benchmarkDailyCandles: CandleData[],
  window = DEFAULT_RELATIVITY_WINDOW,
): RelativityPoint[] {
  if (!assetDailyCandles.length || !benchmarkDailyCandles.length) return [];

  const assetMap = buildDailyCloseMap(assetDailyCandles);
  const benchMap = buildDailyCloseMap(benchmarkDailyCandles);

  // Strictly inner-join on shared UTC dates and sort ascending
  const sharedDates: number[] = [];
  for (const dayKey of assetMap.keys()) {
    if (benchMap.has(dayKey)) {
      sharedDates.push(dayKey);
    }
  }
  sharedDates.sort((a, b) => a - b);

  if (sharedDates.length <= MIN_RELATIVITY_BARS) {
    return [];
  }

  // Paired daily log returns: x = benchmark return, y = asset return
  const returnTimes: number[] = [];
  const xReturns: number[] = [];
  const yReturns: number[] = [];

  for (let i = 1; i < sharedDates.length; i++) {
    const prevDate = sharedDates[i - 1];
    const currDate = sharedDates[i];
    const aPrev = assetMap.get(prevDate)!;
    const aCurr = assetMap.get(currDate)!;
    const bPrev = benchMap.get(prevDate)!;
    const bCurr = benchMap.get(currDate)!;

    if (aPrev > 0 && aCurr > 0 && bPrev > 0 && bCurr > 0) {
      returnTimes.push(currDate);
      xReturns.push(Math.log(bCurr / bPrev));
      yReturns.push(Math.log(aCurr / aPrev));
    }
  }

  const totalReturns = returnTimes.length;
  if (totalReturns < MIN_RELATIVITY_BARS) {
    return [];
  }

  const targetWindow = Math.max(MIN_RELATIVITY_BARS, window);
  const points: RelativityPoint[] = [];

  for (let endIdx = MIN_RELATIVITY_BARS - 1; endIdx < totalReturns; endIdx++) {
    const startIdx = Math.max(0, endIdx - targetWindow + 1);
    const n = endIdx - startIdx + 1;

    let sumX = 0;
    let sumY = 0;
    for (let j = startIdx; j <= endIdx; j++) {
      sumX += xReturns[j];
      sumY += yReturns[j];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let j = startIdx; j <= endIdx; j++) {
      const dx = xReturns[j] - meanX;
      const dy = yReturns[j] - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    if (sxx <= 1e-18 || syy <= 1e-18) continue;

    const rawCorr = sxy / Math.sqrt(sxx * syy);
    const correlation = Math.max(-1, Math.min(1, rawCorr));
    const beta = sxy / sxx;

    if (!Number.isFinite(correlation) || !Number.isFinite(beta)) continue;

    points.push({
      time: returnTimes[endIdx],
      correlation,
      beta,
      rSquared: correlation * correlation,
      sampleSize: n,
    });
  }

  return points;
}

/**
 * Binary-searches the precomputed rolling 1D relativity series for the latest
 * point on or before the hovered candle's UTC calendar day.
 */
export function lookupRelativityAtTime(
  points: RelativityPoint[],
  timestampSec: number,
): RelativityPoint | null {
  if (points.length === 0) return null;
  const targetDay = normalizeCandleTime(timestampSec, "1d");

  if (targetDay < points[0].time) {
    return null;
  }

  const lastIdx = points.length - 1;
  if (targetDay >= points[lastIdx].time) {
    return points[lastIdx];
  }

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = points[mid].time;
    if (t === targetDay) return points[mid];
    if (t < targetDay) lo = mid + 1;
    else hi = mid - 1;
  }

  return hi >= 0 ? points[hi] : null;
}
