// The park on the page: grass under an open sky, the pop-up tent, the paths, the road and the houses across it (red
// when they hear more than the limit), the heat map over the lot (painted only when something
// moved, or the breeze shifted) and the card: the generator's load and the hours its fuel lasts at it, the breeze, the
// crowd, the houses and the score. main.ts calls `parkView` once per world and then `key` and `update`, the same as the
// dive bar's view.
import * as THREE from "three";
import { type World } from "../sim.ts";
import { type Cables } from "../cables/cables.ts";
import { type Zone, master, rig } from "./dive-bar.ts";
import { aimKey, heatColour } from "./dive-bar-view.ts";
import { DAY_HOURS, GROUND, PARK, PASS, SPILL_LIMIT, TARGET, ZONES, blow, heat, parkState, score, show, wind, windFor, windText, type Score, type Show } from "./park.ts";

export type ParkView = {
  /** A key while playing with hands free; true when the park used it. */
  key(code: string): boolean;
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean): void;
  /** Show time: the card shows the show's score, the crowd's mood and the pay. */
  doors(): Show;
  dispose(): void;
};

const SKY = 0x9cc3e0;

export function parkView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables): ParkView {
  const g = new THREE.Group(), b = PARK.bounds;
  const mat = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity });
  const slab = (z: Zone, y: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(z.x1 - z.x0, h, z.z1 - z.z0), m);
    mesh.position.set((z.x0 + z.x1) / 2, y + h / 2, (z.z0 + z.z1) / 2);
    g.add(mesh);
    return mesh;
  };
  // The grass out past the edges, the road and the pavement, the paths.
  slab({ x0: b.x0 - 20, x1: b.x1 + 20, z0: -20, z1: ZONES.road.z0 }, -0.02, 0.02, mat(0x4f7a3a));
  slab(ZONES.road, -0.02, 0.02, mat(0x2e2f33));
  slab({ ...ZONES.road, z0: ZONES.road.z1, z1: ZONES.houses.z0 }, -0.02, 0.04, mat(0x8a8a86));
  for (const p of PARK.walkways ?? []) slab(p, 0, 0.008, mat(0xc9b48a));
  // The tent: four legs and a white roof over the stage deck.
  const t = ZONES.tent, white = mat(0xf2f2ee);
  slab(t, 0, 0.01, mat(0x5a4632));
  for (const [x, z] of [[t.x0, t.z0], [t.x1, t.z0], [t.x0, t.z1], [t.x1, t.z1]] as const) slab({ x0: x - 0.03, x1: x + 0.03, z0: z - 0.03, z1: z + 0.03 }, 0, 2.6, white);
  slab(t, 2.6, 0.08, white);
  slab({ ...t, z1: t.z0 + 0.05 }, 0, 2.6, white);
  // The crowd area, outlined on the grass.
  const c = ZONES.crowd, edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(c.x1 - c.x0, 0.001, c.z1 - c.z0)), new THREE.LineBasicMaterial({ color: 0xf2c230 }));
  edge.position.set((c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2);
  g.add(edge);
  // The houses across the road: a row of them, their front gardens on the property line.
  const houseMat = mat(0xb9a58e), loudMat = mat(0xd0503c);
  const houses: THREE.Mesh[] = [];
  for (let x = b.x0 + 2; x < b.x1; x += 7) houses.push(slab({ x0: x - 2.5, x1: x + 2.5, z0: ZONES.houses.z1 + 2, z1: ZONES.houses.z1 + 8 }, 0, 5, houseMat));

  // The heat map, one texel per 1 m cell, just over the grass.
  const data = new Uint8Array(GROUND.nx * GROUND.nz * 4);
  const tex = new THREE.DataTexture(data, GROUND.nx, GROUND.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND.x1 - GROUND.x0, GROUND.z1 - GROUND.z0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  plane.rotation.x = -Math.PI / 2;
  plane.scale.y = -1;
  plane.position.set((GROUND.x0 + GROUND.x1) / 2, 0.03, (GROUND.z0 + GROUND.z1) / 2);
  plane.visible = false;
  g.add(plane);

  const sun = new THREE.DirectionalLight(0xfff1d8, 1.6);
  sun.position.set(-20, 30, 10);
  g.add(sun);
  scene.add(g);
  // Out of doors: sky, and fog far enough off to see the houses.
  const was = { background: scene.background, fog: scene.fog };
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 110);

  // A breeze of its own each run (`?wind=<seed>` to replay one).
  const seed = Number(new URLSearchParams(location.search).get("wind")) || (Math.random() * 2 ** 32) >>> 0;
  blow(getWorld(), windFor(seed));

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.appendChild(card);

  let seen = "", last: Score | null = null, opened: Show | null = null;
  const breeze = (w: World) => { const b = wind(w); return [Math.round(b.toward * 36 / Math.PI), Math.round(b.speed * 2)]; };
  const signature = (w: World, cs: Cables) => JSON.stringify([breeze(w), w.held?.key, w.items.map((i) => [i.x, i.y, i.z, i.rot]), rig(w),
    cs.runs.map((r) => [r.a, r.b, r.rope?.pts.filter((p, k) => k % 8 === 0).map((p) => [Math.round(p.x * 10), Math.round(p.z * 10)])])]);

  function paint(w: World, cs: Cables) {
    const grid = heat(w, cs);
    for (let k = 0; k < grid.db.length; k++) data.set(heatColour(grid.db[k], TARGET), k * 4);
    tex.needsUpdate = true;
    last = score(w, cs, grid);
    const loud = last.houses !== null && last.houses > SPILL_LIMIT;
    for (const h of houses) h.material = loud ? loudMat : houseMat;
  }

  const view: ParkView = {
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
      const w = getWorld(), cs = getCables(), sig = signature(w, cs);
      if (sig !== seen) { seen = sig; paint(w, cs); }
      const s = last!, gen = parkState(w, cs).generator, db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);
      const power = !gen ? "no generator" : s.tripped ? "tripped" : `${(gen.watts / 1000).toFixed(1)} of ${(gen.limit / 1000).toFixed(1)} kW`;
      card.innerHTML = `<b>${opened ? "Show time" : "The park"}</b>`
        + `<span class="${s.tripped || gen?.warn ? "warn" : ""}">Generator ${power}</span>`
        + (s.fuel ? `<span class="${s.fuel.hours < DAY_HOURS ? "warn" : ""}">Fuel ${s.fuel.hours <= 0 ? "dry" : `${s.fuel.hours.toFixed(1)} h`} (the day is ${DAY_HOURS} h)</span>` : "")
        + `<span>${windText(wind(w))}</span>`
        + `<span>Crowd ${db(s.crowd)} (target ${TARGET})</span>`
        + `<span class="${s.houses !== null && s.houses > SPILL_LIMIT ? "warn" : ""}">Houses ${db(s.houses)} (limit ${SPILL_LIMIT})</span>`
        + `<span class="${s.hazards ? "warn" : ""}">${s.hazards ? `${s.hazards} cable${s.hazards > 1 ? "s" : ""} across a path` : "Paths clear"}</span>`
        + `<span>Fader ${rig(w).master} dB</span>` + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid ${opened.pay} of ${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>F push the generator or pour a jerry can into it, H heat map, Q / E turn, R / V tilt, Z / X stand, [ ] fader, Enter show time</small>`;
    },
    doors() {
      view.update();
      return (opened = show(getWorld(), getCables()));
    },
    dispose() {
      scene.remove(g);
      scene.background = was.background;
      scene.fog = was.fog;
      card.remove();
      tex.dispose();
    },
  };
  return view;
}
