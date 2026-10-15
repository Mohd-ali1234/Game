// =====================================================================
// client/src/ui.ts
// Small on-screen helpers made of plain HTML:
//   - Joystick   : left-thumb touch stick for phones (move)
//   - LookPad    : drag on the right half of the screen to look around (phones)
//   - Settings   : look sensitivity, field of view, quality preset (saved on the device)
//   - DebugPanel : errors, connection status, ping, FPS, download size, player count
//   - toast()    : short pop-up messages ("Sam joined")
// =====================================================================
import type { Quality } from './materials';

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
/** Drag anywhere on the right half of the screen to look around (phones). */
export class LookPad {
  private dx = 0;
  private dy = 0;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'look-pad'; // covers the right half of the screen
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.dx += e.clientX - this.lastX;
      this.dy += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.pointerId = null;
    };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
  }

  /** How many pixels the finger moved since the last call. */
  consume(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }

  show(visible: boolean) {
    this.el.style.display = visible ? 'block' : 'none';
    if (!visible) this.pointerId = null;
  }
}

// ---------------------------------------------------------------------
/** Player settings, remembered on this device. */
export class Settings {
  sens = 1; // look sensitivity multiplier (0.2 - 3)
  fov = 75; // field of view in degrees (50 - 110)
  // Low = no shadows, no effects, small textures (budget phones)
  // Medium = flashlight shadow, light effects (default on phones)
  // High = everything, full resolution (default on computers)
  quality: Quality = isTouchDevice() ? 'medium' : 'high';
  qualityChosen = false; // true once the player picks a preset (then we never change it for them)
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('dh_settings') ?? 'null');
      if (saved) {
        if (typeof saved.sens === 'number') this.sens = saved.sens;
        if (typeof saved.fov === 'number') this.fov = saved.fov;
        if (['low', 'medium', 'high'].includes(saved.quality)) this.quality = saved.quality;
        else if (saved.lowGfx === true) this.quality = 'low'; // older saved setting
        this.qualityChosen = saved.qualityChosen === true;
      }
    } catch {
      /* storage blocked: use defaults */
    }
  }

  /** Call `fn` whenever a setting changes. Returns a function that stops listening. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  update(patch: Partial<Pick<Settings, 'sens' | 'fov' | 'quality' | 'qualityChosen'>>) {
    Object.assign(this, patch);
    try {
      localStorage.setItem('dh_settings', JSON.stringify({ sens: this.sens, fov: this.fov, quality: this.quality, qualityChosen: this.qualityChosen }));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((f) => f());
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
    const origWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      this.log('warning: ' + args.map(String).join(' '));
      origWarn(...args);
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
