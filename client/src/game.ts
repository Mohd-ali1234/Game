// =====================================================================
// client/src/game.ts
// The Phaser 3 game: dark map, lights, avatars, and smooth movement.
//
//  World         = plain data about the room (who is where). The network code
//                  writes into it; the Phaser scene reads from it every frame.
//  GameScene     = draws everything and moves YOUR player instantly
//                  (client-side prediction), gliding everyone else
//                  between server updates (interpolation).
// =====================================================================
import Phaser from 'phaser';
import { MAP_H, MAP_W, TICK_DT, WALLS, moveStep } from '../../shared/game';
import { avatarCanvas } from './avatars';
import { HEAR_FULL, HEAR_MAX, Voice } from './voice';

export interface PlayerInfo {
  s: number; // slot
  n: string; // name
  a: number; // avatar
  x: number;
  y: number;
}

interface Sample {
  t: number; // when we received it (ms)
  x: number;
  y: number;
}

const INTERP_DELAY = 100; // draw other players 100ms in the past so we always have 2 points to glide between

// ---------------------------------------------------------------------
// World: the data
// ---------------------------------------------------------------------
export class World {
  infos = new Map<number, PlayerInfo>();
  private buffers = new Map<number, Sample[]>(); // recent positions of OTHER players
  // my own player (predicted locally)
  lx = 0;
  ly = 0;
  private seq = 0;
  private pending: { seq: number; ix: number; iy: number }[] = []; // inputs the server hasn't confirmed yet
  fps = 0;

  constructor(
    public me: number,
    players: PlayerInfo[],
    private sendInput: (seq: number, ix: number, iy: number) => void,
  ) {
    this.resync(players);
  }

  /** Replace everything with a fresh list from the server (join / reconnect). */
  resync(players: PlayerInfo[]) {
    this.infos.clear();
    this.buffers.clear();
    this.pending = [];
    const now = performance.now();
    for (const p of players) {
      this.infos.set(p.s, p);
      if (p.s === this.me) {
        this.lx = p.x;
        this.ly = p.y;
      } else {
        this.buffers.set(p.s, [{ t: now, x: p.x, y: p.y }]);
      }
    }
  }

  addPlayer(p: PlayerInfo) {
    this.infos.set(p.s, p);
    this.buffers.set(p.s, [{ t: performance.now(), x: p.x, y: p.y }]);
  }

  removePlayer(slot: number) {
    this.infos.delete(slot);
    this.buffers.delete(slot);
  }

  /** Server update: [slot, x, y, ack, slot, x, y, ack, ...] */
  onSnapshot(a: number[]) {
    const now = performance.now();
    for (let i = 0; i + 3 < a.length; i += 4) {
      const slot = a[i];
      const x = a[i + 1];
      const y = a[i + 2];
      if (slot === this.me) {
        this.reconcile(x, y, a[i + 3]);
      } else {
        const buf = this.buffers.get(slot);
        if (!buf) continue;
        buf.push({ t: now, x, y });
        if (buf.length > 12) buf.shift();
      }
    }
  }

  /**
   * Prediction fix-up. The server says "you are at (sx, sy) after input #ack".
   * We replay the inputs it hasn't seen yet to guess where we SHOULD be now,
   * then nudge our local position toward that (a big error just snaps).
   */
  private reconcile(sx: number, sy: number, ack: number) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    let ex = sx;
    let ey = sy;
    for (const p of this.pending) [ex, ey] = moveStep(ex, ey, p.ix, p.iy, TICK_DT);
    const dx = ex - this.lx;
    const dy = ey - this.ly;
    if (Math.hypot(dx, dy) > 60) {
      this.lx = ex;
      this.ly = ey; // way off -> snap
    } else {
      this.lx += dx * 0.2; // slightly off -> glide back
      this.ly += dy * 0.2;
    }
  }

  /** Move my player right now using the input, and remember it for the server. */
  moveMine(ix: number, iy: number, dtSeconds: number) {
    [this.lx, this.ly] = moveStep(this.lx, this.ly, ix, iy, dtSeconds);
  }

  /** Send my input to the server (called every 50ms). */
  sendMine(ix: number, iy: number) {
    this.seq++;
    this.pending.push({ seq: this.seq, ix, iy });
    if (this.pending.length > 60) this.pending.shift();
    this.sendInput(this.seq, ix, iy);
  }

  /** Where to DRAW another player right now (smoothly between two updates). */
  positionOf(slot: number, now: number): { x: number; y: number } | null {
    const buf = this.buffers.get(slot);
    if (!buf || buf.length === 0) return null;
    const t = now - INTERP_DELAY;
    if (t <= buf[0].t) return buf[0];
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return buf[buf.length - 1];
  }
}

// ---------------------------------------------------------------------
// The Phaser scene
// ---------------------------------------------------------------------
interface Visual {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  talk: Phaser.GameObjects.Text;
  light: Phaser.GameObjects.Light | null;
}

export interface SceneData {
  world: World;
  voice: Voice;
  getStick: () => { x: number; y: number };
}

class GameScene extends Phaser.Scene {
  private world!: World;
  private voice!: Voice;
  private getStick!: () => { x: number; y: number };
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private visuals = new Map<number, Visual>();
  private lit = false; // is WebGL lighting available?
  private sendTimer = 0;
  private lastSent = '';

  constructor() {
    super('main');
  }

  init(data: SceneData) {
    this.world = data.world;
    this.voice = data.voice;
    this.getStick = data.getStick;
  }

  create() {
    this.lit = this.renderer.type === Phaser.WEBGL;
    this.makeTextures();

    // Dark world: only lights reveal things
    if (this.lit) this.lights.enable().setAmbientColor(0x16161f);

    const floor = this.add.tileSprite(0, 0, MAP_W, MAP_H, 'floor').setOrigin(0).setDepth(0);
    this.light2d(floor);
    for (const [x, y, w, h] of WALLS) {
      const wall = this.add.tileSprite(x, y, w, h, 'wall').setOrigin(0).setDepth(2);
      this.light2d(wall);
    }

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;

    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());
    this.events.once('shutdown', () => this.scale.off('resize'));
  }

  /** Zoom so the view looks similar on a small phone and a big monitor. */
  private fitCamera() {
    const { width, height } = this.scale;
    this.cameras.main.setZoom(Phaser.Math.Clamp(Math.min(width, height) / 520, 0.7, 1.6));
  }

  private light2d(obj: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite) {
    if (this.lit) obj.setPipeline('Light2D');
  }

  /** Draw the floor / wall / avatar textures in code (no image files). */
  private makeTextures() {
    const make = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
      this.textures.addCanvas(key, c);
    };
    make('floor', 64, 64, (g) => {
      g.fillStyle = '#2b2b33';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#23232a';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 64, 64);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`;
        g.fillRect(Math.random() * 60, Math.random() * 60, 2 + Math.random() * 4, 2 + Math.random() * 4);
      }
    });
    make('wall', 32, 32, (g) => {
      g.fillStyle = '#6b6b80';
      g.fillRect(0, 0, 32, 32);
      g.strokeStyle = '#4a4a5c';
      g.lineWidth = 2;
      g.strokeRect(1, 1, 30, 30);
      g.beginPath();
      g.moveTo(0, 16);
      g.lineTo(32, 16);
      g.moveTo(16, 0);
      g.lineTo(16, 16);
      g.moveTo(8, 16);
      g.lineTo(8, 32);
      g.moveTo(24, 16);
      g.lineTo(24, 32);
      g.stroke();
    });
    for (let i = 0; i < 8; i++) {
      this.textures.addCanvas('av' + i, avatarCanvas(i));
    }
  }

  private makeVisual(info: PlayerInfo): Visual {
    const mine = info.s === this.world.me;
    const sprite = this.add.image(info.x, info.y - 4, 'av' + info.a).setDepth(5);
    this.light2d(sprite);
    const label = this.add
      .text(info.x, info.y - 40, info.n, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: mine ? '#ffe9a8' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(10);
    const talk = this.add.text(info.x, info.y - 58, '🔊', { fontSize: '16px' }).setOrigin(0.5).setDepth(10).setVisible(false);
    // Each player carries a flashlight-style light. Mine is bigger and warmer.
    const light = this.lit
      ? this.lights.addLight(info.x, info.y, mine ? 290 : 220, mine ? 0xfff1d6 : 0xdfe8ff, mine ? 1.4 : 1.1)
      : null;
    return { sprite, label, talk, light };
  }

  private dropVisual(v: Visual) {
    v.sprite.destroy();
    v.label.destroy();
    v.talk.destroy();
    if (v.light) this.lights.removeLight(v.light);
  }

  update(time: number, delta: number) {
    const w = this.world;
    const dt = Math.min(delta, 100) / 1000;
    w.fps = this.game.loop.actualFps;

    // ---- 1. read input: keyboard or on-screen joystick ----
    const k = this.keys;
    let ix = 0;
    let iy = 0;
    if (k.A.isDown || k.LEFT.isDown) ix -= 100;
    if (k.D.isDown || k.RIGHT.isDown) ix += 100;
    if (k.W.isDown || k.UP.isDown) iy -= 100;
    if (k.S.isDown || k.DOWN.isDown) iy += 100;
    const stick = this.getStick();
    if (stick.x !== 0 || stick.y !== 0) {
      ix = Math.round(stick.x * 100);
      iy = Math.round(stick.y * 100);
    }

    // ---- 2. move my player right away (prediction) ----
    if (ix !== 0 || iy !== 0) w.moveMine(ix, iy, dt);

    // ---- 3. tell the server 20 times per second (only when moving, or just stopped) ----
    this.sendTimer += delta;
    if (this.sendTimer >= 50) {
      this.sendTimer = 0;
      const sig = ix + ',' + iy;
      if (ix !== 0 || iy !== 0 || sig !== this.lastSent) w.sendMine(ix, iy);
      this.lastSent = sig;
    }

    // ---- 4. keep sprites in sync with who is in the room ----
    for (const [slot, v] of this.visuals) {
      if (!w.infos.has(slot)) {
        this.dropVisual(v);
        this.visuals.delete(slot);
      }
    }
    const now = performance.now();
    for (const info of w.infos.values()) {
      let v = this.visuals.get(info.s);
      if (!v) {
        v = this.makeVisual(info);
        this.visuals.set(info.s, v);
        if (info.s === w.me) this.cameras.main.startFollow(v.sprite, true, 0.12, 0.12);
      }
      const mine = info.s === w.me;
      const pos = mine ? { x: w.lx, y: w.ly } : w.positionOf(info.s, now);
      if (!pos) continue;
      v.sprite.setPosition(pos.x, pos.y - 4);
      v.label.setPosition(pos.x, pos.y - 40);
      v.talk.setPosition(pos.x, pos.y - 58);
      v.light?.setPosition(pos.x, pos.y);

      // ---- 5. proximity voice: closer = louder, far = silent ----
      if (mine) {
        v.talk.setVisible(this.voice.localSpeaking());
      } else {
        const d = Math.hypot(pos.x - w.lx, pos.y - w.ly);
        const vol = d <= HEAR_FULL ? 1 : d >= HEAR_MAX ? 0 : Math.pow(1 - (d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL), 2);
        this.voice.setVolume(info.s, vol);
        v.talk.setVisible(this.voice.isSpeaking(info.s));
      }
    }
  }
}

// ---------------------------------------------------------------------
// Start / stop the Phaser game
// ---------------------------------------------------------------------
export interface GameHandle {
  destroy: () => void;
}

export function createGame(parent: HTMLElement, data: SceneData): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    disableContextMenu: true,
    render: { antialias: true, powerPreference: 'low-power' },
    fps: { target: 60 },
    scene: [],
  });
  game.scene.add('main', GameScene, true, data);
  return { destroy: () => game.destroy(true) };
}

