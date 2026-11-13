import { eventBus, type ToastPayload, type ToastType } from "../core/eventBus";

interface ActiveToast {
  id: string;
  el: HTMLElement;
  timer: number;
}

export class ToastComponent {
  private container: HTMLElement;
  private activeToasts: Map<string, ActiveToast> = new Map();
  private unsubEvent?: () => void;
  private nextId = 0;

  constructor() {
    this.container = this.getOrCreateContainer();
    this.unsubEvent = eventBus.on("toast:show", (payload) => {
      this.show(payload);
    });
  }

  private getOrCreateContainer(): HTMLElement {
    let el = document.getElementById("toast-container");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast-container";
      el.className = "toast-container";
      document.body.appendChild(el);
    }
    return el;
  }

  public show(payload: ToastPayload): string {
    const id = payload.id || `toast-${++this.nextId}`;
    const duration = payload.duration ?? (payload.type === "error" ? 5000 : 3500);

    // If an existing toast has the same id, dismiss it first
    if (this.activeToasts.has(id)) {
      this.dismiss(id);
    }

    const toastEl = document.createElement("div");
    toastEl.className = `toast-item toast-${payload.type}`;
    toastEl.dataset.id = id;

    const iconSvg = this.getIcon(payload.type);

    toastEl.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        <div class="toast-title">${this.escapeHtml(payload.title)}</div>
        ${payload.message ? `<div class="toast-message">${this.escapeHtml(payload.message)}</div>` : ""}
      </div>
      <button class="toast-close" title="Dismiss" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    const closeBtn = toastEl.querySelector<HTMLButtonElement>(".toast-close")!;
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dismiss(id);
    });

    // Auto dismiss timer
    let remaining = duration;
    let startTime = Date.now();
    let timer = window.setTimeout(() => this.dismiss(id), remaining);

    // Pause timer on hover
    toastEl.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      remaining -= Date.now() - startTime;
    });

    toastEl.addEventListener("mouseleave", () => {
      startTime = Date.now();
      timer = window.setTimeout(() => this.dismiss(id), Math.max(1000, remaining));
    });

    this.container.appendChild(toastEl);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      toastEl.classList.add("toast-enter");
    });

    this.activeToasts.set(id, { id, el: toastEl, timer });
    return id;
  }

  public dismiss(id: string): void {
    const item = this.activeToasts.get(id);
    if (!item) return;

    clearTimeout(item.timer);
    this.activeToasts.delete(id);

    item.el.classList.remove("toast-enter");
    item.el.classList.add("toast-exit");

    setTimeout(() => {
      if (item.el.parentNode) {
        item.el.parentNode.removeChild(item.el);
      }
    }, 250);
  }

  public clearAll(): void {
    for (const [id] of this.activeToasts) {
      this.dismiss(id);
    }
  }

  public destroy(): void {
    if (this.unsubEvent) {
      this.unsubEvent();
      this.unsubEvent = undefined;
    }
    for (const [, item] of this.activeToasts) {
      clearTimeout(item.timer);
    }
    this.activeToasts.clear();
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  private getIcon(type: ToastType): string {
    switch (type) {
      case "success":
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      case "error":
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      case "warning":
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      case "info":
      default:
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

export const toastManager = new ToastComponent();
