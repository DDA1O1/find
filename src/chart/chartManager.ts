import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  ColorType,
  CrosshairMode,
  TrackingModeExitMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import type {
  CandleData,
  CorporateEvent,
  CorporateEventsData,
  IndicatorSettings,
  Timeframe,
} from "../types";
import { IndicatorService, type IndicatorCalculationResults } from "./indicatorService";
import {
  CorporateEventsPrimitive,
  formatDividendAmount,
  type LaidOutBadge,
} from "./corporateEventsPrimitive";

export type ChartType = "candles" | "line" | "area";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUtcEventDate(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export class ChartManager {
  private container: HTMLElement;
  private chart: IChartApi;
  private candleSeries: ISeriesApi<"Candlestick">;
  private lineSeries: ISeriesApi<"Line"> | null = null;
  private areaSeries: ISeriesApi<"Area"> | null = null;
  private volumeSeries: ISeriesApi<"Histogram">;

  // D3: Lazy-loaded indicator series (only instantiated when enabled)
  private ema20Series: ISeriesApi<"Line"> | null = null;
  private ema50Series: ISeriesApi<"Line"> | null = null;
  private sma200Series: ISeriesApi<"Line"> | null = null;
  private bbUpperSeries: ISeriesApi<"Line"> | null = null;
  private bbMiddleSeries: ISeriesApi<"Line"> | null = null;
  private bbLowerSeries: ISeriesApi<"Line"> | null = null;

  // C4: Web Worker indicator calculation service
  private indicatorService: IndicatorService;
  private corporateEventsPrimitive: CorporateEventsPrimitive;
  private eventTooltipEl: HTMLElement | null = null;

  private currentChartType: ChartType = "candles";
  private currentTimeframe: Timeframe = "1d";
  private candles: CandleData[] = [];
  private corporateEvents: CorporateEventsData | null = null;
  private hoveredEventId: string | null = null;
  private pinnedEventId: string | null = null;
  private indicatorSettings: IndicatorSettings = {
    ema20: false,
    ema50: false,
    sma200: false,
    bollingerBands: false,
    volume: true,
    corporateEvents: true,
  };

  private resizeObserver: ResizeObserver | null = null;
  private mobileQuery: MediaQueryList | null = null;
  private isMobileLayout = false;
  private mobileQueryListener?: (e: MediaQueryListEvent) => void;
  private onLegendUpdate?: (data: { candle: CandleData | null; isHovered: boolean }) => void;
  private isHovering = false;
  private hoveredCandle: CandleData | null = null;
  private crosshairUnsub?: () => void;
  private clickUnsub?: () => void;
  private visibleRangeUnsub?: () => void;
  private mouseLeaveListener?: () => void;
  private escapeKeyListener?: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    onLegendUpdate?: (data: { candle: CandleData | null; isHovered: boolean }) => void,
  ) {
    this.container = container;
    this.onLegendUpdate = onLegendUpdate;
    this.eventTooltipEl =
      this.container.parentElement?.querySelector<HTMLElement>("#chart-event-tooltip") ?? null;

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.mobileQuery = window.matchMedia("(max-width: 768px)");
      this.isMobileLayout = this.mobileQuery.matches;
    }

    this.chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#080a0f" },
        textColor: "#64748b",
        fontSize: 11,
        fontFamily: "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.025)" },
        horzLines: { color: "rgba(255, 255, 255, 0.025)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(148, 163, 184, 0.4)",
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: "#161c2d",
        },
        horzLine: {
          color: "rgba(148, 163, 184, 0.4)",
          width: 1,
          style: 3,
          labelBackgroundColor: "#161c2d",
        },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.06)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: this.isMobileLayout ? 6 : 12,
        barSpacing: this.isMobileLayout ? 6 : 8,
        minBarSpacing: 2,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.06)",
        scaleMargins: this.isMobileLayout
          ? { top: 0.08, bottom: 0.18 }
          : { top: 0.1, bottom: 0.24 },
        alignLabels: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      kineticScroll: {
        touch: true,
        mouse: false,
      },
      trackingMode: {
        exitMode: TrackingModeExitMode.OnTouchEnd,
      },
    });

    // Main Candlestick series
    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });

    // Volume histogram on custom scale 'volume'
    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "volume",
    });

    this.chart.priceScale("volume").applyOptions({
      scaleMargins: this.isMobileLayout ? { top: 0.82, bottom: 0 } : { top: 0.78, bottom: 0.055 },
    });

    // TradingView-style Split & Dividend badges along bottom rail of volume pane (desktop only)
    this.corporateEventsPrimitive = new CorporateEventsPrimitive();
    this.corporateEventsPrimitive.setVisible(this.shouldShowCorporateEvents());
    this.chart.panes()[0]?.attachPrimitive(this.corporateEventsPrimitive);

    // Initialize C4: Worker indicator service
    this.indicatorService = new IndicatorService((results) => {
      this.applyIndicatorResults(results);
    });

    this.setupResizeHandler();
    this.setupCrosshairHandler();
    this.setupEventInteractions();
    this.setupResponsiveLayoutListener();
  }

  private shouldShowCorporateEvents(): boolean {
    return !this.isMobileLayout && this.indicatorSettings.corporateEvents;
  }

  private setupResponsiveLayoutListener(): void {
    if (!this.mobileQuery) return;
    this.mobileQueryListener = (e: MediaQueryListEvent) => {
      this.isMobileLayout = e.matches;
      this.applyResponsiveChartOptions();
    };
    this.mobileQuery.addEventListener("change", this.mobileQueryListener);
  }

  private applyResponsiveChartOptions(): void {
    this.chart.timeScale().applyOptions({
      rightOffset: this.isMobileLayout ? 6 : 12,
      barSpacing: this.isMobileLayout ? 6 : 8,
    });
    this.chart.priceScale("right").applyOptions({
      scaleMargins: this.isMobileLayout ? { top: 0.08, bottom: 0.18 } : { top: 0.1, bottom: 0.24 },
    });
    this.chart.priceScale("volume").applyOptions({
      scaleMargins: this.isMobileLayout ? { top: 0.82, bottom: 0 } : { top: 0.78, bottom: 0.055 },
    });

    const showEvents = this.shouldShowCorporateEvents();
    this.corporateEventsPrimitive.setVisible(showEvents);
    if (!showEvents) {
      this.hoveredEventId = null;
      this.pinnedEventId = null;
      this.corporateEventsPrimitive.setActiveIds(null, null);
      this.refreshEventTooltip();
    }
  }

  private setupResizeHandler(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      this.chart.resize(Math.max(100, width), Math.max(100, height));
    });
    this.resizeObserver.observe(this.container);
  }

  private setupCrosshairHandler(): void {
    const handler = (param: MouseEventParams) => {
      if (
        !param.point ||
        param.point.x < 0 ||
        param.point.x > this.container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > this.container.clientHeight
      ) {
        this.updateHoveredEvent(null);
        if (this.onLegendUpdate) {
          this.isHovering = false;
          this.hoveredCandle = null;
          const lastCandle = this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
          this.onLegendUpdate({ candle: lastCandle, isHovered: false });
        }
        return;
      }

      const hoveredBadgeId =
        param.hoveredInfo?.sourceKind === "pane-primitive" &&
        typeof param.hoveredInfo.objectId === "string"
          ? param.hoveredInfo.objectId
          : null;
      this.updateHoveredEvent(hoveredBadgeId);

      if (!this.onLegendUpdate) return;

      let candle: CandleData | null = null;
      if (param.time) {
        candle = this.candlesMap().get(param.time as number) || null;
      }

      if (!candle && param.seriesData) {
        const bar = param.seriesData.get(this.candleSeries) as
          | { time: number; open: number; high: number; low: number; close: number }
          | undefined;
        if (bar && bar.open !== undefined) {
          const volData = param.seriesData.get(this.volumeSeries) as { value: number } | undefined;
          candle = {
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: volData?.value || 0,
          };
        }
      }

      if (candle) {
        this.isHovering = true;
        this.hoveredCandle = candle;
        this.onLegendUpdate({ candle, isHovered: true });
      }
    };

    this.chart.subscribeCrosshairMove(handler);
    this.crosshairUnsub = () => this.chart.unsubscribeCrosshairMove(handler);

    this.mouseLeaveListener = () => {
      this.updateHoveredEvent(null);
      this.isHovering = false;
      this.hoveredCandle = null;
      if (this.onLegendUpdate) {
        const lastCandle = this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
        this.onLegendUpdate({ candle: lastCandle, isHovered: false });
      }
    };
    this.container.addEventListener("mouseleave", this.mouseLeaveListener);
  }

  private setupEventInteractions(): void {
    const clickHandler = (param: MouseEventParams) => {
      if (!this.shouldShowCorporateEvents()) return;

      let clickedId =
        param.hoveredInfo?.sourceKind === "pane-primitive" &&
        typeof param.hoveredInfo.objectId === "string"
          ? param.hoveredInfo.objectId
          : null;

      if (!clickedId && param.point) {
        clickedId =
          this.corporateEventsPrimitive.getBadgeAtPoint(param.point.x, param.point.y)?.event.id ??
          null;
      }

      if (clickedId) {
        this.pinnedEventId = this.pinnedEventId === clickedId ? null : clickedId;
      } else if (this.pinnedEventId !== null) {
        this.pinnedEventId = null;
      } else {
        return;
      }

      this.corporateEventsPrimitive.setActiveIds(this.hoveredEventId, this.pinnedEventId);
      this.refreshEventTooltip();
    };

    this.chart.subscribeClick(clickHandler);
    this.clickUnsub = () => this.chart.unsubscribeClick(clickHandler);

    const rangeHandler = () => {
      if (!this.hoveredEventId && !this.pinnedEventId) return;
      requestAnimationFrame(() => this.refreshEventTooltip());
    };
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
    this.visibleRangeUnsub = () =>
      this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);

    this.escapeKeyListener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (this.pinnedEventId || this.hoveredEventId)) {
        this.pinnedEventId = null;
        this.hoveredEventId = null;
        this.corporateEventsPrimitive.setActiveIds(null, null);
        this.refreshEventTooltip();
      }
    };
    window.addEventListener("keydown", this.escapeKeyListener);
  }

  private updateHoveredEvent(hoveredId: string | null): void {
    const nextHovered = this.shouldShowCorporateEvents() ? hoveredId : null;
    if (this.hoveredEventId === nextHovered) return;
    this.hoveredEventId = nextHovered;
    this.corporateEventsPrimitive.setActiveIds(this.hoveredEventId, this.pinnedEventId);
    this.refreshEventTooltip();
  }

  private refreshEventTooltip(): void {
    const el = this.eventTooltipEl;
    if (!el) return;

    const activeId = this.hoveredEventId ?? this.pinnedEventId;
    if (!activeId || !this.shouldShowCorporateEvents()) {
      el.style.display = "none";
      el.classList.remove("pinned");
      return;
    }

    const badge: LaidOutBadge | null = this.corporateEventsPrimitive.getBadgeLayoutById(activeId);
    if (!badge) {
      el.style.display = "none";
      el.classList.remove("pinned");
      return;
    }

    const isPinned = this.pinnedEventId === activeId;
    el.classList.toggle("pinned", isPinned);
    el.innerHTML = this.renderEventTooltipHtml(badge.event, isPinned);

    el.style.visibility = "hidden";
    el.style.display = "block";

    const wrapperWidth = this.container.clientWidth || 600;
    const tipWidth = el.offsetWidth || 220;
    const tipHeight = el.offsetHeight || 96;

    const badgeCenterX = badge.x + badge.width / 2;
    const clampedLeft = Math.max(
      8,
      Math.min(wrapperWidth - tipWidth - 8, badgeCenterX - tipWidth / 2),
    );
    const top = Math.max(8, badge.y - tipHeight - 10);
    const caretLeft = Math.max(12, Math.min(tipWidth - 12, badgeCenterX - clampedLeft));

    el.style.left = `${clampedLeft}px`;
    el.style.top = `${top}px`;
    el.style.setProperty("--caret-left", `${caretLeft}px`);
    el.style.visibility = "visible";
  }

  private renderEventTooltipHtml(event: CorporateEvent, isPinned: boolean): string {
    const symbol = escapeHtml(this.corporateEvents?.symbol || "");
    const dateLabel = formatUtcEventDate(event.date);

    if (event.type === "split") {
      const tagClass = event.isUpcoming ? "upcoming-split" : "split";
      const tagText = event.isUpcoming ? "UPCOMING SPLIT" : "STOCK SPLIT";
      const ratioDesc =
        event.numerator >= event.denominator
          ? `${event.numerator} shares for every ${event.denominator}`
          : `${event.numerator} for ${event.denominator} reverse`;

      return `
        <div class="cet-header">
          <span class="cet-tag ${tagClass}">${tagText}</span>
          ${symbol ? `<span class="cet-sym">${symbol}</span>` : ""}
        </div>
        <div class="cet-primary">${escapeHtml(event.splitRatio)}</div>
        <div class="cet-rows">
          <div class="cet-row"><span>Effective</span><span>${escapeHtml(dateLabel)}</span></div>
          <div class="cet-row"><span>Terms</span><span>${escapeHtml(ratioDesc)}</span></div>
        </div>
        ${isPinned ? '<div class="cet-hint">Pinned · Click badge or Esc to close</div>' : ""}
      `;
    }

    const tagClass = event.isUpcoming ? "upcoming-div" : "dividend";
    const tagText = event.isUpcoming ? "UPCOMING DIVIDEND" : "DIVIDEND";
    const perShare = `${formatDividendAmount(event.amount, event.currency)} / share`;
    const annualStr =
      event.annualizedRate && event.annualizedRate > 0
        ? `${formatDividendAmount(event.annualizedRate, event.currency)}${event.yieldPercent ? ` (${event.yieldPercent})` : ""}`
        : event.yieldPercent || "";

    return `
      <div class="cet-header">
        <span class="cet-tag ${tagClass}">${tagText}</span>
        ${symbol ? `<span class="cet-sym">${symbol}</span>` : ""}
      </div>
      <div class="cet-primary">${escapeHtml(perShare)}</div>
      <div class="cet-rows">
        <div class="cet-row"><span>Ex-Dividend</span><span>${escapeHtml(dateLabel)}</span></div>
        ${event.paymentDate ? `<div class="cet-row"><span>Pay Date</span><span>${escapeHtml(event.paymentDate)}</span></div>` : ""}
        ${annualStr ? `<div class="cet-row"><span>Annual / Yield</span><span>${escapeHtml(annualStr)}</span></div>` : ""}
      </div>
      ${isPinned ? '<div class="cet-hint">Pinned · Click badge or Esc to close</div>' : ""}
    `;
  }

  private _candlesMapCache: Map<number, CandleData> | null = null;
  private candlesMap(): Map<number, CandleData> {
    if (!this._candlesMapCache) {
      this._candlesMapCache = new Map();
      for (const c of this.candles) {
        this._candlesMapCache.set(c.time, c);
      }
    }
    return this._candlesMapCache;
  }

  /* ======================================================================== *
   *  D3: Lazy-Load Indicator Series Creation
   * ======================================================================== */

  private getOrCreateEma20(): ISeriesApi<"Line"> {
    if (!this.ema20Series) {
      this.ema20Series = this.chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    return this.ema20Series;
  }

  private getOrCreateEma50(): ISeriesApi<"Line"> {
    if (!this.ema50Series) {
      this.ema50Series = this.chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    return this.ema50Series;
  }

  private getOrCreateSma200(): ISeriesApi<"Line"> {
    if (!this.sma200Series) {
      this.sma200Series = this.chart.addSeries(LineSeries, {
        color: "#a855f7",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    return this.sma200Series;
  }

  private getOrCreateBollingerBands(): {
    upper: ISeriesApi<"Line">;
    middle: ISeriesApi<"Line">;
    lower: ISeriesApi<"Line">;
  } {
    if (!this.bbUpperSeries) {
      this.bbUpperSeries = this.chart.addSeries(LineSeries, {
        color: "rgba(6, 182, 212, 0.75)",
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    if (!this.bbMiddleSeries) {
      this.bbMiddleSeries = this.chart.addSeries(LineSeries, {
        color: "rgba(6, 182, 212, 0.4)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    if (!this.bbLowerSeries) {
      this.bbLowerSeries = this.chart.addSeries(LineSeries, {
        color: "rgba(6, 182, 212, 0.75)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    return {
      upper: this.bbUpperSeries,
      middle: this.bbMiddleSeries,
      lower: this.bbLowerSeries,
    };
  }

  /**
   * Adjusts price precision dynamically based on symbol asset price (e.g. BTC vs PEPE)
   */
  public setPrecision(price: number): void {
    let precision = 2;
    let minMove = 0.01;

    if (price < 0.0001) {
      precision = 8;
      minMove = 0.00000001;
    } else if (price < 0.01) {
      precision = 6;
      minMove = 0.000001;
    } else if (price < 1) {
      precision = 4;
      minMove = 0.0001;
    } else if (price < 10) {
      precision = 3;
      minMove = 0.001;
    } else if (price < 1000) {
      precision = 2;
      minMove = 0.01;
    } else {
      precision = 2;
      minMove = 0.1;
    }

    const priceFormat = { type: "price" as const, precision, minMove };
    this.candleSeries.applyOptions({ priceFormat });
    if (this.lineSeries) this.lineSeries.applyOptions({ priceFormat });
    if (this.areaSeries) this.areaSeries.applyOptions({ priceFormat });
  }

  /**
   * Sets historical candle data
   */
  public setData(
    candles: CandleData[],
    timeframe?: Timeframe,
    events?: CorporateEventsData | null,
  ): void {
    this.isHovering = false;
    this.hoveredCandle = null;
    this.hoveredEventId = null;
    this.pinnedEventId = null;
    this.candles = candles;
    this._candlesMapCache = null;

    if (timeframe) {
      this.currentTimeframe = timeframe;
    }
    if (events !== undefined) {
      this.corporateEvents = events;
    }

    if (candles.length > 0) {
      this.setPrecision(candles[candles.length - 1].close);
    }

    const formattedCandles = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const formattedVolume = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)",
    }));

    if (this.currentChartType === "candles") {
      this.candleSeries.setData(formattedCandles);
    } else if (this.currentChartType === "line" && this.lineSeries) {
      this.lineSeries.setData(
        candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
      );
    } else if (this.currentChartType === "area" && this.areaSeries) {
      this.areaSeries.setData(
        candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
      );
    }

    if (this.indicatorSettings.volume) {
      this.volumeSeries.setData(formattedVolume);
    } else {
      this.volumeSeries.setData([]);
    }

    this.recalculateIndicators();
    this.chart.timeScale().fitContent();

    this.corporateEventsPrimitive.setActiveIds(null, null);
    this.corporateEventsPrimitive.setData(
      this.candles,
      this.currentTimeframe,
      this.corporateEvents,
    );
    this.refreshEventTooltip();

    if (this.onLegendUpdate) {
      const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
      this.onLegendUpdate({ candle: lastCandle, isHovered: false });
    }
  }

  /**
   * Updates corporate events (splits & dividends) asynchronously without resetting zoom/pan
   */
  public setCorporateEvents(events: CorporateEventsData | null): void {
    this.corporateEvents = events;
    this.corporateEventsPrimitive.setData(
      this.candles,
      this.currentTimeframe,
      this.corporateEvents,
    );
    this.refreshEventTooltip();
  }

  /**
   * Real-time update from WebSocket
   */
  public updateCandle(candle: CandleData, isClosed: boolean): void {
    if (this.candles.length === 0) {
      this.setData([candle]);
      return;
    }

    const lastIdx = this.candles.length - 1;
    const last = this.candles[lastIdx];
    const pushedNewBar = candle.time > last.time;

    if (candle.time === last.time) {
      this.candles[lastIdx] = candle;
    } else if (pushedNewBar) {
      this.candles.push(candle);
    }

    this._candlesMapCache = null;

    const formattedCandle = {
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    };

    if (this.currentChartType === "candles") {
      this.candleSeries.update(formattedCandle);
    } else if (this.currentChartType === "line" && this.lineSeries) {
      this.lineSeries.update({ time: candle.time as UTCTimestamp, value: candle.close });
    } else if (this.currentChartType === "area" && this.areaSeries) {
      this.areaSeries.update({ time: candle.time as UTCTimestamp, value: candle.close });
    }

    if (this.indicatorSettings.volume) {
      this.volumeSeries.update({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(8, 153, 129, 0.4)" : "rgba(242, 54, 69, 0.4)",
      });
    }

    if (isClosed || this.candles.length % 5 === 0) {
      this.recalculateIndicators();
    }

    if (pushedNewBar && this.corporateEvents) {
      this.corporateEventsPrimitive.setData(
        this.candles,
        this.currentTimeframe,
        this.corporateEvents,
      );
    }

    if (this.onLegendUpdate) {
      if (this.isHovering) {
        if (this.hoveredCandle && this.hoveredCandle.time === candle.time) {
          this.hoveredCandle = candle;
          this.onLegendUpdate({ candle, isHovered: true });
        }
      } else {
        this.onLegendUpdate({ candle, isHovered: false });
      }
    }
  }

  /**
   * Dispatches calculation to Web Worker (C4)
   */
  public recalculateIndicators(): void {
    if (this.candles.length === 0) return;
    this.indicatorService.calculate(this.candles, this.indicatorSettings);
  }

  /**
   * Receives results from Web Worker or sync calculation (C4)
   */
  private applyIndicatorResults(results: IndicatorCalculationResults): void {
    // EMA 20
    if (this.indicatorSettings.ema20 && results.ema20) {
      this.getOrCreateEma20().setData(
        results.ema20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.ema20Series) {
      this.ema20Series.setData([]);
    }

    // EMA 50
    if (this.indicatorSettings.ema50 && results.ema50) {
      this.getOrCreateEma50().setData(
        results.ema50.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.ema50Series) {
      this.ema50Series.setData([]);
    }

    // SMA 200
    if (this.indicatorSettings.sma200 && results.sma200) {
      this.getOrCreateSma200().setData(
        results.sma200.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.sma200Series) {
      this.sma200Series.setData([]);
    }

    // Bollinger Bands
    if (this.indicatorSettings.bollingerBands && results.bollingerBands) {
      const bb = this.getOrCreateBollingerBands();
      bb.upper.setData(
        results.bollingerBands.upper.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      bb.middle.setData(
        results.bollingerBands.middle.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        })),
      );
      bb.lower.setData(
        results.bollingerBands.lower.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.bbUpperSeries) {
      this.bbUpperSeries.setData([]);
      this.bbMiddleSeries?.setData([]);
      this.bbLowerSeries?.setData([]);
    }
  }

  public setChartType(type: ChartType): void {
    if (this.currentChartType === type) return;
    this.currentChartType = type;

    // Remove existing alternative series if switching
    if (this.lineSeries) {
      this.chart.removeSeries(this.lineSeries);
      this.lineSeries = null;
    }
    if (this.areaSeries) {
      this.chart.removeSeries(this.areaSeries);
      this.areaSeries = null;
    }

    if (type === "candles") {
      this.candleSeries.applyOptions({ visible: true });
    } else {
      this.candleSeries.applyOptions({ visible: false });

      if (type === "line") {
        this.lineSeries = this.chart.addSeries(LineSeries, {
          color: "#2962ff",
          lineWidth: 2,
        });
        this.lineSeries.setData(
          this.candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
        );
      } else if (type === "area") {
        this.areaSeries = this.chart.addSeries(AreaSeries, {
          topColor: "rgba(41, 98, 255, 0.4)",
          bottomColor: "rgba(41, 98, 255, 0.0)",
          lineColor: "#2962ff",
          lineWidth: 2,
        });
        this.areaSeries.setData(
          this.candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
        );
      }
    }

    if (this.candles.length > 0) {
      this.setPrecision(this.candles[this.candles.length - 1].close);
    }
  }

  public setIndicators(settings: Partial<IndicatorSettings>): void {
    this.indicatorSettings = { ...this.indicatorSettings, ...settings };
    this.recalculateIndicators();
    if (!this.indicatorSettings.volume) {
      this.volumeSeries.setData([]);
    } else {
      this.volumeSeries.setData(
        this.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(8, 153, 129, 0.4)" : "rgba(242, 54, 69, 0.4)",
        })),
      );
    }

    const showEvents = this.shouldShowCorporateEvents();
    this.corporateEventsPrimitive.setVisible(showEvents);
    if (!showEvents) {
      this.hoveredEventId = null;
      this.pinnedEventId = null;
      this.corporateEventsPrimitive.setActiveIds(null, null);
      this.refreshEventTooltip();
    }
  }

  public getIndicators(): IndicatorSettings {
    return { ...this.indicatorSettings };
  }

  public fitContent(): void {
    this.chart.timeScale().fitContent();
  }

  /**
   * C5: Comprehensive teardown method
   */
  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.mobileQuery && this.mobileQueryListener) {
      this.mobileQuery.removeEventListener("change", this.mobileQueryListener);
      this.mobileQueryListener = undefined;
    }
    if (this.crosshairUnsub) {
      this.crosshairUnsub();
      this.crosshairUnsub = undefined;
    }
    if (this.clickUnsub) {
      this.clickUnsub();
      this.clickUnsub = undefined;
    }
    if (this.visibleRangeUnsub) {
      this.visibleRangeUnsub();
      this.visibleRangeUnsub = undefined;
    }
    if (this.mouseLeaveListener) {
      this.container.removeEventListener("mouseleave", this.mouseLeaveListener);
      this.mouseLeaveListener = undefined;
    }
    if (this.escapeKeyListener) {
      window.removeEventListener("keydown", this.escapeKeyListener);
      this.escapeKeyListener = undefined;
    }
    this.chart.panes()[0]?.detachPrimitive(this.corporateEventsPrimitive);
    this.indicatorService.destroy();
    this.chart.remove();
  }
}
