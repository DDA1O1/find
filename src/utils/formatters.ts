export function formatPrice(price: number): string {
  if (isNaN(price)) return "0.00";
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  if (price >= 0.01) {
    return price.toFixed(4);
  }
  if (price >= 0.0001) {
    return price.toFixed(6);
  }
  return price.toFixed(8);
}

export function formatPercent(percent: number): string {
  if (isNaN(percent)) return "0.00%";
  const prefix = percent > 0 ? "+" : "";
  return `${prefix}${percent.toFixed(2)}%`;
}

export function formatVolume(volume: number): string {
  if (isNaN(volume)) return "$0";
  if (volume >= 1e9) {
    return `$${(volume / 1e9).toFixed(2)}B`;
  }
  if (volume >= 1e6) {
    return `$${(volume / 1e6).toFixed(2)}M`;
  }
  if (volume >= 1e3) {
    return `$${(volume / 1e3).toFixed(2)}K`;
  }
  return `$${volume.toFixed(2)}`;
}
