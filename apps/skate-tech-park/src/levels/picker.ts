// Which level the page rides (`?level=` or the menu), and the level's side of the HUD: the menu, the
// goal list, the pickups. main.ts asks for the chosen level and calls `ui.update` each frame.
import { Check, ChevronRight, Circle, createElement, Mountain, Play, Users } from "lucide";
import { Fog, type Scene } from "three";
import type { Level } from "../level.ts";
import type { State } from "../sim.ts";
import "./levels.css";
import { groundMesh, props } from "./ground.ts";
import { trackRun, type Run } from "./goals.ts";
import { LEVELS, needsStartScreen, pick, tourPick, wantsReal } from "./index.ts";
import { newRoomCode } from "../net/client.ts";
import { terrainCanvas } from "./thumb.ts";
import type { Goal, ParkLevel } from "./park.ts";
import { moodFor } from "../render/weather.ts";

/** True on the home page: no level asked for, so the camera tours a park instead of a rider riding it. */
export const touring = needsStartScreen(location.search);
const entry = touring ? tourPick(location.search) : pick(location.search);
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
const to = (id: string) => `?level=${id}${real ? "&real" : ""}`;

/** The home page: the camera flies over a park (main.ts) behind a few rounded panels: what this is, a way in, and a card per park. */
function homePage() {
  document.body.classList.add("home");
  const icon = (n: Parameters<typeof createElement>[0]) => createElement(n, { width: 18, height: 18 });
  const pill = (cls: string, node: Parameters<typeof createElement>[0], text: string, go: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pill ${cls}`;
    b.append(icon(node), text);
    b.addEventListener("click", go);
    return b;
  };
  const hero = document.createElement("section");
  hero.className = "panel hero";
  const title = document.createElement("h1"), pitch = document.createElement("p"), now = document.createElement("p"), row = document.createElement("div");
  title.textContent = "Skate Tech Park";
  pitch.textContent = "A giant fingerboard on the real hills of Yosemite. One board, one physics: every flip, grind and bail is real, and up to four friends can ride the same park.";
  now.className = "now";
  now.append("Flying over ", Object.assign(document.createElement("strong"), { textContent: entry.name }), `. ${entry.blurb}`);
  const next = LEVELS.filter((l) => l.id !== "plaza"), after = next[(next.findIndex((l) => l.id === entry.id) + 1) % next.length]!;
  row.className = "row";
  const nextBtn = pill("quiet", ChevronRight, "Next park", () => { location.search = `?tour=${after.id}`; });
  nextBtn.title = `Next park: ${after.name}`;
  row.append(pill("go", Play, "Ride", () => { location.search = to(entry.id); }), pill("", Users, "With friends", () => { location.search = `${to(entry.id)}&room=${newRoomCode()}`; }), nextBtn);
  hero.append(title, pitch, now, row);

  const parks = document.createElement("section");
  parks.className = "panel parks";
  for (const l of LEVELS) {
    const card = document.createElement("button"), name = document.createElement("strong"), thumb = document.createElement("div");
    card.type = "button";
    card.title = l.blurb;
    card.className = l.id === entry.id ? "card here" : "card";
    thumb.className = "thumb";
    name.textContent = l.name;
    card.append(thumb, name);
    setTimeout(() => thumb.append(terrainCanvas(l.load())), 0); // one map per tick so the cards fill in without freezing the page
    card.addEventListener("click", () => { location.search = to(l.id); });
    parks.append(card);
  }
  const wrap = document.createElement("div");
  wrap.className = "home-ui";
  wrap.append(hero, parks);
  document.body.append(wrap);
}

export function mountLevelUi(scene: Scene) {
  if (touring) homePage();
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
  toggle.addEventListener("click", () => { location.search = `?level=${entry.id}${real ? "" : "&real"}`; });
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
