import type { WatchlistTicker } from "../types";
import { formatPercent, formatPrice, formatVolume } from "../utils/formatters";
import { getSavedFavorites, saveFavorites } from "../api/binance";

export type WatchlistFilter =
  | "all"
  | "crypto"
  | "tradifi"
  | "favorites"
  | "gainers"
  | "losers"
  | "volume";

export class WatchlistComponent {
  private container: HTMLElement;
  private tickers: Map<string, WatchlistTicker> = new Map();
  private sortedSymbols: string[] = [];
  private activeSymbol = "BTCUSDT";
  private currentFilter: WatchlistFilter = "all";
  private searchQuery = "";
  private onSelectSymbol: (symbol: string) => void;
  private favorites: Set<string>;

  private listEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private countBadgeEl!: HTMLElement;
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
    onSelectSymbol: (symbol: string) => void,
  ) {
    this.container = container;
    this.activeSymbol = initialActiveSymbol;
    this.onSelectSymbol = onSelectSymbol;
    this.favorites = getSavedFavorites();

    this.renderSkeleton();
  }

  private renderSkeleton(): void {
    this.container.innerHTML = `
      <div class="watchlist-header">
        <div class="watchlist-title-row">
          <div class="watchlist-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3v18h18"/>
              <path d="m19 9-5 5-4-4-3 3"/>
            </svg>
            <span>Watchlist</span>
            <span class="badge" id="wl-count">0</span>
          </div>
        </div>

        <div class="watchlist-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="wl-search" placeholder="Search pairs (e.g. BTC, ETH, SOL)..." spellcheck="false" autocomplete="off" />
          <button id="wl-clear" class="btn-clear" title="Clear search" style="display: none;">×</button>
        </div>

        <div class="watchlist-tabs">
          <button class="wl-tab active" data-filter="all">All</button>
          <button class="wl-tab" data-filter="crypto">Crypto</button>
          <button class="wl-tab" data-filter="tradifi">TradiFi</button>
          <button class="wl-tab" data-filter="favorites">★ Starred</button>
          <button class="wl-tab" data-filter="gainers">Gainers</button>
          <button class="wl-tab" data-filter="losers">Losers</button>
          <button class="wl-tab" data-filter="volume">Volume</button>
        </div>
      </div>

      <div class="watchlist-list" id="wl-list">
        <div class="wl-loading">
          <div class="spinner"></div>
          <span>Loading Binance Futures pairs...</span>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector("#wl-list")!;
    this.searchInput = this.container.querySelector("#wl-search")!;
    this.countBadgeEl = this.container.querySelector("#wl-count")!;
    const clearBtn = this.container.querySelector<HTMLButtonElement>("#wl-clear")!;

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

    // Tab buttons event
    const tabs = this.container.querySelectorAll<HTMLButtonElement>(".wl-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        this.currentFilter = (tab.dataset.filter as WatchlistFilter) || "all";
        this.updateView();
      });
    });
  }

  public setTickers(tickers: WatchlistTicker[]): void {
    this.tickers.clear();
    for (const t of tickers) {
      t.isFavorite = this.favorites.has(t.symbol);
      this.tickers.set(t.symbol, t);
    }
    this.updateView();
  }

  /**
   * Automatically synchronizes new coin listings and purges delisted coins
   */
  public syncTickers(freshTickers: WatchlistTicker[]): { added: string[]; removed: string[] } {
    const freshMap = new Map<string, WatchlistTicker>();
    for (const t of freshTickers) {
      t.isFavorite = this.favorites.has(t.symbol);
      freshMap.set(t.symbol, t);
    }

    const added: string[] = [];
    const removed: string[] = [];

    // Find added coins
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

    // Find removed/purged coins
    for (const symbol of this.tickers.keys()) {
      if (!freshMap.has(symbol)) {
        removed.push(symbol);
        this.tickers.delete(symbol);
      }
    }

    // Rebuild view only if coins were added or removed
    if (added.length > 0 || removed.length > 0) {
      this.updateView();
    }

    return { added, removed };
  }

  public setActiveSymbol(symbol: string): void {
    if (this.activeSymbol === symbol) return;
    const oldRow = this.rowElements.get(this.activeSymbol)?.row;
    oldRow?.classList.remove("active");

    this.activeSymbol = symbol;
    const newRow = this.rowElements.get(symbol)?.row;
    newRow?.classList.add("active");
  }

  /**
   * Applies partial updates pushed from WebSocket without rebuilding whole DOM
   */
  public updateTickerPrices(updates: Map<string, Partial<WatchlistTicker>>): void {
    for (const [symbol, patch] of updates) {
      const existing = this.tickers.get(symbol);
      if (!existing) continue;

      const oldPrice = existing.price;
      Object.assign(existing, patch);

      const rowRefs = this.rowElements.get(symbol);
      if (rowRefs) {
        // Price update
        if (patch.price !== undefined && patch.price !== oldPrice) {
          rowRefs.priceEl.textContent = formatPrice(patch.price);
        }

        // Change percentage update
        if (patch.change24h !== undefined) {
          const isPos = patch.change24h >= 0;
          rowRefs.changeEl.textContent = formatPercent(patch.change24h);
          rowRefs.changeEl.className = `wl-change ${isPos ? "pos" : "neg"}`;
        }
      }
    }
  }

  /**
   * Updates price for a single symbol (e.g. from active kline trade ticks)
   */
  public updateSingleTickerPrice(symbol: string, newPrice: number): void {
    const existing = this.tickers.get(symbol);
    if (!existing) return;

    if (existing.price === newPrice) return;
    existing.price = newPrice;

    const rowRefs = this.rowElements.get(symbol);
    if (rowRefs) {
      rowRefs.priceEl.textContent = formatPrice(newPrice);
    }
  }

  private filterAndSort(): string[] {
    let list = Array.from(this.tickers.values());

    // Search query filter
    if (this.searchQuery) {
      list = list.filter(
        (t) => t.symbol.includes(this.searchQuery) || t.baseAsset.includes(this.searchQuery),
      );
    }

    // Tab filter
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
          <span>No matching futures pairs found</span>
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

      row.innerHTML = `
        <button class="wl-star ${ticker.isFavorite ? "favorited" : ""}" title="Favorite" aria-label="Favorite ${ticker.baseAsset}">
          ★
        </button>
        <div class="wl-sym-info">
          <div class="wl-sym-title">
            <span class="base">${ticker.baseAsset}</span>
            <span class="quote">/USDT</span>
            ${ticker.contractType === "TRADIFI_PERPETUAL" ? '<span class="wl-tradifi-tag">TRADIFI</span>' : ""}
          </div>
          <div class="wl-sym-vol">${formatVolume(ticker.quoteVolume24h)}</div>
        </div>
        <div class="wl-price-col">
          <div class="wl-price">${formatPrice(ticker.price)}</div>
          <div class="wl-change ${isPos ? "pos" : "neg"}">${formatPercent(ticker.change24h)}</div>
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
  }

  private toggleFavorite(symbol: string): void {
    const ticker = this.tickers.get(symbol);
    if (!ticker) return;

    ticker.isFavorite = !ticker.isFavorite;
    if (ticker.isFavorite) {
      this.favorites.add(symbol);
    } else {
      this.favorites.delete(symbol);
    }
    saveFavorites(this.favorites);

    const refs = this.rowElements.get(symbol);
    if (refs) {
      refs.starEl.classList.toggle("favorited", ticker.isFavorite);
    }

    if (this.currentFilter === "favorites") {
      this.updateView();
    }
  }
}
