// =====================================================================
// shared/props.ts
// Every kind of furniture/decoration the map file can use, with its size.
// The size is used for:
//   - collisions (if `solid`) on the server AND in the browser
//   - drawing the placeholder shape
//   - auto-scaling an uploaded .glb model to the right size
// Size = [width (x), height (y), depth (z)] in meters. The front faces +Z.
// =====================================================================

export interface PropLight {
  color: string; // e.g. '#ffb066'
  intensity: number; // how bright the baked glow is
  range: number; // meters
  y: number; // height of the light above the prop's base
  out?: number; // how far in front of the prop (wall lamps)
  moon?: boolean; // cold moonlight shining INTO the room (windows)
}

export interface PropInfo {
  size: [number, number, number];
  solid?: boolean; // blocks players
  wall?: boolean; // hangs on a wall (needs "wall" + "at" in the map file)
  hanging?: boolean; // hangs from the ceiling (chandeliers)
  top?: number; // height of its top surface (for "with": things placed on top)
  light?: PropLight; // gives off light (baked = very cheap)
  sound?: 'clock' | 'wind'; // plays a sound from here
}

export const PROPS: Record<string, PropInfo> = {
  // ---- tables & things on them ----
  side_table: { size: [0.6, 0.75, 0.6], solid: true, top: 0.75 },
  vase_flowers: { size: [0.3, 0.65, 0.3] },
  reading_table: { size: [1.4, 0.78, 0.8], solid: true, top: 0.78 },
  dining_table: { size: [3.6, 0.78, 1.2], solid: true, top: 0.78 },
  kitchen_table: { size: [1.6, 0.8, 0.9], solid: true, top: 0.8 },
  sideboard: { size: [2.0, 1.0, 0.55], solid: true, top: 1.0 },
  candelabra: { size: [0.35, 0.55, 0.35], light: { color: '#ffa94d', intensity: 1.1, range: 4.5, y: 0.5 } },
  desk_lamp: { size: [0.3, 0.5, 0.3], light: { color: '#ffb35c', intensity: 0.9, range: 4, y: 0.4 } },
  // ---- seating ----
  chair: { size: [0.5, 1.05, 0.5], solid: true },
  armchair: { size: [0.85, 1.05, 0.85], solid: true },
  rocking_chair: { size: [0.65, 1.1, 0.95], solid: true },
  // ---- big furniture ----
  grandfather_clock: { size: [0.6, 2.2, 0.45], solid: true, sound: 'clock' },
  bookshelf: { size: [1.8, 2.4, 0.45], solid: true },
  wardrobe: { size: [1.4, 2.2, 0.65], solid: true },
  dresser: { size: [1.3, 1.9, 0.5], solid: true },
  bed: { size: [1.7, 2.2, 2.2], solid: true },
  small_bed: { size: [1.0, 0.9, 1.9], solid: true },
  crib: { size: [1.3, 1.1, 0.75], solid: true },
  stove: { size: [1.4, 1.1, 0.8], solid: true },
  counter: { size: [2.0, 0.92, 0.65], solid: true, top: 0.92 },
  shelf_jars: { size: [1.2, 1.8, 0.35], solid: true },
  // ---- small things / clutter ----
  rocking_horse: { size: [0.95, 0.85, 0.35], solid: true },
  toy_blocks: { size: [0.6, 0.25, 0.5] },
  crate: { size: [0.8, 0.8, 0.8], solid: true },
  trunk: { size: [1.0, 0.6, 0.55], solid: true },
  mannequin: { size: [0.5, 1.75, 0.4], solid: true },
  sheet_furniture: { size: [1.3, 1.1, 0.9], solid: true },
  // ---- on walls ----
  painting: { size: [0.8, 1.0, 0.06], wall: true },
  wall_lamp: { size: [0.25, 0.45, 0.22], wall: true, light: { color: '#ffaa5e', intensity: 1.3, range: 5, y: 0.1, out: 0.35 } },
  window: { size: [1.1, 2.0, 0.12], wall: true, sound: 'wind', light: { color: '#7d93c4', intensity: 0.9, range: 7, y: 0, out: 0.6, moon: true } },
  fireplace: { size: [1.9, 1.5, 0.6], wall: true, solid: true },
  // ---- ceiling ----
  chandelier: { size: [1.2, 1.1, 1.2], hanging: true },
  // ---- floor coverings (size comes from "w" and "l" in the map file) ----
  rug: { size: [1, 0.01, 1] },
};
