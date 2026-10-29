// The demo stage's page. The office's own page scripts do the real drawing and talking: the setup cards, the GitHub
// writes card, the ask card, Ester's badge and the wall screens each add themselves to the page the way they do in
// the office. This file only gives them a stage: a stub Settings panel to sit in, the wall's screens on flat canvases,
// the fake workers, and the controls that stand in for a person at github.com or a worker at a keyboard.
import { Hammer, Plug, createElement, type IconNode } from "lucide";
import "../asks/index.ts";
import "../ester/index.ts";
import "../sandbox/page.ts";
import "../setup/page.ts";
import { SIZE, paint, press } from "../screens/index.ts";
import { fromHash } from "./scenarios.ts";
import { SCREENS, type Screen } from "../screens/read.ts";

interface State {
  scenario: string; about: string; serves: number[]; scenarios: Record<string, { about: string; serves: number[] }>;
  workers: { name: string; state: string; task: string }[]; log: string[]; queued: string[]; waiting: boolean; screens: Screen[]; asking: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const icon = (n: IconNode) => createElement(n);
const post = (path: string) => fetch(path, { method: "POST" }).then((r) => r.json());
const get = async (): Promise<State> => (await fetch("/__stage/state")).json();

const STYLE = `
:root{color-scheme:light dark;--ink:#16181d;--paper:#f4f1ea;--line:rgba(128,128,128,.3);--orange:#e8a33d}
@media (prefers-color-scheme:dark){:root{--ink:#f4f1ea;--paper:#16181d}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
#stage{max-width:1100px;margin:0 auto;padding:12px 16px 120px;display:grid;gap:16px}
.demo-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.demo-bar h1{font-size:16px;margin:0;flex:1 1 200px}
.demo-bar select,.demo-bar button,.demo-act button{font:inherit;min-height:36px;padding:4px 10px;border:1px solid var(--ink);border-radius:6px;background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.demo-bar select{max-width:100%}.demo-bar svg,.demo-act svg{width:16px;height:16px}
.demo-note{margin:0;opacity:.75}
.demo-workers{display:flex;flex-wrap:wrap;gap:8px}
.demo-worker{border:1px solid var(--line);border-radius:8px;padding:6px 10px;min-width:150px;flex:1 1 150px}
.demo-worker b{display:inline-block;margin-right:6px}.demo-worker[data-state=asking]{border-color:var(--orange);background:rgba(232,163,61,.15)}
.demo-worker[data-state=working] .dot{background:#2da44e}.demo-worker[data-state=asking] .dot{background:var(--orange)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#888;margin-right:6px}
.demo-act{display:flex;flex-wrap:wrap;gap:8px}
.demo-wall{display:grid;gap:6px}.demo-wall canvas{width:100%;height:auto;aspect-ratio:${SIZE.w}/${SIZE.h};border-radius:6px;cursor:pointer;background:#16181d}
.demo-log{margin:0;padding-left:18px}
.modal.settings{border:1px solid var(--line);border-radius:10px;padding:4px 14px 12px}
.settings-pane .setting{padding:6px 0}.setting-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.setting-head h4{margin:0;flex:1}
.setting-note{opacity:.75;margin:4px 0}.settings-pane button{font:inherit;min-height:32px;cursor:pointer}
.settings-pane input,.settings-pane select{font:inherit;min-height:32px;max-width:100%}
@media (max-width:520px){#stage{padding:8px 16px 140px}}
`;

async function main() {
  let s = await get();
  // a link's hash (#setup=github-signin, #settings=grants) jumps to the state it names
  const wanted = fromHash(location.hash);
  if (wanted && wanted !== s.scenario) { await post(`/__stage/go?scenario=${wanted}`); s = await get(); }
  const root = document.getElementById("stage")!;
  document.head.append(el("style", {}, STYLE));

  const pick = el("select", { ariaLabel: "Scenario", onchange: () => void go(pick.value) },
    ...Object.entries(s.scenarios).map(([n]) => el("option", { value: n, selected: n === s.scenario }, n)));
  const about = el("p", { className: "demo-note" });
  const workers = el("div", { className: "demo-workers" });
  const act = el("div", { className: "demo-act" });
  const wall = el("div", { className: "demo-wall" });
  const log = el("ol", { className: "demo-log" });
  const settings = el("div", { className: "modal settings" }, el("section", { className: "settings-pane", ariaLabel: "You" }));
  root.append(
    el("div", { className: "demo-bar" }, icon(Hammer), el("h1", {}, "Agent Office demo stage"), pick),
    about, workers, act, wall, settings, el("h4", {}, "What happened"), log);

  addEventListener("hashchange", () => { const n = fromHash(location.hash); if (n) void go(n); });
  const go = async (name: string) => { await post(`/__stage/go?scenario=${encodeURIComponent(name)}`); location.search = `?scenario=${encodeURIComponent(name)}`; };

  // the controls that stand in for a person or a worker
  const who = el("select", { ariaLabel: "Worker" }, ...s.workers.map((w) => el("option", { value: w.name }, w.name)));
  act.append(who, el("button", { title: "The worker runs git push; with no grant for it the office asks first", onclick: () => void post(`/__stage/push?who=${who.value}`) }, icon(Plug), "Runs git push"));
  const typed = el("button", { title: "Stand in for typing the code at github.com/login/device", onclick: () => void post("/__stage/type") }, icon(Plug), "I typed the code");
  typed.hidden = true;
  act.append(typed);

  // the wall: each screen the scenario turns on, drawn by the office's own painter, clicked as in the 3D office
  const canvases = new Map<Screen, CanvasRenderingContext2D>();
  for (const name of SCREENS.filter((n) => s.screens.includes(n))) {
    const c = el("canvas", { width: SIZE.w, height: SIZE.h, title: name, onclick: (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      press(name, ((e.clientX - r.left) / r.width) * SIZE.w, ((e.clientY - r.top) / r.height) * SIZE.h);
    } });
    wall.append(c);
    canvases.set(name, c.getContext("2d")!);
  }
  const frame = () => { for (const [name, ctx] of canvases) paint(name, ctx, performance.now() / 1000); requestAnimationFrame(frame); };
  if (canvases.size) frame();
  if (canvases.has("ester")) new WebSocket(`ws://${location.host}/__stage/ws`); // screens/index.ts keeps the last socket for Ester's fix button

  const draw = () => {
    about.textContent = `${s.about}. Stands in for ${s.serves.map((n) => `#${n}`).join(", ")}. Open Ester's skull at the bottom left for her log.`;
    workers.replaceChildren(...s.workers.map((w) => { const e = el("div", { className: "demo-worker" }, el("span", { className: "dot" }), el("b", {}, w.name), `${w.state}: ${w.task}`); e.dataset.state = w.state; return e; }));
    typed.hidden = !s.waiting;
    log.replaceChildren(...[...s.log, ...s.queued.map((q) => `queued: ${q}`)].map((l) => el("li", {}, l)));
  };
  const refresh = async () => { try { s = await get(); draw(); } catch {} setTimeout(refresh, 1500); };
  draw();
  setTimeout(refresh, 1500);

  // the same switches for an agent: window.rbDemo.go("writes-ask-pending"), .push("Gizmo", "git push"), .typeCode(), .state()
  Object.assign(window, { rbDemo: {
    scenarios: Object.keys(s.scenarios), go, state: get,
    push: (worker = "Gizmo", command = "git push origin office/gizmo-221a") => post(`/__stage/push?${new URLSearchParams({ who: worker, command })}`),
    typeCode: () => post("/__stage/type"),
  } });
}

void main();
