// The DOM half of gitwiz. gitwiz.ts has the math; this paints it (the commit graph as coins and lines on
// a board that narrows toward a vanishing point, and a runner on the hot path), plays and scrubs the
// history, and loads a pasted or uploaded file. build.ts bundles it to /gitwiz.js for gitwiz.html.
import {
  AHEAD, BEHIND, buildNotes, clampQ, clockAt, currentIndex, edgeSlotAt, formatAge, formatClock, geometry, layoutGraph,
  paceAt, pathSlotAt, project, qToScrub, readInput, runnerOffset, scoreAt, scrubToQ, slotX, stepQ, strideRate,
  type Geometry, type Input, type Layout, type Note,
} from "./gitwiz.ts";

declare const lucide: { createIcons(): void } | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const icons = () => {
  try { lucide?.createIcons(); } catch {}
  for (const s of document.querySelectorAll("svg.lucide:not([aria-hidden])")) s.setAttribute("aria-hidden", "true");
};

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];
const AVATAR_KEY = "gitwiz.avatar";

const board = $<HTMLCanvasElement>("board");
const ctx = board.getContext("2d")!;
const css = getComputedStyle(document.documentElement);
const tok = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
const INK = tok("--fg", "#0a0a0a"), PAPER = tok("--paper", "#fcfbf8"), ACCENT = tok("--accent", "#e8590c");
const MONO = tok("--mono", "monospace");

let input: Input | null = null;
let path = "";
let notes: Note[] = [];
let lay: Layout = layoutGraph([]);
let hotEdges = new Set<string>();
let q = 0;
let speed = 2;
let playing = false;
let shown = -2;                   // the note the card and numbers are showing
let hitAt = -1e9;                 // when the last note crossed, for the strum line's flash
let geo: Geometry = geometry(800, 500);
let last = 0;
let raf = 0;
// The runner: how hot it is running (smoothed), and how far through its stride.
let pace = 0, phase = 0;
let avatar: HTMLImageElement | null = null;

// -- loading ---------------------------------------------------------------------------------------

function toast(msg: string) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function load(source: unknown, from: string) {
  try {
    input = readInput(source);
  } catch (e) {
    toast(`${from}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  $("repo").textContent = input.repo;
  $("repo").title = input.repo ? `${input.repo}, ${input.files.length} file${input.files.length === 1 ? "" : "s"}` : "";
  document.title = input.repo ? `gitwiz: ${input.repo}` : "gitwiz";
  $<HTMLSelectElement>("file").innerHTML = input.files.map((f) => `<option value="${esc(f.path)}">${esc(f.path)} (${f.commits})</option>`).join("");
  pick(input.files[0]!.path);
  return true;
}

function pick(p: string) {
  if (!input?.histories[p]) return;
  path = p;
  $<HTMLSelectElement>("file").value = p;
  notes = buildNotes(input.histories[p]!);
  lay = layoutGraph(notes);
  hotEdges = new Set(lay.hot.slice(1).map((hi, k) => `${lay.hot[k]}-${hi}`));
  const forks = lay.lanes - 1;
  $("lanenote").innerHTML = `${icon("git-branch")}${forks > 0 ? `${forks} side lane${forks === 1 ? "" : "s"}` : "one line"}, main in the middle`;
  playing = false;
  q = 0; shown = -2; pace = 0; phase = 0;
  $("empty").hidden = true;
  icons(); refresh();
}

// -- the numbers and the card ----------------------------------------------------------------------

const bumpEl = (el: HTMLElement, cls = "bump") => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const n0 = (n: number) => n.toLocaleString("en-US");

function refresh() {
  q = clampQ(q, notes.length);
  const idx = currentIndex(q, notes.length);
  const first = notes[0]?.t ?? 0;
  const now = clockAt(notes, q);
  $("clock").textContent = notes.length ? formatClock(now) : "";
  $("age").textContent = notes.length ? formatAge(now, first) : "";
  $<HTMLInputElement>("scrub").value = String(qToScrub(q, notes.length));
  $("speedv").textContent = `${speed}/s`;
  if ($("play").dataset.on !== String(playing)) { $("play").dataset.on = String(playing); $("play").innerHTML = icon(playing ? "pause" : "play"); icons(); }
  $("play").title = playing ? "Pause (Space)" : "Play (Space)";
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  if (idx !== shown) {
    const up = idx > shown && shown !== -2;
    shown = idx;
    const s = scoreAt(notes, lay.onHot, idx);
    $("v-commits").textContent = n0(s.passed);
    $("v-total").textContent = `/${n0(notes.length)}`;
    $("v-combo").textContent = String(s.combo);
    $("v-score").textContent = n0(s.score);
    $("card").innerHTML = idx < 0 ? cardIdle() : cardFor(notes[idx]!);
    if (up) {
      for (const id of ["card", "s-commits", "s-combo", "s-score"]) bumpEl($(id));
      hitAt = performance.now();
    }
    icons();
  }
  if (!playing) pace = paceAt(notes, lay.hot, idx);
  draw();
}

const cardIdle = () => `<div class="meta">${icon("git-commit-horizontal")}<span class="who">${esc(path)}</span></div>
  <div class="subject muted">${notes.length ? `${n0(notes.length)} commits wait at the far end. Press Space and follow the hot path.` : "No commits."}</div>`;

function cardFor(n: Note) {
  const on = lay.onHot[n.i];
  return `<div class="meta"><span class="hash" title="${esc(n.hash)}">${esc(n.short)}</span><span class="who" title="${esc(n.author)}">${esc(n.author)}</span>
    ${n.refs.slice(0, 2).map((r) => `<span class="ref" title="${esc(r)}">${icon("git-branch")}${esc(r)}</span>`).join("")}
    ${on ? "" : `<span class="ref off" title="On a side branch. The runner keeps to the hot path, so this breaks the combo">${icon("git-fork")}side</span>`}
    <span class="grow"></span><span class="when">${esc(formatClock(n.t))}</span>
    <span class="delta"><b class="a">+${n0(n.added)}</b><b class="r">-${n0(n.removed)}</b></span></div>
    <div class="subject" title="${esc(n.subject)}">${esc(n.subject) || "(no subject)"}</div>`;
}

// -- drawing ---------------------------------------------------------------------------------------

function resize() {
  const r = board.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  board.width = Math.max(1, Math.round(r.width * dpr));
  board.height = Math.max(1, Math.round(r.height * dpr));
  geo = geometry(r.width, r.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

const rgba = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};
/** A size that grows with the canvas, within reason. */
const unit = () => Math.min(1.3, Math.max(0.7, geo.half / 260));
/** A lane's slot at depth d, on screen. */
const onBoard = (slot: number, d: number) => project(geo, slotX(slot, lay.extent), d);

function draw() {
  const g = geo;
  ctx.clearRect(0, 0, g.w, g.h);
  const frac = q - Math.floor(q + 1e-9);

  // The board: a paper strip that narrows to the vanishing point and fades out as it gets there.
  const bl = project(g, -1, -BEHIND), br = project(g, 1, -BEHIND), tl = project(g, -1, AHEAD), tr = project(g, 1, AHEAD);
  const fade = ctx.createLinearGradient(0, g.horizon, 0, g.strum);
  fade.addColorStop(0, rgba("#fcfbf8", 0)); fade.addColorStop(0.5, rgba("#f6f3ec", 0.85)); fade.addColorStop(1, "#f3efe6");
  ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath();
  ctx.fillStyle = fade; ctx.fill();
  for (const lx of [-1, 1]) {
    const p = project(g, lx, -BEHIND), far = project(g, lx, AHEAD);
    const grad = ctx.createLinearGradient(p.x, p.y, g.cx, g.horizon);
    grad.addColorStop(0, rgba("#8a8578", 0.9)); grad.addColorStop(1, rgba("#b9b4a6", 0));
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(far.x, far.y); ctx.stroke();
  }

  // Frets: one a commit apart, sliding toward the viewer as the history plays.
  for (let m = -1; m <= AHEAD; m++) {
    const d = m - frac;
    const a = project(g, -1, d), b = project(g, 1, d);
    ctx.strokeStyle = rgba("#a39d8c", Math.max(0, Math.min(0.5, a.s * 0.8)) * (d < 0 ? Math.max(0, 1 + d / 0.5) : 1));
    ctx.lineWidth = Math.max(0.5, 1.2 * a.s);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // The strum line goes under everything that crosses it.
  const since = performance.now() - hitAt, flash = since < 380 ? 1 - since / 380 : 0;
  const sa = project(g, -1, 0), sb = project(g, 1, 0);
  ctx.strokeStyle = flash ? ACCENT : INK; ctx.lineWidth = 2.5 + flash * 3;
  ctx.beginPath(); ctx.moveTo(sa.x - 6, sa.y); ctx.lineTo(sb.x + 6, sb.y); ctx.stroke();

  // The graph's lines still in view: the side branches first, the hot path on top.
  const tMin = q - 1 - 0.3, tMax = q - 1 + AHEAD;
  const seen = lay.edges.filter((e) => e.lo <= tMax && e.hi >= tMin);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const hot of [false, true]) {
    for (const e of seen) {
      if (hotEdges.has(`${e.lo}-${e.hi}`) !== hot) continue;
      const from = Math.max(e.lo, tMin), to = Math.min(e.hi, tMax);
      ctx.beginPath();
      for (let t = from; ; t = Math.min(to, t + 0.2)) {
        const p = onBoard(edgeSlotAt(lay, e, t), t + 1 - q);
        if (t === from) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        if (t >= to) break;
      }
      const s = onBoard(0, Math.max(-0.3, (from + to) / 2 + 1 - q)).s;
      ctx.strokeStyle = hot ? ACCENT : "#9c9686";
      ctx.lineWidth = Math.max(0.8, (hot ? 3.2 : 2) * s * unit());
      ctx.stroke();
    }
  }

  // Coins, far to near, so the near ones sit on top.
  const lo = Math.max(0, Math.floor(q) - 1), hi = Math.min(notes.length - 1, Math.ceil(q) + AHEAD);
  for (let i = hi; i >= lo; i--) {
    const d = i + 1 - q;
    if (d > AHEAD || d < -0.25) continue;
    coin(notes[i]!, d, i === currentIndex(q, notes.length));
  }

  runner();
}

function coin(n: Note, d: number, now: boolean) {
  const g = geo;
  const p = onBoard(lay.slot[n.i]!, d);
  const slotW = ((g.half * 2) / (2 * lay.extent + 1)) * p.s;
  const r = Math.max(2.5, Math.min(slotW * 0.45, (8 + 11 * n.size) * p.s * unit()));
  const hot = lay.onHot[n.i];
  const gone = d < 0 ? Math.max(0, 1 + d / 0.25) : 1;
  ctx.save();
  ctx.globalAlpha = gone * Math.min(1, 0.4 + p.s * 1.4);
  // The glow is the lines changed: nothing for a one-liner, a soft halo for a big one.
  if (n.size > 0.3) { ctx.shadowColor = n.kind !== "remove" ? rgba(ACCENT, 0.55) : "rgba(100,100,100,.5)"; ctx.shadowBlur = 24 * n.size * p.s; }
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = PAPER; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  ctx.save(); ctx.clip();
  const split = p.x - r + 2 * r * n.addShare;
  ctx.fillStyle = n.kind === "remove" ? "#e2e2e2" : "#f8c9a1"; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  if (n.kind === "rewrite") { ctx.fillStyle = "#e2e2e2"; ctx.fillRect(split, p.y - r, p.x + r - split, 2 * r); }
  ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(p.x - r, p.y - r, 2 * r, r * 0.55);
  ctx.restore();
  ctx.lineWidth = now ? 2.4 : Math.max(0.8, (hot ? 2 : 1.3) * p.s * unit());
  ctx.strokeStyle = now ? INK : hot ? ACCENT : n.kind === "remove" ? "#8f8f8f" : "#b9b4a6";
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
  if (n.refs.length && p.s > 0.4 && gone === 1) {
    ctx.font = `600 ${Math.round(11 * Math.min(1.1, p.s))}px ${MONO}`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const label = n.refs[0]!.length > 22 ? n.refs[0]!.slice(0, 21) + "…" : n.refs[0]!;
    const w = ctx.measureText(label).width + 10, x = p.x + r + 6, h = 16 * Math.min(1.1, p.s);
    ctx.fillStyle = PAPER; ctx.strokeStyle = "#cfcfcf"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, p.y - h / 2, w, h, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.fillText(label, x + 5, p.y + 0.5);
  }
  ctx.restore();
}

// -- the runner ------------------------------------------------------------------------------------
// An orange shirt, black shorts with an orange cloud on them, a Mii-style head (or the face you gave
// it). It runs toward you along the hot path: pulling ahead when the code is hot, falling back as it cools.

function runner() {
  if (!notes.length) return;
  const off = runnerOffset(pace);
  const p = onBoard(pathSlotAt(lay, q - 1 + off), off);
  const H = 92 * p.s * unit();
  if (H < 8) return;
  const u = H / 10.5;
  const sw = Math.sin(phase), bob = playing ? Math.abs(Math.cos(phase)) * 0.35 * u : 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(0, 0, 3.4 * u, 0.8 * u, 0, 0, 7); ctx.fill();
  ctx.lineCap = "round";
  const SKIN = "#f2c9a0", SKIN_EDGE = "#c79a72";
  // Legs: one foot lifts while the other plants.
  const hipY = -3.2 * u - bob;
  for (const side of [-1, 1]) {
    const lift = playing ? Math.max(0, side * sw) * 1.7 * u : 0;
    ctx.strokeStyle = SKIN_EDGE; ctx.lineWidth = 1.25 * u;
    ctx.beginPath(); ctx.moveTo(side * 0.95 * u, hipY); ctx.lineTo(side * 1.05 * u, -0.4 * u - lift); ctx.stroke();
    ctx.strokeStyle = SKIN; ctx.lineWidth = 1 * u;
    ctx.beginPath(); ctx.moveTo(side * 0.95 * u, hipY); ctx.lineTo(side * 1.05 * u, -0.4 * u - lift); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, 0.12 * u);
    ctx.beginPath(); ctx.ellipse(side * 1.15 * u, -0.45 * u - lift, 0.95 * u, 0.55 * u, 0, 0, 7); ctx.fill(); ctx.stroke();
  }
  // Arms swing against the legs.
  for (const side of [-1, 1]) {
    const swing = playing ? -side * sw : 0;
    const hx = side * (2.9 + 0.2 * swing) * u, hy = (-4.9 - 1.3 * swing) * u - bob;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 0.95 * u;
    ctx.beginPath(); ctx.moveTo(side * 2.1 * u, -6.9 * u - bob); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy, 0.55 * u, 0, 7); ctx.fill();
  }
  // Shorts, black, with the cloud.
  ctx.fillStyle = "#111"; ctx.beginPath(); ctx.roundRect(-1.95 * u, -5.0 * u - bob, 3.9 * u, 2.1 * u, 0.5 * u); ctx.fill();
  cloud(0, -4.15 * u - bob, 1.9 * u);
  // Shirt, orange, with its short sleeves.
  ctx.fillStyle = ACCENT; ctx.strokeStyle = "#c2410c"; ctx.lineWidth = Math.max(0.8, 0.12 * u);
  ctx.beginPath(); ctx.roundRect(-2.05 * u, -7.7 * u - bob, 4.1 * u, 2.9 * u, 0.7 * u); ctx.fill(); ctx.stroke();
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 2.15 * u, -7.0 * u - bob, 0.85 * u, 0, 7); ctx.fill(); }
  head(0, -9.1 * u - bob, 1.55 * u);
  ctx.restore();
}

/** A small cloud, drawn from circles: a stand-in for the logo, not the real mark. */
function cloud(cx: number, cy: number, w: number) {
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - w * 0.12, w, w * 0.34, w * 0.17);
  ctx.arc(cx - w * 0.17, cy - w * 0.12, w * 0.2, 0, 7);
  ctx.arc(cx + w * 0.1, cy - w * 0.17, w * 0.27, 0, 7);
  ctx.fill();
}

function head(x: number, y: number, r: number) {
  ctx.save();
  if (avatar && avatar.complete && avatar.naturalWidth) {
    ctx.beginPath(); ctx.arc(x, y, r * 1.12, 0, 7); ctx.fillStyle = PAPER; ctx.fill(); ctx.save(); ctx.clip();
    const s = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    ctx.drawImage(avatar, (avatar.naturalWidth - s) / 2, (avatar.naturalHeight - s) / 2, s, s, x - r * 1.12, y - r * 1.12, r * 2.24, r * 2.24);
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, r * 0.1); ctx.beginPath(); ctx.arc(x, y, r * 1.12, 0, 7); ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.lineWidth = Math.max(0.8, r * 0.08); ctx.strokeStyle = "#c79a72";
  for (const side of [-1, 1]) { ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(x + side * r * 0.98, y + r * 0.1, r * 0.22, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#3b2a20"; // hair: a cap and a fringe
  ctx.beginPath(); ctx.arc(x, y, r * 1.04, Math.PI * 1.04, Math.PI * 1.96); ctx.quadraticCurveTo(x + r * 0.3, y - r * 0.5, x, y - r * 0.55); ctx.quadraticCurveTo(x - r * 0.4, y - r * 0.45, x - r * 1.0, y - r * 0.28); ctx.fill();
  ctx.fillStyle = "#1b1b1b";
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + side * r * 0.36, y + r * 0.1, r * 0.1, r * 0.15, 0, 0, 7); ctx.fill(); }
  ctx.strokeStyle = "#8a4b3a"; ctx.lineWidth = Math.max(0.8, r * 0.09);
  ctx.beginPath(); ctx.arc(x, y + r * 0.28, r * 0.3, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  ctx.fillStyle = "rgba(232,89,12,.18)";
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(x + side * r * 0.62, y + r * 0.38, r * 0.17, 0, 7); ctx.fill(); }
  ctx.restore();
}

// -- the face you gave it --------------------------------------------------------------------------

function setAvatar(url: string | null) {
  if (!url) { avatar = null; draw(); return; }
  const img = new Image();
  img.onload = () => { avatar = img; draw(); };
  img.onerror = () => { avatar = null; toast("Couldn't read that picture"); };
  img.src = url;
}

/** A picked picture, cut square and shrunk to a 96px head so it's small enough to remember. */
function readAvatar(f: File) {
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96);
    URL.revokeObjectURL(url);
    const data = c.toDataURL("image/png");
    try { localStorage.setItem(AVATAR_KEY, data); } catch {}
    setAvatar(data); toast("That's the runner now. Shift+A puts the default head back.");
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(`${f.name} isn't a picture I can read`); };
  img.src = url;
}

// -- playing ---------------------------------------------------------------------------------------

function frame(t: number) {
  raf = 0;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (playing) {
    q += dt * speed;
    if (q >= notes.length) { q = notes.length; playing = false; }
    // The runner eases toward how hot the path is: that is the falling back and the catching up.
    pace += (paceAt(notes, lay.hot, currentIndex(q, notes.length)) - pace) * Math.min(1, dt * 2.5);
    phase += dt * strideRate(pace) * Math.PI;
    refresh();
  } else draw();
  // Keep going while playing, and while the strum line is still flashing.
  if (playing || performance.now() - hitAt < 420) raf = requestAnimationFrame(frame);
}
const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

function play(on = !playing) {
  if (!notes.length) return;
  if (on && q >= notes.length) q = 0;
  playing = on;
  refresh(); wake();
}
const seek = (to: number) => { q = clampQ(to, notes.length); refresh(); wake(); };
const faster = (by: number) => {
  const k = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + by));
  speed = SPEEDS[k]!; refresh();
};

// -- controls --------------------------------------------------------------------------------------

$("play").onclick = () => play();
$("home").onclick = () => seek(0);
$("end").onclick = () => seek(notes.length);
$("back").onclick = () => seek(stepQ(q, -1, notes.length));
$("fwd").onclick = () => seek(stepQ(q, 1, notes.length));
$("slow").onclick = () => faster(-1);
$("fast").onclick = () => faster(1);
$<HTMLSelectElement>("file").onchange = (e) => pick((e.target as HTMLSelectElement).value);
$<HTMLInputElement>("scrub").oninput = (e) => seek(scrubToQ(Number((e.target as HTMLInputElement).value), notes.length));
board.onclick = () => play();
board.addEventListener("wheel", (e) => { e.preventDefault(); seek(q + e.deltaY / 90); }, { passive: false });

const tipBtn = $<HTMLButtonElement>("tipbtn"), tip = $("tip");
const showTip = (on: boolean) => { tip.hidden = !on; tipBtn.setAttribute("aria-expanded", String(on)); };
tipBtn.onclick = () => showTip(!!tip.hidden);
tipBtn.onmouseenter = () => showTip(true);
tipBtn.onmouseleave = () => showTip(false);

const pick$ = $<HTMLInputElement>("pick"), face$ = $<HTMLInputElement>("facepick"), paste = $<HTMLDialogElement>("pastebox");
const openFile = () => pick$.click();
const openFace = () => face$.click();
const resetFace = () => { try { localStorage.removeItem(AVATAR_KEY); } catch {} setAvatar(null); toast("Back to the default head"); };
const openPaste = () => { $("pasterr").textContent = ""; paste.showModal(); $("pastetext").focus(); };
$("open").onclick = openFile;
$("paste").onclick = openPaste;
$("face").onclick = (e) => (e.shiftKey ? resetFace() : openFace());
$("pastecancel").onclick = () => paste.close();
$("pastego").onclick = () => {
  try { readInput($<HTMLTextAreaElement>("pastetext").value); } catch (e) { $("pasterr").textContent = e instanceof Error ? e.message : String(e); return; }
  if (load($<HTMLTextAreaElement>("pastetext").value, "pasted JSON")) paste.close();
};
const readFile = async (f: File) => {
  if (f.type.startsWith("image/")) { readAvatar(f); return; }
  if (load(await f.text(), f.name)) toast(`Loaded ${f.name}`);
};
pick$.onchange = () => { const f = pick$.files?.[0]; if (f) void readFile(f); pick$.value = ""; };
face$.onchange = () => { const f = face$.files?.[0]; if (f) readAvatar(f); face$.value = ""; };
window.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("drop"); });
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("drop"); });
window.addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("drop"); const f = e.dataTransfer?.files[0]; if (f) void readFile(f); });

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest("dialog")) return;
  if (t.matches("textarea, select, input[type=text]")) return;
  const k = e.key;
  // A focused button keeps its own Space and Enter.
  if ((k === " " || k === "Enter") && t.closest("button, a")) return;
  const step = e.shiftKey ? 10 : 1;
  const act: Record<string, () => void> = {
    " ": () => play(),
    ArrowRight: () => seek(stepQ(q, step, notes.length)),
    ArrowLeft: () => seek(stepQ(q, -step, notes.length)),
    Home: () => seek(0), End: () => seek(notes.length),
    "]": () => faster(1), "[": () => faster(-1), "+": () => faster(1), "-": () => faster(-1),
    f: () => $("file").focus(), F: () => $("file").focus(),
    o: openFile, O: openFile, p: openPaste, P: openPaste,
    a: openFace, A: resetFace,
    "?": () => showTip(!!tip.hidden), "/": () => showTip(!!tip.hidden),
    Escape: () => showTip(false),
  };
  const fn = act[k];
  if (!fn) return;
  e.preventDefault();
  fn();
});

new ResizeObserver(resize).observe(board);

// -- start -----------------------------------------------------------------------------------------

$("empty").hidden = false;
refresh();
icons();
try { const saved = localStorage.getItem(AVATAR_KEY); if (saved) setAvatar(saved); } catch {}
fetch("/gitwiz-sample.json").then((r) => r.json()).then((j) => { load(j, "the sample"); resize(); })
  .catch(() => { $("empty").textContent = "Open or paste a history to begin (O, P)"; });

// A handle for the console (window.gitwiz.seek(40)).
(window as unknown as { gitwiz: unknown }).gitwiz = { seek, play, get q() { return q; }, get notes() { return notes; }, get layout() { return lay; } };
