// scripts/build-daily-stocks.js
// Filters US stocks and ETFs for Daily Dollar Volume > $1,000,000 (Price * Volume > $1M)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, "../public/stocks.json");

const POPULAR_ETFS = [
  { s: "SPY", n: "SPDR S&P 500 ETF Trust", t: "ETF", p: 779.09, c: 0.66, v: 45000000 },
  { s: "QQQ", n: "Invesco QQQ Trust (Nasdaq 100)", t: "ETF", p: 759.66, c: 0.48, v: 38000000 },
  { s: "IWM", n: "iShares Russell 2000 ETF", t: "ETF", p: 281.34, c: -0.81, v: 28000000 },
  { s: "DIA", n: "SPDR Dow Jones Industrial Average ETF", t: "ETF", p: 514.56, c: 0.5, v: 4000000 },
  { s: "VOO", n: "Vanguard S&P 500 ETF", t: "ETF", p: 716.2, c: 0.64, v: 5500000 },
  { s: "SOXX", n: "iShares Semiconductor ETF", t: "ETF", p: 312.45, c: 1.15, v: 6200000 },
  { s: "SMH", n: "VanEck Semiconductor ETF", t: "ETF", p: 345.1, c: 1.25, v: 7500000 },
  { s: "TLT", n: "iShares 20+ Year Treasury Bond ETF", t: "ETF", p: 89.4, c: -0.22, v: 22000000 },
  { s: "XLF", n: "Financial Select Sector SPDR Fund", t: "ETF", p: 52.8, c: 0.35, v: 35000000 },
  { s: "XLK", n: "Technology Select Sector SPDR Fund", t: "ETF", p: 268.1, c: 0.72, v: 12000000 },
  { s: "XLE", n: "Energy Select Sector SPDR Fund", t: "ETF", p: 91.3, c: -0.45, v: 16000000 },
  { s: "XBI", n: "SPDR S&P Biotech ETF", t: "ETF", p: 104.5, c: 1.85, v: 9000000 },
  { s: "ARKK", n: "ARK Innovation ETF", t: "ETF", p: 68.2, c: 2.1, v: 15000000 },
  { s: "TQQQ", n: "ProShares UltraPro QQQ (3x)", t: "ETF", p: 105.4, c: 1.45, v: 55000000 },
  { s: "SQQQ", n: "ProShares UltraPro Short QQQ (-3x)", t: "ETF", p: 6.85, c: -1.42, v: 80000000 },
  { s: "SOXL", n: "Direxion Daily Semiconductor Bull 3X", t: "ETF", p: 48.9, c: 3.4, v: 65000000 },
  {
    s: "SOXS",
    n: "Direxion Daily Semiconductor Bear 3X",
    t: "ETF",
    p: 14.2,
    c: -3.35,
    v: 45000000,
  },
  { s: "NVDA", n: "NVIDIA Corporation", t: "STOCK", p: 188.5, c: 1.2, v: 60000000 },
  { s: "AAPL", n: "Apple Inc.", t: "STOCK", p: 333.63, c: 0.32, v: 32000000 },
  { s: "MSFT", n: "Microsoft Corporation", t: "STOCK", p: 512.4, c: 0.85, v: 20000000 },
  { s: "AMZN", n: "Amazon.com, Inc.", t: "STOCK", p: 245.8, c: 0.45, v: 28000000 },
  { s: "TSLA", n: "Tesla, Inc.", t: "STOCK", p: 420.5, c: -1.15, v: 45000000 },
  { s: "META", n: "Meta Platforms, Inc.", t: "STOCK", p: 742.1, c: 0.9, v: 14000000 },
  { s: "GOOGL", n: "Alphabet Inc. Class A", t: "STOCK", p: 215.3, c: 0.6, v: 18000000 },
];

async function main() {
  console.log("Fetching official NASDAQ master screener data...");
  const res = await fetch(
    "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch NASDAQ screener: HTTP ${res.status}`);
  }

  const json = await res.json();
  const rows = json.data?.rows || [];
  console.log(`Downloaded ${rows.length} records from NASDAQ screener.`);

  const map = new Map();

  // Add premier ETFs first
  for (const etf of POPULAR_ETFS) {
    map.set(etf.s, etf);
  }

  // Parse each row and apply strict Daily Dollar Volume >= $1,000,000 filter
  let qualifyingCount = 0;
  for (const row of rows) {
    const rawSym = (row.symbol || "").trim().toUpperCase();
    if (!rawSym) continue;

    // Filter out warrants, units, test symbols, rights
    if (
      rawSym.includes("^") ||
      rawSym.includes("+") ||
      rawSym.includes("=") ||
      rawSym.endsWith(".W") ||
      rawSym.endsWith(".U") ||
      rawSym.endsWith(".R") ||
      (rawSym.endsWith("W") && rawSym.length > 4) ||
      rawSym.endsWith("WS")
    ) {
      continue;
    }

    const cleanSymbol = rawSym.replace("/", "-");
    const price = parseFloat((row.lastsale || "").replace(/[^0-9.]/g, "")) || 0;
    const vol = parseInt((row.volume || "0").replace(/[^0-9]/g, ""), 10) || 0;
    const dollarVol = price * vol;

    // Strict cutoff: Daily Volume in Dollar Terms >= $1,000,000
    if (dollarVol >= 1000000 && price > 0) {
      qualifyingCount++;
      const change = parseFloat((row.pctchange || "0").replace(/[^0-9.-]/g, "")) || 0;

      // Clean name
      let name = (row.name || "")
        .replace(/\s+(Common Stock|Class [A-Z]|Ordinary Shares|Depositary Shares).*/i, "")
        .trim();
      if (!name) name = cleanSymbol;

      const isEtf =
        name.toUpperCase().includes("ETF") ||
        name.toUpperCase().includes("TRUST") ||
        name.toUpperCase().includes("FUND");

      map.set(cleanSymbol, {
        s: cleanSymbol,
        n: name,
        t: isEtf ? "ETF" : "STOCK",
        p: Number(price.toFixed(2)),
        c: Number(change.toFixed(2)),
        v: vol,
      });
    }
  }

  console.log(`Found ${qualifyingCount} stocks meeting Daily Dollar Volume >= $1,000,000.`);

  const list = Array.from(map.values());
  // Sort descending by daily dollar volume (v * p)
  list.sort((a, b) => b.v * b.p - a.v * a.p);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(list, null, 2), "utf-8");
  console.log(`Saved ${list.length} stocks to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Error building daily stocks:", err);
  process.exit(1);
});
