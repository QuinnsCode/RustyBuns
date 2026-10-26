// The hallway: a dark corridor drawn as white outlines on black, seen from behind and above the
// runner, who runs away from the camera up the screen. Keys are outlined slabs on the floor that
// come down the corridor and reach the runner on their due beat. Colour only ever comes from a
// call or an answer: the world itself has none.
import type { Call, Lane, Run } from "./sim.ts";

export const LANE_COLOR: Record<Lane, string> = { 0: "#ff5fa2", 1: "#ffc542", 2: "#4de3ff", 3: "#9dff5f" };

// World units: lanes are 1 wide, the corridor is 4 wide and 3 tall, the runner stands 2.2 ahead
// of the camera, which floats 2.2 above the floor. A beat is 1.8 units of corridor.
const HALF = 2, WALL = 3, CAM_Y = 2.2, RUNNER_Z = 4, PER_BEAT = 1.8, FAR = 48;

export type View = { W: number; H: number; f: number; cx: number; hy: number };

export function view(W: number, H: number): View {
  // The vanishing point sits in the top third; focal length from the width so the corridor fills it.
  return { W, H, f: Math.min(W * 0.8, H * 0.7), cx: W / 2, hy: H * 0.34 };
}

/** A world point to the screen; z is distance ahead of the camera. */
export function project(v: View, x: number, y: number, z: number): [number, number] {
  const s = v.f / z;
  return [v.cx + x * s, v.hy + (CAM_Y - y) * s];
}

const laneX = (lane: Lane) => lane - 1.5;
const keyZ = (due: number, beat: number) => RUNNER_Z + (due - beat) * PER_BEAT;

// A hit explodes in its lane's colour. The dub echo repeats it `delay` beats later, smaller, up to
// three times, so what you see is what the delay line is doing.
export type Burst = { lane: Lane; beat: number; size: number; echoes: number; parts: { a: number; v: number; up: number }[] };

export function burst(lane: Lane, beat: number, size: number, rng = Math.random): Burst {
  const parts = Array.from({ length: 18 }, () => ({ a: rng() * Math.PI * 2, v: 0.5 + rng() * 1.5, up: 1 + rng() * 2.5 }));
  return { lane, beat, size, echoes: 0, parts };
}

/** Advance bursts to `beat`: spawn echoes that are due, drop the ones that have faded. */
export function echoBursts(bursts: Burst[], beat: number, delay: number) {
  for (const b of [...bursts]) {
    if (b.echoes < 3 && beat >= b.beat + delay && b.size > 0.2) {
      b.echoes = 3; // this one is done echoing: its child carries on
      bursts.push({ ...burst(b.lane, b.beat + delay, b.size * 0.55), echoes: 0 });
    }
  }
  const alive = bursts.filter((b) => beat - b.beat < 1.2);
  bursts.length = 0;
  bursts.push(...alive);
}

export type Scene = { run: Run | null; beat: number; down: ReadonlySet<Lane>; bursts: Burst[] };

export function drawHallway(g: CanvasRenderingContext2D, v: View, s: Scene) {
  const { W, H } = v;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  g.lineCap = "round";
  g.lineJoin = "round";
  const beat = s.beat;
  // The kick: the outlines flash a touch brighter on each beat, and the hallway shivers at the far end.
  const kick = s.run ? Math.max(0, 1 - (((beat % 1) + 1) % 1) * 4) : 0;
  const white = (a: number) => `rgba(255,255,255,${Math.min(1, a + kick * 0.25)})`;

  // Long edges: floor and ceiling corners, running to the vanishing point.
  g.strokeStyle = white(0.7);
  g.lineWidth = 1.5;
  g.beginPath();
  for (const [x, y] of [[-HALF, 0], [HALF, 0], [-HALF, WALL], [HALF, WALL]] as const) {
    const [ax, ay] = project(v, x, y, 0.6), [bx, by] = project(v, x, y, FAR);
    g.moveTo(ax, ay); g.lineTo(bx, by);
  }
  g.stroke();
  // Lane lines on the floor, faint.
  g.strokeStyle = white(0.18);
  g.lineWidth = 1;
  g.beginPath();
  for (const x of [-1, 0, 1]) {
    const [ax, ay] = project(v, x, 0, 0.6), [bx, by] = project(v, x, 0, FAR);
    g.moveTo(ax, ay); g.lineTo(bx, by);
  }
  g.stroke();
  // Cross-sections every beat, so the corridor rushes past at the song's speed. Bars are brighter.
  const first = Math.ceil(beat - RUNNER_Z / PER_BEAT);
  for (let b = first; b < first + FAR / PER_BEAT; b++) {
    const z = RUNNER_Z + (b - beat) * PER_BEAT;
    if (z < 0.6) continue;
    const bar = ((b % 4) + 4) % 4 === 0;
    g.strokeStyle = white((bar ? 0.5 : 0.2) * Math.min(1, 6 / z));
    g.lineWidth = bar ? 1.5 : 1;
    ring(g, v, z);
  }

  if (s.run) {
    // Keys: far ones first so near ones draw over them.
    const calls = s.run.chart.calls.filter((c) => c.beat <= beat + 0.02 && c.due + c.hold - beat > -0.6 && c.due - beat < FAR / PER_BEAT);
    for (const c of calls.sort((a, b) => b.due - a.due)) drawKey(g, v, c, beat);
    // The queue you carry: a dot per call in flight, hovering over the runner's head in order.
    const inFlight = s.run.chart.calls.filter((c) => c.beat <= beat && (c.state === "pending" || c.state === "held"));
    inFlight.forEach((c, i) => {
      const [x, y] = project(v, 0, 2.4 + i * 0.22, RUNNER_Z);
      g.fillStyle = LANE_COLOR[c.lane];
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    });
  }

  drawBursts(g, v, s.bursts, beat);
  drawRunner(g, v, s);
}

function ring(g: CanvasRenderingContext2D, v: View, z: number) {
  const pts = [[-HALF, 0], [HALF, 0], [HALF, WALL], [-HALF, WALL]] as const;
  g.beginPath();
  pts.forEach(([x, y], i) => { const [sx, sy] = project(v, x, y, z); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
  g.closePath();
  g.stroke();
}

function drawKey(g: CanvasRenderingContext2D, v: View, c: Call, beat: number) {
  const x0 = laneX(c.lane) - 0.42, x1 = laneX(c.lane) + 0.42;
  const zNear = Math.max(0.6, keyZ(c.due, beat)), zFar = Math.max(zNear + 0.3, keyZ(c.due + Math.max(c.hold, 0.35), beat));
  const gone = c.state === "hit" || c.state === "missed";
  const col = c.state === "missed" ? "#555" : LANE_COLOR[c.lane];
  const near = Math.min(1, 8 / zNear);
  g.globalAlpha = (gone ? 0.25 : 1) * near;
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 2;
  const pts = [project(v, x0, 0, zNear), project(v, x1, 0, zNear), project(v, x1, 0, zFar), project(v, x0, 0, zFar)];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.stroke();
  // A tap is a low block; its lid floats a little above the floor. A hold is a flat slab with a seam
  // you ride along, and glows while held.
  if (!c.hold) {
    const lid = [project(v, x0, 0.25, zNear), project(v, x1, 0.25, zNear), project(v, x1, 0.25, zFar), project(v, x0, 0.25, zFar)];
    g.beginPath();
    lid.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 2; i++) { g.moveTo(pts[i]![0], pts[i]![1]); g.lineTo(lid[i]![0], lid[i]![1]); }
    g.stroke();
    g.globalAlpha *= 0.18;
    g.beginPath();
    lid.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.fill();
  } else {
    g.globalAlpha *= c.state === "held" ? 0.5 : 0.12;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawBursts(g: CanvasRenderingContext2D, v: View, bursts: Burst[], beat: number) {
  for (const b of bursts) {
    const age = beat - b.beat;
    if (age < 0 || age > 1.2) continue;
    const fade = 1 - age / 1.2;
    const lx = laneX(b.lane);
    g.strokeStyle = LANE_COLOR[b.lane];
    g.fillStyle = LANE_COLOR[b.lane];
    // A ring on the floor, then sparks thrown up and out, pulled back down.
    g.globalAlpha = fade * 0.8;
    g.lineWidth = 2 + b.size * 2;
    const r = (0.2 + age * 1.6) * b.size;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const [x, y] = project(v, lx + Math.cos(a) * r, 0.02, RUNNER_Z + Math.sin(a) * r * 0.6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    for (const p of b.parts) {
      const d = p.v * age * b.size, h = Math.max(0, p.up * age - 2.2 * age * age) * b.size;
      const [x, y] = project(v, lx + Math.cos(p.a) * d, h, RUNNER_Z + Math.sin(p.a) * d * 0.6);
      g.beginPath(); g.arc(x, y, 2.5 * b.size * fade + 0.5, 0, Math.PI * 2); g.fill();
    }
    // The flash: the walls catch the colour for a moment.
    if (age < 0.15) {
      g.globalAlpha = (0.15 - age) * 2 * b.size;
      g.fillRect(0, 0, v.W, v.H);
    }
    g.globalAlpha = 1;
  }
}

// The runner, from behind: an outline with a bob and a stride on the beat, who reaches out to the
// lane being pressed. White, except the hands, which take the colour of a pad held down.
function drawRunner(g: CanvasRenderingContext2D, v: View, s: Scene) {
  const beat = s.beat, run = !!s.run;
  const bob = run ? Math.abs(Math.sin(beat * Math.PI)) * 0.08 : 0;
  const stride = run ? Math.sin(beat * Math.PI) : 0;
  const z = RUNNER_Z;
  const P = (x: number, y: number, dz = 0) => project(v, x, y + bob, z + dz);
  g.strokeStyle = "#fff";
  g.lineWidth = 2.5;
  g.beginPath();
  const [hx, hy] = P(0, 1.55);
  g.arc(hx, hy, v.f / z * 0.11, 0, Math.PI * 2);
  line(g, P(0, 1.42), P(0, 0.85));
  line(g, P(-0.2, 1.35), P(0.2, 1.35)); // shoulders
  line(g, P(-0.14, 0.85), P(0.14, 0.85)); // hips
  // Legs: one forward, one back, in the stride.
  line(g, P(-0.14, 0.85), P(-0.17, 0.02, stride * 0.35));
  line(g, P(0.14, 0.85), P(0.17, 0.02, -stride * 0.35));
  g.stroke();
  // Arms: swing against the legs, or reach to a pressed lane.
  const reach = [...s.down].at(-1);
  for (const side of [-1, 1] as const) {
    const sx = side * 0.2;
    g.strokeStyle = "#fff";
    g.beginPath();
    if (reach !== undefined && (side < 0 ? reach <= 1 : reach >= 2)) {
      const tx = laneX(reach) * 0.9;
      line(g, P(sx, 1.35), P(tx, 0.7, 0.4));
      g.stroke();
      g.strokeStyle = LANE_COLOR[reach];
      g.beginPath();
      const [fx, fy] = P(tx, 0.7, 0.4);
      g.arc(fx, fy, 4, 0, Math.PI * 2);
    } else {
      line(g, P(sx, 1.35), P(sx * 1.4, 0.9, -side * stride * 0.3));
    }
    g.stroke();
  }
}

function line(g: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
}
