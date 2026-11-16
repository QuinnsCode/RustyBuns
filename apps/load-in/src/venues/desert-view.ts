// The desert on the page: sand under a night sky with stars and a full moon, the dance floor marked out, the crew's
// tents off to the right (red when the wall is too loud for them), the truck at the end of the track, lasers off the
// top of the wall once it plays, and the heat map (H) of the mids and highs or (B) the bins' bass. Enter is show time:
// the sky runs the night through to sunrise, or goes dark at the hour the fuel runs out. main.ts calls `desertView`
// once per world and then `key` and `update`, as it does the park's view.
import * as THREE from "three";
import { type World } from "../sim.ts";
import { type Cables } from "../cables/cables.ts";
import { type Zone, master, rig } from "./dive-bar.ts";
import { aimKey, heatColour } from "./dive-bar-view.ts";
import { BASS, CAMP_LIMIT, GROUND, PASS, SPREAD, TARGET, ZONES, desertState, heat, score, show, type Score, type Show } from "./desert.ts";
import { playing } from "./park.ts";

export type DesertView = {
  /** A key while playing with hands free; true when the desert used it. */
  key(code: string): boolean;
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean): void;
  /** Show time: the night runs to sunrise (or to the hour the fuel ran out); the card shows the score and the pay. */
  doors(): Show;
  dispose(): void;
};

const NIGHT = new THREE.Color(0x070b1c), DAWN = new THREE.Color(0xf0a070), DAY = new THREE.Color(0x9cc3e0), DARK = new THREE.Color(0x020306);

export function desertView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables): DesertView {
  const g = new THREE.Group();
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...opts });
  const slab = (z: Zone, y: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(z.x1 - z.x0, h, z.z1 - z.z0), m);
    mesh.position.set((z.x0 + z.x1) / 2, y + h / 2, (z.z0 + z.z1) / 2);
    g.add(mesh);
    return mesh;
  };
  // Sand out to the dunes, the truck's track in from the end of the road.
  slab({ x0: -120, x1: 120, z0: -120, z1: 120 }, -0.02, 0.02, mat(0xc8a97a));
  slab({ x0: -1.4, x1: 1.4, z0: 24, z1: 120 }, -0.015, 0.02, mat(0xb39466));
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2, r = 44 + 6 * Math.sin(k * 2.3);
    const dune = new THREE.Mesh(new THREE.SphereGeometry(9 + 4 * Math.cos(k * 1.7), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xb89a6c));
    dune.scale.y = 0.3;
    dune.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
    g.add(dune);
  }
  // The dance floor, outlined.
  const f = ZONES.floor, edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(f.x1 - f.x0, 0.001, f.z1 - f.z0)), new THREE.LineBasicMaterial({ color: 0xf2c230 }));
  edge.position.set((f.x0 + f.x1) / 2, 0.015, (f.z0 + f.z1) / 2);
  g.add(edge);
  // The truck at the end of the track, its tail toward the wall.
  slab(ZONES.truck, 0.3, 2.6, mat(0xe8e2d0));
  // The camp: a cluster of dome tents.
  const tentMat = mat(0x3f6f8f), loudMat = mat(0xd0503c), tents: THREE.Mesh[] = [];
  const c = ZONES.camp;
  for (let k = 0; k < 6; k++) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), tentMat);
    t.position.set(c.x0 + 1.5 + (k % 3) * 3.5, 0, c.z0 + 2 + Math.floor(k / 3) * 6);
    t.scale.y = 0.9;
    g.add(t);
    tents.push(t);
  }

  // The sky: stars on a dome inside the camera's 60 m reach, and the full moon low over the dunes.
  const starPts: number[] = [];
  for (let k = 0; k < 900; k++) {
    const u = Math.sin(k * 12.9898) * 43758.5453, v = Math.sin(k * 78.233) * 12345.678;
    const az = (u - Math.floor(u)) * Math.PI * 2, el = Math.asin(0.08 + 0.92 * (v - Math.floor(v)));
    starPts.push(Math.cos(el) * Math.cos(az) * 55, Math.sin(el) * 55, Math.cos(el) * Math.sin(az) * 55);
  }
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false });
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3)), starMat);
  g.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf4f0dc, fog: false }));
  moon.position.set(-28, 22, -38);
  g.add(moon);
  const moonlight = new THREE.DirectionalLight(0xa8b8e0, 0.6);
  moonlight.position.copy(moon.position);
  g.add(moonlight);
  const sun = new THREE.DirectionalLight(0xffd2a0, 0);
  sun.position.set(50, 4, -20);
  g.add(sun);

  // Lasers: thin beams fanning off the top of the wall over the floor, sweeping while the wall plays.
  const lasers: THREE.Mesh[] = [];
  const beam = new THREE.CylinderGeometry(0.015, 0.015, 40, 4).translate(0, 20, 0).rotateX(Math.PI / 2);
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({ color: k % 2 ? 0x30ff70 : 0x40c0ff, transparent: true, opacity: 0.7, fog: false }));
    l.visible = false;
    g.add(l);
    lasers.push(l);
  }

  // The heat map, one texel per 1 m cell, just over the sand.
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
  scene.add(g);

  const was = { background: scene.background, fog: scene.fog };
  const sky = NIGHT.clone();
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 25, 58);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.appendChild(card);

  let seen = "", last: Score | null = null, opened: Show | null = null, band: "high" | "low" = "high", night: { at: number; hours: number; dawn: boolean } | null = null;
  const signature = (w: World, cs: Cables) => JSON.stringify([band, w.held?.key, w.items.map((i) => [i.x, i.y, i.z, i.rot]), rig(w),
    cs.runs.map((r) => [r.a, r.b, r.rope?.pts.filter((p, k) => k % 8 === 0).map((p) => [Math.round(p.x * 10), Math.round(p.z * 10)])])]);

  function paint(w: World, cs: Cables) {
    const high = heat(w, cs), low = heat(w, cs, "low"), shown = band === "high" ? high : low;
    for (let k = 0; k < shown.db.length; k++) data.set(band === "high" ? heatColour(shown.db[k], TARGET, SPREAD) : heatColour(shown.db[k], BASS + SPREAD, SPREAD), k * 4);
    tex.needsUpdate = true;
    last = score(w, cs, high, low);
    for (const t of tents) t.material = last.camp !== null && last.camp > CAMP_LIMIT ? loudMat : tentMat;
  }

  /** The sky at `h` hours into the night: deep night, then the last hour and a half going to dawn; `dawn` false is the wall gone dark. */
  function skyAt(h: number, dawn: boolean) {
    if (!dawn) { sky.copy(DARK); starMat.opacity = 1; sun.intensity = 0; return; }
    const k = Math.max(0, Math.min(1, (h - 10.5) / 1.5));
    sky.copy(NIGHT).lerp(DAWN, Math.min(1, k * 1.4));
    if (k > 0.7) sky.lerp(DAY, (k - 0.7) / 0.3 * 0.6);
    starMat.opacity = 1 - k;
    sun.intensity = 1.6 * k;
    sun.position.y = 4 + 20 * k;
  }

  const view: DesertView = {
    heatOn: false,
    setHeat(on) { view.heatOn = on; plane.visible = on; },
    key(code) {
      const w = getWorld();
      if (code === "KeyH") return view.setHeat(!view.heatOn), true;
      if (code === "KeyB") return (band = band === "high" ? "low" : "high"), view.setHeat(true), true;
      if (code === "BracketLeft" || code === "BracketRight") return master(w, rig(w).master + (code === "BracketLeft" ? -1 : 1)), true;
      if (code === "Enter") return view.doors(), true;
      return aimKey(w, code);
    },
    update() {
      const w = getWorld(), cs = getCables(), sig = signature(w, cs), now = performance.now();
      if (sig !== seen) { seen = sig; paint(w, cs); }
      const s = last!, st = desertState(w, cs), gen = st.generator, fuel = st.fuel, db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);
      // The night on show time: twelve hours in twelve seconds; the lasers and the wall stop when the fuel does.
      const h = night ? Math.min(night.hours, (now - night.at) / 1000) : 0, dark = !!night && !night.dawn && h >= night.hours;
      if (night) skyAt(h, night.dawn || h < night.hours);
      const on = !dark && playing(w, cs).size > 0, top = Math.max(0, ...w.items.filter((i) => i.gear.startsWith("top-")).map((i) => i.y + 0.72));
      lasers.forEach((l, k) => {
        l.visible = on && (!night || h < 11.5);
        l.position.set(-1.2 + k * 0.6, top + 0.1, 1);
        l.rotation.set(-0.06 - 0.05 * Math.sin(now / 900 + k), (k - 2) * 0.22 + 0.3 * Math.sin(now / 1300 + k * 1.7), 0);
      });
      const power = !gen ? "no generator" : s.tripped ? "tripped" : `${(gen.watts / 1000).toFixed(1)} of ${(gen.limit / 1000).toFixed(1)} kW`;
      const runs = fuel ? `${fuel.litres} L, ${fuel.cans} can${fuel.cans === 1 ? "" : "s"} by it, runs to ${s.until}` : "";
      card.innerHTML = `<b>${opened ? "Show time" : "The desert"}</b>`
        + `<span class="${s.tripped || gen?.warn ? "warn" : ""}">Generator ${power}</span>`
        + `<span class="${fuel && !s.sunrise ? "warn" : ""}">Fuel ${runs}</span>`
        + `<span>Floor ${db(s.floor)} (target ${TARGET})</span>`
        + `<span class="${s.bass < 1 ? "warn" : ""}">Bass ${Math.round(s.bass * 100)}% of the floor at ${BASS} dB</span>`
        + `<span class="${s.camp !== null && s.camp > CAMP_LIMIT ? "warn" : ""}">Camp ${db(s.camp)} (limit ${CAMP_LIMIT})</span>`
        + `<span>Fader ${rig(w).master} dB</span>` + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">${opened.sunrise ? "The sun came up on the wall" : `Silent at ${opened.until}, before sunrise`}: ${opened.score} / ${PASS}</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid ${opened.pay} of ${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>F push the cart, H heat map, B bass map, Q / E turn, R / V tilt, [ ] fader, Enter show time</small>`;
    },
    doors() {
      view.update();
      opened = show(getWorld(), getCables());
      night = { at: performance.now(), hours: opened.night, dawn: opened.sunrise };
      return opened;
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
