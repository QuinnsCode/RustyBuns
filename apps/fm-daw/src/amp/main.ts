// Q Amp: one of the circuit amps on a stage, live. The riff on a loop or a guitar
// through the audio thread (worklet.ts), out to the speakers and to the stage
// screens (screens.ts). The amp head and cabinet are clear, so you see the tubes
// glow with what each stage is doing. The board view (board.ts) shows the circuit
// you are playing, and swaps its socketed parts live. The stage button puts the amp on a
// three.js stage (stage3d.ts, loaded only when it's on), the knobs on the panel under it;
// without WebGL the page stays 2D.
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./amp.css";
import workletUrl from "./worklet.ts?worker&url";
import { AmpThreads, type Threads } from "./threads.ts";
import { arr, check, num, nul, obj, oneOf, opt, or, rec, str } from "@rustybuns/util/guard";
import { AMPS, PEDALS, boardLinks, type AmpDef, type Knobs } from "../circuit/amps.ts";
import { SCOPE_SAMPLES, nodeNumbers, type LoopSpec } from "@rustybuns/gear/circuit";
import { GEAR, STAGE, audibleChains, compile, heard, type Cable, type End, type Patch } from "../circuit/patch.ts";
import { cabledChain, cabledOrder, relay } from "./cabled.ts";
import { patchView } from "./patch-view.ts";
import { riff } from "../circuit/riff.ts";
import { BoardView } from "./board.ts";
import { BuildSheet } from "../kit/sheet.ts";
import { icon } from "./icons.ts";
import { h, iconButton } from "./dom.ts";
import { benchSlot } from "./bench-slot.ts";
import { swapWontPlay } from "../circuit/bench.ts";
import { changedJson } from "../circuit/edits.ts";
import { DEFAULT_DRIVE, keepParts, onParts, readParts } from "./parts-store.ts";
import { knob, type KnobEl } from "./knob.ts";
import { startMidi } from "../ui/input.ts";
import { MODES, Screen, lightLevels, topHz, hzLabel, type ScreenMode } from "./screens.ts";
import type { AmpSettings, ChainSlot, FromAmp } from "./messages.ts";
import type { MountedStage, StageAmp } from "./stage3d.ts";
import { AMP_LESSON } from "./lesson.ts";
import { mountLessonCard } from "../studio/lesson-card.ts";
import { oneAtATime, PageLesson } from "../studio/page-lesson.ts";
import { BUILD_LESSON, clipperNow } from "./build-lesson.ts";
import { AMP_SLOT, freshOrder, grip, isMachine, loadChip, moveTo, tidyOrder, type MachineId } from "./pedalboard.ts";

const KEY = "q-amp";
const KNOB_NAMES: { key: keyof Knobs; label: string }[] = [
  { key: "gain", label: "Gain" }, { key: "bass", label: "Bass" }, { key: "mid", label: "Middle" }, { key: "treble", label: "Treble" }, { key: "master", label: "Master" }, { key: "noise", label: "Noise" },
  { key: "rate", label: "Rate" }, { key: "depth", label: "Depth" },
];
/** The bias tremolo's knobs, shown only on an amp that has one. */
const TREM_KNOBS: (keyof Knobs)[] = ["rate", "depth"];
const MODE_ICON: Record<ScreenMode, string> = { spectrum: "chart-column", analog: "activity", scope: "audio-waveform", focus: "scan-search" };
const MODE_IDS = MODES.map((m) => m.id);

const EndGuard = (v: unknown): End => { const [item, jack] = arr(str(20), 2, { min: 2 })(v); return [item, jack]; };
const CableGuard = obj({ from: EndGuard, to: EndGuard, kind: opt(oneOf(["instrument", "speaker", "xlr", "power"])) });
const KnobsGuard = obj({ gain: num(0, 10, 5), bass: num(0, 10, 5), mid: num(0, 10, 5), treble: num(0, 10, 5), master: num(0, 10, 5), noise: num(0, 10, 3), rate: num(0, 10, 5), depth: num(0, 10, 0) });
const on = oneOf([0, 1], 0);
const LoopGuard = obj({
  spring: obj({ on, dwell: num(0, 10, 5), mix: num(0, 10, 4) }),
  tape: obj({ on, time: num(0, 10, 4), repeats: num(0, 10, 4), mix: num(0, 10, 4) }),
  bbd: obj({ on, mode: oneOf(["chorus", "flanger", "delay"], "chorus"), rate: num(0, 10, 3), depth: num(0, 10, 5) }),
});
type Loop = ReturnType<typeof LoopGuard>;
const freshLoop = (): Loop => ({
  spring: { on: 0, dwell: 5, mix: 4 }, tape: { on: 0, time: 4, repeats: 4, mix: 4 }, bbd: { on: 0, mode: "chorus", rate: 3, depth: 5 },
});
const Saved = obj({
  amp: str(20, { dflt: "lead" }),
  knobs: rec(KnobsGuard, 10),
  pedal: nul(str(20)),
  drive: rec(num(0, 10, 5), 32),
  bypass: oneOf([0, 1], 0),
  source: oneOf(["riff", "guitar"], "riff"),
  layout: oneOf(["wide", "split"], "split"),
  modes: arr(oneOf(MODE_IDS, "spectrum"), 2, { min: 2 }),
  level: num(-60, 0, -12),
  quality: oneOf(["hq", "eco"], "hq"),
  /** The board view open (1) or not. */
  board: oneOf([0, 1], 0),
  /** The amp on the three.js stage (1) or the flat page (0). */
  stage: oneOf([0, 1], 1),
  /** Each pedal's parts the player swapped: pedal id → socket → choice (circuits.ts `Swaps`). */
  swaps: or(rec(rec(str(12), 40), 32), {}),
  /** The mic on the cab: 0 the centre cap to 10 the cone's edge, and 0 on axis to 10 side on. */
  micAt: num(0, 10, 3),
  micAngle: num(0, 10, 0),
  /** The MIDI controller that rocks the wah's treadle: 11 is expression. */
  cc: num(0, 119, 11),
  loop: opt(LoopGuard),
  /** The cables on the stage; left out (a page saved before the patch) is the stage as it comes. */
  cables: opt(arr(CableGuard, 64, { drop: true })),
  /** The board's tiles in chain order, the amp one of them (pedalboard.ts); left out is a fresh board. */
  order: opt(arr(str(20), 32, { drop: true })),
  /** The pedals switched on, any number of them; left out is the one `pedal` of a page saved before the board. */
  lit: opt(arr(str(20), 32, { drop: true })),
});
type State = Omit<ReturnType<typeof Saved>, "cables" | "order" | "lit"> & { cables: Cable[]; order: string[]; lit: string[] };

function loadState(): State {
  const fresh: State = {
    amp: "lead", knobs: Object.fromEntries(AMPS.map((a) => [a.id, { ...a.knobs }])), pedal: null,
    drive: { ...DEFAULT_DRIVE }, bypass: 0, source: "riff", layout: "split", modes: ["analog", "focus"], level: -12, quality: "hq", board: 0, stage: 1, swaps: {}, micAt: 3, micAngle: 0, cc: 11,
    loop: freshLoop(),
    cables: [...STAGE.cables],
    order: freshOrder(), lit: [],
  };
  // The knobs and swaps are parts-store's: its copy wins over the one in an older save here.
  const parts = readParts();
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? check(Saved, JSON.parse(raw)) : null;
    if (saved) {
      const order = tidyOrder(saved.order ?? fresh.order);
      // A page saved when the pedalboard was one box: its pedals cabled in a row in the order its tiles were.
      const cables = saved.cables?.every((c) => [c.from, c.to].every(([item]) => GEAR[item])) ? saved.cables : relay(order, fresh.cables);
      return { ...saved, drive: parts.drive, swaps: parts.swaps, knobs: { ...fresh.knobs, ...saved.knobs }, loop: saved.loop ?? fresh.loop, cables, order, lit: saved.lit ?? (saved.pedal ? [saved.pedal] : []) };
    }
  } catch { /* private window or bad JSON: start fresh */ }
  return { ...fresh, drive: parts.drive, swaps: parts.swaps };
}
const S = loadState();
/** Q Builder's added, removed and rewired parts, by pedal: read here, never written (parts-store.ts). */
let edits = readParts().edits;
/** The page's store, and the knobs and swaps into parts-store only if they changed (so a save never undoes Q Builder's). */
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* not kept, fine */ } keepParts({ drive: S.drive, swaps: S.swaps }); };
const loopOf = () => (S.loop ??= freshLoop());
const ampOf = (id: string): AmpDef => AMPS.find((a) => a.id === id) ?? AMPS[0];

// ---- audio ----
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
/** The rig on the audio thread, and split onto workers when that thread is over budget (threads.ts). */
let threads: AmpThreads | null = null;
let out: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let riffNode: AudioBufferSourceNode | null = null;
let mic: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
let meter: FromAmp = { t: "meter", levels: [], out: 0, load: 0, misses: 0 };
const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20));

/** A machine at its knobs, or null when it is switched off. */
function machineSpec(kind: MachineId): LoopSpec | null {
  const l = loopOf();
  if (kind === "bbd") return l.bbd.on ? { kind: "bbd", mode: l.bbd.mode, rate: l.bbd.rate, depth: l.bbd.depth } : null;
  if (kind === "tape") return l.tape.on ? { kind: "tape", time: l.tape.time, repeats: l.tape.repeats, mix: l.tape.mix, heads: [1, 3] } : null;
  return l.spring.on ? { kind: "spring", dwell: l.spring.dwell, mix: l.spring.mix } : null;
}
/** The machines that are on, in board order. */
const loopSpecs = (): LoopSpec[] => S.order.flatMap((id) => (isMachine(id) ? machineSpec(id) ?? [] : []));

/** A pedal or machine as it plays now, or null when it is switched off (or isn't one). */
function slotOf(id: string): ChainSlot | null {
  // Q Bucket is the stereo one: a second chip on the right, its LFO half a turn behind.
  if (isMachine(id)) { const sp = machineSpec(id); return sp ? { machine: sp, ...(id === "bbd" ? { stereo: true } : {}) } : null; }
  if (!S.lit.includes(id)) return null;
  if (id === "bench") { const net = ui.bench.net(); return net ? { pedal: "bench", drive: 0, bench: net } : null; }
  return PEDALS.some((p) => p.id === id) ? { pedal: id, drive: S.drive[id] ?? 5, swaps: S.swaps[id] ?? {}, edits: edits[id] } : null;
}
/**
 * The board as the audio thread plays it, and each slot's tile id: what the cables run from the guitar through
 * the amp into the cabinet (patch.ts, cabled.ts), the pedals and machines that are on. A pedal cabled out of
 * that is out of the sound, whatever its switch says.
 */
const board = (): { chain: ChainSlot[]; ids: string[] } => cabledChain(audibleChains(patch(), compiled), slotOf);
/** Which tile each of the last report's slot loads is for, and the slots. */
let chainIds: string[] = [];
let chainSlots: ChainSlot[] = [];
/** Where tile `id`'s links start in the meter's levels, null when it isn't playing: a pedal is one link, a split one per pedal, the amp its tubes and tone stack, a machine none. */
function linksAt(id: string): number | null {
  let n = 0;
  for (const [i, c] of chainIds.entries()) {
    if (c === id) return n;
    const slot = chainSlots[i];
    n += c === AMP_SLOT ? ampOf(S.amp).stages.length + 1 : !slot || "machine" in slot ? 0 : "split" in slot ? slot.split.flat().length : 1;
  }
  return null;
}

// The patch: what is cabled to what, and what that means for the speakers.
const patch = (): Patch => ({ placed: STAGE.placed, cables: S.cables });
let compiled = compile(patch());
let sound = heard(patch(), compiled);
/** The tiles in the order the cables run them; tiles cabled out of the sound go back near where a fresh board has them. */
function readOrder() {
  const cabled = cabledOrder(audibleChains(patch(), compiled), new Set(S.order));
  if (cabled.length) S.order = tidyOrder(cabled);
}
readOrder();

function settings(): AmpSettings {
  return { amp: S.amp, pedal: S.pedal, bench: S.pedal === "bench" ? ui.bench.net() ?? undefined : undefined, drive: S.pedal ? S.drive[S.pedal] ?? 5 : 0, swaps: S.pedal ? S.swaps[S.pedal] ?? {} : {}, edits: S.pedal ? edits[S.pedal] : undefined, knobs: S.knobs[S.amp] ?? ampOf(S.amp).knobs, bypass: S.bypass === 1, oversample: S.quality === "eco" ? 2 : 4, mic: { at: S.micAt / 10, angle: S.micAngle * 9 }, loop: loopSpecs(), chain: board().chain };
}
/** A pedalboard cabled out of the chain is out of the sound, whatever its switch says. */
const patched = (s: AmpSettings): AmpSettings => (sound.pedals ? s : { ...s, pedal: null, drive: 0 });
/** The speakers' level: silent when nothing cabled reaches them through the amp. */
function setLevel() {
  if (out && ctx) out.gain.setTargetAtTime(sound.audible ? dbToGain(S.level) : 0, ctx.currentTime, 0.02);
}
function send() {
  save();
  ({ ids: chainIds, chain: chainSlots } = board());
  threads?.send(patched(settings()));
  sendScope();
}

// ---- the scope on a pedal's net: its volts back from the audio thread, the way it sends meters ----
/** Where the scope sits (a pedal tile and a net on its board, or a control its LFO or envelope moves), or nowhere. */
let probe: { pedal: string; net: string } | null = null;
/** The newest of its volts, newest last, and how far they swung since it was put there. */
const probed = new Float32Array(SCOPE_SAMPLES);
let probeSwing = { hi: 0, lo: 0, samples: 0 };
/** The scope's link in the rig: the pedal's while it plays, nowhere once it is off. */
function sendScope() {
  const at = probe ? linksAt(probe.pedal) : null;
  threads?.scope(probe && at !== null ? { link: at, net: probe.net } : null);
}
/** Whether pedal `id` playing now has `net` on its board, or a control by that name. */
function hasNet(id: string, net: string): boolean {
  const slot = board().chain[chainIds.indexOf(id)];
  const link = slot && "pedal" in slot ? boardLinks([slot]).links[0] : undefined;
  return !!link && (nodeNumbers(link.net).has(net) || !!link.mods?.some((m) => m.ctl.toUpperCase() === net.toUpperCase()));
}
function takeScope(v: readonly number[] | undefined) {
  if (!v?.length || !probe) return;
  const n = Math.min(v.length, SCOPE_SAMPLES);
  probed.copyWithin(0, n);
  probed.set(v.slice(v.length - n), SCOPE_SAMPLES - n);
  const s = probeSwing;
  for (const x of v) { if (!s.samples || x > s.hi) s.hi = x; if (!s.samples || x < s.lo) s.lo = x; s.samples++; }
}
/** New cables: what the speakers hear, and the board's tiles in the order they now run. */
function setCables(cables: Cable[]) {
  S.cables = cables;
  compiled = compile(patch());
  sound = heard(patch(), compiled);
  ui.patch.show(patch(), compiled.problems);
  readOrder();
  layBoard();
  stage3d?.setAmp(stageAmp());
  setLevel();
  send();
}

/**
 * The wah's treadle, 0 (heel) to 10 (toe), from an expression pedal, a MIDI CC or a drag: a pot turn on the
 * audio thread (live.ts), never a new circuit, so a sweep is as cheap as it is quick.
 */
function rockWah(v: number) {
  S.drive.wah = Math.round(Math.min(10, Math.max(0, v)) * 100) / 100;
  ui.pedalEls.find((p) => p.id === "wah")?.knob.set(S.drive.wah);
  if (S.lit.includes("wah")) send(); else save();
}

/**
 * A pedal's footswitch (or the bench's): any number can be on. The one switched on last is the one the board
 * view, its sheet and its part swaps act on (`S.pedal`); switched off, that goes to the last one still on.
 */
function footswitch(id: string, isOn = !S.lit.includes(id)) {
  if (id === "bench" && isOn && !ui.bench.state()?.ok) return;
  S.lit = isOn ? [...S.lit.filter((x) => x !== id), id] : S.lit.filter((x) => x !== id);
  if (isOn) S.pedal = id; else if (S.pedal === id) S.pedal = S.lit[S.lit.length - 1] ?? null;
  showPedals();
  send();
}

/** A tile moves to place `to` on the board: after the amp is in its loop, before it in front. The board is cabled again in that row. */
function moveSlot(id: string, to: number) {
  S.order = moveTo(S.order, id, to);
  setCables(relay(S.order, S.cables));
}

/** Each tile in its place on the board, and which ones sit in the amp's loop. */
function layBoard() {
  const amp = S.order.indexOf(AMP_SLOT);
  for (const el of ui.floor.querySelectorAll<HTMLElement>("[data-slot]")) {
    const i = S.order.indexOf(el.dataset.slot ?? "");
    el.style.order = String(i);
    el.classList.toggle("in-loop", i > amp);
  }
}
let midiInputs: string[] = [];
const noop = () => {};

async function start() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(workletUrl);
  node = new AudioWorkletNode(ctx, "q-amp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
  threads = new AmpThreads(node, ctx.sampleRate, () => new Worker(new URL("./part-worker.ts", import.meta.url), { type: "module" }), (m) => {
    meter = m;
    takeScope(m.scope);
    watchLoad(meter);
  });
  out = new GainNode(ctx, { gain: sound.audible ? dbToGain(S.level) : 0 });
  analyser = new AnalyserNode(ctx, { fftSize: 16384, smoothingTimeConstant: 0.6, minDecibels: -110, maxDecibels: -10 });
  node.connect(analyser);
  node.connect(out).connect(ctx.destination);
  send();
  // Any MIDI input's chosen controller (11, expression, unless `qamp.cc(n)` picked another) rocks the wah; no MIDI, drag it.
  void startMidi({ on: noop, off: noop, panic: noop, bend: noop, devices: (names) => { midiInputs = names; }, cc: (n, v) => { if (n === S.cc) rockWah(v * 10); } });
  await setSource(S.source);
  await ctx.resume();
  ui.root.classList.add("on");
  ui.startCard.hidden = true;
  showLatency();
}

async function setSource(src: "riff" | "guitar", deviceId?: string) {
  S.source = src;
  save();
  riffNode?.stop(); riffNode?.disconnect(); riffNode = null;
  if (mic) { mic.node.disconnect(); mic.stream.getTracks().forEach((t) => t.stop()); mic = null; }
  ui.sourceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === src)));
  ui.devices.hidden = src !== "guitar";
  if (!ctx || !node) return;
  if (src === "riff") {
    const data = riff(ctx.sampleRate), buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    riffNode = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    riffNode.connect(node);
    riffNode.start();
    ui.note.textContent = "";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    mic = { stream, node: new MediaStreamAudioSourceNode(ctx, { mediaStream: stream }) };
    mic.node.connect(node);
    ui.note.textContent = "";
    await listDevices(stream.getAudioTracks()[0]?.getSettings().deviceId);
  } catch (e) {
    ui.note.textContent = `No guitar input: ${e instanceof Error ? e.message : String(e)}. Playing the riff.`;
    await setSource("riff");
  }
}

async function listDevices(current?: string) {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  ui.devices.replaceChildren(...inputs.map((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId; o.textContent = d.label || `Input ${i + 1}`; o.selected = d.deviceId === current;
    return o;
  }));
}

/** The hop on the bar: how many threads, the latency they add, and (its tooltip) before which link the chain is cut. */
function showHop(t: Threads | null) {
  ui.hop.hidden = !t?.cuts.length;
  if (!t?.cuts.length) return;
  const text = ui.hop.lastElementChild;
  if (text) text.textContent = `${t.cuts.length + 1} · +${t.hopMs.toFixed(1)} ms`;
  ui.hop.title = `Split across ${t.cuts.length + 1} threads, cut before link${t.cuts.length > 1 ? "s" : ""} ${t.cuts.join(" and ")}: each hop adds a block (${(t.hopMs / t.cuts.length).toFixed(1)} ms). Loads ${t.loads.map((l) => `${Math.round(l * 100)}%`).join(" / ")}`;
}

function showLatency() {
  if (!ctx) return;
  ui.latency.textContent = `${Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000)} ms out`;
}

// ---- page ----
function build() {
  const root = h("div", "stage");
  // Top bar: what's playing, bypass, level, how hard the audio thread works, the screens' layout.
  const sourceButtons = [iconButton("repeat", "Play the riff", () => void setSource("riff")), iconButton("guitar", "Play your guitar (audio input)", () => void setSource("guitar"))];
  sourceButtons[0].dataset.src = "riff"; sourceButtons[1].dataset.src = "guitar";
  const devices = h("select", "devices");
  devices.setAttribute("aria-label", "Guitar input");
  devices.addEventListener("change", () => void setSource("guitar", devices.value));
  const bypass = h("button", "pill", "Bypass");
  bypass.type = "button";
  bypass.title = "The dry input straight through, to compare";
  bypass.addEventListener("click", () => { S.bypass = S.bypass ? 0 : 1; bypass.setAttribute("aria-pressed", String(S.bypass === 1)); send(); });
  bypass.setAttribute("aria-pressed", String(S.bypass === 1));
  const level = h("input", "level");
  Object.assign(level, { type: "range", min: "-60", max: "0", step: "1", value: String(S.level) });
  level.setAttribute("aria-label", "Output level");
  level.addEventListener("input", () => { S.level = Number(level.value); setLevel(); save(); });
  const load = h("button", "chip load", icon("cpu", 14), h("span", "", "--"));
  load.type = "button";
  load.title = "How much of the audio thread's time the amp uses. Click: 4× oversampling (cleanest) or 2× (Eco, half the work)";
  load.addEventListener("click", () => setQuality(S.quality === "hq" ? "eco" : "hq"));
  const latency = h("span", "chip dim");
  // Where the chain is cut onto another thread, and the latency each hop adds (hidden on one thread).
  const hop = h("span", "chip hop", icon("split", 14), h("span", "", ""));
  hop.hidden = true;
  const stageBtn = iconButton("box", "Stage: the amp in 3D, the screens as LED walls behind it, or the flat page", () => { S.stage = S.stage ? 0 : 1; void showStage(); save(); });
  const boardBtn = iconButton("circuit-board", "Board view: the circuit you're playing. Click a diode or capacitor to swap it", () => { S.board = S.board ? 0 : 1; showBoard(); save(); });
  const layout = iconButton(S.layout === "split" ? "columns-2" : "rectangle-horizontal", "Screens: one wide or two half", () => {
    S.layout = S.layout === "split" ? "wide" : "split";
    layout.replaceChildren(icon(S.layout === "split" ? "columns-2" : "rectangle-horizontal"));
    screensEl.className = `screens ${S.layout}`;
    stageWalls();
    save();
  });
  const bar = h("header", "bar",
    h("div", "brand", h("span", "q", "Q"), h("span", "", "AMP")),
    h("div", "group", ...sourceButtons, devices), bypass,
    h("label", "group", icon("volume-2", 16), level), load, hop, latency, h("span", "spacer"), stageBtn, boardBtn, layout);

  // Screens.
  const screens: Screen[] = [];
  const screensEl = h("div", `screens ${S.layout}`);
  S.modes.forEach((mode, i) => {
    const canvas = h("canvas", "screen-canvas");
    const title = h("span", "screen-title");
    const nav = h("nav", "modes");
    const screen = new Screen(canvas, mode);
    const titleOf = (m: ScreenMode) => {
      const sr = ctx?.sampleRate ?? 48000;
      return m === "focus" ? "Focus · low mids, mids, highs" : m === "scope" ? "Scope · the wave" : `${MODES.find((x) => x.id === m)?.label} · 40 Hz–${hzLabel(topHz(sr))} Hz`;
    };
    const buttons = MODES.map((m) => {
      const b = iconButton(MODE_ICON[m.id], m.label, () => {
        screen.setMode(m.id); S.modes[i] = m.id; save();
        buttons.forEach((x, j) => x.setAttribute("aria-pressed", String(MODES[j].id === m.id)));
        title.textContent = titleOf(m.id);
      });
      b.setAttribute("aria-pressed", String(m.id === mode));
      return b;
    });
    nav.append(...buttons);
    title.textContent = titleOf(mode);
    screensEl.append(h("section", "screen", h("div", "screen-top", title, nav), canvas));
    screens.push(screen);
  });

  // The amp: a clear head on a clear cabinet.
  const tubes = h("div", "tubes");
  const modelName = h("span", "model-name");
  const modelBlurb = h("p", "blurb");
  const models = h("div", "models", ...AMPS.map((a) => {
    const b = h("button", "model", h("span", "led"), a.name);
    b.type = "button"; b.dataset.amp = a.id;
    b.addEventListener("click", () => setAmp(a.id));
    return b;
  }));
  const knobs: Record<string, KnobEl> = {};
  const knobRow = h("div", "knobs", ...KNOB_NAMES.map(({ key, label }) => {
    const k = knob(label, (S.knobs[S.amp] ?? ampOf(S.amp).knobs)[key], ampOf(S.amp).knobs[key], (v) => { (S.knobs[S.amp] ??= { ...ampOf(S.amp).knobs })[key] = v; send(); });
    knobs[key] = k;
    return k.el;
  }));
  const head = h("div", "head clear",
    tubes,
    h("div", "panel", h("div", "badge", h("span", "q", "Q"), modelName, h("span", "jewel")), models, knobRow));
  const cones = [h("div", "cone"), h("div", "cone")];
  // The mic on the cab: across the cone, and turned off axis.
  const micKnobs = h("div", "mic-knobs",
    knob("Mic", S.micAt, 3, (v) => { S.micAt = v; send(); }, "small").el,
    knob("Angle", S.micAngle, 0, (v) => { S.micAngle = v; send(); }, "small").el);
  micKnobs.title = "Where the mic sits: on the centre cap it is bright, out at the cone's edge and turned off axis it is darker";
  const cab = h("div", "cab clear", ...cones.map((c) => h("div", "speaker", c)), micKnobs);
  const rig = h("div", "rig", head, cab, modelBlurb);

  // The pedalboard: every tile in one row in chain order, the amp one of them; what is after it is in its loop.
  const floor = h("div", "floor");
  floor.title = "The pedalboard: the signal runs left to right. Tiles after the amp are in its effects loop, between the preamp and the power tubes";
  const loadEls = new Map<string, HTMLSpanElement>();
  const slot = (id: string, name: string, tile: HTMLElement) => {
    const chip = loadChip();
    loadEls.set(id, chip);
    const el = h("div", "slot", h("div", "slot-top", grip(id, name, floor, () => S.order, (to) => moveSlot(id, to)), chip), tile);
    el.dataset.slot = id;
    floor.append(el);
  };
  const pedalEls = PEDALS.map((p) => {
    const led = h("span", "pedal-led");
    const drive = knob(p.knob ?? "Drive", S.drive[p.id] ?? 5, 5, (v) => { S.drive[p.id] = v; if (S.lit.includes(p.id)) send(); else save(); }, "small");
    const sw = h("button", "footswitch");
    sw.type = "button"; sw.title = `${p.name} on or off`; sw.setAttribute("aria-label", `${p.name} on or off`);
    const el = h("div", `pedal ${p.id}`, led, drive.el, h("span", "pedal-name", p.name), sw);
    el.title = p.blurb;
    sw.addEventListener("click", () => footswitch(p.id));
    slot(p.id, p.name, el);
    return { id: p.id, el, knob: drive };
  });
  // The bench: a board you drew becomes the fourth pedal (src/circuit/bench.ts).
  const bench = benchSlot(floor, {
    toggle: () => footswitch("bench"),
    changed: (ok) => { if (!ok && S.lit.includes("bench")) footswitch("bench", false); else send(); },
  });
  slot("bench", "Bench", bench.el);
  // The amp's own tile: it plays what is in front of it, and runs what is after it in its loop.
  const ampName = h("span", "pedal-name");
  const ampTile = h("div", "pedal wide amp-slot", icon("cpu", 22), ampName, h("span", "bench-hint", "loop after it"));
  ampTile.title = "The amp: pedals in front of it go into its input; whatever sits after it runs in its effects loop, at line level, before the power tubes";
  slot(AMP_SLOT, "the amp", ampTile);

  const board = new BoardView((socket, choice) => swapPart(socket, choice));
  // The pedal's build sheet: its parts with your swaps, the board files, and the kit as a zip (../kit/sheet.ts).
  const sheet = new BuildSheet(() => {});
  const sheetBtn = iconButton("download", "Build sheet: the parts with your swaps, the board files, and the kit to download", () => void openSheet());
  board.tool(sheetBtn);
  // The machines: any of them on at once, anywhere on the board (after the amp, in its loop, is where they're made for).
  const L = loopOf();
  type LoopKnob = { label: string; get: () => number; put: (v: number) => void; dflt: number };
  const loopPedal = (kind: "spring" | "tape" | "bbd", name: string, blurb: string, knobsOf: LoopKnob[], extra: HTMLElement[] = []) => {
    const led = h("span", "pedal-led");
    const row = h("div", "pedal-knobs", ...knobsOf.map((k) => knob(k.label, k.get(), k.dflt, (v) => { k.put(v); send(); }, "small").el));
    const sw = h("button", "footswitch");
    sw.type = "button"; sw.title = `${name} on or off`; sw.setAttribute("aria-label", `${name} on or off`);
    const el = h("div", `pedal wide ${kind}`, led, row, ...extra, h("span", "pedal-name", name), sw);
    el.title = blurb;
    sw.addEventListener("click", () => { L[kind].on = L[kind].on ? 0 : 1; showPedals(); send(); });
    slot(kind, name, el);
    return { id: kind, el };
  };
  const bbdMode = h("button", "pill mode", L.bbd.mode);
  bbdMode.type = "button"; bbdMode.title = "Chorus, flanger or delay";
  bbdMode.addEventListener("click", () => {
    const modes = ["chorus", "flanger", "delay"] as const;
    L.bbd.mode = modes[(modes.indexOf(L.bbd.mode) + 1) % modes.length];
    bbdMode.textContent = L.bbd.mode;
    send();
  });
  const loopEls = [
    loopPedal("bbd", "Q Bucket", "A bucket-brigade chip: 1024 or 4096 capacitors passing the sound along, clocked by an LFO. Chorus, flanger, or a dark delay. Stereo: a second chip on the right, its LFO half a turn behind, and everything after it runs once per side.", [
      { label: "Rate", get: () => L.bbd.rate, put: (v) => { L.bbd.rate = v; }, dflt: 3 },
      { label: "Depth", get: () => L.bbd.depth, put: (v) => { L.bbd.depth = v; }, dflt: 5 },
    ], [bbdMode]),
    loopPedal("tape", "Q Tape", "A tape loop: record head, two playback heads, wow and flutter. Turn Time and the echoes slide as the motor changes speed. Repeats past 8 runs away and saturates.", [
      { label: "Time", get: () => L.tape.time, put: (v) => { L.tape.time = v; }, dflt: 4 },
      { label: "Repeats", get: () => L.tape.repeats, put: (v) => { L.tape.repeats = v; }, dflt: 4 },
      { label: "Mix", get: () => L.tape.mix, put: (v) => { L.tape.mix = v; }, dflt: 4 },
    ]),
    loopPedal("spring", "Q Spring", "A 12AT7 drives two springs, a 12AX7 reads them back. Dwell pushes the driver; high, a loud chord crashes the tank.", [
      { label: "Dwell", get: () => L.spring.dwell, put: (v) => { L.spring.dwell = v; }, dflt: 5 },
      { label: "Mix", get: () => L.spring.mix, put: (v) => { L.spring.mix = v; }, dflt: 4 },
    ]),
  ];

  const patchUi = patchView(STAGE.placed, (cables) => setCables(cables));

  const note = h("p", "note");
  const startCard = h("div", "start-card",
    h("h1", "", "Q Amp"),
    h("p", "", "Pedals and tube amps simulated part by part, live. Turn your speakers down first."),
    (() => { const b = h("button", "start", icon("power"), "Plug in"); b.type = "button"; b.addEventListener("click", () => void start().catch((e) => { note.textContent = String(e); })); return b; })());
  // The three.js stage (stage3d.ts) goes in here when it's on.
  const stageEl = h("div", "stage3d");
  stageEl.hidden = true;
  root.append(bar, note, screensEl, stageEl, rig, floor, patchUi.el, board.el, sheet.el, startCard);
  document.body.append(root);
  return { root, bar, stageBtn, stageEl, boardBtn, board, sheet, sheetBtn, patch: patchUi, screens, screensEl, tubes, modelName, modelBlurb, models, knobs, cones, pedalEls, bench, loopEls, floor, loadEls, ampName, sourceButtons, devices, load, hop, latency, note, startCard };
}

const ui = build();

function setQuality(q: "hq" | "eco", why = "") {
  S.quality = q;
  ui.note.textContent = why;
  send();
}

// A full audio thread drops out; one second of more than 90% at 4× steps down to Eco by itself.
let fullReports = 0;
function watchLoad(m: FromAmp) {
  fullReports = S.quality === "hq" && m.load > 0.9 ? fullReports + 1 : 0;
  if (fullReports >= 30) { fullReports = 0; setQuality("eco", "Switched to Eco (2× oversampling): the audio thread was full. Click the load meter to go back."); }
}

function showPedals() {
  for (const p of ui.pedalEls) p.el.classList.toggle("lit", S.lit.includes(p.id));
  const l = loopOf();
  for (const p of ui.loopEls) p.el.classList.toggle("lit", l[p.id].on === 1);
  ui.bench.light(S.lit.includes("bench"));
  layBoard();
  showBoard();
}

// ---- the three.js stage ----
let stage3d: MountedStage | null = null;
/** null until it has been tried; false when the browser has no WebGL. */
let webgl: boolean | null = null;
let stageLoading: Promise<void> | null = null;
function stageAmp(): StageAmp {
  const amp = ampOf(S.amp);
  return { preTubes: amp.stages.length, powerTubes: amp.powerTubes, pedals: S.order.filter((id) => id !== AMP_SLOT) };
}
/** The LED walls show the screens' canvases: one wide, or both. */
function stageWalls() {
  stage3d?.setWalls(ui.screens.slice(0, S.layout === "wide" ? 1 : 2).map((x) => x.canvas));
}
/** Puts the amp on the 3D stage or back on the flat page, as S.stage says (the 3D code loads the first time). */
async function showStage() {
  if (S.stage && !stage3d && webgl !== false) {
    stageLoading ??= import("./stage3d.ts").then(({ mountStage }) => {
      ui.stageEl.hidden = false; // the host needs its size before the renderer takes it
      stage3d = mountStage(ui.stageEl, stageAmp());
      webgl = !!stage3d;
      if (stage3d) stageWalls();
      else ui.note.textContent = "No WebGL in this browser: the amp stays on the flat page.";
    }).catch((e) => { webgl = false; ui.note.textContent = `The 3D stage didn't load: ${e}`; }).finally(() => { stageLoading = null; });
    await stageLoading;
  }
  const on = S.stage === 1 && !!stage3d;
  ui.root.classList.toggle("three", on);
  ui.stageEl.hidden = !on;
  ui.stageBtn.setAttribute("aria-pressed", String(on));
  ui.stageBtn.disabled = webgl === false;
}

/** The board view: the pedal that's on, with its sockets, a loop machine's circuit (the last one on), or the amp's first tube stage. */
function showBoard() {
  ui.boardBtn.setAttribute("aria-pressed", String(S.board === 1));
  ui.board.el.hidden = S.board !== 1;
  if (S.board !== 1) return;
  const def = PEDALS.find((p) => p.id === S.pedal);
  const l = loopOf();
  ui.sheetBtn.hidden = !def?.board;
  const why = refused;
  refused = ""; // said once, on the change it turned away
  const rewired = def && edits[def.id]?.length ? "rewired in Q Builder" : "";
  const hint = why ? `won't play, kept your last parts: ${why}` : rewired;
  if (def?.board) ui.board.show(def.board, `${def.name} · your board`, S.swaps[def.id] ?? {}, { hint });
  else if (S.pedal === "bench") ui.board.blank(`${ui.bench.state()?.name ?? "Bench"} · on the bench`, "a board dropped on the bench has no drawing here yet");
  else if (l.spring.on) ui.board.show("spring", "Q Spring · the driver and recovery tubes around the tank", null);
  else if (l.tape.on) ui.board.show("tape", "Q Tape · the record amp", null);
  else ui.board.show("triode", `${ampOf(S.amp).name} · V1, the first tube stage`, null);
}

/** The playing pedal's build sheet, with your swaps on it. */
function openSheet() {
  const def = PEDALS.find((p) => p.id === S.pedal);
  return def?.board ? ui.sheet.open(def, S.swaps[def.id] ?? {}, S.drive[def.id] ?? 5, edits[def.id]) : null;
}

/** Why the last part change was turned away (the board view says so until the next one), or "". */
let refused = "";

/**
 * Puts `choice` in the playing pedal's socket (null or the stock part: back to stock; socket null: every socket),
 * once the bench has played it with the knob down, centred and up. A change that won't solve is turned away, and the
 * pedal keeps the parts it had. Back to the reasons it won't play, or [] when it plays.
 */
function swapPart(socket: string | null, choice: string | null): string[] {
  const def = PEDALS.find((p) => p.id === S.pedal);
  if (!S.pedal || !def) return [];
  const mine = { ...S.swaps[S.pedal] };
  if (socket === null) for (const k of Object.keys(mine)) delete mine[k];
  else if (choice === null || choice === "silicon" || choice === "1") delete mine[socket];
  else mine[socket] = choice;
  const why = swapWontPlay(def, mine, changedJson(def.board, edits[def.id]));
  refused = why.join("; ");
  if (!why.length) {
    if (Object.keys(mine).length) S.swaps[S.pedal] = mine; else delete S.swaps[S.pedal];
    send();
  }
  showBoard();
  return why;
}

function setAmp(id: string) {
  S.amp = ampOf(id).id;
  const amp = ampOf(S.amp), k = S.knobs[amp.id] ?? amp.knobs;
  ui.modelName.textContent = amp.name;
  ui.ampName.textContent = amp.name;
  ui.modelBlurb.textContent = amp.blurb;
  for (const b of ui.models.children) if (b instanceof HTMLElement) b.setAttribute("aria-pressed", String(b.dataset.amp === amp.id));
  for (const { key } of KNOB_NAMES) {
    ui.knobs[key].set(k[key]);
    ui.knobs[key].el.hidden = TREM_KNOBS.includes(key) && !amp.trem;
  }
  const tube = (cls: string, label: string) => h("div", `tube ${cls}`, h("div", "glass", h("div", "plate"), h("div", "filament")), h("span", "tube-label", label));
  if (!S.pedal) showBoard();
  stage3d?.setAmp(stageAmp());
  ui.tubes.replaceChildren(
    ...amp.stages.map((_, i) => tube("pre", `V${i + 1}`)),
    h("span", "tube-gap"),
    ...Array.from({ length: amp.powerTubes }, (_, i) => tube("power", `P${i + 1}`)),
  );
  send();
}
setAmp(S.amp);
void showStage();
showPedals();
ui.patch.show(patch(), compiled.problems);
ui.sourceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === S.source)));
ui.devices.hidden = S.source !== "guitar";

// ---- every frame: screens, tube glow, cones ----
/** A stage's swing as a glow, 0 to 1 (log scale, 150 V is full). */
const glowOf = (swing: number) => Math.min(1, Math.log10(1 + swing) / Math.log10(151));
let db = new Float32Array(8192).fill(-Infinity), wave = new Float32Array(16384);
let push = 0;
let lessonTick = 0;
function frame() {
  if (++lessonTick % 10 === 0) lessonCard.frame(); // a few times a second: the steps read the knobs, the board and the cables
  if (analyser) {
    if (db.length !== analyser.frequencyBinCount) { db = new Float32Array(analyser.frequencyBinCount); wave = new Float32Array(analyser.fftSize); }
    analyser.getFloatFrequencyData(db);
    analyser.getFloatTimeDomainData(wave);
  }
  const fr = { db, wave, sampleRate: ctx?.sampleRate ?? 48000, net: probe && probeSwing.samples ? { volts: probed, label: `${probe.pedal} · ${probe.net}` } : undefined };
  for (const s of ui.screens) s.draw(fr);
  // A tube glows with its stage's swing (log scale, 150 V is full); power tubes with the output.
  const offset = linksAt(AMP_SLOT) ?? 0, tubes = ui.tubes.querySelectorAll<HTMLElement>(".tube");
  let pre = 0;
  for (const t of tubes) {
    const swing = t.classList.contains("pre") ? meter.levels[offset + pre++] ?? 0 : meter.out * 150;
    const glow = glowOf(swing);
    t.style.setProperty("--glow", (0.25 + 0.75 * glow).toFixed(3));
  }
  // The board glows with its link: the pedal's swing (4 V is full), or V1's (150 V).
  if (S.board === 1 && ctx) {
    const at = linksAt(S.pedal ?? AMP_SLOT), v = S.bypass || at === null ? 0 : meter.levels[at] ?? 0, full = S.pedal ? 4 : 150;
    ui.board.glow(Math.min(1, Math.log10(1 + (v * 150) / full) / Math.log10(151)));
  }
  push += (meter.out - push) * 0.35;
  for (const c of ui.cones) c.style.setProperty("--push", push.toFixed(3));
  if (stage3d && S.stage) {
    const pre = ampOf(S.amp).stages.map((_, i) => glowOf(meter.levels[offset + i] ?? 0));
    stage3d.update({ pre, power: glowOf(meter.out * 150), push, ...(analyser ? lightLevels(db, fr.sampleRate) : { lowMid: 0, high: 0 }) });
    stage3d.render();
  }
  const loadText = ui.load.lastElementChild;
  if (loadText) loadText.textContent = `${ctx ? `${Math.round(meter.load * 100)}%` : "--"} · ${S.quality === "eco" ? "2×" : "4×"}`;
  ui.load.classList.toggle("warn", meter.load > 0.7);
  ui.load.classList.toggle("hot", meter.load > 1);
  showHop(threads?.state() ?? null);
  // Each slot's share of the audio thread, on its tile (split across threads, the hop says each thread's).
  for (const [id, el] of ui.loadEls) {
    const i = chainIds.indexOf(id), v = i < 0 || !ctx ? null : meter.slots?.[i] ?? null;
    el.textContent = v === null ? "--" : `${Math.round(v * 100)}%`;
    el.classList.toggle("warn", (v ?? 0) > 0.3);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A part swapped, added or rewired, or a knob turned, on Q Builder (another tab) is on this amp's pedals too, as it plays: listened for
// once, at load, so a tab in the background (no frames) still takes the change.
onParts((p) => {
  S.swaps = p.swaps;
  edits = p.edits;
  Object.assign(S.drive, p.drive);
  for (const e of ui.pedalEls) e.knob.set(S.drive[e.id] ?? 5);
  send();
  showBoard();
});

/** Q Amps' lesson (lesson.ts) and Q Builder's (build-lesson.ts), read from the page's state as it stands, one on at a
 *  time; the cap button in the corner lists them, and ?lesson=amp or ?lesson=build starts one. */
const ampLesson = new PageLesson(AMP_LESSON, () => ({
  gain: (S.knobs[S.amp] ?? ampOf(S.amp).knobs).gain, lit: S.lit, drive: S.drive, tape: loopOf().tape.on === 1, order: S.order, driveHeard: sound.heard.includes("drive"),
}));
/** The parts Q Drive's D1 and D2 have held while Q Builder's lesson is on: its last step asks for both ends. */
const tried = new Set<string>();
const buildLesson = new PageLesson(BUILD_LESSON, () => {
  const swaps = S.swaps.drive ?? {};
  if (S.pedal === "drive") tried.add(clipperNow(swaps));
  return { pedal: S.pedal, lit: S.lit, board: S.board === 1, drive: S.drive.drive ?? 5, swaps, tried: [...tried] };
}, () => tried.clear());
const lessons = oneAtATime([ampLesson, buildLesson]);
const lessonCard = mountLessonCard(document.body, lessons, { float: true, offer: lessons.list.map((l) => ({ title: l.def.title, start: () => lessons.start(l.def.id) })) });
{
  const asked = lessons.asked(location.search);
  if (asked) { lessons.start(asked); lessonCard.frame(); }
}

// Ask the page instead of screenshotting it (scripts/probe.ts).
Object.assign(window, {
  qamp: {
    state: () => ({
      started: !!ctx, running: ctx?.state === "running", amp: S.amp, name: ampOf(S.amp).name, knobs: S.knobs[S.amp], pedal: S.pedal,
      drive: S.pedal ? S.drive[S.pedal] : null, swaps: S.pedal ? { ...S.swaps[S.pedal] } : {}, edits: S.pedal ? edits[S.pedal] ?? [] : [], board: S.board === 1, bypass: S.bypass === 1, quality: S.quality, source: S.source, layout: S.layout, modes: [...S.modes], mic: settings().mic,
      load: meter.load, misses: meter.misses, out: meter.out, levels: meter.levels, threads: threads?.state() ?? null, bench: ui.bench.state(), loop: loopSpecs(), order: [...S.order], lit: [...S.lit],
      slots: S.order.map((id) => { const i = chainIds.indexOf(id); return { id, on: i >= 0, load: i < 0 ? null : meter.slots?.[i] ?? null }; }), midi: { cc: S.cc, inputs: midiInputs },
      stage: { on: S.stage === 1 && !!stage3d, webgl, ...stage3d?.state() },
      patch: { cables: S.cables, chains: compiled.chains, problems: compiled.problems, audible: sound.audible, pedals: sound.pedals },
      scope: probe && { ...probe, ...probeSwing },
    }),
    /**
     * The Scope screen on a net of a playing pedal's board (`"fuzz", "D3"`'s node name) or a control its LFO or
     * envelope moves (`"GATE"`), as you play; null for the output again. False when that pedal isn't playing or has no such net.
     */
    scope: (pedal: string | null, net = "") => {
      if (pedal !== null && !hasNet(pedal, net)) return false;
      probe = pedal === null ? null : { pedal, net };
      probeSwing = { hi: 0, lo: 0, samples: 0 };
      probed.fill(0);
      sendScope();
      return true;
    },
    /** Puts a board (tscircuit circuit JSON) on the bench, as dropping its file does: the bench's verdict back. */
    bench: (json: unknown, name = "Bench pedal") => ui.bench.load(json, name),
    start,
    setAmp,
    /** The page's lessons: "amp" (Q Amps', lesson.ts) or "build" (Q Builder's, build-lesson.ts) starts one, null leaves it; then the lesson as it stands. */
    lesson: (id?: string | null) => {
      if (id === null) lessons.leave(); else if (id) lessons.start(id);
      lessonCard.frame();
      return { lesson: lessons.state(), finished: { amp: ampLesson.finished, build: buildLesson.finished } };
    },
    /** Cut the chain onto worker threads before these links ([] for one thread); the page does this itself when over budget. */
    split: (cuts: number[]) => threads?.split(cuts),
    /** Pull out the cable in a jack, e.g. unplug("head", "speaker"). */
    unplug: (item: string, jack: string) => setCables(S.cables.filter((c) => !(c.from[0] === item && c.from[1] === jack) && !(c.to[0] === item && c.to[1] === jack))),
    /** Run a cable, out jack first: plug(["guitar", "out"], ["cab", "in"], "instrument"). */
    plug: (from: End, to: End, kind: Cable["kind"]) => setCables([...S.cables, { from, to, kind }]),
    /** Back to the stage as it comes: the guitar through every pedal into the amp, the machines in its loop, into the cabinet. */
    restage: () => setCables([...STAGE.cables]),
    /** That pedal on alone (null: every pedal off). */
    pedal: (id: string | null) => { S.pedal = PEDALS.some((p) => p.id === id) || (id === "bench" && ui.bench.state()?.ok) ? id : null; S.lit = S.pedal ? [S.pedal] : []; showPedals(); send(); },
    /** A pedal's (or the bench's) footswitch, on or off; the others stay as they are. */
    footswitch: (id: string, isOn: boolean) => { if (PEDALS.some((p) => p.id === id) || id === "bench") footswitch(id, isOn); },
    /** A tile ("drive", "amp", "tape"...) to place `to` on the board, as its grip does: after the amp is in the loop. */
    move: (id: string, to: number) => moveSlot(id, to),
    /** The amp on the 3D stage (true) or the flat page; resolves once the stage has loaded. */
    stage: async (on: boolean) => { S.stage = on ? 1 : 0; await showStage(); save(); return { on: S.stage === 1 && !!stage3d, webgl }; },
    /** Open or close the board view. */
    board: (open: boolean) => { S.board = open ? 1 : 0; showBoard(); save(); },
    /** The playing pedal's build sheet open: what it shows once its kit has loaded (null: no pedal with a board on). */
    sheet: async () => (await openSheet(), ui.sheet.state()),
    /** The open sheet's Download button: the zip's file name and size. */
    sheetDownload: () => ui.sheet.download(),
    /** The open sheet's tolerance band, run (a few seconds) and returned: dB per frequency for the sim and the builds. */
    sheetBand: () => ui.sheet.bandOf(),
    /** Swap a socket on the playing pedal's board (`"D1", "germanium"`, `"R2", "0.47"`); null puts the stock part back. Why it won't play, or []. */
    swap: swapPart,
    /** Switch a loop machine ("spring", "tape", "bbd") on or off. */
    loop: (kind: "spring" | "tape" | "bbd", isOn: boolean) => { loopOf()[kind].on = isOn ? 1 : 0; showPedals(); send(); },
    /** The wah's treadle, 0 (heel) to 10 (toe), as an expression pedal sets it. */
    treadle: rockWah,
    /** Which MIDI controller rocks the treadle (11, expression, until changed); remembered. */
    cc: (n: number) => { S.cc = Math.round(Math.min(119, Math.max(0, n))); save(); },
  },
});
