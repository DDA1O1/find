import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import type { CandleData, IndicatorSettings } from "../types";
import { calculateBollingerBands, calculateEMA, calculateSMA } from "../indicators/ma";

export type ChartType = "candles" | "line" | "area";

export class ChartManager {
  private container: HTMLElement;
  private chart: IChartApi;
  private candleSeries: ISeriesApi<"Candlestick">;
  private lineSeries: ISeriesApi<"Line"> | null = null;
  private areaSeries: ISeriesApi<"Area"> | null = null;
  private volumeSeries: ISeriesApi<"Histogram">;

  // Indicators
  private ema20Series: ISeriesApi<"Line"> | null = null;
  private ema50Series: ISeriesApi<"Line"> | null = null;
  private sma200Series: ISeriesApi<"Line"> | null = null;
  private bbUpperSeries: ISeriesApi<"Line"> | null = null;
  private bbMiddleSeries: ISeriesApi<"Line"> | null = null;
  private bbLowerSeries: ISeriesApi<"Line"> | null = null;

  private currentChartType: ChartType = "candles";
  private candles: CandleData[] = [];
  private indicatorSettings: IndicatorSettings = {
    ema20: false,
    ema50: false,
    sma200: false,
    bollingerBands: false,
    volume: true,
  };

  private resizeObserver: ResizeObserver | null = null;
  private onLegendUpdate?: (data: { candle: CandleData | null; isHovered: boolean }) => void;

  constructor(
    container: HTMLElement,
    onLegendUpdate?: (data: { candle: CandleData | null; isHovered: boolean }) => void,
  ) {
    this.container = container;
    this.onLegendUpdate = onLegendUpdate;

    this.chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#848e9c",
        fontSize: 12,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(42, 46, 57, 0.5)" },
        horzLines: { color: "rgba(42, 46, 57, 0.5)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#758696",
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: "#2a2e39",
        },
        horzLine: {
          color: "#758696",
          width: 1,
          style: 3,
          labelBackgroundColor: "#2a2e39",
        },
      },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      rightPriceScale: {
        borderColor: "#2a2e39",
        scaleMargins: {
          top: 0.1,
          bottom: 0.22, // leave room for volume
        },
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
    });

    // Main Candlestick series
    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#f23645",
      borderVisible: false,
      wickUpColor: "#089981",
      wickDownColor: "#f23645",
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
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    this.setupResizeHandler();
    this.setupCrosshairHandler();
    this.createIndicatorSeries();
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
    this.chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!this.onLegendUpdate) return;

      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > this.container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > this.container.clientHeight
      ) {
        const lastCandle = this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
        this.onLegendUpdate({ candle: lastCandle, isHovered: false });
        return;
      }

      const candleMap = this.candlesMap();
      const candle = candleMap.get(param.time as number) || null;
      this.onLegendUpdate({ candle, isHovered: true });
    });
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

  private createIndicatorSeries(): void {
    // EMA 20 (Cyan)
    this.ema20Series = this.chart.addSeries(LineSeries, {
      color: "#2962ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // EMA 50 (Orange)
    this.ema50Series = this.chart.addSeries(LineSeries, {
      color: "#ff9800",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // SMA 200 (Purple)
    this.sma200Series = this.chart.addSeries(LineSeries, {
      color: "#9c27b0",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Bollinger Bands (Blue gray)
    this.bbUpperSeries = this.chart.addSeries(LineSeries, {
      color: "rgba(33, 150, 243, 0.7)",
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.bbMiddleSeries = this.chart.addSeries(LineSeries, {
      color: "rgba(33, 150, 243, 0.4)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.bbLowerSeries = this.chart.addSeries(LineSeries, {
      color: "rgba(33, 150, 243, 0.7)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
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
  public setData(candles: CandleData[]): void {
    this.candles = candles;
    this._candlesMapCache = null;

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
      color: c.close >= c.open ? "rgba(8, 153, 129, 0.4)" : "rgba(242, 54, 69, 0.4)",
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

    if (this.onLegendUpdate) {
      const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
      this.onLegendUpdate({ candle: lastCandle, isHovered: false });
    }
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

    if (candle.time === last.time) {
      this.candles[lastIdx] = candle;
    } else if (candle.time > last.time) {
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

    if (this.onLegendUpdate) {
      this.onLegendUpdate({ candle, isHovered: false });
    }
  }

  public recalculateIndicators(): void {
    if (this.candles.length === 0) return;

    // EMA 20
    if (this.indicatorSettings.ema20 && this.ema20Series) {
      const ema20 = calculateEMA(this.candles, 20);
      this.ema20Series.setData(
        ema20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.ema20Series) {
      this.ema20Series.setData([]);
    }

    // EMA 50
    if (this.indicatorSettings.ema50 && this.ema50Series) {
      const ema50 = calculateEMA(this.candles, 50);
      this.ema50Series.setData(
        ema50.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.ema50Series) {
      this.ema50Series.setData([]);
    }

    // SMA 200
    if (this.indicatorSettings.sma200 && this.sma200Series) {
      const sma200 = calculateSMA(this.candles, 200);
      this.sma200Series.setData(
        sma200.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else if (this.sma200Series) {
      this.sma200Series.setData([]);
    }

    // Bollinger Bands
    if (
      this.indicatorSettings.bollingerBands &&
      this.bbUpperSeries &&
      this.bbMiddleSeries &&
      this.bbLowerSeries
    ) {
      const bb = calculateBollingerBands(this.candles, 20, 2);
      this.bbUpperSeries.setData(
        bb.upper.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      this.bbMiddleSeries.setData(
        bb.middle.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      this.bbLowerSeries.setData(
        bb.lower.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    } else {
      this.bbUpperSeries?.setData([]);
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
  }

  public getIndicators(): IndicatorSettings {
    return { ...this.indicatorSettings };
  }

  public fitContent(): void {
    this.chart.timeScale().fitContent();
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.chart.remove();
  }
}
