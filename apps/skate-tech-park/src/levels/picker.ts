// Which level the page rides (`?level=` or the menu), and the level's side of the HUD: the menu, the
// goal list, the pickups. main.ts asks for the chosen level and calls `ui.update` each frame.
import { Check, Circle, createElement, MapPin, Mountain } from "lucide";
import { Fog, type Scene } from "three";
import type { Level } from "../level.ts";
import type { State } from "../sim.ts";
import "./levels.css";
import { groundMesh, props } from "./ground.ts";
import { trackRun, type Run } from "./goals.ts";
import { carry } from "../front/menu.ts";
import { LEVELS, needsStartScreen, pick, wantsReal } from "./index.ts";
import { terrainCanvas } from "./thumb.ts";
import type { Goal, ParkLevel } from "./park.ts";
import { moodFor } from "../render/weather.ts";

const entry = pick(location.search);
export const levelId = entry.id;
export const level: Level | ParkLevel = entry.load(wantsReal(location.search));
export const park = "goals" in level;
/** The air over this level: its own weather, or `?weather=` (rain, snow, storm, dusk...). */
export const mood = moodFor(location.search, park ? (level as ParkLevel).weather : undefined);

/** Where a ride starts: the spawn named "skate", else the first. The skin never moves the start. */
export function spawn(l: Level) {
  return l.spawns.find((s) => s.name === "skate") ?? l.spawns[0]!;
}

const label = (g: Goal) => g.kind === "score" ? `Score ${g.target.toLocaleString("en-US")}` : g.kind === "combo" ? `Combo ${g.target.toLocaleString("en-US")}` : g.kind === "gap" ? `Gap: ${g.name}` : g.kind === "line" ? `Line: ${g.name}` : g.kind === "climb" ? `Climb ${g.name}: ${g.metres} m` : "Collect the rings";

const real = wantsReal(location.search);
/** A link target for a level, keeping the real-height choice. */
const to = (id: string, height = real) => `?${new URLSearchParams({ level: id, ...Object.fromEntries(carry(location.search)) })}${height ? "&real" : ""}`;

/** The start screen: one card per level; choosing one reloads the page on it. */
function startScreen() {
  const wrap = document.createElement("div");
  wrap.className = "start";
  const title = document.createElement("h1");
  title.textContent = "Pick a park";
  const grid = document.createElement("div");
  grid.className = "start-grid";
  for (const l of LEVELS) {
    const card = document.createElement("button"), name = document.createElement("strong"), blurb = document.createElement("span");
    card.type = "button";
    name.append(createElement(MapPin, { width: 16, height: 16 }), l.name);
    blurb.textContent = l.blurb;
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    card.append(thumb, name, blurb);
    setTimeout(() => thumb.append(terrainCanvas(l.load())), 0); // one map per tick so the cards fill in without freezing the page
    // Parallax: the map tilts and slides against the pointer, the card's text stays put.
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      thumb.style.setProperty("--tx", `${(-x * 14).toFixed(1)}px`);
      thumb.style.setProperty("--ty", `${(-y * 10).toFixed(1)}px`);
      thumb.style.setProperty("--rx", `${(-y * 10).toFixed(1)}deg`);
      thumb.style.setProperty("--ry", `${(x * 12).toFixed(1)}deg`);
    });
    card.addEventListener("pointerleave", () => { for (const v of ["--tx", "--ty", "--rx", "--ry"]) thumb.style.removeProperty(v); });
    card.addEventListener("click", () => { location.search = to(l.id); });
    grid.append(card);
  }
  wrap.append(title, grid);
  document.body.append(wrap);
  wrap.querySelector("button")?.focus();
}

export function mountLevelUi(scene: Scene) {
  if (needsStartScreen(location.search)) startScreen();
  const menu = document.createElement("select");
  menu.className = "level-menu";
  menu.title = "Level";
  for (const l of LEVELS) menu.add(new Option(l.name, l.id, false, l.id === entry.id));
  menu.addEventListener("change", () => { location.search = to(menu.value); });
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "level-menu";
  toggle.title = real ? "Real height: on (click for friendly height)" : "Friendly height (click for real height)";
  toggle.setAttribute("aria-pressed", String(real));
  toggle.append(createElement(Mountain, { width: 16, height: 16 }));
  toggle.addEventListener("click", () => { location.search = to(entry.id, !real); });
  document.body.append(menu, toggle);
  if (!park) return { reset() {}, update(_s: State) {} };

  const p = level as ParkLevel, rings = props(p);
  scene.add(groundMesh(p, mood), rings.group);
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
