// The bigger bar on the page: the stage riser, the bar counter, the breaker panel on the right wall with a lamp per
// circuit, and a card naming each circuit and what is fed. main.ts calls `biggerBarView` once per world, then `key`,
// `tick` each frame (which judges the cables through bigger-bar.ts), and `fed` / `rig` for what you hear.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { BIGGER_BAR, PANEL, PASS, type Judged, atPanel, fedByJudge, judgeCables, newPanel, resetBreaker, show } from "./bigger-bar.ts";
import type { Answer, World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import type { Fed, Rig } from "../audio/hear.ts";

export type BiggerBarView = {
  /** A key while playing; true when the bigger bar used it (B resets the breakers at the panel). */
  key(code: string): boolean;
  /** Each frame: judge the cables (tripping what is over), then the panel lamps and the card follow. */
  tick(): Judged;
  /** Who plays, from the last judgement. */
  fed(): Fed;
  /** Each passive speaker's cable loss, for what you hear. */
  rig(): Rig;
  /** Reset a breaker (or all of them) at the panel. */
  reset(circuit?: string): Answer;
  /** What the harness adds: the circuits, what tripped, the problems and the cable losses. */
  state(): { circuits: Judged["circuits"]; fed: Record<string, boolean>; problems: string[]; lossDb: Record<string, number> };
  /** Enter: open the doors on the rig as it stands; the show. */
  doors(): ReturnType<typeof show>;
  /** What the hint line says at the panel, or null away from it. */
  hint(): string | null;
  dispose(): void;
};

export function biggerBarView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables): BiggerBarView {
  const panel = newPanel();
  let j: Judged = judgeCables(getWorld(), getCables(), panel);
  const group = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const stage = new THREE.Mesh(new THREE.BoxGeometry(6, 0.02, 3), mat(0x2a2522));
  stage.position.set(0, 0.01, 1.5);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 6), mat(0x4a3424));
  counter.position.set(-3.6, 0.525, 6);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.45), mat(0x8c939b));
  box.position.set(PANEL.x, PANEL.y, PANEL.z);
  group.add(stage, counter, box);
  const circuits = [...new Set(BIGGER_BAR.outlets.map((o) => o.circuit ?? BIGGER_BAR.name))];
  const lamps = circuits.map((_, i) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.07), new THREE.MeshBasicMaterial({ color: 0x3ad16b }));
    lamp.position.set(PANEL.x - 0.04, PANEL.y + 0.18 - i * 0.12, PANEL.z);
    group.add(lamp);
    return lamp;
  });
  scene.add(group);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.append(card);
  let last = "", opened: ReturnType<typeof show> | null = null;

  const view: BiggerBarView = {
    key(code) {
      if (code === "Enter") return view.doors(), true;
      if (code !== "KeyB" || !atPanel(getWorld())) return false;
      resetBreaker(getWorld(), panel);
      return true;
    },
    fed: () => fedByJudge(j),
    rig: () => ({ lossDb: j.lossDb }),
    reset: (circuit) => resetBreaker(getWorld(), panel, circuit),
    state: () => ({ circuits: j.circuits, fed: Object.fromEntries(j.fed), problems: j.problems.map((p) => p.message), lossDb: j.lossDb }),
    tick() {
      j = judgeCables(getWorld(), getCables(), panel);
      circuits.forEach((c, i) => lamps[i]!.material.color.setHex(panel.tripped.has(c) ? 0xd1453a : 0x3ad16b));
      const fed = [...j.fed].filter(([, on]) => on).length;
      const lines = [
        `<b>${opened ? "Doors open" : "Bigger bar"}</b>`,
        ...j.circuits.map((c) => `Circuit ${c.circuit} (${c.amps} A) ${c.tripped ? '<span class="trip">tripped</span>' : c.over ? '<span class="trip">overloaded</span>' : "on"}`),
        `Speakers fed ${fed} / ${j.fed.size}`,
        j.problems[0] ? `<small>${esc(j.problems[0].message)}</small>` : "",
        opened ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass, paid $${opened.pay} of $${opened.fee}</span>` : "<small>B reset the breakers at the panel, Enter doors</small>",
      ];
      const html = lines.filter(Boolean).map((l) => `<div>${l}</div>`).join("");
      if (html !== last) card.innerHTML = last = html;
      return j;
    },
    doors() {
      j = judgeCables(getWorld(), getCables(), panel);
      return (opened = show(getWorld(), j));
    },
    hint() {
      if (!atPanel(getWorld())) return null;
      return panel.tripped.size ? `B reset the breakers (circuit ${[...panel.tripped].join(", ")} tripped)` : "Breaker panel: every circuit on";
    },
    dispose() {
      scene.remove(group);
      card.remove();
    },
  };
  return view;
}
