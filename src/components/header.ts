import type { WatchlistTicker } from "../types";
import { formatPercent, formatPrice, formatVolume } from "../utils/formatters";

export class HeaderComponent {
  private container: HTMLElement;
  private currentTicker: WatchlistTicker | null = null;
  private onToggleSidebar: () => void;
  private onFitChart: () => void;

  private symbolTitleEl!: HTMLElement;
  private priceEl!: HTMLElement;
  private changeEl!: HTMLElement;
  private highEl!: HTMLElement;
  private lowEl!: HTMLElement;
  private volEl!: HTMLElement;
  private statusDotEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private fullscreenBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, onToggleSidebar: () => void, onFitChart: () => void) {
    this.container = container;
    this.onToggleSidebar = onToggleSidebar;
    this.onFitChart = onFitChart;

    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="header-left">
        <div class="brand">
          <svg class="brand-icon" width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="5" fill="#2962FF"/>
            <path d="M7 16V12M12 16V8M17 16V10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          <div class="brand-text">
            <span class="brand-title">TRADINGVIEW <span class="accent">FUTURES</span></span>
            <span class="brand-sub">BINANCE USDT-M</span>
          </div>
        </div>

        <div class="divider"></div>

        <div class="active-sym-container">
          <div class="active-sym-meta">
            <h1 class="active-sym-title" id="hdr-symbol">BTCUSDT</h1>
            <span class="contract-badge">PERP</span>
          </div>
          <div class="active-price-box">
            <span class="active-price" id="hdr-price">--</span>
            <span class="active-change" id="hdr-change">--</span>
          </div>
        </div>

        <div class="stats-row">
          <div class="stat-item">
            <span class="stat-label">24h High</span>
            <span class="stat-val" id="hdr-high">--</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">24h Low</span>
            <span class="stat-val" id="hdr-low">--</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">24h Vol (USDT)</span>
            <span class="stat-val" id="hdr-vol">--</span>
          </div>
        </div>
      </div>

      <div class="header-right">
        <div class="status-indicator" id="hdr-status" title="Binance WebSocket Connection">
          <span class="status-dot connecting" id="hdr-status-dot"></span>
          <span class="status-text" id="hdr-status-text">Connecting...</span>
        </div>

        <button class="hdr-btn" id="hdr-fit" title="Fit Chart (Auto Scale)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 3 21 3 21 9"/>
            <polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <span>Fit</span>
        </button>

        <button class="hdr-btn" id="hdr-fullscreen" title="Toggle Fullscreen">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>

        <button class="hdr-btn toggle-sidebar-btn" id="hdr-toggle-sidebar" title="Toggle Watchlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
      </div>
    `;

    this.symbolTitleEl = this.container.querySelector("#hdr-symbol")!;
    this.priceEl = this.container.querySelector("#hdr-price")!;
    this.changeEl = this.container.querySelector("#hdr-change")!;
    this.highEl = this.container.querySelector("#hdr-high")!;
    this.lowEl = this.container.querySelector("#hdr-low")!;
    this.volEl = this.container.querySelector("#hdr-vol")!;
    this.statusDotEl = this.container.querySelector("#hdr-status-dot")!;
    this.statusTextEl = this.container.querySelector("#hdr-status-text")!;
    this.fullscreenBtn = this.container.querySelector("#hdr-fullscreen")!;

    const fitBtn = this.container.querySelector<HTMLButtonElement>("#hdr-fit")!;
    fitBtn.addEventListener("click", () => this.onFitChart());

    const toggleSidebarBtn =
      this.container.querySelector<HTMLButtonElement>("#hdr-toggle-sidebar")!;
    toggleSidebarBtn.addEventListener("click", () => this.onToggleSidebar());

    this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
  }

  public setTicker(ticker: WatchlistTicker): void {
    this.currentTicker = { ...ticker };

    this.symbolTitleEl.textContent = ticker.symbol;
    this.priceEl.textContent = formatPrice(ticker.price);

    const isPos = ticker.change24h >= 0;
    this.changeEl.textContent = formatPercent(ticker.change24h);
    this.changeEl.className = `active-change ${isPos ? "pos" : "neg"}`;

    this.highEl.textContent = formatPrice(ticker.high24h);
    this.lowEl.textContent = formatPrice(ticker.low24h);
    this.volEl.textContent = formatVolume(ticker.quoteVolume24h);
  }

  public updatePriceOnly(price: number): void {
    if (this.currentTicker) {
      this.currentTicker.price = price;
    }

    this.priceEl.textContent = formatPrice(price);
  }

  public setStatus(status: "connecting" | "connected" | "disconnected"): void {
    this.statusDotEl.className = `status-dot ${status}`;
    if (status === "connected") {
      this.statusTextEl.textContent = "Live Feed";
    } else if (status === "connecting") {
      this.statusTextEl.textContent = "Connecting...";
    } else {
      this.statusTextEl.textContent = "Reconnecting...";
    }
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Error attempting to enable fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Error attempting to exit fullscreen:", err);
      });
    }
  }
}
