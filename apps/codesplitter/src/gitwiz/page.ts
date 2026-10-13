// The DOM half of gitwiz. gitwiz.ts has the math; this paints it (paper chips on a board that narrows
// toward a vanishing point), plays and scrubs the history, and loads a pasted or uploaded file.
// build.ts bundles it to /gitwiz.js for gitwiz.html.
import {
  AHEAD, BEHIND, assignLanes, buildNotes, clampQ, clockAt, currentIndex, formatAge, formatClock, geometry, hasRegions,
  initials, laneCentre, project, qToScrub, readInput, scoreAt, scrubToQ, stepQ,
  type Geometry, type Input, type LaneMode, type Lanes, type Note,
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
const REGION_ICONS = ["arrow-up-to-line", "align-vertical-justify-center", "arrow-down-to-line"];

const board = $<HTMLCanvasElement>("board");
const ctx = board.getContext("2d")!;
const css = getComputedStyle(document.documentElement);
const tok = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
const INK = tok("--fg", "#0a0a0a"), PAPER = tok("--paper", "#fcfbf8"), EDGE = tok("--border-2", "#cfcfcf"), ACCENT = tok("--accent", "#e8590c");

let input: Input | null = null;
let path = "";
let notes: Note[] = [];
let mode: LaneMode = "region";
let lanes: Lanes = assignLanes([], "author");
let q = 0;
let speed = 2;
let playing = false;
let shown = -2;                 // the note the card and numbers are showing
let hit = { at: -1e9, lane: -1 }; // the last crossing, for the strum button's flash
let geo: Geometry = geometry(800, 500);
let last = 0;
let raf = 0;

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
  setMode(hasRegions(notes) ? "region" : "author");
  playing = false;
  q = 0; shown = -2;
  $("empty").hidden = true;
  refresh();
}

function setMode(m: LaneMode) {
  if (m === "region" && !hasRegions(notes)) m = "author";
  mode = m;
  lanes = assignLanes(notes, mode);
  const b = $<HTMLButtonElement>("lanes");
  const can = hasRegions(notes);
  b.disabled = !can;
  b.setAttribute("aria-pressed", String(mode === "author"));
  b.title = mode === "region" ? "Lanes are the file's top, middle and bottom third. Switch to authors (L)" : "Lanes are authors. Switch to the file's thirds (L)" + (can ? "" : ": this file's data has no regions");
  b.setAttribute("aria-label", b.title);
  b.innerHTML = icon(mode === "region" ? "layers" : "users");
  $("lanenote").innerHTML = `${icon(mode === "region" ? "layers" : "users")}lanes: ${mode === "region" ? "where in the file" : "who wrote it"}`;
  shown = -2;
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
  $("play").innerHTML = icon(playing ? "pause" : "play");
  $("play").title = playing ? "Pause (Space)" : "Play (Space)";
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  if (idx !== shown) {
    const up = idx > shown && shown !== -2;
    shown = idx;
    const s = scoreAt(notes, lanes.of, idx);
    $("v-commits").textContent = n0(s.passed);
    $("v-total").textContent = `/${n0(notes.length)}`;
    $("v-combo").textContent = String(s.combo);
    $("v-score").textContent = n0(s.score);
    $("card").innerHTML = idx < 0 ? cardIdle() : cardFor(notes[idx]!);
    if (up) {
      for (const id of ["card", "s-commits", "s-combo", "s-score"]) bumpEl($(id));
      hit = { at: performance.now(), lane: lanes.of[idx]! };
    }
    icons();
  }
  draw();
}

const cardIdle = () => `<div class="meta">${icon("git-commit-horizontal")}<span class="who">${esc(path)}</span></div>
  <div class="subject muted">${notes.length ? `${n0(notes.length)} commits wait at the far end. Press Space and watch the file grow up.` : "No commits."}</div>`;

function cardFor(n: Note) {
  return `<div class="meta"><span class="hash" title="${esc(n.hash)}">${esc(n.short)}</span><span class="who" title="${esc(n.author)}">${esc(n.author)}</span>
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

function draw() {
  const g = geo, n = lanes.names.length || 1;
  ctx.clearRect(0, 0, g.w, g.h);
  const frac = q - Math.floor(q + 1e-9);
  const edge = (lx: number, d: number) => project(g, lx, d);

  // The board: a paper strip that narrows to the vanishing point and fades out as it gets there.
  const nearD = -BEHIND - 1, farD = AHEAD;
  const bl = edge(-1, nearD), br = edge(1, nearD), tl = edge(-1, farD), tr = edge(1, farD);
  const fade = ctx.createLinearGradient(0, g.horizon, 0, g.strum);
  fade.addColorStop(0, rgba("#fcfbf8", 0)); fade.addColorStop(0.5, rgba("#f6f3ec", 0.85)); fade.addColorStop(1, "#f3efe6");
  ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath();
  ctx.fillStyle = fade; ctx.fill();

  // Lane lines run to the vanishing point; the two outer ones are the board's edge.
  const vp = { x: g.cx, y: g.horizon };
  for (let k = 0; k <= n; k++) {
    const lx = -1 + (2 * k) / n, p = edge(lx, nearD), far = edge(lx, farD);
    const outer = k === 0 || k === n;
    const grad = ctx.createLinearGradient(p.x, p.y, vp.x, vp.y);
    grad.addColorStop(0, outer ? rgba("#8a8578", 0.9) : rgba("#b9b4a6", 0.9)); grad.addColorStop(1, rgba("#b9b4a6", 0));
    ctx.strokeStyle = grad; ctx.lineWidth = outer ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(far.x, far.y); ctx.stroke();
  }

  // Frets: one a commit apart, sliding toward the viewer as the history plays.
  for (let m = -BEHIND; m <= AHEAD; m++) {
    const d = m - frac;
    if (d > AHEAD) continue;
    const a = edge(-1, d), b = edge(1, d);
    ctx.strokeStyle = rgba("#a39d8c", Math.max(0, Math.min(0.75, a.s * 1.1)) * (d < 0 ? Math.max(0, 1 + d / 1.2) : 1));
    ctx.lineWidth = Math.max(0.6, 1.4 * a.s);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // The strum line goes under the notes, so a chip sitting on it stays readable.
  const sa = edge(-1, 0), sb = edge(1, 0);
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(sa.x - 6, sa.y); ctx.lineTo(sb.x + 6, sb.y); ctx.stroke();

  // Notes, far to near, so the near ones sit on top.
  const lo = Math.max(0, Math.floor(q) - BEHIND - 1), hi = Math.min(notes.length - 1, Math.ceil(q) + AHEAD);
  for (let i = hi; i >= lo; i--) {
    const nt = notes[i]!, d = i + 1 - q;
    if (d > AHEAD || d < -0.25) continue;
    chip(nt, d, laneCentre(lanes.of[i]!, n), n, i === currentIndex(q, notes.length));
  }

  // A paper button per lane under the strum line.
  const since = performance.now() - hit.at;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let k = 0; k < n; k++) {
    const x = g.cx + laneCentre(k, n) * g.half, y = g.strum + 26;
    const lit = hit.lane === k && since < 420 ? 1 - since / 420 : 0;
    if (lit) { ctx.strokeStyle = rgba(ACCENT, lit * 0.6); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 15 + (1 - lit) * 14, 0, 7); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x, y, 14, 0, 7);
    ctx.fillStyle = lit ? "#ffe3cf" : PAPER; ctx.fill();
    ctx.strokeStyle = lit ? ACCENT : "#8f8f8f"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `600 11px ${tok("--mono", "monospace")}`;
    ctx.fillText(mode === "region" ? ["T", "M", "B"][k]! : initials(lanes.names[k]!), x, y + 0.5);
    ctx.fillStyle = tok("--muted", "#6b6b6b"); ctx.font = `500 11px ${tok("--sans", "sans-serif")}`;
    const room = Math.max(40, (g.half * 2) / n - 8);
    ctx.fillText(fit(lanes.names[k]!, room), x, y + 26);
  }
}

/** `text` cut with an ellipsis to fit `room` px in the canvas' current font. */
function fit(text: string, room: number) {
  if (ctx.measureText(text).width <= room) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > room) t = t.slice(0, -1);
  return t + "…";
}

function chip(n: Note, d: number, lx: number, lanesN: number, now: boolean) {
  const g = geo;
  const p = project(g, lx, d);
  const laneW = ((g.half * 2) / lanesN) * p.s;
  const w = laneW * (0.5 + 0.38 * n.size), h = Math.max(4, (10 + 24 * n.size) * p.s * 0.9);
  const left = p.x - w / 2, top = p.y - h / 2, r = Math.min(5 * p.s, h / 2);
  const gone = d < 0 ? Math.max(0, 1 + d / 0.25) : 1;
  ctx.save();
  ctx.globalAlpha = gone * Math.min(1, 0.35 + p.s * 1.4);
  const warm = n.kind !== "remove";
  // The glow is the lines changed: nothing for a one-liner, a soft halo for a big one.
  if (n.size > 0.3) { ctx.shadowColor = warm ? rgba(ACCENT, 0.55) : "rgba(100,100,100,.5)"; ctx.shadowBlur = 26 * n.size * p.s; }
  ctx.beginPath(); ctx.roundRect(left, top, w, h, r);
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  ctx.save(); ctx.clip();
  if (n.kind === "rewrite") {
    const split = left + w * n.addShare;
    ctx.fillStyle = "#f8c9a1"; ctx.fillRect(left, top, split - left, h);
    ctx.fillStyle = "#e2e2e2"; ctx.fillRect(split, top, left + w - split, h);
  } else {
    ctx.fillStyle = n.kind === "add" ? "#f8c9a1" : "#e2e2e2"; ctx.fillRect(left, top, w, h);
  }
  ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(left, top, w, Math.max(1, h * 0.14)); // the paper's lit top edge
  ctx.restore();
  ctx.lineWidth = now ? 2.2 : Math.max(0.8, 1.3 * p.s);
  ctx.strokeStyle = now ? INK : n.kind === "add" ? ACCENT : n.kind === "remove" ? "#8f8f8f" : "#6b6b6b";
  ctx.beginPath(); ctx.roundRect(left, top, w, h, r); ctx.stroke();
  if (p.s > 0.5 && w > 52 && h > 14) {
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(11 * Math.min(1.2, p.s))}px ${tok("--mono", "monospace")}`;
    ctx.fillText(`+${n.added} -${n.removed}`, p.x, p.y + 0.5);
  }
  ctx.restore();
}

// -- playing ---------------------------------------------------------------------------------------

function frame(t: number) {
  raf = 0;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (playing) {
    q += dt * speed;
    if (q >= notes.length) { q = notes.length; playing = false; }
    refresh();
  } else draw();
  // Keep going while playing, and while a strum button is still flashing.
  if (playing || performance.now() - hit.at < 450) raf = requestAnimationFrame(frame);
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
$("lanes").onclick = () => setMode(mode === "region" ? "author" : "region");
$<HTMLSelectElement>("file").onchange = (e) => pick((e.target as HTMLSelectElement).value);
$<HTMLInputElement>("scrub").oninput = (e) => seek(scrubToQ(Number((e.target as HTMLInputElement).value), notes.length));
board.onclick = () => play();
board.addEventListener("wheel", (e) => { e.preventDefault(); seek(q + e.deltaY / 90); }, { passive: false });

const tipBtn = $<HTMLButtonElement>("tipbtn"), tip = $("tip");
const showTip = (on: boolean) => { tip.hidden = !on; tipBtn.setAttribute("aria-expanded", String(on)); };
tipBtn.onclick = () => showTip(!!tip.hidden);
tipBtn.onmouseenter = () => showTip(true);
tipBtn.onmouseleave = () => showTip(false);

const pick$ = $<HTMLInputElement>("pick"), paste = $<HTMLDialogElement>("pastebox");
const openFile = () => pick$.click();
const openPaste = () => { $("pasterr").textContent = ""; paste.showModal(); $("pastetext").focus(); };
$("open").onclick = openFile;
$("paste").onclick = openPaste;
$("pastecancel").onclick = () => paste.close();
$("pastego").onclick = () => {
  try { readInput($<HTMLTextAreaElement>("pastetext").value); } catch (e) { $("pasterr").textContent = e instanceof Error ? e.message : String(e); return; }
  if (load($<HTMLTextAreaElement>("pastetext").value, "pasted JSON")) paste.close();
};
const readFile = async (f: File) => { if (load(await f.text(), f.name)) toast(`Loaded ${f.name}`); };
pick$.onchange = () => { const f = pick$.files?.[0]; if (f) void readFile(f); pick$.value = ""; };
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
    l: () => $("lanes").click(), L: () => $("lanes").click(),
    f: () => $("file").focus(), F: () => $("file").focus(),
    o: openFile, O: openFile, p: openPaste, P: openPaste,
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
fetch("/gitwiz-sample.json").then((r) => r.json()).then((j) => { load(j, "the sample"); resize(); })
  .catch(() => { $("empty").textContent = "Open or paste a history to begin (O, P)"; });

// A handle for the console (window.gitwiz.seek(40)).
(window as unknown as { gitwiz: unknown }).gitwiz = { seek, play, get q() { return q; }, get notes() { return notes; } };
