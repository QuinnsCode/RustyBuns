// A room's layout from a theme and a seed: the shell, the furniture's spots and turns, the pictures on the
// walls, the lights. Pure, so the same seed always lays out the same room and it runs without Blender.
// Blender (bake.py) imports the models, drops the props onto the furniture and turns it all into splats.
import { mulberry32 } from "@rustybuns/util";
import type { Asset, Theme } from "./catalog.ts";

export interface Placed { id: string; asset: string; label: string; x: number; y: number; z: number; yaw: number; host: boolean }
/** A hole in a wall: `from`..`to` along it (the same "along" as onWall), `bottom`..`top` up it. */
export interface Opening { kind: "door" | "window"; wall: number; from: number; to: number; bottom: number; top: number }
export interface Recipe {
  theme: string;
  seed: number;
  room: { w: number; d: number; h: number; wall: [number, number, number]; floor: string; sky: string };
  furniture: Placed[];
  hangs: Placed[];
  /** lamps hung from the ceiling, one over each light */
  fixtures: Placed[];
  openings: Opening[];
  /** dropped onto a random host by Blender, which knows where the shelves and table tops really are */
  props: { id: string; asset: string; label: string }[];
  lights: [number, number, number][];
}

const WALL_GAP = 0.02;

/**
 * Walls run anticlockwise from the origin: 0 along y = 0, 1 along x = w, 2 along y = d, 3 along x = 0.
 * `yaw` turns a model whose front faces -y so its front faces into the room.
 */
function onWall(wall: number, along: number, depth: number, w: number, d: number): { x: number; y: number; yaw: number } {
  const off = depth / 2 + WALL_GAP;
  if (wall === 0) return { x: along, y: off, yaw: 180 };
  if (wall === 1) return { x: w - off, y: along, yaw: -90 };
  if (wall === 2) return { x: w - along, y: d - off, yaw: 0 };
  return { x: off, y: d - along, yaw: 90 };
}

export function recipe(theme: Theme, seed: number, themeId = theme.name.toLowerCase()): Recipe {
  const rand = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const shuffle = <T>(xs: T[]): T[] => xs.map((x) => ({ x, k: rand() })).sort((p, q) => p.k - q.k).map((p) => p.x);
  const r2 = (v: number) => Math.round(v * 100) / 100;

  const w = r2(4.6 + rand() * 1.6 + (theme.tables ?? 1) * 0.4 - 0.4), d = r2(3.9 + rand() * 1.2), h = 2.7;
  const of = (role: Asset["role"]) => theme.assets.filter((x) => x.role === role);
  const furniture: Placed[] = [];
  let n = 0;
  const boxes: number[][] = [];
  /** footprint as [x0, y0, x1, y1]; turns are quarter turns, so swapping width and depth is enough */
  const foot = (x: Asset, at: { x: number; y: number; yaw: number }, pad = 0) => {
    const side = Math.abs(at.yaw) % 180 === 90;
    const hw = (side ? x.size[1] : x.size[0]) / 2 + pad, hd = (side ? x.size[0] : x.size[1]) / 2 + pad;
    return [at.x - hw, at.y - hd, at.x + hw, at.y + hd];
  };
  const fits = (b: number[]) => b[0]! > 0 && b[1]! > 0 && b[2]! < w && b[3]! < d &&
    boxes.every((o) => b[2]! <= o[0]! || b[0]! >= o[2]! || b[3]! <= o[1]! || b[1]! >= o[3]!);
  const place = (x: Asset, at: { x: number; y: number; yaw: number }) => {
    boxes.push(foot(x, at));
    furniture.push({ id: `${++n}`, asset: x.id, label: x.label, x: r2(at.x), y: r2(at.y), z: 0, yaw: (at.yaw + (x.turn ?? 0)) % 360, host: !!x.host });
  };

  // Along the walls, left to right, each piece once. Ends stay clear so corners don't collide; one wall
  // keeps a gap in the middle for a door you'd walk in by.
  const pool = shuffle(of("wall")).sort((p, q) => Number(q.id === theme.first) - Number(p.id === theme.first));
  const door = Math.floor(rand() * 4);
  /** wall stretches pictures and windows keep off: tall furniture, the door, the windows */
  const tall: { wall: number; from: number; to: number; top: number }[] = [];
  const doorLen = door % 2 === 0 ? w : d;
  const openings: Opening[] = [{ kind: "door", wall: door, from: r2(doorLen / 2 - 0.45), to: r2(doorLen / 2 + 0.45), bottom: 0, top: 2.05 }];
  tall.push({ wall: door, from: doorLen / 2 - 0.45, to: doorLen / 2 + 0.45, top: 2.05 });
  const blocked = (wall: number, from: number, to: number, below = Infinity) =>
    tall.some((t) => t.wall === wall && t.top > below && to > t.from - 0.1 && from < t.to + 0.1);

  // Windows first, one or two on walls other than the door's; furniture taller than the sill steps around them.
  const SILL = 0.9, HEAD = 2.25;
  for (const wall of shuffle([0, 1, 2, 3].filter((x) => x !== door)).slice(0, rand() < 0.5 ? 1 : 2)) {
    const len = wall % 2 === 0 ? w : d;
    const width = r2(1 + rand() * 0.5);
    const from = r2(0.6 + rand() * (len - width - 1.2));
    openings.push({ kind: "window", wall, from, to: r2(from + width), bottom: SILL, top: HEAD });
    tall.push({ wall, from, to: from + width, top: HEAD });
  }
  for (let wall = 0; wall < 4 && pool.length; wall++) {
    const len = wall % 2 === 0 ? w : d;
    const margin = wall % 2 === 0 ? 0.25 : 0.8;
    let cursor = margin + rand() * 0.3;
    const doorFrom = len / 2 - 0.5, doorTo = len / 2 + 0.5;
    for (let tries = 0; tries < 10 && pool.length; tries++) {
      // too long for what's left of this wall: bring a piece that fits to the front, if there is one
      const fit = pool.findIndex((p) => cursor + p.size[0] <= len - margin);
      if (fit > 0) pool.unshift(...pool.splice(fit, 1));
      const x = pool[0]!;
      const [sw, sd, sh] = x.size;
      if (wall === door && cursor < doorTo && cursor + sw > doorFrom) { cursor = doorTo + 0.1; continue; }
      const win = openings.find((o) => o.kind === "window" && o.wall === wall && cursor < o.to + 0.1 && cursor + sw > o.from - 0.1);
      if (win && sh > SILL - 0.05) { cursor = win.to + 0.15; continue; }
      if (cursor + sw > len - margin) break;
      pool.shift();
      const at = onWall(wall, cursor + sw / 2, sd, w, d);
      if (!fits(foot(x, at))) { pool.push(x); cursor += 0.3; continue; }   // keep it for a later wall
      place(x, at);
      tall.push({ wall, from: cursor, to: cursor + sw, top: sh });
      cursor += sw + 0.15 + rand() * 0.5;
    }
  }

  // The middle: a table (or a row of them), seats facing each from two or three sides.
  const centre = of("centre");
  const tables = theme.tables ?? 1;
  for (let k = 0; k < tables && centre.length; k++) {
    const t = pick(centre);
    let at = { x: 0, y: 0, yaw: 0 }, ok = false;
    for (let tries = 0; tries < 6 && !ok; tries++) {
      at = { x: (w * (k + 1)) / (tables + 1) + (rand() - 0.5) * 0.4, y: d / 2 + (rand() - 0.5) * 0.3, yaw: rand() < 0.5 ? 0 : 90 };
      ok = fits(foot(t, at, 0.3));
    }
    if (!ok) continue;
    place(t, at);
    const { x: cx, y: cy } = at;
    const seats = of("seat");
    if (!seats.length) continue;
    const reach = Math.max(t.size[0], t.size[1]) / 2;
    const angles = shuffle([0, 90, 180, 270]).slice(0, seats.length > 1 ? 3 : 2);
    for (const ang of angles) {
      const s = pick(seats);
      const r = reach + s.size[1] / 2 + 0.25;
      const rad = (ang * Math.PI) / 180;
      // front faces -y; turn it so it faces back toward the table
      const at = { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r, yaw: ang - 90 };
      if (fits(foot(s, at, 0.1))) place(s, at);
    }
  }

  // Pictures at eye height, on wall stretches nothing tall stands in front of.
  const hangs: Placed[] = [];
  for (const x of shuffle(of("hang"))) {
    for (let tries = 0; tries < 12; tries++) {
      const wall = Math.floor(rand() * 4);
      const len = wall % 2 === 0 ? w : d;
      const along = 0.6 + rand() * (len - 1.2);
      const half = x.size[0] / 2 + 0.15;
      if (blocked(wall, along - half, along + half, 1.1)) continue;
      if (hangs.some((p) => p.label !== x.label && Math.hypot(p.x - onWall(wall, along, 0, w, d).x, p.y - onWall(wall, along, 0, w, d).y) < 1)) continue;
      const at = onWall(wall, along, x.size[1], w, d);
      hangs.push({ id: `${++n}`, asset: x.id, label: x.label, x: r2(at.x), y: r2(at.y), z: r2(1.55 - x.size[2] / 2), yaw: at.yaw, host: false });
      break;
    }
  }

  // Small things: every prop once in shuffled order, then repeats, so labels stay rare enough to hunt.
  const props: Recipe["props"] = [];
  const kinds = shuffle(of("prop"));
  for (let i = 0; i < theme.props && kinds.length; i++) {
    const x = kinds[i % kinds.length]!;
    props.push({ id: `${++n}`, asset: x.id, label: x.label });
  }

  // Lights: one per table in a row, or one or two along the room; a lamp hangs over each, its light just under it.
  const placedTables = furniture.filter((f) => of("centre").some((c) => c.id === f.asset)).map((f) => [f.x, f.y]);
  const spots = tables > 1 && placedTables.length ? placedTables
    : w > 5.2 ? [[w / 3, d / 2], [(2 * w) / 3, d / 2]] : [[w / 2, d / 2]];
  const fixtures: Placed[] = [];
  const lamp = of("ceiling");
  const lights: [number, number, number][] = spots.map(([x, y]) => {
    const f = lamp.length ? pick(lamp) : null;
    const z = f ? r2(h - f.size[2]) : h;
    if (f) fixtures.push({ id: `${++n}`, asset: f.id, label: f.label, x: r2(x!), y: r2(y!), z, yaw: 0, host: false });
    return [r2(x!), r2(y!), r2(z - 0.06)];
  });

  return { theme: themeId, seed, room: { w, d, h, wall: theme.wall, floor: theme.floor, sky: theme.sky }, furniture, hangs, fixtures, openings, props, lights };
}

/** structure.json in InteriorGS's shape: the outline, and each wall as a centre line with thickness. */
export function structure(r: Recipe) {
  const { w, d, h } = r.room;
  const t = 0.12;
  const seg = (a: number[], b: number[]) => ({ thickness: t * 2, height: h, location: [a, b] });
  return {
    rooms: [{ profile: [[0, 0], [w, 0], [w, d], [0, d]], room_type: r.theme }],
    holes: r.openings.map((o) => hole(o, w, d, t)),
    walls: [seg([0, -t], [w, -t]), seg([w + t, 0], [w + t, d]), seg([w, d + t], [0, d + t]), seg([-t, d], [-t, 0])],
  };
}

/** An opening as InteriorGS writes one: its four corners on the wall's centre line, top edge first. */
function hole(o: Opening, w: number, d: number, t: number) {
  const at = (along: number) => {
    const p = onWall(o.wall, along, 0, w, d);
    const out = [[0, -t], [t, 0], [0, t], [-t, 0]][o.wall]!;
    return [p.x + out[0]!, p.y + out[1]!];
  };
  const [a, b] = [at(o.to), at(o.from)];
  return { thickness: t * 2, type: o.kind.toUpperCase(), profile: [[...a!, o.top], [...b!, o.top], [...b!, o.bottom], [...a!, o.bottom]] };
}

/** occupancy.json: the room's extent on InteriorGS's 5 cm grid. */
export function occupancy(r: Recipe) {
  const { w, d } = r.room;
  return { scale: 0.05, center: [w / 2, d / 2, 0], upper: [w, d, 1], lower: [0, 0, 0.1], min: [0, 0, 0.1], max: [w, d, 1] };
}
