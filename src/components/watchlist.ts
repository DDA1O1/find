import type { WatchlistTicker } from "../types";
import { formatPercent, formatPrice, formatVolume } from "../utils/formatters";
import { getSavedFavorites, saveFavorites } from "../api/binance";
import { eventBus } from "../core/eventBus";

export type WatchlistFilter = "all" | "crypto" | "tradifi" | "favorites";
export type WatchlistSortCol = "volume" | "change";
export type WatchlistSortDir = "asc" | "desc";

export interface WatchlistOptions {
  initialFilter?: WatchlistFilter;
  initialSortCol?: WatchlistSortCol;
  initialSortDir?: WatchlistSortDir;
  onCollapseChange?: (collapsed: boolean) => void;
}

const ROW_HEIGHT = 52; // px per row
const OVERSCAN = 6; // rows above and below visible area
const MOBILE_BREAKPOINT = 768;

export class WatchlistComponent {
  private container: HTMLElement;
  private tickers: Map<string, WatchlistTicker> = new Map();
  private sortedSymbols: string[] = [];
  private activeSymbol = "BTCUSDT";
  private currentFilter: WatchlistFilter = "all";
  private searchQuery = "";
  private onSelectSymbol: (symbol: string) => void;
  private onCollapseChange?: (collapsed: boolean) => void;

  private favorites: Set<string>;

  // Sort state
  private sortCol: WatchlistSortCol = "volume";
  private sortDir: WatchlistSortDir = "desc";

  // DOM Elements
  private listEl!: HTMLElement;
  private scrollSpacer!: HTMLElement;
  private itemsViewport!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private countBadgeEl!: HTMLElement;
  private tabsContainerEl!: HTMLElement;
  private clearBtn!: HTMLButtonElement;
  private dragHandleEl!: HTMLElement;

  // D1: Debounce handle for search
  private searchDebounceTimer: number | null = null;

  // D2: RAF batched ticker updates
  private pendingUpdates = new Map<string, Partial<WatchlistTicker>>();
  private rafUpdateHandle: number | null = null;

  // C3: Virtual scrolling state
  private visibleStartIndex = -1;
  private visibleEndIndex = -1;
  private renderedRows = new Map<
    string,
    {
      row: HTMLElement;
      priceEl: HTMLElement;
      changeEl: HTMLElement;
      starEl: HTMLElement;
    }
  >();

  // A7: Mobile bottom sheet swipe state
  private touchStartY = 0;
  private touchCurrentY = 0;
  private isDraggingSheet = false;

  // Event handler references for cleanup (C5)
  private boundOnScroll: () => void;
  private boundOnResize: () => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: () => void;
  private isDestroyed = false;

  constructor(
    container: HTMLElement,
    initialActiveSymbol: string,
    onSelectSymbol: (symbol: string) => void,
    options: WatchlistOptions = {},
  ) {
    this.container = container;
    this.activeSymbol = initialActiveSymbol;
    this.onSelectSymbol = onSelectSymbol;
    this.onCollapseChange = options.onCollapseChange;

    const validFilters: WatchlistFilter[] = ["all", "crypto", "tradifi", "favorites"];
    const resolvedFilter = validFilters.includes(options.initialFilter as WatchlistFilter)
      ? (options.initialFilter as WatchlistFilter)
      : "all";
    const isMobile = typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT;
    this.currentFilter = isMobile && resolvedFilter === "favorites" ? "all" : resolvedFilter;
    this.sortCol = options.initialSortCol === "change" ? "change" : "volume";
    this.sortDir = options.initialSortDir === "asc" ? "asc" : "desc";

    this.favorites = getSavedFavorites();

    this.boundOnScroll = () => this.handleScroll();
    this.boundOnResize = () => this.handleScroll();
    this.boundTouchStart = (e) => this.handleTouchStart(e);
    this.boundTouchMove = (e) => this.handleTouchMove(e);
    this.boundTouchEnd = () => this.handleTouchEnd();

    this.renderSkeleton();
  }

  private renderSkeleton(): void {
    this.container.innerHTML = `
      <!-- A7: Mobile bottom sheet drag handle bar -->
      <div class="bottom-sheet-drag-handle" id="wl-drag-handle">
        <span class="drag-bar"></span>
      </div>

      <div class="watchlist-header">
        <div class="watchlist-title-row">
          <div class="watchlist-title">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3v18h18"/>
              <path d="m19 9-5 5-4-4-3 3"/>
            </svg>
            <span id="wl-market-label">USDT-M Futures</span>
            <span class="badge" id="wl-count">0</span>
          </div>
          <button type="button" class="wl-close-btn" id="wl-close" title="Close watchlist" aria-label="Close watchlist">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="watchlist-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="wl-search" placeholder="Search pairs (BTC, ETH, SOL, NVDA)..." spellcheck="false" autocomplete="off" />
          <button id="wl-clear" class="btn-clear" title="Clear search" style="display: none;">×</button>
        </div>

        <div class="watchlist-tabs" id="wl-tabs">
          <button class="wl-tab" data-filter="all">All</button>
          <button class="wl-tab" data-filter="crypto">Crypto</button>
          <button class="wl-tab" data-filter="tradifi">TradiFi</button>
          <button class="wl-tab" data-filter="favorites">★ Starred</button>
        </div>

        <div class="wl-col-header">
          <div class="wl-col-left">
            <span class="wl-col-sym">Symbol</span>
            <button class="wl-sort-btn ${this.sortCol === "volume" ? "active" : ""}" data-col="volume" title="Sort by Market Cap">
              Mkt Cap <span class="wl-sort-arrow">${this.sortCol === "volume" ? (this.sortDir === "desc" ? "↓" : "↑") : ""}</span>
            </button>
          </div>
          <div class="wl-col-right">
            <span class="wl-col-last">Last</span>
            <button class="wl-sort-btn ${this.sortCol === "change" ? "active" : ""}" data-col="change" title="Sort by 24h Change %">
              Chg% <span class="wl-sort-arrow">${this.sortCol === "change" ? (this.sortDir === "desc" ? "↓" : "↑") : ""}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- C3: Virtual Scroll container -->
      <div class="watchlist-list" id="wl-list">
        <div class="wl-scroll-spacer" id="wl-spacer"></div>
        <div class="wl-items-viewport" id="wl-viewport"></div>
        <div class="wl-loading" id="wl-loading">
          <div class="spinner"></div>
          <span>Loading Binance Futures pairs...</span>
        </div>
        <div class="wl-empty" id="wl-empty" style="display: none;">
          <span>No matching futures pairs found</span>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector("#wl-list")!;
    this.scrollSpacer = this.container.querySelector("#wl-spacer")!;
    this.itemsViewport = this.container.querySelector("#wl-viewport")!;
    this.searchInput = this.container.querySelector("#wl-search")!;
    this.countBadgeEl = this.container.querySelector("#wl-count")!;
    this.tabsContainerEl = this.container.querySelector("#wl-tabs")!;
    this.clearBtn = this.container.querySelector<HTMLButtonElement>("#wl-clear")!;
    this.dragHandleEl = this.container.querySelector("#wl-drag-handle")!;

    const closeBtn = this.container.querySelector<HTMLButtonElement>("#wl-close");
    closeBtn?.addEventListener("click", () => {
      this.container.classList.add("collapsed");
      this.onCollapseChange?.(true);
    });

    // D1: Debounced search input handler (70ms)
    this.searchInput.addEventListener("input", () => {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      const rawVal = this.searchInput.value;
      this.clearBtn.style.display = rawVal ? "block" : "none";

      this.searchDebounceTimer = window.setTimeout(() => {
        this.searchQuery = rawVal.trim().toUpperCase();
        this.filterAndSort();
        this.renderVirtual(true);
      }, 70);
    });

    // Instant clear
    this.clearBtn.addEventListener("click", () => {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchInput.value = "";
      this.searchQuery = "";
      this.clearBtn.style.display = "none";
      this.searchInput.focus();
      this.filterAndSort();
      this.renderVirtual(true);
    });

    // Category filter tabs — set initial active state from this.currentFilter
    const tabs = this.tabsContainerEl.querySelectorAll<HTMLButtonElement>(".wl-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.filter === this.currentFilter);
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        this.currentFilter = (tab.dataset.filter as WatchlistFilter) || "all";
        this.filterAndSort();
        this.renderVirtual(true);
        // Emit for persistence
        eventBus.emit("watchlist:filterChange", { filter: this.currentFilter });
      });
    });

    // Sort buttons
    const sortBtns = this.container.querySelectorAll<HTMLButtonElement>(".wl-sort-btn");
    sortBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.col as WatchlistSortCol;
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
        } else {
          this.sortCol = col;
          this.sortDir = "desc";
        }
        this.updateSortHeader();
        this.filterAndSort();
        this.renderVirtual(true);
        // Emit for persistence
        eventBus.emit("watchlist:sortChange", { col: this.sortCol, dir: this.sortDir });
      });
    });

    // C3: Virtual Scroll listeners
    this.listEl.addEventListener("scroll", this.boundOnScroll, { passive: true });
    window.addEventListener("resize", this.boundOnResize, { passive: true });

    // A7: Mobile bottom sheet swipe listeners
    this.dragHandleEl.addEventListener("touchstart", this.boundTouchStart, { passive: true });
    this.dragHandleEl.addEventListener("touchmove", this.boundTouchMove, { passive: false });
    this.dragHandleEl.addEventListener("touchend", this.boundTouchEnd, { passive: true });
  }

  /* ======================================================================== *
   *  Sort header update
   * ======================================================================== */

  private updateSortHeader(): void {
    const btns = this.container.querySelectorAll<HTMLButtonElement>(".wl-sort-btn");
    btns.forEach((btn) => {
      const col = btn.dataset.col as WatchlistSortCol;
      const isActive = col === this.sortCol;
      btn.classList.toggle("active", isActive);
      const arrowEl = btn.querySelector(".wl-sort-arrow");
      if (arrowEl) {
        arrowEl.textContent = isActive ? (this.sortDir === "desc" ? "↓" : "↑") : "";
      }
    });
  }

  public ensureMobileFilter(): void {
    if (typeof window === "undefined" || window.innerWidth > MOBILE_BREAKPOINT) return;
    if (this.currentFilter !== "favorites") return;

    this.currentFilter = "all";
    const tabs = this.tabsContainerEl.querySelectorAll<HTMLButtonElement>(".wl-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.filter === "all");
    });
    this.filterAndSort();
    this.renderVirtual(true);
  }

  /* ======================================================================== *
   *  A7: Responsive Mobile Bottom Sheet Swipe Gestures
   * ======================================================================== */

  private handleTouchStart(e: TouchEvent): void {
    if (window.innerWidth > MOBILE_BREAKPOINT) return;
    this.isDraggingSheet = true;
    this.touchStartY = e.touches[0].clientY;
    this.touchCurrentY = this.touchStartY;
    this.container.style.transition = "none";
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.isDraggingSheet || window.innerWidth > MOBILE_BREAKPOINT) return;
    this.touchCurrentY = e.touches[0].clientY;
    const deltaY = this.touchCurrentY - this.touchStartY;

    // Only allow dragging downwards (to collapse/peek)
    if (deltaY > 0) {
      e.preventDefault();
      this.container.style.transform = `translateY(${deltaY}px)`;
    }
  }

  private handleTouchEnd(): void {
    if (!this.isDraggingSheet || window.innerWidth > MOBILE_BREAKPOINT) return;
    this.isDraggingSheet = false;
    this.container.style.transition = "";

    const deltaY = this.touchCurrentY - this.touchStartY;
    if (deltaY > 80) {
      // Swiped down sufficiently -> collapse sheet
      this.container.classList.add("collapsed");
      this.container.style.transform = "";
      this.onCollapseChange?.(true);
    } else {
      // Snap back to open
      this.container.style.transform = "";
    }
  }

  /* ======================================================================== *
   *  C3: Virtual Scrolling Implementation
   * ======================================================================== */

  private handleScroll(): void {
    this.renderVirtual(false);
  }

  private renderVirtual(forceReset = false): void {
    const total = this.sortedSymbols.length;
    this.scrollSpacer.style.height = `${total * ROW_HEIGHT}px`;

    const loadingEl = this.container.querySelector("#wl-loading") as HTMLElement | null;
    const emptyEl = this.container.querySelector("#wl-empty") as HTMLElement | null;

    if (loadingEl) loadingEl.style.display = "none";

    if (total === 0) {
      if (emptyEl) emptyEl.style.display = "flex";
      this.itemsViewport.innerHTML = "";
      this.renderedRows.clear();
      this.visibleStartIndex = -1;
      this.visibleEndIndex = -1;
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    const scrollTop = this.listEl.scrollTop;
    const clientHeight = this.listEl.clientHeight || 500;

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(
      total - 1,
      Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN,
    );

    // If visible window hasn't shifted significantly and no force reset, skip
    if (!forceReset && startIndex === this.visibleStartIndex && endIndex === this.visibleEndIndex) {
      return;
    }

    this.visibleStartIndex = startIndex;
    this.visibleEndIndex = endIndex;

    // Position items viewport to top of visible range
    this.itemsViewport.style.transform = `translateY(${startIndex * ROW_HEIGHT}px)`;

    const fragment = document.createDocumentFragment();
    this.renderedRows.clear();

    for (let i = startIndex; i <= endIndex; i++) {
      const symbol = this.sortedSymbols[i];
      const ticker = this.tickers.get(symbol);
      if (!ticker) continue;

      const row = document.createElement("div");
      row.className = `wl-row ${symbol === this.activeSymbol ? "active" : ""}`;
      row.dataset.symbol = symbol;
      row.style.height = `${ROW_HEIGHT}px`;

      const isPos = ticker.change24h >= 0;
      const tagHtml =
        ticker.contractType === "TRADIFI_PERPETUAL"
          ? `<span class="wl-tradifi-tag">TRADIFI</span>${ticker.industry ? `<span class="wl-industry-tag">; ${ticker.industry}</span>` : ""}`
          : ticker.industry
            ? `<span class="wl-industry-tag crypto-tag">${ticker.industry}</span>`
            : "";

      const volSubtitle = ticker.name
        ? `${ticker.name} • ${formatVolume(ticker.quoteVolume24h)}`
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
            <span class="quote">/USDT</span>
            ${tagHtml}
          </div>
          <div class="wl-sym-vol">${volSubtitle}</div>
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

      this.renderedRows.set(symbol, { row, priceEl, changeEl, starEl });
      fragment.appendChild(row);
    }

    this.itemsViewport.innerHTML = "";
    this.itemsViewport.appendChild(fragment);
  }

  /* ======================================================================== *
   *  D2: RAF-Batched Ticker Price Updates
   * ======================================================================== */

  public updateTickerPrices(updates: Map<string, Partial<WatchlistTicker>>): void {
    if (this.isDestroyed) return;

    // Accumulate into pending map
    for (const [sym, patch] of updates) {
      const existing = this.pendingUpdates.get(sym);
      if (existing) {
        Object.assign(existing, patch);
      } else {
        this.pendingUpdates.set(sym, { ...patch });
      }
    }

    if (this.rafUpdateHandle === null) {
      this.rafUpdateHandle = requestAnimationFrame(() => {
        this.flushPendingUpdates();
      });
    }
  }

  private flushPendingUpdates(): void {
    this.rafUpdateHandle = null;
    if (this.isDestroyed || this.pendingUpdates.size === 0) return;

    for (const [symbol, patch] of this.pendingUpdates) {
      const ticker = this.tickers.get(symbol);
      if (!ticker) continue;

      const oldPrice = ticker.price;
      if (patch.price !== undefined) ticker.price = patch.price;
      if (patch.change24h !== undefined) ticker.change24h = patch.change24h;
      if (patch.high24h !== undefined) ticker.high24h = patch.high24h;
      if (patch.low24h !== undefined) ticker.low24h = patch.low24h;
      if (patch.volume24h !== undefined) ticker.volume24h = patch.volume24h;
      if (patch.quoteVolume24h !== undefined) ticker.quoteVolume24h = patch.quoteVolume24h;

      // Update visible row DOM if rendered
      const refs = this.renderedRows.get(symbol);
      if (refs) {
        refs.priceEl.textContent = formatPrice(ticker.price);
        refs.changeEl.textContent = formatPercent(ticker.change24h);

        const isPos = ticker.change24h >= 0;
        refs.changeEl.className = `wl-change ${isPos ? "pos" : "neg"}`;

        if (patch.price !== undefined && oldPrice > 0 && patch.price !== oldPrice) {
          const flashClass = patch.price > oldPrice ? "flash-up" : "flash-down";
          refs.priceEl.classList.remove("flash-up", "flash-down");
          void refs.priceEl.offsetWidth; // Reflow for animation restart
          refs.priceEl.classList.add(flashClass);
        }
      }
    }

    this.pendingUpdates.clear();
  }

  public updateSingleTickerPrice(symbol: string, price: number): void {
    const ticker = this.tickers.get(symbol);
    if (!ticker) return;

    const oldPrice = ticker.price;
    ticker.price = price;

    const refs = this.renderedRows.get(symbol);
    if (!refs) return;

    refs.priceEl.textContent = formatPrice(price);
    if (oldPrice > 0 && price !== oldPrice) {
      const flashClass = price > oldPrice ? "flash-up" : "flash-down";
      refs.priceEl.classList.remove("flash-up", "flash-down");
      void refs.priceEl.offsetWidth;
      refs.priceEl.classList.add(flashClass);
    }
  }

  /* ======================================================================== *
   *  Data & Selection Methods
   * ======================================================================== */

  public setTickers(tickers: WatchlistTicker[]): void {
    this.tickers.clear();
    for (const t of tickers) {
      t.isFavorite = this.favorites.has(t.symbol);
      this.tickers.set(t.symbol, t);
    }
    this.filterAndSort();
    this.renderVirtual(true);
    this.ensureSymbolVisible(this.activeSymbol);
  }

  public syncTickers(freshTickers: WatchlistTicker[]): { added: string[]; removed: string[] } {
    const freshMap = new Map<string, WatchlistTicker>();
    for (const t of freshTickers) {
      t.isFavorite = this.favorites.has(t.symbol);
      freshMap.set(t.symbol, t);
    }

    const added: string[] = [];
    const removed: string[] = [];

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

    for (const symbol of this.tickers.keys()) {
      if (!freshMap.has(symbol)) {
        removed.push(symbol);
        this.tickers.delete(symbol);
      }
    }

    if (added.length > 0 || removed.length > 0) {
      this.filterAndSort();
      this.renderVirtual(true);
    }

    return { added, removed };
  }

  public setActiveSymbol(symbol: string): void {
    if (this.activeSymbol === symbol) {
      this.ensureSymbolVisible(symbol);
      return;
    }

    const oldRefs = this.renderedRows.get(this.activeSymbol);
    if (oldRefs) oldRefs.row.classList.remove("active");

    this.activeSymbol = symbol;
    this.ensureSymbolVisible(symbol);

    const newRefs = this.renderedRows.get(symbol);
    if (newRefs) newRefs.row.classList.add("active");
  }

  private ensureSymbolVisible(symbol: string): void {
    const idx = this.sortedSymbols.indexOf(symbol);
    if (idx === -1) return;
    const itemTop = idx * ROW_HEIGHT;
    const itemBottom = itemTop + ROW_HEIGHT;
    const scrollTop = this.listEl.scrollTop;
    const clientHeight = this.listEl.clientHeight || 500;
    if (itemTop < scrollTop + ROW_HEIGHT) {
      this.listEl.scrollTop = Math.max(0, itemTop - ROW_HEIGHT);
      this.renderVirtual(true);
    } else if (itemBottom > scrollTop + clientHeight - ROW_HEIGHT) {
      this.listEl.scrollTop = itemTop - clientHeight + ROW_HEIGHT * 2;
      this.renderVirtual(true);
    } else if (!this.renderedRows.has(symbol)) {
      this.renderVirtual(true);
    }
  }

  public scrollToSymbol(symbol: string): void {
    const idx = this.sortedSymbols.indexOf(symbol);
    if (idx !== -1) {
      this.listEl.scrollTop = Math.max(0, idx * ROW_HEIGHT - 100);
      this.renderVirtual(true);
    }
  }

  private filterAndSort(): void {
    let list = Array.from(this.tickers.values());

    if (this.searchQuery) {
      list = list.filter((t) => {
        const symMatch = t.symbol.includes(this.searchQuery);
        const baseMatch = t.baseAsset.includes(this.searchQuery);
        const nameMatch = t.name ? t.name.toUpperCase().includes(this.searchQuery) : false;
        return symMatch || baseMatch || nameMatch;
      });
    }

    // Filter phase
    if (this.currentFilter === "crypto") {
      list = list.filter((t) => t.contractType === "PERPETUAL" || !t.contractType);
    } else if (this.currentFilter === "tradifi") {
      list = list.filter((t) => t.contractType === "TRADIFI_PERPETUAL");
    } else if (this.currentFilter === "favorites") {
      list = list.filter((t) => t.isFavorite);
    }

    // Sort phase
    if (this.sortCol === "change") {
      list = list.sort((a, b) =>
        this.sortDir === "desc" ? b.change24h - a.change24h : a.change24h - b.change24h,
      );
    } else {
      // "volume" = market cap (quoteVolume24h)
      list = list.sort((a, b) => {
        // Always pin favorites to top in default sort
        if (this.currentFilter === "all") {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
        }
        return this.sortDir === "desc"
          ? b.quoteVolume24h - a.quoteVolume24h
          : a.quoteVolume24h - b.quoteVolume24h;
      });
    }

    this.sortedSymbols = list.map((t) => t.symbol);
    this.countBadgeEl.textContent = this.sortedSymbols.length.toString();
  }

  public updateView(): void {
    this.filterAndSort();
    this.renderVirtual(true);
    this.ensureSymbolVisible(this.activeSymbol);
  }

  public toggleFavorite(symbol?: string): boolean | null {
    const targetSymbol = symbol || this.activeSymbol;
    const ticker = this.tickers.get(targetSymbol);
    if (!ticker) return null;

    ticker.isFavorite = !ticker.isFavorite;

    if (ticker.isFavorite) {
      this.favorites.add(targetSymbol);
    } else {
      this.favorites.delete(targetSymbol);
    }
    saveFavorites(this.favorites);

    const refs = this.renderedRows.get(targetSymbol);
    if (refs) {
      refs.starEl.classList.toggle("favorited", ticker.isFavorite);
    }

    if (this.currentFilter === "favorites") {
      this.updateView();
    }

    return ticker.isFavorite;
  }

  public selectNextSymbol(): void {
    if (this.sortedSymbols.length === 0) return;
    const currentIdx = this.sortedSymbols.indexOf(this.activeSymbol);
    const nextIdx = currentIdx < this.sortedSymbols.length - 1 ? currentIdx + 1 : 0;
    const nextSymbol = this.sortedSymbols[nextIdx];
    this.setActiveSymbol(nextSymbol);
    this.onSelectSymbol(nextSymbol);
  }

  public selectPrevSymbol(): void {
    if (this.sortedSymbols.length === 0) return;
    const currentIdx = this.sortedSymbols.indexOf(this.activeSymbol);
    const prevIdx = currentIdx > 0 ? currentIdx - 1 : this.sortedSymbols.length - 1;
    const prevSymbol = this.sortedSymbols[prevIdx];
    this.setActiveSymbol(prevSymbol);
    this.onSelectSymbol(prevSymbol);
  }

  public getAdjacentSymbols(count = 5): string[] {
    if (this.sortedSymbols.length === 0) return [];
    const currentIdx = this.sortedSymbols.indexOf(this.activeSymbol);
    if (currentIdx === -1) return [];

    const adjacent: string[] = [];
    for (let i = 1; i <= count; i++) {
      const nextIdx = (currentIdx + i) % this.sortedSymbols.length;
      adjacent.push(this.sortedSymbols[nextIdx]);
    }
    return adjacent;
  }

  /**
   * C5: Lifecycle teardown method
   */
  public destroy(): void {
    this.isDestroyed = true;
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.rafUpdateHandle !== null) {
      cancelAnimationFrame(this.rafUpdateHandle);
      this.rafUpdateHandle = null;
    }
    this.listEl.removeEventListener("scroll", this.boundOnScroll);
    window.removeEventListener("resize", this.boundOnResize);

    this.dragHandleEl.removeEventListener("touchstart", this.boundTouchStart);
    this.dragHandleEl.removeEventListener("touchmove", this.boundTouchMove);
    this.dragHandleEl.removeEventListener("touchend", this.boundTouchEnd);

    this.renderedRows.clear();
    this.pendingUpdates.clear();
  }
}
