// =====================================================================
// client/src/sound.ts
// The mansion's sounds. Every sound is generated in code (Web Audio) until
// you upload a real one to client/public/sounds/ with these names:
//   floor_creak   footstep   door_creak   door_locked   whisper   clock_tick
// e.g. sounds/floor_creak.ogg  (.ogg, .mp3 or .wav). Short files are best.
// Sounds come from where they happen: louder when close, left/right in
// stereo, quieter from another floor.
// =====================================================================
import type { Layout, SoundSpot } from '../../shared/layout';
import type { Assets } from './assets';

export class Soundscape {
  private master: GainNode;
  private noise: AudioBuffer;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private clocks: SoundSpot[];
  private windows: SoundSpot[];
  private nextTick = 0;
  private tickTock = false;
  private nextWhisper = 0;
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private humGain: GainNode;
  private files = new Map<string, AudioBuffer>();

  constructor(private ac: AudioContext, assets: Assets, layout: Layout) {
    this.master = ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ac.destination);
    this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.clocks = layout.sounds.filter((s) => s.type === 'clock');
    this.windows = layout.sounds.filter((s) => s.type === 'wind');
    this.nextWhisper = ac.currentTime + 12 + Math.random() * 15;

    // load any uploaded sound files (they replace the generated ones)
    for (const key of ['floor_creak', 'footstep', 'door_creak', 'door_locked', 'whisper', 'clock_tick']) {
      if (assets.hasSound(key)) void assets.sound(key, ac).then((b) => b && this.files.set(key, b));
    }

    // --- wind against the windows: always on, louder near a window ---
    const windSrc = ac.createBufferSource();
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    this.windFilter = ac.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    const whistle = ac.createBiquadFilter();
    whistle.type = 'bandpass';
    whistle.frequency.value = 820;
    whistle.Q.value = 14;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain);
    windSrc.connect(whistle).connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    // --- low hum when a ghost is near ---
    this.humGain = ac.createGain();
    this.humGain.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    for (const f of [52, 55.4, 104.5]) {
      const o = ac.createOscillator();
      o.type = f > 100 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    lp.connect(this.humGain).connect(this.master);
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
  }

  /** Volume + left/right for a sound at (x, y, z). */
  private spatial(x: number, y: number, z: number, range = 2.5) {
    const dx = x - this.lx;
    const dz = z - this.lz;
    const d = Math.hypot(dx, y - this.ly, dz);
    const floorPenalty = Math.abs(y - this.ly) > 2.2 ? 0.3 : 1;
    const gain = floorPenalty / (1 + (d / range) * (d / range));
    const rx = Math.cos(this.lyaw);
    const rz = -Math.sin(this.lyaw);
    const pan = d > 0.1 ? Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / Math.hypot(dx, dz || 1e-3)) * 0.8)) : 0;
    return { gain, pan };
  }

  /** Route a sound through volume + stereo position; returns the input node. */
  private out(x: number, y: number, z: number, vol: number, range?: number): AudioNode {
    const { gain, pan } = this.spatial(x, y, z, range);
    const g = this.ac.createGain();
    g.gain.value = vol * gain;
    const p = this.ac.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    return g;
  }

  private file(key: string, x: number, y: number, z: number, vol: number): boolean {
    const b = this.files.get(key);
    if (!b) return false;
    const s = this.ac.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    s.connect(this.out(x, y, z, vol));
    s.start();
    return true;
  }

  private noiseBurst(dest: AudioNode, t: number, len: number, type: BiquadFilterType, freq: number, q: number, vol: number) {
    const s = this.ac.createBufferSource();
    s.buffer = this.noise;
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, len + 0.05);
  }

  /** Wood under stress: a jittery sawtooth through resonant filters. */
  private creak(dest: AudioNode, t: number, len: number, base: number, vol: number) {
    const o = this.ac.createOscillator();
    o.type = 'sawtooth';
    const steps = Math.max(6, Math.floor(len * 24));
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = base * (0.8 + Math.random() * 0.45) * (i % 3 === 0 ? 0.7 : 1); // stick-slip
    o.frequency.setValueCurveAtTime(curve, t, len);
    const b1 = this.ac.createBiquadFilter();
    b1.type = 'bandpass';
    b1.frequency.value = 650 + Math.random() * 500;
    b1.Q.value = 8;
    const b2 = this.ac.createBiquadFilter();
    b2.type = 'bandpass';
    b2.frequency.value = 1800 + Math.random() * 600;
    b2.Q.value = 5;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol * 0.8, t + len * 0.7);
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(b1).connect(g);
    o.connect(b2).connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** A footstep; old floorboards creak now and then. */
  footstep(x: number, y: number, z: number, mine: boolean) {
    const vol = mine ? 0.5 : 0.8;
    const t = this.ac.currentTime;
    if (!this.file('footstep', x, y, z, vol * 0.5)) this.noiseBurst(this.out(x, y, z, vol), t, 0.07, 'lowpass', 260, 1, 0.5);
    if (Math.random() < 0.3 && !this.file('floor_creak', x, y, z, vol * 0.6)) this.creak(this.out(x, y, z, vol), t + 0.03, 0.18 + Math.random() * 0.25, 130 + Math.random() * 120, 0.16);
  }

  doorCreak(x: number, y: number, z: number) {
    if (!this.file('door_creak', x, y, z, 1)) this.creak(this.out(x, y, z, 1, 4), this.ac.currentTime, 0.9 + Math.random() * 0.4, 85 + Math.random() * 30, 0.3);
  }

  doorLocked(x: number, y: number, z: number) {
    if (this.file('door_locked', x, y, z, 1)) return;
    const dest = this.out(x, y, z, 1, 4);
    const t = this.ac.currentTime;
    for (const dt of [0, 0.09, 0.21]) this.noiseBurst(dest, t + dt, 0.04, 'bandpass', 1800, 2, 0.6);
    this.noiseBurst(dest, t, 0.15, 'lowpass', 150, 1, 0.5);
  }

  private whisper() {
    const a = Math.random() * Math.PI * 2; // somewhere around you, not too close
    const x = this.lx + Math.cos(a) * 6;
    const z = this.lz + Math.sin(a) * 6;
    if (this.file('whisper', x, this.ly + 1.5, z, 0.5)) return;
    const t = this.ac.currentTime;
    const len = 2 + Math.random() * 1.5;
    const dest = this.out(x, this.ly + 1.5, z, 0.9, 6);
    for (let voice = 0; voice < 2; voice++) {
      const s = this.ac.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = this.ac.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 3 + voice * 2;
      const fc = new Float32Array(12).map(() => 1300 + Math.random() * 1600); // moving "mouth" shape
      f.frequency.setValueCurveAtTime(fc, t, len);
      const g = this.ac.createGain();
      const env = new Float32Array(Math.floor(len * 7)).map((_, i, arr) => (i === 0 || i === arr.length - 1 ? 0 : Math.random() < 0.25 ? 0.02 : 0.15 + Math.random() * 0.25));
      g.gain.setValueCurveAtTime(env, t + voice * 0.15, len);
      s.connect(f).connect(g).connect(dest);
      s.start(t + voice * 0.15);
      s.stop(t + len + 0.3);
    }
  }

  private tick(c: SoundSpot, t: number) {
    const { gain } = this.spatial(c.x, c.y, c.z, 3);
    if (gain < 0.02) return;
    const dest = this.out(c.x, c.y, c.z, 0.55, 3);
    const b = this.files.get('clock_tick');
    if (b) {
      const s = this.ac.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = this.tickTock ? 1 : 0.92;
      s.connect(dest);
      s.start(t);
    } else this.noiseBurst(dest, t, 0.02, 'bandpass', this.tickTock ? 3300 : 2500, 4, 0.9);
  }

  /** Called every frame. ghostDist = how far the nearest visible ghost is. */
  update(ghostDist: number) {
    const ac = this.ac;
    const now = ac.currentTime;
    // clocks: tick... tock... (scheduled slightly ahead so it's perfectly steady)
    if (this.nextTick < now) this.nextTick = now + 0.05;
    while (this.nextTick < now + 0.15) {
      this.tickTock = !this.tickTock;
      for (const c of this.clocks) this.tick(c, this.nextTick);
      this.nextTick += 1;
    }
    // whispers every 20-50 seconds
    if (now > this.nextWhisper) {
      this.whisper();
      this.nextWhisper = now + 20 + Math.random() * 30;
    }
    // wind: louder close to a window
    let wd = Infinity;
    for (const w of this.windows) if (Math.abs(w.y - this.ly - 1.5) < 3) wd = Math.min(wd, Math.hypot(w.x - this.lx, w.z - this.lz));
    const gust = 0.6 + 0.4 * Math.sin(now * 0.37) * Math.sin(now * 0.11 + 1);
    const windLevel = (0.02 + 0.13 * Math.max(0, 1 - wd / 6)) * gust;
    this.windGain.gain.setTargetAtTime(windLevel, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + gust * 300, now, 0.5);
    // ghost hum
    const hum = ghostDist < 9 ? (1 - ghostDist / 9) * 0.12 : 0;
    this.humGain.gain.setTargetAtTime(hum, now, 0.4);
  }

  dispose() {
    this.master.disconnect();
  }
}
