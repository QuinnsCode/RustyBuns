// The small arena on the page: the floor, the stage, the seating bowl rising on three sides, the roof steel with a
// chain motor (@rustybuns/models' rigging) slung at each rigging point, its chain down to the flying frame, the front-of-house mark, the coverage map in 3D (a tile at every seat, at the
// seat's own height, repainted only when something moved) and the card: each point's load against its limit, the
// calculator for the point you stand under, each part of the room and the score. main.ts calls `arenaView` once per
// world and then `key`, `hint` and `update`, the same as the other venues' views.
import * as THREE from "three";
import { gearLook, rigging } from "@rustybuns/models/gear";
import type { Answer, World } from "../sim.ts";
import type { Fed } from "../audio/hear.ts";
import { master, rig, type Zone } from "./dive-bar.ts";
import { aimKey, heatColour } from "./dive-bar-view.ts";
import {
  CLEAR, CROWD, PASS, POINTS, STEEL_Y, TARGET, WEIGHTS, ZONES, BOX, bowl, calc, check, crowdState, deskAtFoh, earAt, fly, frameY, hang, hangsOf,
  land, loadKg, pin, plan, playing, scores, show, under, unhang, type Score, type Show,
} from "./small-arena.ts";
import { crowdOf, letIn } from "../crowd/crowd.ts";
import { MAX_BIG, crowdView } from "../crowd/crowd-view.ts";

export type ArenaView = {
  /** A key while playing; true when the arena used it. `say` shows a refusal under the crosshair. */
  key(code: string, say: (why: string) => void): boolean;
  /** What the keys do where you stand, or null to leave the hint to the page. */
  hint(): string | null;
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean): void;
  doors(): Show;
  /** What plays: flown boxes and every other speaker set down. */
  fed: Fed;
  dispose(): void;
};

export function arenaView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): ArenaView {
  const g = new THREE.Group();
  const mat = (color: number, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity });
  const slab = (z: Zone, y: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(z.x1 - z.x0, h, z.z1 - z.z0), m);
    mesh.position.set((z.x0 + z.x1) / 2, y + h / 2, (z.z0 + z.z1) / 2);
    g.add(mesh);
  };
  slab(ZONES.stage, 0, 0.012, mat(0x2a1f1a));
  // The bowl: a riser a metre deep per row, each at its seats' height.
  const seat = mat(0x3b4656);
  for (const side of [ZONES["side-l"], ZONES["side-r"]]) for (let x = side.x0; x < side.x1; x++) {
    const h = earAt(x + 0.5, 20) - 1.2;
    slab({ x0: x, x1: x + 1, z0: side.z0, z1: side.z1 }, 0, Math.max(0.05, h), seat);
  }
  for (let z = ZONES.end.z0; z < ZONES.end.z1; z++) slab({ ...ZONES.end, z0: z, z1: z + 1 }, 0, earAt(0, z + 0.5) - 1.2, seat);
  const foh = ZONES.foh, mark = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(foh.x1 - foh.x0, 0.001, foh.z1 - foh.z0)),
    new THREE.LineBasicMaterial({ color: 0xf2c230 }));
  mark.position.set((foh.x0 + foh.x1) / 2, 0.015, (foh.z0 + foh.z1) / 2);
  g.add(mark);
  // The roof steel across the stage end, a motor slung under it at each point, and its chain down to the frame's shackle.
  slab({ x0: -10, x1: 10, z0: 29.3, z1: 31.2 }, STEEL_Y, 0.4, mat(0x7b8088));
  // A frame shows yellow while its hang waits for its check.
  const look = gearLook(), frameMat = mat(0xd24a3a), unchecked = mat(0xf2c230), SLING = 0.25;
  const steel = mat(0x9aa0a8), sling = mat(0x2b2f8a);
  const chains = new Map<string, { chain: THREE.Mesh; frame: THREE.Group; paint: THREE.Mesh; motor: THREE.Group; hook: THREE.Object3D }>();
  const v = new THREE.Vector3();
  for (const p of POINTS) {
    const frame = rigging("flying-frame", { look: { ...look, paint: frameMat } }), motor = rigging("chain-motor", { look });
    frame.position.set(p.x, 0, p.z);
    frame.rotation.y = motor.rotation.y = p.yaw;
    frame.updateMatrixWorld(true);
    // the motor hangs where its chain drops plumb onto the shackle, the sling from the steel to its top hook
    const pick = frame.getObjectByName("pickup")!.getWorldPosition(new THREE.Vector3());
    const out = motor.getObjectByName("chain")!.position.clone().applyAxisAngle(v.set(0, 1, 0), p.yaw);
    motor.position.set(pick.x - out.x, STEEL_Y - SLING - motor.getObjectByName("hang")!.position.y, pick.z - out.z);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, SLING).translate(0, SLING / 2, 0), sling);
    strap.position.set(motor.position.x, STEEL_Y - SLING, motor.position.z);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 5).translate(0, -0.5, 0), steel);
    chain.position.set(pick.x, motor.position.y + motor.getObjectByName("chain")!.position.y, pick.z);
    g.add(motor, strap, chain, frame);
    chains.set(p.key, { chain, frame, paint: frame.getObjectByName("flying-frame-paint") as THREE.Mesh, motor, hook: motor.getObjectByName("part:hook")! });
  }

  // The coverage map: one tile per seat, at the seat, coloured against the target.
  const seats = bowl(getWorld());
  const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }), seats.length);
  const m4 = new THREE.Matrix4(), colour = new THREE.Color();
  seats.forEach((s, k) => { m4.makeTranslation(s.x, Math.max(0.03, s.y - 1.15), s.z); tiles.setMatrixAt(k, m4); });
  tiles.visible = false;
  g.add(tiles);

  const lights = [new THREE.PointLight(0xfff0d8, 400, 60, 1.4), new THREE.PointLight(0xd8e4ff, 300, 60, 1.4)];
  lights[0].position.set(0, 12, 26);
  lights[1].position.set(0, 12, 8);
  g.add(...lights);
  scene.add(g);
  const was = scene.fog;
  scene.fog = new THREE.Fog(0x0d1420, 30, 80);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.appendChild(card);

  let seen = "", last: Score | null = null, full: Score | null = null, opened: Show | null = null;
  const signature = (w: World) => JSON.stringify([w.held?.key, w.items.map((i) => [i.x, i.y, i.z, i.rot]), rig(w), hangsOf(w), !!crowdOf(w)]);
  const people = crowdView(scene, { max: MAX_BIG });

  // The map shows the empty bowl until the doors open, then the bowl with the floor full.
  function paint(w: World) {
    const both = scores(w), now = crowdOf(w) ? both.fullSeats : both.empty;
    now.forEach((s, k) => { const [r, gg, b] = heatColour(s.db, TARGET); tiles.setColorAt(k, colour.setRGB(r / 255, gg / 255, b / 255)); });
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    last = both.soundcheck;
    full = both.full;
    people.moods(crowdState(w, both).regions);
    for (const p of POINTS) {
      const h = hangsOf(w)[p.key], c = chains.get(p.key)!, top = h.boxes.length > 0;
      const y = frameY(h);
      // the frame sits on the top box; the hook runs down the chain to its shackle
      c.frame.position.y = y;
      const bite = y + (c.frame.getObjectByName("pickup")!.position.y), hook = bite + c.motor.userData.bite;
      c.hook.position.y = hook - c.motor.position.y;
      c.chain.scale.y = Math.max(0.01, c.chain.position.y - hook);
      c.paint.material = top && !h.checked && h.trim === null ? unchecked : frameMat;
    }
  }

  const said = (a: Answer, say: (why: string) => void) => { if (!a.ok) say(a.why); return true; };
  const view: ArenaView = {
    heatOn: false,
    setHeat(on) { view.heatOn = on; tiles.visible = on; },
    fed: (w, key) => { const i = w.items.find((o) => o.key === key); return !!i && playing(w, i); },
    key(code, say) {
      const w = getWorld(), p = under(w), far = under(w, CLEAR * 3);
      if (code === "KeyG" && p) return said(w.held ? hang(w, p.key) : unhang(w, p.key), say);
      if (code === "KeyK" && p) { const c = calc(w, p.key)!; return said(pin(w, p.key, c.tilt, c.splays), say); }
      if (code === "KeyI" && p) return said(check(w, p.key), say);
      // O runs the motor of the point nearby: up to its trim, or down to the deck. You have to step clear first.
      if (code === "KeyO" && far) { const h = hangsOf(w)[far.key]; return said(h.trim === null ? fly(w, far.key, h.plan) : land(w, far.key), say); }
      if (code === "KeyU" || code === "KeyJ") {
        const q = p ?? far;
        if (q) return plan(w, q.key, hangsOf(w)[q.key].plan + (code === "KeyU" ? 0.5 : -0.5)), true;
      }
      if (w.held) return false;
      if (code === "KeyH") return view.setHeat(!view.heatOn), true;
      if (code === "BracketLeft" || code === "BracketRight") {
        if (!deskAtFoh(w) || Math.hypot(w.you.x - (foh.x0 + foh.x1) / 2, w.you.z - (foh.z0 + foh.z1) / 2) > 2.5) return say("the fader is on the desk at front of house"), true;
        return master(w, rig(w).master + (code === "BracketLeft" ? -1 : 1)), true;
      }
      if (code === "Enter") return view.doors(), true;
      return aimKey(w, code);
    },
    hint() {
      const w = getWorld(), p = under(w);
      if (!p) return null;
      const h = hangsOf(w)[p.key], held = w.items.find((i) => i.key === w.held?.key);
      if (held?.gear === BOX) return h.trim === null ? `G hang it on the ${p.name} frame` : `the ${p.name} hang is in the air`;
      if (h.trim !== null) return `Step ${CLEAR} m clear, O brings it down`;
      return `${p.name}: G take a box off, K pins from the calculator, I check the point, step clear and O to fly`;
    },
    update() {
      const w = getWorld(), sig = signature(w);
      if (sig !== seen) { seen = sig; paint(w); }
      people.update(w, crowdOf(w));
      const s = last!, p = under(w, CLEAR * 3), db = (v: number | null) => (v === null ? "silent" : `${v.toFixed(0)} dB`);
      const rows = POINTS.map((q) => {
        const h = hangsOf(w)[q.key], kg = loadKg(h), over = kg > q.limitKg;
        const state = h.trim !== null ? `flown ${h.trim.toFixed(1)} m` : h.checked ? "checked" : h.boxes.length ? "not checked" : "empty";
        return `<span class="${over ? "warn" : ""}">${q.name}: ${h.boxes.length} box, ${kg} / ${q.limitKg} kg, ${state}</span>`;
      }).join("");
      const c = p && calc(w, p.key);
      const parts = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => `${k} ${db(s.level[k])} ${Math.round(s.covered[k] * 100)}%`).join(", ");
      card.innerHTML = `<b>${opened ? "Doors open" : "Small arena"}</b>` + rows
        + (c ? `<span>Calculator, ${p.name} at ${c.trim} m: top ${c.tilt}, pins ${c.splays.join(" ") || "none"}</span>` : "")
        + `<span>${parts} (target ${TARGET})</span>`
        + `<span>Floor full: front ${Math.round(full!.covered.front * 100)}%, floor ${Math.round(full!.covered.floor * 100)}%, score ${full!.score}${crowdOf(w) ? `, ${crowdOf(w)!.people} in` : ""}</span>`
        + `<span class="${s.desk ? "" : "warn"}">${s.desk ? "Desk at front of house" : "The desk goes out at front of house"}, fader ${rig(w).master} dB</span>`
        + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass</span><span>Sound ${opened.sound}, crowd mood ${opened.mood}</span><span>Paid $${opened.pay} of $${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>Under a point: G hang, K pins, I check; clear: O motor, U / J trim. H map, [ ] fader at the desk, Enter doors</small>`;
    },
    doors() {
      const w = getWorld();
      if (!crowdOf(w)) letIn(w, CROWD);
      view.update();
      return (opened = show(w));
    },
    dispose() { people.dispose(); scene.remove(g); scene.fog = was; card.remove(); },
  };
  return view;
}
