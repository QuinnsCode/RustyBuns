// The tunnel: an infinite neon grid, thin near-white lines on black, seen from behind and above
// the runner, who runs away from the camera down the tunnel. The tunnel rolls slowly round its axis
// so the floor turns under the camera, its long lines twist into a helix that keeps changing its
// mind, and its walls breathe. Lanes are four angles round the tunnel, not columns on a floor.
// Calls are rings of colour rushing at the runner: a tail of rings, one per beat from the call to
// its due beat, so the delay counts down in front of you. Colour only ever comes from a call or an
// answer: the tunnel itself has none.
import type { Call, Lane, Run } from "./sim.ts";

export const LANE_COLOR: Record<Lane, string> = { 0: "#ff5fa2", 1: "#ffc542", 2: "#4de3ff", 3: "#9dff5f" };

// World units: the tunnel has radius 3 with its floor at y = 0, the runner stands 4 ahead of the
// camera, which floats 2.2 above the floor. A beat is 1.8 units of tunnel at normal speed.
const R = 3, CAM_Y = 2.2, RUNNER_Z = 4, PER_BEAT = 1.8, FAR = 48, NEAR = 0.6;
const LINES = 16, SEGS = 22;

// Lanes are angles round the tunnel measured from the floor under the runner: left pads on the
// left wall, right pads on the right. 0 is straight down, positive is clockwise as seen from behind.
export const LANE_ANGLE: Record<Lane, number> = { 0: -0.72, 1: -0.24, 2: 0.24, 3: 0.72 };
const OPEN = 0.3; // half-width of the open part of a fence, in radians

export type View = { W: number; H: number; f: number; cx: number; hy: number };

export function view(W: number, H: number): View {
  // The vanishing point sits in the top third; focal length from the width so the tunnel fills it.
  return { W, H, f: Math.min(W * 0.8, H * 0.7), cx: W / 2, hy: H * 0.34 };
}

/** A world point to the screen; z is distance ahead of the camera. */
export function project(v: View, x: number, y: number, z: number): [number, number] {
  const s = v.f / z;
  return [v.cx + x * s, v.hy + (CAM_Y - y) * s];
}

/** How hard the kick is hitting right now: 1 on the beat, gone a quarter-beat later. */
const kickAt = (beat: number) => Math.max(0, 1 - (((beat % 1) + 1) % 1) * 4);

/** The tunnel's radius at an angle and distance: it breathes and swells on the kick, but never under the runner's feet. */
export function radius(theta: number, z: number, beat: number) {
  return R * (1 + 0.07 * Math.sin(3 * theta) * Math.sin(z * 0.35 - beat * 0.9)) * (1 + kickAt(beat) * 0.025);
}

/** A point on the tunnel wall, at an angle from the floor and a distance ahead, on the screen. */
export function wall(v: View, theta: number, z: number, beat: number): [number, number] {
  const r = radius(theta, z, beat);
  return project(v, r * Math.sin(theta), R - r * Math.cos(theta), z);
}

/** Where a lane's ring meets the wall at distance z. */
export const lanePoint = (v: View, lane: Lane, z: number, beat: number) => wall(v, LANE_ANGLE[lane], z, beat);

const ringZ = (b: number, beat: number, speed: number) => RUNNER_Z + (b - beat) * PER_BEAT * speed;

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

/** speed: 1 is normal; a boost rushes the tunnel faster, a fence drags it. */
export type Scene = { run: Run | null; beat: number; down: ReadonlySet<Lane>; bursts: Burst[]; speed: number };

export function drawTunnel(g: CanvasRenderingContext2D, v0: View, s: Scene) {
  const { W, H } = v0;
  const beat = s.beat, speed = s.speed || 1;
  // The last frame stays as a ghost: everything that moves leaves a trail. Faster means longer trails.
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.fillStyle = `rgba(0,0,0,${Math.max(0.22, 0.5 / speed)})`;
  g.fillRect(0, 0, W, H);
  g.lineCap = "round";
  g.lineJoin = "round";
  // The kick: the lines flash brighter on each beat and the whole tunnel lurches a touch closer,
  // and the vanishing point drifts in a slow figure, so the tunnel sways like it is breathing.
  const kick = s.run ? kickAt(beat) : 0;
  const v: View = { ...v0, f: v0.f * (1 + kick * 0.04), cx: v0.cx + Math.sin(beat * 0.37) * W * 0.02, hy: v0.hy + Math.cos(beat * 0.23) * H * 0.012 };
  // Near-white, but the white itself drifts: a cold blue-white one minute, a warm pink-white the next.
  const hue = 215 + Math.sin(beat * 0.045) * 110;
  const white = (a: number) => `hsla(${hue},70%,93%,${Math.min(1, a + kick * 0.25)})`;
  g.globalCompositeOperation = "lighter";

  // Long lines: a helix whose twist slowly reverses, rolling round the axis. Each line twists a
  // little differently from its neighbours, so they weave over and under each other on the way down.
  const roll = beat * 0.11, twist = Math.sin(beat * 0.07) * 0.07;
  // A second, fainter grid rolls the other way through the first, and where they cross the lines
  // beat against each other: a moiré that crawls round the walls.
  g.setLineDash([]);
  for (const [dir, alpha, width] of [[1, 0.55, 1.2], [-0.6, 0.16, 1]] as const) {
    g.lineWidth = width;
    g.strokeStyle = white(alpha);
    for (let k = 0; k < LINES; k++) {
      const base = (k / LINES) * Math.PI * 2 + roll * dir + (dir < 0 ? Math.PI / LINES : 0);
      const weave = (twist + 0.03 * Math.sin(beat * 0.31 + k * 1.7)) * dir;
      g.beginPath();
      for (let i = 0; i <= SEGS; i++) {
        const z = NEAR * Math.pow(FAR / NEAR, i / SEGS);
        const [x, y] = wall(v, base + weave * z, z, beat);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  // Cross rings every beat, so the tunnel rushes past at the song's speed. Bars are brighter.
  const first = Math.ceil(beat - RUNNER_Z / (PER_BEAT * speed));
  for (let b = first; ringZ(b, beat, speed) < FAR; b++) {
    const z = ringZ(b, beat, speed);
    if (z < NEAR) continue;
    const bar = ((b % 4) + 4) % 4 === 0;
    // On each bar a wave of light leaves the runner and runs down the tunnel ahead of them.
    const wave = s.run ? Math.max(0, Math.cos((z - RUNNER_Z) * 0.25 - (((beat % 4) + 4) % 4) * 2.2)) ** 6 : 0;
    g.strokeStyle = white((bar ? 0.6 : 0.22) * Math.min(1, 6 / z) + wave * 0.5);
    g.lineWidth = bar ? 1.6 : 1;
    ring(g, v, z, beat);
  }

  if (s.run) {
    // Calls: far ones first so near ones draw over them.
    const calls = s.run.chart.calls.filter((c) => c.beat <= beat + 0.02 && c.due + c.hold - beat > -0.6 && ringZ(c.beat, beat, speed) < FAR);
    for (const c of calls.sort((a, b) => b.due - a.due)) drawCall(g, v, c, beat, speed, s.run.chart.delay);
    // The queue you carry: a dot per call in flight, hovering over the runner's head in order.
    const inFlight = s.run.chart.calls.filter((c) => c.beat <= beat && (c.state === "pending" || c.state === "held"));
    inFlight.forEach((c, i) => {
      const [x, y] = project(v, 0, 2.4 + i * 0.22, RUNNER_Z);
      g.fillStyle = LANE_COLOR[c.lane];
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    });
  }

  drawBursts(g, v, s.bursts, beat);
  g.globalCompositeOperation = "source-over";
  drawRunner(g, v, s);
}

/** @deprecated the hallway became a tunnel; main.ts imports drawTunnel. */
export const drawHallway = drawTunnel;

function ring(g: CanvasRenderingContext2D, v: View, z: number, beat: number, from = 0, to = Math.PI * 2, n = 48) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const [x, y] = wall(v, from + ((to - from) * i) / n, z, beat);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}

// A call is a tail of rings: the call itself bright, under the runner when it sounds, then one ring
// a beat ahead, dimmer each, out to the due ring `delay` beats on. The due ring is where you answer:
// its wall is open round the lane and fenced everywhere else, and the lane's arc burns brightest.
function drawCall(g: CanvasRenderingContext2D, v: View, c: Call, beat: number, speed: number, delay: number) {
  const gone = c.state === "hit" || c.state === "missed";
  const col = c.state === "missed" ? "#777" : LANE_COLOR[c.lane];
  const theta = LANE_ANGLE[c.lane];
  const n = Math.max(1, Math.round(delay));
  g.strokeStyle = col;
  g.fillStyle = col;
  for (let k = 0; k <= n; k++) {
    const z = ringZ(c.beat + (k * delay) / n, beat, speed);
    if (z < NEAR || z > FAR) continue;
    const near = Math.min(1, 9 / z);
    const due = k === n;
    const fade = due ? 1 : Math.pow(0.72, k) * (k === 0 ? 1.3 : 1);
    const a = (gone ? 0.3 : 1) * near * fade;
    // A glowing band: wide and faint, then thin and bright, brightest round the lane.
    g.lineWidth = (due ? 9 : 6) * near;
    g.globalAlpha = a * 0.18;
    ring(g, v, z, beat);
    g.lineWidth = due ? 2 : 1.4;
    g.globalAlpha = a * (due ? 0.9 : 0.6);
    ring(g, v, z, beat);
    g.lineWidth = (due ? 5 : 3) * near;
    g.globalAlpha = a;
    ring(g, v, z, beat, theta - OPEN, theta + OPEN, 8);
    if (!due) continue;
    // The open part burns white-hot at its core: that is the hole you run through.
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5 * near;
    g.globalAlpha = a * 0.9;
    ring(g, v, z, beat, theta - OPEN * 0.8, theta + OPEN * 0.8, 8);
    // The fence: a dashed digital grid across the tunnel in the lane's colour, open only round the
    // lane. Spokes from the axis and two inner rings.
    g.setLineDash([3, 6]);
    g.lineWidth = 1;
    g.globalAlpha = a * (c.state === "held" ? 0.5 : 0.3);
    g.strokeStyle = col;
    const axis = project(v, 0, R, z);
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2 - Math.PI;
      if (Math.abs(t - theta) < OPEN) continue;
      const [x, y] = wall(v, t, z, beat);
      g.moveTo(axis[0], axis[1]); g.lineTo(x, y);
    }
    g.stroke();
    for (const r of [0.45, 0.75]) {
      g.beginPath();
      for (let i = 0; i <= 36; i++) {
        const t = (i / 36) * Math.PI * 2;
        const rr = radius(t, z, beat) * r;
        const [x, y] = project(v, rr * Math.sin(t), R - rr * Math.cos(t), z);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = col;
    // A hold: the open arc stretches on to the release ring, and glows while held.
    if (c.hold) {
      const zEnd = Math.min(FAR, ringZ(c.due + c.hold, beat, speed));
      g.globalAlpha = a * (c.state === "held" ? 0.7 : 0.3);
      g.lineWidth = 4 * near;
      g.beginPath();
      for (const t of [theta - OPEN, theta + OPEN]) {
        const [x0, y0] = wall(v, t, Math.max(NEAR, z), beat), [x1, y1] = wall(v, t, zEnd, beat);
        g.moveTo(x0, y0); g.lineTo(x1, y1);
      }
      g.stroke();
      if (zEnd > NEAR) ring(g, v, zEnd, beat, theta - OPEN, theta + OPEN, 8);
    }
  }
  g.globalAlpha = 1;
}

function drawBursts(g: CanvasRenderingContext2D, v: View, bursts: Burst[], beat: number) {
  for (const b of bursts) {
    const age = beat - b.beat;
    if (age < 0 || age > 1.2) continue;
    const fade = 1 - age / 1.2;
    const theta = LANE_ANGLE[b.lane];
    const lx = R * Math.sin(theta), ly = R - R * Math.cos(theta);
    g.strokeStyle = LANE_COLOR[b.lane];
    g.fillStyle = LANE_COLOR[b.lane];
    // A ring on the wall, then sparks thrown up and out, pulled back down.
    g.globalAlpha = fade * 0.8;
    g.lineWidth = 2 + b.size * 2;
    const r = (0.2 + age * 1.6) * b.size;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const [x, y] = project(v, lx + Math.cos(a) * r, ly + 0.02, RUNNER_Z + Math.sin(a) * r * 0.6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    for (const p of b.parts) {
      const d = p.v * age * b.size, h = Math.max(0, p.up * age - 2.2 * age * age) * b.size;
      const [x, y] = project(v, lx + Math.cos(p.a) * d, ly + h, RUNNER_Z + Math.sin(p.a) * d * 0.6);
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

// The runner, from behind: a stub figure with a bob and a stride on the beat, who reaches out to
// the lane being pressed. The real runner (jacket, hair, visor) replaces this.
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
  line(g, P(-0.14, 0.85), P(-0.17, 0.02, stride * 0.35));
  line(g, P(0.14, 0.85), P(0.17, 0.02, -stride * 0.35));
  g.stroke();
  const reach = [...s.down].at(-1);
  for (const side of [-1, 1] as const) {
    const sx = side * 0.2;
    g.strokeStyle = "#fff";
    g.beginPath();
    if (reach !== undefined && (side < 0 ? reach <= 1 : reach >= 2)) {
      const tx = R * Math.sin(LANE_ANGLE[reach]) * 0.6;
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
