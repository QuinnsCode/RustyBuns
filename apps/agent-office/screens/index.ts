// Three thin screens on the wall above the PR board and the task board beside it, each turned on in Settings › You (kept in this
// browser, like the codeSplitter mark):
//   gitpath  every open PR as a car on one line, left to right: open › CI › Mervin › Ester › main, and how many merged
//            in the last day. Moving, ready, or stuck red where it stopped. Click a car to open its PR.
//   Mervin   the share of conflicts he took off the agents, the files more than one side wrote to (one tile each, like
//            codeSplitter's file objects), and, when the person lets him keep one, his running tally across boards.
//   Ester    her test stack: the PRs in Mervin's order as one big run, or PR by PR (a setting). A PR that breaks it gets
//            a button that queues a cheap worker (Haiku, low effort) on the fix, so the frontier models stay on the work.
// Each keeps its slot whether or not the others are on. Clicking Mervin or Ester calls on them, like their badges (ester/).
// The data: /__rb/helpers (ester/run.ts) every few seconds, /__rb/line every minute.
import { CanvasTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera, type Object3D, type Scene } from "three";
import type { EsterState } from "../ester/run.ts";
import {
  SCREENS, STATIONS, avoided, clock, esterStack, fixPrompt, helperState, line, mergedPrs, mervinBoard, openPrs, preventedOf, slots, tallyOf,
  type MergedPr, type OpenPr, type Screen, type Tally,
} from "./read.ts";

const KEY = "rb.screens";
/** Which screens are on, Ester's mode (`each`: PR by PR) and whether Mervin may keep his tally (`keep`). */
type Saved = Partial<Record<Screen | "each" | "keep", boolean>>;
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

const W = 1536, H = 256, HIGH = 0.8, GAP = 0.3, LIFT = 0.95; // canvas px; screen height, gap and lift over the boards' tops, in metres
const INK = "#16181d", PAPER = "#f4f1ea", DIM = "#8a8f98", ORANGE = "#e8a33d", GREEN = "#2f8f46", RED = "#c0392b", GREY = "#6b7280";
const IDLE: EsterState = { phase: "idle", lines: [], hold: [] };
const FPS = 8; // gitpath's cars chug; the other two redraw when their data moves

let helpers: { ester: EsterState; mervin: EsterState } = { ester: IDLE, mervin: IDLE };
let tally: Tally | null = null;
let prevented = 0; // tasks Mervin held for the repo codeSplitter's card watches, before their branches clashed
let open: OpenPr[] = [], merged: MergedPr[] = [], lineError = "";
/** Where the last frame drew what can be clicked, in canvas px. */
let cars: { x: number; y: number; w: number; h: number; url: string }[] = [];
let fixButton: { x: number; w: number; pr: number } | null = null;
const fixed = new Set<string>(); // `${run start}:${pr}`, so one red run queues one fixer per PR

// ---- drawing ------------------------------------------------------------------------------------------------

function frame(ctx: CanvasRenderingContext2D, title: string, right: string) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, 12, H);
  ctx.font = "600 52px system-ui,sans-serif";
  ctx.textBaseline = "top";
  ctx.fillStyle = PAPER;
  ctx.fillText(title, 36, 18, W - 520);
  ctx.textAlign = "right";
  ctx.fillStyle = DIM;
  ctx.font = "44px system-ui,sans-serif";
  ctx.fillText(right, W - 32, 24, 460);
  ctx.textAlign = "left";
}

const note = (ctx: CanvasRenderingContext2D, text: string, color = DIM, y = 128) => {
  ctx.font = "44px system-ui,sans-serif";
  ctx.fillStyle = color;
  ctx.fillText(text, 36, y, W - 72);
};

const phase = (s: EsterState) => (s.phase === "running" ? `on it ${clock(s.startedAt)}` : s.phase === "idle" ? "idle" : `${s.phase} ${clock(s.startedAt, s.endedAt)}`);

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, fill: string, ink = PAPER, ring?: string) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 5; ctx.stroke(); }
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.min(36, h - 16)}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 2, w - 12);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

/** gitpath: the line. Five stations in equal stretches; each PR sits in the stretch of the station it reached, the
 * furthest along at the right. The sleepers scroll, the moving cars bob, and the last day's merges roll on past main. */
function drawGitpath(ctx: CanvasRenderingContext2D, t: number) {
  const day = merged.length;
  frame(ctx, `gitpath  ${open.length} open → main`, `${day} merged in 24h`);
  const left = 36, colW = (W - left - 24) / STATIONS.length, rail = 196;
  // the rails, and sleepers sliding left, so the line itself reads as moving right
  ctx.fillStyle = GREY;
  const off = (t * 60) % 40;
  for (let x = left - off; x < W - 24; x += 40) ctx.fillRect(x, rail - 4, 8, 16);
  ctx.fillStyle = DIM;
  ctx.fillRect(left, rail - 2, W - left - 24, 4);
  ctx.fillRect(left, rail + 8, W - left - 24, 4);
  ctx.font = "30px system-ui,sans-serif";
  STATIONS.forEach((name, i) => {
    const x = left + (i + 1) * colW - 8;
    ctx.fillStyle = i === STATIONS.length - 1 ? ORANGE : PAPER;
    ctx.fillRect(x, 88, 4, rail - 88);
    ctx.textAlign = "right";
    ctx.fillText(name, x - 10, rail + 20);
    ctx.textAlign = "left";
  });
  cars = [];
  if (lineError && !open.length) return note(ctx, lineError, RED, 110);
  // cars bunch toward the next station, two rows to a stretch before they start to overlap
  const cw = 104, ch = 40, rows = [138, 88], all = line(open, helpers.mervin, helpers.ester);
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const here = all.filter((c) => c.at === i), room = colW - 30, fit = Math.max(1, Math.floor((room - cw) / (cw + 6)) + 1);
    const per = Math.max(fit, Math.ceil(here.length / 2)), step = per > 1 ? Math.min(cw + 6, (room - cw) / (per - 1)) : 0;
    here.forEach((c, k) => {
      const x = left + (i + 1) * colW - 22 - cw - (k % per) * step, y = rows[Math.floor(k / per)]!;
      const bob = c.state === "moving" ? Math.sin(t * 9 + c.pr) * 3 : 0;
      const nudge = c.state === "moving" ? ((t * 14 + c.pr * 7) % 18) - 9 : 0;
      wheels(ctx, x + nudge, y + ch, cw);
      box(ctx, x + nudge, y + bob, cw, ch, String(c.pr), c.state === "stuck" ? RED : c.state === "ready" ? ORANGE : PAPER, c.state === "moving" ? INK : PAPER);
      cars.push({ x, y, w: cw, h: ch, url: c.url });
    });
  }
  // past main: the last day's two newest merges roll off the end of the line, grey
  const last = merged.slice(0, 2), x0 = left + (STATIONS.length - 1) * colW + 6, run = colW - cw - 20;
  last.forEach((m, k) => {
    const x = x0 + ((t * 30 + (k * run) / 2) % run);
    wheels(ctx, x, rows[0]! + ch, cw);
    box(ctx, x, rows[0]!, cw, ch, String(m.number), GREY);
  });
}

function wheels(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = DIM;
  for (const dx of [20, w - 20]) { ctx.beginPath(); ctx.arc(x + dx, y + 3, 7, 0, Math.PI * 2); ctx.fill(); }
}

const TIER_COLOR = { certain: GREY, agree: GREY, mervin: ORANGE, differ: "#b7791f", card: RED };
const base = (p: string) => p.split("/").pop()!;

/** An agent robot carrying a PR over to Mervin's side of the screen, on a loop, ending at `x` (the tiles' left edge). */
function robot(ctx: CanvasRenderingContext2D, t: number, x: number, y: number) {
  const k = (t * 0.25) % 1, rx = 36 + (x - 120) * k, bob = Math.sin(t * 8) * 2;
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.roundRect(rx, y + bob - 20, 30, 22, 6); ctx.fill();          // head
  ctx.fillStyle = INK;
  for (const dx of [8, 22]) { ctx.beginPath(); ctx.arc(rx + dx, y + bob - 9, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = PAPER; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(rx + 15, y + bob - 20); ctx.lineTo(rx + 15, y + bob - 27); ctx.stroke(); // antenna
  ctx.fillStyle = ORANGE;
  ctx.beginPath(); ctx.roundRect(rx + 36, y + bob - 18, 34, 20, 4); ctx.fill();        // the PR it carries
  ctx.fillStyle = INK; ctx.font = "700 14px system-ui,sans-serif"; ctx.textBaseline = "middle";
  ctx.fillText("PR", rx + 44, y + bob - 8, 22);
}

/** Mervin: the share of conflicts he settled, big on the left; the contested files as tiles on the right. */
function drawMervin(ctx: CanvasRenderingContext2D, t: number) {
  const s = helpers.mervin, b = mervinBoard(s.lines), a = avoided(b, prevented);
  const all = tally && tally.total ? `all-time ${Math.round((100 * tally.avoided) / tally.total)}% of ${tally.total} · ${tally.prs} PRs` : phase(s);
  frame(ctx, `Mervin  ${b.stages.length ? `${b.stages.length} PRs in merge order` : "merge order"}`, all);
  if (s.error) return note(ctx, s.error, RED);
  if (!b.stages.length) return note(ctx, s.lines.at(-1) ?? (s.phase === "running" ? "Reading the open PRs" : "Click to call on Mervin"));
  robot(ctx, t, 440, 236);
  ctx.textBaseline = "top";
  ctx.fillStyle = a.total && a.avoided < a.total ? ORANGE : GREEN;
  ctx.font = "700 112px system-ui,sans-serif";
  ctx.fillText(a.total ? `${Math.round((100 * a.avoided) / a.total)}%` : "0", 36, 86, 320);
  ctx.font = "30px system-ui,sans-serif";
  ctx.fillStyle = DIM;
  ctx.fillText(a.total ? `${a.avoided} of ${a.total} conflicts avoided${prevented ? `, ${prevented} held early` : ""}` : "conflicts on this board", 36, 206, 380);
  // a tile a file more than one side wrote to, worst first; with none, the merge order as chips
  const x0 = 440, room = W - 36 - x0;
  const files = [...b.files].sort((p, q) => Object.keys(TIER_COLOR).indexOf(q.tier) - Object.keys(TIER_COLOR).indexOf(p.tier));
  if (!files.length) {
    const w = Math.min(230, room / b.stages.length - 10);
    b.stages.forEach((st, i) => box(ctx, x0 + i * (w + 10), 96, w, 96, `#${st.pr} ${st.certain}%`, st.certain === 100 ? GREY : ORANGE, PAPER, helpers.ester.hold.includes(st.pr) ? RED : undefined));
    return;
  }
  const n = Math.min(files.length, 6), w = room / n - 10;
  files.slice(0, n).forEach((f, i) => {
    const x = x0 + i * (w + 10);
    ctx.fillStyle = TIER_COLOR[f.tier];
    ctx.beginPath(); ctx.roundRect(x, 92, w, 140, 12); ctx.fill();
    if (f.main) { ctx.strokeStyle = PAPER; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.fillStyle = PAPER;
    ctx.font = "600 32px system-ui,sans-serif";
    ctx.fillText(i === n - 1 && files.length > n ? `+${files.length - n + 1} more` : base(f.path), x + 14, 106, w - 28);
    ctx.font = "28px system-ui,sans-serif";
    ctx.fillText(f.tier === "mervin" ? "settled" : f.tier, x + 14, 150, w - 28);
    ctx.fillText([...(f.main ? ["main"] : []), ...f.prs.map((p) => `#${p}`)].join(" "), x + 14, 190, w - 28);
  });
}

/** Ester: her stack of PRs, one bracket round them all for one run or a box each for PR by PR, and the fix button. */
function drawEster(ctx: CanvasRenderingContext2D, t: number) {
  const s = helpers.ester, st = esterStack(s);
  const n = st.blocks.length;
  frame(ctx, `Ester  ${n ? (st.mode === "each" ? `${n} PRs, one run each` : `${n} PRs stacked, one run`) : "test stack"}`, phase(s));
  fixButton = null;
  if (s.error) return note(ctx, s.error, RED);
  if (!n) return note(ctx, s.lines.at(-1) ?? (s.phase === "running" ? "Merging the stack" : `Click to test ${load().each ? "PR by PR" : "the stack in one run"}`));
  const each = st.mode === "each", gap = each ? 16 : 3, x0 = 44, room = W - 80;
  const w = Math.min(200, (room - gap * (n - 1)) / n);
  if (!each) { ctx.strokeStyle = s.phase === "red" ? RED : s.phase === "green" ? GREEN : PAPER; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x0 - 8, 88, n * w + (n - 1) * gap + 16, 92, 14); ctx.stroke(); }
  st.blocks.forEach((bl, i) => {
    const pulse = bl.state === "wait" && s.phase === "running" ? 0.55 + 0.45 * Math.abs(Math.sin(t * 3 + i * 0.6)) : 1;
    ctx.globalAlpha = pulse;
    box(ctx, x0 + i * (w + gap), 96, w, 76, `#${bl.pr}`, bl.state === "ok" ? GREEN : bl.state === "broke" ? RED : GREY);
    ctx.globalAlpha = 1;
  });
  const pr = st.broke[0];
  if (pr === undefined) {
    if (s.phase === "green" || s.phase === "red") note(ctx, s.phase === "green" ? "the stack is green: merge them together" : "red, but none of it is these PRs' (main, flaky or slow)", s.phase === "green" ? GREEN : DIM, 198);
    return;
  }
  ctx.font = "600 34px system-ui,sans-serif";
  ctx.fillStyle = RED;
  ctx.fillText(`#${pr} breaks the stack${st.broke.length > 1 ? ` (and ${st.broke.slice(1).map((p) => `#${p}`).join(", ")})` : ""}`, 36, 204, W - 560);
  const sent = fixed.has(`${s.startedAt}:${pr}`), bw = 470, bx = W - 36 - bw;
  box(ctx, bx, 188, bw, 56, sent ? `queued Haiku on #${pr}` : `Cheap fix: Haiku on #${pr}`, sent ? GREY : ORANGE, sent ? PAPER : INK);
  if (!sent) fixButton = { x: bx, w: bw, pr };
}

const DRAW: Record<Screen, (ctx: CanvasRenderingContext2D, t: number) => void> = { gitpath: drawGitpath, mervin: drawMervin, ester: drawEster };

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

function draw(only?: Screen) {
  const on = load(), t = performance.now() / 1000;
  for (const [name, s] of screens) {
    if (!on[name] || (only && name !== only)) continue;
    DRAW[name](s.ctx, t);
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
  const name = hit.object.userData.screen as Screen, x = (hit.uv?.x ?? 0) * W, y = (1 - (hit.uv?.y ?? 0)) * H;
  if (name === "gitpath") {
    const car = cars.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    if (car?.url) window.open(car.url, "_blank", "noopener");
  } else if (name === "ester" && fixButton && x >= fixButton.x && x <= fixButton.x + fixButton.w) fix(fixButton.pr);
  else if (helpers[name].phase !== "running") void call(name);
}

// ---- the data -----------------------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
async function pollHelpers() {
  clearTimeout(timer);
  const on = load();
  if (on.mervin || on.ester || on.gitpath) {
    try {
      const r = await fetch("/__rb/helpers", { credentials: "same-origin" });
      if (r.ok && !r.redirected) {
        const body: unknown = await r.json();
        if (typeof body === "object" && body && "ester" in body && "mervin" in body) {
          helpers = { ester: helperState(body.ester), mervin: helperState(body.mervin) };
          tally = "tally" in body ? tallyOf(body.tally) : null;
        }
      }
    } catch {}
    draw();
  }
  const repo = (() => { try { return JSON.parse(localStorage.getItem("rb.codesplitter") ?? "{}").repo; } catch { return undefined; } })();
  if (on.mervin && typeof repo === "string" && repo) {
    try { const r = await fetch(`/__rb/codesplitter/hold?repo=${encodeURIComponent(repo)}`); if (r.ok) prevented = preventedOf(await r.json()); } catch {}
  }
  const busy = helpers.ester.phase === "running" || helpers.mervin.phase === "running";
  timer = setTimeout(pollHelpers, busy ? 2000 : 10_000);
}

async function call(name: "mervin" | "ester") {
  const on = load(), q = name === "ester" ? (on.each ? "?each=1" : "") : on.keep ? "?keep=1" : "";
  try { await fetch(`/__rb/helpers/${name}${q}`, { method: "POST", credentials: "same-origin", headers: { "x-rb-triage": "1" } }); } catch {}
  void pollHelpers();
}

async function pollLine() {
  if (!load().gitpath) return;
  try {
    const res = await fetch("/__rb/line", { credentials: "same-origin" });
    const body: unknown = res.ok && !res.redirected ? await res.json() : null;
    if (typeof body === "object" && body && "open" in body && "merged" in body) {
      open = openPrs(body.open);
      merged = mergedPrs(body.merged);
      lineError = "error" in body && typeof body.error === "string" ? body.error : "";
    }
  } catch {}
}

// The office's socket, kept so Ester's fix button can queue a task on it like the 📋 queue's own form does.
let sock: WebSocket | undefined;
const Native = window.WebSocket;
window.WebSocket = class extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    sock = this;
  }
};

/** Queues the fix of `pr` for the cheapest worker: Haiku at low effort, with what Ester saw. */
function fix(pr: number) {
  const s = helpers.ester;
  if (!sock || sock.readyState !== Native.OPEN) return;
  sock.send(JSON.stringify({ t: "queue.add", title: `Fix #${pr} for Ester`, prompt: fixPrompt(pr, s.lines), provider: "claude", model: "haiku", effort: "low" }));
  fixed.add(`${s.startedAt}:${pr}`);
  draw("ester");
}

// ---- the setting --------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const LABEL: Record<Screen, string> = { gitpath: "gitpath", mervin: "Mervin", ester: "Ester" };
function check(name: keyof Saved, label: string, then: () => void, title = "") {
  const box = el("input", { type: "checkbox", checked: !!load()[name] });
  box.addEventListener("change", () => { save({ ...load(), [name]: box.checked }); then(); });
  return el("label", { style: "margin-right:14px", title }, box, ` ${label}`);
}
function setting() {
  const turned = () => { place(); void pollHelpers(); void pollLine().then(() => draw()); };
  const boxes = SCREENS.map((name) => check(name, LABEL[name], turned));
  const ways = el("div", { style: "margin-top:6px" },
    check("each", "Ester tests PR by PR", () => draw("ester"), "Off: the whole stack in one run, the fastest when it's green. On: a run per PR, which names the one that breaks it"),
    check("keep", "Mervin keeps a running tally", () => draw("mervin"), "Each run he's called on from the screen adds to his all-time share of conflicts avoided, kept on the office server"));
  const scope = el("span", { className: "scope you", title: "Only for you, kept in this browser" }, "Just you");
  const note = el("p", { className: "setting-note" },
    "Three screens over the task and PR boards: gitpath runs every open PR down one line to main, Mervin shows the conflicts " +
    "he took off the agents, Ester her test stack, with a button that puts a cheap worker on a PR that breaks it. Click Mervin or Ester to call on them.");
  return el("div", { className: "setting rb-screens" }, el("div", { className: "setting-head" }, el("h4", {}, "Wall screens"), scope), el("div", {}, ...boxes), ways, note);
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
  void pollLine();
  setInterval(pollLine, 60_000);
  // gitpath chugs, and Ester's waiting blocks pulse while she runs; the rest only on new data
  setInterval(() => { if (wall?.visible && document.visibilityState !== "hidden") { draw("gitpath"); if (helpers.ester.phase === "running") draw("ester"); } }, 1000 / FPS);
  // the boards may move (a floor change, a new skin): place them again
  setInterval(() => place(), 20_000);
  setInterval(() => office && (!wall || wall.parent !== office.scene) && place(), 2000);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
