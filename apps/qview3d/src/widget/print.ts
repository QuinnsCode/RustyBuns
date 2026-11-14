// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The print canvas: the hat's colour, a faint weave, and the shopper's picture drawn where they put it. It covers
// the print mesh's whole UV square, so moving a picture is a redraw of one canvas, never new geometry.
import type { Zone } from "./hats.ts";

/**
 * Where one picture sits: its centre in the zone (0..1 across, 0..1 up), its width as a share of the zone, its turn.
 * On a shop's own model, `point` and `normal` (in the model's space) say where instead, and u, v go unused.
 */
export type Placement = { u: number; v: number; scale: number; rotation: number; point?: number[]; normal?: number[] };

/** The print mesh's measures a placement needs to keep the picture square on the fabric. */
export type Surface = { zone: Zone; radiusAt: (v: number) => number; profileLength: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const clampPlacement = (p: Placement): Placement => ({
  ...p,
  u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1), scale: clamp(p.scale, 0.05, 1), rotation: clamp(p.rotation, -Math.PI, Math.PI),
});

/** A mesh UV as a spot in the zone (0..1 each way inside it, outside beyond). */
export const zoneSpot = (z: Zone, uv: { x: number; y: number }) => ({ u: (uv.x - z.u0) / (z.u1 - z.u0), v: (uv.y - z.v0) / (z.v1 - z.v0) });

/** The picture's size on the fabric, in world units: `scale` of the zone's width, its height by the picture's aspect. */
export function pictureSize(s: Surface, p: Placement, aspect: number) {
  const vc = s.zone.v0 + p.v * (s.zone.v1 - s.zone.v0);
  const zoneWidth = (s.zone.u1 - s.zone.u0) * Math.PI * 2 * s.radiusAt(vc);
  const w = zoneWidth * p.scale;
  return { w, h: w / aspect, vc, r: s.radiusAt(vc) };
}

/** Whether a spot in the zone lands on the picture (with a little give for fingers). */
export function onPicture(s: Surface, p: Placement, aspect: number, spot: { u: number; v: number }, give = 0.08): boolean {
  const { w, h, r } = pictureSize(s, p, aspect);
  const dx = (spot.u - p.u) * (s.zone.u1 - s.zone.u0) * Math.PI * 2 * r;
  const dy = (spot.v - p.v) * (s.zone.v1 - s.zone.v0) * s.profileLength;
  const c = Math.cos(-p.rotation), sn = Math.sin(-p.rotation);
  const x = dx * c - dy * sn, y = dx * sn + dy * c;
  return Math.abs(x) <= w / 2 + give && Math.abs(y) <= h / 2 + give;
}

let weave: HTMLCanvasElement | OffscreenCanvas | null = null;
/** A small tile of soft cross-hatching, multiplied over the colour so plain fabric doesn't read as plastic. */
function weaveTile() {
  if (weave) return weave;
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(32, 32) : Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#fff"; g.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 32; i += 2) {
    g.fillStyle = `rgba(0,0,0,${0.035 + ((i * 7) % 5) * 0.006})`;
    g.fillRect(i, 0, 1, 32);
    g.fillStyle = "rgba(0,0,0,0.03)";
    g.fillRect(0, i, 32, 1);
  }
  return (weave = c);
}

export type Picture = { image: CanvasImageSource; aspect: number; at: Placement };

/** Draw the whole print canvas: colour, weave, each picture clipped to the zone, and the zone's outline while editing. */
export function paint(ctx: CanvasRenderingContext2D, s: Surface, color: string, pictures: Picture[], outline: boolean) {
  const { width: W, height: H } = ctx.canvas;
  const z = s.zone;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = ctx.createPattern(weaveTile(), "repeat")!;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // Canvas y runs down while v runs up (the texture is flipped on upload).
  const zx = z.u0 * W, zy = (1 - z.v1) * H, zw = (z.u1 - z.u0) * W, zh = (z.v1 - z.v0) * H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(zx, zy, zw, zh);
  ctx.clip();
  for (const pic of pictures) {
    const { w, h, vc, r } = pictureSize(s, pic.at, pic.aspect);
    const pxU = W / (Math.PI * 2 * r), pxV = H / s.profileLength; // pixels per world unit, round and up
    const cx = (z.u0 + pic.at.u * (z.u1 - z.u0)) * W, cy = (1 - vc) * H;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxU, pxV);
    ctx.rotate(-pic.at.rotation);
    ctx.drawImage(pic.image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
  if (outline) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(2, W / 600);
    ctx.setLineDash([W / 120, W / 160]);
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineDashOffset = W / 120;
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.restore();
  }
}
