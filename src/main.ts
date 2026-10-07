import "./style.css";
import type { CandleData, MarketMode, Timeframe, WatchlistTicker } from "./types";
import { ChartManager } from "./chart/chartManager";
import { AllTickersSocketClient, fetchFutures24hTickers, KlineSocketClient } from "./api/binance";
import { fetchStocksCatalog } from "./api/stocks";
import { candleCache } from "./api/candleCache";
import { WatchlistComponent } from "./components/watchlist";
import { HeaderComponent } from "./components/header";
import { ToolbarComponent } from "./components/toolbar";

class App {
  private marketMode: MarketMode;
  private activeCryptoSymbol: string;
  private activeStockSymbol: string;
  private activeTimeframe: Timeframe;

  private allCryptoTickers: Map<string, WatchlistTicker> = new Map();
  private allStockTickers: Map<string, WatchlistTicker> = new Map();

  private chartManager!: ChartManager;
  private klineSocket: KlineSocketClient | null = null;
  private allTickersSocket: AllTickersSocketClient | null = null;

  private header!: HeaderComponent;
  private toolbar!: ToolbarComponent;
  private watchlist!: WatchlistComponent;

  private loadingOverlay = document.getElementById("chart-loading")!;
  private loadingText = document.getElementById("chart-loading-text")!;
  private watchlistAside = document.getElementById("app-watchlist")!;

  constructor() {
    this.marketMode = (localStorage.getItem("tv_market_mode") as MarketMode) || "crypto_futures";
    this.activeCryptoSymbol = localStorage.getItem("tv_active_crypto_symbol") || "BTCUSDT";
    this.activeStockSymbol = localStorage.getItem("tv_active_stock_symbol") || "NVDA";
    this.activeTimeframe = (localStorage.getItem("tv_active_timeframe") as Timeframe) || "1d";

    void this.init();
  }

  private get activeSymbol(): string {
    return this.marketMode === "crypto_futures" ? this.activeCryptoSymbol : this.activeStockSymbol;
  }

  private async init(): Promise<void> {
    // 1. Initialize Header
    const headerEl = document.getElementById("app-header")!;
    this.header = new HeaderComponent(
      headerEl,
      () => this.toggleWatchlist(),
      () => this.chartManager.fitContent(),
    );

    // 2. Initialize Chart Manager
    const chartContainer = document.getElementById("chart-container")!;
    this.chartManager = new ChartManager(chartContainer, ({ candle, isHovered }) => {
      this.toolbar.updateLegend(this.activeSymbol, candle, isHovered);
    });

    // 3. Initialize Toolbar
    const toolbarEl = document.getElementById("app-toolbar")!;
    const legendEl = document.getElementById("chart-legend")!;
    this.toolbar = new ToolbarComponent(
      toolbarEl,
      legendEl,
      this.activeTimeframe,
      this.chartManager.getIndicators(),
      (newTf) => this.handleTimeframeChange(newTf),
      (newType) => this.chartManager.setChartType(newType),
      (settings) => this.chartManager.setIndicators(settings),
    );

    // 4. Initialize Watchlist with Market Mode switcher
    const watchlistEl = document.getElementById("app-watchlist")!;
    this.watchlist = new WatchlistComponent(
      watchlistEl,
      this.activeSymbol,
      this.marketMode,
      (newSymbol) => this.handleSymbolChange(newSymbol),
      (newMarket) => this.handleMarketChange(newMarket),
    );

    // 5. Setup Keyboard Shortcuts (Spacebar, Arrows, / for Search)
    this.setupShortcuts();

    // 6. Load initial data
    await this.loadInitialMarketData();
  }

  private toggleWatchlist(): void {
    this.watchlistAside.classList.toggle("collapsed");
  }

  private setupShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Spacebar or ArrowDown: Advance to next coin/stock and open chart
      if (e.code === "Space" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        if (e.shiftKey && (e.code === "Space" || e.key === " ")) {
          this.watchlist.selectPrevSymbol();
        } else {
          this.watchlist.selectNextSymbol();
        }
        return;
      }

      // ArrowUp: Go back to previous coin/stock and open chart
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.watchlist.selectPrevSymbol();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.getElementById("wl-search") as HTMLInputElement | null;
        searchInput?.focus();
      }
    });
  }

  private async loadInitialMarketData(): Promise<void> {
    try {
      if (this.marketMode === "crypto_futures") {
        await this.loadCryptoMarket();
      } else {
        await this.loadStockMarket();
      }
    } catch (err) {
      console.error("Failed to load initial market data:", err);
      this.showLoading(`Connection error: ${(err as Error).message}. Retrying in 5s...`);
      setTimeout(() => void this.loadInitialMarketData(), 5000);
    }
  }

  private async loadCryptoMarket(): Promise<void> {
    this.showLoading(`Loading Binance Futures pairs...`);
    const tickers = await fetchFutures24hTickers();

    this.allCryptoTickers.clear();
    for (const t of tickers) {
      this.allCryptoTickers.set(t.symbol, t);
    }

    this.watchlist.setTickers(tickers);
    this.watchlist.setActiveSymbol(this.activeCryptoSymbol);

    const currentTicker = this.allCryptoTickers.get(this.activeCryptoSymbol);
    if (currentTicker) {
      this.header.setTicker(currentTicker, "crypto_futures");
    }

    // Start all tickers socket to stream real-time prices for watchlist
    this.startAllTickersSocket();

    // Load initial candles
    await this.loadCandles(this.activeCryptoSymbol, this.activeTimeframe);

    // Start live kline socket
    this.startKlineSocket();

    // Background auto-sync for newly listed & purged futures
    this.startCatalogAutoSync();
  }

  private async loadStockMarket(): Promise<void> {
    this.showLoading(`Loading TradFi Stocks & ETFs catalog (>100K Dollar Vol, 5.2K symbols)...`);

    // Stop crypto sockets
    this.stopSockets();

    if (this.allStockTickers.size === 0) {
      const stockTickers = await fetchStocksCatalog();
      for (const t of stockTickers) {
        this.allStockTickers.set(t.symbol, t);
      }
    }

    const stockList = Array.from(this.allStockTickers.values());
    this.watchlist.setTickers(stockList);
    this.watchlist.setActiveSymbol(this.activeStockSymbol);

    const current = this.allStockTickers.get(this.activeStockSymbol);
    if (current) {
      this.header.setTicker(current, "tradifi_stocks");
    }

    this.header.setStatus("connected", "Live Feed");

    // Load initial candles from Yahoo Finance
    await this.loadCandles(this.activeStockSymbol, this.activeTimeframe);
  }

  private async handleMarketChange(newMode: MarketMode): Promise<void> {
    if (this.marketMode === newMode) return;
    this.marketMode = newMode;
    localStorage.setItem("tv_market_mode", newMode);

    this.watchlist.setMarketMode(newMode);

    if (newMode === "crypto_futures") {
      if (this.allCryptoTickers.size === 0) {
        await this.loadCryptoMarket();
      } else {
        const cryptoList = Array.from(this.allCryptoTickers.values());
        this.watchlist.setTickers(cryptoList);
        this.watchlist.setActiveSymbol(this.activeCryptoSymbol);

        const current = this.allCryptoTickers.get(this.activeCryptoSymbol);
        if (current) {
          this.header.setTicker(current, "crypto_futures");
        }

        this.startAllTickersSocket();
        this.startKlineSocket();
        await this.loadCandles(this.activeCryptoSymbol, this.activeTimeframe);
      }
    } else {
      await this.loadStockMarket();
    }
  }

  private catalogSyncInterval: number | null = null;

  private startCatalogAutoSync(): void {
    if (this.catalogSyncInterval) return;

    this.catalogSyncInterval = window.setInterval(async () => {
      if (this.marketMode !== "crypto_futures") return;

      try {
        const freshTickers = await fetchFutures24hTickers();
        const { added, removed } = this.watchlist.syncTickers(freshTickers);

        for (const t of freshTickers) {
          this.allCryptoTickers.set(t.symbol, t);
        }
        for (const sym of removed) {
          this.allCryptoTickers.delete(sym);
        }

        if (added.length > 0) {
          console.info(
            `[Binance Catalog] Added ${added.length} new contract(s): ${added.join(", ")}`,
          );
        }
        if (removed.length > 0) {
          console.info(
            `[Binance Catalog] Purged ${removed.length} delisted contract(s): ${removed.join(", ")}`,
          );
        }
      } catch (err) {
        console.warn("[Binance Catalog] Auto-sync failed:", err);
      }
    }, 120000);
  }

  private async loadCandles(symbol: string, interval: Timeframe): Promise<void> {
    const cached = candleCache.get(symbol, interval);
    if (cached) {
      // 0ms instantaneous render from in-memory cache
      this.hideLoading();
      this.chartManager.setData(cached.candles);

      if (cached.meta) {
        this.applyStockMeta(cached.meta);
      } else {
        const lastCandle = cached.candles[cached.candles.length - 1];
        if (lastCandle) {
          this.header.updatePriceOnly(lastCandle.close);
        }
      }

      this.triggerPrefetch();
      return;
    }

    const spinnerTimer = window.setTimeout(() => {
      this.showLoading(`Loading ${symbol} (${interval}) chart data...`);
    }, 120);

    try {
      const { candles, meta } = await candleCache.getOrFetch(symbol, interval, 500);
      window.clearTimeout(spinnerTimer);
      this.chartManager.setData(candles);
      this.hideLoading();

      if (meta) {
        this.applyStockMeta(meta);
      } else {
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
          this.header.updatePriceOnly(lastCandle.close);
        }
      }

      this.triggerPrefetch();
    } catch (err) {
      window.clearTimeout(spinnerTimer);
      console.error(`Failed to load candles for ${symbol}:`, err);
      this.showLoading(`Error loading ${symbol} chart. Retrying...`);
      setTimeout(() => void this.loadCandles(symbol, interval), 3000);
    }
  }

  private applyStockMeta(meta: {
    symbol: string;
    shortName: string;
    regularMarketPrice: number;
    regularMarketChangePercent: number;
    regularMarketDayHigh: number;
    regularMarketDayLow: number;
    regularMarketVolume: number;
  }): void {
    const existing = this.allStockTickers.get(meta.symbol);
    if (existing) {
      existing.price = meta.regularMarketPrice;
      existing.change24h = meta.regularMarketChangePercent;
      existing.high24h = meta.regularMarketDayHigh;
      existing.low24h = meta.regularMarketDayLow;
      existing.quoteVolume24h = meta.regularMarketVolume;
      if (meta.shortName) existing.name = meta.shortName;

      this.header.setTicker(existing, "tradifi_stocks");
      this.watchlist.updateSingleTickerPrice(
        meta.symbol,
        meta.regularMarketPrice,
        meta.regularMarketChangePercent,
        meta.regularMarketVolume,
      );
    }
  }

  private triggerPrefetch(): void {
    const nextSymbols = this.watchlist.getAdjacentSymbols(5);
    void candleCache.prefetch(nextSymbols, this.activeTimeframe, 500);
  }

  private startKlineSocket(): void {
    if (this.marketMode !== "crypto_futures") return;

    if (this.klineSocket) {
      this.klineSocket.updateSubscription(this.activeCryptoSymbol, this.activeTimeframe);
      return;
    }

    this.klineSocket = new KlineSocketClient(
      this.activeCryptoSymbol,
      this.activeTimeframe,
      (candle: CandleData, isClosed: boolean) => {
        this.chartManager.updateCandle(candle, isClosed);
        this.header.updatePriceOnly(candle.close);
        this.watchlist.updateSingleTickerPrice(this.activeCryptoSymbol, candle.close);
      },
      (status) => {
        this.header.setStatus(status);
      },
    );
  }

  private startAllTickersSocket(): void {
    if (this.marketMode !== "crypto_futures") return;
    if (this.allTickersSocket) return;

    this.allTickersSocket = new AllTickersSocketClient((updates) => {
      this.watchlist.updateTickerPrices(updates);

      const activeUpdate = updates.get(this.activeCryptoSymbol);
      if (activeUpdate) {
        const current = this.allCryptoTickers.get(this.activeCryptoSymbol);
        if (current) {
          Object.assign(current, activeUpdate);
          this.header.setTicker(current, "crypto_futures");
        }
      }
    });
  }

  private stopSockets(): void {
    if (this.klineSocket) {
      this.klineSocket.destroy();
      this.klineSocket = null;
    }
    if (this.allTickersSocket) {
      this.allTickersSocket.destroy();
      this.allTickersSocket = null;
    }
  }

  private async handleSymbolChange(symbol: string): Promise<void> {
    if (this.marketMode === "crypto_futures") {
      if (this.activeCryptoSymbol === symbol) return;
      this.activeCryptoSymbol = symbol;
      localStorage.setItem("tv_active_crypto_symbol", symbol);

      const ticker = this.allCryptoTickers.get(symbol);
      if (ticker) {
        this.header.setTicker(ticker, "crypto_futures");
      }

      this.startKlineSocket();
      await this.loadCandles(this.activeCryptoSymbol, this.activeTimeframe);
    } else {
      if (this.activeStockSymbol === symbol) return;
      this.activeStockSymbol = symbol;
      localStorage.setItem("tv_active_stock_symbol", symbol);

      const ticker = this.allStockTickers.get(symbol);
      if (ticker) {
        this.header.setTicker(ticker, "tradifi_stocks");
      }

      await this.loadCandles(this.activeStockSymbol, this.activeTimeframe);
    }
  }

  private async handleTimeframeChange(tf: Timeframe): Promise<void> {
    if (this.activeTimeframe === tf) return;

    this.activeTimeframe = tf;
    localStorage.setItem("tv_active_timeframe", tf);

    if (this.marketMode === "crypto_futures") {
      this.startKlineSocket();
    }

    await this.loadCandles(this.activeSymbol, this.activeTimeframe);
  }

  private showLoading(text: string): void {
    this.loadingText.textContent = text;
    this.loadingOverlay.style.display = "flex";
    this.loadingOverlay.style.opacity = "1";
  }

  private hideLoading(): void {
    this.loadingOverlay.style.opacity = "0";
    this.loadingOverlay.style.display = "none";
  }
}

// Bootstrap application on DOM ready
window.addEventListener("DOMContentLoaded", () => {
  new App();
});
