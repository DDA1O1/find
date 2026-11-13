import {
  calculateBollingerBands,
  calculateEMA,
  calculateSMA,
  type BollingerBandPoints,
  type IndicatorPoint,
} from "../indicators/ma";
import type { CandleData, IndicatorSettings } from "../types";

export interface IndicatorWorkerRequest {
  id: number;
  candles: CandleData[];
  settings: IndicatorSettings;
}

export interface IndicatorWorkerResponse {
  id: number;
  results: {
    ema20?: IndicatorPoint[];
    ema50?: IndicatorPoint[];
    sma200?: IndicatorPoint[];
    bollingerBands?: BollingerBandPoints;
  };
}

// In Web Worker context
self.onmessage = (event: MessageEvent<IndicatorWorkerRequest>) => {
  const { id, candles, settings } = event.data;

  const results: IndicatorWorkerResponse["results"] = {};

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

  self.postMessage({ id, results } satisfies IndicatorWorkerResponse);
};
