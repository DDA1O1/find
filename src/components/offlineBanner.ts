import { eventBus } from "../core/eventBus";
import { stateManager } from "../core/stateManager";

export class OfflineBannerComponent {
  private bannerEl: HTMLElement | null = null;
  private onOnlineBound: () => void;
  private onOfflineBound: () => void;
  private isDestroyed = false;

  constructor() {
    this.onOnlineBound = () => this.handleOnline();
    this.onOfflineBound = () => this.handleOffline();

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnlineBound);
      window.addEventListener("offline", this.onOfflineBound);

      if (!navigator.onLine) {
        this.showBanner();
      }
    }
  }

  private handleOffline(): void {
    if (this.isDestroyed) return;
    stateManager.setOnline(false);
    this.showBanner();
    eventBus.emit("toast:show", {
      type: "error",
      title: "Offline",
      message: "Internet connection lost. Market streams paused.",
      duration: 6000,
    });
  }

  private handleOnline(): void {
    if (this.isDestroyed) return;
    stateManager.setOnline(true);
    this.hideBanner();
    eventBus.emit("toast:show", {
      type: "success",
      title: "Online",
      message: "Connection restored. Resuming live feeds.",
      duration: 3500,
    });
    // Trigger socket reconnect
    eventBus.emit("connection:network", { isOnline: true });
  }

  private showBanner(): void {
    if (this.bannerEl) return;

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "network-offline-banner";
    this.bannerEl.innerHTML = `
      <div class="offline-banner-content">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
        <span>No internet connection. Charts and prices may be outdated.</span>
        <button class="offline-retry-btn" id="btn-offline-retry">Reconnect</button>
      </div>
    `;

    const retryBtn = this.bannerEl.querySelector<HTMLButtonElement>("#btn-offline-retry");
    retryBtn?.addEventListener("click", () => {
      if (navigator.onLine) {
        this.handleOnline();
      } else {
        eventBus.emit("toast:show", {
          type: "warning",
          title: "Still Offline",
          message: "Check your network connection and try again.",
        });
      }
    });

    document.body.prepend(this.bannerEl);
  }

  private hideBanner(): void {
    if (this.bannerEl && this.bannerEl.parentNode) {
      this.bannerEl.parentNode.removeChild(this.bannerEl);
      this.bannerEl = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnlineBound);
      window.removeEventListener("offline", this.onOfflineBound);
    }
    this.hideBanner();
  }
}
