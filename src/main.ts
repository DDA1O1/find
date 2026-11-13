import "./style.css";
import type { CandleData, Timeframe } from "./types";
import { ChartManager } from "./chart/chartManager";
import {
  AllTickersSocketClient,
  fetchFutures24hTickers,
  KlineSocketClient,
  RateLimitError,
} from "./api/binance";
import { candleCache } from "./api/candleCache";
import { WatchlistComponent } from "./components/watchlist";
import { HeaderComponent } from "./components/header";
import { ToolbarComponent } from "./components/toolbar";
import { SearchModalComponent } from "./components/searchModal";
import { ToastComponent } from "./components/toast";
import { OfflineBannerComponent } from "./components/offlineBanner";
import { eventBus } from "./core/eventBus";
import { stateManager } from "./core/stateManager";

export class App {
  private chartManager!: ChartManager;
  private klineSocket: KlineSocketClient | null = null;
  private allTickersSocket: AllTickersSocketClient | null = null;

  private header!: HeaderComponent;
  private toolbar!: ToolbarComponent;
  private watchlist!: WatchlistComponent;
  private searchModal!: SearchModalComponent;
  private toast!: ToastComponent;
  private offlineBanner!: OfflineBannerComponent;

  private loadingOverlay = document.getElementById("chart-loading")!;
  private loadingText = document.getElementById("chart-loading-text")!;
  private watchlistAside = document.getElementById("app-watchlist")!;

  private catalogSyncInterval: number | null = null;
  private unbindShortcuts?: () => void;
  private eventBusUnsubs: Array<() => void> = [];
  private isDestroyed = false;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    // 0. Initialize Notifications & Offline Banner (A5, E1)
    this.toast = new ToastComponent();
    this.offlineBanner = new OfflineBannerComponent();

    // 1. Initialize Header
    const headerEl = document.getElementById("app-header")!;
    this.header = new HeaderComponent(
      headerEl,
      () => this.toggleWatchlist(),
      () => this.chartManager.fitContent(),
    );

    // 2. Initialize Chart Manager (with C4 Worker & D3 Lazy indicators)
    const chartContainer = document.getElementById("chart-container")!;
    this.chartManager = new ChartManager(chartContainer, ({ candle, isHovered }) => {
      this.toolbar.updateLegend(stateManager.activeSymbol, candle, isHovered);
    });

    // 3. Initialize Toolbar
    const toolbarEl = document.getElementById("app-toolbar")!;
    const legendEl = document.getElementById("chart-legend")!;
    this.toolbar = new ToolbarComponent(
      toolbarEl,
      legendEl,
      stateManager.activeTimeframe,
      stateManager.indicators,
      (newTf) => stateManager.setActiveTimeframe(newTf),
      (newType) => {
        stateManager.setChartType(newType);
        this.chartManager.setChartType(newType);
      },
      (settings) => {
        stateManager.setIndicators(settings);
        this.chartManager.setIndicators(settings);
      },
    );

    // 4. Initialize Binance Futures Watchlist (with C3 Virtual Scrolling & D1 Debounce)
    const watchlistEl = document.getElementById("app-watchlist")!;
    this.watchlist = new WatchlistComponent(watchlistEl, stateManager.activeSymbol, (newSymbol) => {
      stateManager.setActiveSymbol(newSymbol);
    });

    // 5. Initialize Global Search Modal (TradingView-style)
    this.searchModal = new SearchModalComponent((symbol) => {
      stateManager.setActiveSymbol(symbol);
      this.watchlist.setActiveSymbol(symbol);
    });

    // 6. Connect EventBus Subscriptions (C1, C2)
    this.setupEventBus();

    // 7. Setup Keyboard Shortcuts
    this.setupShortcuts();

    // 8. Load initial market data
    await this.loadInitialMarketData();
  }

  private setupEventBus(): void {
    // Listen to central symbol changes
    this.eventBusUnsubs.push(
      eventBus.on("symbol:change", async ({ symbol }) => {
        this.watchlist.setActiveSymbol(symbol);

        const ticker = stateManager.allTickers.get(symbol);
        if (ticker) {
          this.header.setTicker(ticker);
        }

        this.startKlineSocket();
        await this.loadCandles(symbol, stateManager.activeTimeframe);
      }),
    );

    // Listen to timeframe changes
    this.eventBusUnsubs.push(
      eventBus.on("timeframe:change", async ({ timeframe }) => {
        this.startKlineSocket();
        await this.loadCandles(stateManager.activeSymbol, timeframe);
      }),
    );

    // Reconnection on network online restore (E1)
    this.eventBusUnsubs.push(
      eventBus.on("connection:network", ({ isOnline }) => {
        if (isOnline) {
          this.reconnectSockets();
          void this.loadCandles(stateManager.activeSymbol, stateManager.activeTimeframe);
        }
      }),
    );
  }

  private toggleWatchlist(): void {
    this.watchlistAside.classList.toggle("collapsed");
  }

  private setupShortcuts(): void {
    const keydownHandler = (e: KeyboardEvent) => {
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
        this.searchModal.setTickers(stateManager.allTickers);
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
        this.searchModal.setTickers(stateManager.allTickers);
        this.searchModal.open(e.key.toUpperCase());
        return;
      }
    };

    window.addEventListener("keydown", keydownHandler);
    this.unbindShortcuts = () => window.removeEventListener("keydown", keydownHandler);
  }

  private async loadInitialMarketData(): Promise<void> {
    try {
      this.showLoading(`Loading Binance Futures pairs...`);
      const tickers = await fetchFutures24hTickers();

      stateManager.setAllTickers(tickers);
      this.watchlist.setTickers(tickers);
      this.watchlist.setActiveSymbol(stateManager.activeSymbol);

      const currentTicker = stateManager.allTickers.get(stateManager.activeSymbol);
      if (currentTicker) {
        this.header.setTicker(currentTicker);
      }

      // Start all tickers socket to stream real-time prices for watchlist (D2 RAF batched)
      this.startAllTickersSocket();

      // Load initial candles
      await this.loadCandles(stateManager.activeSymbol, stateManager.activeTimeframe);

      // Start live kline socket
      this.startKlineSocket();

      // Background auto-sync for newly listed & purged futures
      this.startCatalogAutoSync();
    } catch (err) {
      console.error("Failed to load Binance Futures data:", err);

      let retryDelayMs = 5000;
      if (err instanceof RateLimitError) {
        retryDelayMs = err.retryAfterMs;
      }

      this.showLoading(
        `Connection error: ${(err as Error).message}. Retrying in ${Math.round(retryDelayMs / 1000)}s...`,
      );
      setTimeout(() => void this.loadInitialMarketData(), retryDelayMs);
    }
  }

  private startCatalogAutoSync(): void {
    if (this.catalogSyncInterval) return;

    this.catalogSyncInterval = window.setInterval(async () => {
      try {
        const freshTickers = await fetchFutures24hTickers();
        const { added, removed } = this.watchlist.syncTickers(freshTickers);

        for (const t of freshTickers) {
          stateManager.allTickers.set(t.symbol, t);
        }
        for (const sym of removed) {
          stateManager.allTickers.delete(sym);
        }

        if (added.length > 0) {
          eventBus.emit("toast:show", {
            type: "info",
            title: "New Contracts Listed",
            message: `${added.length} new contract(s): ${added.slice(0, 3).join(", ")}${added.length > 3 ? "..." : ""}`,
            duration: 5000,
          });
        }
        if (removed.length > 0) {
          eventBus.emit("toast:show", {
            type: "warning",
            title: "Contracts Delisted",
            message: `Delisted: ${removed.slice(0, 3).join(", ")}`,
            duration: 5000,
          });
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

      let retryDelayMs = 3000;
      if (err instanceof RateLimitError) {
        retryDelayMs = err.retryAfterMs;
      }

      this.showLoading(
        `Error loading ${symbol} chart. Retrying in ${Math.round(retryDelayMs / 1000)}s...`,
      );
      setTimeout(() => void this.loadCandles(symbol, interval), retryDelayMs);
    }
  }

  private triggerPrefetch(): void {
    const nextSymbols = this.watchlist.getAdjacentSymbols(5);
    void candleCache.prefetch(nextSymbols, stateManager.activeTimeframe, 500);
  }

  private startKlineSocket(): void {
    if (this.klineSocket) {
      this.klineSocket.updateSubscription(stateManager.activeSymbol, stateManager.activeTimeframe);
      return;
    }

    this.klineSocket = new KlineSocketClient(
      stateManager.activeSymbol,
      stateManager.activeTimeframe,
      (candle: CandleData, isClosed: boolean) => {
        this.chartManager.updateCandle(candle, isClosed);
        this.header.updatePriceOnly(candle.close);
        this.watchlist.updateSingleTickerPrice(stateManager.activeSymbol, candle.close);
      },
      (status) => {
        this.header.setStatus(status);
        stateManager.setKlineStatus(status);
      },
    );
  }

  private startAllTickersSocket(): void {
    if (this.allTickersSocket) return;

    this.allTickersSocket = new AllTickersSocketClient((updates) => {
      // D2: Batch price updates inside Watchlist Virtual Scroll
      this.watchlist.updateTickerPrices(updates);
      stateManager.updateTickers(updates);

      const activeUpdate = updates.get(stateManager.activeSymbol);
      if (activeUpdate) {
        const current = stateManager.allTickers.get(stateManager.activeSymbol);
        if (current) {
          this.header.setTicker(current);
        }
      }
    });
  }

  private reconnectSockets(): void {
    if (this.isDestroyed) return;
    if (this.klineSocket) {
      this.klineSocket.destroy();
      this.klineSocket = null;
    }
    if (this.allTickersSocket) {
      this.allTickersSocket.destroy();
      this.allTickersSocket = null;
    }
    this.startKlineSocket();
    this.startAllTickersSocket();
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

  /**
   * C5: Comprehensive teardown method for full application lifecycle
   */
  public destroy(): void {
    this.isDestroyed = true;

    if (this.catalogSyncInterval) {
      clearInterval(this.catalogSyncInterval);
      this.catalogSyncInterval = null;
    }

    if (this.unbindShortcuts) {
      this.unbindShortcuts();
      this.unbindShortcuts = undefined;
    }

    for (const unsub of this.eventBusUnsubs) {
      unsub();
    }
    this.eventBusUnsubs = [];

    if (this.klineSocket) {
      this.klineSocket.destroy();
      this.klineSocket = null;
    }
    if (this.allTickersSocket) {
      this.allTickersSocket.destroy();
      this.allTickersSocket = null;
    }

    this.chartManager?.destroy();
    this.header?.destroy();
    this.toolbar?.destroy();
    this.watchlist?.destroy();
    this.searchModal?.destroy();
    this.offlineBanner?.destroy();
    this.toast?.destroy();
  }
}

// Bootstrap application on DOM ready
let appInstance: App | null = null;
window.addEventListener("DOMContentLoaded", () => {
  appInstance = new App();
});

export { appInstance };
