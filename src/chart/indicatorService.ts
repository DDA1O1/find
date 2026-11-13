import {
  calculateBollingerBands,
  calculateEMA,
  calculateSMA,
  type BollingerBandPoints,
  type IndicatorPoint,
} from "../indicators/ma";
import type { CandleData, IndicatorSettings } from "../types";
import type { IndicatorWorkerRequest, IndicatorWorkerResponse } from "../workers/indicatorWorker";

export interface IndicatorCalculationResults {
  ema20?: IndicatorPoint[];
  ema50?: IndicatorPoint[];
  sma200?: IndicatorPoint[];
  bollingerBands?: BollingerBandPoints;
}

export class IndicatorService {
  private worker: Worker | null = null;
  private currentRequestId = 0;
  private onResultsCallback?: (results: IndicatorCalculationResults) => void;
  private isDestroyed = false;

  constructor(onResults: (results: IndicatorCalculationResults) => void) {
    this.onResultsCallback = onResults;
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === "undefined") {
      return;
    }

    try {
      this.worker = new Worker(new URL("../workers/indicatorWorker.ts", import.meta.url), {
        type: "module",
      });

      this.worker.onmessage = (e: MessageEvent<IndicatorWorkerResponse>) => {
        if (this.isDestroyed) return;
        const { id, results } = e.data;
        // Ignore stale calculations that finished after a newer request was dispatched
        if (id === this.currentRequestId && this.onResultsCallback) {
          this.onResultsCallback(results);
        }
      };

      this.worker.onerror = (err) => {
        console.warn("[IndicatorService] Web Worker error, falling back to sync mode:", err);
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      // Environments where Web Worker with ES module is unsupported
      this.worker = null;
    }
  }

  public calculate(candles: CandleData[], settings: IndicatorSettings): void {
    if (this.isDestroyed || candles.length === 0) return;

    this.currentRequestId++;
    const requestId = this.currentRequestId;

    if (this.worker) {
      const payload: IndicatorWorkerRequest = {
        id: requestId,
        candles,
        settings,
      };
      this.worker.postMessage(payload);
    } else {
      // Synchronous fallback (e.g. Node tests or unsupported worker)
      const results: IndicatorCalculationResults = {};
      if (settings.ema20) {
        results.ema20 = calculateEMA(candles, 20);
      }
      if (settings.ema50) {
        results.ema50 = calculateEMA(candles, 50);
      }
      if (settings.sma200) {
        results.sma200 = calculateSMA(candles, 200);
      }
      if (settings.bollingerBands) {
        results.bollingerBands = calculateBollingerBands(candles, 20, 2);
      }

      if (this.onResultsCallback) {
        this.onResultsCallback(results);
      }
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.onResultsCallback = undefined;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
