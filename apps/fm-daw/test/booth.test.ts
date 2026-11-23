// The DJ booth (src/dj/booth.ts) on a back-to-back night: one DJ loads a track and its key is read from the sound;
// what's on the deck goes over the live line, through the World's guard, to the other DJ, who sees it move on the
// room's shared clock, presses it, and can't load over it while it plays. And a tap on the 3D deck finds its key.
import { expect, test } from "bun:test";
import { camelot, keyOf } from "../src/dj/analyze.ts";
import { Booth, changed, deckKeyAt, DECK_KEYS, posAt, sayOf, waveFrom, waveOf, type DeckSay } from "../src/dj/booth.ts";
import type { DeckState } from "../src/dj/engine.ts";
import { decodeClient, decodeServer } from "../src/project.ts";

const RATE = 22050;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Chords (MIDI notes), two seconds each, as sine tones with an octave below the root. */
function chords(list: number[][]): Float32Array {
  const each = RATE * 2, out = new Float32Array(each * list.length);
  list.forEach((c, k) => { for (let i = 0; i < each; i++) { let v = 0; for (const n of [...c, c[0]! - 12]) v += Math.sin((2 * Math.PI * hz(n) * i) / RATE); out[k * each + i] = (v / (c.length + 1)) * 0.6; } });
  return out;
}

test("a track's key is read from its sound, and named on the DJ's wheel", () => {
  const read = [
    { song: chords([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]]), want: "8B C" },     // C F G C
    { song: chords([[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]]), want: "8A Am" },    // Am Dm E Am
    { song: chords([[64, 67, 71], [57, 60, 64], [59, 63, 66], [64, 67, 71]]), want: "9A Em" },    // Em Am B Em
    { song: chords([[62, 66, 69], [67, 71, 74], [69, 73, 76], [62, 66, 69]]), want: "10B D" },    // D G A D
  ].map(({ song, want }) => { const k = keyOf(song, RATE); return { want, got: k ? `${k.camelot} ${k.name}` : null }; });
  expect(read.map((r) => r.got)).toEqual(read.map((r) => r.want));
  expect(keyOf(new Float32Array(RATE * 8), RATE)).toBeNull();
  // every major key's relative minor shares its number
  for (let t = 0; t < 12; t++) expect(camelot((t + 9) % 12, true).slice(0, -1)).toBe(camelot(t, false).slice(0, -1));
});

const deck = (o: Partial<DeckState> = {}): DeckState => ({
  name: "Night Drive", playing: false, pos: 0, length: 300, rate: 1, pitch: 0, range: 8, bpm: 124, grid: { bpm: 124, offset: 0.2 },
  key: { tonic: 9, minor: true, name: "Am", camelot: "8A" }, cue: 0.2, hot: [null, null, null, null], loop: null, synced: false, ...o,
});
/** A live event from the page, through the World's guard, and out to everyone else. */
function overTheLine(e: DeckSay | { t: "press"; to: number; side: 0 | 1; press: "play" }) {
  const sent = decodeClient(JSON.parse(JSON.stringify({ t: "live", e })));
  if (sent?.t !== "live") throw new Error("the World refused it");
  const got = decodeServer(JSON.parse(JSON.stringify({ t: "live", from: 4, e: sent.e })));
  if (got?.t !== "live") throw new Error("the page refused it");
  return got.e;
}

test("back to back: the other DJ sees your deck move on the room's clock, presses it, and can't load over it while it plays", () => {
  const wave = waveOf(Float32Array.from({ length: 600 }, (_, i) => (i % 50) / 50));
  expect(waveFrom(wave).length).toBe(120);
  // DJ 4 loads deck A, cues it and plays at 10:00:00 on the room's clock
  const t0 = 1_800_000_000_000;
  const cued = sayOf(0, deck(), wave, t0), playing = sayOf(0, deck({ playing: true, pos: 0.2, rate: 1.02 }), wave, t0 + 50);
  expect(changed(cued, playing)).toBe(true);
  expect(changed(playing, sayOf(0, deck({ playing: true, pos: 0.2 + 2 * 1.02, rate: 1.02 }), wave, t0 + 2050))).toBe(false);
  expect(changed(playing, sayOf(0, deck({ playing: true, pos: 64, rate: 1.02 }), wave, t0 + 2050))).toBe(true); // a hot cue jump

  const b2b = new Booth(), e = overTheLine(playing);
  if (e.t !== "deck") throw new Error("not a deck");
  expect(b2b.heard(4, e, 0, false)).toBe(false);
  expect(b2b.owner(0)).toBe(4);
  expect(b2b.sides[0]?.say.key).toEqual({ name: "Am", camelot: "8A" });
  // ten seconds on, on the shared clock, it's ten seconds (at its rate) further in
  expect(posAt(b2b.sides[0]!.say, t0 + 50 + 10_000)).toBeCloseTo(0.2 + 10 * 1.02, 6);
  expect(b2b.mayLoad(0).ok).toBe(false);
  expect(b2b.mayLoad(1).ok).toBe(true);
  // a press goes to its player; a bad shape doesn't get past the World
  expect(overTheLine({ t: "press", to: 4, side: 0, press: "play" })).toEqual({ t: "press", to: 4, side: 0, press: "play" });
  expect(decodeClient({ t: "live", e: { ...playing, side: 2 } })).toBeNull();
  expect(decodeClient({ t: "live", e: { t: "press", to: 4, side: 0, press: "eject" } })).toBeNull();
  // stopped, it can be loaded over; and when they load onto a deck you have, yours comes off
  b2b.heard(4, { ...e, playing: false }, 1, false);
  expect(b2b.mayLoad(0).ok).toBe(true);
  expect(b2b.heard(5, { ...e, side: 1 }, 2, true)).toBe(true);
  // they unload, or leave, or go quiet: the deck is free
  b2b.heard(4, { ...e, name: null }, 3, false);
  expect(b2b.owner(0)).toBeNull();
  b2b.gone(5);
  expect(b2b.owner(1)).toBeNull();
});

test("a tap on the 3D deck finds the key under it", () => {
  const k = DECK_KEYS;
  expect([deckKeyAt(...k.play), deckKeyAt(...k.cue), deckKeyAt(k.hot.x0 + 2 * k.hot.gap, k.hot.z), deckKeyAt(0, k.jog.z + 0.05), deckKeyAt(0, k.screen.z - 0.03), deckKeyAt(0.16, 0.22)])
    .toEqual(["play", "cueDown", "hot3", "jog", "screen", null]);
});
