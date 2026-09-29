import type { CandleData } from "../types";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface BollingerBandPoints {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];
  lower: IndicatorPoint[];
}

/**
 * Calculates Simple Moving Average (SMA)
 */
export function calculateSMA(candles: CandleData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }

  result.push({
    time: candles[period - 1].time,
    value: sum / period,
  });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close;
    result.push({
      time: candles[i].time,
      value: sum / period,
    });
  }

  return result;
}

/**
 * Calculates Exponential Moving Average (EMA)
 */
export function calculateEMA(candles: CandleData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

  const multiplier = 2 / (period + 1);

  // Initial SMA as starting point
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let currentEma = sum / period;

  result.push({
    time: candles[period - 1].time,
    value: currentEma,
  });

  for (let i = period; i < candles.length; i++) {
    currentEma = (candles[i].close - currentEma) * multiplier + currentEma;
    result.push({
      time: candles[i].time,
      value: currentEma,
    });
  }

  return result;
}

/**
 * Calculates Bollinger Bands (SMA period, default multiplier 2)
 */
export function calculateBollingerBands(
  candles: CandleData[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerBandPoints {
  const upper: IndicatorPoint[] = [];
  const middle: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];

  if (candles.length < period) {
    return { upper, middle, lower };
  }

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j].close;
    }
    const sma = sum / period;

    let varianceSum = 0;
    for (let j = 0; j < period; j++) {
      varianceSum += Math.pow(candles[i - j].close - sma, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);

    const time = candles[i].time;
    middle.push({ time, value: sma });
    upper.push({ time, value: sma + stdDevMultiplier * stdDev });
    lower.push({ time, value: sma - stdDevMultiplier * stdDev });
  }

  return { upper, middle, lower };
}
