// Q Amp's live chain (src/amp/live.ts, what the audio thread runs): play the riff
// in 128-sample blocks while someone works the front panel, the way the page does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { cutPoints, planCuts } from "@rustybuns/gear/circuit";
import { FULL_SCALE, applySettings, chainLoads, limit, rigSpec, type Live } from "../src/amp/live.ts";
import type { AmpSettings, ChainSlot, ToPart } from "../src/amp/messages.ts";
import { Head, Ring } from "../src/amp/ring.ts";
import { partsFor } from "../src/amp/threads.ts";
import { audibleChains, compile, seriesCables, type Cable, type Patch } from "../src/circuit/patch.ts";
import { cabledChain, relay } from "../src/amp/cabled.ts";

setDefaultTimeout(30_000);
const SR = 48000, BLOCK = 128;

test("working the knobs while the riff plays: rebuilds only what moved, never past -1 dBFS", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "lead", pedal: null, drive: 3, knobs: { ...AMPS[1].knobs }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  let live: Live = applySettings(s, null, SR);
  let at = 0, peak = 0;
  const out = new Float32Array(BLOCK);
  const play = (blocks: number) => {
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live.rig.process(dry.subarray(at, at + BLOCK), out, BLOCK);
      for (const v of out) peak = Math.max(peak, Math.abs(limit(v / FULL_SCALE)));
    }
  };
  // Each move, and whether it should build a whole new chain.
  const moves: [string, Partial<AmpSettings>, boolean][] = [
    ["gain up", { knobs: { ...s.knobs, gain: 10 } }, false],
    ["treble down", { knobs: { ...s.knobs, gain: 10, treble: 1 } }, false],
    ["master up", { knobs: { ...s.knobs, gain: 10, treble: 1, master: 10 } }, false],
    ["noise up", { knobs: { ...s.knobs, gain: 10, treble: 1, master: 10, noise: 8 } }, false],
    ["mic to the edge, off axis", { mic: { at: 1, angle: 60 } }, false],
    ["Q Fuzz on", { pedal: "fuzz" }, true],
    ["Q Drive instead", { pedal: "drive" }, true],
    ["its Drive up", { drive: 10 }, false],
    ["germanium in its clipper socket", { swaps: { D1: "germanium" } }, false],
    ["Q Triple", { amp: "triple", knobs: { ...AMPS[2].knobs } }, true],
    ["Q Clean T", { amp: "clean", knobs: { ...AMPS[3].knobs } }, true],
    ["its trem faster and deeper", { knobs: { ...AMPS[3].knobs, rate: 9, depth: 10 } }, false],
    ["Eco", { oversample: 2 }, true],
    ["Q Dist instead", { pedal: "dist" }, true],
  ];
  play(40);
  for (const [what, change, fresh] of moves) {
    const before = live.rig;
    s = Object.assign({}, s, change); // a new object each move, so applySettings sees what changed
    live = applySettings(s, live, SR);
    expect([what, live.rig !== before]).toEqual([what, fresh]);
    play(40);
    expect([what, live.rig.misses]).toEqual([what, 0]);
  }
  expect(live.rig.oversample).toBe(2);
  expect(peak).toBeGreaterThan(0.3);
  expect(peak).toBeLessThanOrEqual(0.89);
  expect(limit(Number.NaN)).toBe(0);
});

test("the effects loop: machines switched and turned while the riff plays, then their tails ring on in the silence", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "brit", pedal: null, drive: 0, knobs: { ...AMPS[0].knobs, noise: 0 }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  let live: Live = applySettings(s, null, SR);
  const amp = live.rig;
  const out = new Float32Array(BLOCK), quiet = new Float32Array(BLOCK);
  let at = 0, peak = 0;
  const play = (blocks: number, src = dry) => {
    let ss = 0;
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live.rig.process(src === dry ? dry.subarray(at, at + BLOCK) : quiet, out, BLOCK);
      for (const v of out) { const y = limit(v / FULL_SCALE); peak = Math.max(peak, Math.abs(y)); ss += y * y; }
    }
    return Math.sqrt(ss / (blocks * BLOCK));
  };
  const tail = () => { play(10, quiet); return play(60, quiet); }; // skip the amp's own ring-down, then listen
  play(100);
  const ampTail = tail();
  const moves: [string, AmpSettings["loop"]][] = [
    ["spring on", [{ kind: "spring", dwell: 5, mix: 6 }]],
    ["tape in front of it", [{ kind: "tape", time: 3, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 5, mix: 6 }]],
    ["Time turned while it echoes", [{ kind: "tape", time: 8, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 10, mix: 6 }]],
    ["chorus first", [{ kind: "bbd", mode: "chorus", rate: 4, depth: 6 }, { kind: "tape", time: 8, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 10, mix: 6 }]],
    ["tape off", [{ kind: "bbd", mode: "flanger", rate: 4, depth: 6 }, { kind: "spring", dwell: 10, mix: 6 }]],
  ];
  for (const [what, loop] of moves) {
    s = Object.assign({}, s, { loop });
    live = applySettings(s, live, SR);
    expect([what, live.rig === amp]).toEqual([what, true]); // the tubes are never rebuilt for the loop
    play(100);
    expect([what, live.rig.misses]).toEqual([what, 0]);
    expect([what, tail() > 10 * ampTail]).toEqual([what, true]);
  }
  expect(peak).toBeLessThanOrEqual(0.89);
  // All off: back to the dry amp's own silence.
  live = applySettings({ ...s, loop: [] }, live, SR);
  play(20);
  expect(tail()).toBeLessThan(2 * ampTail + 1e-6);
});

test("the Noise knob: silent at 0, a hiss through the tubes at 7", () => {
  const quiet = new Float32Array(SR / 2), out = new Float32Array(quiet.length);
  const floor = (noise: number) => {
    const live = applySettings({ amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs, noise }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } }, null, SR);
    live.rig.process(quiet, out);
    let ss = 0;
    for (let i = quiet.length / 2; i < quiet.length; i++) ss += (out[i] / FULL_SCALE) ** 2;
    return Math.sqrt(ss / (quiet.length / 2));
  };
  expect(floor(0)).toBeLessThan(1e-6);
  expect(floor(7)).toBeGreaterThan(0.01); // louder than −40 dBFS
});

test("a board over one thread's budget, split across workers: the one-thread sound, a block later per hop", async () => {
  const dry = riff(SR);
  // Q Drive and Q Fuzz into Q Lead 50 with the spring in its loop, 4×: over budget on one thread (#4948).
  const board: AmpSettings = { amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 }, board: [{ pedal: "drive", drive: 5 }, { pedal: "fuzz", drive: 7 }], loop: [{ kind: "spring", dwell: 5, mix: 6 }] };
  const turned: AmpSettings = { ...board, knobs: { ...board.knobs, gain: 9 }, board: [{ pedal: "drive", drive: 8 }, { pedal: "fuzz", drive: 7 }] };
  const BLOCKS = 120, TURN = 60;
  const block = (b: number) => dry.subarray(b * BLOCK, b * BLOCK + BLOCK);

  // One thread: the reference, and each slot's work to cut by.
  let one = applySettings(board, null, SR);
  const ref: Float32Array[] = [];
  for (let b = 0; b < BLOCKS; b++) {
    if (b === TURN) one = applySettings(turned, one, SR);
    const out = new Float32Array(BLOCK);
    one.rig.process(block(b), out, BLOCK);
    ref.push(out);
  }
  const measured = applySettings(board, null, SR).rig;
  measured.process(dry.subarray(0, 48 * BLOCK), new Float32Array(48 * BLOCK));
  const slots = measured.work(), total = slots.reduce((a, x) => a + x, 0);

  for (const parts of [2, 3]) {
    const cuts = planCuts(slots, parts, cutPoints(rigSpec(board).spec));
    expect(cuts.length).toBe(parts - 1);
    // The busiest part does well under the whole chain's work.
    const edges = [0, ...cuts, slots.length - 1];
    const shares = edges.slice(1).map((e, k) => slots.slice(edges[k], k === parts - 1 ? slots.length : e).reduce((a, x) => a + x, 0) / total);
    expect(Math.max(...shares)).toBeLessThan(parts === 2 ? 0.75 : 0.55);

    const rings = Array.from({ length: parts }, () => Ring.make().sab);
    const workers = cuts.map((_, i) => {
      const w = new Worker(new URL("../src/amp/part-worker.ts", import.meta.url).href);
      const start: ToPart = { t: "start", rings, index: i + 1, sampleRate: SR };
      w.postMessage(start);
      return w;
    });
    const head = new Head(SR);
    head.connect(rings);
    const play = (settings: AmpSettings, v: number) => {
      const m: ToPart = { t: "set", settings, v, cuts };
      head.set(m);
      for (const w of workers) w.postMessage(m);
    };
    play(board, 1);
    const out = new Float32Array(BLOCK);
    const heard: Float32Array[] = [];
    try {
      for (let b = 0; b < BLOCKS + cuts.length; b++) {
        if (b === TURN) play(turned, 2); // a knob and a pedal's Drive mid-riff: every part changes on the same block
        expect(head.block(b < BLOCKS ? block(b) : new Float32Array(BLOCK), out, BLOCK, 5000)).toBe(true);
        heard.push(out.slice());
      }
    } finally {
      for (const w of workers) w.terminate();
    }
    expect([parts, head.hops, head.late]).toEqual([parts, cuts.length, 0]);
    for (let b = 0; b < cuts.length; b++) expect(heard[b].every((x) => x === 0)).toBe(true);
    for (let b = 0; b < BLOCKS; b++) expect([parts, b, Array.from(heard[b + cuts.length])]).toEqual([parts, b, Array.from(ref[b])]);
  }
  expect(partsFor(0.5)).toBe(1);
  expect(partsFor(1.28)).toBe(3);
});

test("the pedalboard: pedals stacked, reordered and moved into the loop while the riff plays; stereo after Q Bucket; a load per slot", () => {
  const dry = riff(SR), quiet = new Float32Array(BLOCK);
  const base: AmpSettings = { amp: "brit", pedal: null, drive: 0, knobs: { ...AMPS[0].knobs, noise: 0 }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  const tape = { machine: { kind: "tape", time: 3, repeats: 5, mix: 5, heads: [1, 3] } } satisfies ChainSlot;
  const bucket: ChainSlot = { machine: { kind: "bbd", mode: "chorus", rate: 4, depth: 8 }, stereo: true };
  const drive = { pedal: "drive", drive: 3 } satisfies ChainSlot, fuzz: ChainSlot = { pedal: "fuzz", drive: 7 }, amp: ChainSlot = { amp: true };
  let live: Live | null = null;
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
  let at = 0, peak = 0;
  const play = (blocks: number, src: "riff" | "quiet" = "riff") => {
    let ss = 0, side = 0;
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live?.rig.process(src === "riff" ? dry.subarray(at, at + BLOCK) : quiet, L, BLOCK, R);
      for (let i = 0; i < BLOCK; i++) {
        const l = limit(L[i] / FULL_SCALE), r = limit(R[i] / FULL_SCALE);
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        ss += l * l; side += (l - r) ** 2;
      }
    }
    return { rms: Math.sqrt(ss / (blocks * BLOCK)), side: Math.sqrt(side / (blocks * BLOCK)) };
  };
  const lay = (chain: ChainSlot[]): Live => (live = applySettings({ ...base, chain }, live, SR));
  const shares = (blocks: number) => (live ? chainLoads(live.rig.loads(), live.where ?? { at: [], amp: -1 }, (blocks * BLOCK * 1000) / SR) : []);

  // The amp alone on a board sounds just as it does without one: its power stage runs inside its oversampling.
  const one = applySettings(base, null, SR).rig, alone = applySettings({ ...base, chain: [amp] }, null, SR).rig;
  const a = new Float32Array(2400), b = new Float32Array(2400);
  one.process(dry.subarray(0, 2400), a);
  alone.process(dry.subarray(0, 2400), b);
  expect(Array.from(b)).toEqual(Array.from(a));

  // Q Drive into Q Fuzz into the amp, Q Tape in its loop: mono, every slot timed.
  const first = lay([drive, fuzz, amp, tape]);
  expect(play(200).side).toBe(0);
  expect(first.rig.misses).toBe(0);
  const loads = shares(200);
  expect(loads).toHaveLength(4);
  for (const l of loads) expect(l).toBeGreaterThan(0);

  // A knob turn and a part swap turn in place; a footswitch or a reorder is a new rig that keeps what it still has.
  expect(lay([{ ...drive, drive: 8, swaps: { D1: "germanium" } }, fuzz, amp, { machine: { ...tape.machine, time: 6 } }]).rig).toBe(first.rig);
  play(40);
  const echoes = (chain: ChainSlot[]) => { const now = lay(chain); play(10, "quiet"); return { rms: play(60, "quiet").rms, rig: now.rig }; };
  // The riff stops and Q Fuzz moves ahead of Q Drive at once: the tape's echoes ring on through the new rig...
  const carried = echoes([fuzz, drive, amp, tape]);
  expect(carried.rig).not.toBe(first.rig);
  // ...where a rig built fresh with the same board is silent.
  live = null;
  expect(carried.rms).toBeGreaterThan(10 * echoes([fuzz, drive, amp, tape]).rms);

  // Q Drive into the loop after the tape, and Q Bucket after it: from there on two sides, the right chip half a turn behind.
  const wideRig = lay([fuzz, amp, tape, drive, bucket]).rig;
  const wide = play(200);
  expect(wideRig.stereo).toBe(true);
  expect(wide.side).toBeGreaterThan(0.05 * wide.rms);
  expect(wideRig.misses).toBe(0);
  expect(shares(200)).toHaveLength(5);
  expect(peak).toBeLessThanOrEqual(0.89);

  // Over budget, the board splits across threads (#4948), only ahead of its loop: Q Drive in it stays with the
  // last part. Cut inside the amp, the two parts played one after the other are the one-thread sound to the bit.
  const split: AmpSettings = { ...base, chain: [fuzz, amp, tape, drive, bucket] };
  expect(cutPoints(rigSpec(split).spec)).toEqual([1, 2, 3, 4, 5]);
  const whole = applySettings(split, null, SR).rig, head = applySettings(split, null, SR, { cuts: [3], index: 0 }).rig;
  const tail = applySettings(split, null, SR, { cuts: [3], index: 1, inRest: head.outRest }).rig;
  const tap = new Float64Array(BLOCK * 4), wl = new Float32Array(BLOCK), wr = new Float32Array(BLOCK), pl = new Float32Array(BLOCK), pr = new Float32Array(BLOCK);
  for (let k = 0; k < 40; k++) {
    const blk = dry.subarray(k * BLOCK, (k + 1) * BLOCK);
    whole.process(blk, wl, BLOCK, wr);
    head.process(blk, tap, BLOCK);
    tail.process(tap, pl, BLOCK, pr);
    expect([k, Array.from(pl), Array.from(pr)]).toEqual([k, Array.from(wl), Array.from(wr)]);
  }
});

test("each pedal on its own cables: fuzz into drive into the amp, swapped by re-cabling while the tape echoes, then split A/B; a pedal cabled into itself", () => {
  const dry = riff(SR), quiet = new Float32Array(BLOCK), out = new Float32Array(BLOCK);
  const base: AmpSettings = { amp: "brit", pedal: null, drive: 0, knobs: { ...AMPS[0].knobs, noise: 0 }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  const placed = ["guitar", "fuzz", "drive", "split", "blend", "head", "tape", "cab"].map((id) => ({ id, gear: id }));
  // The page's switches: both pedals on, Q Tape on in the loop.
  const tape: ChainSlot = { machine: { kind: "tape", time: 3, repeats: 6, mix: 6, heads: [1, 3] } };
  const slotOf = (id: string): ChainSlot | null => (id === "fuzz" ? { pedal: "fuzz", drive: 8 } : id === "drive" ? { pedal: "drive", drive: 6 } : id === "tape" ? tape : null);
  const chainOf = (cables: readonly Cable[]) => { const p: Patch = { placed, cables }; return cabledChain(audibleChains(p, compile(p)), slotOf); };
  let live: Live | null = null, at = 0;
  const play = (blocks: number, src: "riff" | "quiet" = "riff") => {
    const got = new Float32Array(blocks * BLOCK);
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live?.rig.process(src === "riff" ? dry.subarray(at, at + BLOCK) : quiet, out, BLOCK);
      got.set(out.map((v) => limit(v / FULL_SCALE)), b * BLOCK);
    }
    return got;
  };
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const lay = (cables: readonly Cable[]) => (live = applySettings({ ...base, chain: chainOf(cables).chain }, live, SR));

  // Guitar, Q Fuzz, Q Drive, the amp, Q Tape between its send and return, the cab: the slots in the order of the cables.
  const fuzzFirst = seriesCables(["fuzz", "drive"], ["tape"]);
  expect(chainOf(fuzzFirst).ids).toEqual(["fuzz", "drive", "amp", "tape"]);
  lay(fuzzFirst);
  play(150);
  // The same riff through each order from cold: re-cabled the other way round sounds different.
  const cold = (cables: readonly Cable[]) => { live = null; lay(cables); at = 0; return play(120); };
  const drivenFirst = seriesCables(["drive", "fuzz"], ["tape"]);
  const a = cold(fuzzFirst), b = cold(drivenFirst);
  expect(rms(a.map((v, i) => v - b[i]))).toBeGreaterThan(0.1 * rms(a));

  // Swapped by hand while the tape echoes: pull the four front cables, run them the other way. The tape keeps its echoes.
  live = null; lay(fuzzFirst); play(150);
  const swapped: Cable[] = [
    { from: ["guitar", "out"], to: ["drive", "in"] }, { from: ["drive", "out"], to: ["fuzz", "in"] }, { from: ["fuzz", "out"], to: ["head", "in"] },
    ...fuzzFirst.filter((c) => c.from[0] === "head" || c.from[0] === "tape"),
  ];
  expect(chainOf(swapped).ids).toEqual(["drive", "fuzz", "amp", "tape"]);
  const before = live!.rig;
  lay(swapped);
  expect(live!.rig).not.toBe(before);
  const echoes = rms(play(60, "quiet"));
  // The same swap with nothing in the loop: only the amp ringing down and Q Fuzz.s own hiss.
  const dryLoop = (cables: readonly Cable[]) => cables.filter((c) => c.from[0] !== "tape" && c.to[0] !== "tape" && c.from[1] !== "send");
  live = null; lay(dryLoop(fuzzFirst)); play(150); lay(dryLoop(swapped));
  expect(echoes).toBeGreaterThan(3 * rms(play(60, "quiet")));
  // The tile drag cables the board in its new row: the same chain as cabling it by hand.
  expect(chainOf(relay(["drive", "fuzz", "amp", "tape"], fuzzFirst))).toEqual(chainOf(swapped));

  // An A/B split: Q Fuzz on A, Q Drive on B, blended back into the amp: both sides at once.
  const ab: Cable[] = [
    { from: ["guitar", "out"], to: ["split", "in"] }, { from: ["split", "a"], to: ["fuzz", "in"] }, { from: ["split", "b"], to: ["drive", "in"] },
    { from: ["fuzz", "out"], to: ["blend", "a"] }, { from: ["drive", "out"], to: ["blend", "b"] }, { from: ["blend", "out"], to: ["head", "in"] },
    ...fuzzFirst.filter((c) => c.from[0] === "head" || c.from[0] === "tape"),
  ];
  expect(chainOf(ab).chain).toEqual([{ split: [[{ pedal: "fuzz", drive: 8 }], [{ pedal: "drive", drive: 6 }]], mix: [0.5, 0.5] }, { amp: true }, tape]);
  lay(ab);
  expect(rms(play(100))).toBeGreaterThan(0.05);
  expect(live!.rig.misses).toBe(0);

  // Q Fuzz's out into its own in: the loop problem, and nothing for the speakers.
  const looped: Patch = { placed, cables: [...fuzzFirst, { from: ["fuzz", "out"], to: ["fuzz", "in"] }] };
  const compiled = compile(looped);
  expect(compiled.problems.map((p) => [p.kind, p.items])).toContainEqual(["loop", ["fuzz"]]);
  expect(audibleChains(looped, compiled)).toEqual([]);
});
