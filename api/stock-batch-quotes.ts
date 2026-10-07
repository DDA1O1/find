import type { IncomingMessage, ServerResponse } from "node:http";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

  try {
    const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const rawSymbols = req.query?.symbols || urlObj.searchParams.get("symbols") || "";
    const symbols = rawSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20); // Maximum 20 symbols per batch

    if (symbols.length === 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "No symbols provided" }));
      return;
    }

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.join(",")}&interval=1d&range=1d`;
    const yahooRes = await fetch(yahooUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!yahooRes.ok) {
      res.statusCode = yahooRes.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Yahoo returned HTTP ${yahooRes.status}` }));
      return;
    }

    const data: Record<
      string,
      {
        close?: number[];
        fulldayPrice?: number;
        fulldayChangePercent?: number;
      }
    > = await yahooRes.json();

    const quotes: Record<string, { price: number; change24h: number }> = {};
    for (const sym of symbols) {
      const item = data[sym];
      if (item) {
        const price = item.close?.[0] || item.fulldayPrice || 0;
        const change24h = item.fulldayChangePercent || 0;
        if (price > 0) {
          quotes[sym] = {
            price: Number(price.toFixed(2)),
            change24h: Number(change24h.toFixed(2)),
          };
        }
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=10, s-maxage=20");
    res.end(JSON.stringify({ quotes }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
