import type { IncomingMessage, ServerResponse } from "node:http";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function mapTimeframeToYahoo(tf: string): { interval: string; range: string } {
  switch (tf) {
    case "1m":
      return { interval: "1m", range: "5d" };
    case "3m":
    case "5m":
      return { interval: "5m", range: "1mo" };
    case "15m":
      return { interval: "15m", range: "1mo" };
    case "30m":
      return { interval: "30m", range: "1mo" };
    case "1h":
      return { interval: "1h", range: "3mo" };
    case "2h":
      return { interval: "1h", range: "6mo" };
    case "4h":
      return { interval: "1h", range: "1y" };
    case "1d":
      return { interval: "1d", range: "5y" };
    case "1w":
      return { interval: "1wk", range: "10y" };
    default:
      return { interval: "1d", range: "5y" };
  }
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse,
): Promise<void> {
  // Enable CORS for frontend requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const symbol = (req.query?.symbol || urlObj.searchParams.get("symbol") || "AAPL")
      .trim()
      .toUpperCase();
    const intervalParam = req.query?.interval || urlObj.searchParams.get("interval") || "1d";

    const { interval, range } = mapTimeframeToYahoo(intervalParam);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

    const yahooRes = await fetch(yahooUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!yahooRes.ok) {
      res.statusCode = yahooRes.status;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: `Yahoo Finance returned status ${yahooRes.status}`,
        }),
      );
      return;
    }

    const data = await yahooRes.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: data?.chart?.error?.description || `No chart data found for symbol ${symbol}`,
        }),
      );
      return;
    }

    const metaRaw = result.meta || {};
    const meta = {
      symbol: metaRaw.symbol || symbol,
      shortName: metaRaw.shortName || metaRaw.longName || symbol,
      regularMarketPrice: metaRaw.regularMarketPrice ?? 0,
      regularMarketChangePercent: metaRaw.regularMarketChangePercent ?? 0,
      regularMarketDayHigh: metaRaw.regularMarketDayHigh ?? 0,
      regularMarketDayLow: metaRaw.regularMarketDayLow ?? 0,
      regularMarketVolume: metaRaw.regularMarketVolume ?? 0,
      currency: metaRaw.currency || "USD",
      exchangeName: metaRaw.exchangeName || "US",
    };

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      const v = volumes[i] ?? 0;

      if (
        o != null &&
        h != null &&
        l != null &&
        c != null &&
        !isNaN(o) &&
        !isNaN(h) &&
        !isNaN(l) &&
        !isNaN(c)
      ) {
        candles.push({
          time: timestamps[i],
          open: Number(o.toFixed(4)),
          high: Number(h.toFixed(4)),
          low: Number(l.toFixed(4)),
          close: Number(c.toFixed(4)),
          volume: Number(v.toFixed(2)),
        });
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=15, s-maxage=30");
    res.end(JSON.stringify({ candles, meta }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
