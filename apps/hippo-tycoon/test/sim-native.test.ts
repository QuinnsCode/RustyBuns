// The Rust twin of step() (rust/crates/hippo_sim) against the TypeScript one:
// the same state hash on every tick of scripted rounds. Skips when the wasm is
// not built, so contributors without Rust stay green.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Match } from "../src/engine/match.ts";
import { Room } from "../src/engine/room.ts";
import { PROTO_VERSION } from "../src/engine/wire.ts";
import { hashState } from "../src/sim/hash.ts";
import { bot, newBotMem } from "../src/sim/bots.ts";
import { compileSim, instantiateSim, simFromWasm, simModule } from "../src/sim/native.ts";
import { seedOf } from "../src/sim/rng.ts";
import { PERSONALITIES } from "../src/sim/rules.ts";
import { newState, step } from "../src/sim/step.ts";
import { cosSin } from "../src/sim/trig.ts";
import type { Input } from "../src/sim/types.ts";
import { FakeCtx, FakeSocket, ManualClock } from "./fakes.ts";

const WASM = join(import.meta.dir, "../public/hippo_sim.wasm");

function scripted(seed: number) {
  let x = seed >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return (): Input[] => Array.from({ length: 4 }, () => ({ move: r() * 2.4 - 1.2, gulp: r() < 0.12, bellow: r() < 0.01 }));
}

test("cosSin matches Math.cos/sin to within 1e-15 over the sim's range", () => {
  for (let a = -7; a < 7; a += 0.0137) {
    const [c, s] = cosSin(a);
    expect(Math.abs(c - Math.cos(a))).toBeLessThan(1e-15);
    expect(Math.abs(s - Math.sin(a))).toBeLessThan(1e-15);
  }
  expect(cosSin(-Math.PI / 2)).toEqual([0, -1]);              // the seat axes come out exact
});

/** A room with one human, played for `secs` of clock with scripted inputs; its Match at the end. */
function playRoom(sim: WebAssembly.Module | null, secs: number) {
  const ctx = new FakeCtx(), clock = new ManualClock(), errors: unknown[] = [];
  const room = new Room(ctx, { clock, seed: 77, sim, report: (_w, e) => errors.push(e) });
  const ws = new FakeSocket(); ctx.sockets.push(ws);
  room.onConnect(ws, "player-1", "Ada");
  const say = (m: object) => room.webSocketMessage(ws, JSON.stringify(m));
  say({ t: "hello", v: PROTO_VERSION });
  say({ t: "start" });
  for (let i = 0; i < 30 * secs; i++) { say({ t: "in", m: (i * 37) % 200 - 100, g: i % 9 === 0 ? 1 : 0, h: 0 }); clock.advance(1000 / 30); }
  expect(errors).toEqual([]);
  return room.match;
}

test("the empty module a build without cargo bundles is not a sim: the room stays in TypeScript", async () => {
  const empty = await compileSim(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  expect(simModule(empty)).toBeNull();
  expect(simModule(null)).toBeNull();
  const ctx = new FakeCtx(), errors: unknown[] = [];
  expect(new Room(ctx, { clock: new ManualClock(), sim: empty, report: (_w, e) => errors.push(e) }).match.engine).toBe("ts");
  expect(String(errors[0])).toContain("not the hippo_sim module");   // said, not thrown
});

describe.skipIf(!existsSync(WASM))("the Rust twin (run `bun run build:native`)", () => {
  test("Rust and TypeScript agree on every tick, state hash and events, over whole rounds", async () => {
    const rs = await simFromWasm(readFileSync(WASM));
    let ticks = 0, eats = 0, slicks = 0;
    for (const [seed, secs] of [[1, 90], [7, 60], [0xdeadbeef, 30], [42, 90]] as const) {
      const ts = newState(seed, secs), mirror = newState(seed, secs);
      rs.newRound(seed, ts.roundTicks);
      expect(rs.hash()).toBe(hashState(ts));
      const rstep = rs.residentStep(), inputs = scripted(seed);
      while (!ts.over) {
        const inp = inputs();
        const a = step(ts, inp), b = rstep(mirror, inp);
        expect(rs.hash()).toBe(hashState(ts));
        expect(b).toEqual(a);
        ticks++; eats += a.filter((e) => e.t === "eat").length; slicks += a.filter((e) => e.t === "slick").length;
      }
    }
    expect(ticks).toBe(30 * (90 + 60 + 30 + 90));
    expect(eats).toBeGreaterThan(50);                  // it compared real chomps and slicks, not an empty pan
    expect(slicks).toBeGreaterThan(5);
  });

  test("as a drop-in step(), a whole match with bots ends in the same state", async () => {
    const rs = await simFromWasm(readFileSync(WASM));
    const play = (useRust: boolean) => {
      const s = newState(1234, 60), mem = [0, 1, 2, 3].map(() => newBotMem()), rngs = [0, 1, 2, 3].map((i) => ({ rng: seedOf(i + 9) }));
      while (!s.over) (useRust ? rs.step : step)(s, [0, 1, 2, 3].map((i) => bot(s, i, PERSONALITIES.hard, mem[i]!, rngs[i]!)));
      return s;
    };
    expect(JSON.stringify(play(true))).toBe(JSON.stringify(play(false)));
  });

  // Match with the Rust engine: the round and the bots stay in the module, Match only reads a view.
  const playMatch = (mod: WebAssembly.Module | null, opts: { secs: number; seed: number; poke?: (m: Match, t: number) => void }) => {
    const m = new Match(opts.seed, { secs: opts.secs, bots: ["hard", "normal", "easy", "hard"] });
    if (mod) m.setEngine(instantiateSim(mod));
    m.start();
    const snaps: string[] = [];
    for (let t = 0; m.phase !== "podium" && t < 10_000; t++) { opts.poke?.(m, t); m.tick(); snaps.push(JSON.stringify(m.snapshot())); }
    return { m, snaps };
  };

  test("resident: bots and rules in Rust give the same snapshots, every tick, and the same end state", async () => {
    const mod = await compileSim(readFileSync(WASM));
    for (const seed of [1234, 5, 0xbeef]) {
      const ts = playMatch(null, { secs: 60, seed }), rs = playMatch(mod, { secs: 60, seed });
      expect(rs.m.engine).toBe("rust");
      expect(rs.snaps.length).toBe(ts.snaps.length);
      for (let i = 0; i < ts.snaps.length; i++) if (rs.snaps[i] !== ts.snaps[i]) expect(rs.snaps[i]).toBe(ts.snaps[i]!);
      expect(JSON.stringify(rs.m.sim)).toBe(JSON.stringify(ts.m.sim));
      expect(ts.m.sim.hippos.filter((h) => h.score > 0).length).toBeGreaterThanOrEqual(3);    // the bots played
    }
  });

  test("resident: a human joining and leaving, reads of the state, and an engine swap mid-round change nothing", async () => {
    const mod = await compileSim(readFileSync(WASM));
    const poke = (rust: boolean) => (m: Match, t: number) => {
      if (t === 300) m.join("u0", "Bo", 0);                // stays seated (an idle hippo), so the room never empties
      if (t === 400) m.join("u1", "Ann", 1);
      if (t > 400 && t < 900) m.input(1, Math.sin(t / 20), t % 9 === 0, false);
      if (t === 900) m.leave("u1");
      if (t % 97 === 0) void m.sim.drops.length;          // brings the round home; the next tick hands it back
      if (rust && t === 1300) m.setEngine(null);
      if (rust && t === 1500) m.setEngine(instantiateSim(mod));
    };
    const ts = playMatch(null, { secs: 60, seed: 77, poke: poke(false) }), rs = playMatch(mod, { secs: 60, seed: 77, poke: poke(true) });
    expect(rs.m.phase).toBe("podium");
    expect(rs.snaps).toEqual(ts.snaps);
    expect(JSON.stringify(rs.m.sim)).toBe(JSON.stringify(ts.m.sim));
  });

  test("resident: a bot's memory and RNG survive a round trip through the module", async () => {
    const rs = await simFromWasm(readFileSync(WASM));
    const mem = { target: 12, err: -0.125, nextPlan: 340, known: new Set([3, 9, 27]) }, rng = { rng: 0xfedcba98 };
    rs.loadBot(2, PERSONALITIES.normal, mem, rng);
    const back = newBotMem(), r = { rng: 0 };
    rs.saveBot(2, back, r);
    expect(back).toEqual(mem);
    expect(r.rng).toBe(rng.rng);
  });

  test("a malformed module or state is refused", async () => {
    await expect(simFromWasm(readFileSync(join(import.meta.dir, "../public/hippo_fluid.wasm")))).rejects.toThrow("not the hippo_sim module");
    const rs = await simFromWasm(readFileSync(WASM));
    const s = newState(1); s.hippos.pop();
    expect(() => rs.step(s, [])).toThrow("rejected");
  });

  test("a room given the module steps its round in Rust, tick for tick with a TypeScript room", async () => {
    const mod = simModule(await compileSim(readFileSync(WASM)));
    expect(mod).not.toBeNull();
    const rust = playRoom(mod, 12), ts = playRoom(null, 12);
    expect(rust.engine).toBe("rust");
    expect(ts.engine).toBe("ts");
    expect(rust.sim.tick).toBeGreaterThan(200);                 // past the countdown, well into the round
    expect(hashState(rust.sim)).toBe(hashState(ts.sim));
    expect(JSON.stringify(rust.persisted())).toBe(JSON.stringify(ts.persisted()));
  });
});
