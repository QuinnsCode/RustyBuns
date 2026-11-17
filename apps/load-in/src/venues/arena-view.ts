// The big arena on the page: the stage deck, the floor and the dock marked out, a rigging point on the roof over each fly
// bar with its chain down to the hang, the two delay towers' scaffolds, the company switch on the right wall with a
// lamp per leg, the crew as hi-vis figures, the heat map and the card. main.ts calls `arenaView` once per world, then
// `key`, `tick` (the crew), `hint` and `update`, the same as the other venues' views.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { aimed, facing, type Answer, type World } from "../sim.ts";
import type { Fed, Rig } from "../audio/hear.ts";
import { heatColour } from "./dive-bar-view.ts";
import type { Zone } from "./dive-bar.ts";
import {
  FEEDS, FLOOR, LEGS, PASS, POINTS, SPLAYS, SWITCH, TARGET, ZONES, type Leg, type Score, type Show,
  arena, crewTick, fly, handsNow, heat, legs, lower, powered, reserved, score, send, setHang, setLeg, setSub, show,
} from "./arena.ts";

export type ArenaView = {
  /** A key while playing with hands free; true when the arena used it. */
  key(code: string): boolean;
  /** Each frame: the crew up to now. */
  tick(): void;
  update(): void;
  /** What the hint line says for the arena's own moves, or null. */
  hint(): string | null;
  /** Who plays (a flown, powered box; a sub on powered amps) and each box's tilt, for what you hear. */
  fed(): Fed;
  rig(): Rig;
  heatOn: boolean;
  setHeat(on: boolean): void;
  doors(): Show;
  dispose(): void;
};

const ROOF = 15.8;

export function arenaView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): ArenaView {
  const g = new THREE.Group();
  const mat = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: opacity < 1, opacity });
  const slab = (z: Zone, y: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(z.x1 - z.x0, h, z.z1 - z.z0), m);
    mesh.position.set((z.x0 + z.x1) / 2, y + h / 2, (z.z0 + z.z1) / 2);
    g.add(mesh);
    return mesh;
  };
  const outline = (z: Zone, color: number) => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(z.x1 - z.x0, 0.001, z.z1 - z.z0)), new THREE.LineBasicMaterial({ color }));
    e.position.set((z.x0 + z.x1) / 2, 0.015, (z.z0 + z.z1) / 2);
    g.add(e);
  };
  slab(ZONES.stage, 0, 0.012, mat(0x26221f));
  outline(ZONES.crowd, 0xf2c230);
  outline(ZONES.dock, 0x7f8a99);
  // The roof grid, and over each fly bar a motor on a beam, a chain down, and the bar's mark on the floor.
  for (let x = -18; x <= 18; x += 6) slab({ x0: x - 0.15, x1: x + 0.15, z0: 0, z1: 56 }, ROOF, 0.3, mat(0x3a3d42));
  const chains = new Map<string, THREE.Mesh>();
  for (const p of POINTS) {
    slab({ x0: p.x - 0.2, x1: p.x + 0.2, z0: p.z - 0.2, z1: p.z + 0.2 }, ROOF - 0.5, 0.5, mat(0xc0392b));
    outline({ x0: p.x - 0.7, x1: p.x + 0.7, z0: p.z - 0.45, z1: p.z + 0.45 }, 0xe0533e);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), mat(0x9aa0a6));
    chains.set(p.key, chain);
    g.add(chain);
    // A delay tower: a scaffold square from the floor up to its trim.
    if (p.kind === "tower") for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      slab({ x0: p.x + dx - 0.03, x1: p.x + dx + 0.03, z0: p.z + dz - 0.03, z1: p.z + dz + 0.03 }, 0, p.trim + 0.6, mat(0x8c939b));
    }
  }
  // The company switch: a grey cabinet on the right wall, a lamp per leg.
  slab({ x0: SWITCH.x, x1: SWITCH.x + 0.35, z0: SWITCH.z - 0.5, z1: SWITCH.z + 0.5 }, 0.4, 1.6, mat(0x6d747c));
  const lamps = LEGS.map((_, k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x3ad16b }));
    m.position.set(SWITCH.x - 0.02, 1.7, SWITCH.z - 0.25 + k * 0.25);
    g.add(m);
    return m;
  });
  // The crew: a hi-vis body and a head each.
  const body = new THREE.CapsuleGeometry(0.22, 1.0, 4, 8), head = new THREE.SphereGeometry(0.14, 10, 8);
  const vest = mat(0xf2a33a), skin = mat(0xc89f7c);
  const people = arena(getWorld()).crew.map(() => {
    const p = new THREE.Group(), b = new THREE.Mesh(body, vest), h = new THREE.Mesh(head, skin);
    b.position.y = 0.72; h.position.y = 1.62;
    p.add(b, h);
    g.add(p);
    return p;
  });

  // The heat map, one texel per 1 m cell.
  const data = new Uint8Array(FLOOR.nx * FLOOR.nz * 4);
  const tex = new THREE.DataTexture(data, FLOOR.nx, FLOOR.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  plane.rotation.x = -Math.PI / 2;
  plane.scale.y = -1;
  plane.position.set((FLOOR.x0 + FLOOR.x1) / 2, 0.03, (FLOOR.z0 + FLOOR.z1) / 2);
  plane.visible = false;
  g.add(plane);

  // House lights: a wash from the roof, so the far end is not black.
  const wash = new THREE.HemisphereLight(0xd8e0ee, 0x222222, 0.9);
  const work = [8, 28, 48].map((z) => { const l = new THREE.PointLight(0xfff0d8, 60, 40, 1.4); l.position.set(0, 14, z); return l; });
  g.add(wash, ...work);
  scene.add(g);
  const was = scene.fog;
  scene.fog = new THREE.Fog(0x0d1420, 30, 90);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.appendChild(card);

  let selected: string | null = "main-l", tagged: string | null = null, seen = "", last: Score | null = null, opened: Show | null = null;
  let note = { text: "", until: 0 };
  const say = (r: Answer, ok: string) => { note = { text: r.ok ? ok : r.why, until: performance.now() + 2200 }; return true; };
  const signature = (w: World) => JSON.stringify([w.items.map((i) => [i.x, i.y, i.z, i.rot]), arena(w).hangs, arena(w).subs, arena(w).legs]);

  function paint(w: World) {
    const grid = heat(w);
    for (let k = 0; k < grid.db.length; k++) data.set(heatColour(grid.db[k], TARGET), k * 4);
    tex.needsUpdate = true;
    last = score(w, grid);
  }

  const view: ArenaView = {
    heatOn: false,
    setHeat(on) { view.heatOn = on; plane.visible = on; },
    key(code) {
      const w = getWorld(), a = arena(w), at = aimed(w);
      const digit = /^Digit([1-7])$/.exec(code);
      if (digit) return (selected = FEEDS[Number(digit[1]) - 1]), true;
      if (code === "KeyH") return view.setHeat(!view.heatOn), true;
      if (code === "Enter") return view.doors(), true;
      // A sub you look at: I flips its polarity, , and . step its delay.
      if (at?.gear === "sub-18") {
        const s = a.subs[at.key] ?? { delay: 0, invert: false };
        if (code === "KeyI") return say(setSub(w, at.key, { invert: !s.invert }), `${at.key} polarity ${s.invert ? "normal" : "flipped"}`);
        if (code === "Comma" || code === "Period") return say(setSub(w, at.key, { delay: s.delay + (code === "Period" ? 0.5 : -0.5) }), `${at.key} delay ${a.subs[at.key]?.delay ?? 0} ms`);
      }
      if (code === "KeyK") {
        // K on a piece: a box goes to the selected fly bar; anything else is tagged, and K at a spot sends it there.
        if (at && !reserved(w, at.key)) {
          if (at.gear === "line-array-box" && selected && selected !== "subs") return say(send(w, at.key, selected), `crew: ${at.key} to ${selected}`);
          tagged = at.key;
          return say({ ok: true }, `${at.key} tagged: K where it goes`);
        }
        if (tagged) {
          const f = facing(w.you.yaw), to = { x: w.you.x + f.x * 1.5, z: w.you.z + f.z * 1.5 }, key = tagged;
          tagged = null;
          return say(send(w, key, to), `crew: ${key} here`);
        }
        return false;
      }
      if (!selected) return false;
      if (code === "KeyL") {
        const now = a.legs[selected], next: Leg | null = now === null ? "L1" : now === "L3" ? null : LEGS[LEGS.indexOf(now) + 1];
        return say(setLeg(w, selected, next), `${selected} on ${next ?? "no leg"}`);
      }
      if (selected === "subs") return false;
      const h = a.hangs[selected];
      if (code === "KeyU") return say(h.flown ? lower(w, selected) : fly(w, selected), `${selected} ${h.flown ? "flying to trim" : "down"}`);
      if (code === "KeyR" || code === "KeyV") return say(setHang(w, selected, { angle: h.angle + (code === "KeyR" ? 1 : -1) }), `${selected} at ${a.hangs[selected].angle} degrees`);
      if (code === "Comma" || code === "Period") return say(setHang(w, selected, { delay: h.delay + (code === "Period" ? 5 : -5) }), `${selected} delay ${a.hangs[selected].delay} ms`);
      return false;
    },
    tick() { crewTick(getWorld()); },
    hint() {
      if (performance.now() < note.until) return note.text;
      const w = getWorld(), at = aimed(w);
      if (w.held) return null;
      if (at?.gear === "line-array-box" && !reserved(w, at.key)) return `K send the crew with it to ${selected && selected !== "subs" ? selected : "where you point next"} (two to a box)`;
      if (at?.gear === "sub-18") return `F pick up, K tag for the crew, I polarity, , . delay`;
      return null;
    },
    fed: () => (w, key) => {
      const i = w.items.find((x) => x.key === key);
      if (!i) return false;
      if (i.gear === "sub-18") return powered(w, "subs") && i.y === 0 && !reserved(w, key);
      const p = POINTS.find((q) => arena(w).hangs[q.key].boxes.includes(key));
      return !!p && arena(w).hangs[p.key].flown && powered(w, p.key);
    },
    rig() {
      const tilt: Record<string, number> = {};
      for (const p of POINTS) {
        const h = arena(getWorld()).hangs[p.key];
        h.boxes.forEach((k, n) => { tilt[k] = ((h.angle - SPLAYS[n]) * Math.PI) / 180; });
      }
      return { tilt };
    },
    update() {
      const w = getWorld(), a = arena(w), sig = signature(w);
      if (sig !== seen) { seen = sig; paint(w); }
      for (const p of POINTS) {
        // The chain from the motor down to the top of the hang (at trim) or to the bar on the floor.
        const h = a.hangs[p.key], low = h.flown ? p.trim : Math.max(0.4, h.boxes.length * 0.32 + 0.1), c = chains.get(p.key)!;
        c.scale.y = ROOF - 0.5 - low;
        c.position.set(p.x, (ROOF - 0.5 + low) / 2, p.z);
      }
      const ls = legs(w);
      ls.forEach((l, k) => (lamps[k].material as THREE.MeshBasicMaterial).color.setHex(l.tripped ? 0xe04a3a : l.warn ? 0xf2a33a : 0x3ad16b));
      handsNow(w).forEach((h, k) => people[k].position.set(h.x, 0, h.z));
      const s = last!, sel = selected, hang = sel && sel !== "subs" ? a.hangs[sel] : null;
      const busy = handsNow(w).filter((h) => h.doing !== "free").length;
      card.innerHTML = `<b>${opened ? "Show time" : "The arena"}</b>`
        + `<span>Selected ${esc(sel ?? "nothing")}${hang ? `: ${hang.boxes.length} box${hang.boxes.length === 1 ? "" : "es"}, ${hang.flown ? "at trim" : "on the floor"}, ${hang.angle} deg${sel!.startsWith("tower") ? `, ${hang.delay} ms` : ""}` : ""}${sel ? `, ${a.legs[sel] ?? "no leg"}` : ""}</span>`
        + ls.map((l) => `<span class="${l.tripped ? "trip" : l.warn ? "warn" : ""}">${l.leg} ${(l.watts / 1000).toFixed(1)} of ${(l.limit / 1000).toFixed(1)} kW${l.tripped ? ", tripped" : ""}</span>`).join("")
        + `<span>Crew ${busy} of ${a.crew.length} busy${a.jobs.some((j) => !j.sched) ? `, ${a.jobs.filter((j) => !j.sched).length} waiting` : ""}</span>`
        + `<span>Floor ${s.crowd === null ? "silent" : `${s.crowd.toFixed(0)} dB`} (target ${TARGET}), ${Math.round(s.covered * 100)}% in</span>`
        + `<span>Towers ${s.lagMs === null ? "not playing" : `${s.lagMs} ms after the mains, ${Math.round(s.lined * 100)}% in time`}</span>`
        + `<span>Stage ${s.stageGap === null ? "no subs" : `${s.stageGap} dB under the floor in the lows`}</span>` + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid $${opened.pay} of $${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>1-6 a rigging point, 7 the subs; K send the crew; U fly; R / V angle; , . delay; L leg at the switch; I sub polarity; H heat map; Enter show time</small>`;
    },
    doors() {
      view.update();
      return (opened = show(getWorld()));
    },
    dispose() {
      scene.remove(g);
      scene.fog = was;
      card.remove();
      tex.dispose();
      body.dispose();
      head.dispose();
    },
  };
  return view;
}
