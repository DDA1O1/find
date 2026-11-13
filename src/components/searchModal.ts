import type { WatchlistTicker } from "../types";
import { formatPercent, formatPrice, formatVolume } from "../utils/formatters";

/**
 * TradingView-style global search modal.
 * Opens when the user presses any alphabet/number key on the keyboard (outside inputs).
 * Provides instant fuzzy search across all tickers with keyboard navigation.
 */
export class SearchModalComponent {
  private overlay!: HTMLElement;
  private modal!: HTMLElement;
  private input!: HTMLInputElement;
  private resultsList!: HTMLElement;
  private countEl!: HTMLElement;
  private noResultsEl!: HTMLElement;

  private tickers: Map<string, WatchlistTicker> = new Map();
  private filteredSymbols: string[] = [];
  private highlightedIndex = -1;
  private isOpen = false;

  private onSelect: (symbol: string) => void;

  constructor(onSelect: (symbol: string) => void) {
    this.onSelect = onSelect;
    this.createDOM();
    this.bindEvents();
  }

  /* ======================================================================== *
   *  DOM Construction
   * ======================================================================== */

  private createDOM(): void {
    this.overlay = document.createElement("div");
    this.overlay.className = "search-modal-overlay";
    this.overlay.style.display = "none";

    this.modal = document.createElement("div");
    this.modal.className = "search-modal";

    this.modal.innerHTML = `
      <div class="search-modal-header">
        <div class="search-modal-input-wrap">
          <svg class="search-modal-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            class="search-modal-input"
            placeholder="Search symbol, e.g. BTC, ETH, SOL…"
            spellcheck="false"
            autocomplete="off"
          />
          <kbd class="search-modal-kbd">ESC</kbd>
        </div>
      </div>
      <div class="search-modal-body">
        <div class="search-modal-meta">
          <span class="search-modal-count">0 results</span>
          <span class="search-modal-hint">
            <kbd>↑</kbd><kbd>↓</kbd> navigate &nbsp; <kbd>Enter</kbd> select
          </span>
        </div>
        <div class="search-modal-results"></div>
        <div class="search-modal-empty" style="display:none;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <span>No matching symbols found</span>
        </div>
      </div>
    `;

    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    this.input = this.modal.querySelector<HTMLInputElement>(".search-modal-input")!;
    this.resultsList = this.modal.querySelector<HTMLElement>(".search-modal-results")!;
    this.countEl = this.modal.querySelector<HTMLElement>(".search-modal-count")!;
    this.noResultsEl = this.modal.querySelector<HTMLElement>(".search-modal-empty")!;
  }

  /* ======================================================================== *
   *  Event Binding
   * ======================================================================== */

  private bindEvents(): void {
    // Close on overlay click (outside modal)
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // Search input handler
    this.input.addEventListener("input", () => {
      this.highlightedIndex = -1;
      this.filterAndRender();
    });

    // Keyboard navigation within the input
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveHighlight(1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveHighlight(-1);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        this.selectHighlighted();
        return;
      }
    });
  }

  /* ======================================================================== *
   *  Public API
   * ======================================================================== */

  public setTickers(tickers: Map<string, WatchlistTicker>): void {
    this.tickers = tickers;
  }

  /**
   * Open the search modal, optionally pre-filling the input with the initial keystroke.
   */
  public open(initialChar?: string): void {
    if (this.isOpen) return;
    this.isOpen = true;

    this.overlay.style.display = "flex";
    // Trigger enter animation next frame
    requestAnimationFrame(() => {
      this.overlay.classList.add("visible");
    });

    this.input.value = initialChar || "";
    this.highlightedIndex = -1;
    this.filterAndRender();

    // Focus after animation starts so the cursor appears
    requestAnimationFrame(() => {
      this.input.focus();
    });
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.overlay.classList.remove("visible");

    // Wait for the fade-out transition
    const onEnd = () => {
      this.overlay.style.display = "none";
      this.overlay.removeEventListener("transitionend", onEnd);
    };
    this.overlay.addEventListener("transitionend", onEnd);

    // Fallback if transitionend doesn't fire
    setTimeout(() => {
      this.overlay.style.display = "none";
    }, 200);
  }

  public get opened(): boolean {
    return this.isOpen;
  }

  /* ======================================================================== *
   *  Filtering & Rendering
   * ======================================================================== */

  private filterAndRender(): void {
    const query = this.input.value.trim().toUpperCase();

    let results: WatchlistTicker[];

    if (!query) {
      // Show top volume pairs when no query
      results = Array.from(this.tickers.values())
        .sort((a, b) => {
          // Favorites first, then by volume
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return b.quoteVolume24h - a.quoteVolume24h;
        })
        .slice(0, 50);
    } else {
      results = Array.from(this.tickers.values()).filter((t) => {
        const symMatch = t.symbol.includes(query);
        const baseMatch = t.baseAsset.includes(query);
        const nameMatch = t.name ? t.name.toUpperCase().includes(query) : false;
        return symMatch || baseMatch || nameMatch;
      });

      // Sort: exact base match first, then starts-with, then contains, finally by volume
      results.sort((a, b) => {
        const aExact = a.baseAsset === query ? 0 : 1;
        const bExact = b.baseAsset === query ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        const aStarts = a.baseAsset.startsWith(query) ? 0 : 1;
        const bStarts = b.baseAsset.startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;

        return b.quoteVolume24h - a.quoteVolume24h;
      });
    }

    this.filteredSymbols = results.map((t) => t.symbol);

    // Update count
    this.countEl.textContent = `${this.filteredSymbols.length} result${this.filteredSymbols.length !== 1 ? "s" : ""}`;

    if (this.filteredSymbols.length === 0) {
      this.resultsList.style.display = "none";
      this.noResultsEl.style.display = "flex";
      return;
    }

    this.noResultsEl.style.display = "none";
    this.resultsList.style.display = "block";

    // Build rows
    const fragment = document.createDocumentFragment();
    const queryForHighlight = query;

    for (let i = 0; i < this.filteredSymbols.length; i++) {
      const symbol = this.filteredSymbols[i];
      const ticker = this.tickers.get(symbol);
      if (!ticker) continue;

      const row = document.createElement("div");
      row.className = `search-result-row${i === this.highlightedIndex ? " highlighted" : ""}`;
      row.dataset.index = String(i);

      const isPos = ticker.change24h >= 0;
      const changeClass = isPos ? "pos" : "neg";

      const baseHighlighted = this.highlightMatch(ticker.baseAsset, queryForHighlight);
      const nameStr = ticker.name ? `<span class="search-result-name">${this.highlightMatch(ticker.name, queryForHighlight)}</span>` : "";

      let tagHtml = "";
      if (ticker.contractType === "TRADIFI_PERPETUAL") {
        tagHtml = '<span class="search-result-tag tradifi">TRADIFI</span>';
      } else {
        tagHtml = '<span class="search-result-tag perp">PERP</span>';
      }

      const starHtml = ticker.isFavorite
        ? '<span class="search-result-star favorited">★</span>'
        : "";

      row.innerHTML = `
        <div class="search-result-left">
          ${starHtml}
          <div class="search-result-symbol">
            <span class="search-result-base">${baseHighlighted}</span><span class="search-result-quote">/USDT</span>
            ${tagHtml}
          </div>
          ${nameStr}
        </div>
        <div class="search-result-right">
          <span class="search-result-price">${formatPrice(ticker.price)}</span>
          <span class="search-result-change ${changeClass}">${formatPercent(ticker.change24h)}</span>
          <span class="search-result-vol">${formatVolume(ticker.quoteVolume24h)}</span>
        </div>
      `;

      row.addEventListener("click", () => {
        this.selectSymbol(symbol);
      });

      row.addEventListener("mouseenter", () => {
        this.setHighlight(i);
      });

      fragment.appendChild(row);
    }

    this.resultsList.innerHTML = "";
    this.resultsList.appendChild(fragment);

    // Auto-highlight first result when typing
    if (query && this.highlightedIndex === -1 && this.filteredSymbols.length > 0) {
      this.setHighlight(0);
    }
  }

  private highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const upper = text.toUpperCase();
    const idx = upper.indexOf(query);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${before}<mark>${match}</mark>${after}`;
  }

  /* ======================================================================== *
   *  Keyboard Navigation
   * ======================================================================== */

  private moveHighlight(delta: number): void {
    if (this.filteredSymbols.length === 0) return;

    let newIndex = this.highlightedIndex + delta;
    if (newIndex < 0) newIndex = this.filteredSymbols.length - 1;
    if (newIndex >= this.filteredSymbols.length) newIndex = 0;

    this.setHighlight(newIndex);
  }

  private setHighlight(index: number): void {
    // Remove old highlight
    const oldEl = this.resultsList.querySelector(".search-result-row.highlighted");
    if (oldEl) oldEl.classList.remove("highlighted");

    this.highlightedIndex = index;

    const rows = this.resultsList.querySelectorAll<HTMLElement>(".search-result-row");
    const row = rows[index];
    if (row) {
      row.classList.add("highlighted");
      row.scrollIntoView({ block: "nearest" });
    }
  }

  private selectHighlighted(): void {
    if (this.highlightedIndex >= 0 && this.highlightedIndex < this.filteredSymbols.length) {
      this.selectSymbol(this.filteredSymbols[this.highlightedIndex]);
    }
  }

  private selectSymbol(symbol: string): void {
    this.close();
    this.onSelect(symbol);
  }
}
