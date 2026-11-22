// The decks on screen (engine.ts plays them): deck A on the left, deck B on the right, the mixer between, the two
// zoomed waveforms stacked across the top on one time scale so you can see the kicks line up, and the library under
// it all: drop files on it (or a deck), or pick them, and send each to A or B. Each deck: its name, tempo and time
// left, the whole track as an overview you click to jump, play and cue, sync, the pitch fader and its range, four hot
// cues (shift-click clears one), loops on the beat, beat jumps and the jog's nudge. The mixer: trim, high, mid, low and
// the filter per channel, their faders, meters and headphone cue buttons, the crossfader and its curve, the master,
// split cue and the cue mix. Keys while it's open: Q/P play A/B, W/O cue, 1 to 4 and 7 to 0 hot cues, the arrows
// slide the crossfader, Esc closes it. Icons after lucide (ISC), the word as the tooltip.
import "./panel.css";
import { clock, LOOPS, peaks, PITCH_RANGES } from "./analyze.ts";
import { Decks, type Knob, type Side, type Track } from "./engine.ts";
import { DEMOS, demoTrack } from "./demo.ts";

/** The waveforms' colours: deck A blue, deck B orange, what's played greyed, the cue and the four hot cues. */
const LOOKS_DECK = { wave: ["#4aa8ff", "#ff9a3c"] as const, played: "#5b5f68", cue: "#ffd23c", hot: ["#ff4a6a", "#4affa0", "#4ab8ff", "#d84aff"] };

const svg = (body: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  pause: svg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
  sync: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  phones: svg('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'),
  back: svg('<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>'),
  fwd: svg('<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>'),
  loop: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
const button = (icon: string, title: string, cls = "") => el("button", { type: "button", title, "aria-label": title, class: cls }, icon);
const slider = (label: string, min: number, max: number, step: number, value: number, cls = "") => {
  const i = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label, title: label, class: cls });
  return i;
};

/** A track in the library: what's been loaded this visit, decoded once. */
interface Shelf { track: Track; fine: Float32Array; overview: Float32Array }
/** The fine waveform's resolution, buckets a second: enough to see each kick at the zoomed view's width. */
const FINE = 150;
/** The zoomed view's span, seconds either side of the playhead. */
const ZOOM_S = 3;

export interface DecksPanel {
  decks: Decks;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Load bytes (a file, or a fetched URL) onto a deck, and into the library. */
  load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track>;
  library(): string[];
  /** The two demo tracks, one on each deck. */
  demos(): void;
}

/** Mount the decks on the page, closed. `ctx` is the page's audio; `onToggle` hears it open and close. */
export function mountDecks(o: { ctx: AudioContext; parent?: HTMLElement; onToggle?: (open: boolean) => void; startOpen?: boolean }): DecksPanel {
  const decks = new Decks(o.ctx);
  const shelf: Shelf[] = [];
  const fine = new Map<Track, Float32Array>(), over = new Map<Track, Float32Array>();
  const root = el("section", { id: "dj", role: "dialog", "aria-label": "The decks" });
  root.hidden = true;
  const head = el("header");
  const title = el("h2", {}, "Decks");
  const closeB = button(ICON.x, "Back to the room (Esc)", "dj-close");
  head.append(title, closeB);
  const zoom = el("canvas", { class: "dj-zoom", width: "1200", height: "150", "aria-label": "Both decks' waveforms, around the playheads" });
  const row = el("div", { class: "dj-row" });
  const lib = el("div", { class: "dj-lib" });
  root.append(head, zoom, row, lib);
  (o.parent ?? document.body).append(root);

  // ---- a deck
  function deckView(side: Side) {
    const d = decks.decks[side], box = el("div", { class: `dj-deck dj-${side ? "b" : "a"}` });
    const name = el("div", { class: "dj-name" }, side ? "B" : "A");
    const info = el("div", { class: "dj-info" });
    const overview = el("canvas", { class: "dj-over", width: "600", height: "56", "aria-label": `Deck ${side ? "B" : "A"}: the whole track, click to jump` });
    overview.addEventListener("pointerdown", (e) => {
      const t = d.track; if (!t) return;
      const r = overview.getBoundingClientRect();
      d.seek(((e.clientX - r.left) / r.width) * t.buffer.duration);
    });
    const play = button(ICON.play, `Play / pause (${side ? "P" : "Q"})`, "dj-play");
    play.addEventListener("click", () => d.toggle());
    const cue = button("CUE", `Cue (${side ? "O" : "W"}): stopped, mark here and play while held; playing, back to the mark`, "dj-cue");
    cue.addEventListener("pointerdown", () => d.cueDown(decks.quantize));
    for (const ev of ["pointerup", "pointerleave"]) cue.addEventListener(ev, () => d.cueUp());
    const sync = button(`${ICON.sync}<span>SYNC</span>`, "Sync: match the other deck's tempo and beat", "dj-sync");
    sync.addEventListener("click", () => { if (!decks.sync(side)) flash("Both decks need a track with a beat to sync"); });
    const hot = el("div", { class: "dj-hot" });
    const hots = [0, 1, 2, 3].map((i) => {
      const b = button(String(i + 1), `Hot cue ${i + 1} (${side ? "7890"[i] : i + 1}): set it here, or jump to it; shift-click clears it`);
      b.addEventListener("click", (e) => { if (e.shiftKey) d.clearHot(i); else d.hotCue(i, decks.quantize); });
      hot.append(b);
      return b;
    });
    const loops = el("div", { class: "dj-loops" });
    const loopBs = LOOPS.filter((b) => b >= 0.5 && b <= 16).map((beats) => {
      const b = button(beats < 1 ? "½" : String(beats), `Loop ${beats} beat${beats === 1 ? "" : "s"} (again: off)`);
      b.addEventListener("click", () => d.setLoop(d.loop?.beats === beats ? null : beats));
      loops.append(b);
      return { b, beats };
    });
    const jumps = el("div", { class: "dj-jumps" });
    const back = button(ICON.back, "Jump back 4 beats"), fwd = button(ICON.fwd, "Jump on 4 beats");
    back.addEventListener("click", () => d.jump(-4)); fwd.addEventListener("click", () => d.jump(4));
    const slow = button(ICON.minus, "Jog: hold to drag it back"), fast = button(ICON.plus, "Jog: hold to push it ahead");
    const hold = (b: HTMLButtonElement, bend: number) => { b.addEventListener("pointerdown", () => d.nudge(bend)); for (const ev of ["pointerup", "pointerleave"]) b.addEventListener(ev, () => d.nudge(1)); };
    hold(slow, 0.96); hold(fast, 1.04);
    jumps.append(back, slow, fast, fwd);
    const pitch = slider(`Deck ${side ? "B" : "A"} pitch`, -1, 1, 0.001, 0, "dj-pitch");
    pitch.addEventListener("input", () => d.setPitch(Number(pitch.value)) /* a vertical range runs min at the top: slower up, faster toward you, as on a club player */);
    pitch.addEventListener("dblclick", () => { pitch.value = "0"; d.setPitch(0); });
    const range = button("±8", "The pitch fader's range", "dj-range");
    range.addEventListener("click", () => d.setRange(PITCH_RANGES[(PITCH_RANGES.indexOf(d.range as 8) + 1) % PITCH_RANGES.length]!));
    const pitchCol = el("div", { class: "dj-pitchcol" });
    pitchCol.append(range, pitch);
    const controls = el("div", { class: "dj-controls" });
    const transport = el("div", { class: "dj-transport" });
    transport.append(cue, play, sync);
    controls.append(transport, hot, loops, jumps);
    const body = el("div", { class: "dj-body" });
    body.append(side ? pitchCol : controls, side ? controls : pitchCol);
    box.append(name, info, overview, body);
    // a file dropped on a deck goes on it
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); const f = e.dataTransfer?.files[0]; if (f) void fromFile(side, f); });
    return {
      box,
      draw() {
        const s = d.state(), t = d.track;
        name.textContent = `${side ? "B" : "A"}  ${s.name ?? "Drop a track here"}`;
        info.textContent = t ? `${s.bpm ?? "--"} BPM  ${s.pitch ? `${s.pitch > 0 ? "+" : ""}${(s.pitch * s.range).toFixed(1)}%` : "0%"}   ${clock(s.pos)}  -${clock(s.length - s.pos)}` : "";
        play.innerHTML = s.playing ? ICON.pause : ICON.play;
        play.classList.toggle("on", s.playing);
        sync.classList.toggle("on", s.synced);
        range.textContent = `±${s.range}`;
        if (document.activeElement !== pitch) pitch.value = String(s.pitch);
        hots.forEach((b, i) => b.classList.toggle("set", s.hot[i] != null));
        for (const { b, beats } of loopBs) b.classList.toggle("on", s.loop?.beats === beats);
        drawOverview(overview, t, s.pos, s.cue, s.hot, s.loop, side);
      },
    };
  }

  // ---- the mixer
  const mixer = el("div", { class: "dj-mixer" });
  const strips = ([0, 1] as const).map((side) => {
    const strip = el("div", { class: "dj-strip" });
    const knobs: Record<Knob, HTMLInputElement> = {
      trim: slider("Trim", -1, 1, 0.01, 0), high: slider("High", -1, 1, 0.01, 0), mid: slider("Mid", -1, 1, 0.01, 0), low: slider("Low", -1, 1, 0.01, 0), filter: slider("Filter: left a low-pass, right a high-pass", -1, 1, 0.01, 0),
      fader: slider(`Channel ${side ? "B" : "A"} fader`, 0, 1, 0.01, 0.8, "dj-fader"),
    };
    for (const k of ["trim", "high", "mid", "low", "filter"] as const) {
      const lab = el("label", {}, `<span>${k === "trim" ? "TRIM" : k === "filter" ? "FILTER" : k.toUpperCase()}</span>`);
      lab.append(knobs[k]);
      strip.append(lab);
      knobs[k].addEventListener("input", () => decks.knob(side, k, Number(knobs[k].value)));
      knobs[k].addEventListener("dblclick", () => { knobs[k].value = "0"; decks.knob(side, k, 0); });
    }
    const cue = button(ICON.phones, `Cue channel ${side ? "B" : "A"} in the headphones`, "dj-pfl");
    cue.addEventListener("click", () => decks.cue(side, !decks.channels[side].cue));
    const meter = el("div", { class: "dj-meter" }, "<i></i>");
    const faderRow = el("div", { class: "dj-faderrow" });
    faderRow.append(meter, knobs.fader);
    knobs.fader.addEventListener("input", () => decks.knob(side, "fader", Number(knobs.fader.value)));
    strip.append(cue, faderRow);
    return { strip, cue, meter: meter.firstElementChild as HTMLElement, knobs };
  });
  const xfade = slider("Crossfader (← →)", -1, 1, 0.01, 0, "dj-xfade");
  xfade.addEventListener("input", () => decks.cross(Number(xfade.value)));
  xfade.addEventListener("dblclick", () => { xfade.value = "0"; decks.cross(0); });
  const curve = button("Smooth", "The crossfader's curve: smooth for blends, cut for scratching", "dj-curve");
  curve.addEventListener("click", () => decks.setCurve(decks.curve === "smooth" ? "cut" : "smooth"));
  const masterL = el("label", {}, "<span>MASTER</span>"), master = slider("Master level", 0, 1, 0.01, 0.8);
  masterL.append(master);
  master.addEventListener("input", () => decks.setMaster(Number(master.value)));
  const masterMeter = el("div", { class: "dj-meter dj-master" }, "<i></i>");
  const blendL = el("label", {}, "<span>CUE MIX</span>"), blend = slider("Headphones: the cue (left) or the master (right)", 0, 1, 0.01, 0);
  blendL.append(blend);
  blend.addEventListener("input", () => decks.setCueBlend(Number(blend.value)));
  const split = button("Split cue", "One output (headphones on a laptop): the cue in your left ear, the master in your right", "dj-split");
  split.addEventListener("click", () => decks.setSplit(!decks.split));
  const quant = button("Quantize", "Cues and loops land on the beat", "dj-quant on");
  quant.addEventListener("click", () => { decks.quantize = !decks.quantize; });
  const stripsRow = el("div", { class: "dj-strips" });
  stripsRow.append(strips[0].strip, el("div", { class: "dj-mid" }), strips[1].strip);
  stripsRow.children[1]!.append(masterL, masterMeter, blendL);
  const xrow = el("div", { class: "dj-xrow" });
  xrow.append(el("b", {}, "A"), xfade, el("b", {}, "B"));
  const opts = el("div", { class: "dj-opts" });
  opts.append(curve, split, quant);
  mixer.append(stripsRow, xrow, opts);

  const deckA = deckView(0), deckB = deckView(1);
  row.append(deckA.box, mixer, deckB.box);

  // ---- the library
  const pick = el("input", { type: "file", accept: "audio/*", multiple: "", hidden: "" });
  const add = button(`${ICON.upload}<span>Add music</span>`, "Add music from this computer (mp3, wav, m4a, ogg, flac): it stays on this computer", "dj-add");
  add.addEventListener("click", () => pick.click());
  pick.addEventListener("change", () => { for (const f of pick.files ?? []) void fromFile(null, f); pick.value = ""; });
  const list = el("ul", { class: "dj-list" });
  const note = el("p", { class: "dj-note" });
  lib.append(add, pick, list, note);
  lib.addEventListener("dragover", (e) => e.preventDefault());
  lib.addEventListener("drop", (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files ?? []) void fromFile(null, f); });
  let noteUntil = 0;
  function flash(text: string) { note.textContent = text; noteUntil = performance.now() + 3500; }

  function shelve(t: Track) {
    fine.set(t, peaks(t.mono, Math.max(1, Math.round(t.buffer.duration * FINE))));
    over.set(t, peaks(t.mono, 600));
    if (!shelf.some((s) => s.track === t)) shelf.push({ track: t, fine: fine.get(t)!, overview: over.get(t)! });
    drawList();
  }
  function drawList() {
    list.replaceChildren();
    for (const s of shelf) {
      const li = el("li"), n = el("span", { title: s.track.name }), bpm = el("small");
      n.textContent = s.track.name;
      bpm.textContent = s.track.grid ? `${s.track.grid.bpm} BPM` : "no beat found";
      const toA = button("A", `Load on deck A`), toB = button("B", `Load on deck B`);
      toA.addEventListener("click", () => decks.put(0, s.track)); toB.addEventListener("click", () => decks.put(1, s.track));
      li.append(n, bpm, toA, toB);
      list.append(li);
    }
    if (!shelf.length) {
      const li = el("li", { class: "none" }, "<span>Add music, or drop files here or on a deck. Your files stay on this computer; the room hears your set as you play it.</span>");
      const demo = button("Demo tracks", "Two short tracks made here, to try the decks");
      demo.addEventListener("click", () => demos());
      li.append(demo);
      list.append(li);
    }
  }
  /** The two demo tracks (demo.ts), one on each deck. */
  function demos() {
    const rate = decks.ctx.sampleRate;
    DEMOS.forEach((d, i) => { const t = decks.fromSamples(d.name, demoTrack(d, rate), rate); shelve(t); decks.put(i as Side, t); });
  }
  drawList();
  async function load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track> {
    flash(`Reading ${name}…`);
    const t = await decks.load(side, name, bytes).catch((e: unknown) => { flash(`Couldn't read ${name}: ${e instanceof Error ? e.message : "not a sound file this browser knows"}`); throw e; });
    shelve(t);
    flash(t.grid ? `${name}: ${t.grid.bpm} BPM` : `${name}: no steady beat found, so sync and loops are off for it`);
    return t;
  }
  async function fromFile(side: Side | null, f: File) {
    // a library add goes on whichever deck is empty, else just into the library
    const empty = decks.decks.findIndex((d) => !d.track);
    const to = side ?? (empty >= 0 ? (empty as Side) : null);
    if (to === null) {
      const t = await decks.decode(f.name, await f.arrayBuffer()).catch(() => null);
      if (!t) { flash(`Couldn't read ${f.name}`); return; }
      shelve(t);
      flash(t.grid ? `${f.name}: ${t.grid.bpm} BPM` : `${f.name}: no steady beat found`);
      return;
    }
    await load(to, f.name, await f.arrayBuffer()).catch(() => {});
  }

  // ---- drawing
  function drawOverview(c: HTMLCanvasElement, t: Track | null, pos: number, cue: number, hot: (number | null)[], loop: { start: number; end: number } | null, side: Side) {
    const g = c.getContext("2d"); if (!g) return;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    if (!t) return;
    const p = over.get(t) ?? peaks(t.mono, 600), dur = t.buffer.duration, at = (pos / dur) * w;
    for (let i = 0; i < p.length; i++) {
      const x = (i / p.length) * w, v = p[i]! * (h / 2 - 2);
      g.fillStyle = x < at ? LOOKS_DECK.played : LOOKS_DECK.wave[side];
      g.fillRect(x, h / 2 - v, Math.max(1, w / p.length), v * 2);
    }
    if (loop) { g.fillStyle = "rgba(90, 220, 120, 0.25)"; g.fillRect((loop.start / dur) * w, 0, ((loop.end - loop.start) / dur) * w, h); }
    g.fillStyle = LOOKS_DECK.cue; g.fillRect((cue / dur) * w - 1, 0, 2, h);
    hot.forEach((v, i) => { if (v == null) return; g.fillStyle = LOOKS_DECK.hot[i]!; g.fillRect((v / dur) * w - 1, 0, 3, 10); });
    g.fillStyle = "#fff"; g.fillRect(at - 1, 0, 2, h);
  }
  function drawZoom() {
    const g = zoom.getContext("2d"); if (!g) return;
    const w = zoom.width, h = zoom.height, lane = h / 2;
    g.fillStyle = "#0d0e11"; g.fillRect(0, 0, w, h);
    decks.decks.forEach((d, side) => {
      const t = d.track, y0 = side * lane, mid = y0 + lane / 2;
      if (!t) return;
      const s = d.state(), f = fine.get(t) ?? peaks(t.mono, Math.round(t.buffer.duration * FINE));
      // the deck's own seconds, scaled by its rate, so two decks at one tempo show their beats the same distance apart
      const span = ZOOM_S * s.rate, pxPerS = w / (2 * span);
      for (let x = 0; x < w; x += 2) {
        const sec = s.pos + (x - w / 2) / pxPerS, i = Math.floor(sec * FINE);
        if (i < 0 || i >= f.length) continue;
        const v = f[i]! * (lane / 2 - 3);
        g.fillStyle = LOOKS_DECK.wave[side as Side];
        g.fillRect(x, mid - v, 2, v * 2);
      }
      if (s.grid) {
        const per = 60 / s.grid.bpm, first = s.grid.offset + Math.ceil((s.pos - span - s.grid.offset) / per) * per;
        for (let b = first; b < s.pos + span; b += per) {
          const x = w / 2 + (b - s.pos) * pxPerS, n = Math.round((b - s.grid.offset) / per);
          g.fillStyle = n % 4 === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
          g.fillRect(x, y0 + 2, 1, lane - 4);
        }
      }
      if (s.loop) { g.fillStyle = "rgba(90, 220, 120, 0.2)"; g.fillRect(w / 2 + (s.loop.start - s.pos) * pxPerS, y0, (s.loop.end - s.loop.start) * pxPerS, lane); }
    });
    g.fillStyle = "#ff6b4a"; g.fillRect(w / 2 - 1, 0, 2, h);
  }

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (root.hidden) return;
    deckA.draw(); deckB.draw(); drawZoom();
    for (const side of [0, 1] as const) {
      strips[side].meter.style.transform = `scaleY(${decks.level(side)})`;
      strips[side].cue.classList.toggle("on", decks.channels[side].cue);
    }
    (masterMeter.firstElementChild as HTMLElement).style.transform = `scaleY(${decks.level(2)})`;
    curve.textContent = decks.curve === "smooth" ? "Smooth" : "Cut";
    split.classList.toggle("on", decks.split);
    quant.classList.toggle("on", decks.quantize);
    if (performance.now() > noteUntil && note.textContent) note.textContent = "";
  }
  raf = requestAnimationFrame(frame);

  // ---- keys, while it's open
  const HOT = { a: ["Digit1", "Digit2", "Digit3", "Digit4"], b: ["Digit7", "Digit8", "Digit9", "Digit0"] };
  const cueKeys = new Set<string>();
  function key(e: KeyboardEvent) {
    if (root.hidden || e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    const [a, b] = decks.decks;
    let used = true;
    if (e.code === "Escape") close();
    else if (e.code === "KeyQ") a.toggle();
    else if (e.code === "KeyP") b.toggle();
    else if (e.code === "KeyW" || e.code === "KeyO") { if (!cueKeys.has(e.code)) { cueKeys.add(e.code); (e.code === "KeyW" ? a : b).cueDown(decks.quantize); } }
    else if (HOT.a.includes(e.code)) a.hotCue(HOT.a.indexOf(e.code), decks.quantize);
    else if (HOT.b.includes(e.code)) b.hotCue(HOT.b.indexOf(e.code), decks.quantize);
    else if (e.code === "ArrowLeft" || e.code === "ArrowRight") { decks.cross(decks.xfader + (e.code === "ArrowLeft" ? -0.1 : 0.1)); xfade.value = String(decks.xfader); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  function keyUp(e: KeyboardEvent) {
    if (!cueKeys.delete(e.code)) return;
    decks.decks[e.code === "KeyW" ? 0 : 1].cueUp();
    e.preventDefault(); e.stopPropagation();
  }
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", keyUp, true);

  function open() { if (!root.hidden) return; root.hidden = false; void o.ctx.resume(); o.onToggle?.(true); }
  function close() { if (root.hidden) return; root.hidden = true; o.onToggle?.(false); }
  closeB.addEventListener("click", close);
  if (o.startOpen) open();
  void raf;
  return { decks, open, close, isOpen: () => !root.hidden, load: (side, name, bytes) => load(side, name, bytes), library: () => shelf.map((s) => s.track.name), demos };
}
