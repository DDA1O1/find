import type { ConnectionStatus } from "../core/eventBus";

export interface ReconnectingWebSocketOptions {
  url: string | (() => string);
  initialReconnectInterval?: number; // ms, default 1000
  maxReconnectInterval?: number; // ms, default 10000
  reconnectDecay?: number; // default 1.5
  staleTimeout?: number; // ms, default 12000 (E3: stale WebSocket detection)
  onStatusChange?: (status: ConnectionStatus) => void;
  onOpen?: (e: Event) => void;
  onMessage?: (e: MessageEvent) => void;
  onError?: (e: Event) => void;
  onClose?: (e: CloseEvent) => void;
}

/**
 * Robust WebSocket client with exponential backoff, jitter,
 * heartbeat/stale connection detection, and clean disposal.
 */
export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private options: Required<ReconnectingWebSocketOptions>;

  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private staleCheckInterval: number | null = null;
  private lastMessageTime = 0;
  private isDestroyed = false;
  private status: ConnectionStatus = "disconnected";

  constructor(options: ReconnectingWebSocketOptions) {
    this.options = {
      url: options.url,
      initialReconnectInterval: options.initialReconnectInterval ?? 1000,
      maxReconnectInterval: options.maxReconnectInterval ?? 10000,
      reconnectDecay: options.reconnectDecay ?? 1.5,
      staleTimeout: options.staleTimeout ?? 12000,
      onStatusChange: options.onStatusChange ?? (() => {}),
      onOpen: options.onOpen ?? (() => {}),
      onMessage: options.onMessage ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onClose: options.onClose ?? (() => {}),
    };

    this.connect();
    this.startStaleWatchdog();
  }

  public get currentStatus(): ConnectionStatus {
    return this.status;
  }

  public get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public connect(): void {
    if (this.isDestroyed) return;

    this.cleanupSocket();
    this.setStatus("connecting");

    const targetUrl =
      typeof this.options.url === "function" ? this.options.url() : this.options.url;

    try {
      this.ws = new WebSocket(targetUrl);

      this.ws.onopen = (event) => {
        if (this.isDestroyed) {
          this.cleanupSocket();
          return;
        }
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.setStatus("connected");
        this.options.onOpen(event);
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        this.options.onMessage(event);
      };

      this.ws.onerror = (event) => {
        this.options.onError(event);
      };

      this.ws.onclose = (event) => {
        this.setStatus("disconnected");
        this.options.onClose(event);
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.warn(`[ReconnectingWebSocket] Error initiating connection:`, err);
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  public updateUrl(newUrl: string | (() => string)): void {
    this.options.url = newUrl;
    this.reconnect();
  }

  public reconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  public send(data: Parameters<WebSocket["send"]>[0]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange(status);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;

    // Exponential backoff with jitter
    const delay = Math.min(
      this.options.maxReconnectInterval,
      this.options.initialReconnectInterval *
        Math.pow(this.options.reconnectDecay, this.reconnectAttempts),
    );
    const jitter = delay * 0.2 * (Math.random() - 0.5); // +/- 10%
    const finalDelay = Math.max(500, Math.floor(delay + jitter));

    this.reconnectAttempts++;
    this.reconnectTimer = (typeof window !== "undefined" ? window : globalThis).setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, finalDelay) as unknown as number;
  }

  /**
   * E3: Stale WebSocket detection watchdog
   */
  private startStaleWatchdog(): void {
    if (this.options.staleTimeout <= 0) return;

    this.staleCheckInterval = (typeof window !== "undefined" ? window : globalThis).setInterval(
      () => {
        if (this.isDestroyed || !this.isConnected) return;

        const idleTime = Date.now() - this.lastMessageTime;
        if (idleTime > this.options.staleTimeout) {
          console.warn(
            `[ReconnectingWebSocket] No data received in ${Math.round(idleTime / 1000)}s (stale limit ${this.options.staleTimeout / 1000}s). Forcing reconnection...`,
          );
          this.reconnect();
        }
      },
      Math.max(3000, Math.floor(this.options.staleTimeout / 3)),
    ) as unknown as number;
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // Ignore closing errors
      }
      this.ws = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
    this.cleanupSocket();
    this.setStatus("disconnected");
  }
}
