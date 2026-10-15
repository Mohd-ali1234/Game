// =====================================================================
// client/src/avatars.ts
// Avatars are drawn with simple canvas shapes (no image files needed).
// The same drawing is used for the lobby buttons and the in-game sprites.
// =====================================================================

export interface AvatarDef {
  name: string;
  color: string;
  hat: 'party' | 'tophat' | 'cowboy' | 'crown' | 'propeller' | 'bunny' | 'bow' | 'viking';
}

// Keep NUM_AVATARS in shared/game.ts equal to this list's length.
export const AVATARS: AvatarDef[] = [
  { name: 'Party Red', color: '#d94a4a', hat: 'party' },
  { name: 'Top Hat Blue', color: '#4a7bd9', hat: 'tophat' },
  { name: 'Cowboy Green', color: '#4ab36b', hat: 'cowboy' },
  { name: 'King Yellow', color: '#e0c040', hat: 'crown' },
  { name: 'Propeller Purple', color: '#9a5ad9', hat: 'propeller' },
  { name: 'Bunny Orange', color: '#e8883a', hat: 'bunny' },
  { name: 'Bow Pink', color: '#e870b0', hat: 'bow' },
  { name: 'Viking Teal', color: '#3ab8b0', hat: 'viking' },
];

export const AVATAR_SIZE = 56; // canvas size; body is centred at (28, 32)

function poly(ctx: CanvasRenderingContext2D, pts: number[][], fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw avatar number `i` onto a 56x56 canvas context. */
export function drawAvatar(ctx: CanvasRenderingContext2D, i: number) {
  const def = AVATARS[i % AVATARS.length];
  const cx = 28;
  const cy = 32;
  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

  // body (radius 14 = the collision radius)
  ellipse(ctx, cx, cy, 14, 14, def.color);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.stroke();

  // eyes
  ellipse(ctx, cx - 5, cy + 1, 3.2, 3.6, '#fff');
  ellipse(ctx, cx + 5, cy + 1, 3.2, 3.6, '#fff');
  ellipse(ctx, cx - 5, cy + 2, 1.5, 1.8, '#111');
  ellipse(ctx, cx + 5, cy + 2, 1.5, 1.8, '#111');

  // the funny hat / accessory
  switch (def.hat) {
    case 'party':
      poly(ctx, [[cx - 8, cy - 6], [cx + 8, cy - 6], [cx, cy - 26]], '#ffe14d');
      poly(ctx, [[cx - 5, cy - 13], [cx + 5, cy - 13], [cx + 3, cy - 18], [cx - 3, cy - 18]], '#ff4d8d');
      ellipse(ctx, cx, cy - 26, 3, 3, '#fff');
      break;
    case 'tophat':
      ellipse(ctx, cx, cy - 9, 14, 4, '#1a1a1a');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 8, cy - 26, 16, 17);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 8, cy - 14, 16, 4);
      break;
    case 'cowboy':
      ellipse(ctx, cx, cy - 9, 17, 5.5, '#8b5a2b');
      ctx.fillStyle = '#a0692f';
      ctx.fillRect(cx - 7, cy - 22, 14, 13);
      ctx.fillStyle = '#5c3a17';
      ctx.fillRect(cx - 7, cy - 13, 14, 3);
      break;
    case 'crown':
      poly(ctx, [[cx - 9, cy - 8], [cx - 9, cy - 22], [cx - 4, cy - 15], [cx, cy - 24], [cx + 4, cy - 15], [cx + 9, cy - 22], [cx + 9, cy - 8]], '#ffd33d');
      ellipse(ctx, cx, cy - 12, 2, 2, '#e53935');
      break;
    case 'propeller':
      ctx.fillStyle = '#2f80ed';
      ctx.beginPath();
      ctx.arc(cx, cy - 8, 9, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 1.5, cy - 22, 3, 6);
      ellipse(ctx, cx - 8, cy - 22, 8, 2.5, '#f1c40f');
      ellipse(ctx, cx + 8, cy - 22, 8, 2.5, '#e74c3c');
      break;
    case 'bunny':
      ellipse(ctx, cx - 6, cy - 20, 3.8, 10, def.color);
      ellipse(ctx, cx + 6, cy - 20, 3.8, 10, def.color);
      ellipse(ctx, cx - 6, cy - 20, 1.8, 7, '#ffb6c1');
      ellipse(ctx, cx + 6, cy - 20, 1.8, 7, '#ffb6c1');
      break;
    case 'bow':
      poly(ctx, [[cx, cy - 12], [cx - 12, cy - 20], [cx - 12, cy - 6]], '#ff2d75');
      poly(ctx, [[cx, cy - 12], [cx + 12, cy - 20], [cx + 12, cy - 6]], '#ff2d75');
      ellipse(ctx, cx, cy - 12, 3.5, 3.5, '#ffd1e0');
      break;
    case 'viking':
      ctx.fillStyle = '#9aa0a6';
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 11, Math.PI, 0);
      ctx.fill();
      poly(ctx, [[cx - 10, cy - 8], [cx - 20, cy - 24], [cx - 6, cy - 14]], '#f5f0dc');
      poly(ctx, [[cx + 10, cy - 8], [cx + 20, cy - 24], [cx + 6, cy - 14]], '#f5f0dc');
      break;
  }
}

/** Make a ready-to-use canvas with avatar `i` drawn on it. */
export function avatarCanvas(i: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = AVATAR_SIZE;
  c.height = AVATAR_SIZE;
  drawAvatar(c.getContext('2d')!, i);
  return c;
}
