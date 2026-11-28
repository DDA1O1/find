/**
 * Pre-session Emotionless Execution Gate.
 * Uses a native modal <dialog closedby="none"> that appears on every page refresh
 * and remains locked until the user confirms both emotional stability and rule adherence.
 */
export class DisciplineGateComponent {
  private dialog!: HTMLDialogElement;
  private stableCheckbox!: HTMLInputElement;
  private rulesCheckbox!: HTMLInputElement;
  private noBtn!: HTMLButtonElement;
  private enterBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;

  private isAccepted = false;
  private isDestroyed = false;

  constructor() {
    this.createDOM();
    this.bindEvents();
    this.open();
  }

  private createDOM(): void {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "discipline-gate";
    this.dialog.setAttribute("closedby", "none");
    this.dialog.setAttribute("aria-labelledby", "discipline-gate-title");

    this.dialog.innerHTML = `
      <div class="dg-card">
        <div class="dg-eyebrow">
          <span class="dg-dot" aria-hidden="true"></span>
          <span>Pre-Session Discipline Check</span>
        </div>

        <h1 class="dg-title" id="discipline-gate-title">Emotionless Execution Gate</h1>

        <div class="dg-manifesto">
          <p class="dg-lead">
            <strong>Trading does not compound — markets keep changing.</strong>
          </p>
          <p class="dg-body">
            The only things that truly compound are your <strong>knowledge</strong>, your
            <strong>wisdom</strong>, your ability to <strong>deal with people</strong> (even
            stressful ones), and your ability to <strong>communicate, write, speak, lead,
            strategize, and prioritize structure</strong>.
          </p>
          <p class="dg-body dg-emphasis">
            Do not take trading to heart — short-term outcomes are just randomness. Follow your
            rules mechanically. Not even a single bit of emotion belongs in your decisions.
            <strong>This is an emotionless business.</strong>
          </p>
        </div>

        <div class="dg-question">
          Are you emotionally stable right now, and will you follow your rules?
        </div>

        <div class="dg-checks">
          <label class="dg-check-item">
            <input type="checkbox" class="dg-checkbox" id="dg-check-stable" autofocus />
            <span class="dg-check-text">I am emotionally stable and clear-headed right now.</span>
          </label>
          <label class="dg-check-item">
            <input type="checkbox" class="dg-checkbox" id="dg-check-rules" />
            <span class="dg-check-text">I will follow my rules with zero emotion.</span>
          </label>
        </div>

        <p class="dg-status" id="dg-status" aria-live="polite"></p>

        <div class="dg-actions">
          <button type="button" class="dg-btn dg-btn-no" id="dg-btn-no" aria-describedby="dg-status">
            No — Not Ready
          </button>
          <button type="button" class="dg-btn dg-btn-yes" id="dg-btn-yes" disabled>
            Yes — Enter Charts
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.dialog);

    this.stableCheckbox = this.dialog.querySelector<HTMLInputElement>("#dg-check-stable")!;
    this.rulesCheckbox = this.dialog.querySelector<HTMLInputElement>("#dg-check-rules")!;
    this.noBtn = this.dialog.querySelector<HTMLButtonElement>("#dg-btn-no")!;
    this.enterBtn = this.dialog.querySelector<HTMLButtonElement>("#dg-btn-yes")!;
    this.statusEl = this.dialog.querySelector<HTMLElement>("#dg-status")!;
  }

  private bindEvents(): void {
    const syncEnterState = () => {
      const bothChecked = this.stableCheckbox.checked && this.rulesCheckbox.checked;
      this.enterBtn.disabled = !bothChecked;
      if (bothChecked) {
        this.clearStatus();
      }
    };

    this.stableCheckbox.addEventListener("change", syncEnterState);
    this.rulesCheckbox.addEventListener("change", syncEnterState);

    this.noBtn.addEventListener("click", () => {
      this.stableCheckbox.checked = false;
      this.rulesCheckbox.checked = false;
      this.enterBtn.disabled = true;
      this.showStatus(
        "Good call being honest. Step away from the charts — this gate stays locked until your mind is clear and you're ready to follow the rules.",
        "warn",
      );
      this.noBtn.focus();
    });

    this.enterBtn.addEventListener("click", () => {
      if (!this.stableCheckbox.checked || !this.rulesCheckbox.checked) return;
      this.isAccepted = true;
      this.dialog.returnValue = "accepted";
      this.dialog.close();
    });

    // Block Esc / platform close requests across browsers (including Safari without closedby="none")
    this.dialog.addEventListener("cancel", (e) => {
      if (!this.isAccepted) {
        e.preventDefault();
        this.showStatus(
          "Confirm both commitments to unlock the charts, or click No and step away.",
          "info",
        );
        this.noBtn.focus();
      }
    });

    // Guard against browsers that bypass cancel on repeated Esc presses
    this.dialog.addEventListener("close", () => {
      this.dialog.returnValue = "";
      if (!this.isAccepted && !this.isDestroyed) {
        this.open();
        this.showStatus(
          "This gate stays locked until you confirm you are emotionally stable and rule-bound.",
          "info",
        );
      }
    });
  }

  private showStatus(message: string, tone: "warn" | "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.className = `dg-status visible ${tone}`;
  }

  private clearStatus(): void {
    this.statusEl.className = "dg-status";
  }

  public open(): void {
    if (this.isDestroyed || this.dialog.open) return;
    if (typeof this.dialog.showModal === "function") {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
  }

  public get opened(): boolean {
    return this.dialog.open;
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.isAccepted = true;
    if (this.dialog.open) {
      this.dialog.close();
    }
    this.dialog.remove();
  }
}
