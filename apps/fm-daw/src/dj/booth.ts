// The booth: the two decks as everyone in the room sees them, so a DJ playing back to back with you sees what you
// loaded, where it is and what's cued, and can press its buttons. A deck plays from the machine of whoever loaded
// it (the file never leaves it): that player says what's on it on the live line (`deck`: the track's name, length,
// beat grid, key and a 120-bar waveform, the cue, playing or not, and where it was at a time on the room's shared
// clock), again on every change and every two seconds. Everyone else works out where it is now from that and the
// clock. A press on someone else's deck (`press`) goes to its player, whose machine does it; the World lets a press
// through only from someone with the play grant, as it does a note. Loading onto a deck someone else has is fine
// while it's stopped, and theirs goes; while it plays, it's theirs.
// Pure, no DOM: the World's guards (project.ts), the page and the tests share it.
import { b64url, unb64url } from "@rustybuns/util/bytes";
import { bool, int, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import type { DeckState, Side } from "./engine.ts";

/** The waveform the room sees of a deck: this many bars, one byte each. */
export const WAVE_BARS = 120;
/** A deck's state goes out at least this often while it has a track, ms, so someone who just came in sees it. */
export const SAY_EVERY_MS = 2000;
/** A deck nobody has spoken for in this long is free again (its player's machine went quiet), ms. */
export const STALE_MS = 9000;

/** What someone may press on a deck that plays on another machine. `seek` jumps to `x` of the way through. */
export const PRESSES = ["play", "cueDown", "cueUp", "sync", "hot1", "hot2", "hot3", "hot4", "back", "fwd", "seek"] as const;
export type Press = (typeof PRESSES)[number];
const HOTS = ["hot1", "hot2", "hot3", "hot4"] as const;
/** Hot cue `press`'s number (0 to 3), or -1 when it isn't one. */
export const hotOf = (press: Press) => HOTS.findIndex((h) => h === press);

const tag = <T extends string>(t: T) => oneOf([t]);
const SIDE = oneOf([0, 1] as const);
const SECS = num(0, 6 * 3600);
/** A reading of the room's shared clock, ms (the leader's time, src/clock.ts). */
const MS = num(0, 1e15);

/** A deck's player says what's on it. `at`: when `pos` was true, on the room's shared clock. */
export const DeckSay = obj({
  t: tag("deck"), side: SIDE, name: nul(str(120, { min: 0 })), len: SECS,
  grid: nul(obj({ bpm: num(20, 400), offset: num(-60, 6 * 3600) })),
  key: nul(obj({ name: str(4, { min: 1 }), camelot: str(3, { re: /^(1[0-2]|[1-9])[AB]$/ }) })),
  wave: str(Math.ceil((WAVE_BARS * 4) / 3), { min: 0, re: /^[A-Za-z0-9_-]*$/ }),
  cue: SECS, playing: bool(), pos: SECS, rate: num(0.1, 4), at: MS,
});
export type DeckSay = Of<typeof DeckSay>;
/** Someone presses a button on `to`'s deck. */
export const DeckPress = obj({ t: tag("press"), to: int(1, Infinity), side: SIDE, press: oneOf(PRESSES), x: opt(num(0, 1)) });
export type DeckPress = Of<typeof DeckPress>;

/** A waveform (peaks 0..1, any length) as the room carries it: WAVE_BARS bytes. */
export function waveOf(peaks: Float32Array): string {
  const out = new Uint8Array(WAVE_BARS);
  for (let b = 0; b < WAVE_BARS; b++) {
    const a = Math.floor((b * peaks.length) / WAVE_BARS), z = Math.max(a + 1, Math.floor(((b + 1) * peaks.length) / WAVE_BARS));
    let m = 0;
    for (let i = a; i < z && i < peaks.length; i++) m = Math.max(m, peaks[i]!);
    out[b] = Math.round(Math.min(1, m) * 255);
  }
  return b64url(out);
}
/** The waveform back, 0..1 a bar. */
export function waveFrom(s: string): Float32Array {
  if (!s) return new Float32Array(0);
  try { return Float32Array.from(unb64url(s), (v) => v / 255); } catch { return new Float32Array(0); }
}

/** What a deck here says to the room, from its state, the waveform it already has, and the shared clock now. */
export function sayOf(side: Side, s: DeckState, wave: string, now: number): DeckSay {
  return {
    t: "deck", side, name: s.name, len: s.length, grid: s.grid, key: s.key ? { name: s.key.name, camelot: s.key.camelot } : null,
    wave: s.name ? wave : "", cue: s.cue, playing: s.playing, pos: s.pos, rate: s.rate, at: now,
  };
}

/** Whether a new say is worth sending: the deck changed in a way the room sees, beyond time passing. */
export function changed(a: DeckSay | null, b: DeckSay): boolean {
  if (!a) return true;
  if (a.name !== b.name || a.playing !== b.playing || Math.abs(a.cue - b.cue) > 0.005 || Math.abs(a.rate - b.rate) > 0.0005) return true;
  if (a.key?.camelot !== b.key?.camelot || a.grid?.bpm !== b.grid?.bpm) return true;
  // a jump (a hot cue, a seek, a loop going round): where it is now is not where the last say has it
  const expect = a.playing ? a.pos + ((b.at - a.at) / 1000) * a.rate : a.pos;
  return Math.abs(expect - b.pos) > 0.08;
}

/** Where a said deck is at `now` on the shared clock, seconds into its track. */
export function posAt(s: DeckSay, now: number): number {
  const p = s.playing ? s.pos + (Math.max(0, now - s.at) / 1000) * s.rate : s.pos;
  return Math.min(s.len, Math.max(0, p));
}

/** A deck as a screen shows it (the panel, the 3D booth), here or someone else's. */
export interface DeckView { name: string | null; who: string | null; bpm: number | null; key: string | null; pos: number; len: number; playing: boolean; cue: number; wave: Float32Array }
/** Someone else's deck as a screen shows it, at `now` on the shared clock. */
export function farView(t: Theirs, now: number, who: string, wave: Float32Array): DeckView {
  const s = t.say;
  return { name: s.name, who, bpm: s.grid ? Math.round(s.grid.bpm * s.rate * 10) / 10 : null, key: s.key ? `${s.key.camelot} ${s.key.name}` : null, pos: posAt(s, now), len: s.len, playing: s.playing, cue: s.cue, wave };
}

/** A deck someone else plays, as heard: who, what they last said, and when it came (this page's clock). */
export interface Theirs { owner: number; say: DeckSay; got: number }

/** The decks other players have, side by side. */
export class Booth {
  readonly sides: [Theirs | null, Theirs | null] = [null, null];

  /**
   * `from` said what's on their deck. Returns true when it takes that side from this page (they loaded onto a deck
   * you had): unload yours.
   */
  heard(from: number, e: DeckSay, got: number, mine: boolean): boolean {
    if (!e.name) { if (this.sides[e.side]?.owner === from) this.sides[e.side] = null; return false; }
    this.sides[e.side] = { owner: from, say: e, got };
    return mine;
  }
  /** They left: their decks go. */
  gone(peer: number) { for (const s of [0, 1] as const) if (this.sides[s]?.owner === peer) this.sides[s] = null; }
  /** Drop decks whose player went quiet. */
  sweep(got: number) { for (const s of [0, 1] as const) { const t = this.sides[s]; if (t && got - t.got > STALE_MS) this.sides[s] = null; } }
  owner(side: Side): number | null { return this.sides[side]?.owner ?? null; }
  /** Whether this page may load onto `side`: it's free, or someone else's track there is stopped. */
  mayLoad(side: Side): { ok: true } | { ok: false; why: string } {
    const t = this.sides[side];
    return !t || !t.say.playing ? { ok: true } : { ok: false, why: `Deck ${side ? "B" : "A"} is playing ${t.say.name ?? "a track"}: wait for it to stop, or use the other deck` };
  }
}

/** A key on the keyboard (while the decks are open) as a press: Q/P play, W/O cue, 1 to 4 and 7 to 0 the hot cues. */
export function keyPress(code: string): { side: Side; press: Press } | null {
  if (code === "KeyQ" || code === "KeyP") return { side: code === "KeyQ" ? 0 : 1, press: "play" };
  if (code === "KeyW" || code === "KeyO") return { side: code === "KeyW" ? 0 : 1, press: "cueDown" };
  const a = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(code), b = ["Digit7", "Digit8", "Digit9", "Digit0"].indexOf(code);
  if (a >= 0) return { side: 0, press: HOTS[a]! };
  if (b >= 0) return { side: 1, press: HOTS[b]! };
  return null;
}

/**
 * Where the keys sit on the media deck model (packages/models gear.ts, `deckMedia`), in its own frame: metres across
 * (x, the DJ's right +) and toward the DJ (z +). Play and cue are the big round keys at the bottom left, the four hot
 * cues across the top of the jog, the screen above them.
 */
export const DECK_KEYS = {
  size: [0.329, 0.453], play: [-0.1295, 0.1965], cue: [-0.1295, 0.1515], round: 0.022,
  hot: { z: -0.09, x0: -0.07, gap: 0.047, half: [0.02, 0.012] }, jog: { z: 0.045, r: 0.11 }, screen: { z: -0.142, half: [0.085, 0.053] },
} as const;

/** What a touch at (x, z) on a media deck's top presses: a key, the jog, the screen (opens the decks), or nothing. */
export function deckKeyAt(x: number, z: number): Press | "jog" | "screen" | null {
  const k = DECK_KEYS, near = (p: readonly [number, number]) => Math.hypot(x - p[0], z - p[1]) <= k.round;
  if (near(k.play)) return "play";
  if (near(k.cue)) return "cueDown";
  for (let i = 0; i < 4; i++) if (Math.abs(x - (k.hot.x0 + i * k.hot.gap)) <= k.hot.half[0] && Math.abs(z - k.hot.z) <= k.hot.half[1]) return HOTS[i]!;
  if (Math.abs(x) <= k.screen.half[0] && Math.abs(z - k.screen.z) <= k.screen.half[1]) return "screen";
  if (Math.hypot(x, z - k.jog.z) <= k.jog.r) return "jog";
  return null;
}
