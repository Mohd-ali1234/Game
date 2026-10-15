// =====================================================================
// client/src/assets.ts
// Finds and downloads the files YOU upload to GitHub:
//   client/public/textures/  (.jpg/.png -> turned into small .ktx2 by the build)
//   client/public/models/    (.glb, or a Poly Haven glTF .zip -> turned into a small .glb)
//   client/public/sounds/    (.ogg/.mp3/.wav)
// The build writes asset-manifest.json listing every file, so the game knows
// exactly what exists (no guessing, no failed downloads). Anything missing
// falls back to things generated in code, so the game never breaks.
// =====================================================================
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface AssetFile {
  url: string;
  bytes: number;
  lo?: { url: string; bytes: number }; // smaller version (Low quality)
}
interface Manifest {
  textures: Record<string, AssetFile>;
  models: Record<string, AssetFile>;
  sounds: Record<string, AssetFile>;
}

/** "Wood_Floor_Worn_diff_1k.jpg" -> "wood_floor_worn_diff" (same rule as scripts/build-assets.mjs) */
export function assetKey(fileName: string): string {
  return fileName
    .replace(/\.(gltf\.zip|zip|glb|gltf|ktx2|jpe?g|png|webp|ogg|mp3|wav)$/i, '')
    .replace(/[_-]\d+k(-(jpg|png))?/gi, '')
    .toLowerCase();
}

/** Counts progress for the loading bar. */
export class Progress {
  private total = 0;
  private done = 0;
  constructor(private onChange: (fraction: number, label: string) => void) {}
  add(weight: number) {
    this.total += weight;
  }
  finish(weight: number, label = '') {
    this.done += weight;
    this.onChange(this.total ? Math.min(1, this.done / this.total) : 1, label);
  }
}

export class Assets {
  private manifest: Manifest = { textures: {}, models: {}, sounds: {} };
  private ktx2: KTX2Loader;
  private gltf: GLTFLoader;
  private tex = new THREE.TextureLoader();
  private modelCache = new Map<string, Promise<THREE.Object3D | null>>();
  private soundCache = new Map<string, Promise<AudioBuffer | null>>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.ktx2 = new KTX2Loader().setTranscoderPath('/libs/basis/').detectSupport(renderer);
    const draco = new DRACOLoader().setDecoderPath('/libs/draco/');
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  }

  /** Read the list of uploaded files (written by the build). */
  async loadManifest() {
    try {
      const res = await fetch('/asset-manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = { textures: {}, models: {}, sounds: {}, ...(await res.json()) };
    } catch {
      /* no manifest (e.g. local dev): everything uses the built-in fallbacks */
    }
  }

  /** The first of `keys` that exists in the uploads, or undefined. */
  find(kind: keyof Manifest, keys: string[]): string | undefined {
    return keys.map((k) => k.toLowerCase()).find((k) => this.manifest[kind][k]);
  }

  size(kind: keyof Manifest, key: string, lo = false): number {
    const f = this.manifest[kind][key];
    return f ? (lo && f.lo ? f.lo.bytes : f.bytes) : 0;
  }

  async texture(key: string, srgb: boolean, lo: boolean): Promise<THREE.Texture | null> {
    const f = this.manifest.textures[key];
    if (!f) return null;
    const url = '/' + (lo && f.lo ? f.lo.url : f.url);
    try {
      const t = url.endsWith('.ktx2') ? await this.ktx2.loadAsync(url) : await this.tex.loadAsync(url);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    } catch (e) {
      console.warn(`texture ${url} failed: ${e}`);
      return null;
    }
  }

  /** A .glb model (one shared copy; clone it before use). */
  model(key: string): Promise<THREE.Object3D | null> {
    let p = this.modelCache.get(key);
    if (!p) {
      const f = this.manifest.models[key];
      p = f
        ? this.gltf.loadAsync('/' + f.url).then((g) => g.scene).catch((e) => {
            console.warn(`model ${f.url} failed: ${e}`);
            return null;
          })
        : Promise.resolve(null);
      this.modelCache.set(key, p);
    }
    return p;
  }

  sound(key: string, ac: AudioContext): Promise<AudioBuffer | null> {
    let p = this.soundCache.get(key);
    if (!p) {
      const f = this.manifest.sounds[key];
      p = f
        ? fetch('/' + f.url).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b)).catch((e) => {
            console.warn(`sound ${f.url} failed: ${e}`);
            return null;
          })
        : Promise.resolve(null);
      this.soundCache.set(key, p);
    }
    return p;
  }

  hasSound(key: string) {
    return !!this.manifest.sounds[key];
  }

  dispose() {
    this.ktx2.dispose();
  }
}

/** Everything this page has downloaded so far (JS, physics, textures, models...) in bytes. */
export function totalDownloaded(): number {
  let sum = 0;
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    sum += e.transferSize || e.encodedBodySize || 0;
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) sum += nav.transferSize || nav.encodedBodySize || 0;
  return sum;
}

export const formatMB = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MB';
