// A QDJ deck's face, a club media player (panel.ts puts two of them either side of the Qone mixer): the screen (name,
// tempo, key, time, the whole track to click and jump), the big jog wheel, a big CUE and a big PLAY/PAUSE, the
// VINYL/CD switch, sync, four hot cues, beat loops, LOOP IN / OUT / RELOOP (OUT again while it loops: the jog moves the
// out point, clockwise longer), beat jumps, and the tempo column: MT (master tempo, the key held), a button for each
// tempo range (6 to 100 per cent), the fader, and the START and BRAKE knobs (how long play takes to come up to speed
// and pause to stop, as a turntable's motor and brake). `Jog` drives the deck
// from the wheel (player.ts has its arithmetic): pointer, touch, a scroll on the wheel, or a MIDI jog (`connectMidiJog`).
// The wheel is drawn as two rings with a gap between: the top platter, which turns with the record in VINYL, and
// the side ring; the screen in its middle shows the position marker (a turn every 1.8 s) and how far in the track is.
import { clock, LOOPS, PITCH_RANGES } from "./analyze.ts";
import { knob } from "./mixer-panel.ts";
import type { DeckView, Press } from "./booth.ts";
import type { Decks, Side } from "./engine.ts";
import { BEND_HOLD_MS, bendOf, BRAKE_MAX_S, jogAct, midiJog, partAt, PLATTER_R, rampS, RING_IN, START_MAX_S, TURN_S, turnBetween, type JogMode, type JogPart } from "./player.ts";
import scratchWorkletUrl from "./scratch-worklet.ts?worker&url";
import { button, el, slider, svg } from "./dom.ts";
import { FROM_LABEL } from "./tags.ts";
import { FAST_TIMES, holdBend, tapShift, type Prefs } from "./prefs.ts";

type Deck = Decks["decks"][number];

const ICON = {
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  pause: svg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
  sync: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  back: svg('<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>'),
  nudgeBack: svg('<path d="m15 18-6-6 6-6"/>'),
  nudgeOn: svg('<path d="m9 18 6-6-6-6"/>'),
  fastBack: svg('<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>'),
  fastOn: svg('<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>'),
  fwd: svg('<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>'),
};
/** Deck A blue, deck B orange (the waveforms' colours in panel.ts). */
const LOOK = { deck: ["#4aa8ff", "#ff9a3c"] as const, cue: "#ffd23c" };
/** Seconds of track either side of the platter's place sent to the scratch voice at a time. */
const WINDOW_S = 12;

const ready = new WeakMap<BaseAudioContext, Promise<void>>();
/** The scratch voice's worklet, added once per audio context. */
function scratchModule(ctx: AudioContext): Promise<void> {
  let p = ready.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule(scratchWorkletUrl); ready.set(ctx, p); }
  return p;
}

/** The jog wheel on one deck: its mode, the platter held or not, and the nudge the ring gives. */
export class Jog {
  mode: JogMode = "vinyl";
  touched = false;
  bend = 1;
  private wasPlaying = false;
  private lastRing = 0;
  /** How long the ring's nudge holds once it stops: longer for turns that come over the live line in batches. */
  private hold = BEND_HOLD_MS;
  private tps = 0;
  /** The fast nudge held: back (−1), on (1), or not (0). */
  held: -1 | 0 | 1 = 0;
  private node: AudioWorkletNode | null = null;
  /** The stretch of the track the scratch voice holds. */
  private win: { track: unknown; start: number; end: number } | null = null;
  constructor(private readonly deck: Deck, ctx: AudioContext) {
    scratchModule(ctx).then(() => {
      this.node = new AudioWorkletNode(ctx, "q-scratch", { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(deck.into);
    }).catch(() => { /* no worklet: the platter still moves the track, silently */ });
  }
  setMode(m: JogMode) { if (this.touched) this.touch(false); this.unbend(); this.mode = m; }
  /**
   * The top platter touched or let go. VINYL: a touch holds the track (it stops under your hand); letting go plays on
   * if it was playing. `any`: a hand on the waveform, which holds it like a record in either mode.
   */
  touch(on: boolean, any = false) {
    const d = this.deck;
    if (on) {
      if ((this.mode !== "vinyl" && !any) || this.touched || !d.track || d.adjust) return;
      this.touched = true; this.wasPlaying = d.playing;
      d.pause(); this.unbend(); this.voice(d.pos());
      return;
    }
    if (!this.touched) return;
    this.touched = false;
    this.node?.port.postMessage({ on: false });
    if (this.wasPlaying) d.play();
  }
  /** A turn of `turns` (clockwise on) on a part of the wheel. `hold`: how long a nudge it gives lasts once the turns stop, ms. */
  turn(part: JogPart, turns: number, now = performance.now(), hold = BEND_HOLD_MS) {
    const d = this.deck, t = d.track;
    if (!t || !turns) return;
    if (d.adjust && d.loop) { d.adjustTurn(turns); return; }
    const act = jogAct(this.mode, part, turns, d.playing, this.touched);
    if (act.kind === "scratch") { const p = Math.min(t.buffer.duration, Math.max(0, d.pos() + act.ds)); d.seek(p); this.voice(p); }
    else if (act.kind === "step") d.seek(d.pos() + act.ds);
    else if (act.kind === "bend") {
      const dt = now - this.lastRing, inst = turns / (dt > 200 || dt < 4 ? 0.016 : dt / 1000);
      this.tps = this.tps * 0.5 + inst * 0.5;
      this.bend = bendOf(this.tps);
      d.nudge(this.bend);
      this.lastRing = now; this.hold = hold;
    }
  }
  /** The held track dragged `ds` seconds (a hand on the waveform): a scratch. */
  scrub(ds: number) {
    const t = this.deck.track;
    if (!this.touched || !t || !ds) return;
    const p = Math.min(t.buffer.duration, Math.max(0, this.deck.pos() + ds));
    this.deck.seek(p); this.voice(p);
  }
  /** A tap of the nudge: the track moves `nudgeMs` back or on, playing or not (one press, one move). */
  tapNudge(dir: -1 | 1, nudgeMs: number) { const d = this.deck; if (d.track && !this.touched) d.seek(d.pos() + tapShift(dir, nudgeMs)); }
  /** The fast nudge held (back or on) or let go (0): the deck drifts ten nudges a second while it's held. */
  holdNudge(dir: -1 | 0 | 1, nudgeMs: number) {
    if (dir === this.held) return;
    this.held = dir; this.tps = 0;
    this.bend = holdBend(dir, nudgeMs);
    this.deck.nudge(this.bend);
  }
  /** Each frame: the ring's nudge lets go once it stops moving (a held fast nudge stays). */
  tick(now: number) { if (!this.held && this.bend !== 1 && now - this.lastRing > this.hold) this.unbend(); }
  state() { return { mode: this.mode, touched: this.touched, bend: this.bend, held: this.held }; }
  private unbend() { this.tps = 0; this.held = 0; if (this.bend !== 1) { this.bend = 1; this.deck.nudge(1); } }
  /** The scratch voice to `pos`, sending it a fresh stretch of the track when the platter nears the edge of the last. */
  private voice(pos: number) {
    const n = this.node, t = this.deck.track;
    if (!n || !t) return;
    const w = this.win;
    if (!w || w.track !== t || (pos < w.start + 2 && w.start > 0) || (pos > w.end - 2 && w.end < t.buffer.duration)) {
      const b = t.buffer, start = Math.max(0, pos - WINDOW_S), end = Math.min(b.duration, pos + WINDOW_S);
      const i0 = Math.floor(start * b.sampleRate), i1 = Math.ceil(end * b.sampleRate);
      const chans = Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c).slice(i0, i1));
      n.port.postMessage({ chans, start: i0 / b.sampleRate, rate: b.sampleRate }, chans.map((c) => c.buffer));
      this.win = { track: t, start, end };
    }
    n.port.postMessage({ to: pos });
  }
}

/** What a player's face needs from the panel. */
export interface PlayerHost {
  side: Side;
  deck: Deck;
  jog: Jog;
  /** A press on this deck, here or sent to its player in the booth. */
  press(p: Press, x?: number): void;
  /** The top platter touched or let go, and a turn of the wheel: on this deck's Jog, or sent to its player in the booth. */
  touch(on: boolean): void;
  turn(part: JogPart, turns: number): void;
  /** Someone else's deck on this side, as its screen shows it (null: yours or free). */
  theirs(): DeckView | null;
  /** A YouTube video on this deck (youtube.ts), as its screen shows it, with its hot cues (null: none). */
  tube(): (DeckView & { hot: readonly (number | null)[]; cueHeld: boolean }) | null;
  /** Draw the whole track on the screen's overview. */
  paintOverview(c: HTMLCanvasElement, v: DeckView | null): void;
  /** A file dropped on the player. */
  drop(f: File): void;
  /** Quantize is on: loop points land on the beat. */
  quantize(): boolean;
  /** The DJ's settings (prefs.ts): the nudge amount and the locks. */
  prefs(): Prefs;
  /** A nudge on this deck: a tap (back or on), or the fast one held (0 lets go). */
  nudge(kind: "tap" | "hold", dir: -1 | 0 | 1): void;
}

/** A club media player's face for one deck: `box` to put on the page, `draw` each frame. */
export function playerFace(h: PlayerHost) {
  const { side, deck: d, jog } = h, letter = side ? "B" : "A";
  const box = el("div", { class: `dj-deck dj-${side ? "b" : "a"}` });
  const name = el("div", { class: "dj-name" }, letter);
  const info = el("div", { class: "dj-info" });
  const top = el("div", { class: "dj-top" });
  top.append(name, info);
  // a YouTube video's player sits here while one is on (the panel fills it)
  const video = el("div", { class: "dj-video" });
  video.hidden = true;
  const overview = el("canvas", { class: "dj-over", width: "600", height: "56", "aria-label": `Deck ${letter}: the whole track, click to jump` });
  overview.addEventListener("pointerdown", (e) => {
    const r = overview.getBoundingClientRect();
    h.press("seek", Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  });

  // the big two: cue and play
  const play = button(ICON.play, `Play / pause (${side ? "P" : "Q"})`, "dj-play");
  play.addEventListener("click", () => h.press("play"));
  const cue = button("CUE", `Cue (${side ? "O" : "W"}): stopped, mark here and play while held, back to the mark on letting go; playing, back to the mark and stop`, "dj-cue");
  let held = false;
  cue.addEventListener("pointerdown", () => { held = true; h.press("cueDown"); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) cue.addEventListener(ev, () => { if (held) { held = false; h.press("cueUp"); } });
  const sync = button(`${ICON.sync}<span>SYNC</span>`, "Sync: match the other deck's tempo and beat", "dj-sync");
  sync.addEventListener("click", () => h.press("sync"));
  const back = button(ICON.back, "Jump back 4 beats"), fwd = button(ICON.fwd, "Jump on 4 beats");
  back.addEventListener("click", () => h.press("back")); fwd.addEventListener("click", () => h.press("fwd"));
  // the nudge: a tap moves the track a little (press again for more: it never repeats), the fast one is held
  const nudge = el("div", { class: "dj-nudge", role: "group", "aria-label": `Deck ${letter} nudge` });
  const nudgeTitle = (dir: -1 | 1) => `Nudge ${dir < 0 ? "back" : "on"} ${h.prefs().nudgeMs} ms a press (press again for more; the amount is in Settings)`;
  const fastTitle = (dir: -1 | 1) => `Hold: ${FAST_TIMES}× nudge ${dir < 0 ? "back" : "on"}, the deck drifts while held`;
  const tapB = ([-1, 1] as const).map((dir) => {
    const b = button(dir < 0 ? ICON.nudgeBack : ICON.nudgeOn, nudgeTitle(dir));
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); h.nudge("tap", dir); });
    b.addEventListener("pointerenter", () => { b.title = nudgeTitle(dir); });
    return b;
  });
  const fastB = ([-1, 1] as const).map((dir) => {
    const b = button(dir < 0 ? ICON.fastBack : ICON.fastOn, fastTitle(dir), "dj-fast");
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); h.nudge("hold", dir); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, () => h.nudge("hold", 0));
    return b;
  });
  nudge.append(fastB[0]!, tapB[0]!, tapB[1]!, fastB[1]!);

  // the pads: hot cues and loops
  const hot = el("div", { class: "dj-hot" });
  const hots = [0, 1, 2, 3].map((i) => {
    const b = button(String(i + 1), `Hot cue ${i + 1} (${side ? "7890"[i] : i + 1}): set it here, or jump to it; shift-click clears it`);
    b.addEventListener("click", (e) => { if (e.shiftKey && !h.theirs()) d.clearHot(i); else h.press((["hot1", "hot2", "hot3", "hot4"] as const)[i]!); });
    hot.append(b);
    return b;
  });
  const loops = el("div", { class: "dj-loops" });
  // LOOP IN, LOOP OUT and RELOOP / EXIT, as a club player has them
  const manual = el("div", { class: "dj-loopio" });
  const inB = button("IN", "Loop in: mark where a loop starts (looping: the jog moves the in point; again, done)");
  const outB = button("OUT", "Loop out: the loop ends here and plays round from IN (looping: the jog moves the out point, clockwise longer, back shorter; again, done)");
  const reB = button("RELOOP", "Reloop / exit: out of the loop and play on, or back into the last loop");
  inB.addEventListener("click", () => d.loopInPress(h.quantize()));
  outB.addEventListener("click", () => d.loopOutPress(h.quantize()));
  reB.addEventListener("click", () => d.reloop());
  manual.append(inB, outB, reB);
  const loopBs = LOOPS.filter((b) => b >= 0.5 && b <= 16).map((beats) => {
    const b = button(beats < 1 ? "½" : String(beats), `Loop ${beats} beat${beats === 1 ? "" : "s"} (again: off)`);
    b.addEventListener("click", () => d.setLoop(d.loop?.beats === beats ? null : beats));
    loops.append(b);
    return { b, beats };
  });

  // the jog wheel and its mode
  const wheel = el("canvas", { class: "dj-wheel", width: "360", height: "360", "aria-label": `Deck ${letter} jog wheel: VINYL, hold the top to stop and scratch, turn the side ring to nudge; CD, the wheel nudges` });
  const mode = button("VINYL", "Jog mode: VINYL (the top scratches, the side ring nudges) or CD (the whole wheel nudges)", "dj-mode on");
  mode.addEventListener("click", () => jog.setMode(jog.mode === "vinyl" ? "cd" : "vinyl"));
  let grab: { id: number; part: JogPart; a: number } | null = null;
  const where = (e: PointerEvent) => {
    const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    return { r: Math.hypot(x, y) / (r.width / 2), a: Math.atan2(y, x) };
  };
  wheel.addEventListener("pointerdown", (e) => {
    if (grab || h.prefs().lockJog) return;
    const p = where(e), part = partAt(p.r);
    if (!part) return;
    e.preventDefault();
    wheel.setPointerCapture(e.pointerId);
    grab = { id: e.pointerId, part, a: p.a };
    if (part === "top") h.touch(true);
  });
  wheel.addEventListener("pointermove", (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    const a = where(e).a;
    h.turn(grab.part, turnBetween(grab.a, a));
    grab.a = a;
  });
  const letGo = (e: PointerEvent) => { if (!grab || e.pointerId !== grab.id) return; if (grab.part === "top") h.touch(false); grab = null; };
  wheel.addEventListener("pointerup", letGo);
  wheel.addEventListener("pointercancel", letGo);
  wheel.addEventListener("wheel", (e) => { e.preventDefault(); if (!h.prefs().lockJog) h.turn("ring", e.deltaY / 600); }, { passive: false });

  const pitch = slider(`Deck ${letter} pitch`, -1, 1, 0.001, 0, "dj-pitch");
  pitch.addEventListener("input", () => d.setPitch(Number(pitch.value)) /* a vertical range runs min at the top: slower up, faster toward you, as on a club player */);
  pitch.addEventListener("dblclick", () => { pitch.value = "0"; d.setPitch(0); });
  // master tempo, the tempo ranges, the fader, and the motor's start and brake
  const mt = button("MT", "Master tempo: the key stays put when the tempo moves (off: tempo and pitch together, as a record)", "dj-mt");
  mt.addEventListener("click", () => d.setKeylock(!d.keylock));
  const ranges = el("div", { class: "dj-ranges" });
  const rangeBs = PITCH_RANGES.map((r) => {
    const b = button(String(r), `Tempo range ±${r}%`);
    b.addEventListener("click", () => d.setRange(r));
    ranges.append(b);
    return { b, r };
  });
  const secs = (v: number) => (v < 0.05 ? "0 s" : `${v.toFixed(v < 1 ? 2 : 1)} s`);
  const startK = knob({ label: "START", title: `Deck ${letter} start: how long play takes to come up to speed, a turntable's motor (0 to ${START_MAX_S} s)`, min: 0, max: 1, reset: 0, size: "s", get: () => d.ramp.start, put: (v) => d.setRamp("start", v), show: (v) => secs(rampS(v, START_MAX_S)) });
  const brakeK = knob({ label: "BRAKE", title: `Deck ${letter} brake: how long pause takes to stop, the pitch falling with it (0 to ${BRAKE_MAX_S} s)`, min: 0, max: 1, reset: 0, size: "s", get: () => d.ramp.brake, put: (v) => d.setRamp("brake", v), show: (v) => secs(rampS(v, BRAKE_MAX_S)) });
  const pitchCol = el("div", { class: "dj-pitchcol" });
  pitchCol.append(mt, ranges, pitch, startK.box, brakeK.box);

  const pads = el("div", { class: "dj-pads" });
  pads.append(hot, loops, manual, nudge);
  const jogRow = el("div", { class: "dj-jogrow" });
  jogRow.append(wheel, mode);
  const transport = el("div", { class: "dj-transport" });
  const side2 = el("div", { class: "dj-transport-side" });
  side2.append(sync, back, fwd);
  transport.append(cue, play, side2);
  const controls = el("div", { class: "dj-controls" });
  controls.append(pads, jogRow, transport);
  const body = el("div", { class: "dj-body" });
  body.append(side ? pitchCol : controls, side ? controls : pitchCol);
  box.append(top, overview, video, body);
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); const f = e.dataTransfer?.files[0]; if (f) h.drop(f); });

  function drawWheel(pos: number, len: number, cuePos: number, live: boolean) {
    const g = wheel.getContext("2d"); if (!g) return;
    const S = wheel.width, c = S / 2, R = c - 3, col = LOOK.deck[side];
    g.clearRect(0, 0, S, S);
    // the side ring, ridged; lit while it nudges
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.arc(c, c, R * RING_IN, 0, Math.PI * 2, true);
    g.fillStyle = jog.bend !== 1 ? "#3a3f48" : "#262a30"; g.fill();
    g.strokeStyle = "#4a4f58"; g.lineWidth = 1.5;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * R * (RING_IN + 0.03), c + Math.sin(a) * R * (RING_IN + 0.03)); g.lineTo(c + Math.cos(a) * R * 0.97, c + Math.sin(a) * R * 0.97); g.stroke();
    }
    // the top platter: turns with the record in VINYL, its rim lit while held
    const spin = (pos / TURN_S) * Math.PI * 2 - Math.PI / 2;
    g.beginPath(); g.arc(c, c, R * PLATTER_R, 0, Math.PI * 2);
    g.fillStyle = jog.mode === "vinyl" ? "#1b1d22" : "#202328"; g.fill();
    g.lineWidth = 4; g.strokeStyle = jog.touched ? col : "#3a3e45"; g.stroke();
    if (jog.mode === "vinyl") {
      g.strokeStyle = "#2c3036"; g.lineWidth = 1;
      for (let k = 0.45; k < PLATTER_R; k += 0.06) { g.beginPath(); g.arc(c, c, R * k, 0, Math.PI * 2); g.stroke(); }
    }
    g.strokeStyle = "#8a8f99"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(c + Math.cos(spin) * R * 0.42, c + Math.sin(spin) * R * 0.42); g.lineTo(c + Math.cos(spin) * R * (PLATTER_R - 0.04), c + Math.sin(spin) * R * (PLATTER_R - 0.04)); g.stroke();
    // the screen in the middle: how far in (the arc), the cue, and the position marker
    const sr = R * 0.36;
    g.font = `600 ${Math.round(S * 0.06)}px "Barlow Condensed", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.beginPath(); g.arc(c, c, sr, 0, Math.PI * 2); g.fillStyle = "#08090b"; g.fill();
    if (len > 0) {
      g.beginPath(); g.arc(c, c, sr - 5, -Math.PI / 2, -Math.PI / 2 + (pos / len) * Math.PI * 2);
      g.strokeStyle = live ? col : "#5b5f68"; g.lineWidth = 5; g.stroke();
      if (d.adjust) { g.fillStyle = "#ee6a1f"; g.fillText(d.adjust === "out" ? "LOOP OUT" : "LOOP IN", c, c - sr * 0.55); }
      const ca = (cuePos / TURN_S) * Math.PI * 2 - Math.PI / 2;
      g.fillStyle = LOOK.cue; g.beginPath(); g.arc(c + Math.cos(ca) * (sr - 16), c + Math.sin(ca) * (sr - 16), 4, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = "#f1efe9"; g.lineWidth = 4; g.lineCap = "round";
    g.beginPath(); g.moveTo(c + Math.cos(spin) * (sr * 0.25), c + Math.sin(spin) * (sr * 0.25)); g.lineTo(c + Math.cos(spin) * (sr - 12), c + Math.sin(spin) * (sr - 12)); g.stroke();
    g.fillStyle = "#c9ccd2";
    g.fillText(jog.mode === "vinyl" ? "VINYL" : "CD", c, c + sr * 0.55);
  }

  return {
    box,
    video,
    draw(now: number) {
      jog.tick(now);
      const theirs = h.theirs(), tube = theirs ? null : h.tube(), v = theirs ?? tube;
      box.classList.toggle("far", !!theirs);
      box.classList.toggle("tube", !!tube);
      mode.textContent = jog.mode === "vinyl" ? "VINYL" : "CD";
      mode.classList.toggle("on", jog.mode === "vinyl");
      const pr = h.prefs();
      pitch.disabled = pr.lockPitch; wheel.classList.toggle("locked", pr.lockJog);
      fastB.forEach((b, i) => b.classList.toggle("on", jog.held === (i ? 1 : -1)));
      if (tube) {
        // a YouTube video: its player on the deck, the pitch fader its speed, the cue and hot cues on its clock
        const s = d.state();
        name.textContent = `QDJ ${letter}  ${tube.name ?? "YouTube"}`;
        info.textContent = `${s.pitch ? `${s.pitch > 0 ? "+" : ""}${(s.pitch * s.range).toFixed(1)}%` : "0%"}   ${clock(tube.pos)}  -${clock(Math.max(0, tube.len - tube.pos))}  · YouTube`;
        info.title = "";
        play.innerHTML = tube.playing ? ICON.pause : ICON.play;
        play.classList.toggle("on", tube.playing);
        cue.classList.toggle("on", tube.cueHeld);
        sync.classList.remove("on");
        for (const { b, r } of rangeBs) b.classList.toggle("on", s.range === r);
        if (document.activeElement !== pitch) pitch.value = String(s.pitch);
        hots.forEach((b, i) => b.classList.toggle("set", tube.hot[i] != null));
        h.paintOverview(overview, tube);
        drawWheel(tube.pos, tube.len, tube.cue, tube.playing);
        return;
      }
      if (v) {
        // someone else's deck: what they said, where it is now on the room's clock; their buttons go to them
        name.textContent = `QDJ ${letter}  ${v.name ?? ""}`;
        info.textContent = `${v.bpm ?? "--"} BPM  ${v.key ?? ""}   ${clock(v.pos)}  -${clock(v.len - v.pos)}   ${v.who ?? ""}`;
        play.innerHTML = v.playing ? ICON.pause : ICON.play;
        play.classList.toggle("on", v.playing);
        sync.classList.remove("on");
        h.paintOverview(overview, v);
        drawWheel(v.pos, v.len, v.cue, v.playing);
        return;
      }
      const s = d.state(), t = d.track;
      name.textContent = `QDJ ${letter}  ${s.name ?? "Drop a track here"}`;
      info.textContent = t ? `${s.bpm ?? "--"} BPM  ${s.key ? `${s.key.camelot} ${s.key.name}` : ""}  ${s.pitch ? `${s.pitch > 0 ? "+" : ""}${(s.pitch * s.range).toFixed(1)}%` : "0%"}   ${clock(s.pos)}  -${clock(s.length - s.pos)}${t.from && s.bpm ? `  · ${FROM_LABEL[t.from]}` : ""}` : "";
      info.title = t?.from && s.bpm ? `Tempo: ${FROM_LABEL[t.from]}` : "";
      play.innerHTML = s.playing ? ICON.pause : ICON.play;
      play.classList.toggle("on", s.playing);
      cue.classList.toggle("on", d.cueHeld);
      sync.classList.toggle("on", s.synced);
      for (const { b, r } of rangeBs) b.classList.toggle("on", s.range === r);
      mt.classList.toggle("on", s.keylock);
      inB.classList.toggle("on", s.loopIn !== null || s.adjust === "in");
      outB.classList.toggle("on", !!s.loop);
      inB.classList.toggle("adj", s.adjust === "in"); outB.classList.toggle("adj", s.adjust === "out");
      reB.classList.toggle("on", !!s.loop);
      startK.draw(); brakeK.draw();
      if (document.activeElement !== pitch) pitch.value = String(s.pitch);
      hots.forEach((b, i) => b.classList.toggle("set", s.hot[i] != null));
      for (const { b, beats } of loopBs) b.classList.toggle("on", s.loop?.beats === beats);
      h.paintOverview(overview, null);
      drawWheel(s.pos, s.length, s.cue, s.playing || jog.touched);
    },
  };
}

/** A MIDI controller's jogs onto the two decks' wheels (player.ts `midiJog` reads its messages). Says what it found. */
export async function connectMidiJog(jogs: readonly [Jog, Jog]): Promise<string> {
  if (!("requestMIDIAccess" in navigator)) return "This browser has no MIDI";
  let access: MIDIAccess;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return "MIDI wasn't allowed"; }
  const onMsg = (e: MIDIMessageEvent) => {
    const m = e.data ? midiJog(e.data) : null;
    if (!m) return;
    if ("touch" in m) jogs[m.side].touch(m.touch); else jogs[m.side].turn(m.part, m.turns);
  };
  const hook = () => { for (const i of access.inputs.values()) i.onmidimessage = onMsg; };
  hook();
  access.onstatechange = hook;
  return access.inputs.size ? `MIDI jog: ${[...access.inputs.values()].map((i) => i.name ?? "a controller").join(", ")}` : "No MIDI controller found: plug one in, it joins when it appears";
}
