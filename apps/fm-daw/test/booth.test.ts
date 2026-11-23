// The DJ booth (src/dj/booth.ts) on a back-to-back night: one DJ loads a track and its key is read from the sound;
// what's on the deck goes over the live line, through the World's guard, to the other DJ, who sees it move on the
// room's shared clock, presses it, scratches it from their own jog wheel, and can't load over it while it plays.
// And a tap on the 3D deck finds its key, and a tap anywhere else on the table opens the whole setup.
import { expect, test } from "bun:test";
import { camelot, keyOf } from "../src/dj/analyze.ts";
import { Booth, changed, deckKeyAt, DECK_KEYS, JOG_HELD_MS, JOG_SEND_MS, JogOut, posAt, sayOf, waveFrom, waveOf, type DeckPress, type DeckSay, type JogSent } from "../src/dj/booth.ts";
import type { DeckState } from "../src/dj/engine.ts";
import { BoothGear } from "../src/studio/booth-3d.ts";
import * as THREE from "three";
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
function overTheLine(e: DeckSay | DeckPress) {
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

test("a click anywhere on the DJ table opens the decks; a key on a deck still presses", () => {
  // deck A, the mixer and deck B side by side on a table, looked at from straight above
  const k = DECK_KEYS, gear = new BoothGear(), table = new THREE.Group();
  const slab = (w: number, d: number, x: number, y: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d)); m.position.set(x, y, 0); table.add(m); return m; };
  const deckAt = [-0.36, 0.36] as const;
  const decks = deckAt.map((x) => { const g = new THREE.Group(); g.position.set(x, 0.9, 0); g.add(new THREE.Mesh(new THREE.BoxGeometry(k.size[0], 0.06, k.size[1]).translate(0, -0.03, 0))); table.add(g); return g; });
  const mixer = slab(0.32, 0.36, 0, 0.89), top = slab(1.2, 0.6, 0, 0.85);
  table.updateMatrixWorld(true);
  decks.forEach((g, side) => gear.add(g, side === 0 ? 0 : 1));
  gear.addRest(mixer); gear.addRest(top);
  const tap = (x: number, z: number) => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    cam.position.set(x, 1.8, z); cam.lookAt(x, 0, z); cam.updateMatrixWorld(true);
    return gear.hit(new THREE.Vector2(0, 0), cam);
  };
  expect([tap(deckAt[0] + k.play[0], k.play[1]), tap(deckAt[1] + k.play[0], k.play[1]), tap(0, 0), tap(0.58, 0.25), tap(deckAt[0] + 0.15, 0.21), tap(3, 3)])
    .toEqual([{ side: 0, key: "play" }, { side: 1, key: "play" }, { side: 0, key: "open" }, { side: 0, key: "open" }, { side: 0, key: "open" }, null]);
});

test("a scratch on the other DJ's deck: the platter held, a second of turns at 60 a frame sent in batches, let go", () => {
  const sent: JogSent[] = [], at: number[] = [];
  let now = 1000;
  const out = new JogOut((j) => { sent.push(j); at.push(now); });
  out.touch(true, now);
  // a second of scratching back and forth, a move every frame
  let total = 0;
  for (let f = 0; f < 60; f++) { now += 1000 / 60; const t = Math.sin(f / 6) * 0.02; total += t; out.turn("top", t, now); out.tick(now); }
  now += 20; out.tick(now); now += 40; out.tick(now);
  out.touch(false, now);
  expect(sent[0]).toEqual({ part: "top", touch: true });
  expect(sent.at(-1)).toEqual({ part: "top", touch: false });
  const turns = sent.filter((j) => j.turns !== undefined);
  expect(turns.length).toBeLessThanOrEqual(1000 / JOG_SEND_MS + 1);
  expect(turns.reduce((a, j) => a + j.turns!, 0)).toBeCloseTo(total, 9);
  for (let i = 1; i < at.length - 1; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(JOG_SEND_MS - 1e-9);
  // held still, it says it's still held, so its player doesn't let go
  out.touch(true, now); const n = sent.length;
  now += JOG_HELD_MS; out.tick(now);
  expect(sent.slice(n)).toEqual([{ part: "top", touch: true }]);

  // each goes through the World as a press for the deck's player; a wheel that isn't one doesn't
  const jog: DeckPress = { t: "press", to: 4, side: 1, press: "jog", mode: "vinyl", ...turns[0]! };
  expect(overTheLine(jog)).toEqual(jog);
  expect(decodeClient({ t: "live", e: { ...jog, part: "rim" } })).toBeNull();
  expect(decodeClient({ t: "live", e: { ...jog, turns: 500 } })).toBeNull();
});
