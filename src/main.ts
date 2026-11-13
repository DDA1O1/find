import "./style.css";
import type { CandleData, Timeframe, WatchlistTicker } from "./types";
import { ChartManager } from "./chart/chartManager";
import { AllTickersSocketClient, fetchFutures24hTickers, KlineSocketClient } from "./api/binance";
import { candleCache } from "./api/candleCache";
import { WatchlistComponent } from "./components/watchlist";
import { HeaderComponent } from "./components/header";
import { ToolbarComponent } from "./components/toolbar";
import { SearchModalComponent } from "./components/searchModal";

class App {
  private activeSymbol: string;
  private activeTimeframe: Timeframe;

  private allTickers: Map<string, WatchlistTicker> = new Map();

  private chartManager!: ChartManager;
  private klineSocket: KlineSocketClient | null = null;
  private allTickersSocket: AllTickersSocketClient | null = null;

  private header!: HeaderComponent;
  private toolbar!: ToolbarComponent;
  private watchlist!: WatchlistComponent;
  private searchModal!: SearchModalComponent;

  private loadingOverlay = document.getElementById("chart-loading")!;
  private loadingText = document.getElementById("chart-loading-text")!;
  private watchlistAside = document.getElementById("app-watchlist")!;

  constructor() {
    this.activeSymbol = localStorage.getItem("tv_active_symbol") || "BTCUSDT";
    this.activeTimeframe = (localStorage.getItem("tv_active_timeframe") as Timeframe) || "1d";

    void this.init();
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

    // 4. Initialize Binance Futures Watchlist
    const watchlistEl = document.getElementById("app-watchlist")!;
    this.watchlist = new WatchlistComponent(watchlistEl, this.activeSymbol, (newSymbol) =>
      this.handleSymbolChange(newSymbol),
    );

    // 5. Initialize Global Search Modal (TradingView-style)
    this.searchModal = new SearchModalComponent((symbol) => {
      this.handleSymbolChange(symbol);
      this.watchlist.setActiveSymbol(symbol);
    });

    // 6. Setup Keyboard Shortcuts (Spacebar, Arrows, / for Search, letters open search modal)
    this.setupShortcuts();

    // 7. Load initial data
    await this.loadInitialMarketData();
  }

  private toggleWatchlist(): void {
    this.watchlistAside.classList.toggle("collapsed");
  }

  private setupShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      // Ignore when typing in an input or textarea (except Escape)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // If the search modal is open, let it handle everything
      if (this.searchModal.opened) return;

      // Spacebar or ArrowDown: Advance to next coin and open chart
      if (e.code === "Space" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        if (e.shiftKey && (e.code === "Space" || e.key === " ")) {
          this.watchlist.selectPrevSymbol();
        } else {
          this.watchlist.selectNextSymbol();
        }
        return;
      }

      // ArrowUp: Go back to previous coin and open chart
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.watchlist.selectPrevSymbol();
        return;
      }

      // "/" key: Open search modal (empty)
      if (e.key === "/") {
        e.preventDefault();
        this.searchModal.setTickers(this.allTickers);
        this.searchModal.open();
        return;
      }

      // Any single printable character (letter, digit): Open search modal with that character
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /[a-zA-Z0-9]/.test(e.key)
      ) {
        e.preventDefault();
        this.searchModal.setTickers(this.allTickers);
        this.searchModal.open(e.key.toUpperCase());
        return;
      }
    });
  }

  private async loadInitialMarketData(): Promise<void> {
    try {
      this.showLoading(`Loading Binance Futures pairs...`);
      const tickers = await fetchFutures24hTickers();

      this.allTickers.clear();
      for (const t of tickers) {
        this.allTickers.set(t.symbol, t);
      }

      this.watchlist.setTickers(tickers);
      this.watchlist.setActiveSymbol(this.activeSymbol);

      const currentTicker = this.allTickers.get(this.activeSymbol);
      if (currentTicker) {
        this.header.setTicker(currentTicker);
      }

      // Start all tickers socket to stream real-time prices for watchlist
      this.startAllTickersSocket();

      // Load initial candles
      await this.loadCandles(this.activeSymbol, this.activeTimeframe);

      // Start live kline socket
      this.startKlineSocket();

      // Background auto-sync for newly listed & purged futures
      this.startCatalogAutoSync();
    } catch (err) {
      console.error("Failed to load Binance Futures data:", err);
      this.showLoading(`Connection error: ${(err as Error).message}. Retrying in 5s...`);
      setTimeout(() => void this.loadInitialMarketData(), 5000);
    }
  }

  private catalogSyncInterval: number | null = null;

  private startCatalogAutoSync(): void {
    if (this.catalogSyncInterval) return;

    this.catalogSyncInterval = window.setInterval(async () => {
      try {
        const freshTickers = await fetchFutures24hTickers();
        const { added, removed } = this.watchlist.syncTickers(freshTickers);

        for (const t of freshTickers) {
          this.allTickers.set(t.symbol, t);
        }
        for (const sym of removed) {
          this.allTickers.delete(sym);
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

      const lastCandle = cached.candles[cached.candles.length - 1];
      if (lastCandle) {
        this.header.updatePriceOnly(lastCandle.close);
      }

      this.triggerPrefetch();
      return;
    }

    const spinnerTimer = window.setTimeout(() => {
      this.showLoading(`Loading ${symbol} (${interval}) chart data...`);
    }, 120);

    try {
      const { candles } = await candleCache.getOrFetch(symbol, interval, 500);
      window.clearTimeout(spinnerTimer);
      this.chartManager.setData(candles);
      this.hideLoading();

      const lastCandle = candles[candles.length - 1];
      if (lastCandle) {
        this.header.updatePriceOnly(lastCandle.close);
      }

      this.triggerPrefetch();
    } catch (err) {
      window.clearTimeout(spinnerTimer);
      console.error(`Failed to load candles for ${symbol}:`, err);
      this.showLoading(`Error loading ${symbol} chart. Retrying...`);
      setTimeout(() => void this.loadCandles(symbol, interval), 3000);
    }
  }

  private triggerPrefetch(): void {
    const nextSymbols = this.watchlist.getAdjacentSymbols(5);
    void candleCache.prefetch(nextSymbols, this.activeTimeframe, 500);
  }

  private startKlineSocket(): void {
    if (this.klineSocket) {
      this.klineSocket.updateSubscription(this.activeSymbol, this.activeTimeframe);
      return;
    }

    this.klineSocket = new KlineSocketClient(
      this.activeSymbol,
      this.activeTimeframe,
      (candle: CandleData, isClosed: boolean) => {
        this.chartManager.updateCandle(candle, isClosed);
        this.header.updatePriceOnly(candle.close);
        this.watchlist.updateSingleTickerPrice(this.activeSymbol, candle.close);
      },
      (status) => {
        this.header.setStatus(status);
      },
    );
  }

  private startAllTickersSocket(): void {
    if (this.allTickersSocket) return;

    this.allTickersSocket = new AllTickersSocketClient((updates) => {
      this.watchlist.updateTickerPrices(updates);

      const activeUpdate = updates.get(this.activeSymbol);
      if (activeUpdate) {
        const current = this.allTickers.get(this.activeSymbol);
        if (current) {
          Object.assign(current, activeUpdate);
          this.header.setTicker(current);
        }
      }
    });
  }

  private async handleSymbolChange(symbol: string): Promise<void> {
    if (this.activeSymbol === symbol) return;
    this.activeSymbol = symbol;
    localStorage.setItem("tv_active_symbol", symbol);

    const ticker = this.allTickers.get(symbol);
    if (ticker) {
      this.header.setTicker(ticker);
    }

    this.startKlineSocket();
    await this.loadCandles(this.activeSymbol, this.activeTimeframe);
  }

  private async handleTimeframeChange(tf: Timeframe): Promise<void> {
    if (this.activeTimeframe === tf) return;

    this.activeTimeframe = tf;
    localStorage.setItem("tv_active_timeframe", tf);

    this.startKlineSocket();
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
