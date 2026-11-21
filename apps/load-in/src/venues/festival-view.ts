// The festival on the page: a mown field at golden hour, the dance tent (a peaked canopy) and the open stage (a roof
// on a truss) 120 m apart, each turning with its system; the traders' vans between them, the generator compound behind
// its fence panels, the south fence and the houses past it. H shows the mids-and-highs map, B the 63 Hz map. At a
// stage, [ and ] turn it 15 degrees, K builds its subs omni or cardioid and U lifts its tops over the crowd (the
// tent's stacks onto scaffold wings over the subs, the open stage's pairs flown from its roof); at a desk, - and = ride its fader and G
// runs the snake; at the compound, 1 to 9 move a load to the next phase and Z / X size the tent's and the open stage's
// feeders. Enter is show time: the show runs an hour and the card shows the licence. main.ts calls `festivalView` once
// per world and then `key` and `update`, as it does the desert's view.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { type World } from "../sim.ts";
import { heatColour } from "./dive-bar-view.ts";
import {
  COMPOUND, FEEDERS, FEEDS, FENCE_LIMIT, FENCE_Z, FIELD, HOUSES, HOUSE_LIMIT, LEGS, LIFT, MIX_LIMIT, PASS, STAGES, STAGE_KEYS, TARGET, TRADERS, WINDOW,
  type Heat, type Show, type StageKey, awgName, clockAt, crowdSpot, crowdState, face, feeder, festivalState, heat, lift, master, phase, rig, run, scores, show, snake, subs,
} from "./festival.ts";
import { crowdOf, letIn } from "../crowd/crowd.ts";
import { MAX_BIG, crowdView } from "../crowd/crowd-view.ts";

export type FestivalView = {
  key(code: string): boolean;
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean, band?: "high" | "low"): void;
  doors(): Show;
  /** The answer to the last key the festival used: a reason to flash when it said no. */
  said: string;
  dispose(): void;
};

const SKY = 0xf3c28a;

export function festivalView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): FestivalView {
  const g = new THREE.Group();
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
  const block = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, z);
    parent.add(mesh);
    return mesh;
  };
  // The field, mown stripes, the lane in from the gate, the south fence and the houses past it.
  block(400, 0.02, 400, 0, -0.03, 0, mat(0x5d8a3a));
  for (let k = -8; k <= 8; k += 2) block(10, 0.005, 140, k * 10, -0.012, 10, mat(0x67953f));
  block(6, 0.01, 24, COMPOUND.x, -0.01, COMPOUND.z - 6, mat(0x9b8a68));
  const post = mat(0x6b6b6b), panel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.55 });
  for (let x = -84; x < 84; x += 3.5) { block(0.05, 2, 0.05, x, 0, FENCE_Z - 1, post); block(3.45, 1.9, 0.02, x + 1.75, 0.05, FENCE_Z - 1, panel); }
  const houseMat = [mat(0xd9cbb0), mat(0xc4b49a), mat(0xe2d6c4)], roof = mat(0x6e3f2e);
  for (const [k, h] of HOUSES.entries()) {
    block(9, 6, 8, h.x, 0, h.z, houseMat[k % 3]!);
    const r = new THREE.Mesh(new THREE.ConeGeometry(7, 3, 4), roof);
    r.position.set(h.x, 7.5, h.z);
    r.rotation.y = Math.PI / 4;
    r.scale.set(1, 1, 0.85);
    g.add(r);
  }
  // The generator compound: heras panels round it.
  for (let x = -8; x < 8; x += 3.5) for (const z of [COMPOUND.z - 10, COMPOUND.z + 3]) block(3.45, 2, 0.03, COMPOUND.x + x + 1.75, 0, z, panel);
  // The traders: vans in a row, awnings out toward the field.
  const vanMat = [mat(0xe8e2d0), mat(0x3f7fa8), mat(0xd9a03a)], awn = mat(0xb03a48);
  for (let k = 0; k < 5; k++) {
    const x = TRADERS.x0 + 4 + k * 9;
    block(5.5, 2.6, 2.2, x, 0.3, TRADERS.z1 - 4, vanMat[k % 3]!);
    const a = block(5, 0.05, 2.4, x, 2.5, TRADERS.z1 - 6.2, awn);
    a.rotation.x = -0.18;
  }

  // The stages: a group each that turns with its system.
  const deck = mat(0x2a2623), black = mat(0x1a1a1c), truss = mat(0xb8bcc2, { metalness: 0.7, roughness: 0.35 }), canvas = mat(0xeee9df, { side: THREE.DoubleSide, emissive: 0x77706a });
  const stages = {} as Record<StageKey, THREE.Group>;
  /** What holds each stage's tops up when they're lifted: a scaffold wing over each sub block, or the flying steel. */
  const rigging = {} as Record<StageKey, THREE.Group>;
  for (const k of STAGE_KEYS) {
    const s = new THREE.Group();
    block(14, 1.2, 9, 0, 0, -1, deck, s);
    if (STAGES[k].system === "dance") {
      // the tent: a canopy over the floor, a closed back wall and sides, a peaked roof
      block(30, 6, 0.1, 0, 0, -5.5, canvas, s);
      for (const x of [-15, 15]) block(0.1, 6, 40, x, 0, 14.5, canvas, s);
      // a pitched roof: two canvas slopes from the eaves at 6 m to the ridge at 10 m
      for (const x of [-1, 1]) {
        const slope = block(Math.hypot(15, 4) + 0.3, 0.08, 40.4, 0, 0, 0, canvas, s);
        slope.position.set(x * 7.5, 8, 14.5);
        slope.rotation.z = -x * Math.atan2(4, 15);
      }
    } else {
      // the open stage: four truss legs and a roof over the deck, a black backdrop
      for (const x of [-7, 7]) for (const z of [-5.5, 3.5]) block(0.4, 9, 0.4, x, 0, z, truss, s);
      block(15, 0.6, 9.6, 0, 9, -1, black, s);
      block(14, 7.5, 0.08, 0, 1.2, -5.4, black, s);
    }
    // lifted: the tent's stacks stand on a scaffold deck over each sub block; the open stage's pairs hang on chains
    const up = new THREE.Group();
    for (const side of [-1, 1]) {
      if (STAGES[k].system === "dance") {
        const deckY = LIFT.tent + 0.8;
        for (const a of [-1.95, 1.95]) for (const f of [2.3, 5.2]) block(0.06, deckY, 0.06, side * 6 + a, 0, f, truss, up);
        block(4, 0.08, 3, side * 6, deckY - 0.08, 3.75, deck, up);
        for (const f of [2.3, 5.2]) block(3.9, 0.05, 0.05, side * 6, deckY / 2, f, truss, up);
      } else {
        block(1.2, 0.12, 0.3, side * 6, LIFT.open + 0.95, 4, black, up);
        for (const a of [-0.4, 0.4]) block(0.03, 9 - LIFT.open - 1.07, 0.03, side * 6 + a, LIFT.open + 1.07, 4, truss, up);
      }
    }
    up.visible = false;
    s.add(up);
    rigging[k] = up;
    g.add(s);
    stages[k] = s;
  }

  // The heat map, one texel per 2 m cell.
  const data = new Uint8Array(FIELD.nx * FIELD.nz * 4);
  const tex = new THREE.DataTexture(data, FIELD.nx, FIELD.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x1 - FIELD.x0, FIELD.z1 - FIELD.z0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  plane.rotation.x = -Math.PI / 2;
  plane.scale.y = -1;
  plane.position.set((FIELD.x0 + FIELD.x1) / 2, 0.05, (FIELD.z0 + FIELD.z1) / 2);
  plane.visible = false;
  g.add(plane);

  const sun = new THREE.DirectionalLight(0xffd9a8, 1.8);
  sun.position.set(-80, 40, -60);
  g.add(sun, new THREE.HemisphereLight(0xbfd6ff, 0x5d8a3a, 0.9));
  scene.add(g);
  const was = { background: scene.background, fog: scene.fog };
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 150);

  const card = document.createElement("div");
  card.className = "bar-card festival-card";
  hud.appendChild(card);

  // The mids map with the crowd on the field, worked out when something moves, not every frame.
  let full: Heat | null = null;
  const people = crowdView(scene, { max: MAX_BIG });
  let seen = "", h: Heat | null = null, band: "high" | "low" = "high", opened: Show | null = null;
  const signature = (w: World) => JSON.stringify([band, w.items.filter((i) => /-(rack|desk)$/.test(i.key)).map((i) => [i.x, i.z]), rig(w).yaw, rig(w).subs, rig(w).lift, rig(w).master, rig(w).phase, rig(w).feeder, rig(w).snake, !!crowdOf(w)]);
  function paint(w: World) {
    h = heat(w);
    const both = scores(w, h);
    full = both.fullHeat;
    people.moods(crowdState(w, both).stages);
    // The mids show the empty field until show time, then the field as the crowd hears it.
    const shown = band === "low" ? h.low : crowdOf(w) ? full.high : h.high;
    for (let k = 0; k < shown.db.length; k++) data.set(band === "high" ? heatColour(shown.db[k]!, TARGET, WINDOW) : heatColour(shown.db[k]!, FENCE_LIMIT + 10, 8), k * 4);
    tex.needsUpdate = true;
    for (const k of STAGE_KEYS) {
      const s = STAGES[k];
      stages[k].position.set(s.x, 0, s.z);
      stages[k].rotation.y = rig(w).yaw[k];
      rigging[k].visible = rig(w).lift[k];
    }
  }

  const near = (w: World, x: number, z: number, r: number) => Math.hypot(w.you.x - x, w.you.z - z) <= r;
  const stageAt = (w: World) => STAGE_KEYS.find((k) => near(w, STAGES[k].x, STAGES[k].z, 14)) ?? null;
  const deskAt = (w: World) => STAGE_KEYS.find((k) => { const d = w.items.find((i) => i.key === `${k}-desk`)!; return near(w, d.x, d.z, 4.8); }) ?? null;
  const feeds = Object.keys(FEEDS);
  const db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);

  const view: FestivalView = {
    heatOn: false,
    said: "",
    setHeat(on, b = band) { band = b; view.heatOn = on; plane.visible = on; seen = ""; },
    key(code) {
      const w = getWorld(), r = rig(w), st = stageAt(w), dk = deskAt(w), atCompound = near(w, COMPOUND.x, COMPOUND.z, 8);
      const said = (a: { ok: boolean; why?: string }) => ((view.said = a.ok ? "" : a.why ?? ""), true);
      if (code === "KeyH") return view.setHeat(!(view.heatOn && band === "high"), "high"), true;
      if (code === "KeyB") return view.setHeat(!(view.heatOn && band === "low"), "low"), true;
      if (code === "Enter") return view.doors(), true;
      if (st && (code === "BracketLeft" || code === "BracketRight")) return said(face(w, st, (r.yaw[st] * 180) / Math.PI + (code === "BracketLeft" ? -15 : 15)));
      if (st && code === "KeyK") return said(subs(w, st, r.subs[st] === "omni" ? "cardioid" : "omni"));
      if (st && code === "KeyU") return said(lift(w, st, !r.lift[st]));
      if (dk && (code === "Minus" || code === "Equal")) return said(master(w, dk, r.master[dk] + (code === "Minus" ? -1 : 1)));
      if (dk && code === "KeyG") return said(snake(w, dk));
      if (atCompound && /^Digit[1-9]$/.test(code)) {
        const f = feeds[Number(code.slice(5)) - 1]!, now = r.phase[f] ?? null, next = now === null ? "L1" : now === "L3" ? null : LEGS[LEGS.indexOf(now) + 1]!;
        return said(phase(w, f, next));
      }
      if (atCompound && (code === "KeyZ" || code === "KeyX")) {
        const k: StageKey = code === "KeyZ" ? "tent" : "open";
        return said(feeder(w, k, FEEDERS[(FEEDERS.indexOf(r.feeder[k]) + 1) % FEEDERS.length]!));
      }
      return false;
    },
    update() {
      const w = getWorld(), sig = signature(w);
      if (sig !== seen || !h) { seen = sig; paint(w); }
      people.update(w, crowdOf(w));
      const s = festivalState(w, h!, full!), r = rig(w), atCompound = near(w, COMPOUND.x, COMPOUND.z, 8);
      const stageLine = (k: StageKey) => {
        const t = s.stages[k]!;
        if (!t.live) return `<span class="warn">${esc(STAGES[k].name)}: ${esc(t.why)}</span>`;
        return `<span>${esc(STAGES[k].name)}: ${db(t.level)}, bleed ${t.bleedOk < 1 ? `<span class="warn">${Math.round(t.bleedOk * 100)}% clear</span>` : "clear"}, desk ${db(t.leq)}</span>`;
      };
      const power = atCompound
        ? feeds.map((f, j) => `<span>${j + 1} ${esc(FEEDS[f]!.what)}: ${r.phase[f] ?? "off"}</span>`).join("")
          + STAGE_KEYS.map((k) => { const p = s.power.stages[k]; return `<span class="${p.ok ? "" : "warn"}">${k === "tent" ? "Z" : "X"} ${k} feeder ${p.feeder}, ${p.metres} m, drop ${(p.drop * 100).toFixed(1)}%${p.hot ? ", too thin" : ""}</span>`; }).join("")
        : `<span class="${s.powerOk ? "" : "warn"}">Power ${s.power.amps.join(" / ")} A${s.power.trips ? ", tripped" : ""}${s.power.imbalance > 0.2 ? ", unbalanced" : ""}</span>`;
      card.innerHTML = `<b>${opened ? "Show time" : "The festival"} ${clockAt(r.clock)}</b>`
        + STAGE_KEYS.map(stageLine).join("")
        + `<span>Crowd in: ${STAGE_KEYS.map((k) => `${k} ${db(s.full.stages[k]!.level)}, ${Math.round(s.full.stages[k]!.covered * 100)}% in`).join("; ")}, score ${s.full.score}${crowdOf(w) ? `, ${crowdOf(w)!.people} on the field` : ""}</span>`
        + `<span class="${s.fence !== null && s.fence > FENCE_LIMIT ? "warn" : ""}">Fence 63 Hz ${db(s.fence)} (limit ${FENCE_LIMIT})</span>`
        + `<span class="${s.houses !== null && s.houses > HOUSE_LIMIT ? "warn" : ""}">Houses ${db(s.houses)} (limit ${HOUSE_LIMIT}), desks ${MIX_LIMIT} LAeq</span>`
        + power
        + (opened ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS}, paid $${opened.pay} of $${opened.fee}</span>` : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>[ ] turn a stage, K cardioid, U lift the tops, - = fader, G snake, 1-9 phases and Z / X feeders at the compound, H / B maps, Enter show</small>`;
    },
    doors() {
      const w = getWorld();
      if (!crowdOf(w)) letIn(w, crowdSpot(w));
      run(w, 3600);
      seen = "";
      view.update();
      opened = show(w);
      return opened;
    },
    dispose() {
      people.dispose();
      scene.remove(g);
      scene.background = was.background;
      scene.fog = was.fog;
      card.remove();
      tex.dispose();
    },
  };
  return view;
}
