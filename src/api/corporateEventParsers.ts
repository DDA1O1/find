/**
 * Pure corporate-event parsing helpers shared by the Nasdaq proxy endpoint and tests.
 */

export function parseUsDateToUtcSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return null;

  // MM/DD/YYYY (Nasdaq format)
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10);
    const day = parseInt(usMatch[2], 10);
    const year = parseInt(usMatch[3], 10);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return Math.floor(d.getTime() / 1000);
  }

  // YYYY-MM-DD fallback
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return Math.floor(d.getTime() / 1000);
  }

  return null;
}

export function parseDollarAmount(raw: string | number | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(6)) : null;
  }
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const val = parseFloat(cleaned);
  return Number.isFinite(val) && val > 0 ? Number(val.toFixed(6)) : null;
}

export function parseSplitRatio(
  raw: string | undefined,
): { numerator: number; denominator: number; splitRatio: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(?::|for|-for-)\s*(\d+(?:\.\d+)?)$/i.exec(trimmed);
  if (!match) return null;
  const numerator = parseFloat(match[1]);
  const denominator = parseFloat(match[2]);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }
  return {
    numerator,
    denominator,
    splitRatio: `${match[1]}:${match[2]}`,
  };
}
