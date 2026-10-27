// Three thin screens on the wall above the PR board and the task board beside it, each turned on in Settings › You (kept in this
// browser, like the codeSplitter mark): gitpath (the busiest files' commit paths, from codeSplitter), Mervin (his
// merge order, live while he runs) and Ester (her test runs and what she says to hold). Each keeps its slot whether
// or not the others are on. Clicking Mervin or Ester calls on them, like their badges (ester/); clicking gitpath opens
// it on codeSplitter. The data: /__rb/helpers (ester/run.ts) every few seconds, /__rb/codesplitter/gitpath every minute.
import { CanvasTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera, type Object3D, type Scene } from "three";
import type { EsterState } from "../ester/run.ts";
import { SCREENS, clock, esterRuns, filePath, helperState, mervinBoard, slots, type FilePath, type Screen } from "./read.ts";

const KEY = "rb.screens";
type Saved = Partial<Record<Screen, boolean>>;
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const repo = (): string | undefined => { try { return JSON.parse(localStorage.getItem("rb.codesplitter") ?? "{}").repo; } catch { return undefined; } };

const W = 1536, H = 256, HIGH = 0.8, GAP = 0.3, LIFT = 0.95; // canvas px; screen height, gap and lift over the boards' tops, in metres
const INK = "#16181d", PAPER = "#f4f1ea", DIM = "#8a8f98", ORANGE = "#e8a33d", GREEN = "#2f8f46", RED = "#c0392b", GREY = "#6b7280";
const IDLE: EsterState = { phase: "idle", lines: [], hold: [] };

let helpers: { ester: EsterState; mervin: EsterState } = { ester: IDLE, mervin: IDLE };
let paths: FilePath[] = [], site = "", turn = 0;

// ---- drawing ------------------------------------------------------------------------------------------------

function frame(ctx: CanvasRenderingContext2D, title: string, right: string) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, 12, H);
  ctx.font = "600 52px system-ui,sans-serif";
  ctx.textBaseline = "top";
  ctx.fillStyle = PAPER;
  ctx.fillText(title, 36, 18, W - 360);
  ctx.textAlign = "right";
  ctx.fillStyle = DIM;
  ctx.fillText(right, W - 32, 18);
  ctx.textAlign = "left";
}

const note = (ctx: CanvasRenderingContext2D, text: string, color = DIM) => {
  ctx.font = "44px system-ui,sans-serif";
  ctx.fillStyle = color;
  ctx.fillText(text, 36, 128, W - 72);
};

const phase = (s: EsterState) => (s.phase === "running" ? `on it ${clock(s.startedAt)}` : s.phase === "idle" ? "idle" : `${s.phase} ${clock(s.startedAt, s.endedAt)}`);

function drawGitpath(ctx: CanvasRenderingContext2D) {
  const f = paths.length ? paths[turn % paths.length]! : undefined;
  frame(ctx, f ? `gitpath  ${f.path}` : "gitpath", f ? `${f.commits.length} commits` : "");
  if (!repo()) return note(ctx, "Set a codeSplitter repo in Settings › You");
  if (!f) return note(ctx, "No history yet");
  // one dot per commit along the path, oldest left; lines added rise orange above it, removed hang grey below
  const n = f.commits.length, step = (W - 80) / Math.max(1, n - 1), y = 172;
  const most = Math.max(1, ...f.commits.map((c) => Math.max(c.added, c.removed)));
  const bar = (v: number) => (Math.log1p(v) / Math.log1p(most)) * 70;
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
  f.commits.forEach((c, i) => {
    const x = n === 1 ? W / 2 : 40 + i * step;
    ctx.fillStyle = ORANGE;
    ctx.fillRect(x - 6, y - 10 - bar(c.added), 12, bar(c.added));
    ctx.fillStyle = GREY;
    ctx.fillRect(x - 6, y + 10, 12, bar(c.removed));
    ctx.beginPath();
    ctx.arc(x, y, c.joins ? 13 : 9, 0, Math.PI * 2);
    ctx.fillStyle = c.joins ? INK : PAPER;
    ctx.fill();
    if (c.joins) { ctx.strokeStyle = ORANGE; ctx.lineWidth = 3; ctx.stroke(); }
  });
}

function chip(ctx: CanvasRenderingContext2D, x: number, w: number, label: string, fill: string, ring?: string) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, 96, w, 96, 14); ctx.fill();
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 5; ctx.stroke(); }
  ctx.fillStyle = PAPER;
  ctx.font = "600 40px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, 122, w - 16);
  ctx.textAlign = "left";
}

function drawMervin(ctx: CanvasRenderingContext2D) {
  const s = helpers.mervin, b = mervinBoard(s.lines);
  frame(ctx, `Mervin  ${b.stages.length ? `${b.stages.length} PRs in merge order` : "merge order"}`, phase(s));
  if (s.error) return note(ctx, s.error, RED);
  if (!b.stages.length) return note(ctx, s.lines.at(-1) ?? (s.phase === "running" ? "Reading the open PRs" : "Click to call on Mervin"));
  // a chip a stage, left to right in merge order: orange while unsure, grey when certain, ringed red if Ester says hold
  const w = Math.min(230, (W - 72) / b.stages.length - 10);
  b.stages.forEach((st, i) => chip(ctx, 36 + i * (w + 10), w, `#${st.pr} ${st.certain}%`, st.certain === 100 ? GREY : ORANGE, helpers.ester.hold.includes(st.pr) ? RED : undefined));
  if (b.clashes) { ctx.font = "34px system-ui,sans-serif"; ctx.fillStyle = b.cards ? RED : DIM; ctx.fillText(`${b.clashes} clashes, ${b.cards} want a card`, 36, 204); }
}

function drawEster(ctx: CanvasRenderingContext2D) {
  const s = helpers.ester, runs = esterRuns(s.lines);
  const failed = runs.filter((r) => !r.ok).length;
  frame(ctx, `Ester  ${runs.length ? `${runs.length - failed} of ${runs.length} pass` : "board check"}`, phase(s));
  if (s.error) return note(ctx, s.error, RED);
  if (!runs.length) return note(ctx, s.hold.length ? `hold ${s.hold.map((n) => `#${n}`).join(", ")}` : s.lines.at(-1) ?? (s.phase === "running" ? "Building the merged tree" : "Click to call on Ester"));
  const w = Math.min(260, (W - 72) / runs.length - 10);
  runs.forEach((r, i) => chip(ctx, 36 + i * (w + 10), w, r.dir.split("/").pop()!, r.ok ? GREEN : RED));
  if (s.hold.length) { ctx.font = "600 34px system-ui,sans-serif"; ctx.fillStyle = RED; ctx.fillText(`hold ${s.hold.map((n) => `#${n}`).join(", ")}`, 36, 204); }
}

const DRAW: Record<Screen, (ctx: CanvasRenderingContext2D) => void> = { gitpath: drawGitpath, mervin: drawMervin, ester: drawEster };

// ---- the 3D office: three screens over the boards ---------------------------------------------------------

interface App { scene: Scene; camera: Camera; canvas: HTMLCanvasElement; office: { boardMeshes?: Partial<Record<string, Mesh>> } }
let office: App | undefined;
((globalThis as { __rbOfficeTicks?: unknown[] }).__rbOfficeTicks ??= []).push((a: App) => void (office = a));
let wall: Group | null = null;
const screens = new Map<Screen, { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; ctx: CanvasRenderingContext2D; tex: CanvasTexture }>();

/** The PR board, and whichever of the issues and queue boards hangs on its wall nearest it: the span the screens cover. */
function span(boards: Partial<Record<string, Mesh>>) {
  const pulls = boards.pulls;
  if (!pulls) return null;
  pulls.updateWorldMatrix(true, false);
  const into = pulls.matrixWorld.clone().invert();
  const size = (m: Mesh) => (m.geometry as PlaneGeometry).parameters;
  const rect = (m: Mesh) => {
    m.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(m.matrixWorld).applyMatrix4(into);
    return { at, ...size(m) };
  };
  const own = rect(pulls);
  const side = (["issues", "queue"] as const).map((k) => boards[k]).filter((m): m is Mesh => !!m).map(rect)
    .filter((r) => Math.abs(r.at.z) < 0.5).sort((a, b) => Math.abs(a.at.x) - Math.abs(b.at.x))[0];
  const all = side ? [own, side] : [own];
  return {
    pulls,
    left: Math.min(...all.map((r) => r.at.x - r.width / 2)),
    right: Math.max(...all.map((r) => r.at.x + r.width / 2)),
    top: Math.max(...all.map((r) => r.at.y + r.height / 2)),
  };
}

function place() {
  const a = office, on = load();
  if (!a?.office.boardMeshes) return;
  if (!SCREENS.some((s) => on[s])) { if (wall) wall.visible = false; return; }
  const sp = span(a.office.boardMeshes);
  if (!sp) return;
  if (!wall || wall.parent !== a.scene) {
    wall?.removeFromParent();
    wall = new Group();
    wall.name = "rb-screens";
    wall.userData.rbForest = "skip"; // the Druids skin leaves its colours alone
    a.scene.add(wall);
    screens.clear();
    a.canvas.addEventListener("click", (e) => clicked(e, a));
  }
  wall.visible = true;
  slots(sp.left, sp.right, GAP).forEach((slot, i) => {
    const name = SCREENS[i]!;
    let s = screens.get(name);
    if (!s) {
      const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const mat = new MeshBasicMaterial({ map: tex });
      mat.toneMapped = false;
      s = { mesh: new Mesh(new PlaneGeometry(1, 1), mat), ctx: c.getContext("2d")!, tex };
      s.mesh.matrixAutoUpdate = false;
      s.mesh.userData.screen = name;
      screens.set(name, s);
      wall!.add(s.mesh);
    }
    s.mesh.visible = !!on[name];
    s.mesh.matrix.copy(sp.pulls.matrixWorld)
      .multiply(new Matrix4().makeTranslation(slot.x, sp.top + LIFT + HIGH / 2, 0.03))
      .multiply(new Matrix4().makeScale(slot.width, HIGH, 1));
    s.mesh.matrixWorldNeedsUpdate = true;
  });
  draw();
}

function draw() {
  const on = load();
  for (const [name, s] of screens) {
    if (!on[name]) continue;
    DRAW[name](s.ctx);
    s.tex.needsUpdate = true;
  }
}

const ray = new Raycaster();
function clicked(e: MouseEvent, a: App) {
  if (!wall?.visible) return;
  const r = a.canvas.getBoundingClientRect();
  const at = document.pointerLockElement ? new Vector2(0, 0)
    : new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(at, a.camera);
  const hit = ray.intersectObjects((wall.children as Object3D[]).filter((m) => m.visible), false)[0];
  if (!hit || hit.distance > 25) return;
  const name = hit.object.userData.screen as Screen;
  if (name === "gitpath") { const r = repo(); if (site && r) window.open(`${site}/gitpath?repo=${encodeURIComponent(r)}`, "_blank", "noopener"); }
  else if (helpers[name].phase !== "running") void call(name);
}

// ---- the data -----------------------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
async function pollHelpers() {
  clearTimeout(timer);
  const on = load();
  if (on.mervin || on.ester) {
    try {
      const r = await fetch("/__rb/helpers", { credentials: "same-origin" });
      if (r.ok && !r.redirected) {
        const body: unknown = await r.json();
        if (typeof body === "object" && body && "ester" in body && "mervin" in body) helpers = { ester: helperState(body.ester), mervin: helperState(body.mervin) };
      }
    } catch {}
    draw();
  }
  const busy = helpers.ester.phase === "running" || helpers.mervin.phase === "running";
  timer = setTimeout(pollHelpers, busy ? 2000 : 10_000);
}

async function call(name: "mervin" | "ester") {
  try { await fetch(`/__rb/helpers/${name}`, { method: "POST", credentials: "same-origin", headers: { "x-rb-triage": "1" } }); } catch {}
  void pollHelpers();
}

async function pollGitpath() {
  const r = repo();
  if (!load().gitpath || !r) return draw();
  try {
    const res = await fetch(`/__rb/codesplitter/gitpath?repo=${encodeURIComponent(r)}`);
    const body: unknown = res.ok ? await res.json() : null;
    if (typeof body === "object" && body && "histories" in body && Array.isArray(body.histories)) {
      paths = body.histories.map(filePath).filter((f): f is FilePath => !!f && f.commits.length > 0);
      site = "site" in body && typeof body.site === "string" ? body.site : site;
    }
  } catch {}
  draw();
}

// ---- the setting --------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const LABEL: Record<Screen, string> = { gitpath: "gitpath", mervin: "Mervin", ester: "Ester" };
function setting() {
  const boxes = SCREENS.map((name) => {
    const box = el("input", { type: "checkbox", checked: !!load()[name] });
    box.addEventListener("change", () => {
      save({ ...load(), [name]: box.checked });
      place();
      void pollHelpers();
      if (name === "gitpath") void pollGitpath();
    });
    return el("label", { style: "margin-right:14px" }, box, ` ${LABEL[name]}`);
  });
  const scope = el("span", { className: "scope you", title: "Only for you, kept in this browser" }, "Just you");
  const note = el("p", { className: "setting-note" },
    "Three screens over the task and PR boards: gitpath's busiest files (in the codeSplitter setting's repo), " +
    "Mervin's merge order and Ester's tests as they run. Click Mervin or Ester to call on them.");
  return el("div", { className: "setting rb-screens" }, el("div", { className: "setting-head" }, el("h4", {}, "Wall screens"), scope), el("div", {}, ...boxes), note);
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-screens")) pane.append(setting());
}

function start() {
  document.querySelectorAll(".modal.settings").forEach(addTo);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(".modal.settings")) addTo(n);
      else n.querySelectorAll(".modal.settings").forEach(addTo);
    }
  }).observe(document.body, { childList: true, subtree: true });
  void pollHelpers();
  void pollGitpath();
  setInterval(pollGitpath, 60_000);
  // the next busiest file every 20s, and the boards may move (a floor change, a new skin): place them again
  setInterval(() => { turn++; place(); }, 20_000);
  setInterval(() => office && (!wall || wall.parent !== office.scene) && place(), 2000);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
