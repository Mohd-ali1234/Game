// =====================================================================
// shared/game.ts
// Rules that BOTH the server and the browser use. Because both sides run
// the exact same movement + collision code, the player's own prediction
// matches the server's answer almost perfectly.
// =====================================================================

export const MAP_W = 1600;
export const MAP_H = 1200;

export const PLAYER_R = 14; // player collision radius (pixels)
export const SPEED = 170; // pixels per second at full stick
export const TICK_RATE = 20; // server updates per second
export const TICK_DT = 1 / TICK_RATE; // seconds per server update
export const MAX_PLAYERS = 6; // players per room
export const NUM_AVATARS = 8; // how many avatars exist (drawn in client/src/avatars.ts)

// A wall is a rectangle: [x, y, width, height]
export type Wall = [number, number, number, number];

export const WALLS: Wall[] = [
  // --- outer border ---
  [0, 0, MAP_W, 32],
  [0, MAP_H - 32, MAP_W, 32],
  [0, 0, 32, MAP_H],
  [MAP_W - 32, 0, 32, MAP_H],
  // --- inner walls (with gaps to walk through) ---
  [400, 32, 32, 360],
  [400, 560, 32, 400],
  [800, 200, 32, 500],
  [800, 860, 32, 308],
  [1200, 32, 32, 400],
  [1200, 600, 32, 568],
  [432, 600, 250, 32],
  [1000, 400, 200, 32],
  [900, 900, 300, 32],
  // --- pillars ---
  [600, 300, 64, 64],
  [1000, 700, 64, 64],
  [1380, 300, 64, 64],
];

// Where players appear when they join (the left room). One per slot.
export const SPAWNS: [number, number][] = [
  [120, 500],
  [200, 500],
  [280, 500],
  [120, 600],
  [200, 600],
  [280, 600],
];

/** True if a circle of PLAYER_R at (x, y) touches any wall. */
export function collides(x: number, y: number): boolean {
  for (const [wx, wy, ww, wh] of WALLS) {
    // nearest point on the rectangle to the circle centre
    const nx = Math.max(wx, Math.min(x, wx + ww));
    const ny = Math.max(wy, Math.min(y, wy + wh));
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy < PLAYER_R * PLAYER_R) return true;
  }
  return false;
}

/**
 * Move a player for `dt` seconds.
 * ix, iy = input direction as whole numbers from -100 to 100 (joystick/keys).
 * Returns the new [x, y]. X and Y are tried separately so you slide along walls.
 */
export function moveStep(x: number, y: number, ix: number, iy: number, dt: number): [number, number] {
  let vx = ix / 100;
  let vy = iy / 100;
  const len = Math.hypot(vx, vy);
  if (len > 1) {
    vx /= len;
    vy /= len;
  }
  const nx = x + vx * SPEED * dt;
  if (!collides(nx, y)) x = nx;
  const ny = y + vy * SPEED * dt;
  if (!collides(x, ny)) y = ny;
  return [x, y];
}
