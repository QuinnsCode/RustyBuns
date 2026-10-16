// Which level the page rides (`?level=` or the menu), and the level's side of the HUD: the menu, the
// goal list, the pickups. main.ts asks for the chosen level and calls `ui.update` each frame.
import { Check, Circle, createElement } from "lucide";
import { Fog, type Scene } from "three";
import type { Level } from "../level.ts";
import type { Mode, State } from "../sim.ts";
import "./levels.css";
import { groundMesh, props } from "./ground.ts";
import { trackRun, type Run } from "./goals.ts";
import { LEVELS } from "./index.ts";
import type { Goal, ParkLevel } from "./park.ts";

const entry = LEVELS.find((l) => l.id === new URLSearchParams(location.search).get("level")) ?? LEVELS[0]!;
export const level: Level | ParkLevel = entry.load();
export const park = "goals" in level;

/** Where a ride starts: the spawn named for the mode, else the first. */
export function spawn(l: Level, mode: Mode) {
  return l.spawns.find((s) => s.name === mode) ?? l.spawns[0]!;
}

const label = (g: Goal) => g.kind === "score" ? `Score ${g.target.toLocaleString("en-US")}` : g.kind === "combo" ? `Combo ${g.target.toLocaleString("en-US")}` : g.kind === "gap" ? `Gap: ${g.name}` : g.kind === "climb" ? `Climb ${g.name}: ${g.metres} m` : "Collect the rings";

export function mountLevelUi(scene: Scene) {
  const menu = document.createElement("select");
  menu.className = "level-menu";
  menu.title = "Level";
  for (const l of LEVELS) menu.add(new Option(l.name, l.id, false, l.id === entry.id));
  menu.addEventListener("change", () => { location.search = `?level=${menu.value}`; });
  document.body.append(menu);
  if (!park) return { reset() {}, update(_s: State) {} };

  const p = level as ParkLevel, rings = props(p);
  scene.add(groundMesh(p), rings.group);
  if (scene.fog instanceof Fog) { scene.fog.near = 120; scene.fog.far = 420; } // the park is a few hundred metres across
  const panel = document.createElement("ul");
  panel.className = "goals";
  document.body.append(panel);
  const rows = p.goals.map((g) => {
    const li = document.createElement("li"), mark = document.createElement("span"), text = document.createElement("span"), prog = document.createElement("small");
    li.append(mark, text, prog);
    text.textContent = label(g);
    panel.append(li);
    return { g, li, mark, prog };
  });
  let run: Run = trackRun(p), last: State | null = null, shown = "";
  const draw = () => {
    const sig = rows.map((r) => run.progress(r.g)).join("|") + run.collected.size;
    if (sig === shown) return;
    shown = sig;
    for (const r of rows) {
      const done = run.done(r.g);
      r.li.classList.toggle("done", done);
      r.mark.replaceChildren(createElement(done ? Check : Circle, { width: 14, height: 14 }));
      r.prog.textContent = last ? run.progress(r.g) : "";
    }
    rings.pickups.forEach((m, i) => { m.visible = !run.collected.has(i); });
  };
  draw();
  return {
    reset() { run = trackRun(p); last = null; shown = ""; draw(); },
    update(s: State) {
      last = s;
      run.update(s);
      draw();
      rings.pickups.forEach((m) => { m.rotation.y += 0.04; });
    },
  };
}
