// =====================================================================
// client/src/game.ts
// The first-person 3D game (Three.js): dark map, flashlights with shadows,
// other players' avatars, smooth movement.
//
//  World   = plain data about the room (who is where, which way they look).
//            The network code writes into it; the 3D view reads from it.
//  createView = draws everything, reads mouse/keyboard/touch, moves YOUR
//            player instantly (client-side prediction) and glides everyone
//            else between server updates (interpolation).
// =====================================================================
import * as THREE from 'three';
import { EYE_HEIGHT, MAP_D, MAP_W, Mover, TICK_DT, WALLS, WALL_H, MAX_PLAYERS } from '../../shared/game';
import { Avatar3D, buildAvatar, FLASH_ANGLE, FLASH_RANGE } from './avatar3d';
import type { Settings } from './ui';
import { HEAR_FULL, HEAR_MAX, Voice } from './voice';

export interface PlayerInfo {
  s: number; // slot
  n: string; // name
  a: number; // avatar
  x: number;
  z: number;
  w: number; // yaw (facing)
}

interface Sample {
  t: number; // when we received it (ms)
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

const INTERP_DELAY = 100; // draw other players 100 ms in the past so we always have 2 points to glide between
const PITCH_LIMIT = 1.45; // can't look past straight up/down

/** Turn an angle into the range -PI..PI. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------
// World: the data
// ---------------------------------------------------------------------
export class World {
  infos = new Map<number, PlayerInfo>();
  private buffers = new Map<number, Sample[]>(); // recent positions of OTHER players
  // my own player (predicted locally)
  lx = 0;
  lz = 0;
  yaw = 0; // where I look (left/right)
  pitch = 0; // where I look (up/down)
  private seq = 0;
  private pending: { seq: number; ix: number; iy: number; yaw: number }[] = []; // inputs the server hasn't confirmed yet
  fps = 0;

  constructor(
    public me: number,
    players: PlayerInfo[],
    private mover: Mover,
    private sendInput: (seq: number, ix: number, iy: number, yaw: number, pitch: number) => void,
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
        this.lz = p.z;
        if (this.seq === 0) this.yaw = p.w; // first join: face the spawn direction
      } else {
        this.buffers.set(p.s, [{ t: now, x: p.x, z: p.z, yaw: p.w, pitch: 0 }]);
      }
    }
  }

  addPlayer(p: PlayerInfo) {
    this.infos.set(p.s, p);
    this.buffers.set(p.s, [{ t: performance.now(), x: p.x, z: p.z, yaw: p.w, pitch: 0 }]);
  }

  removePlayer(slot: number) {
    this.infos.delete(slot);
    this.buffers.delete(slot);
  }

  /** Server update: [slot, x, z, ack, yaw, pitch,  slot, x, z, ...] */
  onSnapshot(a: number[]) {
    const now = performance.now();
    for (let i = 0; i + 5 < a.length; i += 6) {
      const slot = a[i];
      if (slot === this.me) {
        this.reconcile(a[i + 1], a[i + 2], a[i + 3]);
      } else {
        const buf = this.buffers.get(slot);
        if (!buf) continue;
        buf.push({ t: now, x: a[i + 1], z: a[i + 2], yaw: a[i + 4], pitch: a[i + 5] });
        if (buf.length > 12) buf.shift();
      }
    }
  }

  /**
   * Prediction fix-up. The server says "you are at (sx, sz) after input #ack".
   * We replay the inputs it hasn't seen yet to guess where we SHOULD be now,
   * then nudge our local position toward that (a big error just snaps).
   */
  private reconcile(sx: number, sz: number, ack: number) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    let ex = sx;
    let ez = sz;
    for (const p of this.pending) [ex, ez] = this.mover.step(ex, ez, p.ix, p.iy, p.yaw, TICK_DT);
    const dx = ex - this.lx;
    const dz = ez - this.lz;
    if (Math.hypot(dx, dz) > 1.2) {
      this.lx = ex;
      this.lz = ez; // way off -> snap
    } else {
      this.lx += dx * 0.2; // slightly off -> glide back
      this.lz += dz * 0.2;
    }
  }

  /** Move my player right now using the input (the shared Rapier physics). */
  moveMine(ix: number, iy: number, dtSeconds: number) {
    [this.lx, this.lz] = this.mover.step(this.lx, this.lz, ix, iy, this.yaw, dtSeconds);
  }

  /** Send my input + look direction to the server (called every 50 ms). */
  sendMine(ix: number, iy: number) {
    this.seq++;
    this.pending.push({ seq: this.seq, ix, iy, yaw: this.yaw });
    if (this.pending.length > 60) this.pending.shift();
    this.sendInput(this.seq, ix, iy, this.yaw, this.pitch);
  }

  /** Where to DRAW another player right now (smoothly between two updates). */
  stateOf(slot: number, now: number): Sample | null {
    const buf = this.buffers.get(slot);
    if (!buf || buf.length === 0) return null;
    const t = now - INTERP_DELAY;
    if (t <= buf[0].t) return buf[0];
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return {
          t,
          x: a.x + (b.x - a.x) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: a.yaw + wrap(b.yaw - a.yaw) * f,
          pitch: a.pitch + (b.pitch - a.pitch) * f,
        };
      }
    }
    return buf[buf.length - 1];
  }
}

// ---------------------------------------------------------------------
// The 3D view
// ---------------------------------------------------------------------
export interface ViewData {
  world: World;
  voice: Voice;
  settings: Settings;
  getStick: () => { x: number; y: number };
  consumeLook: () => { dx: number; dy: number }; // touch look (pixels moved)
  onLockChange?: (locked: boolean) => void;
}

export interface ViewHandle {
  destroy: () => void;
}

/** Texture drawn in code (no image files). */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createView(parent: HTMLElement, data: ViewData): ViewHandle {
  const { world, voice, settings } = data;

  // ---------- renderer, scene, camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  parent.appendChild(renderer.domElement);
  renderer.domElement.className = 'game-canvas';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.035); // distance fades into darkness
  scene.add(new THREE.AmbientLight(0x303048, 0.5)); // almost no light: the map is DARK

  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 80);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch (normal FPS camera)
  scene.add(camera);

  // ---------- the map: floor + walls ----------
  const floorTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#4a4a54';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#33333b';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.12})`;
      g.fillRect(Math.random() * 120, Math.random() * 120, 3 + Math.random() * 8, 3 + Math.random() * 8);
    }
  });
  floorTex.repeat.set(MAP_W / 2, MAP_D / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(MAP_W / 2, 0, MAP_D / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const wallTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#8a8aa0';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#55556a';
    g.lineWidth = 4;
    for (let y = 0; y < 128; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(128, y);
      g.stroke();
      const off = (y / 32) % 2 ? 0 : 32;
      for (let x = off; x < 128; x += 64) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 32);
        g.stroke();
      }
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
      g.fillRect(Math.random() * 120, Math.random() * 120, 4 + Math.random() * 10, 4 + Math.random() * 10);
    }
  });
  const crateTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#8b6a3e';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#5a4020';
    g.lineWidth = 5;
    g.strokeRect(2, 2, 60, 60);
    g.beginPath();
    g.moveTo(2, 2);
    g.lineTo(62, 62);
    g.moveTo(62, 2);
    g.lineTo(2, 62);
    g.stroke();
  });
  for (const [x, z, w, d, h = WALL_H] of WALLS) {
    const crate = h < WALL_H;
    const tex = (crate ? crateTex : wallTex).clone();
    tex.needsUpdate = true;
    tex.repeat.set(crate ? 1 : Math.max(w, d) / 2, crate ? 1 : h / 2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    mesh.position.set(x + w / 2, h / 2, z + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- my flashlight: a spotlight attached to the camera ----------
  const myLight = new THREE.SpotLight(0xfff1d6, 50, FLASH_RANGE, FLASH_ANGLE, 0.45, 2);
  myLight.position.set(0.15, -0.12, 0);
  const myTarget = new THREE.Object3D();
  myTarget.position.set(0.15, -0.12, -5);
  camera.add(myLight, myTarget);
  myLight.target = myTarget;

  // ---------- other players ----------
  const avatars = new Map<number, Avatar3D>();

  /** Shadows: only as many shadow-casting lights as the GPU can handle. */
  function applyQuality() {
    const low = settings.lowGfx;
    renderer.shadowMap.enabled = !low;
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    // each shadow-casting light uses a GPU texture slot; keep a few slots free
    let budget = Math.max(1, Math.min(MAX_PLAYERS, renderer.capabilities.maxTextures - 5));
    const setShadow = (l: THREE.SpotLight, size: number) => {
      const on = !low && budget > 0;
      if (on) budget--;
      l.castShadow = on;
      l.shadow.mapSize.set(size, size);
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.03;
      l.shadow.camera.near = 0.2;
      l.shadow.camera.far = FLASH_RANGE;
      l.shadow.map?.dispose();
      l.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    };
    setShadow(myLight, 1024); // my own light first
    for (const a of avatars.values()) setShadow(a.spot, 512);
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true; // shaders must be rebuilt when shadows switch on/off
    });
    resize();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---------- controls ----------
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();

  const canvas = renderer.domElement;
  const hasPointerLock = 'requestPointerLock' in canvas && !window.matchMedia('(pointer: coarse)').matches;
  const onMouseMove = (e: MouseEvent) => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && !(e.buttons & 1)) return; // not locked: only look while dragging
    const k = 0.0022 * settings.sens;
    world.yaw = wrap(world.yaw - e.movementX * k);
    world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch - e.movementY * k));
  };
  const onCanvasClick = () => {
    if (hasPointerLock && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
  };
  const onLockChange = () => data.onLockChange?.(document.pointerLockElement === canvas);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', resize);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onLockChange);
  const stopListening = settings.onChange(applyQuality);
  if (hasPointerLock) data.onLockChange?.(false);

  // ---------- the game loop ----------
  let raf = 0;
  let last = performance.now();
  let sendTimer = 0;
  let lastSent = '';

  function frame(nowMs: number) {
    raf = requestAnimationFrame(frame);
    const dtMs = Math.min(nowMs - last, 100);
    last = nowMs;
    const dt = dtMs / 1000;
    if (dtMs > 0) world.fps = world.fps * 0.9 + (1000 / dtMs) * 0.1;

    // ---- 1. look: touch drag on the right half of the screen ----
    const look = data.consumeLook();
    if (look.dx || look.dy) {
      const k = 0.0045 * settings.sens;
      world.yaw = wrap(world.yaw - look.dx * k);
      world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch - look.dy * k));
    }

    // ---- 2. move: WASD / arrows or the left-thumb joystick ----
    let ix = 0;
    let iy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 100;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 100;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 100;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 100;
    const stick = data.getStick();
    if (stick.x !== 0 || stick.y !== 0) {
      ix = Math.round(stick.x * 100);
      iy = Math.round(stick.y * 100);
    }

    // ---- 3. predict: my player moves right away ----
    if (ix !== 0 || iy !== 0) world.moveMine(ix, iy, dt);

    // ---- 4. tell the server 20 times per second (when moving, looking, or just stopped) ----
    sendTimer += dtMs;
    if (sendTimer >= 50) {
      sendTimer = 0;
      const sig = `${ix},${iy},${world.yaw.toFixed(3)},${world.pitch.toFixed(3)}`;
      if (ix !== 0 || iy !== 0 || sig !== lastSent) world.sendMine(ix, iy);
      lastSent = sig;
    }

    // ---- 5. camera = my eyes ----
    camera.position.set(world.lx, EYE_HEIGHT, world.lz);
    camera.rotation.set(world.pitch, world.yaw, 0);

    // ---- 6. other players: add / remove / glide ----
    for (const [slot, a] of avatars) {
      if (!world.infos.has(slot)) {
        scene.remove(a.group);
        avatars.delete(slot);
        a.group.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose?.();
        });
      }
    }
    const now = performance.now();
    const t = now / 1000;
    for (const info of world.infos.values()) {
      if (info.s === world.me) continue;
      let a = avatars.get(info.s);
      if (!a) {
        a = buildAvatar(info.a, info.n);
        avatars.set(info.s, a);
        scene.add(a.group);
        applyQuality(); // give the new flashlight shadows (if allowed)
      }
      const st = world.stateOf(info.s, now);
      if (!st) continue;
      a.group.position.set(st.x, 0, st.z);
      a.group.rotation.y = st.yaw;
      a.pivot.rotation.x = st.pitch;
      a.update(t);

      // ---- 7. proximity voice: closer = louder, far = silent ----
      const d = Math.hypot(st.x - world.lx, st.z - world.lz);
      const vol = d <= HEAR_FULL ? 1 : d >= HEAR_MAX ? 0 : Math.pow(1 - (d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL), 2);
      voice.setVolume(info.s, vol);
      a.talk.visible = voice.isSpeaking(info.s);
    }

    renderer.render(scene, camera);
  }

  applyQuality();
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      stopListening();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', onCanvasClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      renderer.dispose();
      canvas.remove();
    },
  };
}
