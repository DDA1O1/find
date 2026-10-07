import type { MarketMode, WatchlistTicker } from "../types";
import { formatPercent, formatPrice, formatVolume } from "../utils/formatters";
import { getSavedFavorites, saveFavorites } from "../api/binance";
import { fetchBatchStockQuotes, getSavedStockFavorites, saveStockFavorites } from "../api/stocks";

export type CryptoFilter =
  | "all"
  | "crypto"
  | "tradifi"
  | "favorites"
  | "gainers"
  | "losers"
  | "volume";

export type StockFilter = "all" | "stocks" | "etfs" | "favorites" | "gainers" | "losers" | "volume";

export class WatchlistComponent {
  private container: HTMLElement;
  private marketMode: MarketMode = "crypto_futures";
  private tickers: Map<string, WatchlistTicker> = new Map();
  private sortedSymbols: string[] = [];
  private activeSymbol = "BTCUSDT";
  private currentFilter: string = "all";
  private searchQuery = "";
  private onSelectSymbol: (symbol: string) => void;
  private onMarketChange: (mode: MarketMode) => void;

  private cryptoFavorites: Set<string>;
  private stockFavorites: Set<string>;

  private listEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private countBadgeEl!: HTMLElement;
  private tabsContainerEl!: HTMLElement;
  private marketSwitchBtns!: NodeListOf<HTMLButtonElement>;

  private rowElements: Map<
    string,
    {
      row: HTMLElement;
      priceEl: HTMLElement;
      changeEl: HTMLElement;
      starEl: HTMLElement;
    }
  > = new Map();

  constructor(
    container: HTMLElement,
    initialActiveSymbol: string,
    initialMarketMode: MarketMode,
    onSelectSymbol: (symbol: string) => void,
    onMarketChange: (mode: MarketMode) => void,
  ) {
    this.container = container;
    this.activeSymbol = initialActiveSymbol;
    this.marketMode = initialMarketMode;
    this.onSelectSymbol = onSelectSymbol;
    this.onMarketChange = onMarketChange;

    this.cryptoFavorites = getSavedFavorites();
    this.stockFavorites = getSavedStockFavorites();

    this.renderSkeleton();
  }

  private renderSkeleton(): void {
    this.container.innerHTML = `
      <div class="watchlist-header">
        <div class="market-switcher-container">
          <div class="market-switch-group">
            <button class="market-switch-btn ${this.marketMode === "crypto_futures" ? "active" : ""}" data-market="crypto_futures">
              <span class="m-icon">⚡</span> Binance Futures
            </button>
            <button class="market-switch-btn ${this.marketMode === "tradifi_stocks" ? "active" : ""}" data-market="tradifi_stocks">
              <span class="m-icon">🏛️</span> TradFi Stocks (> $1M Vol)
            </button>
          </div>
        </div>

        <div class="watchlist-title-row">
          <div class="watchlist-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3v18h18"/>
              <path d="m19 9-5 5-4-4-3 3"/>
            </svg>
            <span id="wl-market-label">${this.marketMode === "crypto_futures" ? "USDT-M Pairs" : "US Equities & ETFs"}</span>
            <span class="badge" id="wl-count">0</span>
          </div>
        </div>

        <div class="watchlist-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="wl-search" placeholder="${this.marketMode === "crypto_futures" ? "Search crypto pairs (BTC, ETH, SOL)..." : "Search stocks (AAPL, NVDA, SPY)..."}" spellcheck="false" autocomplete="off" />
          <button id="wl-clear" class="btn-clear" title="Clear search" style="display: none;">×</button>
        </div>

        <div class="watchlist-tabs" id="wl-tabs">
          <!-- Rendered dynamically depending on market -->
        </div>
      </div>

      <div class="watchlist-list" id="wl-list">
        <div class="wl-loading">
          <div class="spinner"></div>
          <span>Loading market data...</span>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector("#wl-list")!;
    this.searchInput = this.container.querySelector("#wl-search")!;
    this.countBadgeEl = this.container.querySelector("#wl-count")!;
    this.tabsContainerEl = this.container.querySelector("#wl-tabs")!;
    const clearBtn = this.container.querySelector<HTMLButtonElement>("#wl-clear")!;

    // Market Switcher
    this.marketSwitchBtns =
      this.container.querySelectorAll<HTMLButtonElement>(".market-switch-btn");
    this.marketSwitchBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.market as MarketMode;
        if (mode === this.marketMode) return;

        this.setMarketMode(mode);
        this.onMarketChange(mode);
      });
    });

    // Search event
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = this.searchInput.value.trim().toUpperCase();
      clearBtn.style.display = this.searchQuery ? "block" : "none";
      this.updateView();
    });

    clearBtn.addEventListener("click", () => {
      this.searchInput.value = "";
      this.searchQuery = "";
      clearBtn.style.display = "none";
      this.searchInput.focus();
      this.updateView();
    });

    this.renderTabs();
  }

  public setMarketMode(mode: MarketMode): void {
    if (this.marketMode === mode) return;
    this.marketMode = mode;
    this.currentFilter = "all";
    this.searchQuery = "";
    this.searchInput.value = "";

    const labelEl = this.container.querySelector("#wl-market-label");
    if (labelEl) {
      labelEl.textContent = mode === "crypto_futures" ? "USDT-M Pairs" : "US Equities & ETFs";
    }

    this.searchInput.placeholder =
      mode === "crypto_futures"
        ? "Search crypto pairs (BTC, ETH, SOL)..."
        : "Search stocks (AAPL, NVDA, SPY)...";

    this.marketSwitchBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.market === mode);
    });

    this.renderTabs();
  }

  private renderTabs(): void {
    if (this.marketMode === "crypto_futures") {
      this.tabsContainerEl.innerHTML = `
        <button class="wl-tab ${this.currentFilter === "all" ? "active" : ""}" data-filter="all">All</button>
        <button class="wl-tab ${this.currentFilter === "crypto" ? "active" : ""}" data-filter="crypto">Crypto</button>
        <button class="wl-tab ${this.currentFilter === "tradifi" ? "active" : ""}" data-filter="tradifi">TradiFi</button>
        <button class="wl-tab ${this.currentFilter === "favorites" ? "active" : ""}" data-filter="favorites">★ Starred</button>
        <button class="wl-tab ${this.currentFilter === "gainers" ? "active" : ""}" data-filter="gainers">Gainers</button>
        <button class="wl-tab ${this.currentFilter === "losers" ? "active" : ""}" data-filter="losers">Losers</button>
        <button class="wl-tab ${this.currentFilter === "volume" ? "active" : ""}" data-filter="volume">Volume</button>
      `;
    } else {
      this.tabsContainerEl.innerHTML = `
        <button class="wl-tab ${this.currentFilter === "all" ? "active" : ""}" data-filter="all">All</button>
        <button class="wl-tab ${this.currentFilter === "stocks" ? "active" : ""}" data-filter="stocks">Stocks</button>
        <button class="wl-tab ${this.currentFilter === "etfs" ? "active" : ""}" data-filter="etfs">ETFs</button>
        <button class="wl-tab ${this.currentFilter === "favorites" ? "active" : ""}" data-filter="favorites">★ Starred</button>
        <button class="wl-tab ${this.currentFilter === "gainers" ? "active" : ""}" data-filter="gainers">Gainers</button>
        <button class="wl-tab ${this.currentFilter === "losers" ? "active" : ""}" data-filter="losers">Losers</button>
        <button class="wl-tab ${this.currentFilter === "volume" ? "active" : ""}" data-filter="volume">Volume</button>
      `;
    }

    const tabs = this.tabsContainerEl.querySelectorAll<HTMLButtonElement>(".wl-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        this.currentFilter = tab.dataset.filter || "all";
        this.updateView();
      });
    });
  }

  public setTickers(tickers: WatchlistTicker[]): void {
    this.tickers.clear();
    const favs = this.marketMode === "crypto_futures" ? this.cryptoFavorites : this.stockFavorites;

    for (const t of tickers) {
      t.isFavorite = favs.has(t.symbol);
      this.tickers.set(t.symbol, t);
    }
    this.updateView();
  }

  public syncTickers(freshTickers: WatchlistTicker[]): { added: string[]; removed: string[] } {
    const freshMap = new Map<string, WatchlistTicker>();
    const favs = this.marketMode === "crypto_futures" ? this.cryptoFavorites : this.stockFavorites;

    for (const t of freshTickers) {
      t.isFavorite = favs.has(t.symbol);
      freshMap.set(t.symbol, t);
    }

    const added: string[] = [];
    const removed: string[] = [];

    // Find added items
    for (const [symbol, fresh] of freshMap) {
      if (!this.tickers.has(symbol)) {
        added.push(symbol);
        this.tickers.set(symbol, fresh);
      } else {
        const current = this.tickers.get(symbol)!;
        current.price = fresh.price;
        current.change24h = fresh.change24h;
        current.high24h = fresh.high24h;
        current.low24h = fresh.low24h;
        current.volume24h = fresh.volume24h;
        current.quoteVolume24h = fresh.quoteVolume24h;
      }
    }

    // Find removed items
    for (const symbol of this.tickers.keys()) {
      if (!freshMap.has(symbol)) {
        removed.push(symbol);
        this.tickers.delete(symbol);
      }
    }

    if (added.length > 0 || removed.length > 0) {
      this.updateView();
    }

    return { added, removed };
  }

  public setActiveSymbol(symbol: string, shouldScroll = false): void {
    if (this.activeSymbol === symbol) return;
    const oldRow = this.rowElements.get(this.activeSymbol)?.row;
    oldRow?.classList.remove("active");

    this.activeSymbol = symbol;
    const newRow = this.rowElements.get(symbol)?.row;
    newRow?.classList.add("active");

    if (shouldScroll && newRow) {
      newRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /**
   * Advances to next ticker in current filtered list, scrolls into view, and loads chart
   */
  public selectNextSymbol(): string | null {
    if (this.sortedSymbols.length === 0) return null;
    const currentIndex = this.sortedSymbols.indexOf(this.activeSymbol);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % this.sortedSymbols.length : 0;
    const nextSymbol = this.sortedSymbols[nextIndex];

    this.setActiveSymbol(nextSymbol, true);
    this.onSelectSymbol(nextSymbol);
    return nextSymbol;
  }

  /**
   * Moves to previous ticker in current filtered list, scrolls into view, and loads chart
   */
  public selectPrevSymbol(): string | null {
    if (this.sortedSymbols.length === 0) return null;
    const currentIndex = this.sortedSymbols.indexOf(this.activeSymbol);
    const prevIndex =
      currentIndex >= 0
        ? (currentIndex - 1 + this.sortedSymbols.length) % this.sortedSymbols.length
        : this.sortedSymbols.length - 1;
    const prevSymbol = this.sortedSymbols[prevIndex];

    this.setActiveSymbol(prevSymbol, true);
    this.onSelectSymbol(prevSymbol);
    return prevSymbol;
  }

  public getAdjacentSymbols(count = 4): string[] {
    if (this.sortedSymbols.length <= 1) return [];
    const currentIndex = this.sortedSymbols.indexOf(this.activeSymbol);
    const result: string[] = [];

    for (let i = 1; i <= count; i++) {
      const nextIdx = (currentIndex + i) % this.sortedSymbols.length;
      result.push(this.sortedSymbols[nextIdx]);
    }
    return result;
  }

  public updateTickerPrices(updates: Map<string, Partial<WatchlistTicker>>): void {
    for (const [symbol, patch] of updates) {
      const existing = this.tickers.get(symbol);
      if (!existing) continue;

      const oldPrice = existing.price;
      Object.assign(existing, patch);

      const rowRefs = this.rowElements.get(symbol);
      if (rowRefs) {
        if (patch.price !== undefined && patch.price !== oldPrice) {
          rowRefs.priceEl.textContent = formatPrice(patch.price);
        }

        if (patch.change24h !== undefined) {
          const isPos = patch.change24h >= 0;
          rowRefs.changeEl.textContent = formatPercent(patch.change24h);
          rowRefs.changeEl.className = `wl-change ${isPos ? "pos" : "neg"}`;
        }
      }
    }
  }

  public updateSingleTickerPrice(
    symbol: string,
    newPrice: number,
    change24h?: number,
    vol?: number,
  ): void {
    const existing = this.tickers.get(symbol);
    if (!existing) return;

    existing.price = newPrice;
    if (change24h !== undefined) existing.change24h = change24h;
    if (vol !== undefined) existing.quoteVolume24h = vol;

    const rowRefs = this.rowElements.get(symbol);
    if (rowRefs) {
      rowRefs.priceEl.textContent = formatPrice(newPrice);
      if (change24h !== undefined) {
        const isPos = change24h >= 0;
        rowRefs.changeEl.textContent = formatPercent(change24h);
        rowRefs.changeEl.className = `wl-change ${isPos ? "pos" : "neg"}`;
      }
    }
  }

  private filterAndSort(): string[] {
    let list = Array.from(this.tickers.values());

    // Search query filter (matches symbol or company name)
    if (this.searchQuery) {
      list = list.filter((t) => {
        const symMatch = t.symbol.includes(this.searchQuery);
        const baseMatch = t.baseAsset.includes(this.searchQuery);
        const nameMatch = t.name ? t.name.toUpperCase().includes(this.searchQuery) : false;
        return symMatch || baseMatch || nameMatch;
      });
    }

    if (this.marketMode === "crypto_futures") {
      if (this.currentFilter === "crypto") {
        list = list.filter((t) => t.contractType === "PERPETUAL" || !t.contractType);
      } else if (this.currentFilter === "tradifi") {
        list = list.filter((t) => t.contractType === "TRADIFI_PERPETUAL");
      } else if (this.currentFilter === "favorites") {
        list = list.filter((t) => t.isFavorite);
      } else if (this.currentFilter === "gainers") {
        list = list.sort((a, b) => b.change24h - a.change24h);
      } else if (this.currentFilter === "losers") {
        list = list.sort((a, b) => a.change24h - b.change24h);
      } else if (this.currentFilter === "volume") {
        list = list.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
      } else {
        // Default: Favorites first, then volume
        list = list.sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return b.quoteVolume24h - a.quoteVolume24h;
        });
      }
    } else {
      // TradFi Stocks filter
      if (this.currentFilter === "stocks") {
        list = list.filter((t) => t.contractType === "STOCK");
      } else if (this.currentFilter === "etfs") {
        list = list.filter((t) => t.contractType === "ETF");
      } else if (this.currentFilter === "favorites") {
        list = list.filter((t) => t.isFavorite);
      } else if (this.currentFilter === "gainers") {
        list = list.slice().sort((a, b) => b.change24h - a.change24h);
      } else if (this.currentFilter === "losers") {
        list = list.slice().sort((a, b) => a.change24h - b.change24h);
      } else if (this.currentFilter === "volume") {
        list = list
          .slice()
          .sort(
            (a, b) =>
              (b.quoteVolume24h || b.volume24h * b.price || 0) -
              (a.quoteVolume24h || a.volume24h * a.price || 0),
          );
      } else {
        // Default: Favorites first, then keep volume ranking
        list = list.slice().sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return 0;
        });
      }
    }

    return list.map((t) => t.symbol);
  }

  public updateView(): void {
    this.sortedSymbols = this.filterAndSort();
    this.countBadgeEl.textContent = this.sortedSymbols.length.toString();

    this.listEl.innerHTML = "";
    this.rowElements.clear();

    if (this.sortedSymbols.length === 0) {
      this.listEl.innerHTML = `
        <div class="wl-empty">
          <span>No matching ${this.marketMode === "crypto_futures" ? "futures pairs" : "stocks/ETFs"} found</span>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const symbol of this.sortedSymbols) {
      const ticker = this.tickers.get(symbol);
      if (!ticker) continue;

      const row = document.createElement("div");
      row.className = `wl-row ${symbol === this.activeSymbol ? "active" : ""}`;
      row.dataset.symbol = symbol;

      const isPos = ticker.change24h >= 0;
      const isStockMode = this.marketMode === "tradifi_stocks";

      let tagHtml = "";
      if (ticker.contractType === "TRADIFI_PERPETUAL") {
        tagHtml = '<span class="wl-tradifi-tag">TRADIFI</span>';
      } else if (ticker.contractType === "ETF") {
        tagHtml = '<span class="wl-stock-tag etf">ETF</span>';
      } else if (isStockMode && ticker.contractType === "STOCK") {
        tagHtml = '<span class="wl-stock-tag stock">STOCK</span>';
      }

      const quoteDisplay = isStockMode ? "/USD" : "/USDT";
      const volStr = ticker.volume24h > 0 ? ` • ${formatVolume(ticker.volume24h)} vol` : "";
      const subtitle = isStockMode
        ? `${ticker.name || ticker.baseAsset}${volStr}`
        : formatVolume(ticker.quoteVolume24h);

      const hasPrice = ticker.price > 0;
      const priceDisplay = hasPrice ? formatPrice(ticker.price) : "--";
      const changeDisplay = hasPrice ? formatPercent(ticker.change24h) : "--";

      row.innerHTML = `
        <button class="wl-star ${ticker.isFavorite ? "favorited" : ""}" title="Favorite" aria-label="Favorite ${ticker.baseAsset}">
          ★
        </button>
        <div class="wl-sym-info">
          <div class="wl-sym-title">
            <span class="base">${ticker.baseAsset}</span>
            <span class="quote">${quoteDisplay}</span>
            ${tagHtml}
          </div>
          <div class="wl-sym-vol ${isStockMode ? "wl-stock-name" : ""}">${subtitle}</div>
        </div>
        <div class="wl-price-col">
          <div class="wl-price">${priceDisplay}</div>
          <div class="wl-change ${hasPrice ? (isPos ? "pos" : "neg") : "neutral"}">${changeDisplay}</div>
        </div>
      `;

      const starEl = row.querySelector(".wl-star") as HTMLElement;
      const priceEl = row.querySelector(".wl-price") as HTMLElement;
      const changeEl = row.querySelector(".wl-change") as HTMLElement;

      starEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleFavorite(symbol);
      });

      row.addEventListener("click", () => {
        this.setActiveSymbol(symbol);
        this.onSelectSymbol(symbol);
      });

      this.rowElements.set(symbol, { row, priceEl, changeEl, starEl });
      fragment.appendChild(row);
    }

    this.listEl.appendChild(fragment);

    if (this.marketMode === "tradifi_stocks") {
      void this.fetchMissingStockQuotes();
    }
  }

  private isFetchingStockBatch = false;

  private async fetchMissingStockQuotes(): Promise<void> {
    if (this.marketMode !== "tradifi_stocks" || this.isFetchingStockBatch) return;

    // Find the first 20 visible symbols that do not have price data yet
    const missing = this.sortedSymbols.filter((sym) => {
      const t = this.tickers.get(sym);
      return t && t.price === 0;
    });

    if (missing.length === 0) return;

    this.isFetchingStockBatch = true;
    const chunk = missing.slice(0, 20);

    try {
      const quotes = await fetchBatchStockQuotes(chunk);
      const updates = new Map<string, Partial<WatchlistTicker>>();

      for (const [sym, q] of Object.entries(quotes)) {
        updates.set(sym, {
          price: q.price,
          change24h: q.change24h,
        });
      }

      if (updates.size > 0) {
        this.updateTickerPrices(updates);
      }
    } catch (err) {
      console.warn("Background stock quote fetch error:", err);
    } finally {
      this.isFetchingStockBatch = false;

      // Continue fetching next visible batch if more missing
      const remaining = this.sortedSymbols.filter((sym) => {
        const t = this.tickers.get(sym);
        return t && t.price === 0;
      });

      if (remaining.length > 0 && this.marketMode === "tradifi_stocks") {
        setTimeout(() => void this.fetchMissingStockQuotes(), 200);
      }
    }
  }

  private toggleFavorite(symbol: string): void {
    const ticker = this.tickers.get(symbol);
    if (!ticker) return;

    ticker.isFavorite = !ticker.isFavorite;

    if (this.marketMode === "crypto_futures") {
      if (ticker.isFavorite) {
        this.cryptoFavorites.add(symbol);
      } else {
        this.cryptoFavorites.delete(symbol);
      }
      saveFavorites(this.cryptoFavorites);
    } else {
      if (ticker.isFavorite) {
        this.stockFavorites.add(symbol);
      } else {
        this.stockFavorites.delete(symbol);
      }
      saveStockFavorites(this.stockFavorites);
    }

    const refs = this.rowElements.get(symbol);
    if (refs) {
      refs.starEl.classList.toggle("favorited", ticker.isFavorite);
    }

    if (this.currentFilter === "favorites") {
      this.updateView();
    }
  }
}
