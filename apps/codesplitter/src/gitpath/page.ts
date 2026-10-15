// The DOM half of gitpath: the controls, the rail, the card and the game around scene.ts's 3D board. It plays
// the history, scrubs it by date on the rail, hangs branch names and the wind and the pedals over the canvas,
// loads a pasted or uploaded file or picture, and runs the game: a unicyclist on the hot path, pedalled with
// taps. build.ts bundles it, three.js and all, to /gitpath.js for gitpath.html.
import {
  CURVES, LIVES, RIDE, STACK, curveById, dataUrl, repoOf, warpQ, buildNotes, clampQ, clockAt, currentIndex, eventPush, filterRange, formatAge, formatClock, geometry, gustRide,
  layoutGraph, newRide, qAtFrac, readInput, remount, rideEvents, runOver, scoreAt, stepQ, stepRide, tapRide, timeFracAt, timeTicks, breeze, topFriends, veinChart,
  type Geometry, type Input, type Layout, type Note, type RepoRef, type RideEvent, type Side,
} from "./gitpath.ts";
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
const AVATAR_KEY = "gitpath.avatar";
const KEYS_KEY = "gitpath.keys";
/** Where the rider sits on the board, in commits ahead of the strum line. */
const RIDER_AT = 0.9;

const board = $<HTMLCanvasElement>("board");
const scene = createScene(board);
// Over the 3D board, a flat canvas for what is drawn in screen space: branch names, the wind and the pedals.
const hudCanvas = $<HTMLCanvasElement>("hud");
const ctx = hudCanvas.getContext("2d")!;
const css = getComputedStyle(document.documentElement);
const tok = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
const INK = tok("--fg", "#0a0a0a"), PAPER = tok("--paper", "#fcfbf8"), ACCENT = tok("--accent", "#e8590c");
const MONO = tok("--mono", "monospace");

let input: Input | null = null;
// Opened on a codeSplitter repo (/gitpath?repo=owner/name): its files load as they are picked, from the API.
const hosted: RepoRef | null = repoOf(location.search);
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
// The game: off until the controller is clicked. `running` waits for the first tap, so the rider doesn't tip over before you start.
let gameOn = false, running = false;
let ride = newRide();
let events: RideEvent[] = [];
let eventAt = new Map<number, RideEvent>();
let falls = 0, idleFalls = 0, taps = 0, wheel = 0;
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
  if (!full) { if (hosted && input) void loadFile(p, keepRange); return; }
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
  ride = newRide(); running = false; crash = null; falls = 0; idleFalls = 0; taps = 0;
  buildRail();
  hotEdges = new Set(lay.hot.slice(1).map((hi, k) => `${lay.hot[k]}-${hi}`));
  scene?.setGraph(notes, lay, hotEdges, events);
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

// -- a hosted repo ---------------------------------------------------------------------------------

const waiting = (text: string) => { $("empty").textContent = text; $("empty").hidden = false; };

/** What the API says, or a sentence for why not (and null). */
async function fetchJson(url: string, what: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (res.status === 202) { toast(`${what} is still being set up. Try again in a moment`); return null; }
    if (!res.ok) { toast(res.status === 401 || res.status === 403 || res.status === 404 ? `Couldn't open ${what}: sign in to codeSplitter first if it's private` : `Couldn't read ${what} (${res.status})`); return null; }
    return await res.json();
  } catch { toast(`Couldn't reach ${what}`); return null; }
}

/** The repo's busiest files, then the first one's history. */
async function loadRepo(r: RepoRef) {
  const name = `${r.owner}/${r.repo}`;
  waiting(`Reading ${name}'s history`);
  const j = await fetchJson(dataUrl(r), name);
  const files: { path: string; commits: number }[] = Array.isArray(j?.files) ? j.files : [];
  if (r.path && !files.some((f) => f.path === r.path)) files.unshift({ path: r.path, commits: 0 });
  if (!files.length) { waiting(j ? `${name} has no edits to replay yet` : `Couldn't read ${name}. Open or paste a history instead (O, P)`); return; }
  input = { repo: name, files, histories: {} };
  $("repo").textContent = name;
  document.title = `gitpath: ${name}`;
  $<HTMLSelectElement>("file").innerHTML = files.map((f) => `<option value="${esc(f.path)}">${esc(f.path)}${f.commits ? ` (${f.commits})` : ""}</option>`).join("");
  pick(files[0]!.path);
}

/** A file's history from the API, then on to showing it. */
async function loadFile(p: string, keepRange: boolean) {
  waiting(`Reading ${p}'s history`);
  const j = await fetchJson(dataUrl(hosted!, p), p);
  let one: ReturnType<typeof readInput> | null = null;
  try { one = j ? readInput(j) : null; } catch { toast(`No recent commits of ${hosted!.repo} touch ${p}`); }
  const commits = one && Object.values(one.histories)[0];
  if (!commits || !input) { waiting(`Nothing to replay for ${p}`); return; }
  input.histories[p] = commits;
  const opt = [...$<HTMLSelectElement>("file").options].find((o) => o.value === p);
  if (opt) opt.textContent = `${p} (${commits.length})`;
  pick(p, keepRange);
}

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
    $("g-fallsv").textContent = String(Math.max(0, LIVES - falls));
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
  hudCanvas.width = Math.max(1, Math.round(r.width * dpr));
  hudCanvas.height = Math.max(1, Math.round(r.height * dpr));
  geo = geometry(r.width, r.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene?.resize(r.width, r.height);
  draw();
}

const rgba = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};

function draw() {
  const now = performance.now(), since = now - hitAt;
  const tags = scene?.render({
    q, flash: since < 380 ? 1 - since / 380 : 0,
    rider: gameOn ? { at: RIDER_AT, lean: ride.lean, crank: ride.crank, wheel, crash: crash ? { dir: crash.dir, slip: Math.min(1, (now - crash.at) / 700) } : null } : null,
  }, currentIndex(q, notes.length)) ?? [];
  ctx.clearRect(0, 0, geo.w, geo.h);
  for (const t of tags) {
    const text = t.text.length > 22 ? t.text.slice(0, 21) + "…" : t.text;
    ctx.font = `600 11px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 10, x = t.x + 14, h = 16;
    ctx.fillStyle = PAPER; ctx.strokeStyle = "#cfcfcf"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, t.y - h / 2, w, h, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.fillText(text, x + 5, t.y + 0.5);
  }
  if (gameOn) { wind(); hud(); }
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
    setAvatar(data); toast("That's on the rider's back now. Shift+A takes it off.");
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
  if (fell) {
    falls++; idleFalls = taps === 0 ? idleFalls + 1 : 0; taps = 0;
    if (runOver(falls, idleFalls)) { setGame(false); toast(idleFalls ? "Nobody at the pedals. Back to the menu" : "Out of lives. Back to the menu"); return; }
    crash = { at: now, dir: ride.lean > 0 ? 1 : -1 };
  }
  else if (q >= notes.length) { running = false; toast(`Made it to the newest commit with ${falls} spill${falls === 1 ? "" : "s"}`); }
}

// -- the video ------------------------------------------------------------------------------------

const vid = $<HTMLDialogElement>("vidbox");
let curveId = CURVES[0]!.id, recording = false;

function showCurves() {
  $("curves").innerHTML = CURVES.map((c) =>
    `<button class="btn" type="button" role="radio" data-id="${c.id}" aria-checked="${c.id === curveId}" title="${esc(c.label)}">${icon(c.icon)}${esc(c.label)}</button>`).join("");
  icons();
  for (const b of $("curves").querySelectorAll<HTMLElement>("button")) b.onclick = () => { curveId = b.dataset.id!; showCurves(); };
}

function openVideo() {
  if (!notes.length || recording) return;
  setGame(false); play(false);
  const a = from$.value || dayOf(Date.parse(notes[0]!.date)), b = to$.value || dayOf(Date.parse(notes[notes.length - 1]!.date));
  $("vidrange").textContent = `${path}, ${a} to ${b} (${notes.length} commit${notes.length === 1 ? "" : "s"}). Change the range with the two date boxes.`;
  $("vidmsg").textContent = "";
  showCurves(); vid.showModal();
}

/** Plays the range through the chosen speed curve while a MediaRecorder watches the board, then hands over the file. */
async function exportVideo() {
  if (recording || !notes.length) return;
  const out = document.createElement("canvas");
  if (typeof MediaRecorder === "undefined" || !out.captureStream) { $("vidmsg").textContent = "This browser can't record a canvas"; return; }
  const secs = Math.min(120, Math.max(3, Number($<HTMLInputElement>("vidsecs").value) || 15));
  const curve = curveById(curveId);
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  // The 3D board and the flat layer of branch names over it are two canvases; the video gets them merged into one.
  out.width = board.width; out.height = board.height;
  const octx = out.getContext("2d")!;
  const paint = () => { octx.clearRect(0, 0, out.width, out.height); octx.drawImage(board, 0, 0); octx.drawImage(hudCanvas, 0, 0, out.width, out.height); };
  const rec = new MediaRecorder(out.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  recording = true;
  $<HTMLButtonElement>("vidgo").disabled = true;
  vid.close();
  const was = q;
  q = 0; refresh(); paint();
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = (t: number) => {
      const u = (t - t0) / (secs * 1000);
      q = warpQ(curve, u, notes.length);
      refresh(); paint();
      if (u >= 1) { setTimeout(resolve, 600); return; }   // hold the last frame a moment
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await done;
  recording = false;
  $<HTMLButtonElement>("vidgo").disabled = false;
  q = was; refresh();
  const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gitpath-${path.split("/").pop()}-${curve.id}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Saved ${a.download}`);
}

$("vidbtn").onclick = openVideo;
$("vidcancel").onclick = () => vid.close();
$("vidgo").onclick = () => void exportVideo();

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
  running = true; taps++;
  const grade = tapRide(ride, side);
  tapFlash = { at: performance.now(), side, grade };
  wake();
}

// The found.js the site serves, named by a variable so the bundler leaves it alone.
const FOUND_JS = "/found.js";
function setGame(on: boolean) {
  if (on === gameOn) return;
  gameOn = on; running = false; crash = null; rebinding = null; falls = 0; idleFalls = 0; taps = 0;
  playing = false;
  ride = newRide();
  $("gamebtn").setAttribute("aria-pressed", String(on));
  $("gamebar").hidden = !on;
  board.classList.toggle("tapzone", on);
  showKeys();
  if (on) import(FOUND_JS).then(({ found }) => found("unicycle")).catch(() => {});
  if (on) toast(`Tap the bottom of the board, or ${keyName(binds.l)} and ${keyName(binds.r)}, left then right on the beat`);
  refresh(); wake();
}
const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

function play(on = !playing) {
  if (!notes.length || gameOn || recording) return;
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
const resetFace = () => { try { localStorage.removeItem(AVATAR_KEY); } catch {} setAvatar(null); toast("Back to the plain shirt"); };
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
    v: openVideo, V: openVideo,
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

$("stacklist").textContent = STACK.map((p) => p.name).join(", ");
if (!scene) toast("gitpath draws in 3D and this browser has no WebGL");
$("empty").hidden = false;
refresh();
icons();
try { const saved = localStorage.getItem(AVATAR_KEY); if (saved) setAvatar(saved); } catch {}
if (hosted) {
  $("home").setAttribute("href", `/#/r/${hosted.owner}/${hosted.repo}`);
  $("home").title = `${hosted.owner}/${hosted.repo}`;
  void loadRepo(hosted).then(resize);
} else {
  fetch("/gitpath-sample.json").then((r) => r.json()).then((j) => { load(j, "the sample"); resize(); })
    .catch(() => { $("empty").textContent = "Open or paste a history to begin (O, P)"; });
}

// A handle for the console (window.gitpath.seek(40)).
(window as unknown as { gitpath: unknown }).gitpath = { seek, play, setGame, pedal, get q() { return q; }, get notes() { return notes; }, get layout() { return lay; } };
