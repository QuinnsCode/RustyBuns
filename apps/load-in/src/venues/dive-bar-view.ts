// The dive bar on the page: its dressing (dive-bar-dress.ts: brick, tiles, stools, taps, the door), the counter, the stage and the crowd area marked on the floor, the coverage heat map
// (painted only when something moved, not every frame; mids and highs or the sub's bass), the aim keys and the score
// card (touch.ts has the aim keys' touch pad). The card holds only the scores: each key is named in the centre prompt
// when you look at what it works on (`aimHint`, `roomHint`). main.ts calls `barView`
// once per world and then `keys` and `update`; everything else stays in here.
import * as THREE from "three";
import { aimed, facing, type World } from "../sim.ts";
import type { Band } from "@rustybuns/gear";
import { CROWD, FLOOR, PASS, STAND_MIN, TARGET, WINDOW, ZONES, type Zone, type Show, aim, crowdState, heat, master, raise, rig, scores, show, type Score } from "./dive-bar.ts";
import { crowdOf, letIn, move, type Mood } from "../crowd/crowd.ts";
import { crowdView } from "../crowd/crowd-view.ts";
import { diveBarDressing } from "./dive-bar-dress.ts";

const STEP = Math.PI / 36, TILT = Math.PI / 60;

/** dB to a colour against `target`: deep blue far under it, green on it, red over it; silence is clear. */
export function heatColour(db: number, target = TARGET, window = WINDOW): [number, number, number, number] {
  if (!Number.isFinite(db)) return [0, 0, 0, 0];
  const t = Math.max(-1, Math.min(1, (db - target) / (window * 3)));
  if (Math.abs(db - target) <= window) return [60, 200, 90, 170];
  return t < 0 ? [40, 90 + 110 * (1 + t), 230, 150] : [235, 170 - 140 * t, 50, 170];
}

/** Q / E turn and R / V tilt the top (or front fill) you look at; Z / X lower and raise its stand. True when the key did something. */
export function aimKey(w: World, code: string): boolean {
  const at = aimed(w);
  if (!at) return false;
  if (at.gear.startsWith("top-") || at.gear === "fill-8-powered") {
    if (code === "KeyQ" || code === "KeyE") return aim(w, at.key, { turn: code === "KeyQ" ? STEP : -STEP }).ok;
    if (code === "KeyR" || code === "KeyV") return aim(w, at.key, { tilt: code === "KeyR" ? TILT : -TILT }).ok;
  }
  // Z and X lower and raise the stand you look at, or the one under the top you look at.
  const stand = at.gear === "stand-tripod" ? at : w.items.find((s) => s.gear === "stand-tripod" && Math.hypot(s.x - at.x, s.z - at.z) < 0.05);
  if (stand && (code === "KeyZ" || code === "KeyX")) {
    const h = rig(w).stand[stand.key] ?? STAND_MIN;
    return raise(w, stand.key, h + (code === "KeyX" ? 0.1 : -0.1)).ok;
  }
  return false;
}

/** The keys that work on the gear you look at, for the centre prompt: turn and tilt on a top or a front fill, Z / X on a
 * stand (or the top sat on one), the fader on the mixer. "" when you look at nothing they work on. */
export function aimHint(w: World): string {
  const at = aimed(w);
  if (!at) return "";
  const speaker = at.gear.startsWith("top-") || at.gear === "fill-8-powered";
  const stand = at.gear === "stand-tripod" || w.items.some((s) => s.gear === "stand-tripod" && Math.hypot(s.x - at.x, s.z - at.z) < 0.05);
  return [...(speaker ? ["Q / E turn", "R / V tilt"] : []), ...(stand ? ["Z / X stand"] : []), ...(at.gear.startsWith("mixer-") ? [`[ ] fader, ${rig(w).master} dB`] : [])].join(", ");
}

/** The keys that work on the room, shown when you look at the part they work on with no gear in the way: H when you
 * look down at the floor (the heat map is painted on it), Enter when you face the street door from inside. */
export function roomHint(w: World, map: { on: boolean; band: Band }, opened: boolean): string {
  const { you } = w, r = w.level.room;
  if (you.pitch < -0.45) return !map.on ? "H heat map" : map.band === "high" ? "H bass map (mids now)" : "H map off (bass now)";
  const dx = (r.x0 + r.x1) / 2 - you.x, dz = r.z1 - you.z, d = Math.hypot(dx, dz), f = facing(you.yaw);
  return !opened && dz > 0 && d < 5 && (dx * f.x + dz * f.z) / d > 0.9 ? "Enter open the doors" : "";
}

export type BarView = {
  /** The centre prompt with your hands free and no gear in front of you: the key for the part of the room you look at. */
  look(): string;
  /** A key while playing with hands free; true when the dive bar used it. */
  key(code: string): boolean;
  /** Each frame: repaint the heat map if anything moved, refresh the card. */
  update(): void;
  heatOn: boolean;
  /** Which band the heat map shows. */
  band: Band;
  setHeat(on: boolean, band?: Band): void;
  /** The doors open: the card shows the final score. */
  doors(): Show;
  dispose(): void;
};

export function barView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): BarView {
  const g = new THREE.Group();
  const mat = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: opacity < 1, opacity });
  const slab = (z: Zone, y: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(z.x1 - z.x0, h, z.z1 - z.z0), m);
    mesh.position.set((z.x0 + z.x1) / 2, y + h / 2, (z.z0 + z.z1) / 2);
    g.add(mesh);
  };
  const dressing = diveBarDressing(getWorld().level);
  g.add(dressing.group);
  slab(ZONES.stage, 0, 0.012, mat(0x2a1f1a));
  slab(ZONES.counter, 0, 1.05, mat(0x4a2e1e));
  slab({ ...ZONES.counter, x1: ZONES.counter.x1 + 0.1 }, 1.05, 0.05, mat(0x6b4a2e));
  slab(ZONES.bar, 0, 0.006, mat(0x3a2a40, 0.6));
  const c = ZONES.crowd, edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(c.x1 - c.x0, 0.001, c.z1 - c.z0)),
    new THREE.LineBasicMaterial({ color: 0xf2c230 }));
  edge.position.set((c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2);
  g.add(edge);

  // The heat map: one texel per cell of the coverage grid, on a plane just over the floor.
  const data = new Uint8Array(FLOOR.nx * FLOOR.nz * 4);
  const tex = new THREE.DataTexture(data, FLOOR.nx, FLOOR.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  // Flat on the floor with texture row 0 at z0: a plane turned -90 degrees about x puts its v = 0 edge at +z, so flip v.
  plane.rotation.x = -Math.PI / 2;
  plane.scale.y = -1;
  plane.position.set((FLOOR.x0 + FLOOR.x1) / 2, 0.02, (FLOOR.z0 + FLOOR.z1) / 2);
  plane.visible = false;
  g.add(plane);
  scene.add(g);

  const card = document.createElement("div");
  card.id = "bar-card";
  card.className = "bar-card";
  hud.appendChild(card);
  const info = document.createElement("div");
  card.append(info);

  let seen = "", last: Score | null = null, full: Score | null = null, opened: Show | null = null;
  const signature = (w: World) => JSON.stringify([view.band, w.held?.key, w.items.map((i) => [i.x, i.y, i.z, i.rot]), rig(w), crowdOf(w)?.moves ?? -1]);
  const people = crowdView(scene);

  // The mids map shows the empty room until the doors open, then the room as the crowd hears it.
  function paint(w: World) {
    const low = heat(w, "low"), s = scores(w, low), shown = view.band === "low" ? low : crowdOf(w) ? s.fullGrid : s.empty;
    for (let k = 0; k < shown.db.length; k++) data.set(heatColour(shown.db[k]), k * 4);
    tex.needsUpdate = true;
    last = s.soundcheck;
    full = s.full;
    moods = crowdState(w, s).regions;
    people.moods(moods);
  }
  let moods: Mood[] = [];

  const view: BarView = {
    heatOn: false,
    band: "high",
    setHeat(on, band = view.band) { view.heatOn = on; view.band = band; plane.visible = on; },
    key(code) {
      const w = getWorld();
      // H steps the heat map: off, mids and highs, the bass, off.
      if (code === "KeyH") return (!view.heatOn ? view.setHeat(true, "high") : view.band === "high" ? view.setHeat(true, "low") : view.setHeat(false, "high")), true;
      if (code === "BracketLeft" || code === "BracketRight") return master(w, rig(w).master + (code === "BracketLeft" ? -1 : 1)), true;
      if (code === "Enter") return view.doors(), true;
      return aimKey(w, code);
    },
    look: () => roomHint(getWorld(), { on: view.heatOn, band: view.band }, !!opened),
    update() {
      const w = getWorld();
      // The crowd moves on how each part of the room hears it: forward, back from the stack, or out of the door.
      move(w, moods);
      const sig = signature(w);
      if (sig !== seen) { seen = sig; paint(w); }
      people.update(w, crowdOf(w));
      const s = last!, db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);
      info.innerHTML = `<b>${opened ? "Doors open" : "Dive bar"}</b>`
        + `<span>Crowd ${db(s.crowd)} (target ${TARGET})</span><span>Bar ${s.gap === null ? "silent" : `${Math.abs(Math.round(s.gap))} dB ${Math.round(s.gap) < 0 ? "over" : "under"}`}</span>`
        + `<span>Room full: crowd ${db(full!.crowd)}, score ${full!.score}</span>`
        + `<span>Bass ${Math.round(s.bass * 100)}% even</span>` + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid $${opened.pay} of $${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`);
    },
    doors() {
      const w = getWorld();
      if (!crowdOf(w)) letIn(w, CROWD);
      view.update();
      return (opened = show(getWorld()));
    },
    dispose() { people.dispose(); dressing.dispose(); scene.remove(g); card.remove(); tex.dispose(); },
  };
  return view;
}
