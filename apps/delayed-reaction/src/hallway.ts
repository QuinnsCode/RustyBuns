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
export type Burst = { lane: Lane; beat: number; size: number; echoes: number; parts: Part[] };
// A particle's launch velocity in world units a beat (x across, y up, z down the corridor), and its heat:
// the hottest ones of a perfect burn white at the core.
export type Part = { vx: number; vy: number; vz: number; heat: number };

export function burst(lane: Lane, beat: number, size: number, rng = Math.random): Burst {
  // Bigger bursts throw more, up to 40, which a phone draws at 60 fps with a few echoes in flight.
  const parts = Array.from({ length: Math.min(40, Math.round(16 + 24 * size)) }, () => {
    const a = rng() * Math.PI * 2, s = 2 + rng() * 5;
    return { vx: Math.cos(a) * s, vy: 1.5 + rng() * 5, vz: Math.sin(a) * s * 0.7, heat: rng() };
  });
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

// Drag slows a particle to a stop within a beat or so, and a gentle pull draws it out to the wall it
// came off. Both are closed form, so a frame needs only the age, not last frame's state.
const DRAG = 3.5, PULL = 3;

/** Where a burst's particle is, relative to where it went off, `age` beats after. */
export function partAt(p: Part, age: number, size: number, out: readonly [number, number] = [0, -1]): [number, number, number] {
  const k = (1 - Math.exp(-DRAG * age)) / DRAG, ax = out[0] * PULL, ay = out[1] * PULL;
  // x(t) = (a/d) t + (v0 - a/d)(1 - e^(-d t)) / d: the velocity decays toward the drift the pull settles at.
  const at = (v: number, a: number) => (a / DRAG) * age + (v - a / DRAG) * k;
  return [at(p.vx, ax) * size, at(p.vy, ay) * size, at(p.vz, 0) * size];
}

function drawBursts(g: CanvasRenderingContext2D, v: View, bursts: Burst[], beat: number) {
  g.globalCompositeOperation = "lighter";
  for (const b of bursts) {
    const age = beat - b.beat;
    if (age < 0 || age > 1.2) continue;
    const fade = (1 - age / 1.2) ** 1.5;
    const lx = laneX(b.lane), col = LANE_COLOR[b.lane];
    // The wall it went off: straight out from the corridor's middle through the lane.
    const ox = lx, oy = -WALL / 2, len = Math.hypot(ox, oy), out = [ox / len, oy / len] as const;
    const at = (p: Part, t: number) => {
      const [x, y, z] = partAt(p, t, b.size, out);
      return project(v, lx + x, Math.max(0, 0.05 + y), RUNNER_Z + z);
    };
    // Each particle is a smear from where it was a moment ago to where it is now, so fast ones streak.
    const tail = Math.max(0, age - 0.1);
    g.strokeStyle = col;
    for (const pass of [0, 1]) {
      g.globalAlpha = fade * (pass ? 0.9 : 0.25);
      g.lineWidth = (pass ? 2.5 : 8) * (0.5 + b.size * 0.7);
      g.beginPath();
      for (const p of b.parts) {
        const [ax, ay] = at(p, tail), [bx, by] = at(p, age);
        g.moveTo(ax, ay); g.lineTo(bx + 0.01, by);
      }
      g.stroke();
    }
    // A perfect burns white at the core: the hottest particles get a thin white line over their colour.
    if (b.size >= 1) {
      g.strokeStyle = "#fff";
      g.globalAlpha = fade;
      g.lineWidth = 1.5;
      g.beginPath();
      for (const p of b.parts) {
        if (p.heat < 0.5) continue;
        const [ax, ay] = at(p, Math.max(0, age - 0.05)), [bx, by] = at(p, age);
        g.moveTo(ax, ay); g.lineTo(bx + 0.01, by);
      }
      g.stroke();
    }
    // The flash: the walls catch the colour for a moment.
    if (age < 0.15) {
      g.fillStyle = col;
      g.globalAlpha = (0.15 - age) * 1.5 * b.size;
      g.fillRect(0, 0, v.W, v.H);
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}
