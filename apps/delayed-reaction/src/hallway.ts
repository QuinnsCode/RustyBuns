// The tunnel: an infinite neon grid, thin near-white lines on black, seen from behind and above
// the runner, who runs away from the camera down the tunnel. The camera is strapped to the runner:
// as they run up the side of the pipe the whole pipe spins round them and they stay at the bottom
// of the screen. On top of that the tunnel rolls round its axis, one
// way, forever, and bends the same way as it rolls, so it is always rounding a corner and never
// arrives: an endless turn. Lanes are four places across the turning floor. Calls are rings of
// colour rushing at the runner: a tail of rings, one per beat from the call to its due beat, so the
// delay counts down in front of you, and where the due beat lands a solid wall fills the tunnel with
// one door, at the call's lane, in its colour. Colour only ever comes from a call or an answer: the
// tunnel itself has none.
import type { Call, Lane, Run } from "./sim.ts";

export const LANE_COLOR: Record<Lane, string> = { 0: "#ff5fa2", 1: "#ffc542", 2: "#4de3ff", 3: "#9dff5f" };

// World units: the tunnel has radius 3 with its floor at y = 0, the runner stands 4 ahead of the
// camera, which floats 2.2 above the floor. A beat is 1.8 units of tunnel at normal speed.
const R = 3, CAM_Y = 2.2, RUNNER_Z = 4, PER_BEAT = 1.8, FAR = 48, NEAR = 0.6;
const LINES = 16, SEGS = 22;
// The endless turn: the grid rolls this much a beat, always the same way, the long lines spiral
// with it, and the tunnel ahead bends off to the side the roll is heading, so it keeps rounding a
// corner. BEND is how far the axis has moved per unit of distance squared past the runner.
const ROLL = 0.14, TWIST = 0.045, BEND = 0.0035;

// Lanes are four places across the floor, far left to far right, in lane units: -1.5, -0.5, 0.5,
// 1.5. Each is an angle round the tunnel from the floor's lowest point: left pads on the left,
// right pads on the right, 0 straight down, positive clockwise as seen from behind.
export const LANE_X: Record<Lane, number> = { 0: -1.5, 1: -0.5, 2: 0.5, 3: 1.5 };
const PER_LANE = 1.4; // radians a lane unit is round the pipe: left and right about 40° up the sides, far left and far right about 120°, nearly on the roof
export const laneAngle = (x: number) => x * PER_LANE;
export const LANE_ANGLE: Record<Lane, number> = { 0: laneAngle(-1.5), 1: laneAngle(-0.5), 2: laneAngle(0.5), 3: laneAngle(1.5) };
// A door is this many radians either side of its lane, and reaches this far up from the floor (a share of R).
const DOOR = 0.24, DOOR_H = 0.55;

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

// The chase camera: strapped to the runner, behind and above, so the runner is always at the
// bottom of the screen and the whole pipe spins round them as they move up its sides. `cam` is the
// roll of the pipe on the screen, chasing minus the runner's lane angle on a slightly underdamped
// spring, so a sidestep swings the world round and then settles with a little overshoot.
let cam = 0, camVel = 0, camBeat: number | undefined;
const CHASE = 70, DAMP = 12; // spring stiffness and damping, per beat

/** Advance the camera toward the runner's lane position x at `beat`; returns the pipe's roll. */
export function chase(x: number, beat: number): number {
  const target = -laneAngle(x);
  let dt = camBeat === undefined ? 0 : Math.min(0.5, Math.max(0, beat - camBeat));
  camBeat = beat;
  while (dt > 0) {
    const h = Math.min(dt, 1 / 60);
    camVel += (CHASE * (target - cam) - DAMP * camVel) * h;
    cam += camVel * h;
    dt -= h;
  }
  return cam;
}

/** Put the camera straight on the runner's lane position x, no swing. */
export function snapCamera(x: number) {
  cam = -laneAngle(x);
  camVel = 0;
  camBeat = undefined;
}

/** A tunnel angle as the screen sees it, once the camera has rolled the pipe. */
const seen = (theta: number) => theta + cam;

/** The tunnel's radius at a screen angle and distance: it breathes and swells on the kick, but never at the bottom of the screen, under the runner's feet. */
export function radius(theta: number, z: number, beat: number) {
  return R * (1 + 0.06 * Math.sin(3 * theta) ** 2 * Math.sin(z * 0.35 - beat * 0.9)) * (1 + kickAt(beat) * 0.025);
}

/** Where the tunnel's axis is at distance z: straight under the runner, then bending off, further
 * the further ahead, toward wherever the roll is heading right now, so the corner keeps turning.
 * The bend rolls with the camera, like the rest of the pipe. */
export function axis(z: number, beat: number): [number, number] {
  const d = Math.max(0, z - RUNNER_Z), bend = BEND * d * d, way = beat * ROLL * 0.5 + cam;
  return [Math.sin(way) * bend, R + Math.cos(way) * bend * 0.6];
}

/** A point on the tunnel wall, at an angle from the runner's floor and a distance ahead, on the screen. */
export function wall(v: View, theta: number, z: number, beat: number): [number, number] {
  const t = seen(theta), r = radius(t, z, beat), [ax, ay] = axis(z, beat);
  return project(v, ax + r * Math.sin(t), ay - r * Math.cos(t), z);
}

/** Where the floor is at lane position x (-1.5 far left to 1.5 far right) and depth z: the screen
 * point, and the floor's tilt there in radians (the angle of its slope on the screen, so a canvas
 * rotated by it draws standing upright on the turning floor). Doors sit on the same points, and
 * with the camera chasing x this lands at the bottom of the screen, level. */
export function floorAt(v: View, x: number, z: number, beat: number): { x: number; y: number; tilt: number } {
  const [sx, sy] = wall(v, laneAngle(x), z, beat);
  const [lx, ly] = wall(v, laneAngle(x - 0.05), z, beat), [rx, ry] = wall(v, laneAngle(x + 0.05), z, beat);
  return { x: sx, y: sy, tilt: Math.atan2(ry - ly, rx - lx) };
}

/** Where a lane's door meets the floor at distance z. */
export const lanePoint = (v: View, lane: Lane, z: number, beat: number) => wall(v, LANE_ANGLE[lane], z, beat);

const ringZ = (b: number, beat: number, speed: number) => RUNNER_Z + (b - beat) * PER_BEAT * speed;

// A hit explodes in its lane's colour. The dub echo repeats it `delay` beats later, smaller, up to
// three times, so what you see is what the delay line is doing. A burst with an `x` goes off at the door
// the runner went through (lane units across the floor, -1.5 far left to 1.5 far right); without one it
// goes off on the lane's wall.
export type Burst = { lane: Lane; beat: number; size: number; echoes: number; parts: Part[]; x?: number };
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
      bursts.push({ ...burst(b.lane, b.beat + delay, b.size * 0.55), x: b.x, echoes: 0 });
    }
  }
  const alive = bursts.filter((b) => beat - b.beat < 1.2);
  bursts.length = 0;
  bursts.push(...alive);
}

/** speed: 1 is normal; a boost rushes the tunnel faster, a wall drags it. x: the runner's lane
 * position, -1.5 far left to 1.5 far right, which the camera chases. */
export type Scene = { run: Run | null; beat: number; down: ReadonlySet<Lane>; bursts: Burst[]; speed: number; x?: number };

/** The view for this frame: on each kick the tunnel lurches a touch closer, and the vanishing point
 * drifts in a slow figure, so the whole thing sways like it is breathing. The runner shares it, so
 * they stay on the floor while it moves. */
export function sway(v: View, beat: number, running: boolean): View {
  const kick = running ? kickAt(beat) : 0;
  return { ...v, f: v.f * (1 + kick * 0.04), cx: v.cx + Math.sin(beat * 0.37) * v.W * 0.02, hy: v.hy + Math.cos(beat * 0.23) * v.H * 0.012 };
}

export function drawTunnel(g: CanvasRenderingContext2D, v: View, s: Scene) {
  const { W, H } = v;
  const beat = s.beat, speed = s.speed || 1;
  chase(s.x ?? 0, beat);
  // The last frame stays as a ghost: everything that moves leaves a trail. Faster means longer trails.
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.fillStyle = `rgba(0,0,0,${Math.max(0.22, 0.5 / speed)})`;
  g.fillRect(0, 0, W, H);
  g.lineCap = "round";
  g.lineJoin = "round";
  // The kick: the lines flash brighter on each beat.
  const kick = s.run ? kickAt(beat) : 0;
  // Near-white, but the white itself drifts: a cold blue-white one minute, a warm pink-white the next.
  const hue = 215 + Math.sin(beat * 0.045) * 110;
  const white = (a: number) => `hsla(${hue},70%,93%,${Math.min(1, a + kick * 0.25)})`;
  g.globalCompositeOperation = "lighter";

  // Long lines: a helix that spirals the way the tunnel rolls, always the same way, so the grid
  // screws itself down the bend. A second, fainter grid rolls the same way at a slower rate, and
  // where the two cross the lines beat against each other: a moiré that crawls round the walls.
  const roll = beat * ROLL;
  g.setLineDash([]);
  for (const [rate, alpha, width] of [[1, 0.55, 1.2], [0.55, 0.16, 1]] as const) {
    g.lineWidth = width;
    g.strokeStyle = white(alpha);
    for (let k = 0; k < LINES; k++) {
      const base = (k / LINES) * Math.PI * 2 + roll * rate + (rate < 1 ? Math.PI / LINES : 0);
      g.beginPath();
      for (let i = 0; i <= SEGS; i++) {
        const z = NEAR * Math.pow(FAR / NEAR, i / SEGS);
        const [x, y] = wall(v, base + TWIST * z, z, beat);
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
    for (const c of calls.sort((a, b) => b.due - a.due)) drawCall(g, v, c, beat, speed);
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

function ring(g: CanvasRenderingContext2D, v: View, z: number, beat: number, from = 0, to = Math.PI * 2, n = 48) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const [x, y] = wall(v, from + ((to - from) * i) / n, z, beat);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}

// A call is a tail of rings: the call itself bright, under the runner when it sounds, then one ring
// a beat ahead, dimmer each, out to the due beat `delay` beats on. There, a solid wall fills the
// tunnel, neon grid in the call's colour, with one door at the call's lane: run through the door
// or into the wall. A hold's door stretches into a corridor until the hold ends.
function drawCall(g: CanvasRenderingContext2D, v: View, c: Call, beat: number, speed: number) {
  const delay = c.due - c.beat;
  const gone = c.state === "hit" || c.state === "missed";
  const col = c.state === "missed" ? "#777" : LANE_COLOR[c.lane];
  const theta = LANE_ANGLE[c.lane];
  const n = Math.max(1, Math.round(delay));
  g.strokeStyle = col;
  for (let k = 0; k < n; k++) {
    const z = ringZ(c.beat + (k * delay) / n, beat, speed);
    if (z < NEAR || z > FAR) continue;
    const near = Math.min(1, 9 / z);
    const a = (gone ? 0.3 : 1) * near * Math.pow(0.72, k) * (k === 0 ? 1.3 : 1);
    // A glowing band: wide and faint, then thin and bright, brightest round the lane.
    g.lineWidth = 6 * near;
    g.globalAlpha = a * 0.18;
    ring(g, v, z, beat);
    g.lineWidth = 1.4;
    g.globalAlpha = a * 0.6;
    ring(g, v, z, beat);
    g.lineWidth = 3 * near;
    g.globalAlpha = a;
    ring(g, v, z, beat, theta - DOOR, theta + DOOR, 8);
  }
  const z = ringZ(c.due, beat, speed);
  if (z >= NEAR && z <= FAR) drawWall(g, v, c, z, beat, speed, col, gone);
  g.globalAlpha = 1;
}

// The wall: spokes from the axis and rings in toward it, dense enough to read as solid, with the
// door cut out of them: a sector of the disc round the lane, from the floor up. The door's frame
// glows in the lane's colour, white-hot at the floor where you run through.
function drawWall(g: CanvasRenderingContext2D, v: View, c: Call, z: number, beat: number, speed: number, col: string, gone: boolean) {
  const theta = LANE_ANGLE[c.lane];
  const near = Math.min(1, 9 / z), a = (gone ? 0.3 : 1) * near;
  const inDoor = (t: number) => Math.abs(((t - theta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < DOOR;
  const at = (t0: number, share: number, zz = z): [number, number] => {
    const t = seen(t0), r = radius(t, zz, beat) * share, [ax, ay] = axis(zz, beat);
    return project(v, ax + r * Math.sin(t), ay - r * Math.cos(t), zz);
  };
  // The solid: a faint fill over the whole disc, the door left clear.
  g.fillStyle = col;
  g.globalAlpha = a * 0.1;
  g.beginPath();
  for (let i = 0; i <= 72; i++) {
    const t = theta + DOOR + ((Math.PI * 2 - DOOR * 2) * i) / 72;
    const [x, y] = at(t, 1);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  for (let i = 8; i >= 0; i--) { const [x, y] = at(theta - DOOR + (DOOR * 2 * i) / 8, 1 - DOOR_H); g.lineTo(x, y); }
  g.closePath();
  g.fill();
  // The grid: spokes, cut short where they would cross the door, and rings, broken at it.
  g.strokeStyle = col;
  g.lineWidth = 1;
  g.globalAlpha = a * 0.55;
  g.beginPath();
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2 - Math.PI;
    const [x0, y0] = at(t, 0), [x1, y1] = at(t, inDoor(t) ? 1 - DOOR_H : 1);
    g.moveTo(x0, y0); g.lineTo(x1, y1);
  }
  for (const share of [0.18, 0.36, 0.54, 0.72, 0.88]) {
    let pen = false;
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * Math.PI * 2 - Math.PI;
      if (share > 1 - DOOR_H && inDoor(t)) { pen = false; continue; }
      const [x, y] = at(t, share);
      pen ? g.lineTo(x, y) : g.moveTo(x, y);
      pen = true;
    }
  }
  g.stroke();
  // The door frame: up one side, over the top, down the other, glowing; the sill burns white-hot.
  const frame = (zz: number, width: number, alpha: number) => {
    g.lineWidth = width;
    g.globalAlpha = alpha;
    g.beginPath();
    const [lx, ly] = wall(v, theta - DOOR, zz, beat), [rx, ry] = wall(v, theta + DOOR, zz, beat);
    g.moveTo(lx, ly);
    for (let i = 0; i <= 8; i++) { const [x, y] = at(theta - DOOR + (DOOR * 2 * i) / 8, 1 - DOOR_H, zz); g.lineTo(x, y); }
    g.lineTo(rx, ry);
    g.stroke();
  };
  frame(z, 8 * near, a * 0.25);
  frame(z, 2, a);
  g.strokeStyle = "#fff";
  g.lineWidth = 2 * near;
  g.globalAlpha = a * 0.9;
  ring(g, v, z, beat, theta - DOOR, theta + DOOR, 8);
  // A hold: the door runs on as a corridor to the release beat, and glows while held.
  if (c.hold) {
    const zEnd = Math.min(FAR, ringZ(c.due + c.hold, beat, speed));
    g.strokeStyle = col;
    g.globalAlpha = a * (c.state === "held" ? 0.8 : 0.4);
    g.lineWidth = 2;
    g.beginPath();
    for (const t of [theta - DOOR, theta + DOOR]) {
      const [x0, y0] = wall(v, t, z, beat), [x1, y1] = wall(v, t, zEnd, beat);
      g.moveTo(x0, y0); g.lineTo(x1, y1);
      const [tx0, ty0] = at(t, 1 - DOOR_H), [tx1, ty1] = at(t, 1 - DOOR_H, zEnd);
      g.moveTo(tx0, ty0); g.lineTo(tx1, ty1);
    }
    g.stroke();
    if (zEnd > z) { g.lineWidth = 1.5; frame(zEnd, 1.5, a * 0.6); }
  }
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
    // Where it went off: the door the runner ran through, a little ahead of them at chest height; or,
    // with no door, the lane's point on the wall. Either way it is pulled straight back out to the wall.
    const door = b.x !== undefined, theta = seen(door ? laneAngle(b.x ?? 0) : LANE_ANGLE[b.lane]), col = LANE_COLOR[b.lane];
    const out = [Math.sin(theta), -Math.cos(theta)] as const, lift = door ? R - 0.6 : R;
    const lx = lift * out[0], ly = R + lift * out[1], dz = door ? 0.4 : 0;
    const at = (p: Part, t: number) => {
      const [x, y, z] = partAt(p, t, b.size, out);
      return project(v, lx + x, ly + Math.max(0, 0.05 + y), RUNNER_Z + dz + z);
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
