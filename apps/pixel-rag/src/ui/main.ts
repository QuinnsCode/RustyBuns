// The page: pick a spot on a screenshot, get the tiles across every page that look like it, and
// race the same index search across lanes (Rust wasm workers in this tab, the TypeScript twin,
// and on the desktop, native Rust on the host's Bun workers).
import { button, chip, installUi, toast } from "@rustybuns/ui";
import { createElement, Cpu, Gauge, ImagePlus, Monitor, Share2, Zap } from "lucide";
import { pageFromFile, samplePages, type Page } from "../corpus.ts";
import { canShare, SharedIndex, type Engine, type Hit } from "../engine/index.ts";
import { WORDS32 } from "../engine/layout.ts";
import { ask, buildCorpus, TILE, type Corpus, type Match } from "../tiles.ts";
import { raceOnHost } from "../actions/race.ts";
import "./app.css";

installUi();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const icon = (i: Parameters<typeof createElement>[0], title: string) => {
  const s = createElement(i);
  s.setAttribute("aria-label", title);
  const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
  t.textContent = title;
  s.prepend(t);
  return s;
};
const fmt = (ms: number) => (ms < 10 ? ms.toFixed(2) : ms.toFixed(0)) + " ms";
const cores = navigator.hardwareConcurrency || 4;

async function loadWasm(): Promise<Uint8Array | null> {
  try {
    const r = await fetch("/pixel_rag.wasm");
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("wasm")) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
}
async function hasHost(): Promise<boolean> {
  try {
    const r = await fetch("/__rb/info");
    if (!r.ok) return false;
    const info: unknown = await r.json();
    return typeof info === "object" && info !== null && "caps" in info && typeof info.caps === "object" && info.caps !== null && "ffi" in info.caps && info.caps.ffi === true;
  } catch { return false; }
}

const state = {
  wasm: null as Uint8Array | null,
  host: false,
  corpus: null as Corpus | null,
  page: 0,
  spot: null as { x: number; y: number } | null,
  matches: [] as Match[],
  last: "",
  workers: Math.min(4, cores),
  lane: "wasm" as Engine,
  races: [] as Race[],
};

interface Race { lane: string; where: "tab" | "desktop"; workers: number; n: number; ms: number; best: number; same: boolean | null }

const spawnWorker = () => new Worker(new URL("../engine/search-worker.ts", import.meta.url), { type: "module" });

// ---- layout ----
document.body.className = "ui";
$("#root").append(
  (() => {
    const h = el("header", "top");
    const title = el("div", "title");
    title.append(el("h1", "", "Pixel RAG"), el("p", "", "Click pic. Find same."));
    const chips = el("div", "status"); chips.id = "status";
    h.append(title, chips);
    return h;
  })(),
  (() => {
    const s = el("section", "find ui-panel");
    const head = el("div", "row");
    head.append(el("h2", "", "Find"), el("span", "dim grow", "Click."));
    const add = el("label", "ui-btn icon");
    add.title = "Add pics";
    add.append(icon(ImagePlus, "Add pics"));
    const file = el("input"); file.type = "file"; file.accept = "image/*"; file.multiple = true; file.hidden = true;
    file.onchange = () => { if (file.files?.length) void addFiles([...file.files]); file.value = ""; };
    add.append(file);
    head.append(add);
    const strip = el("div", "strip"); strip.id = "strip";
    const body = el("div", "body");
    const stage = el("div", "stage"); stage.id = "stage";
    const out = el("div", "results");
    const line = el("p", "dim line"); line.id = "line";
    const grid = el("div", "grid"); grid.id = "grid";
    out.append(line, grid);
    body.append(stage, out);
    s.append(head, strip, body);
    return s;
  })(),
  (() => {
    const s = el("section", "race ui-panel");
    const head = el("div", "row");
    head.append(el("h2", "", "Race"), el("span", "dim grow", "Who fast?"));
    const controls = el("div", "controls"); controls.id = "controls";
    const table = el("table", "runs"); table.id = "runs";
    s.append(head, controls, table);
    return s;
  })(),
);

function renderStatus() {
  const s = $("#status");
  s.replaceChildren();
  const tag = (i: Parameters<typeof createElement>[0], label: string, on: boolean, tip: string) => {
    const t = el("span", "tag" + (on ? " on" : ""));
    t.title = tip;
    t.append(icon(i, tip), el("span", "", label));
    s.append(t);
  };
  tag(Zap, state.wasm ? "Rust" : "TS", !!state.wasm, state.wasm ? "pixel_rag.wasm loaded: the crate runs in this tab" : "No wasm build: the TypeScript twin runs (same answers, slower)");
  tag(Share2, canShare() ? "Shared" : "Solo", canShare(), canShare() ? "Cross-origin isolated: workers search one SharedArrayBuffer" : "Not cross-origin isolated: one thread only");
  tag(Monitor, state.host ? "Desktop" : "Web", state.host, state.host ? "A Rusty Buns desktop host is behind this page: native Rust lanes are on" : "In a browser: build the desktop app for the native lanes");
}

// ---- find ----
function renderStrip() {
  const c = state.corpus!;
  const strip = $("#strip");
  strip.replaceChildren(...c.pages.map((p, i) => {
    const b = el("button", "thumb" + (i === state.page ? " on" : ""));
    b.title = p.name;
    const img = el("canvas");
    img.width = 160; img.height = Math.round((160 * p.canvas.height) / p.canvas.width);
    img.getContext("2d")!.drawImage(p.canvas, 0, 0, img.width, img.height);
    b.append(img);
    b.onclick = () => { state.page = i; state.spot = null; renderStrip(); renderStage(); };
    return b;
  }));
}

function renderStage() {
  const c = state.corpus!;
  const page = c.pages[state.page];
  const stage = $("#stage");
  const view = el("canvas");
  view.width = page.canvas.width; view.height = page.canvas.height;
  const g = view.getContext("2d")!;
  g.drawImage(page.canvas, 0, 0);
  const mark = (m: { x: number; y: number }, color: string, w: number) => { g.strokeStyle = color; g.lineWidth = w; g.strokeRect(m.x + w / 2, m.y + w / 2, TILE - w, TILE - w); };
  for (const m of state.matches) if (m.page === state.page) mark(m, "#e8590c99", 4);
  if (state.spot) mark({ x: state.spot.x - TILE / 2, y: state.spot.y - TILE / 2 }, "#e8590c", 6);
  view.onclick = (e) => {
    const r = view.getBoundingClientRect();
    void query(state.page, ((e.clientX - r.left) / r.width) * view.width, ((e.clientY - r.top) / r.height) * view.height);
  };
  stage.replaceChildren(view);
}

function renderMatches() {
  const c = state.corpus!;
  $("#line").textContent = state.last;
  $("#grid").replaceChildren(...state.matches.map((m) => {
    const b = el("button", "match");
    const cv = el("canvas");
    cv.width = cv.height = TILE;
    cv.getContext("2d")!.drawImage(c.pages[m.page].canvas, m.x, m.y, TILE, TILE, 0, 0, TILE, TILE);
    const cap = el("span", "cap");
    cap.append(el("b", "", c.pages[m.page].name), el("span", "dim", ` ${(m.score * 100).toFixed(0)}%`));
    b.title = `${m.dist} bits off`;
    b.append(cv, cap);
    b.onclick = () => { state.page = m.page; renderStrip(); void query(m.page, m.x + TILE / 2, m.y + TILE / 2); };
    return b;
  }));
}

async function query(p: number, x: number, y: number) {
  const c = state.corpus!;
  state.spot = { x: Math.max(TILE / 2, Math.min(c.pages[p].canvas.width - TILE / 2, x)), y: Math.max(TILE / 2, Math.min(c.pages[p].canvas.height - TILE / 2, y)) };
  const r = await ask(c, p, x, y);
  state.spot = { x: r.tile.x + TILE / 2, y: r.tile.y + TILE / 2 };
  state.matches = r.matches;
  const lanes = c.index.workers ? `${c.index.workers} ${c.index.searchEngine}` : c.index.engine;
  state.last = `${c.index.used.toLocaleString()} tiles · ${fmt(r.searchMs)} · ${lanes}`;
  renderStage(); renderMatches();
}

async function index(pages: Page[]) {
  state.corpus?.index.stop();
  $("#line").textContent = "…";
  const c = await buildCorpus(pages, state.wasm);
  state.corpus = c;
  if (canShare() && state.workers > 0) await c.index.start(state.workers, c.index.engine, spawnWorker);
  state.page = Math.min(state.page, pages.length - 1);
  state.matches = [];
  renderStrip();
  const p = c.pages[state.page];
  await query(state.page, p.canvas.width * 0.85, 30);
  $("#line").title = `${pages.length} pages, ${c.index.used} tiles, embedded in ${fmt(c.ms.embed)}; ${c.skipped.blank} blank and ${c.skipped.repeat} repeat tiles skipped`;
}

async function addFiles(files: File[]) {
  try {
    const more = await Promise.all(files.filter((f) => f.type.startsWith("image/")).map(pageFromFile));
    if (!more.length) return;
    await index([...more, ...state.corpus!.pages]);
    state.page = 0; renderStrip(); renderStage();
    toast(`+${more.length}`);
  } catch (e) {
    toast(String(e instanceof Error ? e.message : e));
  }
}
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]); });

// ---- race ----
const SIZES = [100_000, 1_000_000, 4_000_000];
const race = { n: 1_000_000, seed: 7, row: 12345, k: 10, ref: new Map<number, string>() };
const key = (hits: Hit[]) => hits.map((h) => `${h.row}:${h.dist}`).join(",");

type Lane = { id: string; label: string; where: "tab" | "desktop"; engines: Engine[]; tip: string };
const LANES: Lane[] = [
  { id: "wasm", label: "Wasm", where: "tab", engines: ["wasm"], tip: "The crate as wasm, one instance per Web Worker, all on one shared memory" },
  { id: "ts", label: "TS", where: "tab", engines: ["ts"], tip: "The TypeScript twin in Web Workers, on typed views of the same memory" },
  { id: "native", label: "Native", where: "desktop", engines: ["native"], tip: "The crate over bun:ffi in the host's Bun workers, pointing at one SharedArrayBuffer" },
  { id: "mixed", label: "Native+TS", where: "desktop", engines: ["native", "ts"], tip: "Bun workers on native Rust and on the twin, side by side on one memory" },
];
let picked = new Set(["wasm"]);

function renderControls() {
  const c = $("#controls");
  c.replaceChildren();
  const group = (label: string, ...kids: Node[]) => { const g = el("div", "group"); g.append(el("span", "dim", label), ...kids); c.append(g); };
  group("Size", ...SIZES.map((n) => chip(n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`, () => { race.n = n; renderControls(); }, race.n === n)));
  const counts = [0, 1, 2, 4, 8, 12].filter((w) => w <= Math.max(cores, 4));
  group("Workers", ...counts.map((w) => {
    const b = chip(w === 0 ? "1×" : String(w), () => { state.workers = w; renderControls(); void restartCorpus(); }, state.workers === w);
    b.title = w === 0 ? "On this thread, no workers" : `${w} workers sharing one memory`;
    return b;
  }));
  group("Lanes", ...LANES.map((l) => {
    const ok = l.where === "tab" ? (l.id !== "wasm" || !!state.wasm) : state.host;
    const b = chip(l.label, (on) => { if (on) picked.add(l.id); else picked.delete(l.id); renderControls(); }, picked.has(l.id) && ok);
    b.disabled = !ok;
    b.title = ok ? l.tip : l.where === "desktop" ? "Desktop only" : "No wasm";
    return b;
  }));
  const go = button({ label: "Go", primary: true, icon: icon(Gauge, "Go"), onClick: () => void runRace() });
  go.id = "go";
  c.append(go);
}

async function restartCorpus() {
  const c = state.corpus;
  if (!c) return;
  c.index.stop();
  if (canShare() && state.workers > 0) await c.index.start(state.workers, c.index.engine, spawnWorker);
}

let tabIndex: SharedIndex | null = null;
async function runRace() {
  const go = $<HTMLButtonElement>("#go");
  go.disabled = true;
  try {
    for (const l of LANES.filter((x) => picked.has(x.id))) {
      const n = race.n, w = canShare() ? state.workers : 0;
      let r: Race;
      if (l.where === "tab") {
        if (!tabIndex || tabIndex.layout.n !== n) {
          tabIndex?.stop();
          tabIndex = await SharedIndex.create({ capacity: n, wasm: state.wasm });
          tabIndex.fillRandom(race.seed);
        }
        if (w > 0) await tabIndex.start(w, l.engines, spawnWorker); else tabIndex.stop();
        const q = tabIndex.codes().slice(race.row * WORDS32, (race.row + 1) * WORDS32);
        q[0] ^= 1;
        await tabIndex.search(q, race.k);
        const runs: number[] = [];
        let last = await tabIndex.search(q, race.k);
        for (let i = 0; i < 5; i++) { last = await tabIndex.search(q, race.k); runs.push(last.ms); }
        tabIndex.stop();
        r = { lane: w === 0 ? `${tabIndex.engine === "wasm" ? "Wasm" : "TS"} 1×` : l.label, where: "tab", workers: w, n, ms: runs.reduce((a, b) => a + b) / runs.length, best: Math.min(...runs), same: check(n, last.hits) };
      } else {
        const h = await raceOnHost(n, race.seed, race.row, race.k, Math.max(1, w), l.engines);
        r = { lane: l.label, where: "desktop", workers: h.workers, n, ms: h.ms, best: h.best, same: check(n, h.hits) };
      }
      state.races.unshift(r);
      renderRuns();
    }
  } catch (e) {
    toast(String(e instanceof Error ? e.message : e));
  } finally {
    go.disabled = false;
  }
}

/** The first answer for a size is the reference; every later lane must give exactly the same one. */
function check(n: number, hits: Hit[]): boolean | null {
  const k = key(hits);
  if (!race.ref.has(n)) { race.ref.set(n, k); return null; }
  return race.ref.get(n) === k;
}

function renderRuns() {
  const t = $("#runs");
  t.replaceChildren();
  if (!state.races.length) return;
  const head = el("tr");
  for (const h of ["Lane", "", "Workers", "Size", "Avg", "Best", "Same"]) head.append(el("th", "", h));
  t.append(head);
  const fastest = Math.min(...state.races.map((r) => r.best));
  for (const r of state.races.slice(0, 24)) {
    const tr = el("tr", r.best === fastest ? "win" : "");
    const where = el("td");
    where.append(icon(r.where === "tab" ? Zap : Cpu, r.where === "tab" ? "Tab" : "Desktop"));
    tr.append(el("td", "", r.lane), where, el("td", "", r.workers ? String(r.workers) : "1×"), el("td", "", r.n >= 1e6 ? `${r.n / 1e6}M` : `${r.n / 1e3}k`),
      el("td", "", fmt(r.ms)), el("td", "", fmt(r.best)), el("td", r.same === false ? "bad" : "", r.same === null ? "ref" : r.same ? "yes" : "NO"));
    t.append(tr);
  }
}

// ---- boot ----
declare global { interface Window { pixelRag: unknown } }
window.pixelRag = {
  state: () => ({
    engine: state.corpus?.index.engine, shared: canShare(), host: state.host, workers: state.corpus?.index.workers,
    pages: state.corpus?.pages.length, tiles: state.corpus?.index.used, page: state.page, spot: state.spot, last: state.last,
    matches: state.matches.slice(0, 5).map((m) => ({ page: state.corpus?.pages[m.page].name, x: m.x, y: m.y, dist: m.dist, score: +m.score.toFixed(3) })),
    races: state.races,
  }),
  ask: (p: number, x: number, y: number) => query(p, x, y),
  race: async (o: { n?: number; workers?: number; lanes?: string[] } = {}) => {
    if (o.n) race.n = o.n;
    if (o.workers !== undefined) state.workers = o.workers;
    if (o.lanes) picked = new Set(o.lanes);
    renderControls();
    await runRace();
    return state.races;
  },
};

[state.wasm, state.host] = await Promise.all([loadWasm(), hasHost()]);
renderStatus();
renderControls();
await index(samplePages());
