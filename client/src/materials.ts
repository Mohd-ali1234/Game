// =====================================================================
// client/src/materials.ts
// Every surface material in the mansion, in ONE list.
//
// To use a real CC0 texture (Poly Haven / ambientCG):
//   upload its maps to client/public/textures/ (see the README for which ones).
//   The game finds them by name automatically. A material looks for files
//   named after its own key OR any name in its `files` list, e.g. for
//   floorboards:  floorboards_diff.jpg  floorboards_nor_gl.jpg  floorboards_rough.jpg
//   or the Poly Haven originals:  wood_floor_worn_diff_1k.jpg  ...nor_gl_1k.jpg  ...rough_1k.jpg
// Until then, textures are generated in code (procedural.ts).
// =====================================================================
import * as THREE from 'three';
import { Assets, Progress } from './assets';
import { generate, paintingAtlas } from './procedural';

export type Quality = 'low' | 'medium' | 'high';

export interface MatDef {
  tile?: number; // meters per texture repeat. Omit for parts with their own UVs (rugs, paintings)
  gen?: string; // procedural fallback (procedural.ts)
  files?: string[]; // extra texture names to look for (Poly Haven / ambientCG asset names)
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  normalScale?: number;
}

export const MATERIALS: Record<string, MatDef> = {
  // ---- big surfaces (walls, floors, ceilings) ----
  floorboards: { tile: 2.0, gen: 'floorboards', files: ['wood_floor_worn', 'old_wood_floor', 'wood_floor'] },
  attic_planks: { tile: 2.0, gen: 'attic_planks', files: ['wood_planks_grey', 'brown_planks_03', 'weathered_planks'] },
  wood_panel: { tile: 1.0, gen: 'wood_panel', files: ['wood_panel', 'dark_wood_panel'] },
  wallpaper_red: { tile: 0.6, gen: 'wallpaper_red' },
  wallpaper_green: { tile: 0.6, gen: 'wallpaper_green' },
  wallpaper_blue: { tile: 0.6, gen: 'wallpaper_blue' },
  wallpaper_brown: { tile: 0.6, gen: 'wallpaper_brown' },
  wallpaper_nursery: { tile: 0.6, gen: 'wallpaper_nursery' },
  plaster: { tile: 2.0, gen: 'plaster', files: ['painted_plaster_wall', 'beige_wall_001', 'plaster_grey_04'] },
  tiles: { tile: 0.6, gen: 'tiles', files: ['floor_tiles_06', 'checkered_tiles'] },
  carpet: { gen: 'carpet', files: ['fabric_pattern_05', 'carpet'] },
  brick: { tile: 1.0, gen: 'brick', files: ['red_brick_03', 'old_bricks'] },
  // ---- furniture ----
  wood_dark: { tile: 1.0, gen: 'wood_dark', files: ['dark_wood', 'wood_table_001'] },
  fabric_red: { tile: 0.5, gen: 'fabric_red', files: ['velvet_red'] },
  fabric_green: { tile: 0.5, gen: 'fabric_green', files: ['velvet_green'] },
  linen: { tile: 0.5, gen: 'linen', files: ['fabric_linen'] },
  // ---- plain materials (no textures) ----
  brass: { color: '#6b4c22', roughness: 0.42, metalness: 0.85 },
  iron: { color: '#1b1b1d', roughness: 0.6, metalness: 0.6 },
  ceramic: { color: '#a8a090', roughness: 0.3 },
  painted: { color: '#a59d8f', roughness: 0.7 },
  book: { color: '#ffffff', roughness: 0.8 },
  flowers_dead: { color: '#3a2c1e', roughness: 1 },
  wax: { color: '#cfc5ae', roughness: 0.6 },
  leather: { color: '#2e1a10', roughness: 0.65 },
  mirror: { color: '#8890a0', roughness: 0.12, metalness: 1 },
  black: { color: '#050505', roughness: 1 },
  canvas: { roughness: 0.65 },
  lamp_glass: { color: '#ffcf8a', roughness: 0.4, emissive: '#ffb45a', emissiveIntensity: 2.6 },
  moon_glass: { color: '#1a2434', roughness: 0.1, emissive: '#6f88bf', emissiveIntensity: 0.45 },
  flame: { color: '#ffd38a', emissive: '#ffb347', emissiveIntensity: 6 },
};

/**
 * "Baked" light: each corner of the static world stores how much lamp/moon light
 * reaches it (computed once while loading, see mansion.ts). This shader patch
 * adds that light, so only the flashlights cost real lighting each frame.
 */
function addBakedLight(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 baked;\nvarying vec3 vBaked;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBaked = baked;');
    sh.fragmentShader = 'varying vec3 vBaked;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vBaked * diffuseColor.rgb;');
  };
  m.customProgramCacheKey = () => 'baked';
}

const MAP_SUFFIX = {
  color: ['_diff', '_color', '_basecolor', '_albedo', '_col'],
  normal: ['_nor_gl', '_normalgl', '_normal', '_nor', '_nrm'],
  roughness: ['_rough', '_roughness', '_arm'], // Poly Haven "arm" packs roughness in green, which is what three.js reads
};

/** Texture size (pixels) for generated textures at each quality. */
export const GEN_SIZE: Record<Quality, number> = { low: 256, medium: 512, high: 1024 };

/** Build all materials: uploaded textures first, generated ones as fallback. */
export async function buildMaterials(assets: Assets, quality: Quality, progress: Progress, maxAniso: number): Promise<Record<string, THREE.Material>> {
  const out: Record<string, THREE.Material> = {};
  const lo = quality === 'low';
  const N = GEN_SIZE[quality];
  const aniso = quality === 'high' ? Math.min(8, maxAniso) : quality === 'medium' ? Math.min(4, maxAniso) : 1;
  const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0)); // lets the loading bar redraw

  // plan the work first so the loading bar knows the total
  const plans = Object.entries(MATERIALS).map(([key, def]) => {
    const names = [key, ...(def.files ?? [])];
    const pick = (suffixes: string[]) => assets.find('textures', names.flatMap((n) => suffixes.map((s) => n + s)));
    const files = def.gen ? { color: pick(MAP_SUFFIX.color), normal: pick(MAP_SUFFIX.normal), roughness: pick(MAP_SUFFIX.roughness) } : null;
    const uploaded = !!files?.color;
    const weight = uploaded
      ? Object.values(files!).reduce((s, k) => s + (k ? assets.size('textures', k, lo) : 0), 0)
      : def.gen ? N * N * 0.6 : 1000;
    progress.add(weight);
    return { key, def, files, uploaded, weight };
  });

  for (const { key, def, files, uploaded, weight } of plans) {
    const m = new THREE.MeshStandardMaterial({
      color: def.color ?? '#ffffff',
      roughness: def.roughness ?? 1,
      metalness: def.metalness ?? 0,
      vertexColors: true,
    });
    if (def.emissive) {
      m.emissive.set(def.emissive);
      m.emissiveIntensity = def.emissiveIntensity ?? 1;
    }
    let maps: { color: THREE.Texture | null; normal: THREE.Texture | null; roughness: THREE.Texture | null } | null = null;
    if (uploaded && files) {
      const [color, normal, roughness] = await Promise.all([
        assets.texture(files.color!, true, lo),
        files.normal ? assets.texture(files.normal, false, lo) : Promise.resolve(null),
        files.roughness ? assets.texture(files.roughness, false, lo) : Promise.resolve(null),
      ]);
      if (color) maps = { color, normal, roughness };
    }
    if (!maps && def.gen) {
      maps = generate(def.gen, N);
      await yieldToBrowser();
    }
    if (key === 'canvas') m.map = paintingAtlas(quality === 'high' ? 1024 : 512);
    if (maps) {
      m.map = maps.color;
      m.normalMap = maps.normal;
      m.roughnessMap = maps.roughness;
      m.roughness = maps.roughness ? 1 : 0.8;
      if (def.normalScale) m.normalScale.setScalar(def.normalScale);
      const rep = def.tile ? 1 / def.tile : 1;
      for (const t of [maps.color, maps.normal, maps.roughness]) {
        if (!t) continue;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rep, rep);
        t.anisotropy = aniso;
        t.needsUpdate = true;
      }
    }
    addBakedLight(m);
    out[key] = m;
    progress.finish(weight, `material ${key}`);
  }
  return out;
}
