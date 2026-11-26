// Song mode (src/song.ts): the loop as a chain of patterns, an edit in one copy landing in all of them.
import { expect, test } from "bun:test";
import { heard, setup, useWorld } from "./world-kit.ts";
import { apply, decodeOp, decodeServer, sanitize, type Note, type Project } from "../src/project.ts";
import { P, TRACKS } from "../src/engine/params.ts";
import { eqLane, flatEq } from "../src/engine/eq.ts";

useWorld();

const kick = (s: number): Note => ({ s, l: 0.25, m: 36, v: 0.8 });
const loop = (): Project => sanitize({ v: 1, bpm: 120, swing: 0, bars: 1, tracks: Array.from({ length: TRACKS }, (_, i) => ({ params: [], notes: i === 0 ? [kick(0), kick(2)] : [] })) })!;
const starts = (p: Project) => p.tracks[0].notes.map((n) => n.s);

test("a sesh in song mode: the loop becomes A, the chain lays it out, a note drawn in one A is in every A, and a joiner hears the same song", async () => {
  const { world, join } = await setup();
  const a = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project: loop() }));
  let p = loop();
  const send = (op: unknown) => { const o = decodeOp(op)!; p = apply(p, o); world.webSocketMessage(a, JSON.stringify({ t: "op", op: o })); };

  send({ t: "song", chain: [0, 1, 0] });                          // A, a new empty B, A again
  expect([p.bars, p.song, starts(p)]).toEqual([3, { bars: 1, chain: [0, 1, 0] }, [0, 2, 8, 10]]);

  send({ t: "notes", track: 0, notes: [...p.tracks[0].notes, kick(9)] });  // a kick drawn in the second A
  expect(starts(p)).toEqual([0, 1, 2, 8, 9, 10]);
  send({ t: "notes", track: 0, notes: [...p.tracks[0].notes, kick(5)] });  // and one in B: only B has it
  expect(starts(p)).toEqual([0, 1, 2, 5, 8, 9, 10]);

  send({ t: "global", bars: 8 });                                  // the chain sets the length, not the bar buttons
  expect(p.bars).toBe(3);

  const b = (await join()).ws;
  const got = decodeServer((await heard(b, "snapshot")));
  expect(got?.t === "snapshot" && got.project).toEqual(p);

  send({ t: "song", chain: null });                                // leaving song mode keeps the notes as they stand
  expect([p.song, p.bars, starts(p)]).toEqual([undefined, 3, [0, 1, 2, 5, 8, 9, 10]]);
});

test.each([
  ["a chain past the longest loop is turned away", Array<number>(64).fill(0), 32],
  ["dropping the last slot lets what was in it go", [0], 16],
])("%s", (_, chain, bars) => {
  const song = apply(apply(loop(), { t: "global", bars: 16 }), { t: "song", chain: [0, 0] });
  expect(apply(song, { t: "song", chain }).bars).toBe(bars);
});

test("a song that doesn't fit its loop, or of the wrong shape, is left out; an empty chain isn't an edit", () => {
  const p = apply(loop(), { t: "song", chain: [0, 0] });
  expect(sanitize({ ...p, bars: 3 })?.song).toBeUndefined();
  expect(sanitize({ ...p, song: { bars: 1, chain: [9] } })?.song).toBeUndefined();
  expect(sanitize(p)?.song).toEqual({ bars: 1, chain: [0, 0] });
  expect(decodeOp({ t: "song", chain: [] })).toBeNull();
});

test("automation follows the patterns: a filter sweep and a Shape move drawn in one A play in every A, and a joiner hears them", async () => {
  const { world, join } = await setup();
  const a = (await join()).ws;
  let p = sanitize({ ...loop(), eq: flatEq().map((_, i) => (i === 0 ? { kind: "bell", f: 1000, g: 0, q: 0.707, slope: 12, on: true } : null)) })!;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project: p }));
  const send = (op: unknown) => { const o = decodeOp(op)!; p = apply(p, o); world.webSocketMessage(a, JSON.stringify({ t: "op", op: o })); };
  const sweep = (from: number, lo = 0.2, hi = 0.9) => [[from, lo], [from + 3, hi]];

  send({ t: "auto", track: 0, lanes: [{ i: P.CUTOFF, pts: sweep(0) }] }); // a sweep on the loop, before song mode
  send({ t: "song", chain: [0, 1, 0] });                                  // it becomes A's: the new B has none
  expect(p.tracks[0].auto).toEqual([{ i: P.CUTOFF, pts: [...sweep(0), ...sweep(8)] }]);

  // the second A redrawn flat, and a point put in B: every A takes the new line, only B has the point
  send({ t: "auto", track: 0, lanes: [{ i: P.CUTOFF, pts: [...sweep(0), [5, 0.5], ...sweep(8, 0.4, 0.4)] }] });
  expect(p.tracks[0].auto).toEqual([{ i: P.CUTOFF, pts: [...sweep(0, 0.4, 0.4), [5, 0.5], ...sweep(8, 0.4, 0.4)] }]);

  const gain = eqLane(0, "g");
  send({ t: "eqAuto", lanes: [{ i: gain, pts: [[8.5, -12]] }] });        // Shape's dip drawn in the second A
  expect(p.eqAuto).toEqual([{ i: gain, pts: [[0.5, -12], [8.5, -12]] }]);

  const b = (await join()).ws;
  const got = decodeServer((await heard(b, "snapshot")));
  expect(got?.t === "snapshot" && got.project).toEqual(p);
});
