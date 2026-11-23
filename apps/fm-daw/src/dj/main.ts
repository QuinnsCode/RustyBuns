// The decks on their own page (/decks.html): practise a mix before the party. The audio starts on the first press (a
// browser wants a gesture), then the decks open with the demo tracks on them. `qdecks` is the harness for probes.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountDecks, type DecksPanel } from "./panel.ts";
import type { Side } from "./engine.ts";
import type { JogMode, JogPart } from "./player.ts";

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
const harness = {
  /** Open the decks with the demo tracks (the probe has no gesture; headless Chrome lets audio start anyway). */
  start: () => { start(); return harness.state(); },
  state: () => panel ? { open: panel.isOpen(), library: panel.library(), ...panel.decks.state(), master: panel.decks.level(2), players: panel.jogs.map((j) => j.state()), zoom: panel.zoom() } : null,
  /** Load a file's bytes onto a deck as a dropped file would: its tempo and where that came from (tag, software grid, ear). */
  load: async (side: Side, name: string, bytes: number[]) => { const t = await start().load(side, name, Uint8Array.from(bytes).buffer); return { bpm: t.grid?.bpm ?? null, firstBeat: t.grid?.offset ?? null, from: t.from ?? null }; },
  play: (side: Side) => panel?.decks.decks[side].toggle(),
  sync: (side: Side) => panel?.decks.sync(side) ?? false,
  cross: (x: number) => panel?.decks.cross(x),
  loop: (side: Side, beats: number | null) => panel?.decks.decks[side].setLoop(beats),
  hot: (side: Side, i: number) => panel?.decks.decks[side].hotCue(i, true),
  pitch: (side: Side, p: number) => panel?.decks.decks[side].setPitch(p),
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
  /** Press cue down or let it go (the big CUE button). */
  cue: (side: Side, down: boolean) => panel?.press(side, down ? "cueDown" : "cueUp"),
  knob: (side: Side, k: "trim" | "low" | "mid" | "high" | "filter" | "fader", v: number) => panel?.decks.knob(side, k, v),
};
window.qdecks = harness;
