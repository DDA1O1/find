import { describe, expect, it, vi } from "vite-plus/test";
import { EventBus } from "./eventBus";
import { StateManager } from "./stateManager";

describe("EventBus", () => {
  it("emits and receives typed events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsub = bus.on("symbol:change", handler);
    bus.emit("symbol:change", { symbol: "ETHUSDT", previousSymbol: "BTCUSDT" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ symbol: "ETHUSDT", previousSymbol: "BTCUSDT" });

    unsub();
    bus.emit("symbol:change", { symbol: "SOLUSDT" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles 'once' subscriptions correctly", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once("timeframe:change", handler);
    bus.emit("timeframe:change", { timeframe: "1h" });
    bus.emit("timeframe:change", { timeframe: "4h" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ timeframe: "1h" });
  });

  it("does not crash when handler throws an error", () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    bus.on("watchlist:toggle", () => {
      throw new Error("handler explosion");
    });
    const goodHandler = vi.fn();
    bus.on("watchlist:toggle", goodHandler);

    expect(() => bus.emit("watchlist:toggle", undefined)).not.toThrow();
    expect(goodHandler).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("StateManager", () => {
  it("updates and retrieves symbol", () => {
    const state = new StateManager();
    const changed = state.setActiveSymbol("SOLUSDT");

    expect(changed).toBe(true);
    expect(state.activeSymbol).toBe("SOLUSDT");

    // Setting same symbol returns false (no-op)
    const changedAgain = state.setActiveSymbol("SOLUSDT");
    expect(changedAgain).toBe(false);
  });

  it("updates timeframe", () => {
    const state = new StateManager();
    const changed = state.setActiveTimeframe("15m");

    expect(changed).toBe(true);
    expect(state.activeTimeframe).toBe("15m");
  });

  it("merges indicator partial updates", () => {
    const state = new StateManager();
    state.setIndicators({ ema20: true });

    expect(state.indicators.ema20).toBe(true);
  });
});
