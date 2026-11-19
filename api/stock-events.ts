import type { IncomingMessage, ServerResponse } from "node:http";
import type { CorporateEventsData, StockDividendEvent, StockSplitEvent } from "../src/types";
import {
  parseDollarAmount,
  parseSplitRatio,
  parseUsDateToUtcSeconds,
} from "../src/api/corporateEventParsers";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const NASDAQ_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

const REQUEST_TIMEOUT_MS = 4500;
const SPLITS_CACHE_TTL_MS = 15 * 60 * 1000;

interface NasdaqDividendRow {
  exOrEffDate?: string;
  type?: string;
  amount?: string;
  declarationDate?: string;
  recordDate?: string;
  paymentDate?: string;
  currency?: string;
}

interface NasdaqDividendsResponse {
  status?: { rCode?: number };
  data?: {
    exDividendDate?: string;
    dividendPaymentDate?: string;
    yield?: string;
    annualizedDividend?: string | number;
    dividends?: {
      rows?: NasdaqDividendRow[];
    };
  } | null;
}

interface NasdaqSplitCalendarRow {
  symbol?: string;
  name?: string;
  ratio?: string;
  executionDate?: string;
}

interface NasdaqSplitsResponse {
  data?: {
    rows?: NasdaqSplitCalendarRow[];
  } | null;
}

let cachedSplitRows: { rows: NasdaqSplitCalendarRow[]; fetchedAt: number } | null = null;
let inFlightSplitsFetch: Promise<NasdaqSplitCalendarRow[]> | null = null;

function getTodayUtcMidnightSec(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function cleanOptionalString(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return undefined;
  return trimmed;
}

async function fetchNasdaqDividends(symbol: string): Promise<{
  dividends: StockDividendEvent[];
  annualizedDividend?: number;
  dividendYield?: string;
}> {
  const assetClasses = ["stocks", "etf"] as const;
  let payloadData: NonNullable<NasdaqDividendsResponse["data"]> | null = null;

  for (const assetClass of assetClasses) {
    try {
      const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/dividends?assetclass=${assetClass}`;
      const res = await fetch(url, {
        headers: NASDAQ_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as NasdaqDividendsResponse;
      if (json?.status?.rCode === 400 || !json?.data) continue;
      payloadData = json.data;
      break;
    } catch {
      // Try next asset class or fail gracefully
    }
  }

  if (!payloadData) {
    return { dividends: [] };
  }

  const annualizedDividend = parseDollarAmount(payloadData.annualizedDividend) ?? undefined;
  const dividendYield = cleanOptionalString(payloadData.yield);
  const todayUtcMidnightSec = getTodayUtcMidnightSec();
  const rows = payloadData.dividends?.rows ?? [];

  const dividends: StockDividendEvent[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const dateSec = parseUsDateToUtcSeconds(row.exOrEffDate);
    const amount = parseDollarAmount(row.amount);
    if (dateSec === null || amount === null) continue;

    const dedupeKey = `${dateSec}-${amount}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    dividends.push({
      id: `div-${dateSec}-${amount}`,
      type: "dividend",
      date: dateSec,
      amount,
      currency: cleanOptionalString(row.currency) || "USD",
      isUpcoming: dateSec >= todayUtcMidnightSec,
      paymentDate: cleanOptionalString(row.paymentDate),
      declarationDate: cleanOptionalString(row.declarationDate),
      annualizedRate: annualizedDividend,
      yieldPercent: dividendYield,
    });
  }

  dividends.sort((a, b) => a.date - b.date);

  return {
    dividends,
    annualizedDividend,
    dividendYield,
  };
}

async function fetchNasdaqSplitsCalendar(): Promise<NasdaqSplitCalendarRow[]> {
  if (cachedSplitRows && Date.now() - cachedSplitRows.fetchedAt < SPLITS_CACHE_TTL_MS) {
    return cachedSplitRows.rows;
  }

  if (inFlightSplitsFetch) {
    return inFlightSplitsFetch;
  }

  inFlightSplitsFetch = (async () => {
    try {
      const res = await fetch("https://api.nasdaq.com/api/calendar/splits", {
        headers: NASDAQ_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        return cachedSplitRows?.rows ?? [];
      }
      const json = (await res.json()) as NasdaqSplitsResponse;
      const rows = Array.isArray(json?.data?.rows) ? json.data.rows : [];
      cachedSplitRows = { rows, fetchedAt: Date.now() };
      return rows;
    } catch {
      return cachedSplitRows?.rows ?? [];
    } finally {
      inFlightSplitsFetch = null;
    }
  })();

  return inFlightSplitsFetch;
}

async function fetchUpcomingSplitsForSymbol(symbol: string): Promise<StockSplitEvent[]> {
  const rows = await fetchNasdaqSplitsCalendar();
  const todayUtcMidnightSec = getTodayUtcMidnightSec();
  const splits: StockSplitEvent[] = [];

  for (const row of rows) {
    if (row.symbol?.trim().toUpperCase() !== symbol) continue;
    const dateSec = parseUsDateToUtcSeconds(row.executionDate);
    const parsedRatio = parseSplitRatio(row.ratio);
    if (dateSec === null || !parsedRatio) continue;

    splits.push({
      id: `split-${dateSec}-${parsedRatio.splitRatio}`,
      type: "split",
      date: dateSec,
      numerator: parsedRatio.numerator,
      denominator: parsedRatio.denominator,
      splitRatio: parsedRatio.splitRatio,
      isUpcoming: dateSec >= todayUtcMidnightSec,
    });
  }

  splits.sort((a, b) => a.date - b.date);
  return splits;
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const symbol = (req.query?.symbol || urlObj.searchParams.get("symbol") || "")
    .trim()
    .toUpperCase();

  if (!symbol) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing required symbol query parameter" }));
    return;
  }

  const [divResult, splitsResult] = await Promise.allSettled([
    fetchNasdaqDividends(symbol),
    fetchUpcomingSplitsForSymbol(symbol),
  ]);

  const divData =
    divResult.status === "fulfilled"
      ? divResult.value
      : { dividends: [], annualizedDividend: undefined, dividendYield: undefined };
  const splits = splitsResult.status === "fulfilled" ? splitsResult.value : [];

  const payload: CorporateEventsData = {
    symbol,
    currency: divData.dividends[0]?.currency || "USD",
    splits,
    dividends: divData.dividends,
    annualizedDividend: divData.annualizedDividend,
    dividendYield: divData.dividendYield,
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900");
  res.end(JSON.stringify(payload));
}
