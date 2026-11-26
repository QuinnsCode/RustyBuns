// The first gig on the page: the low stage, a mark where the desk goes, and a card of the jobs in order with what the
// singer hears. main.ts calls `firstGigView` once per world, then `key`, `tick` each frame (which judges the cables
// through first-gig.ts), and `fed` / `rig` for what you hear. V at the desk switches its 48 V phantom.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { CROWD, PASS, TARGET, ZONES, type Judged, type Show, gig, jobs, judge, phantom, runsOf, show } from "./first-gig.ts";
import { crowdOf, letIn } from "../crowd/crowd.ts";
import { crowdView } from "../crowd/crowd-view.ts";
import { REACH, type World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import type { Fed, Rig, Switches } from "../audio/hear.ts";

export type FirstGigView = {
  /** A key while playing; true when the first gig used it (V at the desk: 48 V, Enter: doors). */
  key(code: string): boolean;
  tick(): Judged;
  fed(): Fed;
  rig(): Rig;
  /** Switch the desk's 48 V. */
  phantom(on: boolean): void;
  doors(): Show;
  hint(): string | null;
  dispose(): void;
};

export function firstGigView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables, getOn: () => Switches): FirstGigView {
  const runs = () => runsOf(getWorld(), getCables());
  let j = judge(getWorld(), runs(), getOn());
  const group = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const s = ZONES.stage, d = ZONES.desk;
  // A low riser: drawn thin, as the bigger bar's is, so the floor sim stays flat.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, 0.03, s.z1 - s.z0), mat(0x2b2420));
  stage.position.set((s.x0 + s.x1) / 2, 0.015, (s.z0 + s.z1) / 2);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0), new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.25 }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set((d.x0 + d.x1) / 2, 0.004, (d.z0 + d.z1) / 2);
  group.add(stage, mark);
  scene.add(group);
  // Who comes at doors.
  const people = crowdView(scene);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.append(card);
  let last = "", opened: Show | null = null, humming = false, ctx: AudioContext | null = null;
  // The mic's cable along a power cord: a second of mains hum through the wedge when it starts (60 Hz and its harmonics).
  const hum = () => {
    const a = (ctx ??= new AudioContext()), t = a.currentTime;
    for (const hz of [60, 120, 180]) {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.12 * (60 / hz), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 1);
    }
  };
  const atDesk = () => {
    const w = getWorld(), desk = w.items.find((i) => i.gear === "mixer-small");
    return !!desk && desk.key !== w.held?.key && Math.hypot(w.you.x - desk.x, w.you.z - desk.z) <= REACH;
  };

  const view: FirstGigView = {
    key(code) {
      if (code === "Enter") return view.doors(), true;
      if (code !== "KeyV" || !atDesk()) return false;
      phantom(getWorld(), !gig(getWorld()).phantom);
      return true;
    },
    fed: () => (_w, key) => key === getWorld().items.find((i) => i.gear === "wedge-12-passive")?.key && j.fed,
    rig: () => ({ lossDb: Object.fromEntries(getWorld().items.filter((i) => i.gear === "wedge-12-passive").map((i) => [i.key, j.lossDb])) }),
    phantom: (on) => phantom(getWorld(), on),
    tick() {
      const w = getWorld(), r = runs();
      people.update(w, crowdOf(w));
      j = judge(w, r, getOn());
      const hums = j.fed && j.problems.some((p) => p.kind === "hum");
      if (hums && !humming) hum();
      humming = hums;
      const list = jobs(w, r, getOn(), j);
      const lines = [
        `<b>${opened ? "Doors open" : "First gig"}</b>`,
        ...list.map((x) => `<span class="${x.done ? "pass" : ""}">${x.done ? "[x]" : "[ ]"} ${esc(x.job)}</span>`),
        crowdOf(w) ? `${crowdOf(w)!.people} in the room` : "",
        j.atHead === null ? "" : `At the singer's head ${Math.round(j.atHead)} dB (wants ${TARGET})`,
        j.problems[0] ? `<small class="trip">${esc(j.problems[0].message)}</small>` : "",
        opened ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass, paid $${opened.pay} of $${opened.fee}</span>` : "<small>V 48 V at the desk, Enter doors</small>",
      ];
      const html = lines.filter(Boolean).map((l) => `<div>${l}</div>`).join("");
      if (html !== last) card.innerHTML = last = html;
      return j;
    },
    doors: () => {
      opened = show(getWorld(), runs(), getOn());
      // Doors: the room fills, from the stage lip back.
      if (!crowdOf(getWorld())) letIn(getWorld(), CROWD);
      return opened;
    },
    hint: () => (atDesk() ? `V 48 V phantom (${gig(getWorld()).phantom ? "on" : "off"})` : null),
    dispose() {
      people.dispose();
      void ctx?.close();
      scene.remove(group);
      card.remove();
    },
  };
  return view;
}
