// =====================================================================
// client/src/models.ts
// The .glb model registry. Every prop (shared/props.ts), the ghost and the
// avatars use a simple placeholder shape UNTIL a model file for it exists in
// client/public/models/. Upload one at a time through GitHub - nothing else
// to change. A model is found by any of the names listed below
// (case doesn't matter, "_1k"/"_2k" endings are ignored), e.g.
//    side_table.glb   or the Poly Haven download   side_table_01_1k.gltf.zip
// The build turns Poly Haven glTF .zip files into small compressed .glb files.
//
// Models are scaled AUTOMATICALLY to the prop's size, and placed on the floor.
// If one still looks wrong, add a tweak in MODEL_TWEAKS.
// =====================================================================
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from './assets';

/** Which file names count as a model for each prop type (first match wins). */
export const MODEL_NAMES: Record<string, string[]> = {
  side_table: ['side_table', 'side_table_01', 'round_wooden_table_01'],
  vase_flowers: ['vase_flowers', 'dead_flowers', 'antique_ceramic_vase_01', 'brass_vase_01'],
  grandfather_clock: ['grandfather_clock', 'vintage_grandfather_clock_01'],
  bookshelf: ['bookshelf', 'bookshelf_01', 'wooden_bookshelf'],
  armchair: ['armchair', 'armchair_01', 'ottoman_01'],
  chair: ['chair', 'wooden_chair_01', 'gothicchair_01', 'chair_01'],
  rocking_chair: ['rocking_chair', 'rockingchair_01'],
  bed: ['bed', 'gothicbed_01'],
  small_bed: ['small_bed'],
  wardrobe: ['wardrobe', 'gothiccabinet_01', 'vintage_cabinet_01'],
  dresser: ['dresser', 'gothiccommode_01'],
  sideboard: ['sideboard', 'classicconsole_01'],
  dining_table: ['dining_table', 'wooden_table_02'],
  reading_table: ['reading_table', 'wooden_table_01'],
  kitchen_table: ['kitchen_table'],
  candelabra: ['candelabra', 'candle_holder_01'],
  desk_lamp: ['desk_lamp'],
  chandelier: ['chandelier', 'chandelier_01', 'chandelier_02'],
  crate: ['crate', 'wooden_crate_01', 'wooden_crate_02'],
  trunk: ['trunk', 'wooden_trunk', 'treasure_chest'],
  mannequin: ['mannequin'],
  crib: ['crib'],
  rocking_horse: ['rocking_horse'],
  stove: ['stove', 'cast_iron_stove'],
  counter: ['counter'],
  shelf_jars: ['shelf_jars'],
  toy_blocks: ['toy_blocks'],
  sheet_furniture: ['sheet_furniture'],
  fireplace: ['fireplace'],
  painting: ['painting', 'fancy_picture_frame_01', 'fancy_picture_frame_02'],
  wall_lamp: ['wall_lamp'],
  window: [], // windows stay as built shapes (they glow with moonlight)
  rug: [], // rugs use the carpet texture instead
  ghost: ['ghost'],
};

/** Optional per-model fixes (rotation in degrees, scale multiplier, raise/lower in meters). */
export const MODEL_TWEAKS: Record<string, { rotY?: number; scale?: number; y?: number }> = {
  // example: gothicbed_01: { rotY: 180 },
};

/** The uploaded model key for this prop type, if there is one. */
export function modelKeyFor(assets: Assets, type: string): string | undefined {
  const names = MODEL_NAMES[type] ?? [type];
  return names.length ? assets.find('models', names) : undefined;
}

/**
 * A fresh copy of `src`, scaled to fit `size` [w, h, d] (height matters most),
 * centred, standing on y = 0, facing +Z.
 */
export function fitModel(src: THREE.Object3D, size: [number, number, number], key = ''): THREE.Object3D {
  const copy = cloneSkinned(src);
  const tweak = MODEL_TWEAKS[key] ?? {};
  copy.rotation.y = ((tweak.rotY ?? 0) * Math.PI) / 180;
  copy.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(copy);
  const dim = bb.getSize(new THREE.Vector3());
  let s = size[1] / Math.max(dim.y, 1e-3); // match the height...
  if (dim.x * s > size[0] * 1.5 || dim.z * s > size[2] * 1.5) s = Math.min(size[0] / dim.x, size[2] / Math.max(dim.z, 1e-3)) * 1.2; // ...unless way too wide
  s *= tweak.scale ?? 1;
  copy.scale.setScalar(s);
  const center = bb.getCenter(new THREE.Vector3());
  copy.position.set(-center.x * s, -bb.min.y * s + (tweak.y ?? 0), -center.z * s);
  const holder = new THREE.Group();
  holder.add(copy);
  copy.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return holder;
}

/** Avatar models: upload avatar_0.glb ... avatar_7.glb (or set names here). */
export function avatarModelKey(assets: Assets, i: number): string | undefined {
  return assets.find('models', [`avatar_${i}`]);
}
