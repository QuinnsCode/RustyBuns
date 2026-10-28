// The scenarios page: pick a park, a quality tier, phone or desktop controls, a start and a weak-machine burn, and get
// one link that lands there. Below, the manual-run checks as ready links and every park one tap away.
import { LEVELS } from "./levels/index.ts";
import { CONTROLS, linkOf, type Link, SPOTS } from "./scenario.ts";

const parks = LEVELS.filter((l) => l.id !== "plaza");
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string | boolean> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

/** The checks this page serves: each is a link that drops the rider where the check starts. */
export const CHECKS: { issue: number; title: string; links: { label: string; link: Link }[] }[] = [
  { issue: 2535, title: "Weak computer and the quality tier", links: [
    { label: "Forced low tier", link: { level: "el-capitan", quality: "low", fps: true } },
    { label: "Simulated weak GPU, starting on high (watch it step down)", link: { level: "el-capitan", quality: "high", weak: true } },
    { label: "Back to guessing from the GPU", link: { level: "el-capitan", quality: "auto", fps: true } },
  ] },
  { issue: 2486, title: "Retuned rounds 2 and 3", links: [
    { label: "Push from standing, El Capitan", link: { level: "el-capitan", fps: true } },
    { label: "Halfpipe wall, Yosemite Falls", link: { level: "yosemite-falls", spawn: "vert" } },
    { label: "Boosted gap, Death Valley", link: { level: "death-valley" } },
  ] },
  { issue: 2401, title: "Grinds, balance and vert", links: [
    { label: "Rail, El Capitan", link: { level: "el-capitan", spawn: "rail" } },
    { label: "Longest gentle bar to balance on, El Capitan", link: { level: "el-capitan", spawn: "balance" } },
    { label: "Vert wall, Yosemite Falls", link: { level: "yosemite-falls", spawn: "vert" } },
  ] },
  { issue: 2317, title: "Phone flick pad (on a desktop window, mouse stands in for a thumb)", links: [
    { label: "Touch controls, El Capitan", link: { level: "el-capitan", controls: "touch" } },
    { label: "Touch controls at a rail", link: { level: "el-capitan", controls: "touch", spawn: "rail" } },
  ] },
];

const link = (l: Link, label: string) => el("a", { href: linkOf(l), className: "go", textContent: label });

function builder() {
  const choose = (name: string, values: string[], label: string) => {
    const s = el("select", { name });
    s.append(...values.map((v) => new Option(v || "(default)", v)));
    return el("label", {}, label, s);
  };
  const park = choose("level", parks.map((p) => p.id), "Park"), start = choose("spawn", ["", ...SPOTS], "Start");
  const quality = choose("quality", ["", "low", "mid", "high", "auto"], "Quality"), controls = choose("controls", ["", ...CONTROLS], "Controls");
  const weak = el("input", { type: "number", name: "weak", min: "0", max: "200", placeholder: "0", value: "" });
  const fps = el("input", { type: "checkbox", name: "fps" });
  const out = el("code"), go = el("a", { className: "go", textContent: "Ride" });
  const sel = (label: HTMLElement) => label.querySelector("select")!.value;
  const update = () => {
    const href = linkOf({ level: sel(park), ...(sel(start) ? { spawn: sel(start) } : {}), ...(sel(quality) ? { quality: sel(quality) as Link["quality"] } : {}),
      ...(sel(controls) ? { controls: sel(controls) as Link["controls"] } : {}), ...(Number(weak.value) > 0 ? { weak: Number(weak.value) } : {}), ...(fps.checked ? { fps: true } : {}) });
    go.href = href; out.textContent = href;
  };
  const sec = el("section", {}, el("h2", { textContent: "Build a link" }), el("div", { className: "row" }, park, start, quality, controls,
    el("label", {}, "Weak, ms per frame", weak), el("label", {}, fps, "Frame readout"), go), out);
  sec.addEventListener("input", update);
  update();
  return sec;
}

const app = document.getElementById("app")!;
app.append(
  el("h1", { textContent: "Skate Tech Park scenarios" }),
  builder(),
  el("section", {}, el("h2", { textContent: "Manual-run checks" }), el("div", { className: "cards" }, ...CHECKS.map((c) =>
    el("div", { className: "card" }, el("strong", { textContent: `#${c.issue} ${c.title}` }), el("div", { className: "row" }, ...c.links.map((l) => link(l.link, l.label))))))),
  el("section", {}, el("h2", { textContent: `All ${parks.length} parks` }), el("ul", { className: "parks" }, ...parks.map((p) =>
    el("li", {}, el("a", { href: linkOf({ level: p.id }), textContent: p.name }))))),
);
