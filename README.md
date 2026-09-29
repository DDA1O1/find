# TradingView Binance Futures Dashboard

A high-performance personal crypto charting platform for **Binance Futures (USDT-M)** pairs, powered by TradingView's open-source `lightweight-charts`, direct public Binance REST & WebSocket streams, and the **Vite+** toolchain.

---

## Features

- **TradingView Charting Engine (`lightweight-charts` v5)**:
  - High-precision candlestick chart with responsive pinch-to-zoom and crosshair.
  - Multi-chart styles: Candlesticks, Line, and Area.
  - Volume histogram synchronized on a bottom overlay scale.
  - Technical indicators: **EMA 20**, **EMA 50**, **SMA 200**, and **Bollinger Bands (20, 2)** with real-time recalculation.
  - Floating OHLCV legend with dynamic crosshair inspect tracking.

- **Binance Futures Market Screener & Watchlist**:
  - Live watchlist of all Binance USDT-M perpetual contracts.
  - Real-time sub-second price updates and uptick/downtick flash animations via `!ticker@arr` WebSocket stream.
  - Search filter by symbol (e.g., `BTC`, `SOL`, `PEPE`, `ETH`).
  - Categorized tabs: **All**, **Starred (Favorites)**, **Top Gainers**, **Top Losers**, and **Highest Volume**.
  - Persistent starred favorites saved to browser `localStorage`.

- **Real-Time Data Feeds (Zero API Key & Free)**:
  - 1000 historical candles loaded on symbol or timeframe switch (`1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `1d`, `1w`).
  - Live Kline WebSocket feed (`<symbol>@kline_<interval>`) pushing candle updates in real-time.
  - Auto-reconnect with exponential backoff and connection status indicator.

- **Keyboard Quick Navigation (TradingView Style)**:
  - <kbd>Space</kbd> or <kbd>↓</kbd>: Jump to the next coin in the watchlist, auto-scroll to it, and load its chart.
  - <kbd>Shift</kbd> + <kbd>Space</kbd> or <kbd>↑</kbd>: Jump to the previous coin and load its chart.
  - <kbd>/</kbd>: Focus the watchlist search bar.
  - <kbd>Esc</kbd>: Unfocus search bar / close popovers.

- **Vercel & Static Host Ready**:
  - Zero backend server dependencies. The browser connects directly to Binance's public endpoints.
  - Deployable to Vercel, Cloudflare Pages, Netlify, or GitHub Pages.

---

## Local Development

```bash
# 1. Install dependencies
vp install

# 2. Start development server
vp dev

# 3. Format and lint checks
vp check
vp check --fix

# 4. Run test suite
vp test run

# 5. Production build
vp run build
```

---

## Deployment to Vercel

1. Push this repository to GitHub or GitLab.
2. In the [Vercel Dashboard](https://vercel.com), click **Add New Project** and import this repository.
3. Framework Preset: **Vite**
4. Build Command: `pnpm run build`
5. Output Directory: `dist`
6. Deploy!
