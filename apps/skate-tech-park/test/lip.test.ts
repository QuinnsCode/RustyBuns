// Lip tricks and wallrides: a board that only just reaches the coping stalls on it and drops back down the wall; a board
// thrown along a sheer face rides it for a moment. All headless, through the same step() the page runs.
import { expect, test } from "bun:test";
import { clamp } from "@rustybuns/util";
import { makeLevel, piece } from "../src/level.ts";
import { halfpipe } from "../src/levels/pieces.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const hp = halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 });
const pipe = makeLevel({ name: "t", pieces: hp.pieces, rails: hp.rails, spawns: [], bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } });
const lip = hp.rails[1]!; // the wall at +x: coping along z at x = 17, 6 m up
const hold = (s: State) => clamp(s.balance * 2, -1, 1);
const awards = (s: State, seconds: number, input: (s: State) => Partial<Input>) => {
  const seen: string[] = [];
  let last = s.last;
  for (let i = 0; i < seconds / DT; i++) {
    step(s, { ...IDLE, ...input(s) }, pipe);
    if (s.last !== last) { last = s.last; seen.push(last!.name); }
  }
  return seen;
};

test("up the wall with just enough speed the board stalls on the coping, pops back in and rolls away fakie; pushed over the lip it airs instead", () => {
  const up = (speed: number, extra: (s: State) => Partial<Input> = () => ({})) => {
    const s = Object.assign(start(0, 0, Math.PI / 2, pipe), { speed });
    let stalled = "", fakie = false;
    const seen = awards(s, 6, (s) => {
      if (s.stall && !stalled) stalled = `${s.grindKind}`;
      if (stalled && !s.air && s.grind < 0 && s.speed < -1) fakie = true;
      return { steer: s.grind >= 0 ? hold(s) : 0, jump: s.stall && s.grindTime > 0.5, ...extra(s) };
    });
    return { first: seen[0], stalled: !!stalled, fakie, bailed: s.bail > 0 };
  };
  const rock = up(16.6);
  expect(rock.stalled).toBe(true);
  expect(rock.first).toBe("Rock to fakie");
  expect(rock.fakie).toBe(true);
  expect(rock.bailed).toBe(false);
  expect(up(16.6, (s) => ({ manual: s.air ? 1 : 0 })).first).toBe("Blunt to fakie"); // the nose held up as it catches stands it on its tail
  expect(up(16.6, (s) => (s.air && !s.stall ? { steer: 1 } : {})).first).toBe("Disaster"); // turned onto the coping
  expect(up(16.6, () => ({ throttle: 1 })).first).toMatch(/^Air/); // pushed over the lip it airs, as before
  expect(up(19).first).toBe("fakie"); // too high over the lip: it drops back onto the face, as before
});

// Caught on the coping from the air: the board's middle `over` metres over the deck from the lip, at `yaw` (π/2 is straight up the wall), turned `spun`.
const catchAt = (yaw: number, over: number, spun = 0, manual: -1 | 0 | 1 = 0) => {
  const s = start(lip.a.x + over, 0, yaw, pipe);
  Object.assign(s, { air: true, airTime: 0.5, y: lip.y + 0.1, vy: -1, vx: 0, vz: 0, spun });
  for (let i = 0; i < 0.3 / DT; i++) step(s, { ...IDLE, manual, steer: s.grind >= 0 ? hold(s) : 0 }, pipe);
  expect(s.stall).toBe(true);
  step(s, { ...IDLE, jump: true }, pipe);
  return s.last?.name;
};

test("how the board lies on the coping names the stall", () => {
  const cases: [string, number, number, number, -1 | 0 | 1, string][] = [
    ["straight up, mid-deck", Math.PI / 2, 0, 0, 0, "Rock to fakie"],
    ["turned onto it", Math.PI / 2 - 1.1, 0, 1.1, 0, "Disaster"],
    ["a half turn onto it", -Math.PI / 2, 0, Math.PI, 0, "backside disaster"],
    ["along the coping", 0, 0, 1.2, 0, "Axle stall"],
    ["the nose held up", Math.PI / 2, 0, 0, 1, "Blunt to fakie"],
    ["the nose held down", Math.PI / 2, 0, 0, -1, "Nose blunt"],
    ["the tail on it", Math.PI / 2, 1.9, 0, 0, "Tail stall"],
    ["the nose on it", Math.PI / 2, -1.9, 0, 0, "Nose stall"],
  ];
  for (const [what, yaw, over, spun, manual, name] of cases) expect([what, catchAt(yaw, over, spun, manual)]).toEqual([what, name]);
});

test("a stall is held with the stick like a grind, dropped back in by pulling back, and lost if left alone", () => {
  const stalled = () => { const s = start(lip.a.x, 0, Math.PI / 2, pipe); Object.assign(s, { air: true, airTime: 0.5, y: lip.y + 0.1, vy: -1 }); step(s, IDLE, pipe); expect(s.stall).toBe(true); return s; };
  const held = stalled();
  for (let i = 0; i < 2 / DT; i++) step(held, { ...IDLE, steer: hold(held) }, pipe);
  expect(held.stall).toBe(true);
  const back = awards(held, 2, (s) => ({ steer: s.grind >= 0 ? hold(s) : 0, throttle: s.stall ? -1 : 0 }));
  expect(back[0]).toBe("Rock to fakie");
  expect(held.speed).toBeLessThan(-1); // rolling back down the wall
  const alone = stalled();
  awards(alone, 3, () => ({}));
  expect(alone.last?.name).toBe("Bail: fell off the coping");
});

test("thrown along a sheer face fast enough the board rides the wall, scores it and rolls on; slower, or head on, it stops against it", () => {
  const wall = makeLevel({ name: "w", pieces: [piece("box", "wall", 0, 12, 0, 20, 4, 5, 5)], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } });
  const fly = (yaw: number, speed: number) => {
    const s = Object.assign(start(-5, 7, yaw, wall), { air: true, y: 2, vy: 4, vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed });
    let longest = -1;
    for (let i = 0; i < 3 / DT; i++) { step(s, IDLE, wall); longest = Math.max(longest, s.wall); }
    return { s, longest };
  };
  const ride = fly(0.5, 12);
  expect(ride.longest).toBeGreaterThan(0.3);
  expect(ride.s.last?.name).toBe("Wallride");
  expect(ride.s.bail).toBe(0);
  expect(Math.abs(ride.s.speed)).toBeGreaterThan(3); // off the wall and rolling along it
  for (const [yaw, speed] of [[0.5, 4], [0.1, 12]] as const) {
    const stop = fly(yaw, speed);
    expect(stop.longest).toBe(-1);
    expect(stop.s.last?.name).not.toBe("Wallride");
  }
});
