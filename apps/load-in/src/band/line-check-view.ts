// Line check on the page: the stage riser, the snake's multicore lying from the desk to the stage box, and the
// clipboard card (the input list, each row's last line-check result). Keys: L runs line check at the desk, T traces the
// input you look at, G flips the ground lift on the DI you look at. main.ts calls `lineCheckView` once per world.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import { aimed, type World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import { INPUT_LIST, type Checked, type Show, atDesk, lift, newShow, runCheck, snakeRun, trace } from "./line-check.ts";

export type LineCheckView = {
  /** A key while playing; the text to flash when line check used it, else null. */
  key(code: string): string | null;
  /** Each frame: the snake follows the stage box, the card follows the last check. */
  tick(): void;
  /** Run line check (at the desk), trace an input, lift a DI, or start a new night. */
  check(): ReturnType<typeof runCheck>;
  trace(input: string): ReturnType<typeof trace>;
  lift(key: string): ReturnType<typeof lift>;
  night(seed: number | "clean"): void;
  /** What the harness adds: the snake, the clipboard and the last check's rows. */
  state(): { snake: boolean; rows: Checked[] | null; clean: boolean | null; lifted: string[] };
  /** The hint line at the desk or by an input, or null. */
  hint(): string | null;
  dispose(): void;
};

export function lineCheckView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables, seed: number | "clean"): LineCheckView {
  let show: Show = newShow(seed), last: { rows: Checked[]; clean: boolean } | null = null;
  const group = new THREE.Group();
  const stage = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.02, 3.2), new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.8 }));
  stage.position.set(0, 0.01, 1.6);
  const snake = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x15171a }));
  group.add(stage, snake);
  scene.add(group);
  const card = document.createElement("div");
  card.className = "bar-card";
  hud.append(card);
  let html = "";

  const inputs = new Set(INPUT_LIST.map((r) => r.input));
  const say = (a: { ok: true } | { ok: false; why: string }, yes: string) => (a.ok ? yes : a.why);
  const view: LineCheckView = {
    key(code) {
      const w = getWorld(), at = aimed(w);
      if (code === "KeyL") { const r = view.check(); return r.ok ? (r.clean ? "Line check clean: ready for doors" : "Line check: see the clipboard") : r.why; }
      if (code === "KeyT" && at && inputs.has(at.key)) { const r = view.trace(at.key); return r.ok ? r.path.join(" > ") : r.why; }
      if (code === "KeyG" && at?.gear === "di-box") return say(view.lift(at.key), show.lifted.has(at.key) ? "Ground lifted" : "Ground on");
      return null;
    },
    check() {
      const r = runCheck(getWorld(), getCables(), show);
      if (r.ok) last = { rows: r.rows, clean: r.clean };
      return r;
    },
    trace: (input) => trace(getWorld(), getCables(), input),
    lift: (key) => lift(getWorld(), show, key),
    night(s) { show = newShow(s); last = null; },
    state: () => ({ snake: snakeRun(getWorld()), rows: last?.rows ?? null, clean: last?.clean ?? null, lifted: [...show.lifted] }),
    hint() {
      const w = getWorld(), at = aimed(w);
      if (atDesk(w) && !w.held) return "L line check: each player plays alone";
      if (at?.gear === "di-box") return `T trace it, G ground lift ${show.lifted.has(at.key) ? "on" : "off"}, F pick it up`;
      if (at && inputs.has(at.key) && !w.held) return "T trace its cable, F pick it up";
      return null;
    },
    tick() {
      const w = getWorld(), desk = w.items.find((i) => i.key === "mixer"), box = w.items.find((i) => i.key === "stage-box");
      if (desk && box) snake.geometry.setFromPoints([new THREE.Vector3(desk.x, 0.01, desk.z - 0.2), new THREE.Vector3((desk.x + box.x) / 2, 0.01, (desk.z + box.z) / 2), new THREE.Vector3(box.x, 0.05, box.z)]);
      const result = (ch: number) => {
        const row = last?.rows.find((r) => r.ch === ch);
        if (!row) return "";
        const where = row.result === "wrong channel" ? ` (on ${row.heard.map((h) => h.ch).join(", ")})` : "";
        return row.result === "ok" ? ' <span class="pass">ok</span>' : ` <span class="warn">${esc(row.result + where)}</span>`;
      };
      const lines = [
        "<b>Input list</b>",
        ...INPUT_LIST.map((r) => `${r.ch} ${esc(r.name)}${result(r.ch)}`),
        `Snake ${snakeRun(w) ? "run" : "<small>stage box to the stage</small>"}`,
        last?.clean ? '<span class="pass">Clean: ready for doors</span>' : "",
      ];
      const next = lines.filter(Boolean).map((l) => `<div>${l}</div>`).join("");
      if (next !== html) card.innerHTML = html = next;
    },
    dispose() { scene.remove(group); card.remove(); },
  };
  return view;
}
