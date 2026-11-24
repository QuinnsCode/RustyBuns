// The decks on their own page (/decks.html): practise a mix before the party. The audio starts on the first press (a
// browser wants a gesture), then the decks open with the demo tracks on them. `qdecks` is the harness for probes.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountDecks, type DecksPanel } from "./panel.ts";
import type { Side } from "./engine.ts";
import type { Ch, ChannelKnob, Curve, FilterState, XAssign } from "./mixer.ts";
import type { JogMode, JogPart } from "./player.ts";
import type { Press } from "./booth.ts";
import type { Prefs } from "./prefs.ts";

/** On a narrow screen the decks are a carousel: which piece is in view (0 deck A, 1 the mixer, 2 deck B), or null when all three fit. */
function carousel(): number | null {
  const row = document.querySelector(".dj-row");
  if (!(row instanceof HTMLElement) || row.scrollWidth <= row.clientWidth + 1) return null;
  return Math.round(row.scrollLeft / row.clientWidth);
}

let panel: DecksPanel | null = null;
function start(): DecksPanel {
  if (panel) return panel;
  const ctx = new AudioContext({ latencyHint: "interactive" });
  panel = mountDecks({ ctx, startOpen: true, onToggle: (open) => { if (!open) setTimeout(() => panel?.open(), 0); } });
  panel.demos();
  document.getElementById("start")?.remove();
  return panel;
}
document.querySelector("#start button")?.addEventListener("click", () => void start());

declare global { interface Window { qdecks: typeof harness } }
const mx = () => panel?.decks.mixer;
const harness = {
  /** Open the decks with the demo tracks (the probe has no gesture; headless Chrome lets audio start anyway). */
  start: () => { start(); return harness.state(); },
  /** The decks, the mixer (mixer.ts's MixerState), what its meters read now (0 to 1), the players' jogs and the close-up's zoom. */
  state: () => {
    if (!panel) return null;
    const m = panel.decks.mixer;
    return { open: panel.isOpen(), library: panel.library(), waiting: panel.waiting(), ...panel.decks.state(), meters: { channels: m.channels.map((_, i) => m.level(i as Ch)), master: m.masterLevels() }, players: panel.jogs.map((j) => j.state()), midi: panel.midi.state(), zoom: panel.zoom(), tubes: panel.tubes(), carousel: carousel() };
  },
  /** Load a file's bytes onto a deck as a dropped file would: its tempo and where that came from (tag, software grid, ear). */
  load: async (side: Side, name: string, bytes: number[]) => { const t = await start().load(side, name, Uint8Array.from(bytes).buffer); return { bpm: t.grid?.bpm ?? null, firstBeat: t.grid?.offset ?? null, from: t.from ?? null }; },
  /** A YouTube link (or id) onto a deck: resolves true once YouTube's player is ready on it (needs the network). */
  tube: (side: Side, link: string) => start().tube(side, link),
  /** A press on a deck as its buttons do it (a YouTube deck's too): play, cueDown, cueUp, hot1..4, back, fwd, sync. */
  press: (side: Side, p: Press) => panel?.press(side, p),
  play: (side: Side) => panel?.decks.decks[side].toggle(),
  sync: (side: Side) => panel?.decks.sync(side) ?? false,
  cross: (x: number) => panel?.decks.cross(x),
  loop: (side: Side, beats: number | null) => panel?.decks.decks[side].setLoop(beats),
  hot: (side: Side, i: number) => panel?.decks.decks[side].hotCue(i, true),
  pitch: (side: Side, p: number) => panel?.decks.decks[side].setPitch(p),
  /** The tempo range buttons (6 to 100 per cent), master tempo (MT), and the START / BRAKE knobs (0 to 1). */
  range: (side: Side, r: number) => panel?.decks.decks[side].setRange(r),
  keylock: (side: Side, on: boolean) => panel?.decks.decks[side].setKeylock(on),
  ramp: (side: Side, which: "start" | "brake", v: number) => panel?.decks.decks[side].setRamp(which, v),
  /** LOOP IN, LOOP OUT (again while looping: the jog moves the out point) and RELOOP / EXIT, as the buttons press them. */
  loopIn: (side: Side) => panel?.decks.decks[side].loopInPress(panel.decks.quantize),
  loopOut: (side: Side) => panel?.decks.decks[side].loopOutPress(panel.decks.quantize),
  reloop: (side: Side) => panel?.decks.decks[side].reloop(),
  quantize: (on: boolean) => { if (panel) panel.decks.quantize = on; },
  /** Where each LFO is in its round (0 to 1) and its tempo now. */
  lfo: () => { const m = mx(); return m ? ([0, 1] as const).map((n) => ({ phase: m.lfoPhase(n), bpm: m.lfoBpm(n) })) : null; },
  /** The jog mode, VINYL or CD (the switch on each player). */
  jogMode: (side: Side, mode: JogMode) => panel?.jogs[side].setMode(mode),
  /** The close-up's zoom, an index into ZOOMS (0 is closest, a quarter second either side). */
  zoom: (i: number) => panel?.zoom(i),
  /** A scratch: touch the platter, move it `turns` (1.8 s a turn, back when negative) in `steps` moves `ms` apart, let go. Resolves to where the deck ended up. */
  scratch: async (side: Side, turns: number, steps = 8, ms = 16) => {
    const j = panel?.jogs[side];
    if (!j) return null;
    j.touch(true);
    for (let i = 0; i < steps; i++) { j.turn("top", turns / steps); await new Promise((r) => setTimeout(r, ms)); }
    const pos = panel!.decks.decks[side].pos();
    j.touch(false);
    return pos;
  },
  /** Hold or let go of the top platter, and turn a part of the wheel, as a hand (or a MIDI jog) does. */
  touch: (side: Side, on: boolean) => panel?.jogs[side].touch(on),
  turn: (side: Side, part: JogPart, turns: number) => panel?.jogs[side].turn(part, turns),
  /** The nudge: a tap back (-1) or on (1) moves the deck the nudge amount; `hold` the 10x nudge (0 lets go). */
  nudge: (side: Side, dir: -1 | 1) => panel?.nudge(side, "tap", dir),
  nudgeHold: (side: Side, dir: -1 | 0 | 1) => panel?.nudge(side, "hold", dir),
  /** The DJ's settings (prefs.ts: nudgeMs, wave, grab, the locks, keys), changed by `to` when given. */
  prefs: (to?: Partial<Prefs>) => panel?.prefs(to) ?? null,
  /** Press cue down or let it go (the big CUE button). */
  cue: (side: Side, down: boolean) => panel?.press(side, down ? "cueDown" : "cueUp"),
  /** A knob on deck `side`'s own channel (A is channel 2, B channel 3). */
  knob: (side: Side, k: ChannelKnob, v: number) => panel?.decks.knob(side, k, v),
  /** Channel `ch` (0 to 3): a knob or fader, the cue, the filter assign (0 off, 1, 2), the crossfader assign. */
  channel: (ch: Ch, k: ChannelKnob, v: number) => mx()?.set(ch, k, v),
  /** Channel `ch` in the headphones (its cue button), on or off. */
  pfl: (ch: Ch, on: boolean) => mx()?.cue(ch, on),
  assignFilter: (ch: Ch, n: 0 | 1 | 2) => mx()?.assignFilter(ch, n),
  assignX: (ch: Ch, a: XAssign) => mx()?.assignX(ch, a),
  /** Filter `n` (0 or 1): on, types (hp, bp, lp), freq, res, depth (0 to 1), beats, bpm. */
  filter: (n: 0 | 1, to: Partial<FilterState>) => mx()?.filter(n, to),
  tap: (n: 0 | 1) => mx()?.tap(n, performance.now()),
  curve: (c: Curve) => mx()?.setCurve(c),
  master: (v: number) => mx()?.setMaster(v),
  booth: (v: number) => mx()?.setBooth(v),
  phones: (v: number) => mx()?.setPhones(v),
  cueBlend: (v: number) => mx()?.setCueBlend(v),
  split: (on: boolean) => mx()?.setSplit(on),
  /** MIDI (midi.ts): show(on) the connections, controls() to pair, learn(id), feed(device, bytes) a message as that controller sends it, plug(device, on), clear(device, key). */
  midi: {
    show: (on: boolean) => panel?.midi.show(on),
    controls: () => panel?.midi.controls() ?? [],
    learn: (id: string | null) => panel?.midi.learn(id) ?? null,
    feed: (device: string, data: number[]) => panel?.midi.feed(device, data),
    plug: (device: string, on: boolean) => panel?.midi.plug(device, on),
    clear: (device: string, key: string) => panel?.midi.clear(device, key) ?? false,
  },
};
window.qdecks = harness;
