// The decks on screen (engine.ts plays them): deck A on the left, deck B on the right, the mixer between, the two
// zoomed waveforms stacked across the top on one time scale so you can see the kicks line up, and the library under
// it all: drop files on it (or a deck), or pick them, and send each to A or B. Each deck: its name, tempo and time
// left, the whole track as an overview you click to jump, play and cue, sync, the pitch fader and its range, four hot
// cues (shift-click clears one), loops on the beat, beat jumps and the jog's nudge. The mixer: trim, high, mid, low and
// the filter per channel, their faders, meters and headphone cue buttons, the crossfader and its curve, the master,
// split cue and the cue mix. Keys while it's open: Q/P play A/B, W/O cue, 1 to 4 and 7 to 0 hot cues, the arrows
// slide the crossfader, Esc closes it. Icons after lucide (ISC), the word as the tooltip.
// In a room (`room`), the decks are the booth's (booth.ts): a deck someone else loaded shows here as they play it
// (its waveform, key, tempo, where it is on the room's clock) and its play, cue, sync, hot cues and jumps go to them;
// yours go out to the room the same way, and your master plays to the room's PA while you have a track on. The
// people button lists who may play the decks: the leader adds a DJ with one press, anyone else asks.
import "./panel.css";
import { clock, LOOPS, peaks, PITCH_RANGES, type Grid } from "./analyze.ts";
import { Booth, changed, farView, hotOf, keyPress, posAt, sayOf, SAY_EVERY_MS, waveFrom, waveOf, type DeckPress, type DeckSay, type DeckView, type Press } from "./booth.ts";
import { Decks, type Beside, type Knob, type Side, type Track } from "./engine.ts";
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
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
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

/** One person in the room, for the DJ list: whether they may play the decks, and whether the leader can change it. */
export interface Dj { id: string; name: string; on: boolean; you: boolean }
/** The room the decks are in: its booth, its shared clock, the live line, and who may play. */
export interface DeckRoom {
  booth: Booth;
  /** The room's shared clock now, ms (src/clock.ts: the leader's time). */
  now(): number;
  send(e: DeckSay | DeckPress): void;
  /** Whether you may touch the decks (the play grant), and why not. */
  may(): { ok: true } | { ok: false; why: string };
  /** The name of the player behind a peer number. */
  nameOf(peer: number): string;
  /** Your master to the room's PA (null: stop), with what's on. */
  toPa(stream: MediaStream | null, name: string): void;
  /** Everyone here, for the DJ list; `lead`: you lead, so you can add and drop DJs. */
  djs(): { lead: boolean; people: Dj[] };
  setDj(id: string, on: boolean): void;
  /** Raise your hand to play. */
  ask(): void;
}

export type { DeckView };

export interface DecksPanel {
  decks: Decks;
  /** A press on deck `side`, here or sent to its player (the 3D booth's buttons, the keys). */
  press(side: Side, press: Press, x?: number): void;
  /** Someone's deck event off the live line (a press is for you: the page checked `to`). */
  heard(from: number, e: DeckSay | DeckPress): void;
  view(side: Side): DeckView;
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
export function mountDecks(o: { ctx: AudioContext; parent?: HTMLElement; onToggle?: (open: boolean) => void; startOpen?: boolean; room?: DeckRoom }): DecksPanel {
  const decks = new Decks(o.ctx), room = o.room ?? null;
  /** Someone else's deck on `side`, or null when it's yours or free. */
  const far = (side: Side) => room?.booth.sides[side] ?? null;
  const shelf: Shelf[] = [];
  const fine = new Map<Track, Float32Array>(), over = new Map<Track, Float32Array>();
  const root = el("section", { id: "dj", role: "dialog", "aria-label": "The decks" });
  root.hidden = true;
  const head = el("header");
  const title = el("h2", {}, "Decks");
  const closeB = button(ICON.x, "Back to the room (Esc)", "dj-close");
  const peopleB = button(`${ICON.users}<span>DJs</span>`, "Who may play the decks: add the DJ for the night", "dj-people-open");
  const people = el("div", { class: "dj-people", role: "dialog", "aria-label": "Who may play the decks" });
  people.hidden = true;
  peopleB.hidden = !room;
  peopleB.addEventListener("click", () => { people.hidden = !people.hidden; drawPeople(); });
  const tools = el("div", { class: "dj-head-tools" });
  tools.append(peopleB, closeB);
  head.append(title, tools, people);
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
      const r = overview.getBoundingClientRect();
      press(side, "seek", Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    });
    const play = button(ICON.play, `Play / pause (${side ? "P" : "Q"})`, "dj-play");
    play.addEventListener("click", () => press(side, "play"));
    const cue = button("CUE", `Cue (${side ? "O" : "W"}): stopped, mark here and play while held; playing, back to the mark`, "dj-cue");
    let held = false;
    cue.addEventListener("pointerdown", () => { held = true; press(side, "cueDown"); });
    for (const ev of ["pointerup", "pointerleave"]) cue.addEventListener(ev, () => { if (held) { held = false; press(side, "cueUp"); } });
    const sync = button(`${ICON.sync}<span>SYNC</span>`, "Sync: match the other deck's tempo and beat", "dj-sync");
    sync.addEventListener("click", () => press(side, "sync"));
    const hot = el("div", { class: "dj-hot" });
    const hots = [0, 1, 2, 3].map((i) => {
      const b = button(String(i + 1), `Hot cue ${i + 1} (${side ? "7890"[i] : i + 1}): set it here, or jump to it; shift-click clears it`);
      b.addEventListener("click", (e) => { if (e.shiftKey && !far(side)) d.clearHot(i); else press(side, (["hot1", "hot2", "hot3", "hot4"] as const)[i]!); });
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
    back.addEventListener("click", () => press(side, "back")); fwd.addEventListener("click", () => press(side, "fwd"));
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
        const theirs = far(side);
        box.classList.toggle("far", !!theirs);
        if (theirs) {
          // someone else's deck: what they said, where it is now on the room's clock; their buttons go to them
          const v = view(side);
          name.textContent = `${side ? "B" : "A"}  ${v.name ?? ""}`;
          info.textContent = `${v.bpm ?? "--"} BPM  ${v.key ?? ""}   ${clock(v.pos)}  -${clock(v.len - v.pos)}   ${v.who ?? ""}`;
          play.innerHTML = v.playing ? ICON.pause : ICON.play;
          play.classList.toggle("on", v.playing);
          sync.classList.remove("on");
          drawWave(overview, v.wave, v.len, v.pos, v.cue, [], null, side);
          return;
        }
        const s = d.state(), t = d.track;
        name.textContent = `${side ? "B" : "A"}  ${s.name ?? "Drop a track here"}`;
        info.textContent = t ? `${s.bpm ?? "--"} BPM  ${s.key ? `${s.key.camelot} ${s.key.name}` : ""}  ${s.pitch ? `${s.pitch > 0 ? "+" : ""}${(s.pitch * s.range).toFixed(1)}%` : "0%"}   ${clock(s.pos)}  -${clock(s.length - s.pos)}` : "";
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
      toA.addEventListener("click", () => put(0, s.track)); toB.addEventListener("click", () => put(1, s.track));
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
    DEMOS.forEach((d, i) => { const t = decks.fromSamples(d.name, demoTrack(d, rate), rate); shelve(t); put(i === 0 ? 0 : 1, t); });
  }
  drawList();
  /** Whether this deck can take a track: free, yours, or someone else's that's stopped (theirs goes). */
  function canLoad(side: Side): boolean {
    const r = room?.booth.mayLoad(side);
    if (r && !r.ok) { flash(r.why); return false; }
    return true;
  }
  function put(side: Side, t: Track) { if (canLoad(side)) { decks.put(side, t); room?.booth.sides.splice(side, 1, null); } }
  async function load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track> {
    if (!canLoad(side)) throw new Error(`deck ${side ? "B" : "A"} is busy`);
    flash(`Reading ${name}…`);
    const t = await decks.load(side, name, bytes).catch((e: unknown) => { flash(`Couldn't read ${name}: ${e instanceof Error ? e.message : "not a sound file this browser knows"}`); throw e; });
    shelve(t);
    room?.booth.sides.splice(side, 1, null);
    flash(t.grid ? `${name}: ${t.grid.bpm} BPM${t.key ? `, ${t.key.camelot} ${t.key.name}` : ""}` : `${name}: no steady beat found, so sync and loops are off for it`);
    return t;
  }
  async function fromFile(side: Side | null, f: File) {
    // a library add goes on whichever deck is empty, else just into the library
    const empty = decks.decks.findIndex((d, i) => !d.track && !far(i === 0 ? 0 : 1));
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
    if (!t) { c.getContext("2d")?.clearRect(0, 0, c.width, c.height); return; }
    drawWave(c, over.get(t) ?? peaks(t.mono, 600), t.buffer.duration, pos, cue, hot, loop, side);
  }
  function drawWave(c: HTMLCanvasElement, p: Float32Array, dur: number, pos: number, cue: number, hot: (number | null)[], loop: { start: number; end: number } | null, side: Side) {
    const g = c.getContext("2d"); if (!g) return;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    if (!dur) return;
    const at = (pos / dur) * w;
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
      const t = d.track, y0 = side * lane, mid = y0 + lane / 2, theirs = far(side === 0 ? 0 : 1);
      if (theirs) { const v = view(side === 0 ? 0 : 1); gridLines(g, theirs.say.grid, v.pos, ZOOM_S * theirs.say.rate, w / (2 * ZOOM_S * theirs.say.rate), y0, lane); return; }
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
      gridLines(g, s.grid, s.pos, span, pxPerS, y0, lane);
      if (s.loop) { g.fillStyle = "rgba(90, 220, 120, 0.2)"; g.fillRect(w / 2 + (s.loop.start - s.pos) * pxPerS, y0, (s.loop.end - s.loop.start) * pxPerS, lane); }
    });
    g.fillStyle = "#ff6b4a"; g.fillRect(w / 2 - 1, 0, 2, h);
  }

  /** A deck's beats across the zoomed view, the bar lines brighter. */
  function gridLines(g: CanvasRenderingContext2D, grid: Grid | null, pos: number, span: number, pxPerS: number, y0: number, lane: number) {
    if (!grid) return;
    const w = zoom.width, per = 60 / grid.bpm, first = grid.offset + Math.ceil((pos - span - grid.offset) / per) * per;
    for (let b = first; b < pos + span; b += per) {
      const x = w / 2 + (b - pos) * pxPerS, n = Math.round((b - grid.offset) / per);
      g.fillStyle = n % 4 === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
      g.fillRect(x, y0 + 2, 1, lane - 4);
    }
  }

  // ---- the booth: presses here or to the deck's player, what's on yours to the room, and the DJ list
  /** Where the other deck is, for sync, wherever it plays. */
  function beside(side: Side): Beside | undefined {
    const other: Side = side === 0 ? 1 : 0, theirs = far(other);
    return theirs && room ? { grid: theirs.say.grid, rate: theirs.say.rate, playing: theirs.say.playing, pos: posAt(theirs.say, room.now()) } : undefined;
  }
  function press(side: Side, p: Press, x?: number) {
    const theirs = far(side);
    if (theirs && room) {
      const may = room.may();
      if (!may.ok) return flash(may.why);
      room.send({ t: "press", to: theirs.owner, side, press: p, ...(x === undefined ? {} : { x }) });
      return;
    }
    pressHere(side, p, x);
  }
  /** Do a press on a deck here (yours, or someone in the booth pressed it). */
  function pressHere(side: Side, p: Press, x?: number) {
    const d = decks.decks[side], hot = hotOf(p);
    if (!d.track) return;
    if (p === "play") d.toggle();
    else if (p === "cueDown") d.cueDown(decks.quantize);
    else if (p === "cueUp") d.cueUp();
    else if (p === "sync") { if (!decks.sync(side, beside(side))) flash("Both decks need a track with a beat to sync"); }
    else if (hot >= 0) d.hotCue(hot, decks.quantize);
    else if (p === "back" || p === "fwd") d.jump(p === "back" ? -4 : 4);
    else if (p === "seek" && x !== undefined) d.seek(x * d.track.buffer.duration);
    say(true);
  }
  function view(side: Side): DeckView {
    const theirs = far(side);
    if (theirs && room) return farView(theirs, room.now(), room.nameOf(theirs.owner), waveIn(theirs.say.wave));
    const s = decks.decks[side].state(), t = decks.decks[side].track;
    return { name: s.name, who: null, bpm: s.bpm, key: s.key ? `${s.key.camelot} ${s.key.name}` : null, pos: s.pos, len: s.length, playing: s.playing, cue: s.cue, wave: t ? (over.get(t) ?? new Float32Array(0)) : new Float32Array(0) };
  }
  const wavesIn = new Map<string, Float32Array>();
  function waveIn(w: string) { let f = wavesIn.get(w); if (!f) { if (wavesIn.size > 8) wavesIn.clear(); f = waveFrom(w); wavesIn.set(w, f); } return f; }
  const wavesOut = new Map<Track, string>();
  const said: [DeckSay | null, DeckSay | null] = [null, null], saidAt = [0, 0];
  let onPa = false;
  /** What's on your decks to the room: on a change, and every SAY_EVERY_MS while a track is on. `now`: right away. */
  function say(now = false) {
    if (!room) return;
    const t = room.now();
    for (const side of [0, 1] as const) {
      const d = decks.decks[side], tr = d.track;
      if (!tr && !said[side]?.name) continue;
      if (tr && !wavesOut.has(tr)) wavesOut.set(tr, waveOf(over.get(tr) ?? peaks(tr.mono, 600)));
      const next = sayOf(side, d.state(), tr ? wavesOut.get(tr)! : "", t);
      if (!now && !changed(said[side], next) && t - saidAt[side]! < SAY_EVERY_MS) continue;
      room.send(next);
      said[side] = next; saidAt[side] = t;
    }
    // your master to the room's PA while you have a track on and one has played
    const on = decks.decks.some((d) => d.track && (d.playing || d.state().pos > 0));
    if (on !== onPa) { onPa = on; room.toPa(on ? decks.stream : null, decks.decks.find((d) => d.playing)?.track?.name ?? ""); }
  }
  if (room) setInterval(() => { room.booth.sweep(performance.now()); say(); }, 250);
  function heard(from: number, e: DeckSay | DeckPress) {
    if (!room) return;
    if (e.t === "press") return void pressHere(e.side, e.press, e.x);
    if (room.booth.heard(from, e, performance.now(), !!decks.decks[e.side].track)) {
      // they loaded onto a deck you had: yours comes off
      decks.decks[e.side].unload();
      said[e.side] = null;
      flash(`${room.nameOf(from)} took deck ${e.side ? "B" : "A"}`);
    }
  }
  function drawPeople() {
    if (!room || people.hidden) return;
    const { lead, people: list } = room.djs();
    people.replaceChildren(el("h3", {}, "On the decks"));
    const ul = el("ul");
    for (const p of list) {
      const li = el("li"), n = el("span");
      n.textContent = p.you ? `${p.name} (you)` : p.name;
      li.append(n);
      if (lead && !p.you) {
        const b = button(p.on ? "On" : "Off", p.on ? `Take ${p.name} off the decks` : `Let ${p.name} play the decks`, p.on ? "on" : "");
        b.addEventListener("click", () => { room.setDj(p.id, !p.on); setTimeout(drawPeople, 300); });
        li.append(b);
      } else li.append(el("small", {}, p.on ? "may play" : "listening"));
      ul.append(li);
    }
    if (!list.length) ul.append(el("li", {}, "<small>Nobody's in the room yet: invite a friend, then let them on here.</small>"));
    people.append(ul);
    if (!room.may().ok) { const ask = button(`${ICON.hand}<span>Ask to play</span>`, "Raise your hand: the leader lets you on the decks"); ask.addEventListener("click", () => { room.ask(); flash("Hand up: the leader sees it"); }); people.append(ask); }
    if (lead) people.append(el("p", {}, "You lead this room: press a name to let them play the decks."));
  }

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (root.hidden) return;
    deckA.draw(); deckB.draw(); drawZoom();
    for (const side of [0, 1] as const) {
      strips[side].strip.classList.toggle("far", !!far(side));
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
  const cueKeys = new Set<string>();
  function key(e: KeyboardEvent) {
    if (root.hidden || e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    const k = keyPress(e.code);
    let used = true;
    if (e.code === "Escape") close();
    else if (k && k.press === "cueDown") { if (!cueKeys.has(e.code)) { cueKeys.add(e.code); press(k.side, "cueDown"); } }
    else if (k) press(k.side, k.press);
    else if (e.code === "ArrowLeft" || e.code === "ArrowRight") { decks.cross(decks.xfader + (e.code === "ArrowLeft" ? -0.1 : 0.1)); xfade.value = String(decks.xfader); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  function keyUp(e: KeyboardEvent) {
    if (!cueKeys.delete(e.code)) return;
    press(e.code === "KeyW" ? 0 : 1, "cueUp");
    e.preventDefault(); e.stopPropagation();
  }
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", keyUp, true);

  function open() { if (!root.hidden) return; root.hidden = false; void o.ctx.resume(); o.onToggle?.(true); }
  function close() { if (root.hidden) return; root.hidden = true; o.onToggle?.(false); }
  closeB.addEventListener("click", close);
  if (o.startOpen) open();
  void raf;
  return { decks, press, heard, view, open, close, isOpen: () => !root.hidden, load: (side, name, bytes) => load(side, name, bytes), library: () => shelf.map((s) => s.track.name), demos };
}
