import type { WatchlistTicker } from "../types";
import {
  classifyCorrelation,
  getSuggestedBenchmarks,
  lookupRelativityAtTime,
  resolveDefaultBenchmark,
  type BenchmarkChoice,
  type RelativityPoint,
  type RelativitySeriesResult,
} from "../indicators/relativity";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCorrPercent(r: number): string {
  const pct = Math.round(r * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function formatBeta(beta: number): string {
  return `${beta.toFixed(2)}x`;
}

export class RelativityHudComponent {
  private container: HTMLElement;
  private onBenchmarkSelect: (benchmarkSymbol: string | null) => void;

  private activeSymbol = "";
  private activeBenchmarkSymbol = "";
  private activeBenchmarkReason = "";
  private isCustomBenchmark = false;
  private isLoading = false;
  private series: RelativitySeriesResult | null = null;
  private allTickers: Map<string, WatchlistTicker> = new Map();

  private popoverOpen = false;
  private pillEl!: HTMLElement;
  private benchBtn!: HTMLButtonElement;
  private benchLabelEl!: HTMLElement;
  private metricsWrapEl!: HTMLElement;
  private corrValEl!: HTMLElement;
  private betaValEl!: HTMLElement;
  private windowEl!: HTMLElement;
  private tagEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private popoverEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLElement;
  private resetBtn!: HTMLButtonElement;

  private documentClickListener?: (e: MouseEvent) => void;
  private keydownListener?: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, onBenchmarkSelect: (benchmarkSymbol: string | null) => void) {
    this.container = container;
    this.onBenchmarkSelect = onBenchmarkSelect;
    this.renderSkeleton();
    this.bindEvents();
  }

  private renderSkeleton(): void {
    this.container.innerHTML = `
      <div class="relativity-pill" id="rel-pill" style="display: none;">
        <button
          type="button"
          class="rel-bench-btn"
          id="rel-bench-btn"
          aria-haspopup="listbox"
          aria-expanded="false"
          title="Click to change correlation benchmark"
        >
          <span class="rel-vs">vs</span>
          <span class="rel-bench-sym" id="rel-bench-sym">--</span>
          <svg class="rel-chevron" aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div class="rel-metrics" id="rel-metrics">
          <span class="rel-sep">·</span>
          <span class="rel-item"><span class="leg-lbl">Corr</span> <span class="rel-val" id="rel-corr">--</span></span>
          <span class="rel-sep">·</span>
          <span class="rel-item"><span class="leg-lbl">β</span> <span class="rel-val" id="rel-beta">--</span></span>
          <span class="rel-sep">·</span>
          <span class="rel-window" id="rel-window">100D</span>
          <span class="rel-tag" id="rel-tag"></span>
        </div>

        <span class="rel-status" id="rel-status" style="display: none;"></span>
      </div>

      <div class="rel-popover" id="rel-popover" style="display: none;" role="dialog" aria-label="Select benchmark symbol">
        <div class="rel-popover-head">
          <span class="rel-popover-title">Correlate Against (100D)</span>
          <button type="button" class="rel-reset-btn" id="rel-reset-btn" style="display: none;">Reset</button>
        </div>
        <div class="rel-search-wrap">
          <input
            type="text"
            class="rel-search-input"
            id="rel-search-input"
            placeholder="Search symbol (NVDA, XAU, SMH, SPY...)"
            spellcheck="false"
            autocomplete="off"
          />
        </div>
        <div class="rel-popover-list" id="rel-popover-list" role="listbox"></div>
      </div>
    `;

    this.pillEl = this.container.querySelector("#rel-pill")!;
    this.benchBtn = this.container.querySelector<HTMLButtonElement>("#rel-bench-btn")!;
    this.benchLabelEl = this.container.querySelector("#rel-bench-sym")!;
    this.metricsWrapEl = this.container.querySelector("#rel-metrics")!;
    this.corrValEl = this.container.querySelector("#rel-corr")!;
    this.betaValEl = this.container.querySelector("#rel-beta")!;
    this.windowEl = this.container.querySelector("#rel-window")!;
    this.tagEl = this.container.querySelector("#rel-tag")!;
    this.statusEl = this.container.querySelector("#rel-status")!;
    this.popoverEl = this.container.querySelector("#rel-popover")!;
    this.searchInput = this.container.querySelector<HTMLInputElement>("#rel-search-input")!;
    this.listEl = this.container.querySelector("#rel-popover-list")!;
    this.resetBtn = this.container.querySelector<HTMLButtonElement>("#rel-reset-btn")!;
  }

  private bindEvents(): void {
    this.benchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.popoverOpen) {
        this.closePopover();
      } else {
        this.openPopover();
      }
    });

    this.resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closePopover();
      this.onBenchmarkSelect(null);
    });

    this.searchInput.addEventListener("input", () => {
      this.renderPopoverList(this.searchInput.value);
    });

    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closePopover();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const firstOpt = this.listEl.querySelector<HTMLButtonElement>(".rel-option");
        const sym = firstOpt?.dataset.symbol;
        if (sym) {
          this.selectBenchmark(sym);
        }
      }
    });

    this.listEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(".rel-option");
      const sym = btn?.dataset.symbol;
      if (sym) {
        this.selectBenchmark(sym);
      }
    });

    this.documentClickListener = (e: MouseEvent) => {
      if (this.popoverOpen && !this.container.contains(e.target as Node)) {
        this.closePopover();
      }
    };
    document.addEventListener("click", this.documentClickListener);

    this.keydownListener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.popoverOpen) {
        this.closePopover();
      }
    };
    window.addEventListener("keydown", this.keydownListener);
  }

  public setTickers(tickers: Map<string, WatchlistTicker>): void {
    this.allTickers = tickers;
  }

  public setLoading(
    activeSymbol: string,
    benchmarkSymbol: string,
    benchmarkReason: string,
    isCustom: boolean,
  ): void {
    this.activeSymbol = activeSymbol;
    this.activeBenchmarkSymbol = benchmarkSymbol;
    this.activeBenchmarkReason = benchmarkReason;
    this.isCustomBenchmark = isCustom;
    this.isLoading = true;
    this.series = null;

    this.pillEl.style.display = "inline-flex";
    this.updateBenchmarkChip();
    this.metricsWrapEl.style.display = "none";
    this.statusEl.style.display = "inline";
    this.statusEl.textContent = "· Calculating 100D…";
  }

  public setSeries(series: RelativitySeriesResult, isCustom: boolean): void {
    this.activeSymbol = series.assetSymbol;
    this.activeBenchmarkSymbol = series.benchmarkSymbol;
    this.activeBenchmarkReason = series.benchmarkReason;
    this.isCustomBenchmark = isCustom;
    this.isLoading = false;
    this.series = series;

    this.pillEl.style.display = "inline-flex";
    this.updateBenchmarkChip();
    this.renderPoint(series.latest, false);
  }

  public updateForTimestamp(timestampSec: number | null, isHovered: boolean): void {
    if (this.isLoading || !this.series) return;

    if (!isHovered || timestampSec === null) {
      this.renderPoint(this.series.latest, false);
      return;
    }

    const point = lookupRelativityAtTime(this.series.points, timestampSec);
    this.renderPoint(point, true);
  }

  private updateBenchmarkChip(): void {
    const base = this.activeBenchmarkSymbol.replace(/USDT$/, "");
    this.benchLabelEl.textContent = base;
    this.benchBtn.classList.toggle("custom", this.isCustomBenchmark);
    this.benchBtn.title = `${this.activeBenchmarkReason} (${this.activeBenchmarkSymbol}) · Click to change benchmark`;
    this.resetBtn.style.display = this.isCustomBenchmark ? "inline-flex" : "none";
  }

  private renderPoint(point: RelativityPoint | null, isHovered: boolean): void {
    if (!point) {
      this.metricsWrapEl.style.display = "none";
      this.statusEl.style.display = "inline";
      this.statusEl.textContent =
        isHovered && this.series && this.series.points.length > 0
          ? "· Early history (<10D)"
          : "· Insufficient 1D history";
      return;
    }

    const badge = classifyCorrelation(point.correlation);

    this.statusEl.style.display = "none";
    this.metricsWrapEl.style.display = "inline-flex";

    this.corrValEl.textContent = formatCorrPercent(point.correlation);
    this.corrValEl.className = `rel-val corr-${badge.tone}`;

    this.betaValEl.textContent = formatBeta(point.beta);
    this.betaValEl.className = `rel-val ${point.beta < 0 ? "neg" : ""}`;

    this.windowEl.textContent = `${point.sampleSize}D`;
    this.windowEl.title = `Rolling ${point.sampleSize} daily trading sessions (R² ${Math.round(point.rSquared * 100)}%)`;

    this.tagEl.textContent = badge.label;
    this.tagEl.className = `rel-tag ${badge.tone}`;
    this.tagEl.title = `${Math.round(point.rSquared * 100)}% of daily movement explained by ${this.activeBenchmarkSymbol.replace(/USDT$/, "")}`;
  }

  private openPopover(): void {
    if (!this.activeSymbol) return;
    this.popoverOpen = true;
    this.popoverEl.style.display = "block";
    this.benchBtn.setAttribute("aria-expanded", "true");
    this.searchInput.value = "";
    this.renderPopoverList("");
    requestAnimationFrame(() => this.searchInput.focus());
  }

  private closePopover(): void {
    if (!this.popoverOpen) return;
    this.popoverOpen = false;
    this.popoverEl.style.display = "none";
    this.benchBtn.setAttribute("aria-expanded", "false");
  }

  private selectBenchmark(symbol: string): void {
    const normalized = symbol.trim().toUpperCase();
    const defaultSym = resolveDefaultBenchmark(this.activeSymbol).symbol;
    this.closePopover();
    this.onBenchmarkSelect(normalized === defaultSym ? null : normalized);
  }

  private renderPopoverList(rawQuery: string): void {
    const query = rawQuery.trim().toUpperCase();
    const defaultChoice = resolveDefaultBenchmark(this.activeSymbol);

    let items: Array<{ symbol: string; baseAsset: string; subtitle: string; isDefault?: boolean }>;

    if (!query) {
      const presets: BenchmarkChoice[] = getSuggestedBenchmarks(this.activeSymbol);
      items = presets.map((p) => ({
        symbol: p.symbol,
        baseAsset: p.baseAsset,
        subtitle: p.symbol === defaultChoice.symbol ? `${p.reason} · Default` : p.reason,
        isDefault: p.symbol === defaultChoice.symbol,
      }));
    } else {
      const matches = Array.from(this.allTickers.values())
        .filter((t) => {
          if (t.symbol === this.activeSymbol) return false;
          const symMatch = t.symbol.includes(query);
          const baseMatch = t.baseAsset.includes(query);
          const nameMatch = t.name ? t.name.toUpperCase().includes(query) : false;
          return symMatch || baseMatch || nameMatch;
        })
        .sort((a, b) => {
          const aExact = a.baseAsset === query ? 0 : 1;
          const bExact = b.baseAsset === query ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          const aStarts = a.baseAsset.startsWith(query) ? 0 : 1;
          const bStarts = b.baseAsset.startsWith(query) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return b.quoteVolume24h - a.quoteVolume24h;
        })
        .slice(0, 12);

      items = matches.map((t) => ({
        symbol: t.symbol,
        baseAsset: t.baseAsset,
        subtitle: t.name || t.industry || "Perpetual",
        isDefault: t.symbol === defaultChoice.symbol,
      }));
    }

    if (items.length === 0) {
      this.listEl.innerHTML = `<div class="rel-empty">No matching symbols</div>`;
      return;
    }

    this.listEl.innerHTML = items
      .map((item) => {
        const isActive = item.symbol === this.activeBenchmarkSymbol;
        return `
          <button
            type="button"
            class="rel-option ${isActive ? "active" : ""}"
            data-symbol="${escapeHtml(item.symbol)}"
            role="option"
            aria-selected="${isActive}"
          >
            <span class="rel-opt-sym">${escapeHtml(item.baseAsset)}</span>
            <span class="rel-opt-sub">${escapeHtml(item.subtitle)}</span>
            ${isActive ? '<span class="rel-opt-check">✓</span>' : ""}
          </button>
        `;
      })
      .join("");
  }

  public destroy(): void {
    if (this.documentClickListener) {
      document.removeEventListener("click", this.documentClickListener);
      this.documentClickListener = undefined;
    }
    if (this.keydownListener) {
      window.removeEventListener("keydown", this.keydownListener);
      this.keydownListener = undefined;
    }
    this.container.innerHTML = "";
  }
}
