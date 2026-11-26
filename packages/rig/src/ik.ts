// The found skeleton as a closed-chain-ik system. Every joint is a ball joint
// (three rotations) pivoting at its own position, the root also translates, and
// the tips are goals: a pinned tip stays where it is while you drag another.
// Pinning the root or clasping two tips together closes a loop, which is what
// closed-chain-ik is for.
import { DOF, Goal, Joint, Link, Solver, IKUtils } from "closed-chain-ik/core";

const LIMIT = Math.PI * 0.8;

/**
 * How hard the solver damps each step (#3138). The library's 0.001 leaves a rig with many free tips (a hydra's heads)
 * near singular, so a solved tip shivers frame to frame while its goal moves smoothly; `settle` (0.1) stills it, lands
 * the tips closer to slow goals and lets pinned feet slip less (0.01 to 0.05 is worse, and more iterations don't help).
 * But a heavily damped step is small, so a deliberate fast swing (a shake, a tail flung up) falls short of its goal:
 * pass `strike` while one plays.
 */
export const DAMP = { settle: 0.1, strike: 0.001 } as const;

// The shipped .d.ts lags the JS: updateMatrixWorld takes updateChildren, and dof holds DOF values.
const updateTree = (f: Link) => (f.updateMatrixWorld as (children?: boolean) => void).call(f, true);
type Dof = Parameters<Joint["setDoFValue"]>[0];

/** A joint's range about its x, y and z axes from the rest pose, in radians (Euler, the solver's order). */
export type JointLimit = { min: readonly [number, number, number]; max: readonly [number, number, number] };

export class IkRig {
  readonly links: Link[] = [];
  readonly joints: Joint[] = [];
  readonly tips: number[] = [];
  /** tip index -> its goal, while pinned */
  readonly goals = new Map<number, Goal>();
  private world = new Link();
  private rootGoal: Goal | null = null;
  private claspGoal: { goal: Goal; a: number; b: number } | null = null;
  private solver: Solver;

  /** `limit(j)` is how far joint j may turn about each axis from its rest pose, in radians (default 0.8 pi), or a
   *  `JointLimit` with its own range per axis: a finger's knuckle that only curls one way, a hinge with one axis free
   *  (an axis whose min and max are both 0 is not a degree of freedom at all). */
  constructor(pos: Float32Array, readonly parents: Int32Array, limit: (j: number) => number | JointLimit = () => LIMIT) {
    const J = parents.length;
    const hasKids = new Array<boolean>(J).fill(false);
    for (const p of parents) if (p >= 0) hasKids[p] = true;
    for (let j = 0; j < J; j++) {
      const joint = new Joint();
      joint.name = `j${j}`;
      const p = parents[j];
      if (p < 0) {
        joint.setDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
        joint.setPosition(pos[0], pos[1], pos[2]);
        this.world.addChild(joint);
      } else {
        joint.setPosition(pos[j * 3] - pos[p * 3], pos[j * 3 + 1] - pos[p * 3 + 1], pos[j * 3 + 2] - pos[p * 3 + 2]);
        if (hasKids[j]) {
          const lim = limit(j);
          if (typeof lim === "number") {
            joint.setDoF(DOF.EX, DOF.EY, DOF.EZ);
            joint.setMinLimits(-lim, -lim, -lim);
            joint.setMaxLimits(lim, lim, lim);
          } else {
            const axes = [0, 1, 2].filter((a) => lim.min[a] !== 0 || lim.max[a] !== 0);
            joint.setDoF(...axes.map((a) => [DOF.EX, DOF.EY, DOF.EZ][a]));
            joint.setMinLimits(...axes.map((a) => lim.min[a]));
            joint.setMaxLimits(...axes.map((a) => lim.max[a]));
          }
        } else {
          this.tips.push(j);
        }
        this.links[p].addChild(joint);
      }
      const link = new Link();
      link.name = `l${j}`;
      joint.addChild(link);
      this.joints.push(joint);
      this.links.push(link);
    }
    // ease back toward the rest pose when nothing is pulling
    IKUtils.saveRestPose(this.world);
    this.solver = new Solver(this.world);
    this.solver.maxIterations = 6;
    this.solver.restPoseFactor = 0.02;
    this.solver.dampingFactor = DAMP.settle;
    updateTree(this.world);
    for (const t of this.tips) this.setPinned(t, true);
    this.setRootPinned(true);
  }

  worldPosition(j: number): [number, number, number] {
    const p: [number, number, number] = [0, 0, 0];
    this.links[j].getWorldPosition(p);
    return p;
  }

  setPinned(tip: number, on: boolean) {
    const had = this.goals.get(tip);
    if (on && !had) {
      const g = new Goal();
      g.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
      const p = this.worldPosition(tip);
      g.setPosition(p[0], p[1], p[2]);
      g.makeClosure(this.links[tip]);
      this.goals.set(tip, g);
    } else if (!on && had) {
      had.removeChild(this.links[tip]);
      this.goals.delete(tip);
    } else return;
    this.solver.updateStructure();
  }

  get rootPinned() { return this.rootGoal !== null; }

  /** A free root lets the body move: drag a hand and the hips follow, while pinned feet stay put. */
  setRootPinned(on: boolean) {
    if (on === this.rootPinned) return;
    if (on) {
      const g = new Goal();
      const p = this.worldPosition(0), q: number[] = [0, 0, 0, 1];
      this.links[0].getWorldQuaternion(q);
      g.setPosition(p[0], p[1], p[2]);
      g.setQuaternion(q[0], q[1], q[2], q[3]);
      g.makeClosure(this.links[0]);
      this.rootGoal = g;
    } else {
      this.rootGoal!.removeChild(this.links[0]);
      this.rootGoal = null;
    }
    this.solver.updateStructure();
  }

  get clasped(): [number, number] | null { return this.claspGoal ? [this.claspGoal.a, this.claspGoal.b] : null; }

  /** Join tip b to tip a: a goal riding on a's link, closed onto b's. Drag a and b comes along. */
  clasp(a: number, b: number) {
    this.unclasp();
    this.setPinned(b, false);
    const g = new Goal();
    g.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
    this.links[a].addChild(g);
    g.makeClosure(this.links[b]);
    this.claspGoal = { goal: g, a, b };
    this.solver.updateStructure();
  }

  unclasp() {
    if (!this.claspGoal) return;
    const { goal, a, b } = this.claspGoal;
    goal.removeChild(this.links[b]);
    this.links[a].removeChild(goal);
    this.claspGoal = null;
    this.solver.updateStructure();
  }

  moveGoal(tip: number, x: number, y: number, z: number) {
    this.goals.get(tip)?.setPosition(x, y, z);
  }

  moveRoot(x: number, y: number, z: number) {
    this.rootGoal?.setPosition(x, y, z);
  }

  rootGoalPosition(): [number, number, number] | null {
    const g = this.rootGoal;
    return g ? [g.position[0], g.position[1], g.position[2]] : null;
  }

  goalPosition(tip: number): [number, number, number] | null {
    const g = this.goals.get(tip);
    return g ? [g.position[0], g.position[1], g.position[2]] : null;
  }

  /** `maxIterations`: fewer for a far or crowded rig; the solver starts from the last pose, so a few still settle a walk.
   *  `damping`: `DAMP.settle` to stand, look and walk; `DAMP.strike` while a fast move plays. */
  solve(maxIterations = 6, damping: number = DAMP.settle): number[] {
    this.solver.maxIterations = maxIterations;
    this.solver.dampingFactor = damping;
    const s = this.solver.solve();
    updateTree(this.world);
    return s;
  }

  /** Turn joint j about one of its axes (0 x, 1 y, 2 z) to `radians` from rest, clamped to its range: a start for the
   *  solver near the pose you want (a finger already curled). Call `update()` after the last one. */
  setAngle(j: number, axis: 0 | 1 | 2, radians: number) {
    const joint = this.joints[j], d = [DOF.EX, DOF.EY, DOF.EZ][axis];
    if (!joint.dof.includes(d)) return;
    joint.setDoFValue(d, radians);
    joint.setMatrixDoFNeedsUpdate();
  }

  /** Bring the links' world matrices up to date after `setAngle`. */
  update() { updateTree(this.world); }

  /** Every joint inside its range, give or take `slack` radians. */
  withinLimits(slack = 1e-4): boolean {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- closed-chain-ik types a joint's dof list apart from the DoF its own setters take
    return this.joints.every((j) => (j.dof as unknown as Dof[]).every((d) =>
      Number(j.getDoFValue(d)) >= Number(j.getMinLimit(d)) - slack && Number(j.getDoFValue(d)) <= Number(j.getMaxLimit(d)) + slack));
  }

  /** Back to the rest pose, goals and all. */
  reset() {
    for (const j of this.joints) {
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- closed-chain-ik types a joint's dof list apart from the DoF its own setters take
      for (const d of j.dof as unknown as Dof[]) j.setDoFValue(d, j.getRestPoseValue(d));
      j.setMatrixDoFNeedsUpdate();
    }
    updateTree(this.world);
    for (const [t, g] of this.goals) { const p = this.worldPosition(t); g.setPosition(p[0], p[1], p[2]); }
    if (this.rootGoal) {
      const p = this.worldPosition(0);
      this.rootGoal.setPosition(p[0], p[1], p[2]);
    }
  }

  /** World matrix (column-major, 16) of joint j's link: what bone j should be. */
  matrixWorld(j: number): ArrayLike<number> {
    return this.links[j].matrixWorld;
  }
}
