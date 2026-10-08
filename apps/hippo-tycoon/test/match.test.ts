import { expect, test } from "bun:test";
import { Match } from "../src/engine/match.ts";
import { hashState } from "../src/sim/hash.ts";
import { COUNTDOWN_TICKS, SEAT_NAMES } from "../src/sim/rules.ts";

const run = (m: Match, ticks: number) => { for (let i = 0; i < ticks; i++) m.tick(); };

test("seats: humans take bot seats, leaving hands them back with the score kept", () => {
  const m = new Match(1);
  expect(m.humans()).toBe(0);
  expect(m.join("a", "Ada")).toBe(0);
  expect(m.join("b", "Bo", 2)).toBe(2);
  expect(m.join("c", "Cy", 2)).toBe(1);           // preferred seat taken: first free
  expect(m.join("a", "Ada II")).toBe(0);          // same uid again: same seat, new name
  expect(m.seats[0]!.name).toBe("Ada II");
  expect(m.join("d", "Di")).toBe(3);
  expect(m.join("e", "Ed")).toBe(-1);             // full
  expect(m.hostSeat()).toBe(0);
  m.start(); run(m, COUNTDOWN_TICKS + 200);
  m.sim.hippos[1]!.score = 7;
  expect(m.leave("c")).toBe(1);
  expect(m.seats[1]).toEqual({ uid: null, name: SEAT_NAMES[1], ready: false });
  expect(m.sim.hippos[1]!.score).toBe(7);         // a bot inherits the fortune
  expect(m.humans()).toBe(3);
  expect(m.phase).toBe("playing");
});

test("phases: lobby -> countdown -> playing -> podium -> rematch, ready by bellow", () => {
  const m = new Match(2, { secs: 30 });
  m.join("a", "Ada"); m.join("b", "Bo");
  run(m, 5);
  expect(m.phase).toBe("lobby");
  m.input(0, 0, false, true); run(m, 1);
  expect(m.seats[0]!.ready).toBe(true);
  expect(m.phase).toBe("lobby");                  // Bo is not ready yet
  m.input(1, 0, false, true); run(m, 1);
  expect(m.phase).toBe("countdown");
  run(m, COUNTDOWN_TICKS);
  expect(m.phase).toBe("playing");
  run(m, 30 * 30 + 5);
  expect(m.phase).toBe("podium");
  const round = m.round;
  expect(m.start()).toBe(true);                   // rematch
  expect(m.round).toBe(round + 1);
  expect(m.phase).toBe("countdown");
  expect(m.sim.hippos.every((h) => h.score === 0)).toBe(true);
  expect(m.seats[0]!.uid).toBe("a");              // same seats
});

test("the last human leaving mid-round sends the room back to the lobby", () => {
  const m = new Match(3);
  m.join("a", "Ada"); m.start(); run(m, COUNTDOWN_TICKS + 10);
  m.leave("a");
  expect(m.phase).toBe("lobby");
});

test("config only changes in the lobby", () => {
  const m = new Match(4);
  m.setCfg({ secs: 90, difficulty: "hard" });
  expect(m.cfg).toEqual({ secs: 90, difficulty: "hard", bots: ["hard", "hard", "hard", "hard"] });
  expect(m.sim.roundTicks).toBe(90 * 30);
  m.join("a", "Ada"); m.start();
  m.setCfg({ secs: 30 });
  expect(m.cfg.secs).toBe(90);
});

test("input: move holds, gulp is an edge, bad numbers are tamed", () => {
  const m = new Match(5);
  m.join("a", "Ada"); m.start(); run(m, COUNTDOWN_TICKS);
  m.input(0, 5, false, false); run(m, 3);
  expect(m.sim.hippos[0]!.slide).toBeGreaterThan(0.2);
  const s = m.sim.hippos[0]!.slide;
  m.input(0, 0, true, false); run(m, 1);
  expect(m.sim.hippos[0]!.gulp).toBeGreaterThanOrEqual(0);
  m.input(0, NaN, false, false); run(m, 5);
  expect(m.sim.hippos[0]!.slide).toBeCloseTo(s, 5);
});

test("same seed and same human input replay to the same state", () => {
  const play = () => {
    const m = new Match(9);
    m.join("a", "Ada"); m.join("b", "Bo"); m.start();
    for (let i = 0; i < 1500; i++) {
      m.input(0, Math.sin(i / 20), i % 13 === 0, false);
      m.input(1, Math.cos(i / 30), i % 17 === 0, false);
      m.tick();
    }
    return hashState(m.sim);
  };
  expect(play()).toBe(play());
});

test("restore: a running round restarts, lobby and podium come back as they were", () => {
  const m = new Match(6);
  m.join("a", "Ada"); m.start(); run(m, COUNTDOWN_TICKS + 100);
  const p = m.persisted();
  const r = new Match(0);
  r.restore(p);
  expect(r.phase).toBe("countdown");
  expect(r.baseSeed).toBe(6);
  expect(r.sim.hippos.every((h) => h.score === 0)).toBe(true);
  const lobby = new Match(7); lobby.join("a", "Ada");
  const l = new Match(0); l.restore(lobby.persisted());
  expect(l.phase).toBe("lobby");
  m.sim.over = true; m.phase = "podium"; m.sim.hippos[2]!.score = 11;
  const podium = new Match(0); podium.restore(m.persisted());
  expect(podium.phase).toBe("podium");
  expect(podium.sim.hippos[2]!.score).toBe(11);
});

test("per-seat bot difficulty: each bot plays its own level, and the match stays deterministic", () => {
  const play = (bots?: ("easy" | "normal" | "hard")[]) => {
    const m = new Match(11, { secs: 30, ...(bots ? { bots } : { difficulty: "easy" }) });
    m.start(); run(m, COUNTDOWN_TICKS + 30 * 30);
    return hashState(m.sim);
  };
  const mixed: ("easy" | "normal" | "hard")[] = ["hard", "easy", "easy", "easy"];
  expect(play(mixed)).toBe(play(mixed));
  expect(play(mixed)).not.toBe(play());               // seat 0's bot really plays hard
  expect(play(["easy", "easy", "easy", "easy"])).toBe(play());
  const m = new Match(1);
  m.setCfg({ bots: mixed });
  expect(m.cfg).toEqual({ secs: 60, difficulty: "normal", bots: mixed });
  m.setCfg({ difficulty: "hard" });                    // "all bots" overrides every seat
  expect(m.cfg.bots).toEqual(["hard", "hard", "hard", "hard"]);
  const back = new Match(2); back.restore({ ...m.persisted(), cfg: { secs: 90, difficulty: "easy" } as never });
  expect(back.cfg.bots).toEqual(["easy", "easy", "easy", "easy"]);   // a save from before per-seat bots
});

test("seats are owed back: a leaver's seat is skipped by newcomers and theirs when they return", () => {
  const m = new Match(1);
  m.join("a", "A"); m.join("b", "B"); m.join("c", "C");
  m.leave("b");
  expect(m.join("d", "D")).toBe(3);
  expect(m.join("e", "E")).toBe(1);                    // the only seat left: taken after all
  m.leave("e"); m.leave("d");
  expect(m.join("b", "B")).toBe(1);                    // every free seat is owed to someone (e, d): b takes the first
  expect(m.awayFrom()).toEqual([null, null, null, "d"]);
});
