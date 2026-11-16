// The dive bar on the page: the counter, the stage and the crowd area marked on the floor, the coverage heat map
// (painted only when something moved, not every frame), the aim keys and the score card. main.ts calls `barView`
// once per world and then `keys` and `update`; everything else stays in here.
import * as THREE from "three";
import { aimed, type World } from "../sim.ts";
import { FLOOR, PASS, STAND_MIN, TARGET, WINDOW, ZONES, type Zone, type Show, aim, heat, master, raise, rig, score, show, type Score } from "./dive-bar.ts";

const STEP = Math.PI / 36, TILT = Math.PI / 60;

/** dB to a colour against `target`: deep blue far under it, green on it, red over it; silence is clear. */
export function heatColour(db: number, target = TARGET): [number, number, number, number] {
  if (!Number.isFinite(db)) return [0, 0, 0, 0];
  const t = Math.max(-1, Math.min(1, (db - target) / (WINDOW * 3)));
  if (Math.abs(db - target) <= WINDOW) return [60, 200, 90, 170];
  return t < 0 ? [40, 90 + 110 * (1 + t), 230, 150] : [235, 170 - 140 * t, 50, 170];
}

/** Q / E turn and R / V tilt the top (or front fill) you look at; Z / X lower and raise its stand. True when the key did something. */
export function aimKey(w: World, code: string): boolean {
  const at = aimed(w);
  if (!at) return false;
  if (at.gear === "top-12-powered" || at.gear === "fill-8-powered") {
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

export type BarView = {
  /** A key while playing with hands free; true when the dive bar used it. */
  key(code: string): boolean;
  /** Each frame: repaint the heat map if anything moved, refresh the card. */
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean): void;
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

  let seen = "", last: Score | null = null, opened: Show | null = null;
  const signature = (w: World) => JSON.stringify([w.held?.key, w.items.map((i) => [i.x, i.y, i.z, i.rot]), rig(w)]);

  function paint(w: World) {
    const grid = heat(w);
    for (let k = 0; k < grid.db.length; k++) data.set(heatColour(grid.db[k]), k * 4);
    tex.needsUpdate = true;
    last = score(w, grid);
  }

  const view: BarView = {
    heatOn: false,
    setHeat(on) { view.heatOn = on; plane.visible = on; },
    key(code) {
      const w = getWorld();
      if (code === "KeyH") return view.setHeat(!view.heatOn), true;
      if (code === "BracketLeft" || code === "BracketRight") return master(w, rig(w).master + (code === "BracketLeft" ? -1 : 1)), true;
      if (code === "Enter") return view.doors(), true;
      return aimKey(w, code);
    },
    update() {
      const w = getWorld(), sig = signature(w);
      if (sig !== seen) { seen = sig; paint(w); }
      const s = last!, db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);
      card.innerHTML = `<b>${opened ? "Doors open" : "Dive bar"}</b>`
        + `<span>Crowd ${db(s.crowd)} (target ${TARGET})</span><span>Bar ${s.gap === null ? "silent" : `${s.gap.toFixed(0)} dB under`}</span>`
        + `<span>Fader ${rig(w).master} dB</span>` + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid $${opened.pay} of $${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>H heat map, Q / E turn, R / V tilt, Z / X stand, [ ] fader, Enter doors</small>`;
    },
    doors() {
      view.update();
      return (opened = show(getWorld()));
    },
    dispose() { scene.remove(g); card.remove(); tex.dispose(); },
  };
  return view;
}
