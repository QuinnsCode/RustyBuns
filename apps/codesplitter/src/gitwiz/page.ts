// The DOM half of gitwiz: the controls, the card and the numbers around scene.ts's 3D board. It plays and
// scrubs the history, hangs branch names over the canvas, and loads a pasted or uploaded file or picture.
// build.ts bundles it, three.js and all, to /gitwiz.js for gitwiz.html.
import {
  STACK, buildNotes, clampQ, clockAt, currentIndex, formatAge, formatClock, layoutGraph, paceAt, qToScrub, readInput, scoreAt,
  scrubToQ, stepQ, strideRate, type Input, type Layout, type Note,
} from "./gitwiz.ts";
import { createScene } from "./scene.ts";

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
const scene = createScene(board);
const labels = $("labels");

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
let last = 0;
let raf = 0;
// The runner: how hot it is running (smoothed), and how far through its stride.
let pace = 0, phase = 0;

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
  scene?.setGraph(notes, lay, hotEdges);
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
  scene?.resize(r.width, r.height);
  draw();
}

/** A pool of branch-name tags laid over the canvas where their commits are. */
const tagEls: HTMLElement[] = [];
function draw() {
  if (!scene) return;
  const since = performance.now() - hitAt;
  const tags = scene.render({ q, pace, phase, playing, flash: since < 380 ? 1 - since / 380 : 0 }, currentIndex(q, notes.length));
  tags.forEach((t, k) => {
    const el = (tagEls[k] ??= labels.appendChild(Object.assign(document.createElement("span"), { className: "tag" })));
    if (el.textContent !== t.text) el.textContent = t.text.length > 22 ? t.text.slice(0, 21) + "…" : t.text;
    el.hidden = false; el.style.transform = `translate(${Math.round(t.x + 14)}px, ${Math.round(t.y - 9)}px)`;
  });
  for (let k = tags.length; k < tagEls.length; k++) tagEls[k]!.hidden = true;
}

// -- the face you gave it --------------------------------------------------------------------------

function setAvatar(url: string | null) {
  scene?.setAvatar(url);
  draw();
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

$("stacklist").textContent = STACK.map((p) => p.name).join(", ");
if (!scene) toast("gitwiz draws in 3D and this browser has no WebGL");
$("empty").hidden = false;
refresh();
icons();
try { const saved = localStorage.getItem(AVATAR_KEY); if (saved) setAvatar(saved); } catch {}
fetch("/gitwiz-sample.json").then((r) => r.json()).then((j) => { load(j, "the sample"); resize(); })
  .catch(() => { $("empty").textContent = "Open or paste a history to begin (O, P)"; });

// A handle for the console (window.gitwiz.seek(40)).
(window as unknown as { gitwiz: unknown }).gitwiz = { seek, play, get q() { return q; }, get notes() { return notes; }, get layout() { return lay; }, stats: () => scene?.stats() };
