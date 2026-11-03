// The concepts stage: the road a change takes (pipeline.ts) played as seven short scenes on a canvas, with the
// road itself as a strip of stops and hooks under it. `mount(el, {embed})` builds it inside any element, so /concepts
// and the landing page share it; the build bundles it as concepts-stage.js. Ester's lanes are pipeline.ts's own
// laneCall and tally on made-up changes, so the page shows what the API answers.
import { mulberry32 } from "@rustybuns/util";
import { EXAMPLE_PIPELINE, HOOK_MODES, STOP_INFO, laneCall, tally } from "./pipeline.ts";

export { EXAMPLE_PIPELINE };

/** Road order, hooks where they sit: what the strip shows and the scenes walk. */
export const ROAD = [
  { id: "unclog", stop: "coordinate", label: "One file, many hands", icon: "file-code" },
  { id: "drift", stop: "branch", label: "Branch fast, drift apart", icon: "git-branch" },
  { id: "lock", stop: "coordinate", label: "Durable Objects", icon: "radio-tower" },
  { id: "mervin", stop: "mervin", label: "Mervin", icon: "git-merge" },
  { id: "hook", hook: "before-ester", label: "Your AI, if you like", icon: "sparkles" },
  { id: "ester", stop: "ester", label: "Ester's lanes", icon: "flask-conical" },
  { id: "yours", stop: "yours", label: "Yours", icon: "rocket" },
];
const SCENES = {
  unclog: { ms: 9000, title: "Unclog the file, not the work", text: "The old way, two agents each take the whole file and fight over it on the way back. Here every line is its own record, so each one lands its own lines and nobody waits. codeSplitter only does the logistics: the AI still writes every line." },
  drift: { ms: 11000, title: "Branch at lightning speed. Then the noise.", text: "Artifacts makes a branch a real git repo in milliseconds. Left alone, the copies drift out of tune: their waves cancel, the signal shrinks, and the light dims as the work leaks out of the line. Your AI gets pulled off features, security and maintenance into the plumbing: merge fights and rewriting what someone just rewrote. We all clog it. Watch the scope." },
  lock: { ms: 10000, title: "Coordinate, and the signal comes back", text: "Durable Objects keep one live copy of each file and Mervin settles the merges, so the harmonics line up and boost each other. The light gets bright, every electron gets through, and the AI checks in, finds nothing the matter, and goes back to features, security and maintenance. You still plug the AI in, just not nearly as often." },
  mervin: { ms: 8000, title: "Mervin settles the merge", text: "Not a model: plain rules, as fast as the computer goes. Changes that don't clash go together in one wave; the ones that do wait a wave; the rare real clash comes back as one card." },
  hook: { ms: 7000, title: "Hook your AI in, or don't", text: "After Mervin, before Ester, after Ester: three places a hook can say yay or nay. Off, an AI's call, or a person's. Use the AI where it's judgement, not traffic." },
  ester: { ms: 12500, title: "Ester stacks the tests in lanes", text: "Some tests run on every change. Some every fifth, because they add up. Some only at a release: the iOS app two days before the preview. And the bus takes no tests at all: changes ride along until it's full, then one big AI pass over all of them." },
  yours: { ms: 6000, title: "Then it's your code", text: "One more hook if you want it, then ship, deploy, release. Every stop on the way was a plain call: CLI, API, MCP or code mode, the same answer each time." },
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const seg = (t, a, b) => ease(clamp01((t - a) / (b - a)));

const CSS = `
.cnst { --c-fg: var(--fg, #0a0a0a); --c-bg: var(--bg, #fff); --c-muted: var(--muted, #6b6b6b); --c-border: var(--border-2, var(--border, #cfcfcf));
  --c-paper: var(--paper, #fcfbf8); --c-accent: var(--accent, #e8590c); --c-bad: #b3261e; --c-good: #1a7f37; font: 14px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif); color: var(--c-fg); }
.cnst * { box-sizing: border-box; }
.cnst .c-stage { position: relative; border: 1px solid var(--c-border); border-radius: 8px; overflow: hidden; background: var(--c-paper); }
.cnst canvas { display: block; width: 100%; }
.cnst .c-cap { min-height: 92px; padding: 12px 14px 22px; transition: opacity .3s; }
.cnst .c-cap.out { opacity: 0; }
.cnst .c-cap b { display: inline-block; font: 600 19px/1.15 var(--sans, sans-serif); letter-spacing: -.03em; background: var(--c-fg); color: var(--c-bg); padding: 4px 9px; border-radius: 4px; }
.cnst .c-cap span { display: block; margin-top: 6px; max-width: 74ch; }
.cnst .c-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 3px; padding: 0 14px 9px; }
.cnst .c-bar button { flex: 1; height: 14px; border: 0; padding: 5px 0; background: none; cursor: pointer; }
.cnst .c-bar i { display: block; height: 4px; border-radius: 2px; background: var(--c-border); overflow: hidden; }
.cnst .c-bar i b { display: block; height: 100%; width: 0; background: var(--c-accent); }
.cnst .c-road { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
.cnst .c-node { display: inline-flex; gap: 6px; align-items: center; height: 32px; padding: 0 10px; border: 1px solid var(--c-border); border-radius: 5px; background: var(--c-paper); cursor: pointer; font: 13px var(--sans, sans-serif); color: var(--c-fg); white-space: nowrap; }
.cnst .c-node svg { width: 15px; height: 15px; flex: none; }
.cnst .c-node.on { background: var(--c-fg); color: var(--c-bg); border-color: var(--c-fg); }
.cnst .c-node.hook { border-style: dashed; border-radius: 16px; font: 12px var(--mono, ui-monospace, monospace); }
.cnst .c-node.hook[data-mode="ai"] { border-color: var(--c-accent); color: var(--c-accent); border-style: solid; }
.cnst .c-node.hook[data-mode="ask"] { border-color: var(--c-fg); border-style: solid; }
.cnst .c-arrow { color: var(--c-muted); font: 12px var(--mono, monospace); }
.cnst .c-note { margin: 8px 0 0; font-size: 13px; color: var(--c-muted); }
.cnst .c-note a { color: var(--c-accent); }
`;

/** Ester's scene: made-up changes through the example lanes, decided by pipeline.ts. */
function esterRun(seed = 7) {
  const rnd = mulberry32(seed), pool = ["src/app.ts", "src/merge.ts", "test/app.test.ts", "docs/guide.md", "README.md", "ios/App.swift", "src/lines.ts"];
  const lanes = EXAMPLE_PIPELINE.lanes;
  let counts = {};
  const changes = [], seated = lanes.map(() => []);
  for (let i = 0; i < 18; i++) {
    const files = [pool[Math.floor(rnd() * pool.length)], ...(rnd() < 0.5 ? [pool[Math.floor(rnd() * pool.length)]] : [])];
    const release = i === 16;
    const calls = lanes.map((l) => laneCall(l, { files, release, counts }));
    counts = tally(counts, calls);
    const at = 0.6 + i * 0.55;
    calls.forEach((c, k) => { if (c.go === "board") seated[k].push(c); if (c.go === "depart") { for (const s of seated[k]) s.leaves = at; seated[k] = []; } });
    changes.push({ at, release, calls });
  }
  return { lanes, changes };
}


export function mount(el, { embed = false } = {}) {
  if (!document.getElementById("cnst-css")) { const s = document.createElement("style"); s.id = "cnst-css"; s.textContent = CSS; document.head.append(s); }
  const hooks = { ...EXAMPLE_PIPELINE.hooks };
  el.classList.add("cnst");
  el.innerHTML = `<div class="c-stage"><canvas aria-hidden="true"></canvas><div class="c-cap" aria-live="polite"><b></b><span></span></div>
    <div class="c-bar">${ROAD.map((r) => `<button data-go="${r.id}" title="${r.label}" aria-label="${r.label}"><i><b></b></i></button>`).join("")}</div></div>
    <div class="c-road"></div>${embed ? `<p class="c-note">Every stop is a plain call (CLI, API, MCP or code mode); the AI hooks in where you choose. <a href="/concepts">The whole road, stop by stop</a></p>` : ""}`;
  const canvas = el.querySelector("canvas"), g = canvas.getContext("2d"), cap = el.querySelector(".c-cap"), road = el.querySelector(".c-road");
  const H = embed ? 270 : 340;
  const fit = () => { const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600; canvas.width = w * dpr; canvas.height = H * dpr; canvas.style.height = `${H}px`; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  fit(); addEventListener("resize", fit);


  const drawRoad = (cur) => {
    const node = (r) => `<button class="c-node${r.id === cur ? " on" : ""}" data-go="${r.id}" title="${r.stop ? `${STOP_INFO[r.stop].who}: ${STOP_INFO[r.stop].does}` : r.label}"><i data-lucide="${r.icon}"></i>${r.stop ? STOP_INFO[r.stop].who : r.label}</button>`;
    const hook = (h) => `<button class="c-node hook" data-hook="${h}" data-mode="${hooks[h] ?? "off"}" title="${embed ? "" : "press to change: off, ai (an AI says yay or nay), ask (a person does)"}">${h}: ${hooks[h] ?? "off"}</button>`;
    const parts = [node(ROAD[1]), node(ROAD[2]), node(ROAD[3]), hook("after-mervin"), hook("before-ester"), node(ROAD[5]), hook("after-ester"), node(ROAD[6])];
    road.innerHTML = parts.join(`<span class="c-arrow">&rarr;</span>`);
    window.lucide?.createIcons?.({ root: road });
  };

  let col = {};
  const readCol = () => { const s = getComputedStyle(el); col = Object.fromEntries(["fg", "bg", "muted", "border", "paper", "accent", "bad", "good"].map((k) => [k, s.getPropertyValue(`--c-${k}`).trim() || "#888"])); };
  readCol();
  const ester = esterRun();

  let i = 0, t0 = performance.now(), last = -1, dt = 0, prev = performance.now(), aiPos = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const goto = (id) => { const n = ROAD.findIndex((r) => r.id === id); if (n >= 0) { i = n; t0 = performance.now(); last = -1; } };
  el.addEventListener("click", (e) => {
    const h = e.target.closest("[data-hook]");
    if (h && !embed) { const k = h.dataset.hook, m = HOOK_MODES[(HOOK_MODES.indexOf(hooks[k] ?? "off") + 1) % HOOK_MODES.length]; hooks[k] = m; drawRoad(ROAD[i].id); return; }
    const b = e.target.closest("[data-go]"); if (b) goto(b.dataset.go);
  });

  const text = (s, x, y, o = {}) => { g.font = `${o.w ?? 500} ${o.size ?? 12}px ${o.mono ? "Geist Mono, ui-monospace, monospace" : "Geist, ui-sans-serif, system-ui, sans-serif"}`; g.fillStyle = o.c ?? col.fg; g.textAlign = o.align ?? "center"; g.fillText(s, x, y); };
  const dot = (x, y, r, c, fill = true) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); if (fill) { g.fillStyle = c; g.fill(); } else { g.strokeStyle = c; g.lineWidth = 1.5; g.stroke(); } };
  const box = (x, y, w, h, c, fill) => { g.beginPath(); g.roundRect(x, y, w, h, 4); if (fill) { g.fillStyle = fill; g.fill(); } if (c) { g.strokeStyle = c; g.lineWidth = 1; g.stroke(); } };

  const draw = {
    unclog(t, w, h) {
      const fx = w / 2 - 70, fy = 40, n = 8, lh = Math.min(22, (h - 100) / (n + 1));
      const old = t < 4.2, k = old ? t : t - 4.2;
      text(old ? "the old way: the whole file, twice" : "codeSplitter: a line each", w / 2, 26, { mono: true, c: col.muted });
      const shake = old && k > 2.4 && k < 3.4 ? Math.sin(k * 60) * 3 : 0;
      for (let l = 0; l < n + (old ? 0 : seg(k, 2.6, 3.4) > 0 ? 1 : 0); l++) {
        const mine = !old && ((l === 1 && k > 1.6) || (l === 5 && k > 1.9) || l === n);
        box(fx + shake, fy + l * lh, 140, lh * 0.72, col.border, mine ? col.accent : col.paper);
        text(`L${l + 1}`, fx - 14 + shake, fy + l * lh + lh * 0.55, { mono: true, size: 10, c: col.muted });
      }
      const agents = [[fx - 120, col.accent], [fx + 260, col.fg]];
      if (old) {
        agents.forEach(([ax, c], j) => {
          const out = seg(k, 0.2, 1.1), back = seg(k, 1.6, 2.4), x = ax + (j ? -1 : 1) * 40 * (out - back);
          box(x - 26, fy + 20, 52, lh * 5, c, null); text("copy", x, fy + lh * 5 + 34, { mono: true, size: 10, c });
          dot(x, fy + 14, 8, c);
        });
        if (k > 2.4) { text("CONFLICT", w / 2, fy + n * lh + 22, { w: 700, size: 16, c: col.bad }); text("redo it, wait in line again", w / 2, fy + n * lh + 40, { size: 12, c: col.muted }); }
      } else {
        const p1 = seg(k, 0.2, 1.6), p2 = seg(k, 0.5, 1.9), p3 = seg(k, 1.8, 2.8);
        dot(agents[0][0] + (fx + 20 - agents[0][0]) * p1, fy + 14 + (lh * 1 - 0) * p1, 8, col.accent);
        dot(agents[1][0] + (fx + 120 - agents[1][0]) * p2, fy + 14 + lh * 5 * p2, 8, col.fg);
        dot(w / 2 + 200 - 140 * p3, fy + n * lh + 10, 7, col.muted);
        if (k > 2.8) text("all three landed, nobody waited", w / 2, fy + (n + 1) * lh + 22, { w: 600, size: 14, c: col.good });
      }
    },
    drift(t, w, h) { this.signal(t, w, h, 1 - 0.86 * seg(t, 1.2, 7.5), false); },
    lock(t, w, h) { this.signal(t, w, h, 0.14 + 0.86 * seg(t, 0.6, 4.5), true); },
    /** The branches as waves at coherence `c` (1 in tune, 0 fighting): their sum, the light it powers, and where the AI's time goes. */
    signal(t, w, h, c, locked) {
      const n = 5, top = 22, band = h - 128, trunk = 30, wl = w * 0.4, sx = wl + 16, sw = w * 0.22, bx = sx + sw + 18, by = top + band / 2;
      // The branches: forked in about a second, then each drifting out of tune unless something keeps them in step.
      g.strokeStyle = col.fg; g.lineWidth = 3; g.beginPath(); g.moveTo(trunk, top); g.lineTo(trunk, top + band); g.stroke();
      text("main", trunk, top - 8, { mono: true, size: 10, c: col.muted });
      // Each branch is a harmonic of one note (k = 1..5). In tune, they sit on whole multiples, in step, and their peaks
      // stack: about a 4x boost. Out of tune, each slides off its multiple and out of phase, weaker for the fighting, so
      // they beat against and cancel each other down to about half that.
      const waveAt = (b, u) => { const k = b + 1, th = u * 5 - t * 0.9; return (0.4 + 0.6 * c) * Math.sin(k * th * (1 + (1 - c) * 0.11 * b) + (1 - c) * b * (2 * Math.PI / n)) + (1 - c) * 0.12 * Math.sin(u * (37 + b * 9) + b * 3 + t * (2 + b)); };
      for (let b = 0; b < n; b++) {
        const y = top + 8 + b * ((band - 16) / (n - 1)), born = locked ? 1 : seg(t, b * 0.1, b * 0.1 + 0.3), x1 = trunk + (wl - trunk) * born;
        g.strokeStyle = b % 2 ? col.fg : col.accent; g.globalAlpha = 0.8; g.lineWidth = 1.5; g.beginPath();
        for (let x = trunk; x <= x1; x += 3) { const u = (x - trunk) / (wl - trunk), yy = y + waveAt(b, u) * 6 * Math.min(1, u * 5); x === trunk ? g.moveTo(x, yy) : g.lineTo(x, yy); }
        g.stroke(); g.globalAlpha = 1;
        if (!locked && born < 1) { g.strokeStyle = col.accent; g.lineWidth = 2; g.beginPath(); g.moveTo(x1 - 9, y - 7); g.lineTo(x1, y); g.lineTo(x1 - 5, y + 2); g.stroke(); }
      }
      if (!locked && t < 1.3) text("5 branches, about a second", (trunk + wl) / 2, top + band + 14, { mono: true, size: 10, c: col.accent });
      // The oscilloscope: every harmonic faint, their sum bright. The gain is the sum's peak over one branch's.
      box(sx, top, sw, band, col.border, "#07130d");
      g.strokeStyle = "rgba(93, 255, 160, 0.10)"; g.lineWidth = 1;
      for (let k = 1; k < 8; k++) { const x = sx + (sw * k) / 8; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + band); g.stroke(); }
      for (let k = 1; k < 6; k++) { const y = top + (band * k) / 6; g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + sw, y); g.stroke(); }
      const hue = c > 0.8 ? col.good : c > 0.45 ? col.accent : col.bad, scale = (band / 2 - 14) / 4.2, S = 90;
      for (let b2 = 0; b2 < n; b2++) {
        g.strokeStyle = "rgba(93, 255, 160, 0.28)"; g.lineWidth = 1; g.beginPath();
        for (let s2 = 0; s2 <= S; s2++) { const u = s2 / S, x = sx + 4 + u * (sw - 8), y = by + 4 - waveAt(b2, u) * scale * 1.6; s2 ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      let peak = 0;
      g.strokeStyle = c > 0.8 ? "#5dffa0" : hue; g.lineWidth = 2.2; g.shadowColor = g.strokeStyle; g.shadowBlur = 4 + 10 * c; g.beginPath();
      for (let s2 = 0; s2 <= S; s2++) { const u = s2 / S; let v = 0; for (let b2 = 0; b2 < n; b2++) v += waveAt(b2, u); peak = Math.max(peak, Math.abs(v)); const x = sx + 4 + u * (sw - 8), y = by + 4 - Math.max(-4.2, Math.min(4.2, v)) * scale; s2 ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.shadowBlur = 0;
      text(c > 0.8 ? `harmonics in step: boost x${peak.toFixed(1)}` : `interference: x${peak.toFixed(1)}`, sx + sw / 2, top + 13, { mono: true, size: 10, c: c > 0.8 ? "#5dffa0" : "rgba(93, 255, 160, 0.6)" });
      // The line to the light: each electron a change's worth of work. Out of tune, most leak out and never arrive.
      const lx = w - 34, wy = by + 4;
      g.strokeStyle = col.border; g.lineWidth = 2; g.beginPath(); g.moveTo(sx + sw, wy); g.lineTo(lx - 16, wy); g.stroke();
      for (let e = 0; e < 14; e++) {
        const p = (t * 0.45 + e / 14) % 1, x = sx + sw + (lx - 16 - sx - sw) * p, lost = ((e * 0.618) % 1) > c, leak = lost ? clamp01((p - 0.35) * 3) : 0;
        g.globalAlpha = 1 - leak; dot(x, wy + leak * 26, 2.6, lost && p > 0.35 ? col.bad : col.accent); g.globalAlpha = 1;
      }
      const glow = g.createRadialGradient(lx, wy, 2, lx, wy, 12 + 30 * c);
      glow.addColorStop(0, `rgba(255, 196, 92, ${0.15 + 0.85 * c})`); glow.addColorStop(1, "rgba(255, 196, 92, 0)");
      g.fillStyle = glow; g.beginPath(); g.arc(lx, wy, 12 + 30 * c, 0, Math.PI * 2); g.fill();
      dot(lx, wy, 9, `rgba(255, 196, 92, ${0.2 + 0.8 * c})`); dot(lx, wy, 9, col.border, false);
      text(`${Math.round(c * 100)}%`, lx, wy + 30 + 12 * c, { w: 700, size: 13, mono: true, c: hue });
      // Where the AI's time goes: the plumbing pile grows as the signal falls, and empties as it comes back.
      const bins = [["features", col.good], ["security", col.good], ["maintenance", col.good], ["plumbing: merge fights, rewrites", col.bad]];
      const bw = (w - 28) / 4, y0 = h - 92, ai = 12, plumbing = Math.round(ai * (1 - c) * 1.05);
      const counts = [0, 0, 0, 0];
      const checking = locked && c > 0.7 ? Math.floor(t / 1.6) % ai : -1, phase = (t / 1.6) % 1;
      bins.forEach(([name, cc], k) => { box(14 + k * bw + 3, y0, bw - 6, 64, k === 3 && plumbing > 3 ? col.bad : col.border, null); text(name, 14 + k * bw + bw / 2, y0 + 78, { mono: true, size: 10, c: k === 3 ? col.bad : col.muted }); });
      if (aiPos.length !== ai) aiPos = Array.from({ length: ai }, (_, j) => ({ x: 14 + (j % 3) * bw + bw / 2, y: y0 + 32 }));
      for (let j = 0; j < ai; j++) {
        const k = j >= ai - plumbing ? 3 : j % 3, slot = counts[k]++;
        let tx = 14 + k * bw + 14 + (slot % 4) * ((bw - 28) / 3), ty = y0 + 18 + Math.floor(slot / 4) * 16;
        if (j === checking && phase < 0.55) { tx = sx + sw / 2; ty = by + band / 2 - 10; }
        const q = aiPos[j]; q.x += (tx - q.x) * Math.min(1, dt * 4); q.y += (ty - q.y) * Math.min(1, dt * 4);
        const jit = k === 3 ? Math.sin(t * 17 + j) * 2 : 0;
        dot(q.x + jit, q.y, 5, k === 3 ? col.bad : col.accent);
        if (j === checking && phase > 0.25 && phase < 0.55) text("AI checks: nothing the matter", q.x, q.y - 12, { size: 11, w: 600, c: col.good });
      }
    },
    mervin(t, w, h) {
      const cols = [w * 0.38, w * 0.56, w * 0.74], mainX = w - 40, rows = 7;
      const waveOf = [0, 0, 1, 0, 2, 1, 0];
      g.strokeStyle = col.fg; g.lineWidth = 3; g.beginPath(); g.moveTo(mainX, 30); g.lineTo(mainX, h - 40); g.stroke();
      text("main", mainX, 22, { mono: true, size: 10, c: col.muted });
      cols.forEach((x, k) => { box(x - 22, 34, 44, h - 84, col.border, null); text(`wave ${k + 1}`, x, h - 36, { mono: true, size: 10, c: col.muted }); });
      for (let r = 0; r < rows; r++) {
        const y = 50 + r * ((h - 110) / (rows - 1)), wv = waveOf[r], start = 0.4 + wv * 1.6;
        const toCol = seg(t, 0.2 + r * 0.08, 1.4), toMain = seg(t, start + 1.2, start + 2.2);
        const card = r === 4 && t > 4.2;
        const x = 40 + (cols[wv] - 40) * toCol + (mainX - cols[wv]) * (card ? 0 : toMain);
        dot(x, y, 7, card ? col.bad : toMain >= 1 ? col.good : wv === 0 ? col.accent : col.fg);
        if (card) { box(x + 14, y - 14, 86, 28, col.bad, col.bg); text("one card", x + 57, y + 4, { size: 11, w: 600, c: col.bad }); }
      }
      text("no model, no tokens: line ids and rules", w * 0.2, h - 16, { mono: true, size: 11, c: col.muted });
    },
    hook(t, w, h) {
      const gx = w / 2, mode = hooks["before-ester"] ?? "off";
      box(gx - 40, 40, 80, h - 100, mode === "off" ? col.border : col.accent, col.bg);
      text("before-ester", gx, 34, { mono: true, size: 11, c: col.muted });
      text(mode === "off" ? "off: carry on" : mode === "ai" ? "an AI: yay or nay" : "a person: yay or nay", gx, h - 40, { w: 600, size: 13, c: mode === "off" ? col.muted : col.accent });
      for (let d = 0; d < 6; d++) {
        const p = ((t * 0.32 + d / 6) % 1), x = 30 + p * (w - 60), y = 60 + (d % 3) * ((h - 140) / 2);
        const nay = mode !== "off" && d === 2 && p > 0.45, at = Math.min(x, gx - 48);
        const bx = nay ? at - (p - 0.45) * 260 : x;
        dot(bx, y, 7, nay ? col.bad : p > 0.55 && mode !== "off" ? col.good : col.fg);
        if (nay && p < 0.8) text("nay: why", bx, y - 12, { size: 10, mono: true, c: col.bad });
      }
    },
    ester(t, w, h) {
      const names = ester.lanes.map((l) => `${l.name} · ${l.cadence}`), left = 150, top = 30, lh = (h - 60) / ester.lanes.length, gate = w * 0.6;
      ester.lanes.forEach((l, k) => {
        const y = top + k * lh + lh / 2;
        g.strokeStyle = col.border; g.lineWidth = 1; g.beginPath(); g.moveTo(left, y); g.lineTo(w - 20, y); g.stroke();
        text(names[k], 12, y + 4, { mono: true, size: 11, align: "left", c: k === 3 ? col.accent : col.fg });
        if (l.cadence === "bus") { box(gate - 40, y - 13, 80, 26, col.accent, null); }
        else box(gate - 14, y - 13, 28, 26, col.fg, null);
      });
      const aboard = ester.lanes.map(() => 0);
      for (const c of ester.changes) {
        const p = clamp01((t - c.at) / 2.2);
        if (p <= 0) continue;
        if (c.release && p > 0) text("release cut", left + 10, 18, { mono: true, size: 11, w: 700, c: col.accent, align: "left" });
        c.calls.forEach((call, k) => {
          const y = top + k * lh + lh / 2;
          if (call.go === "board") { if (call.leaves !== undefined && t > call.leaves) return; aboard[k]++; const x = left + (gate - 30 - left) * Math.min(p * 1.6, 1); const sx = Math.min(x, gate - 32 + (aboard[k] % 8) * 8); dot(sx, y + ((aboard[k] % 2) ? -5 : 5), 3.5, col.accent); return; }
          if (call.go === "depart") { if (p < 1) { const bx = gate + p * (w - gate); box(bx - 40, y - 13, 80, 26, col.accent, col.accent); text(call.ai ? "AI pass" : "one run", bx, y + 4, { size: 11, w: 700, c: "#fff" }); } return; }
          const x = left + (w - 20 - left) * p;
          if (call.go === "run") dot(x, y, 5, x > gate ? col.good : col.fg);
          else dot(x, y + 9, 3, col.muted, !call.owed);
        });
      }
      text("filled: tested · hollow: owed · faint: not its files", w - 20, h - 10, { mono: true, size: 10, c: col.muted, align: "right" });
    },
    yours(t, w, h) {
      const gx = w * 0.45, mode = hooks["after-ester"] ?? "off", ship = w - 70;
      box(gx - 36, 50, 72, h - 120, mode === "off" ? col.border : col.accent, col.bg);
      text(`after-ester: ${mode}`, gx, 42, { mono: true, size: 11, c: col.muted });
      box(ship - 50, 50, 100, h - 120, col.fg, col.fg);
      text("your code", ship, h / 2 - 12, { w: 700, size: 13, c: col.bg }); text("ship · deploy", ship, h / 2 + 6, { mono: true, size: 10, c: col.bg }); text("release", ship, h / 2 + 20, { mono: true, size: 10, c: col.bg });
      for (let d = 0; d < 7; d++) { const p = clamp01((t - d * 0.4) / 3), x = 30 + (ship - 64 - 30) * p, y = 66 + (d % 4) * ((h - 150) / 3); dot(x, y, 6, p >= 1 ? col.good : col.accent); }
    },
  };

  let raf = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    if (!el.isConnected) { alive = false; return; }
    const r = ROAD[i], sc = SCENES[r.id];
    let t = (now - t0) / 1000;
    if (reduced) t = sc.ms / 1000 * 0.85;
    else if (t * 1000 > sc.ms) { i = (i + 1) % ROAD.length; t0 = now; t = 0; }
    if (last !== i) {
      last = i; readCol(); drawRoad(ROAD[i].id);
      cap.classList.add("out"); setTimeout(() => { cap.querySelector("b").textContent = SCENES[ROAD[i].id].title; cap.querySelector("span").textContent = SCENES[ROAD[i].id].text; cap.classList.remove("out"); }, 150);
    }
    const w = canvas.clientWidth, h = H;
    g.clearRect(0, 0, w, h);
    dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    draw[r.id](t, w, h);
    el.querySelectorAll(".c-bar button").forEach((b, k) => { b.querySelector("b").style.width = k < i ? "100%" : k === i ? `${Math.min(100, (t * 1000 / sc.ms) * 100)}%` : "0"; });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { goto, scenes: ROAD.map((r) => r.id), stop() { alive = false; cancelAnimationFrame(raf); } };
}
