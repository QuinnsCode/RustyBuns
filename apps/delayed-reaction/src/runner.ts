// The runner, from behind and above: a lean neon-outlined silhouette in a padded jacket, shades on and
// hair in the wind, sprinting away from the camera. Lines and curves on the canvas, no images.
//
// The pose comes from the scene: a sway while idle, a stride on the beat while running, a reach toward a
// pad held down, a stumble after a miss, and a forward lean with a streak behind when the run is boosted.
// The jacket and shades carry the runner's one accent colour; the hands take a held pad's lane colour.
import { LANE_COLOR, project, type Scene, type View } from "./hallway.ts";
import { SPEED_CEILING, SPEED_FLOOR, type Lane } from "./sim.ts";

export type RunnerScene = Pick<Scene, "run" | "beat" | "down"> & {
  speed?: number;      // run.speed: at the floor it cruises, above it leans in and streaks
  missBeat?: number;   // the beat of the last miss: the stumble plays out over the beat after it
  t?: number;          // seconds, for the idle sway and the hair when no song is running
};

type P3 = [number, number, number];

// Where hallway.ts stands the runner: the middle of the floor, this far ahead of the camera.
const RUNNER_Z = 4;
const GLOW = "#ece8ff", ACCENT = "#b48cff", BODY = "#0a0812";

const add = (a: P3, b: P3, k = 1): P3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mix = (a: P3, b: P3, k: number): P3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export type Pose = {
  hip: P3; neck: P3; head: P3; lean: number;
  legs: { side: -1 | 1; hip: P3; knee: P3; foot: P3; toe: P3 }[];
  arms: { side: -1 | 1; shoulder: P3; elbow: P3; hand: P3; lane?: Lane }[];
  boost: number; stumble: number; wind: number; t: number;
};

/** The runner's joints for this moment, in world units around (0, 0, RUNNER_Z). */
export function pose(s: RunnerScene): Pose {
  const running = !!s.run, t = s.t ?? 0, beat = s.beat;
  const boost = running ? clamp01(((s.speed ?? SPEED_FLOOR) - SPEED_FLOOR) / (SPEED_CEILING - SPEED_FLOOR)) : 0;
  const since = s.missBeat === undefined ? Infinity : beat - s.missBeat;
  const stumble = running && since >= 0 && since < 1 ? Math.sin(Math.min(1, since * 4) * Math.PI / 2) * (1 - since) ** 2 : 0;
  // One footfall a beat: the left foot lands on even beats, the right on odd.
  const phi = beat * Math.PI;
  const sway = running ? 0 : Math.sin(t * 1.7) * 0.03;
  const lean = running ? 0.2 + 0.35 * boost - 0.5 * stumble : 0.04;
  const roll = (running ? Math.sin(phi) * 0.04 : sway * 0.6) + stumble * 0.35 * (Math.floor(s.missBeat ?? 0) % 2 ? 1 : -1);
  const bob = running ? 0.07 * Math.abs(Math.sin(phi)) - 0.14 * stumble : 0.008 * Math.sin(t * 2.4);
  const hip: P3 = [sway, 0.92 + bob, 0];
  const up: P3 = [Math.sin(roll), Math.cos(lean) * Math.cos(roll), Math.sin(lean)];
  const neck = add(hip, up, 0.52), head = add(neck, up, 0.17);

  const legs = ([-1, 1] as const).map((side) => {
    const p = phi + (side > 0 ? Math.PI : 0);
    // Forward swing folds the knee high; the push back is nearly straight.
    const thigh = running ? 0.8 * Math.sin(p) + lean * 0.3 : 0.02;
    const bend = running ? 0.2 + 1.4 * Math.max(0, Math.cos(p)) : 0.08;
    const h = add(hip, [side * 0.11, 0, 0]);
    const splay = side * (0.04 + stumble * 0.16);
    const knee = add(h, [splay * 0.5, -Math.cos(thigh) * 0.46, Math.sin(thigh) * 0.46]);
    const shin = thigh - bend;
    const foot = add(knee, [splay * 0.5, -Math.cos(shin) * 0.46, Math.sin(shin) * 0.46]);
    foot[1] = Math.max(0.03, foot[1]);
    const toe = add(foot, [0, -0.02, 0.15]);
    return { side, hip: h, knee, foot, toe };
  });

  // The arm on each side reaches for the lanes on its side when one of them is held down.
  const held = [...s.down];
  const arms = ([-1, 1] as const).map((side) => {
    const p = phi + (side > 0 ? 0 : Math.PI);
    const shoulder = add(neck, [side * 0.24 * Math.cos(roll), -0.05 - side * 0.24 * Math.sin(roll), 0]);
    const lane = held.filter((l) => (side < 0 ? l <= 1 : l >= 2)).at(-1);
    let elbow: P3, hand: P3;
    if (lane !== undefined) {
      // A punch toward the lane: low and ahead, the arm nearly straight.
      hand = [(lane - 1.5) * 0.75, 0.62, 0.85];
      elbow = add(mix(shoulder, hand, 0.5), [side * 0.04, 0.06, 0]);
    } else {
      const swing = running ? 0.95 * Math.sin(p) * (1 + 0.3 * boost) : 0.06 * Math.sin(t * 1.7 + side);
      const fore = swing + (running ? 1.35 : 0.25);
      elbow = add(shoulder, [side * 0.03, -Math.cos(swing) * 0.29, Math.sin(swing) * 0.29]);
      hand = add(elbow, [-side * 0.05, -Math.cos(fore) * 0.27, Math.sin(fore) * 0.27]);
    }
    if (stumble > 0) {
      // Arms thrown out to catch the fall.
      elbow = mix(elbow, add(shoulder, [side * 0.28, 0.04, -0.06]), stumble);
      hand = mix(hand, add(shoulder, [side * 0.46, 0.3, -0.1]), stumble);
    }
    return { side, shoulder, elbow, hand, lane };
  });

  return { hip, neck, head, lean, legs, arms, boost, stumble, wind: running ? 1 + boost : 0.25, t: running ? beat : t };
}

export function drawRunner(g: CanvasRenderingContext2D, v: View, s: RunnerScene) {
  const q = pose(s);
  const P = (p: P3) => project(v, p[0], p[1], RUNNER_Z + p[2]);
  const px = v.f / RUNNER_Z; // pixels per world unit at the runner
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";

  // A glow on the floor under the feet, so the runner stands on something.
  const [sx, sy] = P([q.hip[0], 0, 0.05]);
  g.globalAlpha = 0.25;
  g.fillStyle = ACCENT;
  g.beginPath(); g.ellipse(sx, sy, 0.32 * px, 0.07 * px, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;

  // Boosted: streaks trail back toward the camera from the shoulders, hips and feet.
  if (q.boost > 0) {
    g.strokeStyle = ACCENT;
    g.lineWidth = 2;
    g.globalAlpha = 0.6 * q.boost;
    g.beginPath();
    for (const p of [...q.arms.map((a) => a.shoulder), ...q.legs.map((l) => l.hip), ...q.legs.map((l) => l.foot), q.head]) {
      const [ax, ay] = P(p), [bx, by] = P(add(p, [0, 0, -0.6 - 1.4 * q.boost]));
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  // Painter's order: whatever is further from the camera goes down first.
  const legs = [...q.legs].sort((a, b) => b.foot[2] - a.foot[2]);
  for (const l of legs) {
    limb(g, [P(l.hip), P(l.knee), P(l.foot)], 0.13 * px);
    // Sneakers with glowing soles.
    limb(g, [P(l.foot), P(l.toe)], 0.1 * px);
    g.strokeStyle = GLOW;
    g.lineWidth = 2;
    g.beginPath();
    const [fx, fy] = P(add(l.foot, [0, -0.04, -0.03])), [tx, ty] = P(add(l.toe, [0, -0.04, 0.02]));
    g.moveTo(fx, fy); g.lineTo(tx, ty);
    g.stroke();
  }
  const forward = q.arms.filter((a) => a.hand[2] > a.shoulder[2] + 0.05 && a.lane === undefined);
  const back = q.arms.filter((a) => !forward.includes(a));
  for (const a of forward) arm(g, a, P, px);
  jacket(g, q, P, px);
  for (const a of back) arm(g, a, P, px);
  headAndHair(g, q, P, px);
  g.restore();
}

type Proj = (p: P3) => [number, number];

/** A limb: a soft glow, a bright outline, and the dark body inside it, so it reads on any background. */
function limb(g: CanvasRenderingContext2D, pts: [number, number][], w: number) {
  const path = () => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  };
  path();
  g.strokeStyle = ACCENT; g.globalAlpha = 0.22; g.lineWidth = w + 7; g.stroke();
  g.globalAlpha = 1;
  g.strokeStyle = GLOW; g.lineWidth = w + 2.5; g.stroke();
  g.strokeStyle = BODY; g.lineWidth = Math.max(1, w); g.stroke();
}

function arm(g: CanvasRenderingContext2D, a: Pose["arms"][number], P: Proj, px: number) {
  limb(g, [P(a.shoulder), P(a.elbow), P(a.hand)], 0.1 * px);
  const [hx, hy] = P(a.hand);
  if (a.lane !== undefined) {
    // The fist lights in the lane's colour, with a few sparks off the knuckles.
    const col = LANE_COLOR[a.lane];
    g.fillStyle = col;
    g.globalAlpha = 0.3;
    g.beginPath(); g.arc(hx, hy, 0.14 * px, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(hx, hy, 0.055 * px + 1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + hx * 0.01;
      g.moveTo(hx + Math.cos(ang) * 0.09 * px, hy + Math.sin(ang) * 0.09 * px);
      g.lineTo(hx + Math.cos(ang) * 0.17 * px, hy + Math.sin(ang) * 0.17 * px);
    }
    g.stroke();
  } else {
    g.fillStyle = GLOW;
    g.beginPath(); g.arc(hx, hy, 0.032 * px + 0.5, 0, Math.PI * 2); g.fill();
  }
}

/** A padded 80s jacket seen from the back: wide shoulders, a popped collar, a cropped hem and a racing stripe. */
function jacket(g: CanvasRenderingContext2D, q: Pose, P: Proj, px: number) {
  const [L, R] = q.arms[0]!.side < 0 ? [q.arms[0]!, q.arms[1]!] : [q.arms[1]!, q.arms[0]!];
  const pad = (a: typeof L) => P(add(a.shoulder, [a.side * 0.07, 0.03, 0]));
  const top = (a: typeof L) => P(add(a.shoulder, [a.side * 0.02, 0.09, 0]));
  const waist = (side: number) => P(add(q.hip, [side * 0.16, 0.02, 0]));
  const hem = (side: number) => P(add(q.hip, [side * 0.17, -0.1, -0.02]));
  const [nx, ny] = P(add(q.neck, [0, -0.02, -0.03]));
  const [lpx, lpy] = pad(L), [rpx, rpy] = pad(R), [ltx, lty] = top(L), [rtx, rty] = top(R);
  const [lwx, lwy] = waist(-1), [rwx, rwy] = waist(1), [lhx, lhy] = hem(-1), [rhx, rhy] = hem(1);
  const [cx, cy] = P(add(q.hip, [0, -0.13, -0.02]));
  g.beginPath();
  g.moveTo(nx, ny);
  g.quadraticCurveTo(ltx, lty, lpx, lpy);
  g.bezierCurveTo(lpx, lpy + 0.2 * px, lwx - 0.02 * px, lwy - 0.1 * px, lwx, lwy);
  g.lineTo(lhx, lhy);
  g.quadraticCurveTo(cx, cy, rhx, rhy);
  g.lineTo(rwx, rwy);
  g.bezierCurveTo(rwx + 0.02 * px, rwy - 0.1 * px, rpx, rpy + 0.2 * px, rpx, rpy);
  g.quadraticCurveTo(rtx, rty, nx, ny);
  g.closePath();
  g.strokeStyle = ACCENT; g.globalAlpha = 0.22; g.lineWidth = 8; g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = BODY; g.fill();
  g.strokeStyle = GLOW; g.lineWidth = 2; g.stroke();
  // The stripe across the shoulder blades and the seam down the back.
  const [s0x, s0y] = P(add(L.shoulder, [0.02, -0.1, 0]));
  const [s1x, s1y] = P(add(R.shoulder, [-0.02, -0.1, 0]));
  const [mx, my] = P(add(mix(L.shoulder, R.shoulder, 0.5), [0, -0.16, 0]));
  g.strokeStyle = ACCENT;
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(s0x, s0y); g.quadraticCurveTo(mx, my, s1x, s1y); g.stroke();
  g.globalAlpha = 0.5;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(nx, ny + 0.06 * px); g.quadraticCurveTo(mx, my + 0.1 * px, cx, cy - 0.04 * px); g.stroke();
  g.globalAlpha = 1;
  // The popped collar: a band standing up round the back of the neck, wider at the top.
  const [c0x, c0y] = P(add(q.neck, [-0.09, -0.04, 0])), [c1x, c1y] = P(add(q.neck, [0.09, -0.04, 0]));
  const [c2x, c2y] = P(add(q.neck, [0.11, 0.07, -0.02])), [c3x, c3y] = P(add(q.neck, [-0.11, 0.07, -0.02]));
  const [cbx, cby] = P(add(q.neck, [0, -0.02, -0.08])), [ctx, cty] = P(add(q.neck, [0, 0.08, -0.1]));
  g.beginPath();
  g.moveTo(c0x, c0y); g.quadraticCurveTo(cbx, cby, c1x, c1y);
  g.lineTo(c2x, c2y); g.quadraticCurveTo(ctx, cty, c3x, c3y);
  g.closePath();
  g.fillStyle = BODY; g.fill();
  g.strokeStyle = GLOW; g.lineWidth = 1.5; g.stroke();
}

/** The back of the head under a mane of hair, the shades' band across it, and the lenses' edges at the temples. */
function headAndHair(g: CanvasRenderingContext2D, q: Pose, P: Proj, px: number) {
  const [hx, hy] = P(q.head), r = 0.115 * px;
  g.fillStyle = BODY;
  g.strokeStyle = ACCENT; g.globalAlpha = 0.22; g.lineWidth = 8;
  g.beginPath(); g.ellipse(hx, hy, r * 0.92, r, 0, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;
  g.fill();
  g.strokeStyle = GLOW; g.lineWidth = 2; g.stroke();
  // Hair: a swept-back mane from the crown down past the nape, its locks lifted and shaken by the wind.
  const at = (x: number, y: number, z: number) => P(add(q.head, [x, y, z]));
  const locks = 6, speed = q.wind > 0.5 ? 9 : 2;
  const tips: [number, number][] = [];
  for (let i = 0; i <= locks; i++) {
    const u = i / locks - 0.5;
    const shake = Math.sin(q.t * speed + i * 1.7) * 0.03 * q.wind;
    // The tips hang to the collar at rest and stream back and up as the runner speeds up.
    tips.push(at(u * 0.26 + shake, -0.2 + 0.05 * q.wind - Math.abs(u) * 0.03 + (i % 2) * 0.035, -0.05 - 0.12 * q.wind));
  }
  const [lx, ly] = at(-0.13, -0.06, 0.02), [rx, ry] = at(0.13, -0.06, 0.02);
  const [k0x, k0y] = at(-0.15, 0.2, 0), [k1x, k1y] = at(0.15, 0.2, 0);
  g.beginPath();
  g.moveTo(lx, ly);
  g.bezierCurveTo(k0x, k0y, k1x, k1y, rx, ry);
  for (let i = tips.length - 1; i >= 0; i--) {
    const [tx, ty] = tips[i]!;
    const [mx, my] = at((i / locks - 0.5) * 0.24, -0.12, -0.04);
    i === tips.length - 1 ? g.lineTo(tx, ty) : g.quadraticCurveTo(mx, my, tx, ty);
  }
  g.closePath();
  g.fillStyle = BODY; g.fill();
  g.strokeStyle = GLOW; g.lineWidth = 1.8; g.stroke();
  // A few strands drawn into the mane.
  g.globalAlpha = 0.55;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < locks; i += 2) {
    const [ax, ay] = at((i / locks - 0.5) * 0.1, 0.1, 0.01), [tx, ty] = tips[i]!;
    const [mx, my] = at((i / locks - 0.5) * 0.22, -0.04, -0.04);
    g.moveTo(ax, ay); g.quadraticCurveTo(mx, my, tx, ty);
  }
  g.stroke();
  g.globalAlpha = 1;
  // Shades: the band across the back of the head, and the lenses wrapping round past the temples.
  const [b0x, b0y] = at(-0.13, 0.01, 0.03), [b1x, b1y] = at(0.13, 0.01, 0.03), [bcx, bcy] = at(0, 0.03, -0.06);
  g.strokeStyle = ACCENT;
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(b0x, b0y); g.quadraticCurveTo(bcx, bcy, b1x, b1y); g.stroke();
  for (const [w, col] of [[5, ACCENT], [1.5, GLOW]] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    for (const side of [-1, 1]) {
      const [ax, ay] = at(side * 0.13, 0.01, 0.04), [ex, ey] = at(side * 0.17, -0.005, 0.1);
      g.moveTo(ax, ay); g.lineTo(ex, ey);
    }
    g.stroke();
  }
}
