// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The print canvas: the product's colour, a faint weave, and the shopper's pictures drawn where they put them. It
// covers the print meshes' whole UV square, so moving a picture is a redraw of one canvas, never new geometry. A
// product has one or more print zones (a hat's front; a top's front, back and sleeve), each a rect of that square.
import type { ZoneName } from "../api.ts";

/** Where a picture may go on the print meshes, in their UVs. */
export type Zone = { u0: number; u1: number; v0: number; v1: number };

/** The side the camera swings to for a zone. */
export type Side = "front" | "angle" | "side" | "back";

/**
 * One named print zone and its size on the fabric: `width(v)` is the zone's width in world units at height v
 * (0..1 up the zone), `height` its height, so a picture placed in UV space stays square on the cloth.
 */
export type PrintZone = Zone & { name: ZoneName; label: string; view: Side; width: (v: number) => number; height: number };

/**
 * Where one picture sits: its zone (the first one when unnamed), its centre in the zone (0..1 across, 0..1 up), its
 * width as a share of the zone, its turn. On a shop's own model, `point` and `normal` (in the model's space) say where
 * instead, and u, v go unused.
 */
export type Placement = { zone?: ZoneName; u: number; v: number; scale: number; rotation: number; point?: number[]; normal?: number[] };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const clampPlacement = (p: Placement): Placement => ({
  ...p,
  u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1), scale: clamp(p.scale, 0.05, 1), rotation: clamp(p.rotation, -Math.PI, Math.PI),
});

/** The zone a placement is in: the named one, else the first. */
export const zoneOf = (zones: readonly PrintZone[], p: Placement) => zones.find((z) => z.name === p.zone) ?? zones[0]!;

/** A mesh UV as a spot in the zone (0..1 each way inside it, outside beyond). */
export const zoneSpot = (z: Zone, uv: { x: number; y: number }) => ({ u: (uv.x - z.u0) / (z.u1 - z.u0), v: (uv.y - z.v0) / (z.v1 - z.v0) });

/** The zone a mesh UV falls in, if any. */
export const zoneAt = (zones: readonly PrintZone[], uv: { x: number; y: number }) =>
  zones.find((z) => uv.x >= z.u0 && uv.x <= z.u1 && uv.y >= z.v0 && uv.y <= z.v1) ?? null;

/** The picture's size on the fabric, in world units: `scale` of the zone's width, its height by the picture's aspect. */
export function pictureSize(z: PrintZone, p: Placement, aspect: number) {
  const w = z.width(p.v) * p.scale;
  return { w, h: w / aspect };
}

/** Whether a spot in the zone lands on the picture (with a little give for fingers). */
export function onPicture(z: PrintZone, p: Placement, aspect: number, spot: { u: number; v: number }, give = 0.08): boolean {
  const { w, h } = pictureSize(z, p, aspect);
  const dx = (spot.u - p.u) * z.width(p.v);
  const dy = (spot.v - p.v) * z.height;
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

/** Draw the whole print canvas: colour, weave, each picture clipped to its zone, and `outline`'s zone while editing. */
export function paint(ctx: CanvasRenderingContext2D, zones: readonly PrintZone[], color: string, pictures: Picture[], outline: ZoneName | null) {
  const { width: W, height: H } = ctx.canvas;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = ctx.createPattern(weaveTile(), "repeat")!;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // Canvas y runs down while v runs up (the texture is flipped on upload).
  const rect = (z: Zone) => [z.u0 * W, (1 - z.v1) * H, (z.u1 - z.u0) * W, (z.v1 - z.v0) * H] as const;
  for (const pic of pictures) {
    const z = zoneOf(zones, pic.at);
    const [zx, zy, zw, zh] = rect(z);
    const { w, h } = pictureSize(z, pic.at, pic.aspect);
    const pxU = zw / z.width(pic.at.v), pxV = zh / z.height; // pixels per world unit, across and up
    ctx.save();
    ctx.beginPath();
    ctx.rect(zx, zy, zw, zh);
    ctx.clip();
    ctx.translate(zx + pic.at.u * zw, zy + (1 - pic.at.v) * zh);
    ctx.scale(pxU, pxV);
    ctx.rotate(-pic.at.rotation);
    ctx.drawImage(pic.image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  const z = outline === null ? null : zones.find((x) => x.name === outline) ?? zones[0];
  if (z) {
    const [zx, zy, zw, zh] = rect(z);
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
