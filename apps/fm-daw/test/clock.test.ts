// The sesh's shared clock (src/clock.ts): three players on the World, each with its own clock off by seconds,
// its own sound card running a little fast or slow, and its own laggy, jittery link, count the same beats; a
// note one plays is heard by another a loop later on the beat it was played on, or at the desk lined up. Then the
// offset estimate on its own, and someone's guitar slices landing on their beat in the audio thread (TS and Rust).
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mulberry32 } from "@rustybuns/util";
import { setup, useWorld, type Sock } from "./world-kit.ts";
import { Clock, DESK_MS, JUMP_MS, SLEW, decodeClockServer, estimate, gridBeatAt, sampleOf } from "../src/clock.ts";
import { Band } from "../src/studio/band.ts";
import { LIVE_ID, QUANTUM, Sequencer } from "../src/engine/sequencer.ts";
import { decodeServer, type Live } from "../src/project.ts";
import { TsRemote } from "../src/engine/remote.ts";
import { WasmRemote, instantiateFm } from "../src/engine/wasm.ts";
import type { FmEngine } from "../src/engine/engine.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

useWorld();
afterEach(() => setSystemTime());

const SR = 48000, BLOCK = 128, BPM = 120, LOOP = 8, BEAT_MS = 60000 / BPM;

/** A player: its clock, sound card and link, the page's Band, and its audio thread's sequencer hearing what it plays. */
interface Player {
  name: string; ws: Sock; band: Band; seq: Sequencer;
  skew: number; ppm: number; outMs: number; start: number; link: (clock: boolean) => number; frames: number;
  /** When (true time, ms) each beat 1 and each note from someone else reached this player's ears. */
  ones: number[]; notes: number[];
}

test("three players with skewed clocks and laggy links count the same beats, and hear each other a loop late or at the desk", async () => {
  const { world, join, leave } = await setup({}, "tight-blue-otter");
  let T = 1_763_500_000_000;                                    // true time, ms
  const queue: { at: number; run: () => void }[] = [];
  const later = (dt: number, run: () => void) => queue.push({ at: T + dt, run });
  const rnd = mulberry32(42);
  let outlier = 0;
  const players: Player[] = [];
  const make = async (name: string, key: string, skew: number, ppm: number, outMs: number, base: number, jitter: number) => {
    const ws = (await join({ "X-User-Id": name }, key)).ws;
    // one way, each time: the base, jitter that is mostly small and now and then large (a queue somewhere), and
    // now and then a clock ping stuck for 400 ms
    const link = (clock: boolean) => base + rnd() ** 6 * jitter + (clock && ++outlier % 7 === 0 ? 400 : 0);
    const p: Player = { name, ws, skew, ppm, outMs, link, start: T, frames: 0, ones: [], notes: [], band: null!, seq: null! };
    p.band = new Band(() => ({ bpm: BPM, loopBeats: LOOP }), () => T + skew);
    const engine: FmEngine = {
      setParam() {}, setMute() {}, setMaster() {}, setTempo() {}, setBeat() {}, setBend() {}, noteOff() {}, allOff() {}, panic() {}, setTrackBand() {}, setTap() {}, render() {}, meter() {},
      click: (accent) => { if (accent) p.ones.push(heardAt(p)); },
      noteOn: (_t, id) => { if (id >= LIVE_ID) p.notes.push(heardAt(p)); },
    };
    p.seq = new Sequencer(engine, SR);
    p.seq.bpm = BPM; p.seq.setLoopBeats(LOOP); p.seq.metronome = true;
    players.push(p);
    return p;
  };
  /** The true time the quantum the sequencer is in reaches this player's ears. */
  const heardAt = (p: Player) => p.start + (p.frames * 1000) / (SR * (1 + p.ppm * 1e-6)) + p.outMs;
  const amy = await make("amy", "amykey0123456789ab", 250, 0, 12, 4, 2);
  const ben = await make("ben", "", 3700, 80, 25, 40, 20);
  const cat = await make("cat", "", -1234.5, -60, 40, 80, 30);

  const isClock = (m: unknown) => decodeClockServer(m) !== null || (typeof m === "object" && m !== null && "t" in m && (m.t === "tick" || m.t === "tock"));
  const toWorld = (p: Player, m: unknown) => later(p.link(isClock(m)), () => { setSystemTime(Math.floor(T)); world.webSocketMessage(p.ws, JSON.stringify(m)); fromWorld(); });
  const fromWorld = () => {
    for (const p of players) for (const m of p.ws.sent.splice(0)) later(p.link(isClock(m)), () => hear(p, m));
  };
  const hear = (p: Player, raw: unknown) => {
    const c = decodeClockServer(raw);
    if (c) { const r = p.band.onClock(c); if (r) toWorld(p, r); return; }
    const m = decodeServer(raw);
    if (m?.t === "floor") p.band.leading(m.host);
    if (m?.t === "live") for (const w of p.band.heard(m.from, m.e)) apply(p, w);
  };
  const apply = (p: Player, m: ToWorklet) => {
    if (m.t === "due") p.seq.liveAt(m.at, m.track, m.midi, m.vel);
    else if (m.t === "on") p.seq.liveOn(m.track, m.midi, m.vel, false);
  };
  const play = (p: Player, e: Live) => toWorld(p, { t: "live", e });
  fromWorld();

  // each page: pings on its own schedule, and every 50 ms tells its audio thread what the speakers are playing
  const pinger = (p: Player) => { const m = p.band.ping(); if (m) toWorld(p, m); later(p.band.clock.every, () => pinger(p)); };
  const grid: { ctx: number; beat: number | null }[] = players.map(() => ({ ctx: 0, beat: null }));
  const feeder = (p: Player, i: number) => {
    p.band.step(p.seq.playing);
    const heardFrames = ((T - p.outMs - p.start) * SR * (1 + p.ppm * 1e-6)) / 1000;
    const g = p.band.grid(heardFrames / SR, T + p.skew);
    if (g.t === "grid") grid[i] = { ctx: g.ctx, beat: g.beat };
    later(50, () => feeder(p, i));
  };
  players.forEach((p, i) => { pinger(p); later(1, () => feeder(p, i)); });

  /** Run until true time `until`: each sound card renders its blocks, the links deliver what's due. */
  const out = new Float32Array(QUANTUM * 2);
  const render = (to: number) => {
    T = to;
    players.forEach((p, i) => {
      const want = ((T - p.start) * SR * (1 + p.ppm * 1e-6)) / 1000;
      while (p.frames + BLOCK <= want) {
        const g = grid[i];
        // the worklet's sync, block by block, from the page's last grid (src/engine/worklet.ts gridNow)
        if (g.beat !== null) p.seq.sync(gridBeatAt(g.beat, g.ctx, p.frames / SR, BPM));
        for (let q = 0; q < BLOCK; q += QUANTUM) { p.seq.process(out, QUANTUM); p.frames += QUANTUM; }
      }
    });
  };
  // each message is delivered at its own moment, the sound cards rendering up to it
  const run = (ms: number) => {
    const until = T + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      if (!queue.length || queue[0].at > until) { render(until); return; }
      const next = queue.shift()!;
      render(Math.max(T, next.at));
      next.run();
    }
  };

  run(6000);
  // the leader follows itself; the others found the leader's clock (each 250 ms ahead of true time here) to a ms or two
  expect(amy.band.clock.state().source).toBe("me");
  for (const p of [ben, cat]) {
    expect(p.band.clock.source).toBe("leader");
    expect(Math.abs(p.band.clock.leaderTime(T + p.skew) - (T + 250))).toBeLessThan(3);
    expect(p.band.clock.state().rtt).toBeGreaterThan(0);
  }
  // they start the groove at different moments; each joins the shared beat where it is
  amy.seq.play(); run(300); ben.seq.play(); run(700); cat.seq.play();
  run(8000);
  // every beat 1 Amy heard, Ben and Cat heard within a few ms of it (a bar is 2 s)
  const ones = amy.ones.slice(1, -1);
  expect(ones.length).toBeGreaterThanOrEqual(3);
  for (const p of [ben, cat]) for (const t of ones) expect(Math.min(...p.ones.map((u) => Math.abs(u - t)))).toBeLessThan(3);

  // Ben plays a note: Amy (a loop late) hears it one loop (4 s) after he played it, to the ms; Cat, as it comes, at once
  cat.band.listen = "now";
  const playedAt = T;
  play(ben, { t: "on", track: 0, midi: 60, vel: 0.8, ...ben.band.stamp() });
  run(LOOP * BEAT_MS + 500);
  expect(amy.notes.length).toBe(1);
  expect(Math.abs(amy.notes[0] - (playedAt + LOOP * BEAT_MS))).toBeLessThan(3);
  expect(cat.notes[0] - playedAt).toBeLessThan(400);
  expect(cat.notes[0] - playedAt).toBeGreaterThan(100);

  // the leader goes to the desk: her beat runs 150 ms behind the band, and Cat's note reaches her lined up on it
  amy.band.listen = "desk";
  const switched = T;
  run(4500);
  const lateOnes = amy.ones.filter((t) => t > switched + 300);
  expect(lateOnes.length).toBeGreaterThanOrEqual(2);
  for (const t of lateOnes) expect(Math.min(...ben.ones.map((u) => Math.abs(u + DESK_MS - t)))).toBeLessThan(3);
  const catAt = T;
  play(cat, { t: "on", track: 1, midi: 64, vel: 0.8, ...cat.band.stamp() });
  run(1000);
  expect(amy.notes.length).toBe(2);
  expect(Math.abs(amy.notes[1] - (catAt + DESK_MS))).toBeLessThan(3);

  // the leader leaves: the World's clock answers, and Ben follows it without a jump while he plays
  leave(amy.ws);
  fromWorld();
  const before = ben.band.clock.offset;
  run(5000);
  expect(ben.band.clock.source).toBe("world");
  expect(Math.abs(ben.band.clock.target - (-ben.skew))).toBeLessThan(3);
  expect(Math.abs(ben.band.clock.offset - before)).toBeLessThan(SLEW * 5000 + 1);
});

// pings off one link to a clock 100 ms ahead: sent and got on this page's clock, `at` on the leader's
const ping = (sent: number, up: number, down: number) => sampleOf(sent, sent + up + 100, sent + up + down);
test.each([
  ["steady, symmetric", [ping(0, 20, 20), ping(250, 21, 21), ping(500, 20, 22)], 100, 1],
  ["jittery: the fastest few agree", [ping(0, 30, 52), ping(250, 22, 20), ping(500, 48, 21), ping(750, 20, 23), ping(1000, 35, 35), ping(1250, 21, 22), ping(1500, 23, 20)], 100, 2],
  ["one stuck on the way back for 400 ms is left out", [ping(0, 20, 20), ping(250, 20, 420), ping(500, 21, 20), ping(750, 20, 21), ping(1000, 22, 20), ping(1250, 20, 22)], 100, 1],
  ["one stuck on the way there for 400 ms is left out", [ping(0, 420, 20), ping(250, 20, 20), ping(500, 21, 20), ping(750, 20, 21), ping(1000, 22, 20), ping(1250, 20, 22)], 100, 1],
])("offset estimate: %s", (_why, samples, want, within) => {
  const e = estimate(samples)!;
  expect(Math.abs(e.offset - want)).toBeLessThanOrEqual(within);
  expect(e.rtt).toBe(Math.min(...samples.map((s) => s.rtt)));
});

test("the offset jumps until locked, then only slews while the groove plays; another clock far off is jumped to", () => {
  const c = new Clock();
  const answer = (now: number, at: number, by: "leader" | "world" = "leader") => { const p = c.ping(now); c.answer({ ...p, at, by }, now + 20); };
  answer(0, 510);                       // 500 ahead
  c.step(20, true);
  expect(c.offset).toBe(500);
  answer(1000, 1560);                   // 550 this time, so 525 between the two: playing, it moves 2 ms a second
  expect(c.target).toBe(525);
  c.step(1020, true);
  c.step(2020, true);
  expect(c.offset).toBeCloseTo(500 + SLEW * 2000, 6);
  c.step(2021, false);                  // stopped, it jumps
  expect(c.offset).toBe(c.target);
  answer(3000, 3010 + JUMP_MS * 2, "world");
  c.step(3020, true);
  expect(c.source).toBe("world");
  expect(c.offset).toBe(c.target);
});

/** A far end's guitar: a ramp, in 2400-sample slices, its sound card 0.1 % fast, stamped on the shared beat. */
function slices(start: number) {
  const nominal = (24000 * 60) / BPM, real = nominal * 1.001;
  return Array.from({ length: 20 }, (_, k) => ({ beat: start + (k * 2400) / real, pcm: Float32Array.from({ length: 2400 }, (_, i) => (k * 2400 + i) / 48000) }));
}
test("someone's guitar lands on the beat it was stamped with, following their sound card's drift", () => {
  const line = new TsRemote((24000 * 60) / BPM);
  const start = 1000.25;
  for (const s of slices(start)) line.push(s.beat, s.pcm);
  expect(line.spb / ((24000 * 60) / BPM)).toBeCloseTo(1.001, 6);
  // the sample stamped on a beat is the one heard on it, 1.5 s in, at 48 kHz here
  const out = new Float32Array(BLOCK), bpf = BPM / 60 / SR, beat = start + 36000 / line.spb;
  line.mix(out, BLOCK, beat, bpf, 1);
  expect(out[0]).toBeCloseTo(36000 / 48000, 4);
  expect(out[BLOCK - 1] - out[0]).toBeCloseTo(((BLOCK - 1) * bpf * line.spb) / 48000, 5);
  // past what has come in, it waits (and counts it), rather than playing anything stale
  const ahead = new Float32Array(BLOCK);
  line.mix(ahead, BLOCK, start + 48000 / line.spb + 0.01, bpf, 1);
  expect(ahead.every((v) => v === 0)).toBe(true);
  expect(line.late).toBe(BLOCK);
});

test("rust (wasm) plays someone's guitar sample for sample as the TS line does", async () => {
  const f = new URL("../public/fm_daw.wasm", import.meta.url);
  if (!existsSync(f)) { console.log("  (skipped: wasm not built; run `bun run build:native`)"); return; }
  const x = await instantiateFm(readFileSync(f));
  const nominal = (24000 * 60) / BPM, ts = new TsRemote(nominal), rs = new WasmRemote(x, nominal);
  const bpf = (BPM / 60 / SR) * 1.0003;
  for (const [k, s] of slices(512).entries()) {
    ts.push(s.beat, s.pcm); rs.push(s.beat, s.pcm);
    if (k === 9) { ts.push(530, s.pcm); rs.push(530, s.pcm); }      // a restart mid-way: both start the line over
    const a = new Float32Array(BLOCK), b = new Float32Array(BLOCK), at = 512 + k * 0.19;
    ts.mix(a, BLOCK, at, bpf, 0.7); rs.mix(b, BLOCK, at, bpf, 0.7);
    expect([...b]).toEqual([...a]);
  }
  expect(rs.late).toBe(ts.late);
  rs.free();
});
