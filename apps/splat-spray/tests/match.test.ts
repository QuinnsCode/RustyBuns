// The match, clock-injected: a whole game from lobby to final board, and the ways a round goes wrong.
import { expect, test } from "bun:test";
import { MATCH, Match, parseMsg } from "../src/match/game.ts";

const S = 1000;
/** Two players in a lobby, started, and the clock at the moment the first round is on. */
function inPlay() {
  const m = new Match(100, 1234);
  m.join("ann", "Ann"); m.join("bo", "Bo");
  m.handle("ann", { t: "start" }, 0);
  expect(m.phase).toBe("countdown");
  m.tick(MATCH.countdownSecs * S);
  expect(m.phase).toBe("play");
  return { m, t0: MATCH.countdownSecs * S };
}

test("a whole match: three races, the faster finder scores more, then the final board and back to the lobby", () => {
  const m = new Match(100, 1234);
  m.join("ann", "Ann"); m.join("bo", "Bo");
  m.handle("bo", { t: "start" }, 0);
  let t = 0;
  const targets: number[] = [];
  for (let r = 0; r < MATCH.rounds; r++) {
    t += MATCH.countdownSecs * S; m.tick(t);
    expect(m.view("ann", t).target).toBe(m.target);
    targets.push(m.target);
    m.handle("ann", { t: "pick", id: m.target, shots: 4 }, t + 5 * S);
    expect(m.phase).toBe("play");                                  // Bo is still looking
    m.handle("bo", { t: "pick", id: m.target, shots: 9 }, t + 8 * S);
    expect(m.phase).toBe("results");                               // everyone found it: the round ends early
    t += 8 * S + MATCH.resultsSecs * S; m.tick(t);   // the board stays up from the last find
  }
  expect(new Set(targets).size).toBe(MATCH.rounds);                // never the same thing twice
  expect(m.phase).toBe("final");
  const board = m.view("ann", t).players;
  expect(board.map((p) => [p.name, p.total])).toEqual([["Ann", 300], ["Bo", 210]]);
  m.handle("bo", { t: "lobby" }, t);
  expect(m.phase).toBe("lobby");
  expect(m.view("bo", t).players.map((p) => p.total)).toEqual([0, 0]);
});

test("the thing to find is hidden until the round is on, and a wrong pick costs time", () => {
  const m = new Match(100, 7);
  m.join("ann", "Ann"); m.join("bo", "Bo");
  m.handle("ann", { t: "start" }, 0);
  expect(m.view("ann", 1).target).toBe(-1);
  m.tick(MATCH.countdownSecs * S);
  const t0 = MATCH.countdownSecs * S, wrong = (m.target + 1) % 100;
  m.handle("ann", { t: "pick", id: wrong, shots: 3 }, t0 + 2 * S);
  m.handle("ann", { t: "pick", id: m.target, shots: 3 }, t0 + 6 * S);
  m.handle("bo", { t: "pick", id: m.target, shots: 3 }, t0 + 8 * S);
  const [first, second] = m.view("ann", t0 + 9 * S).players;
  // Ann found it first but a wrong pick adds its penalty: 6 s + 3 s = 9 s, behind Bo's 8 s
  expect([first!.name, first!.ms, second!.name, second!.ms]).toEqual(["Bo", 8 * S, "Ann", 6 * S + MATCH.wrongMs]);
  expect(first!.got).toBeGreaterThan(second!.got);
});

test("a round that nobody wins ends on the clock and scores nothing", () => {
  const { m, t0 } = inPlay();
  m.tick(t0 + MATCH.roundSecs * S - 1);
  expect(m.phase).toBe("play");
  m.tick(t0 + MATCH.roundSecs * S);
  expect(m.phase).toBe("results");
  expect(m.view("ann", 0).players.map((p) => p.got)).toEqual([0, 0]);
});

test("a find before anyone could have seen the thing is a wrong pick, and a second find does not score twice", () => {
  const { m, t0 } = inPlay();
  m.handle("ann", { t: "pick", id: m.target, shots: 1 }, t0 + 100);
  expect(m.view("ann", t0 + 200).players.find((p) => p.id === "ann")!.ms).toBe(-1);
  m.handle("ann", { t: "pick", id: m.target, shots: 1 }, t0 + 4 * S);
  m.handle("ann", { t: "pick", id: m.target, shots: 99 }, t0 + 5 * S);
  const ann = m.view("ann", t0 + 6 * S).players.find((p) => p.id === "ann")!;
  expect(ann.ms).toBe(4 * S + MATCH.wrongMs);     // the early one was a wrong pick, which costs time
  expect(ann.shots).toBe(1);
});

test("someone leaving mid-round does not hold the round up, and a lobby of one can still play", () => {
  const { m, t0 } = inPlay();
  m.handle("ann", { t: "pick", id: m.target, shots: 2 }, t0 + 3 * S);
  m.leave("bo", t0 + 4 * S);
  expect(m.phase).toBe("results");
  m.leave("ann", t0 + 5 * S);
  expect(m.phase).toBe("lobby");
  m.join("cy", "Cy");
  m.handle("cy", { t: "start" }, 0);
  expect(m.phase).toBe("countdown");
});

test("the room holds eight", () => {
  const m = new Match(100);
  for (let i = 0; i < MATCH.maxPlayers; i++) expect(m.join(`p${i}`, `P${i}`)).toBe(true);
  expect(m.join("late", "Late")).toBe(false);
  expect(m.join("p3", "P3 again")).toBe(true);   // a reconnect is not a new seat
});

test("messages from the wire: only the three the game knows", () => {
  expect(parseMsg({ t: "start" })).toEqual({ t: "start" });
  expect(parseMsg({ t: "pick", id: 12, shots: 3 })).toEqual({ t: "pick", id: 12, shots: 3 });
  for (const bad of [null, "start", { t: "kick" }, { t: "pick" }, { t: "pick", id: "12" }, { t: "pick", id: -1 }]) expect(parseMsg(bad)).toBeNull();
});

test("quick play's window closing fills the room with bots; they find it, and the round ends once the people have", () => {
  const m = new Match(100, 77);
  m.join("ann", "Ann");
  m.quickStart(0, 4);
  expect(m.players.length).toBe(4);
  m.tick(MATCH.countdownSecs * S);
  expect(m.phase).toBe("play");
  m.tick(MATCH.countdownSecs * S + MATCH.botMaxMs + 1);
  expect(m.players.filter((p) => p.bot && p.found).length).toBe(3);
  expect(m.phase).toBe("play");                                   // still waiting on Ann
  m.handle("ann", { t: "pick", id: m.target, shots: 4 }, MATCH.countdownSecs * S + MATCH.botMaxMs + 2);
  expect(m.phase).toBe("results");
  expect(m.ranked().at(-1)!.got).toBeGreaterThanOrEqual(0);
});

test("when the last person leaves, the bots go with them", () => {
  const m = new Match(100, 77);
  m.join("ann", "Ann");
  m.quickStart(0, 4);
  m.leave("ann", 100);
  expect(m.phase).toBe("lobby");
  expect(m.players.length).toBe(0);
});
