// The decks on their own page (/decks.html): practise a mix before the party. The audio starts on the first press (a
// browser wants a gesture), then the decks open with the demo tracks on them. `qdecks` is the harness for probes.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountDecks, type DecksPanel } from "./panel.ts";
import type { Side } from "./engine.ts";
import type { Ch, ChannelKnob, Curve, FilterState, XAssign } from "./mixer.ts";

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
  /** The decks, then the mixer (mixer.ts's MixerState), then what the meters read now (0 to 1). */
  state: () => {
    if (!panel) return null;
    const m = panel.decks.mixer;
    return { open: panel.isOpen(), library: panel.library(), ...panel.decks.state(), meters: { channels: m.channels.map((_, i) => m.level(i as Ch)), master: m.masterLevels() } };
  },
  play: (side: Side) => panel?.decks.decks[side].toggle(),
  sync: (side: Side) => panel?.decks.sync(side) ?? false,
  cross: (x: number) => panel?.decks.cross(x),
  loop: (side: Side, beats: number | null) => panel?.decks.decks[side].setLoop(beats),
  hot: (side: Side, i: number) => panel?.decks.decks[side].hotCue(i, true),
  pitch: (side: Side, p: number) => panel?.decks.decks[side].setPitch(p),
  /** A knob on deck `side`'s own channel (A is channel 2, B channel 3). */
  knob: (side: Side, k: ChannelKnob, v: number) => panel?.decks.knob(side, k, v),
  /** Channel `ch` (0 to 3): a knob or fader, the cue, the filter assign (0 off, 1, 2), the crossfader assign. */
  channel: (ch: Ch, k: ChannelKnob, v: number) => mx()?.set(ch, k, v),
  cue: (ch: Ch, on: boolean) => mx()?.cue(ch, on),
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
};
window.qdecks = harness;
