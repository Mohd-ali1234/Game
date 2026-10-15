// =====================================================================
// client/src/procedural.ts
// Textures generated in code, used until you upload real CC0 textures.
// Each material gets 3 maps that tile seamlessly:
//   color (what it looks like), normal (bumps for lighting), roughness (shine)
// Plus special textures: the flashlight "cookie", glows, painting atlas.
// =====================================================================
import * as THREE from 'three';

export interface PBRMaps {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

// ---------- small helpers ----------
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const smooth = (t: number) => t * t * (3 - 2 * t);
function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Value noise that wraps around (so textures tile). u, v in [0,1). */
function tileNoise(period: number, rnd: () => number) {
  const g = new Float32Array(period * period).map(() => rnd());
  return (u: number, v: number) => {
    const x = fract(u) * period;
    const y = fract(v) * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
  };
}
/** Several layers of noise (big blobs + fine detail). */
function fbm(rnd: () => number, base: number, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => tileNoise(base << i, rnd));
  return (u: number, v: number) => {
    let s = 0;
    let amp = 0.5;
    let norm = 0;
    for (const n of layers) {
      s += n(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
}

interface Raw {
  N: number;
  color: Float32Array; // rgb 0..1
  height: Float32Array;
  rough: Float32Array;
  normalStrength: number;
}
function raw(N: number, normalStrength = 2): Raw {
  return { N, color: new Float32Array(N * N * 3), height: new Float32Array(N * N), rough: new Float32Array(N * N), normalStrength };
}

function toTexture(N: number, fill: (img: Uint8ClampedArray) => void, srgb: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Turn the raw arrays into the 3 textures (normal map is computed from the height). */
function finish(r: Raw): PBRMaps {
  const { N, color, height, rough, normalStrength: k } = r;
  return {
    color: toTexture(N, (d) => {
      for (let i = 0; i < N * N; i++) {
        d[i * 4] = color[i * 3] * 255;
        d[i * 4 + 1] = color[i * 3 + 1] * 255;
        d[i * 4 + 2] = color[i * 3 + 2] * 255;
        d[i * 4 + 3] = 255;
      }
    }, true),
    normal: toTexture(N, (d) => {
      const s = (k * N) / 256;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const hx = height[y * N + ((x + 1) % N)] - height[y * N + ((x - 1 + N) % N)];
          const hy = height[((y + 1) % N) * N + x] - height[((y - 1 + N) % N) * N + x];
          let nx = -hx * s;
          let ny = hy * s;
          const len = Math.hypot(nx, ny, 1);
          nx /= len;
          ny /= len;
          const i = (y * N + x) * 4;
          d[i] = (nx * 0.5 + 0.5) * 255;
          d[i + 1] = (ny * 0.5 + 0.5) * 255;
          d[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
          d[i + 3] = 255;
        }
      }
    }, false),
    roughness: toTexture(N, (d) => {
      for (let i = 0; i < N * N; i++) {
        const v = clamp01(rough[i]) * 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    }, false),
  };
}

function setPx(r: Raw, i: number, c: [number, number, number], h: number, ro: number) {
  r.color[i * 3] = clamp01(c[0]);
  r.color[i * 3 + 1] = clamp01(c[1]);
  r.color[i * 3 + 2] = clamp01(c[2]);
  r.height[i] = h;
  r.rough[i] = ro;
}

// ---------- generators ----------

/** Floorboards / attic planks: rows of planks with staggered joints, wood grain, wear. */
function planks(N: number, seed: number, rows: number, base: string, opts: { grey?: number; wear?: number; nails?: boolean }) {
  const R = rnd0(seed);
  const r = raw(N, 2.5);
  const grain = fbm(R, 4, 4);
  const big = fbm(R, 2, 3);
  const joints: number[][] = [];
  const tints: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const a = R();
    joints.push([a, fract(a + 0.35 + R() * 0.3)]);
    tints.push([R(), R()]);
  }
  const [br, bg, bb] = hex(base);
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const row = Math.floor(v * rows);
    const inRow = v * rows - row;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const i = y * N + x;
      const [j0, j1] = joints[row];
      const seg = (u > Math.min(j0, j1) && u < Math.max(j0, j1)) ? 1 : 0;
      const dj = Math.min(Math.abs(u - j0), Math.abs(u - j1), 1 - Math.abs(u - j0), 1 - Math.abs(u - j1)) * N;
      const edge = Math.min(inRow, 1 - inRow) * (N / rows);
      const gap = edge < 1.2 || dj < 1.0;
      const t = tints[row][seg];
      const g = grain(u * 0.5 + row * 0.13, inRow * 0.25 + t);
      const lines = 0.5 + 0.5 * Math.sin((inRow * 9 + g * 7 + t * 5) * Math.PI);
      const wear = big(u, v) * (opts.wear ?? 0.5);
      const shade = 0.75 + t * 0.35 - lines * 0.18 + wear * 0.25;
      let c: [number, number, number] = [br * shade, bg * shade, bb * shade];
      if (opts.grey) {
        const l = (c[0] + c[1] + c[2]) / 3;
        c = [mix(c[0], l, opts.grey), mix(c[1], l, opts.grey), mix(c[2], l, opts.grey)];
      }
      let h = 0.6 + lines * 0.08 - Math.max(0, 1 - edge / 3) * 0.3;
      let ro = 0.62 + lines * 0.12 - wear * 0.2;
      if (gap) {
        c = [c[0] * 0.25, c[1] * 0.25, c[2] * 0.25];
        h = 0;
        ro = 0.95;
      }
      if (opts.nails && dj < 6 && Math.abs(inRow - 0.5) > 0.25 && Math.abs(inRow - 0.5) < 0.32 && dj > 3) {
        c = [0.08, 0.08, 0.09];
        h = 0.7;
        ro = 0.4;
      }
      setPx(r, i, c, h, ro);
    }
  }
  return finish(r);
}

const rnd0 = (seed: number) => rng(seed * 7919 + 13);

/** Victorian raised wooden panels for the lower part of the walls (1 tile = 1 m). */
function woodPanel(N: number) {
  const R = rnd0(3);
  const r = raw(N, 3);
  const grain = fbm(R, 4, 4);
  const [br, bg, bb] = hex('#3a1f12');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // two panels per tile side by side
      const pu = fract(u * 2);
      const frameU = Math.min(pu, 1 - pu);
      const frameV = Math.min(v, 1 - v);
      const inset = Math.min(frameU, frameV);
      let h: number;
      if (inset < 0.1) h = 0.6; // frame
      else if (inset < 0.13) h = 0.25; // groove
      else h = 0.6 + clamp01((inset - 0.13) / 0.08) * 0.35; // raised panel with bevel
      const horiz = frameV < 0.1 && frameU >= 0.1; // rails run sideways
      const g = horiz ? grain(u * 0.3, v * 4) : grain(u * 4, v * 0.3);
      const lines = 0.5 + 0.5 * Math.sin(((horiz ? v : u) * 60 + g * 8) * Math.PI);
      const shade = 0.8 + g * 0.4 - lines * 0.15 - (h < 0.3 ? 0.3 : 0);
      setPx(r, y * N + x, [br * shade, bg * shade, bb * shade], h, 0.45 + lines * 0.15);
    }
  }
  return finish(r);
}

/** Old damask wallpaper: an ornate repeating motif, faded, with damp stains. */
function wallpaper(N: number, seed: number, bgHex: string, fgHex: string, style: 'damask' | 'stripes') {
  const R = rnd0(seed);
  const r = raw(N, 1.2);
  const stains = fbm(R, 3, 4);
  const paper = tileNoise(64, R);
  // draw the motif with canvas shapes, then read it back as a mask
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const motif = (cx: number, cy: number, s: number) => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(side * s, s);
      ctx.beginPath(); // big leaf
      ctx.moveTo(0, -0.42);
      ctx.bezierCurveTo(0.22, -0.3, 0.3, -0.05, 0.12, 0.12);
      ctx.bezierCurveTo(0.05, 0.2, 0.02, 0.1, 0, 0.05);
      ctx.fill();
      ctx.beginPath(); // scroll
      ctx.lineWidth = 0.025;
      ctx.moveTo(0.04, 0.12);
      ctx.bezierCurveTo(0.35, 0.18, 0.38, 0.4, 0.2, 0.42);
      ctx.bezierCurveTo(0.1, 0.43, 0.1, 0.33, 0.18, 0.33);
      ctx.stroke();
      ctx.beginPath(); // small petals
      ctx.ellipse(0.16, -0.36, 0.05, 0.11, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0.28, 0.02, 0.04, 0.08, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); // centre stem + bud
    ctx.ellipse(cx, cy + 0.32 * s, 0.03 * s, 0.14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - 0.47 * s, 0.05 * s, 0, Math.PI * 2);
    ctx.fill();
  };
  if (style === 'damask') {
    // half-drop repeat, drawn with wrap-around so it tiles
    for (const [ox, oy] of [[0, 0], [N, 0], [0, N], [N, N], [-N, 0], [0, -N], [-N, -N], [N, -N], [-N, N]]) {
      motif(N / 2 + ox, N / 2 + oy, N * 0.55);
      motif(ox, oy, N * 0.42);
    }
  } else {
    for (let i = 0; i < 6; i++) ctx.fillRect((i * N) / 6, 0, N / 24, N);
    for (const [ox, oy] of [[0, 0], [N, 0], [0, N], [N, N]]) {
      ctx.beginPath();
      ctx.arc(N / 4 + ox, N / 4 + oy, N * 0.05, 0, Math.PI * 2);
      ctx.arc((3 * N) / 4 + ox, (3 * N) / 4 + oy, N * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const mask = ctx.getImageData(0, 0, N, N).data;
  const bg = hex(bgHex);
  const fg = hex(fgHex);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const v = y / N;
      const m = mask[i * 4] / 255;
      const stain = stains(u, v);
      const damp = clamp01((stain - 0.55) * 4); // brown water stains
      const p = paper(u * 4, v * 4) * 0.08;
      const stripe = 0.03 * Math.sin(u * Math.PI * 2 * 8);
      const col: [number, number, number] = [0, 1, 2].map((k) => {
        const base = mix(bg[k], fg[k], m) * (0.92 + p + stripe);
        const aged = mix(base, base * [0.75, 0.62, 0.42][k] + 0.03, damp * 0.7);
        return aged * (0.85 + stain * 0.25);
      }) as [number, number, number];
      setPx(r, i, col, m * 0.35 + p, 0.82 - m * 0.22 + damp * 0.1);
    }
  }
  return finish(r);
}

/** Long runner carpet: borders on both sides and a repeating pattern down the middle. */
function carpet(N: number) {
  const R = rnd0(11);
  const r = raw(N, 1.5);
  const fiber = tileNoise(128, R);
  const wear = fbm(R, 2, 3);
  const red = hex('#5e1414');
  const navy = hex('#14182a');
  const gold = hex('#8a6a2a');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const e = Math.min(u, 1 - u); // distance from the side edge
      let c: [number, number, number];
      if (e < 0.07) c = navy;
      else if (e < 0.1) c = gold;
      else if (e < 0.16) c = [0.35, 0.08, 0.07];
      else if (e < 0.18) c = gold;
      else {
        // diamond medallions
        const dv = Math.abs(fract(v * 2) - 0.5);
        const du = Math.abs(u - 0.5);
        const d = dv + du * 1.6;
        c = d < 0.12 ? gold : d < 0.2 ? navy : d < 0.23 ? gold : red;
        const flor = Math.abs(fract(v * 8) - 0.5) + Math.abs(fract(u * 6) - 0.5);
        if (d > 0.23 && flor < 0.12) c = [0.42, 0.12, 0.1];
      }
      const f = fiber(u * 2, v * 2);
      const w = clamp01((wear(u, v) - 0.45) * 2) * clamp01(1 - e * 2.5 + 0.6); // worn in the middle
      const s = (0.85 + f * 0.25) * (1 + w * 0.35);
      setPx(r, y * N + x, [c[0] * s + w * 0.04, c[1] * s + w * 0.03, c[2] * s + w * 0.02], f, 0.95);
    }
  }
  return finish(r);
}

/** Old plaster: blotchy off-white with cracks and damp marks. */
function plaster(N: number, tint: string) {
  const R = rnd0(21);
  const r = raw(N, 2);
  const n = fbm(R, 4, 5);
  const damp = fbm(R, 2, 3);
  const base = hex(tint);
  for (let i = 0; i < N * N; i++) {
    const u = (i % N) / N;
    const v = Math.floor(i / N) / N;
    const h = n(u, v);
    const d = clamp01((damp(u, v) - 0.58) * 5);
    const s = 0.8 + h * 0.35;
    setPx(r, i, [base[0] * s * (1 - d * 0.3), base[1] * s * (1 - d * 0.38), base[2] * s * (1 - d * 0.5)], h, 0.92);
  }
  // cracks: random walks (wrapping around the edges)
  for (let k = 0; k < 6; k++) {
    let x = R() * N;
    let y = R() * N;
    let a = R() * Math.PI * 2;
    for (let s = 0; s < N * 0.6; s++) {
      a += (R() - 0.5) * 0.8;
      x = (x + Math.cos(a) + N) % N;
      y = (y + Math.sin(a) + N) % N;
      const i = Math.floor(y) * N + Math.floor(x);
      r.color[i * 3] *= 0.45;
      r.color[i * 3 + 1] *= 0.45;
      r.color[i * 3 + 2] *= 0.45;
      r.height[i] -= 0.4;
    }
  }
  return finish(r);
}

/** Black & white checker tiles (kitchen floor). 1 tile = 2x2 squares. */
function tiles(N: number) {
  const R = rnd0(31);
  const r = raw(N, 3);
  const dirt = fbm(R, 4, 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const cu = fract(u * 2);
      const cv = fract(v * 2);
      const edge = Math.min(cu, 1 - cu, cv, 1 - cv) * (N / 2);
      const black = (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 1;
      const d = dirt(u, v);
      const base = black ? 0.07 : 0.62;
      let s = base * (0.85 + d * 0.3) - d * 0.05;
      let h = edge < 2 ? 0 : 0.6 + clamp01(edge / 4) * 0.1;
      let ro = 0.3 + d * 0.3;
      if (edge < 2) {
        s = 0.12 + d * 0.06; // grout
        ro = 0.9;
        h = 0;
      }
      setPx(r, y * N + x, [s * 1.02, s, s * 0.94], h, ro);
    }
  }
  return finish(r);
}

/** Generic dark polished wood (furniture, doors, stairs). */
function darkWood(N: number) {
  const R = rnd0(41);
  const r = raw(N, 1.5);
  const g = fbm(R, 4, 4);
  const [br, bg, bb] = hex('#3b2416');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const n = g(u * 0.5, v * 3);
      const lines = 0.5 + 0.5 * Math.sin((v * 30 + n * 10) * Math.PI);
      const s = 0.7 + n * 0.5 - lines * 0.2;
      setPx(r, y * N + x, [br * s, bg * s, bb * s], lines * 0.3 + n * 0.2, 0.42 + lines * 0.15);
    }
  }
  return finish(r);
}

/** Soft fabric (velvet / linen). */
function fabric(N: number, color: string, seed: number, weave = 1) {
  const R = rnd0(seed);
  const r = raw(N, 0.8);
  const n = fbm(R, 4, 4);
  const c = hex(color);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const m = n(u, v);
      const w = (Math.sin((x * Math.PI) / 1.5) * Math.sin((y * Math.PI) / 1.5)) * 0.5 * weave;
      const s = 0.8 + m * 0.4 + w * 0.05;
      setPx(r, y * N + x, [c[0] * s, c[1] * s, c[2] * s], m * 0.5 + w * 0.2, 0.92);
    }
  }
  return finish(r);
}

/** Sooty red brick (fireplaces). */
function brick(N: number) {
  const R = rnd0(51);
  const r = raw(N, 3);
  const n = fbm(R, 4, 4);
  const rows = 12;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const row = Math.floor(v * rows);
      const bu = fract(u * 4 + (row % 2) * 0.5);
      const bv = fract(v * rows);
      const mortar = bu < 0.04 || bv < 0.1;
      const t = n(u, v);
      const s = mortar ? 0.25 : 0.4 + t * 0.35;
      const soot = clamp01(1.2 - v * 1.6) * 0.6;
      setPx(r, y * N + x, [s * 0.75 * (1 - soot), s * 0.33 * (1 - soot), s * 0.25 * (1 - soot)], mortar ? 0 : 0.6 + t * 0.2, 0.9);
    }
  }
  return finish(r);
}

/** All procedural PBR materials, by generator name. N = texture size (pixels). */
export function generate(name: string, N: number): PBRMaps | null {
  switch (name) {
    case 'floorboards': return planks(N, 1, 8, '#5a3a22', { wear: 0.6 });
    case 'attic_planks': return planks(N, 2, 6, '#5d4c3c', { grey: 0.45, wear: 0.3, nails: true });
    case 'wood_panel': return woodPanel(N);
    case 'wallpaper_red': return wallpaper(N, 5, '#3e1013', '#5e2420', 'damask');
    case 'wallpaper_green': return wallpaper(N, 6, '#1a2b20', '#30473a', 'damask');
    case 'wallpaper_blue': return wallpaper(N, 7, '#1a2232', '#2f3e58', 'damask');
    case 'wallpaper_brown': return wallpaper(N, 8, '#33241a', '#4e3a28', 'damask');
    case 'wallpaper_nursery': return wallpaper(N, 9, '#5c4448', '#7a5c60', 'stripes');
    case 'carpet': return carpet(N);
    case 'plaster': return plaster(N, '#8d8473');
    case 'tiles': return tiles(N);
    case 'wood_dark': return darkWood(N);
    case 'fabric_red': return fabric(N, '#4a0f16', 61);
    case 'fabric_green': return fabric(N, '#1a3322', 62);
    case 'linen': return fabric(N, '#a49c8c', 63, 2);
    case 'brick': return brick(N);
    default: return null;
  }
}

// ---------- special textures ----------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** The flashlight "cookie": makes the beam uneven like a real torch (hot centre, rings, smudges). */
export function flashlightCookie(): THREE.Texture {
  const R = rng(99);
  return canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, '#f4f0e8');
    grad.addColorStop(0.3, '#dcd6cb');
    grad.addColorStop(0.42, '#d6d0c4');
    grad.addColorStop(0.55, '#9a948a');
    grad.addColorStop(0.68, '#5d5850');
    grad.addColorStop(0.8, '#2a2724');
    grad.addColorStop(1, '#000000');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // dark rings from the reflector
    g.strokeStyle = 'rgba(0,0,0,0.1)';
    g.filter = 'blur(3px)';
    for (const rad of [40, 63, 88]) {
      g.lineWidth = 4 + R() * 5;
      g.beginPath();
      g.arc(128 + R() * 4 - 2, 128 + R() * 4 - 2, rad, 0, Math.PI * 2);
      g.stroke();
    }
    g.filter = 'blur(6px)';
    // smudges on the lens
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.12})`;
      g.beginPath();
      g.ellipse(60 + R() * 136, 60 + R() * 136, 6 + R() * 22, 4 + R() * 12, R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; // the bulb's shadow in the very centre
    g.beginPath();
    g.arc(128, 128, 7, 0, Math.PI * 2);
    g.fill();
  });
}

/** Soft round glow (lamps, candles). */
export function glowTexture(): THREE.Texture {
  return canvasTex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Moonlight patch on the floor in the shape of a window (2x2 panes). */
export function windowPatchTexture(): THREE.Texture {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.filter = 'blur(4px)';
    g.fillStyle = '#fff';
    for (const [x, y] of [[14, 14], [68, 14], [14, 68], [68, 68]]) g.fillRect(x, y, 46, 46);
  });
}

/** Moonbeam through the air: bright at the window, fading away. */
export function shaftTexture(): THREE.Texture {
  return canvasTex(64, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 128);
    const side = g.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.2, 'rgba(0,0,0,0)');
    side.addColorStop(0.8, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, 64, 128);
  });
}

/** 8 old oil paintings in one texture (4 x 2 grid). */
export function paintingAtlas(W: number): THREE.Texture {
  const R = rng(7);
  const H = W / 2;
  const cw = W / 4;
  const ch = H / 2;
  return canvasTex(W, H, (g) => {
    const cell = (i: number, draw: () => void, bg: string) => {
      g.save();
      g.translate((i % 4) * cw, Math.floor(i / 4) * ch);
      g.beginPath();
      g.rect(0, 0, cw, ch);
      g.clip();
      g.fillStyle = bg;
      g.fillRect(0, 0, cw, ch);
      g.scale(cw / 100, ch / 100);
      draw();
      // varnish: dark edges + yellowing
      g.setTransform(1, 0, 0, 1, (i % 4) * cw, Math.floor(i / 4) * ch);
      const v = g.createRadialGradient(cw / 2, ch / 2, cw * 0.15, cw / 2, ch / 2, cw * 0.75);
      v.addColorStop(0, 'rgba(60,40,10,0.05)');
      v.addColorStop(1, 'rgba(10,5,0,0.75)');
      g.fillStyle = v;
      g.fillRect(0, 0, cw, ch);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; // crackle
      g.lineWidth = 0.6;
      for (let k = 0; k < 40; k++) {
        g.beginPath();
        const x = R() * cw;
        const y = R() * ch;
        g.moveTo(x, y);
        g.lineTo(x + (R() - 0.5) * 14, y + (R() - 0.5) * 14);
        g.stroke();
      }
      g.restore();
    };
    const portrait = (skin: string, coat: string, hair: string, eyes = 3, collar = false) => {
      g.fillStyle = coat;
      g.beginPath();
      g.ellipse(50, 105, 42, 38, 0, 0, Math.PI * 2);
      g.fill();
      if (collar) {
        g.fillStyle = '#d8d0c0';
        g.fillRect(42, 64, 16, 10);
      }
      g.fillStyle = skin;
      g.beginPath();
      g.ellipse(50, 45, 17, 22, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hair;
      g.beginPath();
      g.ellipse(50, 30, 19, 12, 0, Math.PI, Math.PI * 2);
      g.fill();
      g.fillStyle = '#100808';
      g.beginPath();
      g.ellipse(43, 45, eyes, eyes * 0.7, 0, 0, Math.PI * 2);
      g.ellipse(57, 45, eyes, eyes * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    };
    cell(0, () => portrait('#a08060', '#141010', '#2a1a10', 2.5, true), '#2a2016');
    cell(1, () => {
      portrait('#b49478', '#2a1420', '#3a2010', 2.5);
      g.fillStyle = '#3a2010';
      g.beginPath();
      g.ellipse(50, 20, 12, 10, 0, 0, Math.PI * 2); // hair bun
      g.fill();
    }, '#1e2420');
    cell(2, () => {
      g.fillStyle = '#c8c0a0';
      g.beginPath();
      g.arc(72, 25, 9, 0, Math.PI * 2); // moon
      g.fill();
      g.fillStyle = '#0c100c';
      g.beginPath();
      g.moveTo(0, 75);
      g.quadraticCurveTo(30, 55, 60, 70);
      g.quadraticCurveTo(80, 78, 100, 62);
      g.lineTo(100, 100);
      g.lineTo(0, 100);
      g.fill();
      g.strokeStyle = '#0c100c';
      g.lineWidth = 2;
      for (const tx of [22, 40, 84]) {
        g.beginPath();
        g.moveTo(tx, 75);
        g.lineTo(tx, 40);
        g.lineTo(tx - 8, 30);
        g.moveTo(tx, 50);
        g.lineTo(tx + 9, 38);
        g.stroke();
      }
    }, '#1f2a33');
    cell(3, () => portrait('#c8b49c', '#3a3040', '#6a4a30', 6), '#2a2228'); // child with big eyes
    cell(4, () => {
      g.fillStyle = '#1a2a30';
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.ellipse(R() * 100, 70 + R() * 30, 30, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#100c08';
      g.fillRect(40, 50, 25, 8); // ship
      g.fillRect(50, 25, 2, 26);
      g.beginPath();
      g.moveTo(52, 27);
      g.lineTo(66, 45);
      g.lineTo(52, 45);
      g.fill();
    }, '#28343a');
    cell(5, () => {
      g.fillStyle = '#0c0a0a';
      g.fillRect(20, 40, 60, 45); // the manor
      g.beginPath();
      g.moveTo(15, 42);
      g.lineTo(50, 18);
      g.lineTo(85, 42);
      g.fill();
      g.fillStyle = '#d8a040';
      g.fillRect(56, 55, 6, 8); // one lit window
    }, '#30302c');
    cell(6, () => {
      g.fillStyle = '#3a2a1a';
      g.beginPath();
      g.ellipse(50, 70, 16, 22, 0, 0, Math.PI * 2); // vase
      g.fill();
      g.strokeStyle = '#2a1e10';
      g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        g.moveTo(50, 50);
        g.quadraticCurveTo(30 + k * 7, 30, 25 + k * 8, 25 + R() * 20);
        g.stroke();
      }
    }, '#1c1610');
    cell(7, () => {
      g.fillStyle = '#d0ccc0';
      g.globalAlpha = 0.5;
      g.beginPath();
      g.ellipse(50, 60, 18, 40, 0, 0, Math.PI * 2); // veiled figure
      g.fill();
      g.globalAlpha = 1;
    }, '#121212');
  });
}
