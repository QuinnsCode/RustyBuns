// The places of src/world/poi.ts drawn on the open ground, and on the corner map. Each kind is one instanced mesh
// (a handful of draw calls for every place in the world), and only those near you are laid out each frame.
// A tape is a stump with a tape on it; a fire is logs, and a flame once lit; a landmark is a tall mast and cap; a sighting
// board hangs in a town, a gas station, a diner and a motel in a row (town-view.ts), whose door walks you in (towns.ts); a cabin is log walls under a pitched roof, one mesh; and the next sign of a contract you took is a pale wisp over the spot (hunts.ts).
// worldView (view.ts) owns the camera, the toast and the map; this asks it for none of them, it is handed what it needs.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { esc } from "@rustybuns/util";
import { icon } from "../icons.ts";
import { ownerAt } from "./world.ts";
import { ALL, arrive, marked, POIS, SEE_R, type Log, type Poi } from "./poi.ts";
import { huntsIn, nextClues, track, type Hunt } from "./hunts.ts";
import { townFronts } from "./town-view.ts";
import { yawOf } from "./towns.ts";

export interface PlaceHooks {
  /** What the journey remembers, or null while there is none. */
  log(): Log | null;
  /** Walked up to a tape (`first` the first time), a fire or a cabin, or read a sighting board inside its town. A line comes back for the toast. */
  reach(p: Poi, first: boolean): string | void;
  /** A landmark came on screen for the first time. */
  sight(p: Poi): void;
  /** Travelled to a lit fire (the big map, an agent): you stand at it without walking up. A line comes back for the toast. */
  travelled?(p: Poi): string | void;
  /** Read the next sign of a contract (already marked in the journey: save it). `last`: its creature now waits at the lair. */
  sign?(h: Hunt, sign: string, last: boolean): void;
}

/** The places a view draws: `all` of them, those `near` where you stand (walked up to, landmarks seen), and the
 *  region whose contracts' signs show there. The continent's by default; a pack's island has its own (view.ts). */
export interface PlaceSet { all: readonly Poi[]; near(me: { x: number; z: number }): readonly Poi[]; region(me: { x: number; z: number }): number }
const CONTINENT: PlaceSet = { all: ALL, near: (me) => POIS.get(ownerAt(me.x, me.z)) ?? [], region: (me) => ownerAt(me.x, me.z) };

const DRAW_R = 1800; // metres: places farther than this aren't laid out
const WISP = 0xe8f4ff;
const LOGS = 0x9a6a44, FLAME = 0xff9a2e, EMBER = 0x4a3a30, STUMP = 0x6b4a2b, TAPE = 0xf2e27a, MAST = 0xc9c2b4, CAP = 0xd0442e;
/** `door`: walked up to a town's front door (a sighting board's place); the world walks you in. */
export function poiView(group: THREE.Group, camera: THREE.Camera, groundY: (x: number, z: number) => number, hooks: PlaceHooks | undefined, door?: (p: Poi) => void, set = CONTINENT) {
  const cap = set.all.length || 1;
  const mesh = (g: THREE.BufferGeometry, color: number, basic = false) => {
    const m = new THREE.InstancedMesh(g, basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }), cap);
    m.count = 0; m.frustumCulled = false; group.add(m);
    return m;
  };
  const stumps = mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.9, 8), STUMP), tapes = mesh(new THREE.BoxGeometry(1, 0.18, 0.62), TAPE, true);
  const logs = mesh(new THREE.BoxGeometry(1.8, 0.28, 0.32), EMBER), flames = mesh(new THREE.ConeGeometry(0.6, 1.6, 7), FLAME, true);
  const masts = mesh(new THREE.CylinderGeometry(0.6, 1.2, 26, 8), MAST), caps = mesh(new THREE.ConeGeometry(2.4, 3.4, 8), CAP);
  // A town's fronts: each look one instanced mesh, laid once per town round its door.
  const fronts = townFronts().map((f) => {
    const m = new THREE.InstancedMesh(f.geo, f.mat ?? (f.basic ? new THREE.MeshBasicMaterial({ color: f.color }) : new THREE.MeshLambertMaterial({ color: f.color })), cap);
    m.count = 0; m.frustumCulled = false; group.add(m);
    return m;
  });
  const wisps = mesh(new THREE.OctahedronGeometry(0.7), WISP, true);
  // A cabin: 5 by 4 m of walls, 2.6 m high, and a four-sided roof over them, merged so it is one draw call for them all.
  const roof = new THREE.ConeGeometry(4.2, 2.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.82).translate(0, 3.7, 0);
  const cabins = mesh(mergeGeometries([new THREE.BoxGeometry(5, 2.6, 4).translate(0, 1.3, 0), roof]) ?? new THREE.BoxGeometry(5, 2.6, 4), LOGS);
  const all = [stumps, tapes, logs, flames, masts, caps, wisps, cabins, ...fronts];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3(), sc = new THREE.Vector3();
  const put = (im: THREE.InstancedMesh, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1) => {
    q.setFromAxisAngle(up, yaw);
    im.setMatrixAt(im.count++, m4.compose(at.set(x, y, z), q, sc.set(sx, sy, sx)));
  };
  const reached = new Set<string>();
  let clock = 0;
  const log = () => hooks?.log() ?? null;

  return {
    /** One frame: lays out the places near `me` (in `open` regions), and returns toasts for what you reached or saw. */
    update(dt: number, me: { x: number; z: number }, open: ReadonlySet<number>, still = false): string[] {
      clock += dt;
      const j = log(), out: string[] = [];
      for (const im of all) im.count = 0;
      for (const p of set.all) {
        if (!open.has(p.n) || Math.hypot(p.x - me.x, p.z - me.z) > DRAW_R) continue;
        const y = Math.max(0, groundY(p.x, p.z)), yaw = yawOf(p.id), on = marked(j, p);
        if (p.kind === "tape") { put(stumps, p.x, y + 0.45, p.z, yaw); if (!on) put(tapes, p.x, y + 1.0 + Math.sin(clock * 2 + yaw) * 0.08, p.z, yaw + clock * 0.6); }
        else if (p.kind === "fire") {
          put(logs, p.x, y + 0.2, p.z, yaw); put(logs, p.x, y + 0.2, p.z, yaw + 1.9);
          if (on) put(flames, p.x, y + 1.0, p.z, 0, 1 + Math.sin(clock * 9 + yaw) * 0.12, 0.9 + Math.sin(clock * 7 + yaw * 2) * 0.25);
        } else if (p.kind === "board") { for (const f of fronts) put(f, p.x, y - 0.15, p.z, yaw); }
        else if (p.kind === "cabin") put(cabins, p.x, y, p.z, yaw);
        else { put(masts, p.x, y + 13, p.z, yaw); put(caps, p.x, y + 27.7, p.z, yaw); }
      }
      // The next sign of each contract you took here: a wisp bobbing over the spot, seen from a way off.
      for (const c of nextClues(j, set.region(me))) {
        const y = Math.max(0, groundY(c.at.x, c.at.z)), s = 1 + Math.sin(clock * 3 + c.i) * 0.15;
        put(wisps, c.at.x, y + 2.2 + Math.sin(clock * 1.7 + c.i) * 0.3, c.at.z, clock * 0.8, s, s * 1.6);
      }
      for (const im of all) im.instanceMatrix.needsUpdate = true;
      if (!j || still) return out;
      // Walking up to a tape or a fire.
      for (const p of arrive(me, reached, set.near(me))) {
        if (p.kind === "board" && door) { door(p); continue; }
        const first = !marked(j, p), line = hooks?.reach(p, first);
        if (line) out.push(`${icon(p.kind === "tape" ? "clapperboard" : p.kind === "cabin" ? "house" : "flame")}${esc(line)}`);
      }
      // Standing at a contract's next sign.
      for (const t of track(j, me, set.region(me))) {
        hooks?.sign?.(t.hunt, t.sign, t.last);
        out.push(`${icon("footprints")}${esc(t.sign)}.${t.last ? ` ${esc(t.hunt.title)} is close.` : ""}`);
      }
      // A landmark on screen, near enough to read, is found.
      for (const p of set.near(me)) {
        if (p.kind !== "landmark" || marked(j, p) || Math.hypot(p.x - me.x, p.z - me.z) > SEE_R) continue;
        // In front of the camera and inside the screen, with a margin.
        const v = at.set(p.x, groundY(p.x, p.z) + 14, p.z).applyMatrix4(camera.matrixWorldInverse), ahead = v.z < 0;
        v.applyMatrix4(camera.projectionMatrix);
        if (ahead && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95) { hooks?.sight(p); out.push(`${icon("binoculars")}Found ${esc(p.name)}`); }
      }
      return out;
    },
    /** Stand at a fire already: it doesn't rest you again until you have walked away. */
    stand(p: Poi) { reached.add(p.id); },
    /** Marks the places on the map: `px` metres to pixels, `explored(x, z)` whether that ground is on the map. Landmarks show only once seen. */
    marks(ctx: CanvasRenderingContext2D, px: number, open: ReadonlySet<number>, explored: (x: number, z: number) => boolean) {
      const j = log();
      for (const p of ALL) {
        const on = marked(j, p);
        if (!open.has(p.n) || !(on || (p.kind !== "landmark" && explored(p.x, p.z)))) continue;
        const x = p.x * px, y = p.z * px, r = on ? 3.4 : 1.8;
        ctx.globalAlpha = on ? 1 : 0.55; ctx.fillStyle = p.kind === "fire" ? "#ff9a2e" : p.kind === "tape" ? "#f2e27a" : p.kind === "board" ? "#c89b5e" : p.kind === "cabin" ? "#b07a4e" : "#ffffff"; ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = 0.8;
        ctx.beginPath();
        if (p.kind === "fire") ctx.arc(x, y, r, 0, Math.PI * 2);
        else if (p.kind === "tape") ctx.rect(x - r, y - r, r * 2, r * 2);
        else if (p.kind === "cabin") { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r, y - 0.5); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y - 0.5); ctx.closePath(); }
        else if (p.kind === "board") { ctx.moveTo(x, y - r - 0.8); ctx.lineTo(x + r + 0.8, y); ctx.lineTo(x, y + r + 0.8); ctx.lineTo(x - r - 0.8, y); ctx.closePath(); }
        else { ctx.moveTo(x, y - r - 0.8); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
        ctx.fill(); if (on) ctx.stroke();
      }
      // The next sign of each contract under way: a ring to walk to.
      ctx.strokeStyle = "#e8f4ff"; ctx.lineWidth = 1.4;
      for (const n of open) for (const c of nextClues(j, n)) { ctx.beginPath(); ctx.arc(c.at.x * px, c.at.z * px, 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    },
    /** The lit fire nearest world point (x, z) within `r` metres: what a tap on the big map travels to. */
    fireAt(x: number, z: number, r: number): Poi | undefined {
      const j = log();
      let best: Poi | undefined, d = r;
      for (const p of ALL) if (p.kind === "fire" && marked(j, p) && Math.hypot(p.x - x, p.z - z) < d) { best = p; d = Math.hypot(p.x - x, p.z - z); }
      return best;
    },
    /** Region n's places for an agent: where each is, and whether it is found, lit or seen. */
    state(n: number) {
      const j = log();
      return (POIS.get(n) ?? []).map((p) => ({ id: p.id, kind: p.kind, name: p.name, section: p.k + 1, x: p.x, z: p.z, done: marked(j, p) }));
    },
    /** Region n's contracts for an agent: the board, the creature, its stage (null untaken, 0-3 signs read, 4 closed), the next sign and the lair. */
    hunts(n: number) {
      const j = log();
      return huntsIn(n).map((h) => {
        const st = j?.hunts?.[h.id] ?? null, next = st !== null && st < h.clues.length ? h.clues[st]!.at : null;
        return { id: h.id, title: h.title, creature: h.creature, level: h.level, board: h.board, stage: st, next, lair: h.lair };
      });
    },
  };
}
export type PoiView = ReturnType<typeof poiView>;
