// Q Amp: one of the circuit amps on a stage, live. The riff on a loop or a guitar
// through the audio thread (worklet.ts), out to the speakers and to the stage
// screens (screens.ts). The amp head and cabinet are clear, so you see the tubes
// glow with what each stage is doing. 2D for now; a three.js stage comes later.
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./amp.css";
import workletUrl from "./worklet.ts?worker&url";
import { arr, bool, check, num, obj, oneOf, or, rec, str } from "@rustybuns/util/guard";
import { AMPS, type Knobs } from "../circuit/amps.ts";
import { riff } from "../circuit/riff.ts";
import { icon } from "./icons.ts";
import { knob, type KnobEl } from "./knob.ts";
import { MODES, Screen, topHz, hzLabel, type ScreenMode } from "./screens.ts";
import type { AmpSettings, FromAmp, ToAmp } from "./messages.ts";
import { AMP_SLOT, EFFECTS, ampOf, freshBoard, tidyBoard, type Slot } from "./slots.ts";

const KEY = "q-amp";
const KNOB_NAMES: { key: keyof Knobs; label: string }[] = [
  { key: "gain", label: "Gain" }, { key: "bass", label: "Bass" }, { key: "mid", label: "Middle" }, { key: "treble", label: "Treble" }, { key: "master", label: "Master" }, { key: "noise", label: "Noise" },
];
const MODE_ICON: Record<ScreenMode, string> = { spectrum: "chart-column", analog: "activity", scope: "audio-waveform", focus: "scan-search" };
const MODE_IDS = MODES.map((m) => m.id);

const KnobsGuard = obj({ gain: num(0, 10, 5), bass: num(0, 10, 5), mid: num(0, 10, 5), treble: num(0, 10, 5), master: num(0, 10, 5), noise: num(0, 10, 3) });
const Saved = obj({
  amp: str(20, { dflt: "lead" }),
  knobs: rec(KnobsGuard, 10),
  board: or(arr(obj({ id: str(20), on: bool(false), knob: num(0, 10, 5) }), 12, { drop: true }), []),
  bypass: oneOf([0, 1], 0),
  source: oneOf(["riff", "guitar"], "riff"),
  layout: oneOf(["wide", "split"], "split"),
  modes: arr(oneOf(MODE_IDS, "spectrum"), 2, { min: 2 }),
  level: num(-60, 0, -12),
  quality: oneOf(["hq", "eco"], "hq"),
});
type State = ReturnType<typeof Saved>;

function loadState(): State {
  const fresh: State = {
    amp: "lead", knobs: Object.fromEntries(AMPS.map((a) => [a.id, { ...a.knobs }])), board: freshBoard(), bypass: 0, source: "riff", layout: "split", modes: ["analog", "focus"], level: -12, quality: "hq",
  };
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? check(Saved, JSON.parse(raw)) : null;
    if (saved) return { ...saved, knobs: { ...fresh.knobs, ...saved.knobs }, board: tidyBoard(saved.board) };
  } catch { /* private window or bad JSON: start fresh */ }
  return fresh;
}
const S = loadState();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* not kept, fine */ } };

// ---- audio ----
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let out: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let riffNode: AudioBufferSourceNode | null = null;
let mic: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
let meter: FromAmp = { t: "meter", levels: [], out: 0, load: 0, slots: [], stereo: false, chain: "", misses: 0 };
const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20));

function settings(): AmpSettings {
  return { amp: S.amp, knobs: S.knobs[S.amp] ?? ampOf(S.amp).knobs, board: S.board, bypass: S.bypass === 1, oversample: S.quality === "eco" ? 2 : 4 };
}
function send() {
  save();
  if (node) { const m: ToAmp = { t: "set", settings: settings() }; node.port.postMessage(m); }
}

async function start() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(workletUrl);
  node = new AudioWorkletNode(ctx, "q-amp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
  node.port.onmessage = (e: MessageEvent<FromAmp>) => { meter = e.data; watchLoad(meter); };
  out = new GainNode(ctx, { gain: dbToGain(S.level) });
  analyser = new AnalyserNode(ctx, { fftSize: 16384, smoothingTimeConstant: 0.6, minDecibels: -110, maxDecibels: -10 });
  node.connect(analyser);
  node.connect(out).connect(ctx.destination);
  send();
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

function showLatency() {
  if (!ctx) return;
  ui.latency.textContent = `${Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000)} ms out`;
}

// ---- page ----
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
};
const iconButton = (name: string, title: string, onClick: () => void) => {
  const b = h("button", "icon-btn", icon(name));
  b.title = title; b.setAttribute("aria-label", title); b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

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
  level.addEventListener("input", () => { S.level = Number(level.value); if (out && ctx) out.gain.setTargetAtTime(dbToGain(S.level), ctx.currentTime, 0.02); save(); });
  const load = h("button", "chip load", icon("cpu", 14), h("span", "", "--"));
  load.type = "button";
  load.title = "How much of the audio thread's time the amp uses. Click: 4× oversampling (cleanest) or 2× (Eco, half the work)";
  load.addEventListener("click", () => setQuality(S.quality === "hq" ? "eco" : "hq"));
  const latency = h("span", "chip dim");
  const layout = iconButton(S.layout === "split" ? "columns-2" : "rectangle-horizontal", "Screens: one wide or two half", () => {
    S.layout = S.layout === "split" ? "wide" : "split";
    layout.replaceChildren(icon(S.layout === "split" ? "columns-2" : "rectangle-horizontal"));
    screensEl.className = `screens ${S.layout}`;
    save();
  });
  const bar = h("header", "bar",
    h("div", "brand", h("span", "q", "Q"), h("span", "", "AMP")),
    h("div", "group", ...sourceButtons, devices), bypass,
    h("label", "group", icon("volume-2", 16), level), load, latency, h("span", "spacer"), layout);

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
  const cab = h("div", "cab clear", ...cones.map((c) => h("div", "speaker", c)));
  const rig = h("div", "rig", head, cab, modelBlurb);

  // The board on the floor, in chain order: pedals, the amp's own slot (what follows is in its effects loop), more pedals.
  const tiles = new Map<string, HTMLElement>();
  const loads = new Map<string, HTMLElement>();
  for (const slot of S.board) {
    const load = h("span", "slot-load", "--");
    loads.set(slot.id, load);
    const grip = h("button", "grip", icon("grip-vertical", 16));
    grip.type = "button";
    if (slot.id === AMP_SLOT) {
      grip.title = grip.ariaLabel = "Move the amp: pedals after it go in its effects loop. Drag, or the arrow keys";
      const el = h("div", "slot amp-slot", grip, h("span", "amp-slot-name", "AMP"), h("span", "amp-slot-loop", "loop"), load);
      el.dataset.id = slot.id;
      dragToMove(el, grip);
      tiles.set(slot.id, el);
      continue;
    }
    const def = EFFECTS.find((e) => e.id === slot.id);
    if (!def) continue;
    const led = h("span", "pedal-led");
    const k = knob(def.knob, slot.knob, def.dflt, (v) => { slot.knob = v; if (slot.on) send(); else save(); }, "small");
    const sw = h("button", "footswitch");
    sw.type = "button"; sw.title = sw.ariaLabel = `${def.name} on or off`;
    grip.title = grip.ariaLabel = `Move ${def.name}: drag, or the arrow keys`;
    const el = h("div", `slot pedal ${def.id}`, h("div", "slot-top", grip, led, load), k.el, h("span", "pedal-name", def.name), sw);
    el.title = def.blurb;
    el.dataset.id = slot.id;
    sw.addEventListener("click", () => { slot.on = !slot.on; showBoard(); send(); });
    dragToMove(el, grip);
    tiles.set(slot.id, el);
  }
  const stereo = h("span", "chip dim board-stereo", "mono");
  const floor = h("div", "floor");
  const note = h("p", "note");
  const startCard = h("div", "start-card",
    h("h1", "", "Q Amp"),
    h("p", "", "Pedals and tube amps simulated part by part, live. Turn your speakers down first."),
    (() => { const b = h("button", "start", icon("power"), "Plug in"); b.type = "button"; b.addEventListener("click", () => void start().catch((e) => { note.textContent = String(e); })); return b; })());
  root.append(bar, note, screensEl, rig, h("div", "board", stereo, floor), startCard);
  document.body.append(root);
  return { root, bar, screens, screensEl, tubes, modelName, modelBlurb, models, knobs, cones, tiles, loads, stereo, floor, sourceButtons, devices, load, latency, note, startCard };
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

/** Move slot `id` to index `to` on the board (clamped), and play it that way. */
function move(id: string, to: number) {
  const from = S.board.findIndex((s) => s.id === id);
  if (from < 0) return;
  const [slot] = S.board.splice(from, 1);
  S.board.splice(Math.max(0, Math.min(S.board.length, to)), 0, slot);
  showBoard();
  send();
}

/**
 * Drag a slot by its grip to anywhere on the board (mouse, pen or finger): it
 * moves as it passes another slot's middle. Arrow keys on the grip move it one place.
 */
function dragToMove(el: HTMLElement, grip: HTMLElement) {
  const id = () => el.dataset.id ?? "";
  grip.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    move(id(), S.board.findIndex((s) => s.id === id()) + step);
    grip.focus();
  });
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    const onMove = (m: PointerEvent) => {
      const over = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>(".slot");
      if (!over || over === el || !over.dataset.id) return;
      const r = over.getBoundingClientRect(), at = S.board.findIndex((s) => s.id === over.dataset.id);
      const after = r.width > r.height * 0.6 ? m.clientX > r.left + r.width / 2 : m.clientY > r.top + r.height / 2;
      const from = S.board.findIndex((s) => s.id === id());
      const to = after ? (from < at ? at : at + 1) : (from < at ? at - 1 : at);
      if (to !== from) move(id(), to);
    };
    const onUp = () => { el.classList.remove("dragging"); grip.removeEventListener("pointermove", onMove); grip.removeEventListener("pointerup", onUp); grip.removeEventListener("pointercancel", onUp); };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });
}

/** The board in its order, each pedal lit or not, marked as in the loop or stereo by where it sits. */
function showBoard() {
  let loop = false, wide = false;
  const els: HTMLElement[] = [];
  for (const slot of S.board) {
    const el = ui.tiles.get(slot.id);
    if (!el) continue;
    const def = EFFECTS.find((e) => e.id === slot.id);
    if (slot.on && def?.stereo) wide = true;
    el.classList.toggle("lit", slot.on);
    el.classList.toggle("in-loop", loop && slot.id !== AMP_SLOT);
    el.classList.toggle("wide", wide && slot.on);
    if (slot.id === AMP_SLOT) loop = true;
    els.push(el);
  }
  ui.floor.replaceChildren(...els);
  ui.stereo.textContent = wide ? "stereo" : "mono";
}

function setAmp(id: string) {
  S.amp = ampOf(id).id;
  const amp = ampOf(S.amp), k = S.knobs[amp.id] ?? amp.knobs;
  ui.modelName.textContent = amp.name;
  ui.modelBlurb.textContent = amp.blurb;
  for (const b of ui.models.children) if (b instanceof HTMLElement) b.setAttribute("aria-pressed", String(b.dataset.amp === amp.id));
  for (const { key } of KNOB_NAMES) ui.knobs[key].set(k[key]);
  const tube = (cls: string, label: string) => h("div", `tube ${cls}`, h("div", "glass", h("div", "plate"), h("div", "filament")), h("span", "tube-label", label));
  ui.tubes.replaceChildren(
    ...amp.stages.map((_, i) => tube("pre", `V${i + 1}`)),
    h("span", "tube-gap"),
    ...Array.from({ length: amp.powerTubes }, (_, i) => tube("power", `P${i + 1}`)),
  );
  send();
}
setAmp(S.amp);
showBoard();
ui.sourceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === S.source)));
ui.devices.hidden = S.source !== "guitar";

// ---- every frame: screens, tube glow, cones ----
let db = new Float32Array(8192).fill(-Infinity), wave = new Float32Array(16384);
let push = 0;
function frame() {
  if (analyser) {
    if (db.length !== analyser.frequencyBinCount) { db = new Float32Array(analyser.frequencyBinCount); wave = new Float32Array(analyser.fftSize); }
    analyser.getFloatFrequencyData(db);
    analyser.getFloatTimeDomainData(wave);
  }
  const fr = { db, wave, sampleRate: ctx?.sampleRate ?? 48000 };
  for (const s of ui.screens) s.draw(fr);
  // A tube glows with its stage's swing (log scale, 150 V is full); power tubes with the output.
  const tubes = ui.tubes.querySelectorAll<HTMLElement>(".tube");
  let pre = 0;
  for (const t of tubes) {
    const swing = t.classList.contains("pre") ? meter.levels[pre++] ?? 0 : meter.out * 150;
    const glow = Math.min(1, Math.log10(1 + swing) / Math.log10(151));
    t.style.setProperty("--glow", (0.25 + 0.75 * glow).toFixed(3));
  }
  push += (meter.out - push) * 0.35;
  for (const c of ui.cones) c.style.setProperty("--push", push.toFixed(3));
  const loadText = ui.load.lastElementChild;
  if (loadText) loadText.textContent = `${ctx ? `${Math.round(meter.load * 100)}%` : "--"} · ${S.quality === "eco" ? "2×" : "4×"}`;
  ui.load.classList.toggle("warn", meter.load > 0.7);
  ui.load.classList.toggle("hot", meter.load > 1);
  // Each slot's share of the audio thread, as a DSP unit shows it.
  for (const [id, el] of ui.loads) {
    const share = meter.slots.find((s) => s.id === id)?.load;
    el.textContent = ctx && share !== undefined && !S.bypass ? `${Math.round(share * 100)}%` : "--";
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Ask the page instead of screenshotting it (scripts/probe.ts).
Object.assign(window, {
  qamp: {
    state: () => ({
      started: !!ctx, running: ctx?.state === "running", amp: S.amp, name: ampOf(S.amp).name, knobs: S.knobs[S.amp],
      board: S.board.map((s) => ({ ...s, load: meter.slots.find((m) => m.id === s.id)?.load ?? null })),
      chain: meter.chain, stereo: meter.stereo, bypass: S.bypass === 1, quality: S.quality, source: S.source, layout: S.layout, modes: [...S.modes],
      load: meter.load, misses: meter.misses, out: meter.out, levels: meter.levels,
    }),
    start,
    setAmp,
    /** Switch an effect on or off (flips it when `on` is left out). */
    pedal: (id: string, on?: boolean) => { const s = S.board.find((b) => b.id === id && b.id !== AMP_SLOT); if (s) { s.on = on ?? !s.on; showBoard(); send(); } },
    /** Move an effect (or "amp") to a place on the board, 0 first. */
    move,
    knob: (id: string, v: number) => { const s: Slot | undefined = S.board.find((b) => b.id === id); if (s && Number.isFinite(v)) { s.knob = Math.max(0, Math.min(10, v)); send(); } },
  },
});
