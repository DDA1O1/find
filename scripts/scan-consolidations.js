// scripts/scan-consolidations.js
// Scans US stocks/ETFs for Volatility Contraction Pattern (VCP)
// Rules:
// 1. Base range: 1.0% < Total Base Range <= 7.0% across 3 to 7 closed weeks.
// 2. Successive Volatility Contraction:
//    - Latest completed weekly candle range < 3.0%.
//    - Latest completed weekly candle range <= previous weekly candle range.
// 3. Successive Volume Dry-Up (Supply Depletion):
//    - Latest completed weekly volume < previous weekly volume.
// 4. Strict Quality:
//    - Exclude SPACs, blank-check shells, acquisition corps, co-ops, merger shells, preferred shares.
//    - Minimum continuous daily share volume >= 500,000 shares/day.
//    - Closed weekly candles only (strictly ignores current in-progress week).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STOCKS_FILE = path.resolve(__dirname, "../public/stocks.json");
const CONSOLIDATIONS_FILE = path.resolve(__dirname, "../public/consolidations.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const JUNK_PATTERNS = [
  /\bacquisition\b/i,
  /\bacquisitions\b/i,
  /\bco-?op\b/i,
  /\bco-?ops\b/i,
  /\bspacs?\b/i,
  /\bpacs?\b/i,
  /\bblank\s+check\b/i,
  /\bmerger\b/i,
  /\bshell\b/i,
  /\bpreferred\b/i,
  /\bdebentures?\b/i,
];

function isJunkOrShell(name, symbol) {
  const s = (symbol || "").toLowerCase();
  const n = (name || "").toLowerCase();

  // Warrants, units, rights
  if (
    s.endsWith("-w") ||
    s.endsWith(".w") ||
    s.endsWith("-u") ||
    s.endsWith(".u") ||
    s.endsWith("-r") ||
    s.endsWith(".r") ||
    s.endsWith("ws")
  ) {
    return true;
  }

  const combined = `${n} ${s}`;
  return JUNK_PATTERNS.some((pattern) => pattern.test(combined));
}

function evaluateVCP(candles) {
  const now = new Date();
  const dayOfWeek = (now.getUTCDay() + 6) % 7; // Mon=0, Sun=6
  const currentWeekMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek),
  );
  const currentWeekMondayTs = Math.floor(currentWeekMonday.getTime() / 1000);

  // Closed weekly candles only (strictly before current developing week's Monday)
  const closed = candles.filter((c) => c.time < currentWeekMondayTs && c.open > 0 && c.close > 0);
  if (closed.length < 5) return null;

  const N = closed.length;

  // 1. Base range <= 7.0% and > 1.0% (over last 3 to 7 weeks)
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = N - 3; i < N; i++) {
    const c = closed[i];
    const top = Math.max(c.open, c.close);
    const bottom = Math.min(c.open, c.close);
    if (top > highest) highest = top;
    if (bottom < lowest) lowest = bottom;
  }

  const range3 = ((highest - lowest) / lowest) * 100;
  if (range3 <= 1.0 || range3 > 7.0) return null;

  let bestWeeks = 3;
  let bestRange = range3;
  let bestHigh = highest;
  let bestLow = lowest;

  // Try extending up to 7 closed weeks while range stays <= 7.0%
  for (let k = 4; k <= Math.min(7, N); k++) {
    const c = closed[N - k];
    const top = Math.max(c.open, c.close);
    const bottom = Math.min(c.open, c.close);
    const newHigh = Math.max(bestHigh, top);
    const newLow = Math.min(bestLow, bottom);
    const newRange = ((newHigh - newLow) / newLow) * 100;

    if (newRange > 1.0 && newRange <= 7.0) {
      bestWeeks = k;
      bestRange = newRange;
      bestHigh = newHigh;
      bestLow = newLow;
    } else {
      break;
    }
  }

  // 2. Latest completed weekly candle: range < 3.0%
  const lastCandle = closed[N - 1];
  const prevCandle = closed[N - 2];
  const lastRange =
    (Math.abs(lastCandle.close - lastCandle.open) / Math.min(lastCandle.open, lastCandle.close)) *
    100;
  if (lastRange >= 3.0) return null;

  // 3. Successive volatility contraction: latest weekly candle tighter than or equal to prior week
  const prevRange =
    (Math.abs(prevCandle.close - prevCandle.open) / Math.min(prevCandle.open, prevCandle.close)) *
    100;
  if (lastRange > prevRange) return null;

  // 4. Successive volume dry-up: latest volume lower than prior week
  if (lastCandle.volume >= prevCandle.volume) return null;

  const avg10Vol =
    closed.slice(-10).reduce((sum, c) => sum + c.volume, 0) / Math.min(10, closed.length);
  const volDryRatio = Number(((lastCandle.volume / (avg10Vol || 1)) * 100).toFixed(0));

  return {
    weeks: bestWeeks,
    range: Number(bestRange.toFixed(1)),
    lastWeekRange: Number(lastRange.toFixed(1)),
    prevWeekRange: Number(prevRange.toFixed(1)),
    volDryRatio,
    highestBody: Number(bestHigh.toFixed(2)),
    lowestBody: Number(bestLow.toFixed(2)),
  };
}

async function fetchWeeklyCandles(symbol) {
  try {
    const cleanSym = symbol.replace("/", "-");
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=6mo`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const times = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const opens = q.open || [];
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const volumes = q.volume || [];

    const candles = [];
    for (let i = 0; i < times.length; i++) {
      if (opens[i] != null && closes[i] != null) {
        candles.push({
          time: times[i],
          open: opens[i],
          close: closes[i],
          high: highs[i] ?? Math.max(opens[i], closes[i]),
          low: lows[i] ?? Math.min(opens[i], closes[i]),
          volume: volumes[i] || 0,
        });
      }
    }
    return candles;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Reading stocks catalog from ${STOCKS_FILE}...`);
  const rawStocks = JSON.parse(fs.readFileSync(STOCKS_FILE, "utf-8"));

  // Enforce cleanliness: no shells/SPACs, minimum 500K daily volume
  const filteredStocks = rawStocks.filter((stock) => {
    if (isJunkOrShell(stock.n, stock.s)) return false;
    if ((stock.v || 0) < 500000) return false;
    return true;
  });

  console.log(`Scanning ${filteredStocks.length} clean stocks for strict VCP patterns...`);

  const concurrency = 40;
  const qualifyingList = [];
  let processed = 0;

  for (let i = 0; i < filteredStocks.length; i += concurrency) {
    const chunk = filteredStocks.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (stock) => {
        const candles = await fetchWeeklyCandles(stock.s);
        if (candles && candles.length >= 5) {
          const vcp = evaluateVCP(candles);
          if (vcp) {
            stock.cons = {
              w: vcp.weeks,
              r: vcp.range,
              lwr: vcp.lastWeekRange,
              pwr: vcp.prevWeekRange,
              vdr: vcp.volDryRatio,
              h: vcp.highestBody,
              l: vcp.lowestBody,
            };
            qualifyingList.push({
              symbol: stock.s,
              name: stock.n,
              type: stock.t,
              price: stock.p,
              change24h: stock.c,
              volume24h: stock.v,
              weeks: vcp.weeks,
              rangePercent: vcp.range,
              lastWeekRange: vcp.lastWeekRange,
              prevWeekRange: vcp.prevWeekRange,
              volDryRatio: vcp.volDryRatio,
              highestBody: vcp.highestBody,
              lowestBody: vcp.lowestBody,
            });
          } else {
            delete stock.cons;
          }
        } else {
          delete stock.cons;
        }
      }),
    );

    processed += chunk.length;
    if (processed % 500 === 0 || processed >= filteredStocks.length) {
      console.log(
        `Scanned ${processed}/${filteredStocks.length} stocks (found ${qualifyingList.length} VCP setups so far)...`,
      );
    }
  }

  // Sort qualifying VCP setups: tightest final coil first, then longest base
  qualifyingList.sort((a, b) => a.lastWeekRange - b.lastWeekRange || b.weeks - a.weeks);

  // Save enriched stocks.json
  fs.writeFileSync(STOCKS_FILE, JSON.stringify(filteredStocks, null, 2), "utf-8");
  console.log(`Saved clean catalog to ${STOCKS_FILE}`);

  // Save dedicated consolidations.json
  fs.writeFileSync(CONSOLIDATIONS_FILE, JSON.stringify(qualifyingList, null, 2), "utf-8");
  console.log(`Saved ${qualifyingList.length} strict VCP setups to ${CONSOLIDATIONS_FILE}`);

  console.log("\nTop 10 Strict VCP Setups:");
  console.log(
    qualifyingList
      .slice(0, 10)
      .map(
        (x) =>
          `  ${x.symbol} (${x.name}): $${x.price} | ${x.weeks}W base (${x.rangePercent}%) | Last Wk: ${x.lastWeekRange}% (prev: ${x.prevWeekRange}%) | Vol: ${x.volDryRatio}% of 10w avg`,
      )
      .join("\n"),
  );
}

main().catch((err) => {
  console.error("Fatal error in scan-consolidations:", err);
  process.exit(1);
});
