// The DOM half of gitpath. gitpath.ts has the math; this paints it (the commit graph as coins and lines on
// a board that narrows toward a vanishing point), plays it, scrubs it by date on the rail, loads a pasted
// or uploaded file, and runs the game: a unicyclist on the hot path, pedalled with taps. build.ts
// bundles it to /gitpath.js for gitpath.html.
import {
  AHEAD, BEHIND, RIDE, buildNotes, clampQ, clockAt, currentIndex, edgeSlotAt, eventPush, filterRange, formatAge, formatClock,
  geometry, gustRide, layoutGraph, newRide, pathSlotAt, project, qAtFrac, readInput, remount, rideEvents, scoreAt, slotX,
  stepQ, stepRide, tapRide, timeFracAt, timeTicks, breeze, topFriends, veinChart,
  type Geometry, type Input, type Layout, type Note, type RideEvent, type Side,
} from "./gitpath.ts";

declare const lucide: { createIcons(): void } | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const icons = () => {
  try { lucide?.createIcons(); } catch {}
  for (const s of document.querySelectorAll("svg.lucide:not([aria-hidden])")) s.setAttribute("aria-hidden", "true");
};

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];
const AVATAR_KEY = "gitpath.avatar";
const KEYS_KEY = "gitpath.keys";
/** Where the rider sits on the board, in commits ahead of the strum line. */
const RIDER_AT = 0.9;

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
let avatar: HTMLImageElement | null = null;
// The game: off until the controller is clicked. `running` waits for the first tap, so the rider doesn't tip over before you start.
let gameOn = false, running = false;
let ride = newRide();
let events: RideEvent[] = [];
let eventAt = new Map<number, RideEvent>();
let falls = 0, wheel = 0;
let crash: { at: number; dir: number } | null = null;
let tapFlash = { at: -1e9, side: 1 as Side, grade: 0 };
let binds: { l: string; r: string } = { l: "z", r: "m" };
let rebinding: "l" | "r" | null = null;
try { const k = JSON.parse(localStorage.getItem(KEYS_KEY) ?? "null"); if (k && typeof k.l === "string" && typeof k.r === "string" && k.l !== k.r) binds = { l: k.l, r: k.r }; } catch {}

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
  document.title = input.repo ? `gitpath: ${input.repo}` : "gitpath";
  $<HTMLSelectElement>("file").innerHTML = input.files.map((f) => `<option value="${esc(f.path)}">${esc(f.path)} (${f.commits})</option>`).join("");
  pick(input.files[0]!.path);
  return true;
}

const from$ = $<HTMLInputElement>("from"), to$ = $<HTMLInputElement>("to");
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Shows file `p`, cropped to the dates in the two boxes when `keepRange` (a new file starts with the whole history). */
function pick(p: string, keepRange = false) {
  const full = input?.histories[p];
  if (!full) return;
  path = p;
  $<HTMLSelectElement>("file").value = p;
  if (!keepRange) { from$.value = ""; to$.value = ""; }
  from$.min = to$.min = dayOf(Date.parse(full[0]!.date));
  from$.max = to$.max = dayOf(Date.parse(full[full.length - 1]!.date));
  let kept = filterRange(full, from$.value, to$.value);
  if (!kept.length) { toast("No commits between those days"); from$.value = ""; to$.value = ""; kept = full; }
  $("unrange").hidden = !from$.value && !to$.value;
  notes = buildNotes(kept);
  drawFriends(kept);
  lay = layoutGraph(notes);
  events = rideEvents(notes, lay);
  eventAt = new Map(events.map((e) => [e.i, e]));
  ride = newRide(); running = false; crash = null; falls = 0;
  buildRail();
  hotEdges = new Set(lay.hot.slice(1).map((hi, k) => `${lay.hot[k]}-${hi}`));
  const forks = lay.lanes - 1;
  $("lanenote").innerHTML = `${icon("git-branch")}${forks > 0 ? `${forks} side lane${forks === 1 ? "" : "s"}` : "one line"}, main in the middle`;
  playing = false;
  q = 0; shown = -2;
  $("empty").hidden = true;
  icons(); refresh();
}

// -- friends: the top 8 authors of this file, each with a small vein chart on one shared clock ----------

const friends$ = $("friends"), friendsBtn = $<HTMLButtonElement>("friendsbtn");

function drawFriends(commits: Parameters<typeof topFriends>[0]) {
  const from = Date.parse(commits[0]?.date ?? ""), to = Date.parse(commits[commits.length - 1]?.date ?? "");
  const rows = topFriends(commits).map((f, k) => {
    const v = veinChart(f.commits, from, to);
    const X = (x: number) => (3 + x * 94).toFixed(1), Y = (y: number) => (14 + y * 9).toFixed(1);
    const links = v.links.map((l) => `<line class="link${l.hot ? " hot" : ""}" x1="${X(v.dots[l.lo]!.x)}" y1="${Y(v.dots[l.lo]!.y)}" x2="${X(v.dots[l.hi]!.x)}" y2="${Y(v.dots[l.hi]!.y)}"/>`).join("");
    const dots = v.dots.map((d) => `<circle class="dot ${d.kind}" cx="${X(d.x)}" cy="${Y(d.y)}" r="${(1.4 + d.r * 2.4).toFixed(1)}"/>`).join("");
    return `<div class="f"><span class="n">${k + 1}</span><span class="who" title="${esc(f.name)}">${esc(f.name)}<small>${f.commits.length} commit${f.commits.length === 1 ? "" : "s"}, +${f.added} -${f.removed}</small></span>` +
      `<svg viewBox="0 0 100 28" role="img" aria-label="${esc(f.name)}'s vein chart">${links}${dots}</svg></div>`;
  });
  friends$.innerHTML = `<h2>Top 8 friends</h2>${rows.join("")}`;
}

const showFriends = (on: boolean) => { friends$.hidden = !on; friendsBtn.setAttribute("aria-pressed", String(on)); };
friendsBtn.onclick = () => showFriends(!!friends$.hidden);

// -- the rail: time, oldest at the bottom ----------------------------------------------------------

const rail = $("rail"), track = $("rail-track");

function buildRail() {
  const first = notes[0]?.t ?? 0, last = notes[notes.length - 1]?.t ?? 0, span = last - first;
  $("rail-old").textContent = notes.length ? formatClock(first).slice(0, 10) : "";
  $("rail-new").textContent = notes.length ? formatClock(last).slice(0, 10) : "";
  const at = (f: number) => `${((1 - f) * 100).toFixed(2)}%`;
  const dashes = span > 0 && notes.length <= 600 ? notes.map((n) => `<i class="dash" style="top:${at((n.t - first) / span)}"></i>`).join("") : "";
  const ticks = timeTicks(first, last).map((t) => `<span class="tick" style="top:${at(t.frac)}">${esc(t.label)}</span>`).join("");
  track.querySelectorAll(".dash, .tick").forEach((el) => el.remove());
  track.insertAdjacentHTML("afterbegin", dashes + ticks);
}

function drawRail() {
  const f = timeFracAt(notes, q);
  $("rail-thumb").style.top = `${(1 - f) * 100}%`;
  $("rail-fill").style.height = `calc(${f * 100}% - 6px * ${f})`;
  rail.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  rail.setAttribute("aria-valuetext", notes.length ? formatClock(clockAt(notes, q)) : "");
}

const railTo = (e: PointerEvent) => {
  const r = track.getBoundingClientRect();
  seek(qAtFrac(notes, 1 - (e.clientY - r.top) / r.height));
};
rail.onpointerdown = (e) => { rail.setPointerCapture(e.pointerId); railTo(e); };
rail.onpointermove = (e) => { if (rail.hasPointerCapture(e.pointerId)) railTo(e); };

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
  drawRail();
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
  if (gameOn) {
    $("g-speedv").textContent = ride.speed.toFixed(1);
    $("g-fallsv").textContent = String(falls);
  }
  draw();
}

const cardIdle = () => `<div class="meta">${icon("git-commit-horizontal")}<span class="who">${esc(path)}</span></div>
  <div class="subject muted">${notes.length ? `${n0(notes.length)} commits wait at the far end. Press Space, or the faint controller for the ride.` : "No commits."}</div>`;

function cardFor(n: Note) {
  const on = lay.onHot[n.i];
  return `<div class="meta"><span class="hash" title="${esc(n.hash)}">${esc(n.short)}</span><span class="who" title="${esc(n.author)}">${esc(n.author)}</span>
    ${n.refs.slice(0, 2).map((r) => `<span class="ref" title="${esc(r)}">${icon("git-branch")}${esc(r)}</span>`).join("")}
    ${on ? "" : `<span class="ref off" title="On a side branch. A side-branch commit breaks the combo">${icon("git-fork")}side</span>`}
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

  if (gameOn) { road(); rider(); wind(); hud(); }
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

// -- the ride --------------------------------------------------------------------------------------
// A small unicyclist in an orange shirt, seen from behind, riding the hot path away from us. Git is the
// road: a merge is a car coming in from its side lane, a fork is a fork in the road, a new branch is a
// fallen branch, a big squash merge is a boulder. (Sprites are drawn from the notes; the gusts that
// go with them are the ride's, in gitpath.ts.)

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** The event sprites, far to near. `d` is commits ahead of the strum line, so the rider is at RIDER_AT. */
function road() {
  for (const e of [...events].reverse()) {
    const d = e.i + 1 - q;
    if (d > AHEAD || d < RIDER_AT - 0.6) continue;
    const p = onBoard(lay.slot[e.i]!, d);
    const S = p.s * unit();
    if (S < 0.12) continue;
    // 0 far away, 1 as it reaches the rider.
    const come = ease(1 - (d - RIDER_AT) / 4);
    const side = e.side, lane = geo.half * p.s;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.3 + p.s * 1.6) * Math.max(0, Math.min(1, (d - RIDER_AT + 0.6) / 0.4));
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (e.kind === "merge") {
      // A car, nose on, coming in from its side lane.
      const x = p.x + side * lane * (1.4 - 1.05 * come), y = p.y, w = 30 * S, h = 15 * S;
      ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.ellipse(x, y + 0.5 * S, w * 0.6, 2.5 * S, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#222"; for (const k of [-1, 1]) ctx.fillRect(x + k * w * 0.42 - 2.5 * S, y - 4 * S, 5 * S, 4.5 * S);
      ctx.fillStyle = ACCENT; ctx.strokeStyle = "#c2410c"; ctx.lineWidth = Math.max(0.8, 1.2 * S);
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - h, w, h * 0.7, 3 * S); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAPER; ctx.beginPath(); ctx.roundRect(x - w * 0.34, y - h * 1.5, w * 0.68, h * 0.62, 3 * S); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffe08a"; for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(x + k * w * 0.34, y - h * 0.55, 2 * S, 0, 7); ctx.fill(); }
    } else if (e.kind === "fork") {
      // A table fork standing in the road, tines up.
      const h = 34 * S, x = p.x;
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 2.4 * S);
      ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y - h * 0.62);
      ctx.moveTo(x - 6 * S, p.y - h * 0.62); ctx.lineTo(x + 6 * S, p.y - h * 0.62);
      for (const k of [-6, 0, 6]) { ctx.moveTo(x + k * S, p.y - h * 0.62); ctx.lineTo(x + k * S, p.y - h); }
      ctx.stroke();
    } else if (e.kind === "branch") {
      // A fallen branch, across the lane with twigs.
      const x = p.x, y = p.y - 2 * S, w = 36 * S;
      ctx.strokeStyle = "#8a5a3c"; ctx.lineWidth = Math.max(1, 3.2 * S);
      ctx.beginPath(); ctx.moveTo(x - w, y + 3 * S); ctx.quadraticCurveTo(x, y - 5 * S, x + w, y); ctx.stroke();
      ctx.lineWidth = Math.max(0.8, 1.6 * S);
      ctx.beginPath(); for (const k of [-0.5, 0, 0.45]) { ctx.moveTo(x + k * w, y - 1 * S); ctx.lineTo(x + k * w + 5 * S, y - 12 * S); } ctx.stroke();
      ctx.fillStyle = "#5f9b4b"; for (const k of [-0.5, 0, 0.45]) { ctx.beginPath(); ctx.ellipse(x + k * w + 5 * S, y - 13 * S, 3 * S, 2 * S, 0.6, 0, 7); ctx.fill(); }
    } else {
      // A boulder, rolling in on a hop.
      const x = p.x + side * lane * (0.9 - 0.8 * come), r = 13 * S, hop = Math.abs(Math.sin(d * 3.4)) * 16 * S * (1 - come * 0.6);
      ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.ellipse(x, p.y + 0.5 * S, r * 0.9, 2.5 * S, 0, 0, 7); ctx.fill();
      ctx.translate(x, p.y - r - hop); ctx.rotate(d * 2.2 * side);
      ctx.fillStyle = "#b7b3a8"; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, 1.4 * S);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#8a8578"; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, r * 0.35, 3, 5.4); ctx.moveTo(r * 0.2, r * 0.3); ctx.lineTo(r * 0.6, r * 0.55); ctx.stroke();
    }
    ctx.restore();
  }
}

function rider() {
  if (!notes.length) return;
  const p = onBoard(pathSlotAt(lay, q - 1 + RIDER_AT), RIDER_AT);
  const H = 54 * p.s * unit();
  if (H < 6) return;
  const u = H / 10.5, now = performance.now();
  // A spill tips the rider over to the side it fell, then slides it off the board.
  const slip = crash ? Math.min(1, (now - crash.at) / 700) : 0;
  const tilt = crash ? crash.dir * (0.5 + 1.1 * ease(slip)) : ride.lean * 0.5;
  const SKIN = "#f2c9a0", EDGE = "#c79a72";
  ctx.save();
  ctx.translate(p.x + (crash ? crash.dir * slip * 5 * u : 0), p.y);
  ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(0, 0, 3.2 * u, 0.75 * u, 0, 0, 7); ctx.fill();
  ctx.rotate(tilt);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const hub = -2.2 * u;
  // The wheel and its spokes.
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 0.5 * u);
  ctx.beginPath(); ctx.arc(0, hub, 2.2 * u, 0, 7); ctx.stroke();
  ctx.lineWidth = Math.max(0.5, 0.12 * u); ctx.strokeStyle = "#6b6b6b";
  ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = wheel + (k * Math.PI) / 2.5; ctx.moveTo(0, hub); ctx.lineTo(Math.cos(a) * 2.0 * u, hub + Math.sin(a) * 2.0 * u); } ctx.stroke();
  // Frame and seat.
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 0.5 * u);
  ctx.beginPath(); ctx.moveTo(0, hub); ctx.lineTo(0, -5.3 * u); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(-1.2 * u, -5.7 * u, 2.4 * u, 0.7 * u, 0.35 * u); ctx.fill();
  // Legs, hip to pedal, the cranks half a turn apart.
  const a = ride.crank * 2 * Math.PI;
  for (const side of [-1, 1]) {
    const px = Math.cos(a + (side > 0 ? 0 : Math.PI)) * 0.9 * u + side * 0.9 * u, py = hub + Math.sin(a + (side > 0 ? 0 : Math.PI)) * 0.9 * u;
    ctx.strokeStyle = EDGE; ctx.lineWidth = 1.3 * u; ctx.beginPath(); ctx.moveTo(side * 0.8 * u, -5.9 * u); ctx.lineTo(px, py); ctx.stroke();
    ctx.strokeStyle = SKIN; ctx.lineWidth = 1.0 * u; ctx.beginPath(); ctx.moveTo(side * 0.8 * u, -5.9 * u); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6, 0.12 * u);
    ctx.beginPath(); ctx.ellipse(px, py, 0.8 * u, 0.4 * u, 0, 0, 7); ctx.fill(); ctx.stroke();
  }
  // Arms out for balance: the one on the side it leans toward comes down.
  for (const side of [-1, 1]) {
    const hx = side * 3.9 * u, hy = -7.9 * u + side * ride.lean * 2.2 * u;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 0.9 * u;
    ctx.beginPath(); ctx.moveTo(side * 1.9 * u, -8.5 * u); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy, 0.55 * u, 0, 7); ctx.fill();
  }
  // Shorts, then the shirt, which has the face you gave it on the back, or the cloud.
  ctx.fillStyle = "#111"; ctx.beginPath(); ctx.roundRect(-1.9 * u, -6.5 * u, 3.8 * u, 1.3 * u, 0.5 * u); ctx.fill();
  ctx.fillStyle = ACCENT; ctx.strokeStyle = "#c2410c"; ctx.lineWidth = Math.max(0.7, 0.12 * u);
  ctx.beginPath(); ctx.roundRect(-2.1 * u, -9.9 * u, 4.2 * u, 3.7 * u, 0.7 * u); ctx.fill(); ctx.stroke();
  if (avatar && avatar.complete && avatar.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, -8.0 * u, 1.35 * u, 0, 7); ctx.fillStyle = PAPER; ctx.fill(); ctx.clip();
    const sq = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    ctx.drawImage(avatar, (avatar.naturalWidth - sq) / 2, (avatar.naturalHeight - sq) / 2, sq, sq, -1.35 * u, -9.35 * u, 2.7 * u, 2.7 * u);
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6, 0.14 * u); ctx.beginPath(); ctx.arc(0, -8.0 * u, 1.35 * u, 0, 7); ctx.stroke();
  } else cloud(0, -7.6 * u, 2.6 * u);
  // The back of the head: ears either side, hair over the rest.
  const hy = -11.4 * u, r = 1.5 * u;
  ctx.lineWidth = Math.max(0.6, 0.1 * u); ctx.strokeStyle = EDGE;
  for (const side of [-1, 1]) { ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(side * r * 0.98, hy + r * 0.1, r * 0.22, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = "#3b2a20"; ctx.beginPath(); ctx.arc(0, hy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = "#5a4232"; ctx.beginPath(); ctx.arc(0, hy, r * 0.5, 4.1, 5.6); ctx.stroke();
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.roundRect(-r * 0.4, hy + r * 0.82, r * 0.8, r * 0.4, r * 0.15); ctx.fill();
  ctx.restore();
}

/** A small cloud, drawn from circles: a stand-in for the logo, not the real mark. */
function cloud(cx: number, cy: number, w: number) {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - w * 0.12, w, w * 0.34, w * 0.17);
  ctx.arc(cx - w * 0.17, cy - w * 0.12, w * 0.2, 0, 7);
  ctx.arc(cx + w * 0.1, cy - w * 0.17, w * 0.27, 0, 7);
  ctx.fill();
}

/** Streaks across the board in the way the wind is blowing, thicker the harder it blows. */
function wind() {
  const a = breeze(ride.t) + ride.gust, mag = Math.min(1, Math.abs(a) / 2);
  if (mag < 0.12) return;
  const dir = Math.sign(a), t = performance.now() / 1000;
  ctx.save();
  ctx.lineCap = "round"; ctx.strokeStyle = rgba("#8a8578", 0.5 * mag); ctx.lineWidth = 1.5;
  for (let k = 0; k < 12; k++) {
    const y = geo.horizon + ((k * 0.6180339) % 1) * (geo.strum - geo.horizon) * 1.05;
    const len = (24 + 36 * mag) * (0.6 + (k % 3) * 0.3);
    const x = (((t * (260 + 40 * (k % 4)) * dir + k * 173) % (geo.w + 120)) + geo.w + 120) % (geo.w + 120) - 60;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dir * len, y); ctx.stroke();
  }
  ctx.restore();
}

/** The two pedals along the bottom of the board, with a ring closing on the next power stroke. */
function hud() {
  const g = geo, now = performance.now();
  const zh = Math.min(64, g.h * 0.14), y = g.h - zh - 10, w = g.w / 2 - 22;
  const next: Side = ride.last === 1 ? -1 : 1;
  // How far to the beat: the ring starts wide and closes on the zone as the stroke comes due.
  const due = running && ride.last !== 0 && !crash ? Math.min(1, (ride.t - ride.lastAt) / RIDE.period) : 1;
  for (const side of [-1, 1] as Side[]) {
    const x = side < 0 ? 14 : g.w / 2 + 8, mine = side === next;
    const fl = now - tapFlash.at < 260 && tapFlash.side === side ? 1 - (now - tapFlash.at) / 260 : 0;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = fl ? rgba(tapFlash.grade > 0.6 ? "#e8590c" : "#8a8578", 0.12 + 0.3 * fl) : rgba("#fcfbf8", 0.7);
    ctx.strokeStyle = mine && running ? ACCENT : "#cfcfcf"; ctx.lineWidth = mine && running ? 2 : 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, w, zh, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = mine && running ? ACCENT : "#8a8578";
    ctx.font = `600 13px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(side < 0 ? "L" : "R", x + w / 2, y + zh / 2 - (running ? 0 : 8));
    if (!running) { ctx.font = `500 11.5px ${MONO}`; ctx.fillStyle = "#8a8578"; ctx.fillText(side < 0 ? "tap to pedal" : "tap to pedal", x + w / 2, y + zh / 2 + 9); }
    if (mine && running && due < 1) {
      const rr = (zh * 0.34) * (1 + 1.6 * (1 - due));
      ctx.strokeStyle = rgba("#e8590c", 0.25 + 0.6 * due); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + w / 2, y + zh / 2, rr, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
  if (running && now - tapFlash.at < 500) {
    const word = tapFlash.grade > 0.75 ? "on the beat" : tapFlash.grade > 0.3 ? "close" : tapFlash.grade === 0 ? "wrong foot" : "off";
    ctx.save(); ctx.globalAlpha = 1 - (now - tapFlash.at) / 500;
    ctx.font = `600 12px ${MONO}`; ctx.textAlign = "center"; ctx.fillStyle = tapFlash.grade > 0.75 ? ACCENT : "#6b6b6b";
    ctx.fillText(word, g.w / 2, y - 8 - (now - tapFlash.at) / 40);
    ctx.restore();
  }
  if (crash) { ctx.save(); ctx.font = `600 15px ${MONO}`; ctx.textAlign = "center"; ctx.fillStyle = INK; ctx.fillText("spill! back one commit", g.w / 2, g.horizon + 40); ctx.restore(); }
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
    setAvatar(data); toast("That's the rider now. Shift+A puts the default head back.");
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(`${f.name} isn't a picture I can read`); };
  img.src = url;
}

// -- playing ---------------------------------------------------------------------------------------

function frame(t: number) {
  raf = 0;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (gameOn) { stepGame(dt, t); refresh(); }
  else if (playing) {
    q += dt * speed;
    if (q >= notes.length) { q = notes.length; playing = false; }
    refresh();
  } else draw();
  // Keep going while playing, while riding, and while the strum line is still flashing.
  if (playing || gameOn || performance.now() - hitAt < 420) raf = requestAnimationFrame(frame);
}

/** One step of the ride: balance, distance, and whatever git throws as the commits go by the rider. */
function stepGame(dt: number, now: number) {
  if (crash) {
    if (now - crash.at > 900) { crash = null; remount(ride); q = Math.max(0, Math.floor(q) - 1); }
    return;
  }
  if (!running) return;
  const before = currentIndex(q + RIDER_AT, notes.length);
  const fell = stepRide(ride, dt);
  q = clampQ(q + ride.speed * dt, notes.length);
  wheel += ride.speed * dt * 4;
  for (let i = before + 1, to = currentIndex(q + RIDER_AT, notes.length); i <= to; i++) {
    const e = eventAt.get(i);
    if (e) gustRide(ride, eventPush(e));
  }
  if (fell) { falls++; crash = { at: now, dir: ride.lean > 0 ? 1 : -1 }; }
  else if (q >= notes.length) { running = false; toast(`Made it to the newest commit with ${falls} spill${falls === 1 ? "" : "s"}`); }
}

// -- the keys and taps for the pedals --------------------------------------------------------------

const keyName = (k: string) => (k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k);
function showKeys() {
  $("key-lv").textContent = keyName(binds.l);
  $("key-rv").textContent = keyName(binds.r);
  $("key-l").classList.toggle("binding", rebinding === "l");
  $("key-r").classList.toggle("binding", rebinding === "r");
  if (rebinding) $(rebinding === "l" ? "key-lv" : "key-rv").textContent = "?";
}

function pedal(side: Side) {
  if (!gameOn || crash || !notes.length) return;
  if (q >= notes.length) { q = 0; ride = newRide(); }
  running = true;
  const grade = tapRide(ride, side);
  tapFlash = { at: performance.now(), side, grade };
  wake();
}

function setGame(on: boolean) {
  if (on === gameOn) return;
  gameOn = on; running = false; crash = null; rebinding = null;
  playing = false;
  ride = newRide();
  $("gamebtn").setAttribute("aria-pressed", String(on));
  $("gamebar").hidden = !on;
  board.classList.toggle("tapzone", on);
  showKeys();
  if (on) toast(`Tap the bottom of the board, or ${keyName(binds.l)} and ${keyName(binds.r)}, left then right on the beat`);
  refresh(); wake();
}
const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

function play(on = !playing) {
  if (!notes.length || gameOn) return;
  if (on && q >= notes.length) q = 0;
  playing = on;
  refresh(); wake();
}
const seek = (to: number) => {
  q = clampQ(to, notes.length);
  if (gameOn) { remount(ride); crash = null; }
  refresh(); wake();
};
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
from$.onchange = to$.onchange = () => pick(path, true);
$("unrange").onclick = () => { from$.value = ""; to$.value = ""; pick(path, true); };
$("gamebtn").onclick = () => setGame(!gameOn);
$("key-l").onclick = () => { rebinding = rebinding === "l" ? null : "l"; showKeys(); };
$("key-r").onclick = () => { rebinding = rebinding === "r" ? null : "r"; showKeys(); };
board.onclick = () => play();
// In the game the bottom of the board is two pedals; a finger down on either side taps it (and several fingers can).
board.addEventListener("pointerdown", (e) => {
  if (!gameOn) return;
  const r = board.getBoundingClientRect();
  if (e.clientY - r.top < r.height * 0.72) return;
  e.preventDefault();
  pedal(e.clientX - r.left < r.width / 2 ? -1 : 1);
});
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
  if (t.matches("textarea, select, input")) return;
  const k = e.key;
  if (gameOn) {
    // Rebinding takes the next key; otherwise the two pedal keys are the game's.
    if (rebinding) {
      e.preventDefault();
      const other = rebinding === "l" ? binds.r : binds.l, key = k.length === 1 ? k.toLowerCase() : k;
      if (k === "Escape") rebinding = null;
      else if (key === other) { toast("That one is the other pedal"); return; }
      else {
        binds = { ...binds, [rebinding]: key };
        try { localStorage.setItem(KEYS_KEY, JSON.stringify(binds)); } catch {}
        rebinding = null;
      }
      showKeys();
      return;
    }
    const key = k.length === 1 ? k.toLowerCase() : k;
    if (key === binds.l || key === binds.r) { e.preventDefault(); if (!e.repeat) pedal(key === binds.l ? -1 : 1); return; }
  }
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
    t: () => showFriends(!!friends$.hidden), T: () => showFriends(!!friends$.hidden),
    a: openFace, A: resetFace, g: () => setGame(!gameOn), G: () => setGame(!gameOn),
    "?": () => showTip(!!tip.hidden), "/": () => showTip(!!tip.hidden),
    Escape: () => { showTip(false); showFriends(false); if (gameOn) setGame(false); },
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
fetch("/gitpath-sample.json").then((r) => r.json()).then((j) => { load(j, "the sample"); resize(); })
  .catch(() => { $("empty").textContent = "Open or paste a history to begin (O, P)"; });

// A handle for the console (window.gitpath.seek(40)).
(window as unknown as { gitpath: unknown }).gitpath = { seek, play, setGame, pedal, get q() { return q; }, get notes() { return notes; }, get layout() { return lay; } };
