import type { ChartType } from "../chart/chartManager";
import type { IndicatorSettings, Timeframe, WatchlistTicker } from "../types";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastPayload {
  id?: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface EventMap {
  // Navigation & symbols
  "symbol:change": { symbol: string; previousSymbol?: string };
  "symbol:selected": { symbol: string };
  "timeframe:change": { timeframe: Timeframe };
  "chartType:change": { chartType: ChartType };
  "indicators:change": { indicators: Partial<IndicatorSettings> };

  // Market data
  "market:tickersLoaded": { tickers: WatchlistTicker[] };
  "market:tickersUpdated": { updates: Map<string, Partial<WatchlistTicker>> };
  "market:catalogSynced": { added: string[]; removed: string[] };
  "market:activeTickerUpdated": { ticker: WatchlistTicker };

  // Connections
  "connection:kline": { status: ConnectionStatus; customLabel?: string };
  "connection:allTickers": { status: ConnectionStatus };
  "connection:network": { isOnline: boolean };

  // UI
  "toast:show": ToastPayload;
  "search:open": { initialChar?: string };
  "search:close": void;
  "watchlist:toggle": void;
  "chart:fit": void;
}

export type EventKey = keyof EventMap;
export type EventHandler<K extends EventKey> = (data: EventMap[K]) => void;

/**
 * Type-safe pub-sub EventBus for decoupled component communication.
 */
export class EventBus {
  private listeners = new Map<EventKey, Set<EventHandler<any>>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  public on<K extends EventKey>(event: K, handler: EventHandler<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once. Unsubscribes after first trigger.
   */
  public once<K extends EventKey>(event: K, handler: EventHandler<K>): () => void {
    const wrapper: EventHandler<K> = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a handler from an event.
   */
  public off<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event with typed payload.
   */
  public emit<K extends EventKey>(event: K, data: EventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    // Iterate over a copy to allow unsubscription during execution
    for (const handler of Array.from(handlers)) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for event "${event}":`, err);
      }
    }
  }

  /**
   * Clear all registered listeners.
   */
  public clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
