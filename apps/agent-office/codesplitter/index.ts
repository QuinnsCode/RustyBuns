// codeSplitter in the office, off until you turn it on in Settings › You (kept in this browser, like the clock).
// On, each of the 📌 issues, 📋 queue and 🔀 PR boards gets the codeSplitter mark beside it: a small tile on the
// wall in the 3D office, a badge on its tab on /lite. A dot on the mark, and on the tab's favicon, says that
// board's twin on codeSplitter has news (news.ts); clicking the mark opens the repo there and clears its dot.
// The news comes from the office's /__rb/codesplitter (server.ts), every 30s.
import { CanvasTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, type Camera, type Object3D, type Scene } from "three";
import { faviconWithDot, markCanvas, markSvg } from "./mark.ts";
import { BOARDS, fresh, type Board, type Summary } from "./news.ts";

const KEY = "rb.codesplitter";
interface Saved { on?: boolean; repo?: string; seen?: Partial<Record<Board, string>> }
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem("rb.codesplitters") ?? "{}"); } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

let siteUrl = "";
let summary: Summary | null = null;
let lit = new Set<Board>();
const LABEL: Record<Board, string> = { issues: "checks failing on main", queue: "coding-agent runs", pulls: "branches" };

const repoLink = () => {
  const { repo } = load();
  return repo ? `${siteUrl}/#/r/${repo}` : `${siteUrl}/`;
};
function open(board: Board) {
  const s = load();
  const l = summary?.[board];
  if (l) save({ ...s, seen: { ...s.seen, [board]: l.stamp } });
  window.open(repoLink(), "_blank", "noopener");
  void poll();
}
const title = (b: Board) => {
  const l = summary?.[b];
  return `codeSplitter: ${LABEL[b]}${l ? ` · ${l.text}` : ""}${lit.has(b) ? " (new)" : ""}`;
};

async function poll() {
  const s = load();
  if (!s.on) return paint();
  try {
    const r = await fetch(`/__rb/codesplitter?repo=${encodeURIComponent(s.repo ?? "")}`);
    const body = await r.json() as { site: string; boards: Summary | null };
    siteUrl = body.site;
    summary = body.boards;
  } catch { summary = null; }
  if (summary) {
    const f = fresh(summary, s.seen ?? {});
    lit = new Set(f.boards);
    save({ ...load(), seen: f.seen });
  } else lit = new Set();
  paint();
}

function paint() {
  const on = !!load().on;
  liteMarks(on);
  favicon(on && lit.size > 0);
  void wallMarks(on);
}

// ---- the favicon --------------------------------------------------------------------------------------------

let plainIcon: string | null = null;
let dotted = false;
async function favicon(dot: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link || dot === dotted) return;
  plainIcon ??= link.href;
  dotted = dot;
  link.href = dot ? await faviconWithDot(plainIcon) : plainIcon;
}

// ---- /lite: a badge on each board's tab ---------------------------------------------------------------------

// The tabs sit in a grid, so the mark goes inside each one, on its corner like a badge, and keeps its click to itself.
function liteMarks(on: boolean) {
  const nav = document.querySelector("nav.lite-nav");
  if (!nav) return;
  if (!on) return nav.querySelectorAll(".rb-cs").forEach((e) => e.remove());
  for (const b of BOARDS) {
    const tab = nav.querySelector<HTMLElement>(`#btn-${b}`);
    if (!tab) continue;
    let mark = tab.querySelector<HTMLElement>(".rb-cs");
    if (!mark) {
      mark = Object.assign(document.createElement("span"), { className: "rb-cs", role: "link", tabIndex: 0 });
      const go = (e: Event) => { e.stopPropagation(); e.preventDefault(); open(b); };
      mark.addEventListener("click", go);
      mark.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && go(e));
      tab.append(mark);
    }
    // only when the dot changes: a rewrite is a mutation, which would bring us straight back here
    const dot = String(lit.has(b));
    if (mark.dataset.dot !== dot) {
      mark.dataset.dot = dot;
      mark.innerHTML = markSvg(lit.has(b), 18);
    }
    mark.title = mark.ariaLabel = title(b);
  }
}

// ---- the 3D office: a tile on the wall beside each board ---------------------------------------------------

interface App { scene: Scene; camera: Camera; canvas: HTMLCanvasElement; office: { boardMeshes?: Partial<Record<string, Mesh>> } }
// the office hands itself to every add-on on the frame hook, in either skin (scripts/rustybunsify.ts)
let office: App | undefined;
((globalThis as { __rbOfficeTicks?: unknown[] }).__rbOfficeTicks ??= []).push((a: App) => void (office = a));
const app = () => office;
const SIZE = 0.55;
let wall: Group | null = null;
const tiles = new Map<Board, { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; dot: boolean | null }>();

async function wallMarks(on: boolean) {
  const a = app();
  if (!a?.office.boardMeshes) return;
  if (!on) {
    if (wall) wall.visible = false;
    return;
  }
  if (!wall || wall.parent !== a.scene) {
    wall?.removeFromParent();
    wall = new Group();
    wall.name = "rb-codesplitter";
    wall.userData.rbForest = "skip"; // the Druids skin leaves its colours alone
    a.scene.add(wall);
    tiles.clear();
    a.canvas.addEventListener("click", (e) => clicked(e, a));
  }
  wall.visible = true;
  for (const b of BOARDS) {
    const board = a.office.boardMeshes[b];
    if (!board) continue;
    let t = tiles.get(b);
    if (!t) {
      t = { mesh: new Mesh(new PlaneGeometry(SIZE, SIZE), new MeshBasicMaterial({ transparent: true })), dot: null };
      t.mesh.matrixAutoUpdate = false;
      t.mesh.userData.board = b;
      tiles.set(b, t);
      wall.add(t.mesh);
    }
    // the top right corner of the board, just past its frame, a hair off the wall
    const p = (board.geometry as PlaneGeometry).parameters;
    board.updateWorldMatrix(true, false);
    t.mesh.matrix.copy(board.matrixWorld).multiply(new Matrix4().makeTranslation(p.width / 2 + 0.25 + SIZE / 2, p.height / 2 - SIZE / 2, 0.03));
    t.mesh.matrixWorldNeedsUpdate = true;
    const dot = lit.has(b);
    if (t.dot !== dot) {
      t.dot = dot;
      const tex = new CanvasTexture(await markCanvas(dot));
      tex.colorSpace = SRGBColorSpace;
      t.mesh.material.map?.dispose();
      t.mesh.material.map = tex;
      t.mesh.material.needsUpdate = true;
    }
  }
}

const ray = new Raycaster();
function clicked(e: MouseEvent, a: App) {
  if (!wall?.visible) return;
  // looking around, the crosshair is the middle of the screen; otherwise it's the pointer
  const r = a.canvas.getBoundingClientRect();
  const at = document.pointerLockElement ? new Vector2(0, 0)
    : new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(at, a.camera);
  const hit = ray.intersectObjects(wall.children as Object3D[], false)[0];
  if (hit && hit.distance < 25) open(hit.object.userData.board as Board);
}

// ---- the setting --------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

function setting() {
  const s = load();
  const box = el("input", { type: "checkbox", checked: !!s.on });
  const repo = el("input", { type: "text", placeholder: "owner/repo", value: s.repo ?? "", ariaLabel: "codeSplitter repo", spellcheck: false });
  repo.style.cssText = "width:100%;margin-top:6px";
  const changed = () => {
    save({ ...load(), on: box.checked, repo: repo.value.trim() || undefined, seen: repo.value.trim() === (load().repo ?? "") ? load().seen : {} });
    void poll();
  };
  box.addEventListener("change", changed);
  repo.addEventListener("change", changed);
  const scope = el("span", { className: "scope you", title: "Only for you, kept in this browser" }, "Just you");
  const note = el("p", { className: "setting-note" },
    "The codeSplitter mark beside the issues, queue and PR boards, with a dot when its checks, agents or branches have news.");
  return el("div", { className: "setting rb-codesplitter" },
    el("div", { className: "setting-head" }, el("h4", {}, "codeSplitter"), scope),
    el("label", {}, box, " Show it"), repo, note);
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-codesplitter")) pane.append(setting());
}

function start() {
  const style = document.createElement("style");
  style.textContent = ".lite-nav #btn-issues,.lite-nav #btn-pulls,.lite-nav #btn-queue{position:relative}" +
    ".rb-cs{position:absolute;top:-9px;right:-9px;padding:2px;background:#fff;border:2px solid var(--ink,#222);" +
    "border-radius:8px;cursor:pointer;line-height:0}.rb-cs svg{display:block}";
  document.head.append(style);
  document.querySelectorAll(".modal.settings").forEach(addTo);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(".modal.settings")) addTo(n);
      else n.querySelectorAll(".modal.settings").forEach(addTo);
      // /lite rebuilds its nav; put the marks back
      if (load().on && (n.matches("nav.lite-nav") || n.closest("nav.lite-nav"))) liteMarks(true);
    }
  }).observe(document.body, { childList: true, subtree: true });
  void poll();
  // in the background too: the favicon's dot is for a tab you aren't looking at
  setInterval(poll, 30_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && poll());
  // the office's 3D world arrives a while after the page; the tiles go up once it's there
  setInterval(() => load().on && app() && (!wall || tiles.size < BOARDS.length) && wallMarks(true), 2000);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
