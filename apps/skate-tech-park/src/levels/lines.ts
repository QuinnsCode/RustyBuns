// A line, as data: an ordered list of beats placed along a heading so each one's exit speed carries the rider to the next
// one's entry. The gap after a beat is the distance its exit speed covers in `GAP_SECONDS`. The result is a plain Part
// (the beats' own pieces and rails) plus a route that the `line` goal checks the rider passed through in order.
import { type At, bankLedge, downLedge, flatBar, handrail, kicker, ledge, manualPad, part, type Part, railLine } from "./pieces.ts";

/** Seconds of travel between the end of one beat and the start of the next, at its exit speed. */
export const GAP_SECONDS = 1.5;

type Beat = { make: (at: At) => Part; len: number; exit: number };

/** What a line can be made of: how it is built, how long it is along the heading (world metres) and the speed (m/s) it sends the rider on at. */
export const BEATS = {
  kicker: { make: (at) => kicker(at, { w: 3, d: 3, h: 1 }), len: 4.5, exit: 14 },
  bar: { make: (at) => flatBar(at, { len: 6 }), len: 9, exit: 11 },
  rail: { make: (at) => handrail(at, { len: 8, y: 0.9 }), len: 12, exit: 11 },
  railLine: { make: (at) => railLine(at, { line: "kink", len: 16 }), len: 24, exit: 10 },
  ledge: { make: (at) => ledge(at, { len: 8 }), len: 12, exit: 10 },
  manualPad: { make: (at) => manualPad(at), len: 7.5, exit: 10 },
  bankLedge: { make: (at) => bankLedge(at), len: 21, exit: 10 },
  downLedge: { make: (at) => downLedge(at), len: 15, exit: 9 },
} satisfies Record<string, Beat>;

export type BeatName = keyof typeof BEATS;
export type Step = BeatName | { beat: BeatName; /** Overrides the beat's exit speed, m/s. */ exit?: number; /** Turns the heading by this many radians after the beat. */ turn?: number };

/** The speed of a rider who is just rolling along, below which a route gives up waiting for the next point. */
const SLOWEST = 6;

/** Lays `steps` end to end from `at` along its heading; the run-up before the first beat is the caller's flat ground. */
export function line(at: At, steps: Step[], o: { name: string }): Part {
  let x = at.x, z = at.z, yaw = at.yaw ?? 0;
  const parts: Part[] = [], points: { x: number; z: number; r: number }[] = [];
  for (const st of steps) {
    const s = typeof st === "string" ? { beat: st } as Extract<Step, object> : st, b: Beat = BEATS[s.beat];
    const c = { x: x + Math.sin(yaw) * b.len / 2, z: z + Math.cos(yaw) * b.len / 2 };
    parts.push(b.make({ ...c, yaw }));
    points.push({ ...c, r: b.len / 2 + 2 });
    const gap = (s.exit ?? b.exit) * GAP_SECONDS;
    x += Math.sin(yaw) * (b.len + gap); z += Math.cos(yaw) * (b.len + gap);
    yaw += s.turn ?? 0;
  }
  const within = points.reduce((m, p, i) => (i ? Math.max(m, Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z) / SLOWEST) : m), 0);
  return part({ pieces: parts.flatMap((p) => p.pieces), rails: parts.flatMap((p) => p.rails), routes: [{ name: o.name, points, within }] });
}
