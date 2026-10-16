// The swarm stage: swarm-sim.ts drawn as dots on a canvas, with modes, faders, layer switches and the story
// (swarm-story.ts) played scene by scene behind wipes. `mount(el, {mode, embed})` builds it inside any element, so the
// full page (swarm.html) and the landing page (client.html) share it; the build bundles it as swarm-stage.js.
// Icons are lucide names, drawn by whatever `window.lucide` the page has.
import { Sim, OLD, ALL } from "./swarm-sim.ts";
import { SCENES, at, startOf, total } from "./swarm-story.ts";

export const MODES = [
  ["story", "book-open", "Story", "The old git way, then codeSplitter's layers one at a time"],
  ["old", "git-branch", "Old git", "One lane into main, a merge wall and a test wall: push the faders and watch it jam"],
  ["layers", "layers", "Layer by layer", "Switch each layer on and off: Durable Objects, Mervin, Ester"],
  ["split", "columns-2", "Side by side", "The same agents through the old git way (top) and codeSplitter (bottom)"],
];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
/** Simulated minutes per real second at 1x, outside the story (each scene sets its own). */
const BASE = 1;
const SEED = 11;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

const CSS = `
.swst { --sw-fg: var(--fg, #0a0a0a); --sw-bg: var(--bg, #fff); --sw-muted: var(--muted, #6b6b6b); --sw-border: var(--border-2, var(--border, #cfcfcf));
  --sw-paper: var(--paper, #fcfbf8); --sw-accent: var(--accent, #e8590c); font: 14px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif); color: var(--sw-fg); }
.swst * { box-sizing: border-box; }
.swst .sw-top { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.swst .sw-grow { flex: 1; }
.swst button { font: inherit; color: var(--sw-fg); }
.swst .sw-tab { display: inline-flex; gap: 6px; align-items: center; height: 32px; padding: 0 10px; border: 1px solid var(--sw-border); border-radius: 5px; background: var(--sw-paper); cursor: pointer; white-space: nowrap; font-size: 13px; text-decoration: none; color: var(--sw-fg); }
.swst .sw-tab[aria-selected="true"] { background: var(--sw-fg); color: var(--sw-bg); border-color: var(--sw-fg); }
.swst .sw-tab svg, .swst .sw-btn svg { width: 15px; height: 15px; flex: none; }
.swst .sw-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--sw-border); border-radius: 5px; background: var(--sw-paper); cursor: pointer; }
.swst .sw-btn[aria-pressed="true"] { background: var(--sw-fg); color: var(--sw-bg); border-color: var(--sw-fg); }
.swst .sw-guide { display: inline-flex; gap: 6px; }
.swst .sw-next { display: inline-flex; gap: 4px; align-items: center; height: 32px; padding: 0 10px 0 12px; border: 1px solid var(--sw-accent); border-radius: 5px; background: var(--sw-accent); color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; }
.swst .sw-next svg { width: 15px; height: 15px; }
.swst .sw-next.ready { animation: sw-nudge 1.4s ease-in-out infinite; }
@keyframes sw-nudge { 50% { transform: translateX(3px); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sw-accent) 25%, transparent); } }
.swst .sw-stage { position: relative; border: 1px solid var(--sw-border); border-radius: 8px; overflow: hidden; background: var(--sw-paper); }
.swst canvas { display: block; width: 100%; }
.swst .sw-cap { min-height: 84px; padding: 12px 14px 4px; transition: opacity .35s, transform .35s; }
.swst .sw-cap.out { opacity: 0; transform: translateY(8px); }
.swst .sw-cap b { display: inline-block; font: 600 20px/1.15 var(--sans, sans-serif); letter-spacing: -.03em; background: var(--sw-fg); color: var(--sw-bg); padding: 4px 9px; border-radius: 4px; }
.swst .sw-cap span { display: block; margin-top: 6px; max-width: 72ch; font-size: 14px; color: var(--sw-fg); }
.swst .sw-scenes { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 3px; padding: 0 14px 10px; }
.swst .sw-scenes button { flex: 1; height: 14px; border: 0; padding: 5px 0; background: none; cursor: pointer; }
.swst .sw-scenes button i { display: block; height: 4px; border-radius: 2px; background: var(--sw-border); overflow: hidden; }
.swst .sw-scenes button i b { display: block; height: 100%; width: 0; background: var(--sw-accent); }
.swst .sw-desk { display: flex; gap: 18px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
.swst .sw-faders { display: flex; gap: 6px; }
.swst .sw-fader { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 64px; padding: 6px 0; border: 1px solid var(--sw-border); border-radius: 6px; background: var(--sw-paper); }
.swst .sw-fader output { font: 12px var(--mono, ui-monospace, monospace); width: 6ch; text-align: center; white-space: nowrap; }
.swst .sw-fader input { writing-mode: vertical-lr; direction: rtl; height: 86px; width: 24px; margin: 0; accent-color: var(--sw-accent); cursor: ns-resize; }
.swst .sw-fader span { font: 11px var(--mono, ui-monospace, monospace); color: var(--sw-muted); white-space: nowrap; }
.swst .sw-switches { display: flex; gap: 6px; flex-wrap: wrap; }
.swst .sw-switch { display: inline-flex; gap: 6px; align-items: center; height: 32px; padding: 0 10px; border: 1px solid var(--sw-border); border-radius: 16px; background: var(--sw-paper); cursor: pointer; white-space: nowrap; font-size: 13px; }
.swst .sw-switch[aria-pressed="true"] { border-color: var(--sw-accent); box-shadow: inset 0 0 0 1px var(--sw-accent); }
.swst .sw-switch svg { width: 15px; height: 15px; }
.swst .sw-switch:disabled { opacity: .6; cursor: default; }
.swst .sw-legend { display: flex; gap: 12px; flex-wrap: wrap; font: 12px var(--mono, ui-monospace, monospace); color: var(--sw-muted); }
.swst .sw-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
.swst.embed .sw-desk { margin-top: 8px; }
@media (max-width: 640px) { .swst .sw-tab span { display: none; } .swst .sw-cap b { font-size: 16px; } .swst .sw-cap span { font-size: 12px; } .swst .sw-fader { width: 54px; } }
`;

/** Build the stage inside `el`. Returns `{ goto(sceneId), setMode(mode), destroy() }`. */
export function mount(el, { mode = "story", embed = false, real = "/swarm-watch.html" } = {}) {
  if (!document.getElementById("swarm-stage-css")) {
    const s = document.createElement("style"); s.id = "swarm-stage-css"; s.textContent = CSS; document.head.append(s);
  }
  const root = document.createElement("div");
  root.className = `swst${embed ? " embed" : ""}`;
  root.innerHTML = `
    <div class="sw-top">
      <div role="tablist" aria-label="Modes" style="display:flex;gap:6px;flex-wrap:wrap">${MODES.map(([id, ic, name, what]) =>
        `<button class="sw-tab" role="tab" data-mode="${id}" title="${what}"><i data-lucide="${ic}"></i><span>${name}</span></button>`).join("")}
        ${real ? `<a class="sw-tab" href="${real}" title="A real week of this repo's PRs, replayed"><i data-lucide="calendar-days"></i><span>Real week</span></a>` : ""}</div>
      <span class="sw-grow"></span>
      <span class="sw-guide"><button class="sw-btn" data-act="back" title="Back a scene (left arrow)"><i data-lucide="chevron-left"></i></button><button class="sw-next" data-act="next" title="Next scene (right arrow)">Next<i data-lucide="chevron-right"></i></button><button class="sw-btn" data-act="auto" title="Play the story on its own"><i data-lucide="timer"></i></button></span>
      <button class="sw-btn" data-act="play" title="Play or pause (space)"><i data-lucide="pause"></i></button>
      <button class="sw-btn" data-act="restart" title="Start over"><i data-lucide="rotate-ccw"></i></button>
    </div>
    <div class="sw-stage" tabindex="0" aria-label="Agents as dots getting their work into main">
      <div class="sw-cap"><b></b><span></span></div>
      <canvas></canvas>
      <div class="sw-scenes"></div>
    </div>
    <div class="sw-desk">
      <div class="sw-faders">
        <label class="sw-fader" title="How fast time runs"><output data-out="speed"></output><input type="range" data-k="speed" min="0" max="${SPEEDS.length - 1}" step="1" aria-label="Speed"><span>speed</span></label>
        <label class="sw-fader" title="Agents working at once"><output data-out="agents"></output><input type="range" data-k="agents" min="1" max="50" step="1" aria-label="Agents"><span>agents</span></label>
        <label class="sw-fader" title="How often two features touch the same file, like the README's feature list"><output data-out="overlap"></output><input type="range" data-k="overlap" min="0" max="100" step="1" aria-label="Shared files"><span>overlap</span></label>
        <label class="sw-fader" title="How often a check goes red: flaky, already red on main, or really yours"><output data-out="flaky"></output><input type="range" data-k="flaky" min="0" max="50" step="1" aria-label="Red checks"><span>red</span></label>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0;flex:1">
        <div class="sw-switches">
          <button class="sw-switch" data-layer="coord" title="Layer one: the repo on a Durable Object, a computer on the internet every agent talks to live (git in Artifacts behind it). The lane gets wide."><i data-lucide="server"></i>Durable Objects</button>
          <button class="sw-switch" data-layer="mervin" title="Layer two: Mervin seats PRs on the bullet train and settles most conflicts by line id"><i data-lucide="train-front"></i>Mervin</button>
          <button class="sw-switch" data-layer="ester" title="Layer three: Ester stacks a car of PRs per test run and reruns the flaky ones"><i data-lucide="package-check"></i>Ester</button>
        </div>
        <div class="sw-legend"><span><i style="background:#9a9a9a"></i>building</span><span><i style="background:#e8590c"></i>waiting</span><span><i style="background:#b3261e"></i>stuck long, or sent back</span><span><i style="background:#e8a10c"></i>in tests</span><span><i style="background:#2f7d32"></i>home in main</span></div>
      </div>
    </div>`;
  el.append(root);
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const cv = $("canvas"), cx = cv.getContext("2d"), stage = $(".sw-stage");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let playing = true, speedIx = 3, storyMs = 0, sceneIx = -1, override = false, layers = { ...ALL }, auto = false;
  let knobs = { agents: 30, overlap: 0.35, flaky: 0.12 };
  /** One or two simulations, each with where its dots are drawn. */
  let sims = [];
  let wipe = null, W = 0, H = 0, last = 0, raf = 0, visible = true;
  const pos = new Map();

  const make = (l, warm = 0) => { const s = new Sim({ ...l }, { ...knobs }, SEED); if (warm) s.step(warm); return { sim: s, id: Math.random() }; };
  function fresh(kind, warm = 0) {
    pos.clear();
    sims = kind === "split" ? [{ ...make(OLD, warm), label: "the old git way" }, { ...make(ALL, warm), label: "codeSplitter" }] : [{ ...make(kind, warm), label: "" }];
  }
  function snap() {
    if (reduce || !W) return;
    const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; c.getContext("2d").drawImage(cv, 0, 0);
    wipe = { c, start: performance.now() };
  }
  const pushKnobs = () => { for (const { sim } of sims) { sim.knobs.overlap = knobs.overlap; sim.knobs.flaky = knobs.flaky; sim.setAgents(knobs.agents); } };

  // ---- controls --------------------------------------------------------------------------------------------------
  function syncUi() {
    for (const b of $$("[data-mode]")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    $('[data-act="play"]').innerHTML = `<i data-lucide="${playing ? "pause" : "play"}"></i>`;
    $('[data-act="play"]').setAttribute("aria-pressed", String(!playing));
    const f = { speed: speedIx, agents: knobs.agents, overlap: Math.round(knobs.overlap * 100), flaky: Math.round(knobs.flaky * 100) };
    for (const i of $$("[data-k]")) if (document.activeElement !== i) i.value = f[i.dataset.k];
    $('[data-out="speed"]').textContent = `${SPEEDS[speedIx]}x`;
    $('[data-out="agents"]').textContent = knobs.agents;
    $('[data-out="overlap"]').textContent = `${f.overlap}%`;
    $('[data-out="flaky"]').textContent = `${f.flaky}%`;
    const show = mode === "layers" || mode === "story";
    $(".sw-switches").style.display = show ? "" : "none";
    for (const b of $$("[data-layer]")) { b.setAttribute("aria-pressed", String(!!layers[b.dataset.layer])); b.disabled = mode !== "layers"; }
    $(".sw-scenes").style.display = mode === "story" ? "" : "none";
    $(".sw-guide").style.display = mode === "story" ? "" : "none";
    $('[data-act="auto"]').setAttribute("aria-pressed", String(auto));
    window.lucide?.createIcons?.();
  }
  function caption(title, text) {
    const cap = $(".sw-cap");
    if (cap.dataset.t === title) return;
    cap.dataset.t = title; cap.classList.add("out");
    setTimeout(() => { cap.querySelector("b").textContent = title; cap.querySelector("span").textContent = text; cap.querySelector("span").style.display = text ? "" : "none"; cap.classList.remove("out"); }, reduce ? 0 : 260);
  }

  function setMode(m) {
    if (!MODES.some(([id]) => id === m)) m = "story";
    snap(); mode = m; override = false; sceneIx = -1;
    if (m === "story") { storyMs = 0; }
    else {
      layers = m === "old" ? { ...OLD } : m === "layers" ? { coord: true, mervin: false, ester: false } : { ...ALL };
      fresh(m === "split" ? "split" : layers, 30);
      const [, , name, what] = MODES.find(([id]) => id === m);
      caption(name, what);
    }
    playing = true; syncUi();
  }
  function goto(id) {
    if (mode !== "story") setMode("story");
    storyMs = startOf(id); sceneIx = -1; override = false; playing = true; syncUi();
  }

  $(".sw-top").addEventListener("click", (e) => {
    const t = e.target.closest("[data-mode]"); if (t) return setMode(t.dataset.mode);
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "play") playing = !playing;
    if (a.dataset.act === "next") step(1);
    if (a.dataset.act === "back") step(-1);
    if (a.dataset.act === "auto") auto = !auto;
    if (a.dataset.act === "restart") { if (mode === "story") goto(SCENES[0].id); else setMode(mode); }
    syncUi();
  });
  stage.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); playing = !playing; syncUi(); }
    if (mode === "story" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1); }
  });
  /** The next or last scene; past the end goes back to the start. */
  function step(by) {
    // Forward plays straight on, so the same crowd carries into the next scene; back is a jump, with a fresh crowd.
    const i = (Math.max(0, sceneIx) + by + SCENES.length) % SCENES.length;
    if (by < 0) return goto(SCENES[i].id);
    storyMs = startOf(SCENES[i].id); override = false; playing = true; syncUi();
  }
  root.addEventListener("input", (e) => {
    const k = e.target.dataset?.k; if (!k) return;
    const v = +e.target.value;
    if (k === "speed") speedIx = v;
    else { knobs = { ...knobs, [k]: k === "agents" ? v : v / 100 }; override = true; pushKnobs(); }
    syncUi();
  });
  $(".sw-switches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-layer]"); if (!b || mode !== "layers") return;
    snap(); layers = { ...layers, [b.dataset.layer]: !layers[b.dataset.layer] };
    for (const { sim } of sims) sim.setLayers(layers);
    const on = Object.entries(layers).filter(([, v]) => v).map(([k]) => ({ coord: "Durable Objects", mervin: "Mervin", ester: "Ester" })[k]);
    caption(on.length ? on.join(" + ") : "No layers: the old git way", on.length === 3 ? "All three layers: the lane is wide, Mervin seats the trains, Ester stacks the stations." : "Switch the next layer on and watch which wall comes down.");
    syncUi();
  });
  $(".sw-scenes").addEventListener("click", (e) => { const b = e.target.closest("[data-scene]"); if (b) goto(b.dataset.scene); });
  $(".sw-scenes").innerHTML = SCENES.map((s) => `<button data-scene="${s.id}" title="${s.title}" aria-label="${s.title}"><i><b></b></i></button>`).join("");

  // ---- the story --------------------------------------------------------------------------------------------------
  function story(dt) {
    // Guided: a scene plays to its end and waits there (the crowd keeps moving) until Next. On its own: it moves on.
    if (playing) {
      const cur = at(storyMs).scene, end = startOf(cur.id) + cur.ms - 1; // the scene the clock is in, which Next just moved
      storyMs = auto ? (storyMs + dt) % total() : Math.min(storyMs + dt, end);
    }
    const a = at(storyMs);
    $(".sw-next").classList.toggle("ready", !auto && a.progress > 0.99);
    if (a.i !== sceneIx) {
      const s = a.scene, prev = SCENES[sceneIx];
      override = false;
      // A jump (a scene button, a link, the start) lands on a crowd already there, as if the story had run up to it.
      const jumped = a.i !== sceneIx + 1 && !(a.i === 0 && sceneIx === SCENES.length - 1);
      if (s.wipe || jumped || !sims.length) {
        snap(); knobs = { ...(jumped ? s : prev ?? s).knobs }; layers = s.layers === "split" ? { ...ALL } : { ...s.layers };
        fresh(s.layers === "split" ? "split" : s.layers, s.warm ?? (jumped ? 60 : 0));
      }
      else if (s.layers !== "split") { layers = { ...s.layers }; for (const { sim } of sims) sim.setLayers(layers); }
      sceneIx = a.i; caption(s.title, s.caption); syncUi();
    }
    if (!override) { knobs = a.knobs; pushKnobs(); syncUi(); }
    $$(".sw-scenes button").forEach((b, i) => { b.querySelector("b").style.width = i < a.i ? "100%" : i === a.i ? `${a.progress * 100}%` : "0"; });
    return a.scene;
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------
  const css = (v, f) => getComputedStyle(root).getPropertyValue(v).trim() || f;
  let C = {};
  const colors = () => {
    const th = document.documentElement.dataset.theme, dark = th ? th === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    C = { fg: css("--sw-fg", "#0a0a0a"), bg: css("--sw-paper", "#fcfbf8"), muted: css("--sw-muted", "#6b6b6b"), border: css("--sw-border", "#cfcfcf"), accent: css("--sw-accent", "#e8590c"),
      work: dark ? "#7a7a7a" : "#9a9a9a", bad: dark ? "#ef7b73" : "#b3261e", test: dark ? "#f0b94a" : "#e8a10c", ok: dark ? "#6fbf73" : "#2f7d32", dark };
  };
  function size() {
    const w = stage.clientWidth, dpr = devicePixelRatio || 1;
    const split = sims.length > 1;
    const h = Math.round(clamp(w * (split ? 0.7 : 0.4), split ? 480 : 280, split ? 760 : (embed ? 400 : 460)));
    if (w === W && h === H) return;
    W = w; H = h; cv.width = w * dpr; cv.height = h * dpr; cv.style.height = `${h}px`; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rr(x, y, w, h, r) { cx.beginPath(); cx.roundRect(x, y, w, h, r); }
  function person(x, y, s, color, name) {
    cx.fillStyle = color; cx.beginPath(); cx.arc(x, y - s * 1.1, s * 0.55, 0, 7); cx.fill();
    rr(x - s * 0.7, y - s * 0.45, s * 1.4, s * 1.5, s * 0.5); cx.fill();
    cx.font = `600 11px ${css("--mono", "ui-monospace") || "ui-monospace"}`; cx.textAlign = "center"; cx.fillText(name, x, y + s * 1.9); cx.textAlign = "left";
  }
  function label(text, x, y, color = C.muted, align = "left") {
    cx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; cx.fillStyle = color; cx.textAlign = align; cx.fillText(text, x, y); cx.textAlign = "left";
  }

  /** Draw one simulation into the rectangle r. */
  function drawSim(entry, r, focus, dtReal) {
    const { sim } = entry, L = sim.layers, t = sim.t;
    const X = (f) => r.x + r.w * f;
    const top = r.y + 30, bot = r.y + r.h - (r.y + r.h >= H - 1 ? 56 : 38), mid = (top + bot) / 2, bodyH = bot - top;
    const rad = clamp(Math.min(r.w / 190, bodyH / 48), 2, 5.2), sp = rad * 2.6;
    const Z = { desks: [X(0.012), X(0.17)], lane: [X(0.2), X(0.4)], wall: X(0.42), plat: [X(0.445), X(0.555)], track: [X(0.45), X(0.625)], testq: [X(0.635), X(0.71)], st: [X(0.735), X(0.855)], home: [X(0.88), X(0.99)] };
    const tun = bot + 9; // the underground way back from main to the desks
    const grid = (x0, x1, y0, i, s = sp) => { const cols = Math.max(1, Math.floor((x1 - x0) / s)); return [x0 + s / 2 + (i % cols) * s, Math.min(bot - s / 2, y0 + s / 2 + Math.floor(i / cols) * s)]; };

    // focus: a soft orange outline round the part the scene is about
    const FZ = { desks: [Z.desks[0], Z.desks[1]], lane: [Z.lane[0] - 6, Z.lane[1] + 4], wall: [Z.wall - 16, L.mervin ? Z.plat[1] + 4 : Z.wall + 16], train: [Z.plat[0] - 4, Z.track[1] + 4], tests: [Z.testq[0] - 4, Z.st[1] + 4], home: [Z.home[0] - 4, Z.home[1]] }[focus];
    if (FZ) { cx.save(); cx.strokeStyle = C.accent; cx.lineWidth = 2; cx.shadowColor = C.accent; cx.shadowBlur = 12; rr(FZ[0], top - 8, FZ[1] - FZ[0], bodyH + 16, 10); cx.stroke(); cx.restore(); }

    // the way in: stairs down from the street. One narrow flight the old way, wide stairs on a Durable Object.
    const stairs = (y0, y1) => {
      cx.save(); cx.fillStyle = C.border; cx.globalAlpha = 0.22; cx.fillRect(Z.lane[0], y0, Z.wall - Z.lane[0], y1 - y0); cx.globalAlpha = 1;
      cx.strokeStyle = C.border; cx.lineWidth = 1;
      for (let x = Z.lane[0] + 4; x < Z.wall - 2; x += 7) { cx.globalAlpha = 0.35 + 0.4 * ((x - Z.lane[0]) / (Z.wall - Z.lane[0])); cx.beginPath(); cx.moveTo(x, y0); cx.lineTo(x, y1); cx.stroke(); }
      cx.globalAlpha = 1; cx.strokeStyle = C.fg; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(Z.lane[0], y0); cx.lineTo(Z.wall, y0); cx.moveTo(Z.lane[0], y1); cx.lineTo(Z.wall, y1); cx.stroke(); cx.restore();
    };
    if (L.coord) {
      const hx = Z.lane[0], hw = Z.lane[1] - Z.lane[0], hy = top - 2;
      cx.save(); cx.strokeStyle = C.accent; cx.globalAlpha = 0.18; cx.setLineDash([3, 5]); cx.lineDashOffset = -t * 6;
      sim.dots.forEach((d, i) => { if (d.stage !== "work") return; const [dx, dy] = grid(Z.desks[0], Z.desks[1], top, i); cx.beginPath(); cx.moveTo(dx, dy); cx.lineTo(hx, hy + 9); cx.stroke(); });
      cx.restore();
      stairs(top + 22, bot);
      rr(hx, hy, hw, 18, 9); cx.fillStyle = C.fg; cx.fill();
      cx.font = "600 11px ui-monospace, monospace"; cx.fillStyle = C.bg; cx.textAlign = "center"; cx.fillText(hw > 150 ? "Durable Object · Artifacts" : "DO", hx + hw / 2, hy + 13); cx.textAlign = "left";
    } else stairs(mid - sp * 3.4, mid + sp * 3.4); // one flight, funnelling into a single gate
    // the street above the stairs and the tunnel under the stage: where agents come from, and where they go back to
    cx.save(); cx.fillStyle = C.border; cx.globalAlpha = 0.18; cx.fillRect(r.x + 2, tun - 5, r.w - 4, 12); cx.globalAlpha = 1;
    cx.strokeStyle = C.border; cx.setLineDash([2, 4]); cx.beginPath(); cx.moveTo(r.x + 4, tun + 1); cx.lineTo(r.x + r.w - 4, tun + 1); cx.stroke(); cx.restore();
    // the merge wall, or Mervin's platform
    if (!L.mervin) {
      cx.fillStyle = C.bad; cx.globalAlpha = 0.85;
      cx.fillRect(Z.wall - 4, top, 8, mid - sp - top); cx.fillRect(Z.wall - 4, mid + sp, 8, bot - mid - sp); cx.globalAlpha = 1;
      cx.fillStyle = C.fg; for (const y of [mid - sp, mid + sp]) { cx.fillRect(Z.wall - 7, y - 2, 14, 4); } // the one ticket gate that is open
    } else {
      cx.strokeStyle = C.border; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(Z.plat[0], top + 34); cx.lineTo(Z.plat[1], top + 34); cx.stroke(); cx.lineWidth = 1;
      person((Z.plat[0] + Z.plat[1]) / 2, top + 14, 7, C.accent, "Mervin");
      cx.strokeStyle = C.border; cx.beginPath(); cx.moveTo(Z.track[0], mid + 2.2 * sp + 4); cx.lineTo(Z.track[1], mid + 2.2 * sp + 4); cx.stroke();
    }
    // the test wall, or Ester's stations
    const stH = (bodyH - 18) / 4;
    for (let k = 0; k < 4; k++) {
      const y = top + 18 + k * stH, s = sim.stations[k];
      // a platform slab with its track beside it, running back to where the train comes in
      cx.save(); cx.strokeStyle = C.border; cx.globalAlpha = 0.6; cx.beginPath(); cx.moveTo(Z.testq[0], y + stH - 3); cx.lineTo(Z.st[0], y + stH - 3); cx.stroke(); cx.restore();
      rr(Z.st[0], y, Z.st[1] - Z.st[0], stH - 7, 5); cx.save(); cx.globalAlpha = 0.07; cx.fillStyle = C.fg; cx.fill(); cx.restore(); cx.strokeStyle = C.border; cx.stroke();
      if (s.riders.length) { const p = clamp(1 - (s.busyUntil - t) / 6, 0, 1); cx.fillStyle = C.test; cx.globalAlpha = 0.25; cx.fillRect(Z.st[0] + 1, y + stH - 9, (Z.st[1] - Z.st[0] - 2) * p, 3); cx.globalAlpha = 1; }
    }
    if (!L.ester) { cx.fillStyle = C.test; cx.globalAlpha = 0.85; cx.fillRect(Z.st[0] - 12, top, 7, bodyH); cx.globalAlpha = 1; }
    else person((Z.st[0] + Z.st[1]) / 2, top + 2, 6, C.accent, "");

    // the platform's yellow line, and the trains: doors open while the seated settle in, then lift and go
    const trW = 8 * sp + sp, trH = 3 * sp + sp * 0.8;
    if (L.mervin) { cx.save(); cx.strokeStyle = C.test; cx.lineWidth = 2; cx.setLineDash([6, 4]); cx.beginPath(); cx.moveTo(Z.track[0], mid - trH / 2 - 7); cx.lineTo(Z.track[1], mid - trH / 2 - 7); cx.stroke(); cx.restore(); }
    for (const tr of sim.trains) {
      const k = ease(clamp((t - tr.departs) / (tr.arrives - tr.departs), 0, 1)), boarding = t < tr.departs;
      const x = Z.track[0] + (Z.track[1] - trW - sp * 1.5 - Z.track[0]) * k, lift = clamp(k * 8, 0, 1) * 3, y = mid - trH / 2 - lift;
      cx.save(); cx.globalAlpha = k > 0.94 ? (1 - k) / 0.06 : 1;
      if (lift) { cx.fillStyle = C.fg; cx.globalAlpha *= 0.15; cx.fillRect(x + 4, mid + trH / 2 + 2, trW, 3); cx.globalAlpha = k > 0.94 ? (1 - k) / 0.06 : 1; }
      if (k > 0.02 && k < 0.98) { cx.strokeStyle = C.accent; cx.globalAlpha *= 0.5; for (let j = 0; j < 3; j++) { cx.beginPath(); cx.moveTo(x - 6 - j * 7, y + 5 + j * (trH - 10) / 2); cx.lineTo(x - 18 - j * 7 - 30 * k, y + 5 + j * (trH - 10) / 2); cx.stroke(); } cx.globalAlpha = k > 0.94 ? (1 - k) / 0.06 : 1; }
      cx.fillStyle = C.fg; cx.beginPath(); cx.moveTo(x + 4, y); cx.lineTo(x + trW, y); cx.quadraticCurveTo(x + trW + sp * 1.8, y + trH * 0.55, x + trW, y + trH); cx.lineTo(x + 4, y + trH); cx.quadraticCurveTo(x, y + trH, x, y + trH - 4); cx.lineTo(x, y + 4); cx.quadraticCurveTo(x, y, x + 4, y); cx.fill();
      cx.fillStyle = C.accent; cx.fillRect(x, y + trH - 4, trW + sp, 2);
      // doors in the side facing the platform: open (a gap of light) while boarding
      cx.fillStyle = boarding ? C.bg : C.work; cx.globalAlpha *= boarding ? 0.9 : 0.5;
      for (let c = 0; c < 4; c++) cx.fillRect(x + sp * 0.5 + c * sp * 2.2, y, sp * 1.1, boarding ? 3 : 2);
      cx.restore();
      // Ester loads a train the way a flight crew loads a plane: seat by seat, row by row. Without her it is a scrum at the doors.
      tr.seat = (id) => {
        const j = tr.riders.indexOf(id);
        if (L.ester) return [x + sp * 0.9 + (j % 8) * sp, y + sp * 0.75 + Math.floor(j / 8) * sp];
        const h = Math.sin(id * 12.9898) * 43758.5453, u = h - Math.floor(h), v = Math.sin(id * 78.233) * 12345.6 - Math.floor(Math.sin(id * 78.233) * 12345.6);
        return [x + sp * 0.8 + u * (trW - sp * 1.4), y + sp * 0.7 + v * (trH - sp * 1.4)];
      };
      tr.crew = [x + sp * 2, y - 2];
    }
    if (L.ester) for (const tr of sim.trains) if (t < tr.departs + 0.3 && tr.crew) { person(tr.crew[0], tr.crew[1] - 4, 4.5, C.accent, ""); person(tr.crew[0] + sp * 4.4, tr.crew[1] - 4, 4.5, C.accent, ""); }

    // where each dot belongs right now
    const lanes = L.coord ? 8 : 1, perRow = Math.max(1, Math.floor((Z.wall - Z.lane[0]) / sp) - 1);
    const qi = new Map(sim.queue.map((id, i) => [id, i])), tq = new Map(sim.testq.map((id, i) => [id, i])), pq = new Map(sim.platform.map((id, i) => [id, i]));
    let gate = 0, bench = 0, home = 0;
    const laneY = (k) => mid + (k - 3.5) * Math.min(sp * 1.7, bodyH / 9);
    const target = (d, i) => {
      switch (d.stage) {
        case "work": return grid(Z.desks[0], Z.desks[1], top, i);
        case "queue": {
          const q = qi.get(d.id) ?? 0;
          if (lanes > 1) { const depth = Math.floor(q / lanes); return [Math.max(Z.lane[0] + sp / 2, Z.wall - sp * (1.2 + depth)), laneY(q % lanes)]; }
          const row = Math.floor(q / perRow), col = q % perRow, off = row ? (row % 2 ? -1 : 1) * Math.ceil(row / 2) * sp : 0;
          return [Z.wall - sp * (1.2 + (row % 2 ? perRow - 1 - col : col)), clamp(mid + off, top + sp, bot - sp)];
        }
        case "gate": { const g = gate++; return [Z.wall, lanes > 1 ? laneY(g % 8) : mid]; }
        case "platform": return grid(Z.plat[0] + 4, Z.plat[1] - 4, top + 40, pq.get(d.id) ?? 0);
        case "bench": { const b = bench++; return grid(Z.plat[0] + 4, Z.plat[1] - 4, bot - 3 * sp, b); }
        case "train": { const tr = sim.trains.find((x) => x.id === d.train); return tr?.seat ? tr.seat(d.id) : [Z.track[0], mid]; }
        case "testq": return grid(Z.testq[0], Z.testq[1], top + 18, tq.get(d.id) ?? 0);
        case "station": { const s = sim.stations[d.station ?? 0], j = s.riders.indexOf(d.id), y = top + 18 + (d.station ?? 0) * stH; return [Z.st[0] + sp * 0.9 + (j % 4) * sp * 1.1, y + sp * 0.9 + Math.floor(j / 4) * sp * 1.1]; }
        case "home": return grid(Z.home[0], Z.home[1], top, home++);
      }
      return [r.x, mid];
    };
    const k = 1 - Math.exp(-dtReal / 1000 * 3.5); // dots glide, they don't jump
    sim.dots.forEach((d, i) => {
      let [tx, ty] = target(d, i);
      const key = `${entry.id}:${d.id}`;
      let p = pos.get(key);
      if (!p) { p = { x: tx, y: ty, was: d.stage }; pos.set(key, p); }
      // back to the desks: down into the tunnel under main, along it, and up the stairs at the other end
      if (p.was === "home" && d.stage === "work") p.leg = 1;
      p.was = d.stage;
      if (p.leg === 1) { ty = tun; tx = p.x; if (Math.abs(p.y - tun) < 2) p.leg = 2; }
      else if (p.leg === 2) { ty = tun; if (Math.abs(p.x - tx) < 3) p.leg = 3; }
      else if (p.leg === 3 && Math.abs(p.y - ty) < 2) p.leg = 0;
      const under = p.leg === 1 || p.leg === 2;
      p.x += (tx - p.x) * k * (p.leg === 2 ? 1.2 : 1); p.y += (ty - p.y) * k;
      const fr = sim.frustration(d), jit = fr * rad * 0.8;
      const x = p.x + (jit ? Math.sin(t * 9 + d.id * 1.7) * jit : 0), y = p.y + (jit ? Math.cos(t * 11 + d.id) * jit : 0);
      let fill = C.work;
      if (d.stage === "home") fill = C.ok;
      else if (d.stage === "station") fill = C.test;
      else if (d.stage === "train") fill = C.accent;
      else if (d.stage !== "work") fill = fr > 0.5 ? C.bad : C.accent;
      if (under) cx.globalAlpha = 0.55;
      cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.fillStyle = fill; cx.fill(); cx.globalAlpha = 1;
      if (d.stage === "work" && d.redo) { cx.strokeStyle = d.redo === "merge" ? C.bad : C.test; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1; }
      if (d.stage === "bench") { cx.strokeStyle = C.bad; cx.setLineDash([2, 2]); cx.beginPath(); cx.arc(x, y, rad + 2, 0, 7); cx.stroke(); cx.setLineDash([]); }
      if (d.flash) {
        const age = (t - d.flash.at) / 1.5;
        if (age < 1) {
          cx.globalAlpha = 1 - age; cx.strokeStyle = { conflict: C.bad, red: C.test, settled: C.accent, card: C.bad, rerun: C.test, landed: C.ok }[d.flash.kind];
          cx.lineWidth = 1.5; cx.beginPath(); cx.arc(x, y, rad * (1 + 2.5 * age), 0, 7); cx.stroke(); cx.lineWidth = 1;
          if (d.flash.kind === "settled" && L.mervin) { cx.beginPath(); cx.moveTo((Z.plat[0] + Z.plat[1]) / 2, top + 20); cx.lineTo(x, y); cx.stroke(); }
          cx.globalAlpha = 1;
        }
      }
    });

    // labels and the numbers
    const ly = bot + 30;
    label("the street: PRs done", Z.desks[0], ly);
    label(L.coord ? "wide stairs" : "one narrow stair", Z.lane[0], ly);
    label(L.mervin ? "the platform + train" : "ticket gate: jammed", L.mervin ? Z.plat[0] : Z.wall - 70, ly, L.mervin ? C.muted : C.bad);
    label("arrivals", Z.testq[0], ly);
    label(L.ester ? "Ester's platforms" : "test gate", Z.st[0] - (L.ester ? 0 : 12), ly, L.ester ? C.muted : C.test);
    label("home: main", Z.home[0], ly, C.ok);
    label("underground, back to the street", r.x + r.w * 0.45, tun + 3, C.muted);
    const s = sim.stats;
    const line = `${entry.label ? `${entry.label} · ` : ""}${s.landed} home · ${sim.perHour()}/h · ${sim.waiting()} waiting · ${s.bounces.merge + s.bounces.test} sent back · ${Math.round(s.wasted)} agent-min redoing`;
    cx.font = `${entry.label ? 600 : 500} 12px ui-monospace, SFMono-Regular, Menlo, monospace`; cx.fillStyle = entry.label === "codeSplitter" ? C.accent : C.fg;
    cx.fillText(line, r.x + 8, r.y + 14);
    if (sims.length > 1) {
      // side by side the count who got home is the point, so it gets big type, right-aligned in the row
      const by = r.y + Math.max(36, Math.min(60, r.h * 0.25));
      cx.textAlign = "right";
      cx.font = `700 ${Math.max(28, Math.min(56, r.h * 0.22))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      cx.fillStyle = entry.label === "codeSplitter" ? C.accent : C.fg;
      cx.fillText(String(s.landed), r.x + r.w - 12, by);
      cx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; cx.fillStyle = C.muted;
      cx.fillText("got home", r.x + r.w - 12, by + 14);
      cx.textAlign = "left";
    }
  }

  function frame(now) {
    if (!root.isConnected) return api.destroy(); // the page swapped it out (the landing page is an SPA view)
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 16; last = now;
    if (!visible) return;
    let speed = BASE, focus;
    if (mode === "story") { const s = story(dt); speed = s.speed; focus = s.focus; }
    if (playing) for (const { sim } of sims) sim.step((dt / 1000) * speed * SPEEDS[speedIx]);
    size();
    cx.fillStyle = C.bg; cx.fillRect(0, 0, W, H);
    if (sims.length > 1) {
      drawSim(sims[0], { x: 0, y: 0, w: W, h: H / 2 }, undefined, dt);
      cx.strokeStyle = C.border; cx.beginPath(); cx.moveTo(0, H / 2); cx.lineTo(W, H / 2); cx.stroke();
      drawSim(sims[1], { x: 0, y: H / 2, w: W, h: H / 2 }, focus, dt);
    } else if (sims[0]) drawSim(sims[0], { x: 0, y: 0, w: W, h: H }, focus, dt);
    if (wipe) {
      const k = (now - wipe.start) / 750;
      if (k >= 1) wipe = null;
      else {
        const x = W * ease(k), dpr = cv.width / W;
        cx.drawImage(wipe.c, x * dpr, 0, (W - x) * dpr, wipe.c.height, x, 0, W - x, H);
        cx.save(); cx.fillStyle = C.accent; cx.shadowColor = C.accent; cx.shadowBlur = 18; cx.fillRect(x - 2, 0, 4, H); cx.restore();
      }
    }
  }

  const api = { goto, setMode, destroy() { cancelAnimationFrame(raf); mo.disconnect(); io.disconnect(); root.remove(); } };
  colors();
  const mo = new MutationObserver(() => colors());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = 0; });
  io.observe(stage);
  setMode(mode);
  raf = requestAnimationFrame(frame);
  return api;
}
