// The hero's input, a step at a time, as a short string the page posts with a played result, so
// the campaign's Durable Object can play the battle again and keep its own result. The sims are
// seeded from the spec and their trig is fmath.ts, so the same inputs end the same way anywhere.
//
// The page steps the sim with what the recorder hands back, not the raw input: angles are rounded
// to 1/1024 of a radian and strike spots to 1/8 m (both exact in binary), so the log holds
// exactly what was played. Each step is a flags byte, then whatever changed as zigzag varints
// (angles as the change since the last step); a step the same as the one before folds into a
// repeat count. The log stops when the hero hands the battle to the AI, and the replay runs the
// rest with no input, as the page did.
import type { BattleResult, BattleSpec, SpaceBattleResult, SpaceBattleSpec } from "./contract.ts";
import { DT, TIME_LIMIT, startBattle, step, type Input } from "./sim.ts";
import { startSpaceBattle, stepSpace, type SpaceInput } from "./space.ts";

const ANGLE = 1024;
const SPOT = 8;
const REPEAT = 3; // a flags byte can't end in 0b11: the key bits only go to 2
const MAX_STEPS = Math.ceil(TIME_LIMIT / DT) + 1;

const sign = (v: number) => Math.max(-1, Math.min(1, Math.round(v))) || 0;
const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzigzag = (n: number) => (n % 2 ? -(n + 1) / 2 : n / 2);

function varint(out: number[], n: number) {
  for (; n >= 0x80; n = Math.floor(n / 0x80)) out.push((n % 0x80) | 0x80);
  out.push(n);
}

// Folds a step that repeats the one before into a count.
function writer() {
  const bytes: number[] = [];
  let last = "", run = 0;
  const flush = () => { if (run) { bytes.push(REPEAT); varint(bytes, run); run = 0; } };
  return {
    push(rec: number[]) {
      const key = rec.join();
      if (key === last) { run++; return; }
      flush();
      bytes.push(...rec);
      last = key;
    },
    done() {
      flush();
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000));
      return btoa(s);
    },
  };
}

// Reads a log back a step at a time; throws on one that isn't a log. A repeat reads the step
// before it again, so a turn kept up keeps turning.
function* reader<T>(log: string, read: (next: () => number, varint: () => number) => T): Generator<T> {
  const s = atob(log);
  let i = 0, steps = 0, lastAt = -1;
  const next = () => {
    if (i >= s.length) throw new Error("The log ends mid-step");
    return s.charCodeAt(i++);
  };
  const vint = () => {
    let n = 0;
    for (let shift = 1, k = 0; ; shift *= 0x80, k++) {
      if (k === 4) throw new Error("A number in the log is too long");
      const b = next();
      n += (b & 0x7f) * shift;
      if (b < 0x80) return n;
    }
  };
  while (i < s.length) {
    if (++steps > MAX_STEPS) throw new Error("The log runs longer than a battle");
    if (s.charCodeAt(i) !== REPEAT) {
      lastAt = i;
      yield read(next, vint);
      continue;
    }
    i++;
    if (lastAt < 0) throw new Error("A repeat with nothing before it");
    const n = vint(), after = i;
    steps--;
    for (let k = 0; k < n; k++) {
      if (++steps > MAX_STEPS) throw new Error("The log runs longer than a battle");
      i = lastAt;
      const step = read(next, vint);
      i = after;
      yield step;
    }
  }
}

// The ground battle. Flags: forward + 1 (2 bits), right + 1 (2 bits), fire, use, a strike, a turn.
export function groundRecorder() {
  const w = writer();
  let yaw = 0;
  return {
    take(i: Input): Input {
      const k = Math.round(i.yaw * ANGLE), forward = sign(i.forward), right = sign(i.right);
      const strike = i.strike && { x: Math.round(i.strike.x * SPOT), z: Math.round(i.strike.z * SPOT) };
      const rec = [(forward + 1) | ((right + 1) << 2) | (i.fire ? 16 : 0) | (i.use ? 32 : 0) | (strike ? 64 : 0) | (k !== yaw ? 128 : 0)];
      if (k !== yaw) varint(rec, zigzag(k - yaw));
      if (strike) { varint(rec, zigzag(strike.x)); varint(rec, zigzag(strike.z)); }
      w.push(rec);
      yaw = k;
      return { forward, right, yaw: k / ANGLE, fire: !!i.fire, ...(i.use && { use: true }), ...(strike && { strike: { x: strike.x / SPOT, z: strike.z / SPOT } }) };
    },
    log: () => w.done(),
  };
}

export function groundInputs(log: string): Generator<Input> {
  let yaw = 0;
  return reader(log, (next, vint) => {
    const f = next();
    if ((f & 3) === 3 || (f & 12) === 12) throw new Error("Not a step");
    if (f & 128) yaw += unzigzag(vint());
    const strike = f & 64 ? { x: unzigzag(vint()) / SPOT, z: unzigzag(vint()) / SPOT } : undefined;
    return { forward: (f & 3) - 1, right: ((f >> 2) & 3) - 1, yaw: yaw / ANGLE, fire: !!(f & 16), ...(f & 32 ? { use: true } : {}), ...(strike && { strike }) };
  });
}

// Plays the battle again from the hero's inputs. Null if the log isn't one.
export function replayGround(spec: BattleSpec, log: string): BattleResult | null {
  const b = startBattle(spec);
  try {
    for (const input of groundInputs(log)) {
      if (b.over) break;
      step(b, input);
    }
  } catch {
    return null;
  }
  while (!b.over) step(b, null);
  return b.over;
}

// The space battle. Flags: throttle + 1 (2 bits), fire, a turn, a climb.
export function spaceRecorder() {
  const w = writer();
  let yaw = 0, pitch = 0;
  return {
    take(i: SpaceInput): SpaceInput {
      const ky = Math.round(i.yaw * ANGLE), kp = Math.round(i.pitch * ANGLE), throttle = sign(i.throttle);
      const rec = [(throttle + 1) | (i.fire ? 4 : 0) | (ky !== yaw ? 8 : 0) | (kp !== pitch ? 16 : 0)];
      if (ky !== yaw) varint(rec, zigzag(ky - yaw));
      if (kp !== pitch) varint(rec, zigzag(kp - pitch));
      w.push(rec);
      yaw = ky; pitch = kp;
      return { yaw: ky / ANGLE, pitch: kp / ANGLE, throttle, fire: !!i.fire };
    },
    log: () => w.done(),
  };
}

export function spaceInputs(log: string): Generator<SpaceInput> {
  let yaw = 0, pitch = 0;
  return reader(log, (next, vint) => {
    const f = next();
    if ((f & 3) === 3 || f > 31) throw new Error("Not a step");
    if (f & 8) yaw += unzigzag(vint());
    if (f & 16) pitch += unzigzag(vint());
    return { yaw: yaw / ANGLE, pitch: pitch / ANGLE, throttle: (f & 3) - 1, fire: !!(f & 4) };
  });
}

export function replaySpace(spec: SpaceBattleSpec, log: string): SpaceBattleResult | null {
  const b = startSpaceBattle(spec);
  try {
    for (const input of spaceInputs(log)) {
      if (b.over) break;
      stepSpace(b, input);
    }
  } catch {
    return null;
  }
  while (!b.over) stepSpace(b, null);
  return b.over;
}
