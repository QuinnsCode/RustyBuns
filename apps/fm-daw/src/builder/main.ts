// Q Builder (/builder.html): change it, scope it, retest it, order it. Any pedal with a board, the clip pedals and the
// effects: click a diode, capacitor or resistor to swap it (the board view, ../amp/board.ts), click a trace to put the
// scope on its net, and Play runs the riff through the circuit with the scope following along. An effect's LFO or
// envelope moves its parts as on Q Amp, and its control net (GATE, LED, FOOT) scopes the control itself.
// The knobs and swaps are Q Amp's (../amp/parts-store.ts): a part swapped here is on Q Amp's pedal too, and back. Remake writes your
// parts into the board (circuit JSON and tscircuit source, ../circuit/builder.ts), plays the same riff through the
// remake and through your board, and says whether they match. Build it draws the board from its kit's Gerbers (../kit/gerber.ts), prints the sheet, and saves the files.
// The riff runs in a worker (worker.ts). window.qbuilder drives it (scripts/probe.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./builder.css";
import { check, obj, or, rec, str } from "@rustybuns/util/guard";
import { BoardView, fit, svgOf } from "../amp/board.ts";
import { mockup, type BoardSide, type Mockup } from "../kit/gerber.ts";
import { gerbers, kitId, kitZip, sheetOf, type KitFiles } from "../kit/kit.ts";
import { kitFiles } from "../kit/sheet.ts";
import { zip } from "../kit/zip.ts";
import { h, iconButton } from "../amp/dom.ts";
import { icon } from "../amp/icons.ts";
import { swapWontPlay } from "../circuit/bench.ts";
import { BUILDER_PEDALS, INPUT_VOLTS, SR, WINDOW, builderPedal, changes, isBuilderPedal, remakeJson, remakeTsx, restAt, scopeNets, theRiff, type BuilderPedal, type Retest, type ScopeNet } from "../circuit/builder.ts";
import type { Swaps } from "../circuit/circuits.ts";
import { onParts, readParts, writeParts } from "../amp/parts-store.ts";
import type { BenchReply, Unsent } from "./messages.ts";

/** The page's own: the pedal open and the net the scope sits on, per pedal. The knobs and swaps are Q Amp's. */
const KEY = "qbuilder:v1";
const Saved = obj({
  pedal: or(str(12), "fuzz"),
  probe: or(rec(str(400), 16), {}),
});
const S = (() => {
  try { return check(Saved, JSON.parse(localStorage.getItem(KEY) ?? "{}")) ?? check(Saved, {}); } catch { return check(Saved, {}); }
})() ?? { pedal: "fuzz", probe: {} };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* not kept, fine */ } };

const TSX = import.meta.glob<string>("../../circuits/*.tsx", { query: "?raw", import: "default" });

let pedal: BuilderPedal = isBuilderPedal(S.pedal) ? S.pedal : "fuzz";
let nets: ScopeNet[] = [];
let probe: ScopeNet | null = null;
let wave: { out: Float32Array; at: Float32Array; swing: { hi: number; lo: number; flat: number }; misses: number } | null = null;
let result: Retest | null = null;
let busy = 0, retesting = false, why = "";
let parts = readParts();

const def = () => builderPedal(pedal);
const drive = () => parts.drive[pedal] ?? 5;
const swaps = (): Swaps => parts.swaps[pedal] ?? {};

// ---- the page ----
const app = h("main", "qb");
const pedalTabs = BUILDER_PEDALS.map((id) => {
  const b = h("button", "qb-pedal", builderPedal(id).name);
  b.type = "button"; b.dataset.pedal = id;
  b.addEventListener("click", () => pick(id));
  return b;
});
const driveIn = h("input", "qb-drive");
driveIn.type = "range"; driveIn.min = "0"; driveIn.max = "10"; driveIn.step = "0.5";
const knobName = h("span", "");
const driveVal = h("output", "qb-drive-val");
driveIn.addEventListener("input", () => { setDrive(Number(driveIn.value)); });
const playBtn = iconButton("play", "Play the riff through the board", () => void togglePlay());
playBtn.classList.add("qb-play");
const head = h("header", "qb-head", h("h1", "", icon("circuit-board", 18), "Q Builder"), h("nav", "qb-pedals", ...pedalTabs),
  h("label", "qb-knob", knobName, driveIn, driveVal), playBtn);

const board = new BoardView((socket, choice) => swap(socket, choice), (key) => setProbe(key));

const canvas = h("canvas", "qb-scope");
const scopeTitle = h("span", "qb-scope-title");
const scopeRead = h("p", "qb-read");
const netList = h("div", "qb-nets");
netList.setAttribute("role", "radiogroup"); netList.setAttribute("aria-label", "The net the scope is on");
const scope = h("section", "qb-card", h("div", "qb-card-top", icon("activity", 16), h("span", "qb-card-title", "Scope"), scopeTitle), canvas, scopeRead,
  h("p", "qb-hint", "Click a trace on the schematic, or a net here:"), netList);

const retestBtn = h("button", "qb-btn", icon("repeat", 16), "Remake and retest");
retestBtn.type = "button";
retestBtn.addEventListener("click", () => void runRetest());
const retestOut = h("p", "qb-read");
const files = h("div", "qb-files");
const remake = h("section", "qb-card", h("div", "qb-card-top", icon("workflow", 16), h("span", "qb-card-title", "Remake in tscircuit")),
  h("p", "qb-hint", "Writes your parts into the board, then plays the same riff through the remake and your board and compares them."),
  retestBtn, retestOut, files);

// Build it: the board as a fab makes it, drawn from the kit's own Gerbers and drill file (../kit/gerber.ts), a print
// of the schematic, both sides of the board and the parts with your swaps, and the files to order it with.
let side: BoardSide = "top", kit: KitFiles = {}, made: Mockup | null = null, kitAsk = 0, kitLoad = Promise.resolve();
const mock = h("div", "qb-mock");
const mockRead = h("p", "qb-hint");
const sideBtns = (["top", "bottom"] as const).map((s) => {
  const b = h("button", "qb-side-btn", s === "top" ? "Top" : "Bottom");
  b.type = "button"; b.dataset.side = s;
  b.addEventListener("click", () => setSide(s));
  return b;
});
const actBtn = (name: string, label: string, title: string, go: () => void) => {
  const b = h("button", "qb-btn qb-act", icon(name, 16), label);
  b.type = "button"; b.title = title;
  b.addEventListener("click", go);
  return b;
};
const printBtn = actBtn("printer", "Print", "Print the schematic, both sides of the board and the parts list", () => void printSheet().then(() => print()));
const gerberBtn = actBtn("download", "Gerbers", "The board's Gerber and drill files, as one zip: what a board house takes", () => saveGerbers());
const kitBtn = actBtn("download", "Kit", "The whole kit: Gerbers, parts list and order list with your parts, pick-and-place, schematic and build sheet", () => void saveKit());
const build = h("section", "qb-card", h("div", "qb-card-top", icon("circuit-board", 16), h("span", "qb-card-title", "Build it"), h("div", "qb-sides", ...sideBtns)),
  mock, mockRead, h("div", "qb-acts", printBtn, gerberBtn, kitBtn));
// What Print prints: filled when asked, laid out off screen so the schematic can be cropped to what is drawn.
const sheetEl = h("section", "qb-print");
sheetEl.setAttribute("aria-hidden", "true");

app.append(head, h("div", "qb-body", board.el, h("aside", "qb-side", scope, remake, build)));
document.body.append(app, sheetEl);

// ---- the bench thread ----
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let asked = 0;
const waiting = new Map<number, (r: BenchReply) => void>();
worker.onmessage = (e: MessageEvent<BenchReply>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
const ask = (m: Unsent): Promise<BenchReply> => new Promise((done) => {
  const id = ++asked;
  waiting.set(id, done);
  worker.postMessage({ ...m, id });
});

/** The riff through the board as it stands, the scope on `probe`. An answer to an older ask is dropped. */
let latest = 0;
async function run(): Promise<void> {
  if (!probe) return;
  const mine = ++latest;
  busy++; paint();
  const r = await ask({ t: "play", pedal, drive: drive(), swaps: swaps(), node: probe.node });
  busy--;
  if (mine !== latest) return paint();
  if (r.t === "play") { wave = r; why = r.misses ? `the solver gave up on ${r.misses} samples` : ""; }
  else if (r.t === "error") why = r.why;
  paint();
  draw();
}

// ---- what the player does ----
function pick(id: BuilderPedal): void {
  pedal = id; S.pedal = id; save();
  parts = readParts();
  nets = scopeNets(def().board);
  // First the net a clipper holds down to ground (no op-amp on it), else one with diodes on it, else what comes out.
  const diodes = (n: ScopeNet) => n.parts.some((p) => p.startsWith("D")) && n.node !== "OUT";
  probe = nets.find((n) => n.key === S.probe[id]) ?? nets.find((n) => diodes(n) && !n.parts.some((p) => p.startsWith("U"))) ?? nets.find(diodes) ?? nets.at(-1) ?? null;
  wave = null; result = null; files.replaceChildren();
  showBoard();
  void run();
  kitLoad = loadKit();
}

/** The open pedal's kit folder (`circuits/q-fuzz/`), and its board drawn from the Gerbers in it. */
async function loadKit(): Promise<void> {
  const ask = ++kitAsk, k = await kitFiles(kitId(def().name));
  if (ask !== kitAsk) return;
  kit = k;
  drawMock();
}

function setSide(s: BoardSide): void { side = s; drawMock(); }

function drawMock(): void {
  made = mockup(kit, side);
  mock.innerHTML = made?.svg ?? "";
  mock.hidden = !made;
  const name = def().name;
  mockRead.textContent = made
    ? `${made.size[0]} × ${made.size[1]} mm, two layers, ${made.holes} holes, ${made.pads} pads: drawn from the Gerbers you'd send a board house, ${side === "top" ? "parts side up" : "seen from below"}.`
      + (made.unread.length ? ` Not drawn: ${made.unread.join(", ")}.` : "")
    : `${name} has no board files yet, so there's nothing to order. Print still prints its schematic.`;
  for (const b of sideBtns) { b.setAttribute("aria-pressed", String(b.dataset.side === side)); b.disabled = !made; }
  gerberBtn.disabled = kitBtn.disabled = !made;
}

function saveFile(name: string, bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = h("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The Gerber and drill layers alone, as `<kit>-gerbers.zip`. */
function gerberZip(): { name: string; bytes: Uint8Array<ArrayBuffer> } {
  const files: Record<string, string> = {};
  for (const g of gerbers(kit)) files[g] = kit[`gerbers/${g}`]!;
  return { name: `${kitId(def().name)}-gerbers.zip`, bytes: zip(files) };
}
function saveGerbers(): void { const z = gerberZip(); saveFile(z.name, z.bytes); }

/** The whole kit with your parts in its lists, as Q Amp's build sheet saves it. */
async function saveKit(): Promise<void> {
  const s = sheetOf(def(), kit, swaps());
  saveFile(`${s.kit}-kit.zip`, kitZip(kit, s.text, await svgOf(def().board, "schematic"), s.parts));
}

/** Fills the print sheet: the pedal, your changes, the schematic, both sides of the board and the parts. Its headings. */
async function printSheet(): Promise<string[]> {
  const d = def(), s = sheetOf(d, kit, swaps()), what = changes(d.board, swaps());
  const sch = h("div", "qp-art qp-sch");
  sch.innerHTML = await svgOf(d.board, "schematic");
  const sides = (["top", "bottom"] as const).map((x) => {
    const m = mockup(kit, x), f = h("figure", "qp-side");
    if (!m) return null;
    const art = h("div", "qp-art");
    art.innerHTML = m.svg;
    f.append(art, h("figcaption", "", x === "top" ? "Top, parts side" : "Bottom, seen from below"));
    return f;
  }).filter((f) => f !== null);
  // The Order column only when some part has a number to order it by.
  const order = s.lines.some((l) => l.mpn), table = h("table", "qp-parts");
  table.append(h("thead", "", h("tr", "", ...["Qty", "Part", "Value", "Where", ...(order ? ["Order"] : [])].map((t) => h("th", "", t)))),
    h("tbody", "", ...s.lines.map((l) => h("tr", l.swapped ? "yours" : "", h("td", "", String(l.count)), h("td", "", l.part),
      h("td", "", l.value + (l.swapped ? " (yours)" : "")), h("td", "", l.refs.join(" ")), ...(order ? [h("td", "", [l.maker, l.mpn].filter(Boolean).join(" "))] : [])))));
  const m = mockup(kit, "top");
  sheetEl.replaceChildren(
    h("header", "qp-head", h("h1", "", d.name), h("p", "", what ? `Your version: ${what}.` : "Stock parts."), h("p", "qp-dim", d.blurb)),
    h("section", "", h("h2", "", "Schematic"), sch),
    ...(sides.length ? [h("section", "", h("h2", "", "Circuit board"), h("p", "qp-dim", `${m?.size.join(" × ")} mm, drawn from the files a board house takes: ${gerbers(kit).join(", ")}.`), h("div", "qp-sides", ...sides))] : []),
    ...(s.lines.length ? [h("section", "", h("h2", "", "Parts"), table)] : []),
    h("p", "qp-dim", `Q Builder · ${new Date().toLocaleDateString("en-CA")}`),
  );
  fit(sch.querySelector("svg"));
  return [...sheetEl.querySelectorAll("h1, h2")].map((e) => e.textContent ?? "");
}

function setDrive(v: number): void {
  writeParts(pedal, Math.max(0, Math.min(10, v)), swaps());
  parts = readParts();
  result = null; files.replaceChildren();
  paint();
  void run();
}

function setProbe(keyOrLabel: string): boolean {
  const n = nets.find((x) => x.key === keyOrLabel || x.label === keyOrLabel || x.node === keyOrLabel);
  if (!n) return false;
  probe = n; S.probe[pedal] = n.key; save();
  wave = null;
  board.probe(n.key);
  paint();
  void run();
  return true;
}

/** Puts `choice` in `socket` (null: the stock part; socket null: the whole board back to stock), once the bench finds it still plays. */
function swap(socket: string | null, choice: string | null): string {
  const mine = socket === null ? {} : { ...swaps() };
  if (socket !== null) { if (choice === null) delete mine[socket]; else mine[socket] = choice; }
  const no = swapWontPlay(def(), mine);
  if (no.length) { showBoard(no.join("; ")); return no.join("; "); }
  writeParts(pedal, drive(), mine);
  parts = readParts();
  result = null; files.replaceChildren();
  showBoard();
  void run();
  return "";
}

function showBoard(wont = ""): void {
  board.show(def().board, `${def().name} · your board`, swaps(), wont ? { hint: `won't play, kept your last parts: ${wont}` } : {});
  board.probe(probe?.key ?? null);
  paint();
}

async function runRetest(): Promise<Retest | null> {
  retesting = true; paint();
  const r = await ask({ t: "retest", pedal, drive: drive(), swaps: swaps() });
  retesting = false;
  result = r.t === "retest" ? r.retest : null;
  if (r.t === "error") why = r.why;
  if (result) await offerFiles();
  paint();
  return result;
}

/** The remake as files to take to tscircuit: its source, and its circuit JSON (which Q Amp's bench also takes). */
async function offerFiles(): Promise<void> {
  const b = def().board, slug = `${b}-yours`;
  const tsx = await TSX[`../../circuits/${b}.tsx`]?.();
  const link = (name: string, body: string, type: string) => {
    const a = h("a", "qb-file", icon("download", 14), name);
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name;
    return a;
  };
  files.replaceChildren(
    ...(tsx ? [link(`${slug}.tsx`, remakeTsx(b, tsx, swaps(), def().name), "text/plain")] : []),
    link(`${slug}.circuit.json`, JSON.stringify(remakeJson(b, swaps())), "application/json"),
  );
}

// ---- playing ----
let ctx: AudioContext | null = null, src: AudioBufferSourceNode | null = null, started = 0;
async function togglePlay(): Promise<void> {
  if (src) { src.stop(); return; }
  if (!wave) return;
  ctx ??= new AudioContext({ sampleRate: SR });
  await ctx.resume();
  const buf = ctx.createBuffer(1, wave.out.length, SR), ch = buf.getChannelData(0);
  // The pedal's volts at a level a speaker takes: the fuzz's ±0.5 V is about −12 dBFS.
  for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, wave.out[i] * 0.5));
  const s = ctx.createBufferSource();
  s.buffer = buf; s.connect(ctx.destination);
  s.onended = () => { if (src === s) src = null; paint(); draw(); };
  src = s; started = ctx.currentTime;
  s.start();
  paint();
  const tick = () => { if (src !== s) return; draw(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

/** The sample the scope's window starts at: following the riff while it plays, else at its loudest note. */
function windowAt(): number {
  const input = theRiff();
  if (src && ctx) return Math.max(0, Math.min(input.length - WINDOW, Math.round((ctx.currentTime - started) * SR) - WINDOW / 2));
  return restAt(input);
}

const SCALES = [0.25, 0.5, 1, 2, 5, 10];
function draw(): void {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (!w || !hgt) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  const peak = wave ? Math.max(wave.swing.hi, -wave.swing.lo) : 0;
  const scale = SCALES.find((s) => s >= peak * 1.1) ?? 10;
  const y = (v: number) => hgt / 2 - (v / scale) * (hgt / 2 - 6);
  g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
  for (const v of [-scale, -scale / 2, 0, scale / 2, scale]) { g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke(); }
  g.fillStyle = "rgba(255,255,255,0.4)"; g.font = "10px 'IBM Plex Mono', monospace";
  g.fillText(`±${scale} V`, 6, 12);
  const at = windowAt(), input = theRiff();
  const line = (get: (i: number) => number, color: string, width: number) => {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    for (let i = 0; i < WINDOW; i++) { const px = (i / (WINDOW - 1)) * w, py = y(get(at + i)); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke();
  };
  line((i) => input[i] * INPUT_VOLTS, "rgba(174,180,189,0.35)", 1); // the guitar at IN, for scale
  if (wave) line((i) => wave?.at[i] ?? 0, "#38bdf8", 1.6);
}

const volts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} V`;
function paint(): void {
  for (const b of pedalTabs) b.setAttribute("aria-pressed", String(b.dataset.pedal === pedal));
  knobName.textContent = def().knob ?? "Drive"; driveIn.setAttribute("aria-label", knobName.textContent);
  driveIn.value = String(drive()); driveVal.textContent = drive().toFixed(1);
  playBtn.replaceChildren(icon(src ? "square" : "play"));
  playBtn.title = src ? "Stop" : "Play the riff through the board"; playBtn.setAttribute("aria-label", playBtn.title);
  playBtn.disabled = !wave && !src;
  scopeTitle.textContent = probe ? probe.label : "";
  scopeRead.textContent = why || (busy || !wave ? "Running the riff through the board..." :
    `swings ${volts(wave.swing.hi)} / ${volts(wave.swing.lo)} · within 10% of its peak ${Math.round(wave.swing.flat * 100)}% of the time`);
  scopeRead.classList.toggle("warn", !!why);
  netList.replaceChildren(...nets.map((n) => {
    const b = h("button", "qb-net", n.label);
    b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(n.key === probe?.key));
    b.addEventListener("click", () => setProbe(n.key));
    return b;
  }));
  retestBtn.disabled = retesting;
  const what = changes(def().board, swaps());
  retestOut.textContent = retesting ? "Playing the riff through your board, the remake and the stock board..." : !result ? (what ? `Your parts: ${what}.` : "Stock parts: swap one first to hear a change.")
    : `${result.same ? "The remake plays the riff as your board does" : `The remake is off by up to ${(result.apart * 1000).toFixed(2)} mV`}. `
      + (what ? `Against the stock board: ${result.louder >= 0 ? "+" : ""}${result.louder.toFixed(1)} dB, the waves ${result.differs.toFixed(0)} dB apart.` : "It is the stock board.");
  retestOut.classList.toggle("ok", !!result?.same);
  retestOut.classList.toggle("warn", !!result && !result.same);
}

addEventListener("resize", () => draw());
pick(pedal);

// A part swapped or a knob turned on Q Amp (another tab): this pedal's board and scope follow. Q Amp saves its whole
// store often (every amp knob), so only a change to this pedal's own knob or parts reruns the riff.
onParts((p) => {
  const was = JSON.stringify([drive(), swaps()]);
  parts = p;
  if (JSON.stringify([drive(), swaps()]) === was) return;
  result = null; files.replaceChildren();
  showBoard();
  void run();
});

/** Resolves once nothing is running (the scope's riff and any retest). */
const idle = async () => { await kitLoad; while (busy || retesting) await new Promise((r) => setTimeout(r, 50)); };

Object.assign(window, {
  qbuilder: {
    /** The pedal, its knob and parts, the nets, the scope's net and how it swings, and the last retest. */
    state: () => ({
      pedal, drive: drive(), swaps: swaps(), changes: changes(def().board, swaps()), busy: busy > 0 || retesting, playing: !!src, why,
      nets: nets.map((n) => ({ key: n.key, label: n.label, node: n.node })),
      probe: probe && { key: probe.key, label: probe.label, node: probe.node },
      swing: wave?.swing ?? null, retest: result, files: [...files.querySelectorAll("a")].map((a) => a.download),
      board: { kit: kitId(def().name), side, made: !!made, size: made?.size ?? null, holes: made?.holes ?? 0, pads: made?.pads ?? 0, unread: made?.unread ?? [] },
    }),
    /** The mockup from the top (parts side) or the bottom. */
    side: (s: string) => { if (s === "top" || s === "bottom") setSide(s); return made ? side : null; },
    /** Fills the print sheet without opening the print dialog: its headings. */
    printSheet,
    /** The Gerbers zip the button saves: its name and the files in it. */
    gerbers: () => { const z = gerberZip(); return { name: z.name, files: gerbers(kit) }; },
    pick: (id: string) => { if (isBuilderPedal(id)) pick(id); return isBuilderPedal(id); },
    drive: setDrive,
    /** A socket's part: a clipper (silicon, germanium, led, mosfet, none) or a step ("0.47", "2.2"); null puts the stock part back. "" when it took. */
    swap: (socket: string | null, choice: string | null) => swap(socket, choice),
    /** The scope on a net, by key, label ("OUT", "R3 · D3 · D4 · R4") or node. */
    probe: setProbe,
    retest: runRetest,
    idle,
  },
});
