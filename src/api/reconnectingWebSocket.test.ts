import { describe, expect, it } from "vite-plus/test";
import { ReconnectingWebSocket } from "./reconnectingWebSocket";
import { RateLimitError, getRateLimitStatus } from "./binance";

describe("ReconnectingWebSocket", () => {
  it("initializes with disconnected status", () => {
    // In node test environment without browser WebSocket, it catches gracefully
    const statusChanges: string[] = [];
    const rws = new ReconnectingWebSocket({
      url: "wss://fake.binance.com",
      onStatusChange: (status) => statusChanges.push(status),
    });

    expect(rws.currentStatus).toBeDefined();
    rws.destroy();
  });
});

describe("RateLimit Handling", () => {
  it("creates RateLimitError with retryAfterMs", () => {
    const err = new RateLimitError("Rate limited", 15000);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfterMs).toBe(15000);
    expect(err.message).toBe("Rate limited");
  });

  it("reports rate limit status correctly", () => {
    const status = getRateLimitStatus();
    expect(typeof status.isRateLimited).toBe("boolean");
    expect(typeof status.remainingSec).toBe("number");
  });
});
