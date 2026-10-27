// An agent at the board: WebMCP tools (document.modelContext) that ride the game the way the keys do. A call
// queues held inputs, the page's step loop takes them one fixed step at a time through `Driver.next()`, and
// the call answers once they are ridden, with what the board did. A whole line can go in one call
// (`skate_line`), so an agent writes a run as code instead of pressing keys one round trip at a time.
// Nothing registers unless the browser has modelContext; players never see it.
import type { Level } from "./level.ts";
import { DT, type Input, type State } from "./sim.ts";
import { type Flick, TRICKS } from "./tricks.ts";

/** One held stretch of input, in sim steps. */
export type Hold = { input: Partial<Input>; steps: number };

const PRESS = 2; // steps a press (ollie, nollie, a flick) is held at the start of a stretch, so the next stretch can press again
const MAX_SECONDS = 120; // one call rides at most this long

/** Feeds queued holds into the step loop and settles each call when its holds are ridden. */
export class Driver {
  private queue: { hold: Hold; at: number; done?: () => void }[] = [];

  /** Queue holds; resolves once the last of them has been ridden. */
  ride(holds: Hold[]): Promise<void> {
    if (!holds.length) return Promise.resolve();
    return new Promise((done) => holds.forEach((hold, i) => this.queue.push({ hold, at: 0, ...(i === holds.length - 1 ? { done } : {}) })));
  }

  /** The agent's input for this step, or null when it isn't driving. */
  next(): Partial<Input> | null {
    const q = this.queue[0];
    if (!q) return null;
    const { jump, nollie, flick, flip, ...held } = q.hold.input;
    const out = q.at < PRESS ? q.hold.input : held;
    if (++q.at >= q.hold.steps) { this.queue.shift(); q.done?.(); }
    return out;
  }

  get driving() { return this.queue.length > 0; }
  stop() { for (const q of this.queue.splice(0)) q.done?.(); }
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFlick = (v: unknown): v is Flick => typeof v === "string" && v in TRICKS;

/** A tool's move ({ seconds, push, steer, ollie, ... }) as a hold. Anything unknown or out of range is dropped or clamped. */
export function holdOf(v: unknown): Hold {
  const m = isRecord(v) ? v : {};
  const input: Partial<Input> = {
    throttle: num(m.push, -1, 1, 0),
    steer: num(m.steer, -1, 1, 0),
    jump: m.ollie === true,
    nollie: m.nollie === true,
    flick: isFlick(m.trick) ? m.trick : null,
    boost: m.jets === true,
    fan: m.fan === true,
    manual: m.manual === "tail" ? 1 : m.manual === "nose" ? -1 : 0,
  };
  return { input, steps: Math.max(1, Math.round(num(m.seconds, DT, MAX_SECONDS, 0.5) / DT)) };
}

/** What an agent reads of the ride: where, how fast, what it's doing, the score, and what lies ahead. */
export function report(s: State, level: Level) {
  const r1 = (n: number) => Math.round(n * 10) / 10, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const ground = s.air ? null : s.y;
  const rails = level.rails.map((r) => {
    const mx = (r.a.x + r.b.x) / 2, mz = (r.a.z + r.b.z) / 2, dx = mx - s.x, dz = mz - s.z, d = Math.hypot(dx, dz);
    return { kind: r.kind, metres: r1(d), bearing: r1(Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz) * -57.2958), height: r1(r.y - level.height(mx, mz)) };
  }).filter((r) => r.metres < 60 && Math.abs(r.bearing) < 60).sort((a, b) => a.metres - b.metres).slice(0, 5);
  return {
    at: { x: r1(s.x), y: r1(s.y), z: r1(s.z), heading: r1(((s.yaw * 57.2958) % 360 + 360) % 360) },
    kmh: Math.round(Math.abs(s.air ? Math.hypot(s.vx, s.vz) : s.speed) * 3.6),
    doing: s.bail > 0 ? "bailing" : s.grind >= 0 ? `grinding (${s.grindKind})` : s.manual ? (s.manual > 0 ? "manual" : "nose manual") : s.air ? "in the air" : s.speed < -1 ? "rolling fakie" : "rolling",
    balance: s.grind >= 0 || s.manual ? r1(s.balance) : null,
    score: s.score, chain: s.chain, combo: s.combo, last: s.last,
    ahead: { rise10m: r1(level.height(s.x + fx * 10, s.z + fz * 10) - (ground ?? level.height(s.x, s.z))), rise30m: r1(level.height(s.x + fx * 30, s.z + fz * 30) - (ground ?? level.height(s.x, s.z))), rails },
  };
}

/** What the page lends the tools. */
export type Game = {
  driver: Driver;
  state: () => State;
  level: Level;
  park: { id: string; spawns: string[] };
  parks: () => { id: string; name: string }[];
  go: (park: string, spawn?: string) => void;
  reset: () => void;
  swap: () => string;
  snapshot: () => string;
};

const MOVE = {
  seconds: { type: "number", description: "How long to hold it (default 0.5, at most 120)" },
  push: { type: "number", description: "-1..1: push (W) or brake (S). Held on a steep transition it pumps" },
  steer: { type: "number", description: "-1..1, left is +. In the air it spins the board" },
  ollie: { type: "boolean", description: "Pop an ollie at the start" },
  nollie: { type: "boolean", description: "Pop off the nose instead" },
  trick: { type: "string", enum: Object.keys(TRICKS), description: "A flick trick at the start (in the air)" },
  jets: { type: "boolean", description: "Rear jets: speed, and a strong pump through a transition" },
  fan: { type: "boolean", description: "Suction fan: holds the board to banks and walls" },
  manual: { type: "string", enum: ["tail", "nose"], description: "Hold a manual (push and brake keep the balance)" },
} as const;

/** The tools, as plain objects WebMCP takes (and a test can call). */
export function tools(g: Game) {
  const rideFor = async (holds: Hold[]) => {
    const s = g.state(), seen: { name: string; points: number }[] = [];
    let last = s.last;
    const watch = setInterval(() => { const l = g.state().last; if (l && l !== last) { seen.push(l); last = l; } }, 16);
    try { await g.driver.ride(holds); } finally { clearInterval(watch); }
    const l = g.state().last;
    if (l && l !== last) seen.push(l);
    return { tricks: seen, now: report(g.state(), g.level) };
  };
  return [
    { name: "skate_look", title: "Look at the ride", description: "Where the board is, its speed, what it is doing, score and combo, and the ground and rails ahead.",
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, execute: async () => ({ park: g.park, ...report(g.state(), g.level) }) },
    { name: "skate_ride", title: "Ride a move", description: "Hold one move for some seconds, like holding keys, then report the tricks landed and where the board is.",
      inputSchema: { type: "object", properties: MOVE }, execute: async (m: unknown) => rideFor([holdOf(m)]) },
    { name: "skate_line", title: "Ride a line", description: "Code mode: a whole line as a list of moves ridden back to back in one call, e.g. push 3 s, ollie, kickflip, land, grind.",
      inputSchema: { type: "object", properties: { moves: { type: "array", items: { type: "object", properties: MOVE } } }, required: ["moves"] },
      execute: async (a: unknown) => {
        const moves = isRecord(a) && Array.isArray(a.moves) ? a.moves.slice(0, 200).map(holdOf) : [];
        let budget = MAX_SECONDS / DT;
        return rideFor(moves.filter((h) => (budget -= h.steps) >= 0));
      } },
    { name: "skate_snapshot", title: "Snapshot", description: "A picture of what the chase camera sees right now, as a 640 px wide JPEG data URL.",
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, execute: async () => ({ image: g.snapshot() }) },
    { name: "skate_reset", title: "Back to the spawn", description: "Put the board back at its spawn, stopped.",
      inputSchema: { type: "object", properties: {} }, execute: async () => { g.driver.stop(); g.reset(); return report(g.state(), g.level); } },
    { name: "skate_swap", title: "Swap skin", description: "Swap between the fingerboard and the rocket roadster. It rides the same either way.",
      inputSchema: { type: "object", properties: {} }, execute: async () => ({ skin: g.swap() }) },
    { name: "skate_parks", title: "List the parks", description: "Every park's id and name, and this park's spawns.",
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, execute: async () => ({ here: g.park, parks: g.parks() }) },
    { name: "skate_go", title: "Go to a park", description: "Load another park (the page reloads and the tools register again there), optionally at a named spawn.",
      inputSchema: { type: "object", properties: { park: { type: "string" }, spawn: { type: "string" } }, required: ["park"] },
      execute: async (a: unknown) => {
        const m = isRecord(a) ? a : {}, id = typeof m.park === "string" ? m.park : "";
        if (!g.parks().some((p) => p.id === id)) return { error: `No park "${id}". skate_parks lists them.` };
        g.go(id, typeof m.spawn === "string" ? m.spawn : undefined);
        return { going: id };
      } },
  ];
}

type Tool = ReturnType<typeof tools>[number];
type ModelContext = { registerTool: (t: Tool, o: { signal: AbortSignal }) => unknown };
const hasRegister = (v: unknown): v is ModelContext => isRecord(v) && typeof v.registerTool === "function";

/** Register the tools with the browser's agent, if it has one. */
export async function mountAgent(g: Game) {
  const mc: unknown = Reflect.get(document, "modelContext") ?? Reflect.get(navigator, "modelContext");
  if (!hasRegister(mc)) return false;
  const off = new AbortController();
  addEventListener("pagehide", () => off.abort());
  for (const t of tools(g)) { try { await mc.registerTool(t, { signal: off.signal }); } catch { /* an older build without a tool's shape: skip it */ } }
  return true;
}
