import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  Logical,
  PaneAttachedParameter,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import { normalizeCandleTime } from "../api/tradifiPairs";
import type {
  CandleData,
  CorporateEvent,
  CorporateEventsData,
  StockDividendEvent,
  StockSplitEvent,
  Timeframe,
} from "../types";

type CanvasTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface MappedCorporateEvent {
  event: CorporateEvent;
  logicalIndex: number;
  isFuture: boolean;
}

export interface LaidOutBadge {
  event: CorporateEvent;
  anchorX: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  compact: boolean;
  isPinnedRight: boolean;
}

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

const BADGE_HEIGHT = 19;
const COMPACT_BADGE_WIDTH = 19;
const BOTTOM_PADDING = 4;
const PILL_FONT = "600 10px 'JetBrains Mono', -apple-system, BlinkMacSystemFont, sans-serif";

export function formatSplitBadgeText(split: StockSplitEvent, compact: boolean): string {
  return compact ? "S" : `S ${split.splitRatio}`;
}

export function formatDividendAmount(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount)) return "$0.00";
  const rounded4 = Number(amount.toFixed(4));
  const rounded2 = Number(amount.toFixed(2));
  const numStr = rounded4 === rounded2 ? amount.toFixed(2) : rounded4.toString();
  if (!currency || currency.toUpperCase() === "USD") {
    return `$${numStr}`;
  }
  return `${currency.toUpperCase()} ${numStr}`;
}

export function formatDividendBadgeText(div: StockDividendEvent, compact: boolean): string {
  return compact ? "D" : `D ${formatDividendAmount(div.amount, div.currency)}`;
}

export function countWeekdaysBetween(fromSec: number, toSec: number): number {
  if (toSec <= fromSec) return 0;
  const startDay = Math.floor(normalizeCandleTime(fromSec, "1d") / 86400);
  const endDay = Math.floor(normalizeCandleTime(toSec, "1d") / 86400);
  const diffDays = endDay - startDay;
  if (diffDays <= 0) return 1;
  if (diffDays > 2000) {
    return Math.max(1, Math.round((diffDays * 5) / 7));
  }

  let weekdays = 0;
  for (let d = startDay + 1; d <= endDay; d++) {
    const dayOfWeek = new Date(d * 86400 * 1000).getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      weekdays++;
    }
  }
  return Math.max(1, weekdays);
}

function findClosestCandleIndex(candles: CandleData[], targetTime: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].time;
    if (t === targetTime) return mid;
    if (t < targetTime) lo = mid + 1;
    else hi = mid - 1;
  }

  if (lo >= candles.length) return candles.length - 1;
  if (hi < 0) return 0;
  return Math.abs(candles[lo].time - targetTime) < Math.abs(candles[hi].time - targetTime)
    ? lo
    : hi;
}

function findFirstCandleOnUtcDay(candles: CandleData[], dayStartSec: number): number {
  const dayEndSec = dayStartSec + 86400;
  let lo = 0;
  let hi = candles.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time >= dayStartSec) {
      result = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  if (result !== -1 && candles[result].time < dayEndSec) {
    return result;
  }
  return -1;
}

export function mapEventToLogicalIndex(
  event: CorporateEvent,
  candles: CandleData[],
  timeframe: Timeframe,
): { logicalIndex: number; isFuture: boolean } | null {
  if (candles.length === 0) return null;

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const tfSec = TIMEFRAME_SECONDS[timeframe];

  if (event.isUpcoming) {
    if (timeframe === "1d" || timeframe === "1w") {
      const normEvent = normalizeCandleTime(event.date, timeframe);
      if (normEvent > lastCandle.time) {
        const offsetBars =
          timeframe === "1d"
            ? countWeekdaysBetween(lastCandle.time, normEvent)
            : Math.max(1, Math.round((normEvent - lastCandle.time) / 604800));
        return {
          logicalIndex: candles.length - 1 + offsetBars,
          isFuture: true,
        };
      }
    } else {
      const eventDayStart = normalizeCandleTime(event.date, "1d");
      const lastCandleDayStart = normalizeCandleTime(lastCandle.time, "1d");
      if (eventDayStart > lastCandleDayStart) {
        const offsetBars = Math.max(1, Math.round((event.date - lastCandle.time) / tfSec));
        return {
          logicalIndex: candles.length - 1 + offsetBars,
          isFuture: true,
        };
      }
    }
  }

  // Historical or same-day event: skip if outside loaded window
  if (event.date < firstCandle.time - Math.max(86400, tfSec)) {
    return null;
  }

  if (timeframe === "1d" || timeframe === "1w") {
    const target = normalizeCandleTime(event.date, timeframe);
    const idx = findClosestCandleIndex(candles, target);
    const maxDelta = timeframe === "1w" ? 6 * 86400 : 3 * 86400;
    if (Math.abs(candles[idx].time - target) <= maxDelta) {
      return { logicalIndex: idx, isFuture: false };
    }
    return null;
  }

  const dayStartSec = normalizeCandleTime(event.date, "1d");
  const idx = findFirstCandleOnUtcDay(candles, dayStartSec);
  if (idx === -1) return null;
  return { logicalIndex: idx, isFuture: false };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurePillTextWidth(text: string): number {
  if (!measureCtx && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
  }
  if (measureCtx) {
    measureCtx.font = PILL_FONT;
    return measureCtx.measureText(text).width;
  }
  return text.length * 6.2;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

class CorporateEventsRenderer implements IPrimitivePaneRenderer {
  private primitive: CorporateEventsPrimitive;

  constructor(primitive: CorporateEventsPrimitive) {
    this.primitive = primitive;
  }

  public draw(target: CanvasTarget): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      if (!this.primitive.isVisible()) return;

      this.primitive.syncLayout(mediaSize.width, mediaSize.height);
      const badges = this.primitive.getLaidOutBadges();
      if (badges.length === 0) return;

      const hoveredId = this.primitive.getHoveredId();
      const pinnedId = this.primitive.getPinnedId();

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, mediaSize.width, mediaSize.height);
      ctx.clip();

      // Draw subtle vertical guide line for hovered/pinned on-timeline badge
      for (const b of badges) {
        const isActive = b.event.id === hoveredId || b.event.id === pinnedId;
        if (!isActive || b.isPinnedRight) continue;

        ctx.save();
        ctx.strokeStyle =
          b.event.type === "split"
            ? "rgba(245, 158, 11, 0.38)"
            : b.event.isUpcoming
              ? "rgba(52, 211, 153, 0.38)"
              : "rgba(56, 189, 248, 0.38)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(b.anchorX) + 0.5, 0);
        ctx.lineTo(Math.round(b.anchorX) + 0.5, b.y - 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.font = PILL_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const b of badges) {
        const isActive = b.event.id === hoveredId || b.event.id === pinnedId;
        const isSplit = b.event.type === "split";
        const isUpcoming = b.event.isUpcoming;

        let fillColor: string;
        let strokeColor: string;
        let textColor: string;

        if (isSplit) {
          fillColor = isActive ? "rgba(245, 158, 11, 0.32)" : "rgba(245, 158, 11, 0.16)";
          strokeColor = isActive ? "#fbbf24" : "#f59e0b";
          textColor = "#fcd34d";
        } else if (isUpcoming) {
          fillColor = isActive ? "rgba(16, 185, 129, 0.34)" : "rgba(16, 185, 129, 0.2)";
          strokeColor = isActive ? "#6ee7b7" : "#34d399";
          textColor = "#6ee7b7";
        } else {
          fillColor = isActive ? "rgba(56, 189, 248, 0.3)" : "rgba(56, 189, 248, 0.15)";
          strokeColor = isActive ? "#7dd3fc" : "#38bdf8";
          textColor = "#7dd3fc";
        }

        // Solid dark backdrop under translucent tint so volume bars behind never wash out text
        drawRoundedRect(ctx, b.x, b.y, b.width, b.height, b.height / 2);
        ctx.fillStyle = "rgba(8, 10, 15, 0.88)";
        ctx.fill();

        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.lineWidth = isActive ? 1.5 : 1;
        if (isUpcoming) {
          ctx.setLineDash([3, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = strokeColor;
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = textColor;
        ctx.fillText(b.text, b.x + b.width / 2, b.y + b.height / 2 + 0.5);
      }

      ctx.restore();
    });
  }
}

class CorporateEventsPaneView implements IPanePrimitivePaneView {
  private paneRenderer: CorporateEventsRenderer;

  constructor(primitive: CorporateEventsPrimitive) {
    this.paneRenderer = new CorporateEventsRenderer(primitive);
  }

  public zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }

  public renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer;
  }
}

export class CorporateEventsPrimitive implements IPanePrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate?: () => void;
  private paneView: CorporateEventsPaneView;

  private candles: CandleData[] = [];
  private timeframe: Timeframe = "1d";
  private eventsData: CorporateEventsData | null = null;
  private visible = true;

  private hoveredId: string | null = null;
  private pinnedId: string | null = null;

  private mappedEvents: MappedCorporateEvent[] = [];
  private laidOutBadges: LaidOutBadge[] = [];
  private lastPaneWidth = 0;
  private lastPaneHeight = 0;

  constructor() {
    this.paneView = new CorporateEventsPaneView(this);
  }

  public attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
    this.rebuildMappedEvents();
    this.updateAllViews();
  }

  public detached(): void {
    this.chart = null;
    this.requestUpdate = undefined;
    this.laidOutBadges = [];
  }

  public paneViews(): readonly IPanePrimitivePaneView[] {
    return [this.paneView];
  }

  public setData(
    candles: CandleData[],
    timeframe: Timeframe,
    events: CorporateEventsData | null,
  ): void {
    this.candles = candles;
    this.timeframe = timeframe;
    this.eventsData = events;
    this.rebuildMappedEvents();
    this.updateAllViews();
    this.requestUpdate?.();
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.laidOutBadges = [];
    } else {
      this.updateAllViews();
    }
    this.requestUpdate?.();
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public setActiveIds(hoveredId: string | null, pinnedId: string | null): void {
    if (this.hoveredId === hoveredId && this.pinnedId === pinnedId) return;
    this.hoveredId = hoveredId;
    this.pinnedId = pinnedId;
    this.requestUpdate?.();
  }

  public getHoveredId(): string | null {
    return this.hoveredId;
  }

  public getPinnedId(): string | null {
    return this.pinnedId;
  }

  public getLaidOutBadges(): readonly LaidOutBadge[] {
    return this.laidOutBadges;
  }

  public getBadgeLayoutById(id: string): LaidOutBadge | null {
    return this.laidOutBadges.find((b) => b.event.id === id) ?? null;
  }

  public getBadgeAtPoint(x: number, y: number): LaidOutBadge | null {
    if (!this.visible) return null;
    const pad = 3;
    for (let i = this.laidOutBadges.length - 1; i >= 0; i--) {
      const b = this.laidOutBadges[i];
      if (
        x >= b.x - pad &&
        x <= b.x + b.width + pad &&
        y >= b.y - pad &&
        y <= b.y + b.height + pad
      ) {
        return b;
      }
    }
    return null;
  }

  public hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const match = this.getBadgeAtPoint(x, y);
    if (!match) return null;
    return {
      externalId: match.event.id,
      zOrder: "top",
      cursorStyle: "pointer",
      hitTestPriority: 2,
      distance: 0,
    };
  }

  public updateAllViews(): void {
    if (!this.chart || !this.visible) {
      this.laidOutBadges = [];
      return;
    }
    const size = this.chart.paneSize(0);
    if (size.width > 0 && size.height > 0) {
      this.syncLayout(size.width, size.height);
    }
  }

  public syncLayout(paneWidth: number, paneHeight: number): void {
    this.lastPaneWidth = paneWidth;
    this.lastPaneHeight = paneHeight;

    if (!this.chart || !this.visible || this.mappedEvents.length === 0) {
      this.laidOutBadges = [];
      return;
    }
    if (paneWidth <= 0 || paneHeight <= 0) {
      this.laidOutBadges = [];
      return;
    }

    const timeScale = this.chart.timeScale();
    const y = Math.max(4, paneHeight - BADGE_HEIGHT - BOTTOM_PADDING);

    const rightPinned: MappedCorporateEvent[] = [];
    const timelineCandidates: Array<{
      event: CorporateEvent;
      anchorX: number;
      fullText: string;
      fullWidth: number;
    }> = [];

    for (const item of this.mappedEvents) {
      const coord = timeScale.logicalToCoordinate(Math.round(item.logicalIndex) as Logical);
      if (item.isFuture && (coord === null || coord > paneWidth - 20)) {
        rightPinned.push(item);
        continue;
      }
      if (coord === null || coord < -24 || coord > paneWidth - 6) {
        continue;
      }

      const fullText =
        item.event.type === "split"
          ? formatSplitBadgeText(item.event, false)
          : formatDividendBadgeText(item.event, false);
      const fullWidth = Math.ceil(measurePillTextWidth(fullText) + 14);
      timelineCandidates.push({
        event: item.event,
        anchorX: coord,
        fullText,
        fullWidth,
      });
    }

    // Place future events that are off the right edge pinned at bottom-right of volume strip
    // (soonest upcoming event placed closest to the right edge)
    const pinnedBadges: LaidOutBadge[] = [];
    let rightCursor = paneWidth - 8;
    for (let i = 0; i < rightPinned.length; i++) {
      const item = rightPinned[i];
      const baseText =
        item.event.type === "split"
          ? formatSplitBadgeText(item.event, false)
          : formatDividendBadgeText(item.event, false);
      const text = `${baseText} →`;
      const width = Math.ceil(measurePillTextWidth(text) + 14);
      const x = rightCursor - width;
      if (x < 80) break;

      pinnedBadges.unshift({
        event: item.event,
        anchorX: x + width / 2,
        x,
        y,
        width,
        height: BADGE_HEIGHT,
        text,
        compact: false,
        isPinnedRight: true,
      });
      rightCursor = x - 6;
    }

    const timelineRightLimit =
      rightPinned.length > 0 && pinnedBadges.length > 0 ? rightCursor - 4 : paneWidth - 6;

    // Filter timeline candidates against right-pinned reservation and sort left-to-right
    const visibleTimeline = timelineCandidates
      .filter((c) => c.anchorX <= timelineRightLimit)
      .sort((a, b) => {
        if (a.anchorX !== b.anchorX) return a.anchorX - b.anchorX;
        if (a.event.type !== b.event.type) return a.event.type === "split" ? -1 : 1;
        return a.event.date - b.event.date;
      });

    // Pass 1: Collapse overlapping full pills to compact circular badges (S / D)
    const collapsedFlags = Array.from({ length: visibleTimeline.length }, () => false);
    for (let i = 0; i < visibleTimeline.length; i++) {
      const curr = visibleTimeline[i];
      const currLeft = curr.anchorX - curr.fullWidth / 2;
      const currRight = curr.anchorX + curr.fullWidth / 2;

      if (i > 0) {
        const prev = visibleTimeline[i - 1];
        const prevRight = prev.anchorX + prev.fullWidth / 2;
        if (prevRight + 4 > currLeft) {
          collapsedFlags[i - 1] = true;
          collapsedFlags[i] = true;
        }
      }
      if (currRight > timelineRightLimit) {
        collapsedFlags[i] = true;
      }
    }

    // Pass 2: Build badges and drop colliding lower-priority circles on ultra-dense zoom-out
    const finalTimeline: LaidOutBadge[] = [];
    for (let i = 0; i < visibleTimeline.length; i++) {
      const item = visibleTimeline[i];
      const compact = collapsedFlags[i];
      const text =
        item.event.type === "split"
          ? formatSplitBadgeText(item.event, compact)
          : formatDividendBadgeText(item.event, compact);
      const width = compact ? COMPACT_BADGE_WIDTH : item.fullWidth;
      const x = Math.max(4, Math.min(timelineRightLimit - width, item.anchorX - width / 2));

      const badge: LaidOutBadge = {
        event: item.event,
        anchorX: item.anchorX,
        x,
        y,
        width,
        height: BADGE_HEIGHT,
        text,
        compact,
        isPinnedRight: false,
      };

      const prev = finalTimeline[finalTimeline.length - 1];
      if (prev && prev.x + prev.width + 2 > badge.x) {
        // Keep higher-priority badge: Split > Upcoming/Active > Newer Dividend
        if (this.badgePriority(badge.event) > this.badgePriority(prev.event)) {
          finalTimeline[finalTimeline.length - 1] = badge;
        }
        continue;
      }

      finalTimeline.push(badge);
    }

    this.laidOutBadges = [...finalTimeline, ...pinnedBadges];
  }

  private badgePriority(event: CorporateEvent): number {
    let score = 0;
    if (event.type === "split") score += 100;
    if (event.isUpcoming) score += 50;
    if (event.id === this.pinnedId || event.id === this.hoveredId) score += 200;
    return score;
  }

  private rebuildMappedEvents(): void {
    if (!this.eventsData || this.candles.length === 0) {
      this.mappedEvents = [];
      return;
    }

    const combined: CorporateEvent[] = [...this.eventsData.splits, ...this.eventsData.dividends];

    const mapped: MappedCorporateEvent[] = [];
    for (const ev of combined) {
      const res = mapEventToLogicalIndex(ev, this.candles, this.timeframe);
      if (res) {
        mapped.push({
          event: ev,
          logicalIndex: res.logicalIndex,
          isFuture: res.isFuture,
        });
      }
    }

    mapped.sort((a, b) => a.logicalIndex - b.logicalIndex);
    this.mappedEvents = mapped;

    // Trigger re-layout if dimensions are already known
    if (this.lastPaneWidth > 0 && this.lastPaneHeight > 0) {
      this.syncLayout(this.lastPaneWidth, this.lastPaneHeight);
    }
  }
}
