import type { ChartType } from "../chart/chartManager";
import type { IndicatorSettings, Timeframe, WatchlistTicker } from "../types";
import { eventBus, type ConnectionStatus } from "./eventBus";

export interface AppState {
  activeSymbol: string;
  activeTimeframe: Timeframe;
  chartType: ChartType;
  indicators: IndicatorSettings;
  allTickers: Map<string, WatchlistTicker>;
  activeTicker: WatchlistTicker | null;
  isOnline: boolean;
  klineStatus: ConnectionStatus;
  allTickersStatus: ConnectionStatus;
}

const STORAGE_KEYS = {
  ACTIVE_SYMBOL: "tv_active_symbol",
  ACTIVE_TIMEFRAME: "tv_active_timeframe",
  INDICATORS: "tv_indicators_v1",
  CHART_TYPE: "tv_chart_type",
} as const;

const DEFAULT_INDICATORS: IndicatorSettings = {
  ema20: false,
  ema50: false,
  sma200: false,
  bollingerBands: false,
  volume: true,
};

function safeGetStorage(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore
  }
  return null;
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore
  }
}

function loadStoredIndicators(): IndicatorSettings {
  try {
    const raw = safeGetStorage(STORAGE_KEYS.INDICATORS);
    if (!raw) return DEFAULT_INDICATORS;
    return { ...DEFAULT_INDICATORS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INDICATORS;
  }
}

/**
 * Central State Manager (Single source of truth)
 */
export class StateManager {
  private state: AppState;

  constructor() {
    this.state = {
      activeSymbol: safeGetStorage(STORAGE_KEYS.ACTIVE_SYMBOL) || "BTCUSDT",
      activeTimeframe: (safeGetStorage(STORAGE_KEYS.ACTIVE_TIMEFRAME) as Timeframe) || "1d",
      chartType: (safeGetStorage(STORAGE_KEYS.CHART_TYPE) as ChartType) || "candles",
      indicators: loadStoredIndicators(),
      allTickers: new Map(),
      activeTicker: null,
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      klineStatus: "connecting",
      allTickersStatus: "connecting",
    };
  }

  public getState(): Readonly<AppState> {
    return this.state;
  }

  public get activeSymbol(): string {
    return this.state.activeSymbol;
  }

  public get activeTimeframe(): Timeframe {
    return this.state.activeTimeframe;
  }

  public get chartType(): ChartType {
    return this.state.chartType;
  }

  public get indicators(): IndicatorSettings {
    return { ...this.state.indicators };
  }

  public get isOnline(): boolean {
    return this.state.isOnline;
  }

  public get allTickers(): Map<string, WatchlistTicker> {
    return this.state.allTickers;
  }

  public get activeTicker(): WatchlistTicker | null {
    return this.state.activeTicker;
  }

  public setActiveSymbol(symbol: string): boolean {
    const normalized = symbol.trim().toUpperCase();
    if (this.state.activeSymbol === normalized) return false;

    const previousSymbol = this.state.activeSymbol;
    this.state.activeSymbol = normalized;

    safeSetStorage(STORAGE_KEYS.ACTIVE_SYMBOL, normalized);

    const currentTicker = this.state.allTickers.get(normalized) || null;
    this.state.activeTicker = currentTicker;

    eventBus.emit("symbol:change", { symbol: normalized, previousSymbol });
    return true;
  }

  public setActiveTimeframe(tf: Timeframe): boolean {
    if (this.state.activeTimeframe === tf) return false;

    this.state.activeTimeframe = tf;

    safeSetStorage(STORAGE_KEYS.ACTIVE_TIMEFRAME, tf);

    eventBus.emit("timeframe:change", { timeframe: tf });
    return true;
  }

  public setChartType(type: ChartType): boolean {
    if (this.state.chartType === type) return false;

    this.state.chartType = type;

    safeSetStorage(STORAGE_KEYS.CHART_TYPE, type);

    eventBus.emit("chartType:change", { chartType: type });
    return true;
  }

  public setIndicators(settings: Partial<IndicatorSettings>): void {
    this.state.indicators = { ...this.state.indicators, ...settings };

    safeSetStorage(STORAGE_KEYS.INDICATORS, JSON.stringify(this.state.indicators));

    eventBus.emit("indicators:change", { indicators: settings });
  }

  public setAllTickers(tickers: WatchlistTicker[]): void {
    this.state.allTickers.clear();
    for (const t of tickers) {
      this.state.allTickers.set(t.symbol, t);
    }

    const active = this.state.allTickers.get(this.state.activeSymbol) || null;
    if (active) {
      this.state.activeTicker = active;
      eventBus.emit("market:activeTickerUpdated", { ticker: active });
    }

    eventBus.emit("market:tickersLoaded", { tickers });
  }

  public updateTickers(updates: Map<string, Partial<WatchlistTicker>>): void {
    for (const [symbol, patch] of updates) {
      const existing = this.state.allTickers.get(symbol);
      if (existing) {
        Object.assign(existing, patch);
      }
    }

    const activePatch = updates.get(this.state.activeSymbol);
    if (activePatch && this.state.activeTicker) {
      Object.assign(this.state.activeTicker, activePatch);
      eventBus.emit("market:activeTickerUpdated", { ticker: this.state.activeTicker });
    }

    eventBus.emit("market:tickersUpdated", { updates });
  }

  public setKlineStatus(status: ConnectionStatus, customLabel?: string): void {
    this.state.klineStatus = status;
    eventBus.emit("connection:kline", { status, customLabel });
  }

  public setAllTickersStatus(status: ConnectionStatus): void {
    this.state.allTickersStatus = status;
    eventBus.emit("connection:allTickers", { status });
  }

  public setOnline(isOnline: boolean): void {
    if (this.state.isOnline === isOnline) return;
    this.state.isOnline = isOnline;
    eventBus.emit("connection:network", { isOnline });
  }
}

export const stateManager = new StateManager();
