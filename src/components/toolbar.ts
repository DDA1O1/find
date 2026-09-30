import type { CandleData, IndicatorSettings, Timeframe } from "../types";
import type { ChartType } from "../chart/chartManager";
import { formatPercent, formatPrice } from "../utils/formatters";

const TIMEFRAMES: Array<{ label: string; value: Timeframe }> = [
  { label: "1m", value: "1m" },
  { label: "3m", value: "3m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1H", value: "1h" },
  { label: "2H", value: "2h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
];

export class ToolbarComponent {
  private container: HTMLElement;
  private legendContainer: HTMLElement;
  private activeTimeframe: Timeframe = "15m";
  private activeChartType: ChartType = "candles";
  private indicatorSettings: IndicatorSettings;

  private onTimeframeChange: (tf: Timeframe) => void;
  private onChartTypeChange: (type: ChartType) => void;
  private onIndicatorChange: (settings: Partial<IndicatorSettings>) => void;

  private indicatorsDropdownOpen = false;

  constructor(
    container: HTMLElement,
    legendContainer: HTMLElement,
    initialTimeframe: Timeframe,
    initialIndicators: IndicatorSettings,
    onTimeframeChange: (tf: Timeframe) => void,
    onChartTypeChange: (type: ChartType) => void,
    onIndicatorChange: (settings: Partial<IndicatorSettings>) => void,
  ) {
    this.container = container;
    this.legendContainer = legendContainer;
    this.activeTimeframe = initialTimeframe;
    this.indicatorSettings = initialIndicators;
    this.onTimeframeChange = onTimeframeChange;
    this.onChartTypeChange = onChartTypeChange;
    this.onIndicatorChange = onIndicatorChange;

    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="toolbar-left">
        <div class="tf-group" id="tf-group">
          ${TIMEFRAMES.map(
            (tf) => `
            <button class="tb-btn tf-btn ${tf.value === this.activeTimeframe ? "active" : ""}" data-tf="${tf.value}">
              ${tf.label}
            </button>
          `,
          ).join("")}
        </div>

        <div class="tb-divider"></div>

        <div class="chart-type-group">
          <button class="tb-btn type-btn ${this.activeChartType === "candles" ? "active" : ""}" data-type="candles" title="Candlestick Chart">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="4" width="6" height="16" rx="1"/>
              <line x1="12" y1="1" x2="12" y2="4"/>
              <line x1="12" y1="20" x2="12" y2="23"/>
            </svg>
            <span>Candles</span>
          </button>
          <button class="tb-btn type-btn ${this.activeChartType === "line" ? "active" : ""}" data-type="line" title="Line Chart">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span>Line</span>
          </button>
          <button class="tb-btn type-btn ${this.activeChartType === "area" ? "active" : ""}" data-type="area" title="Area Chart">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3v18h18"/>
              <path d="M3 15l5-5 4 4 9-9v10H3z" fill="currentColor" fill-opacity="0.3"/>
            </svg>
            <span>Area</span>
          </button>
        </div>

        <div class="tb-divider"></div>

        <div class="indicators-menu-wrapper">
          <button class="tb-btn" id="btn-indicators">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 19 8 13 12 17 16 9 20 13"/>
              <line x1="4" y1="5" x2="20" y2="5"/>
            </svg>
            <span>Indicators</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div class="indicators-dropdown" id="indicators-dropdown" style="display: none;">
            <div class="dropdown-header">Technical Indicators</div>
            <label class="ind-item">
              <input type="checkbox" id="ind-ema20" ${this.indicatorSettings.ema20 ? "checked" : ""} />
              <span class="ind-color-box ema20"></span>
              <span class="ind-name">EMA 20</span>
            </label>
            <label class="ind-item">
              <input type="checkbox" id="ind-ema50" ${this.indicatorSettings.ema50 ? "checked" : ""} />
              <span class="ind-color-box ema50"></span>
              <span class="ind-name">EMA 50</span>
            </label>
            <label class="ind-item">
              <input type="checkbox" id="ind-sma200" ${this.indicatorSettings.sma200 ? "checked" : ""} />
              <span class="ind-color-box sma200"></span>
              <span class="ind-name">SMA 200</span>
            </label>
            <label class="ind-item">
              <input type="checkbox" id="ind-bb" ${this.indicatorSettings.bollingerBands ? "checked" : ""} />
              <span class="ind-color-box bb"></span>
              <span class="ind-name">Bollinger Bands (20, 2)</span>
            </label>
            <label class="ind-item">
              <input type="checkbox" id="ind-vol" ${this.indicatorSettings.volume ? "checked" : ""} />
              <span class="ind-color-box vol"></span>
              <span class="ind-name">Volume Histogram</span>
            </label>
          </div>
        </div>
      </div>
    `;

    // Timeframe click handler
    const tfBtns = this.container.querySelectorAll<HTMLButtonElement>(".tf-btn");
    tfBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tf = btn.dataset.tf as Timeframe;
        if (tf === this.activeTimeframe) return;

        tfBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.activeTimeframe = tf;
        this.onTimeframeChange(tf);
      });
    });

    // Chart Type click handler
    const typeBtns = this.container.querySelectorAll<HTMLButtonElement>(".type-btn");
    typeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type as ChartType;
        if (type === this.activeChartType) return;

        typeBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.activeChartType = type;
        this.onChartTypeChange(type);
      });
    });

    // Indicators Dropdown toggle
    const indBtn = this.container.querySelector<HTMLButtonElement>("#btn-indicators")!;
    const dropdown = this.container.querySelector<HTMLElement>("#indicators-dropdown")!;

    indBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.indicatorsDropdownOpen = !this.indicatorsDropdownOpen;
      dropdown.style.display = this.indicatorsDropdownOpen ? "block" : "none";
    });

    document.addEventListener("click", (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.indicatorsDropdownOpen = false;
        dropdown.style.display = "none";
      }
    });

    // Indicators Checkboxes
    const bindCheckbox = (id: string, key: keyof IndicatorSettings) => {
      const el = this.container.querySelector<HTMLInputElement>(id);
      el?.addEventListener("change", () => {
        this.indicatorSettings[key] = el.checked;
        this.onIndicatorChange({ [key]: el.checked });
      });
    };

    bindCheckbox("#ind-ema20", "ema20");
    bindCheckbox("#ind-ema50", "ema50");
    bindCheckbox("#ind-sma200", "sma200");
    bindCheckbox("#ind-bb", "bollingerBands");
    bindCheckbox("#ind-vol", "volume");
  }

  public updateLegend(symbol: string, candle: CandleData | null, isHovered: boolean): void {
    if (!candle) {
      this.legendContainer.innerHTML = "";
      return;
    }

    const change = candle.close - candle.open;
    const changePct = ((candle.close - candle.open) / candle.open) * 100;
    const isPos = change >= 0;
    const colorClass = isPos ? "pos" : "neg";

    const dateStr = new Date(candle.time * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    this.legendContainer.innerHTML = `
      <div class="legend-content">
        <span class="leg-sym">${symbol}</span>
        <span class="leg-tag ${isHovered ? "inspecting" : ""}">${isHovered ? "INSPECT" : "LATEST"}</span>
        <span class="leg-time">${dateStr}</span>
        <span class="leg-item"><span class="leg-lbl">O</span> <span class="${colorClass}">${formatPrice(candle.open)}</span></span>
        <span class="leg-item"><span class="leg-lbl">H</span> <span class="${colorClass}">${formatPrice(candle.high)}</span></span>
        <span class="leg-item"><span class="leg-lbl">L</span> <span class="${colorClass}">${formatPrice(candle.low)}</span></span>
        <span class="leg-item"><span class="leg-lbl">C</span> <span class="${colorClass}">${formatPrice(candle.close)}</span></span>
        <span class="leg-item ${colorClass}">${formatPercent(changePct)} (${change >= 0 ? "+" : ""}${formatPrice(change)})</span>
        <span class="leg-item"><span class="leg-lbl">Vol</span> <span>${candle.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
      </div>
    `;
  }
}
