// Which level the page rides (`?level=` or the menu), and the level's side of the HUD: the menu, the
// goal list, the pickups. main.ts asks for the chosen level and calls `ui.update` each frame.
import { Check, ChevronRight, Circle, createElement, LayoutGrid, Mountain, Play, Snowflake, Sun, TreePine, Waves, Wheat } from "lucide";
import { Fog, type Scene } from "three";
import type { Level } from "../level.ts";
import type { State } from "../sim.ts";
import "./levels.css";
import { groundMesh, props } from "./ground.ts";
import { trackRun, type Run } from "./goals.ts";
import { carry } from "../front/menu.ts";
import { LEVELS, needsStartScreen, pick, tourPick, touring, wantsReal, type Entry } from "./index.ts";
import { REGIONS, type Region } from "./parks.ts";
import { terrainCanvas } from "./thumb.ts";
import type { Goal, ParkLevel } from "./park.ts";
import { moodFor } from "../render/weather.ts";

const entry = touring(location.search) ? tourPick(location.search) : pick(location.search);
export const levelId = entry.id;
export const level: Level | ParkLevel = await entry.load(wantsReal(location.search));
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

/** The home page: the camera flies over a park (main.ts) behind a few rounded panels: what this is, a way in, and a card per park. */
function homePage() {
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
  pitch.textContent = "A giant fingerboard on the real hills of Yosemite. One board, one physics: every flip, grind and bail is real, and friends can ride the same park.";
  now.className = "now";
  now.append("Flying over ", Object.assign(document.createElement("strong"), { textContent: entry.name }), `. ${entry.blurb}`);
  const next = LEVELS.filter((l) => l.id !== "plaza"), after = next[(next.findIndex((l) => l.id === entry.id) + 1) % next.length]!;
  row.className = "row";
  const nextBtn = pill("quiet", ChevronRight, "Next park", () => { location.search = `?${new URLSearchParams({ tour: after.id, ...Object.fromEntries(carry(location.search)) })}`; });
  nextBtn.title = `Next park: ${after.name}`;
  row.append(pill("go", Play, "Ride", () => { location.search = to(entry.id); }), nextBtn);
  hero.append(title, pitch, now, row);

  const parks = document.createElement("section");
  parks.className = "panel parks";
  const strip = document.createElement("nav"), cards = document.createElement("div");
  strip.className = "regions";
  cards.className = "cards";
  // A card paints its map when it first scrolls into view, one level built per tick, so seventy cards do not freeze the page.
  const queue: (() => void)[] = [];
  let busy = false;
  const drain = () => { const job = queue.shift(); if (!job) { busy = false; return; } busy = true; job(); setTimeout(drain, 0); };
  const seen = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((hits) => {
    for (const h of hits) if (h.isIntersecting) { seen!.unobserve(h.target); (h.target as HTMLElement & { paint?: () => void }).paint?.(); }
  }, { root: cards, rootMargin: "0px 240px 0px 240px" });
  const card = (l: Entry) => {
    const c = document.createElement("button") as HTMLButtonElement & { paint?: () => void }, name = document.createElement("strong"), thumb = document.createElement("div");
    c.type = "button";
    c.title = l.blurb;
    c.className = l.id === entry.id ? "card here" : "card";
    thumb.className = "thumb";
    name.textContent = l.name;
    c.append(thumb, name);
    let painted = false;
    c.paint = () => { if (painted) return; painted = true; queue.push(() => void l.load().then((built) => thumb.append(terrainCanvas(built)))); if (!busy) drain(); };
    c.addEventListener("click", () => { location.search = to(l.id); });
    return c;
  };
  const built = LEVELS.map((l) => ({ l, node: card(l) }));
  const icons: Record<"All" | Region, Parameters<typeof createElement>[0]> = { All: LayoutGrid, "West Coast": Waves, Southwest: Sun, Rockies: Mountain, "Plains & Midwest": Wheat, "East & Florida": TreePine, "Alaska & Islands": Snowflake };
  const show = (pick: "All" | Region) => {
    const groups = pick === "All" ? REGIONS : [pick];
    const nodes: Node[] = [];
    for (const r of groups) {
      const here = built.filter((b) => b.l.region === r);
      if (!here.length) continue;
      const head = document.createElement("h2");
      head.textContent = r;
      nodes.push(head, ...here.map((b) => b.node));
    }
    if (pick === "All") nodes.unshift(...built.filter((b) => !b.l.region).map((b) => b.node));
    cards.replaceChildren(...nodes);
    cards.scrollLeft = 0;
    for (const b of built) if (nodes.includes(b.node)) seen ? seen.observe(b.node) : (b.node as HTMLElement & { paint?: () => void }).paint?.();
    for (const b of strip.children) b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.region === pick));
  };
  for (const r of ["All", ...REGIONS] as const) {
    const b = document.createElement("button"), n = built.filter((x) => r === "All" || x.l.region === r).length;
    b.type = "button";
    b.className = "region";
    b.dataset.region = r;
    b.title = `${r} (${n})`;
    b.setAttribute("aria-label", `${r}, ${n} parks`);
    b.append(createElement(icons[r], { width: 18, height: 18 }));
    b.addEventListener("click", () => show(r));
    strip.append(b);
  }
  parks.append(strip, cards);
  show("All");
  const wrap = document.createElement("div");
  wrap.className = "home-ui";
  wrap.append(hero, parks);
  document.body.append(wrap);
}

export function mountLevelUi(scene: Scene) {
  if (touring(location.search)) document.body.classList.add("home"); // no rider: the game's own HUD stays hidden
  if (needsStartScreen(location.search)) homePage();
  const menu = document.createElement("select");
  menu.className = "level-menu";
  menu.title = "Level";
  for (const l of LEVELS.filter((x) => !x.region)) menu.add(new Option(l.name, l.id, false, l.id === entry.id));
  for (const r of REGIONS) {
    const group = document.createElement("optgroup");
    group.label = r;
    for (const l of LEVELS.filter((x) => x.region === r)) group.append(new Option(l.name, l.id, false, l.id === entry.id));
    if (group.children.length) menu.append(group);
  }
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
