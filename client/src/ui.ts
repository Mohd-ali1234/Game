// =====================================================================
// client/src/ui.ts
// Small on-screen helpers made of plain HTML:
//   - Joystick   : touch stick for phones
//   - DebugPanel : errors, connection status, ping, FPS, player count
//   - toast()    : short pop-up messages ("Sam joined")
// =====================================================================

/** True on phones/tablets (touch screens). */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

// ---------------------------------------------------------------------
export class Joystick {
  /** Current stick position, each from -1 to 1 */
  x = 0;
  y = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;

  constructor(parent: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    parent.appendChild(this.base);

    this.base.addEventListener('pointerdown', (e) => {
      this.pointerId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.update(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.update(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.x = this.y = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);
  }

  private update(e: PointerEvent) {
    const r = this.base.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy);
    const max = radius * 0.7; // how far the knob can travel
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // small dead zone so the player doesn't drift
    const nx = dx / max;
    const ny = dy / max;
    const mag = Math.hypot(nx, ny);
    if (mag < 0.12) {
      this.x = this.y = 0;
    } else {
      this.x = nx;
      this.y = ny;
    }
  }

  show(visible: boolean) {
    this.base.style.display = visible ? 'block' : 'none';
  }
}

// ---------------------------------------------------------------------
export class DebugPanel {
  private box: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private logEl: HTMLDivElement;
  private lines: string[] = [];
  private stats: Record<string, string | number> = {};

  constructor(root: HTMLElement) {
    this.box = document.createElement('div');
    this.box.className = 'debug-box hidden';
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'debug-stats';
    this.logEl = document.createElement('div');
    this.logEl.className = 'debug-log';
    this.box.append(this.statsEl, this.logEl);
    root.appendChild(this.box);

    // Catch every error so you can read it on your phone
    window.addEventListener('error', (e) => this.log(`ERROR: ${e.message} (${(e.filename ?? '').split('/').pop()}:${e.lineno})`));
    window.addEventListener('unhandledrejection', (e) => this.log(`PROMISE ERROR: ${String((e as PromiseRejectionEvent).reason)}`));
    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      this.log('console.error: ' + args.map(String).join(' '));
      origError(...args);
    };
  }

  toggle() {
    this.box.classList.toggle('hidden');
    this.render();
  }

  log(msg: string) {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    this.lines.push(`[${t}] ${msg}`);
    if (this.lines.length > 40) this.lines.shift();
    this.render();
  }

  set(key: string, value: string | number) {
    this.stats[key] = value;
  }

  render() {
    if (this.box.classList.contains('hidden')) return;
    this.statsEl.textContent = Object.entries(this.stats)
      .map(([k, v]) => `${k}: ${v}`)
      .join('   ');
    this.logEl.textContent = this.lines.slice().reverse().join('\n') || '(no messages yet)';
  }
}

// ---------------------------------------------------------------------
export function toast(text: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.getElementById('toasts')?.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
