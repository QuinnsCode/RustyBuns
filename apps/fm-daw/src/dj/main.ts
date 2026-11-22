// The decks on their own page (/decks.html): practise a mix before the party. The audio starts on the first press (a
// browser wants a gesture), then the decks open with the demo tracks on them. `qdecks` is the harness for probes.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountDecks, type DecksPanel } from "./panel.ts";
import type { Side } from "./engine.ts";

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
  state: () => panel ? { open: panel.isOpen(), library: panel.library(), ...panel.decks.state(), master: panel.decks.level(2) } : null,
  play: (side: Side) => panel?.decks.decks[side].toggle(),
  sync: (side: Side) => panel?.decks.sync(side) ?? false,
  cross: (x: number) => panel?.decks.cross(x),
  loop: (side: Side, beats: number | null) => panel?.decks.decks[side].setLoop(beats),
  hot: (side: Side, i: number) => panel?.decks.decks[side].hotCue(i, true),
  pitch: (side: Side, p: number) => panel?.decks.decks[side].setPitch(p),
  knob: (side: Side, k: "trim" | "low" | "mid" | "high" | "filter" | "fader", v: number) => panel?.decks.knob(side, k, v),
};
window.qdecks = harness;
