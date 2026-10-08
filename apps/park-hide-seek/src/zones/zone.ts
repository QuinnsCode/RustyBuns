// A drop zone in game units. The terrain is the real ground shrunk SCALE times
// in every direction (El Capitan stays a sheer wall, just shorter); people,
// trees and tents stay life-size, which is what makes the park feel big but playable.
//
// Coordinates: x east, y north (metres in game), h = height above the zone's lowest point.

import { hashString, rng } from "../geo.ts";
import type { Landmark } from "../parks/types.ts";
import type { ZoneData } from "./types.ts";
import halfDome from "./data/half-dome.json";
import elCapitan from "./data/el-capitan.json";
import yosemiteFalls from "./data/yosemite-falls.json";
import glacierPoint from "./data/glacier-point.json";
import mariposaGrove from "./data/mariposa-grove.json";

export const ZONES: ZoneData[] = [halfDome, elCapitan, yosemiteFalls, glacierPoint, mariposaGrove] as ZoneData[];

export const SCALE = 6;

export type PropKind = "pine" | "sequoia" | "bush" | "boulder" | "tent" | "log" | "cabin" | "outhouse" | "table" | "sign";

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /** Collision radius (0: you can walk into it, like a bush). */
  r: number;
  /** How tall it is; things taller than an eye line block sight. */
  tall: number;
  rot: number;
  size: number;
  /** For signposts. */
  label?: string;
}

/** Above this rise per metre the ground is a cliff: nobody walks up it. */
export const CLIFF = 1.25;

export class Zone {
  readonly data: ZoneData;
  readonly n: number;
  /** Game radius of the playable circle. */
  readonly R: number;
  /** Game metres between height samples. */
  readonly step: number;
  readonly h: Float32Array;
  readonly lowest: number;
  readonly props: Prop[] = [];
  readonly landmarks: (Landmark & { gx: number; gy: number })[];
  readonly station: { x: number; y: number; yaw: number };
  /** 1 where you can walk to from the ranger cabin and back (the largest region not cut off by cliffs). */
  readonly reach: Uint8Array;
  private buckets = new Map<number, Prop[]>();
  private static BUCKET = 8;

  constructor(data: ZoneData) {
    this.data = data;
    this.n = data.n;
    this.R = data.realRadius / SCALE;
    this.step = (2 * this.R) / (this.n - 1);
    const raw = new Int16Array(Uint8Array.from(atob(data.heights), (c) => c.charCodeAt(0)).buffer);
    let lo = Infinity;
    for (const v of raw) lo = Math.min(lo, v);
    this.lowest = lo;
    this.h = Float32Array.from(raw, (v) => (v - lo) / SCALE);
    this.landmarks = data.landmarks.map((m) => ({ ...m, gx: m.x / SCALE, gy: m.y / SCALE }));
    this.reach = this.largestRegion();
    this.station = this.findStation();
    this.populate();
  }

  /** Ground height, bilinear between samples; clamps outside the grid. */
  height(x: number, y: number): number {
    const n = this.n;
    const fx = Math.max(0, Math.min(n - 1.001, (x + this.R) / this.step));
    const fy = Math.max(0, Math.min(n - 1.001, (y + this.R) / this.step));
    const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r;
    const i = r * n + c, h = this.h;
    return h[i] * (1 - tx) * (1 - ty) + h[i + 1] * tx * (1 - ty) + h[i + n] * (1 - tx) * ty + h[i + n + 1] * tx * ty;
  }

  /** Steepness as rise per metre. */
  slope(x: number, y: number): number {
    const e = this.step;
    return Math.hypot(this.height(x + e, y) - this.height(x - e, y), this.height(x, y + e) - this.height(x, y - e)) / (2 * e);
  }

  inside(x: number, y: number, margin = 0): boolean { return x * x + y * y <= (this.R - margin) ** 2; }

  /** On the main walkable ground (not a ledge cut off by cliffs). */
  reachable(x: number, y: number): boolean {
    const c = Math.round((x + this.R) / this.step), r = Math.round((y + this.R) / this.step);
    return c >= 0 && r >= 0 && c < this.n && r < this.n && this.reach[r * this.n + c] === 1;
  }

  /** Flood fill over sample points joined by slopes gentle enough to walk both ways. */
  private largestRegion(): Uint8Array {
    const n = this.n, lab = new Int32Array(n * n).fill(-1);
    const ok = (i: number) => this.inside(-this.R + (i % n) * this.step, -this.R + Math.floor(i / n) * this.step, 1);
    let best = -1, bestSize = 0, id = 0;
    for (let s = 0; s < n * n; s++) {
      if (lab[s] >= 0 || !ok(s)) continue;
      let size = 0;
      const st = [s];
      lab[s] = id;
      while (st.length) {
        const i = st.pop()!, c = i % n, r = (i / n) | 0;
        size++;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
          const j = rr * n + cc;
          if (lab[j] >= 0 || !ok(j) || Math.abs(this.h[j] - this.h[i]) / this.step >= CLIFF) continue;
          lab[j] = id;
          st.push(j);
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    return Uint8Array.from(lab, (l) => (l === best ? 1 : 0));
  }

  /** Props near (x, y), from a coarse spatial hash. */
  near(x: number, y: number, reach: number): Prop[] {
    const B = Zone.BUCKET, out: Prop[] = [];
    const c0 = Math.floor((x - reach) / B), c1 = Math.floor((x + reach) / B);
    const r0 = Math.floor((y - reach) / B), r1 = Math.floor((y + reach) / B);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const b = this.buckets.get(r * 4096 + c);
      if (b) out.push(...b);
    }
    return out;
  }

  /** The bush you're standing in, if any. */
  bushAt(x: number, y: number): Prop | null {
    for (const p of this.near(x, y, 3)) if (p.kind === "bush" && Math.hypot(p.x - x, p.y - y) < p.size * 1.1) return p;
    return null;
  }

  private add(p: Prop) {
    this.props.push(p);
    const B = Zone.BUCKET, key = Math.floor(p.y / B) * 4096 + Math.floor(p.x / B);
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = []));
    b.push(p);
  }

  private free(x: number, y: number, r: number): boolean {
    if (!this.inside(x, y, r + 2)) return false;
    for (const p of this.near(x, y, r + 6)) if (Math.hypot(p.x - x, p.y - y) < r + Math.max(p.r, p.kind === "bush" ? p.size : 0) + 0.6) return false;
    return true;
  }

  /**
   * The ranger cabin: flat ground near the edge, at about the zone's typical
   * height. A cabin on the valley floor under a rim a kilometre up would leave
   * rangers climbing for the whole hunt.
   */
  private findStation() {
    const hs: number[] = [];
    for (let i = 0; i < this.reach.length; i++) if (this.reach[i]) hs.push(this.h[i]);
    hs.sort((a, b) => a - b);
    const median = hs[Math.floor(hs.length / 2)] ?? 0;
    const relief = (hs[hs.length - 1] ?? 1) - (hs[0] ?? 0) || 1;
    let best = { x: 0, y: -this.R * 0.8, yaw: 0, s: Infinity };
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, d = this.R * 0.8;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (!this.reachable(x, y)) continue;
      let s = 0;
      for (const [dx, dy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) s += this.slope(x + dx, y + dy);
      s += (Math.abs(this.height(x, y) - median) / relief) * 4;
      if (s < best.s) best = { x, y, yaw: Math.atan2(-y, -x), s };
    }
    return { x: best.x, y: best.y, yaw: best.yaw };
  }

  /** Scatter the props. Seeded by the zone, so every player gets the same park. */
  private populate() {
    const r = rng(hashString(this.data.id));
    const R = this.R, st = this.station;
    this.add({ kind: "cabin", x: st.x, y: st.y, r: 4.2, tall: 5, rot: st.yaw, size: 1 });
    // A little campground near the cabin: tents, tables, an outhouse.
    const camp = { x: st.x * 0.55, y: st.y * 0.55 };
    for (let k = 0, placed = 0; k < 200 && placed < 9; k++) {
      const a = r() * Math.PI * 2, d = 6 + r() * 18;
      const x = camp.x + Math.cos(a) * d, y = camp.y + Math.sin(a) * d;
      if (this.slope(x, y) > 0.25 || !this.free(x, y, 2)) continue;
      const kind: PropKind = placed === 0 ? "outhouse" : placed % 3 === 0 ? "table" : "tent";
      this.add({ kind, x, y, r: kind === "tent" ? 1.4 : kind === "outhouse" ? 0.9 : 1.1, tall: kind === "table" ? 0.8 : 2.2, rot: r() * Math.PI * 2, size: 1 });
      placed++;
    }
    // Signposts at the named places.
    for (const m of this.landmarks) {
      if (!this.inside(m.gx, m.gy, 2) || this.slope(m.gx, m.gy) > CLIFF) continue;
      this.add({ kind: "sign", x: m.gx, y: m.gy, r: 0.2, tall: 2, rot: r() * Math.PI, size: 1, label: m.name });
    }
    // Trees, bushes, boulders and logs, thinning out on steep rock.
    const sequoia = this.data.trees === "sequoia";
    const target = { tree: sequoia ? 160 : 520, bush: 320, boulder: 140, log: 50 };
    const tries = (kind: keyof typeof target, place: (x: number, y: number, s: number) => boolean) => {
      for (let k = 0, n = 0; k < target[kind] * 12 && n < target[kind]; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
        if (place(Math.cos(a) * d, Math.sin(a) * d, this.slope(Math.cos(a) * d, Math.sin(a) * d))) n++;
      }
    };
    // Forest grows in patches: a low-frequency mask from a few random clumps.
    const clumps = Array.from({ length: 14 }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R; return [Math.cos(a) * d, Math.sin(a) * d, 25 + r() * 45] as const; });
    const forest = (x: number, y: number) => clumps.reduce((m, [cx, cy, cr]) => Math.max(m, 1 - Math.hypot(x - cx, y - cy) / cr), 0);
    tries("tree", (x, y, s) => {
      if (s > 0.9 || r() > 0.15 + forest(x, y) * 0.85) return false;
      const big = sequoia && r() < 0.55;
      const kind: PropKind = big ? "sequoia" : "pine";
      const size = big ? 0.8 + r() * 0.6 : 0.7 + r() * 0.6;
      const rad = big ? 1.6 * size : 0.35 * size;
      if (!this.free(x, y, rad + 1)) return false;
      this.add({ kind, x, y, r: rad, tall: big ? 40 * size : 14 * size, rot: r() * Math.PI * 2, size });
      return true;
    });
    tries("bush", (x, y, s) => {
      if (s > 0.7) return false;
      const size = 1.1 + r() * 0.7;
      if (!this.free(x, y, size)) return false;
      this.add({ kind: "bush", x, y, r: 0, tall: 1.3 * size, rot: r() * Math.PI * 2, size });
      return true;
    });
    tries("boulder", (x, y, s) => {
      if (s > CLIFF) return false;
      const size = 0.6 + r() ** 2 * 2.6;
      if (!this.free(x, y, size)) return false;
      this.add({ kind: "boulder", x, y, r: size * 0.9, tall: size * 1.4, rot: r() * Math.PI * 2, size });
      return true;
    });
    tries("log", (x, y, s) => {
      if (s > 0.4 || !this.free(x, y, 2.5)) return false;
      this.add({ kind: "log", x, y, r: 0.6, tall: 0.7, rot: r() * Math.PI, size: 0.8 + r() * 0.6 });
      return true;
    });
  }
}

const cache = new Map<string, Zone>();
export function zoneById(id: string): Zone {
  let z = cache.get(id);
  if (!z) {
    const data = ZONES.find((d) => d.id === id) ?? ZONES[0];
    z = new Zone(data);
    cache.set(data.id, z);
  }
  return z;
}
