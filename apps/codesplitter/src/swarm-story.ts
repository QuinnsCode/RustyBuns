// The swarm story (swarm.html, and the landing page's copy of it): scenes over the simulation in swarm-sim.ts, from
// old git with a few people, through agents and then swarms, to codeSplitter's layers one at a time. A scene says which
// layers are on, where the faders go (they glide there while it plays), what to point at, and its caption. The stage
// waits on Next at a scene's end unless it plays on its own. `wipe` starts a fresh simulation behind a wipe, warmed up
// so the crowd is already there. No DOM; swarm-stage.js plays it.
import type { Knobs, Layers } from "./swarm-sim.ts";

/** A part of the stage a scene points at. */
export type Focus = "desks" | "lane" | "wall" | "train" | "tests" | "home";

export interface Scene {
  id: string;
  title: string;
  caption: string;
  layers: Layers | "split";
  /** Where the faders end up by the scene's end (they start where the last scene left them). */
  knobs: Knobs;
  /** Simulated minutes per real second. */
  speed: number;
  /** Real milliseconds at 1x playback. */
  ms: number;
  focus?: Focus;
  /** A fresh simulation behind a wipe, run `warm` minutes first. */
  wipe?: boolean;
  warm?: number;
}

const OLD: Layers = { coord: false, mervin: false, ester: false };
const COORD: Layers = { coord: true, mervin: false, ester: false };
const MERVIN: Layers = { coord: true, mervin: true, ester: false };
const ALL: Layers = { coord: true, mervin: true, ester: true };
const CROWD: Knobs = { agents: 30, overlap: 0.35, flaky: 0.12 };

export const SCENES: Scene[] = [
  { id: "calm", title: "This is what old git was like", layers: OLD, knobs: { agents: 4, overlap: 0.15, flaky: 0.04 }, speed: 1, ms: 9000, focus: "lane", wipe: true, warm: 60,
    caption: "A handful of people, a few changes a day. They walk down the stairs, through the gate, onto a train to main. Quiet. It works." },
  { id: "agents", title: "All right, but now we have agents", layers: OLD, knobs: { agents: 8, overlap: 0.2, flaky: 0.06 }, speed: 1, ms: 10000, focus: "desks",
    caption: "Everyone gets an agent or two. More people on the stairs, and the gate still keeps up. A conflict here and there." },
  { id: "notice", title: "All riiight, but notice something", layers: OLD, knobs: { agents: 14, overlap: 0.25, flaky: 0.08 }, speed: 1, ms: 11000, focus: "lane",
    caption: "Midday, and the stairs are filling. Now and then someone gets sent back up to rebase, or a check goes red that nobody recognizes." },
  { id: "swarm", title: "Now swarming agents come along", layers: OLD, knobs: CROWD, speed: 1, ms: 11000, focus: "desks",
    caption: "Kick off thirty at once. They were all on the same worktrees, so they all finish at once. Each one pulled main when it started, and main has moved on without it." },
  { id: "smart", title: "Swarms smart enough to finish fast, in parallel, or both", layers: OLD, knobs: { ...CROWD, overlap: 0.4 }, speed: 1, ms: 11000, focus: "lane",
    caption: "Rush hour. They finish so fast that they all reach the one staircase at the same moment, and the stairs, the ticket gate and the way onto the platform are all jammed." },
  { id: "merge-wall", title: "Wall one: merge conflicts", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Five agents each add their feature to the README and step on each other's toes at the gate. Git calls that a conflict: back up the stairs, rebase, burn tokens, join the crush again." },
  { id: "test-wall", title: "Wall two, the quiet one: red checks", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "tests",
    caption: "Make it through the gate and a check goes red. Yours? Already red on main? Flaky? Nobody can tell, so back up the stairs again." },
  { id: "stuck", title: "Everyone's stuck", layers: OLD, knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 8000,
    caption: "More agents, same staircase. They aren't short on intelligence. They're short on a way in." },
  { id: "coord", title: "Layer one: a computer on the internet", layers: COORD, knobs: CROWD, speed: 1, ms: 11000, focus: "lane", wipe: true, warm: 45,
    caption: "codeSplitter puts the repo on a Durable Object: a small computer on Cloudflare's network that every agent talks to live, with git in Artifacts behind it. The stairs get wide." },
  { id: "toe-step", title: "But they still pulled a stale tree", layers: COORD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Everyone gets down the stairs now. But agents building features in parallel still step on each other's toes at the README, just faster, and the gate is jammed again." },
  { id: "mervin", title: "Layer two: Mervin fills the train", layers: MERVIN, knobs: CROWD, speed: 1, ms: 11000, focus: "train", wipe: true, warm: 45,
    caption: "Mervin steps in at the gate and clears the conflicts, then waves people through to the platform. The bullet train fills fast: who can go now, who goes easiest, who waits on a call." },
  { id: "what-conflicts", title: "Merge conflicts? What are those?", layers: MERVIN, knobs: CROWD, speed: 1, ms: 9000, focus: "train",
    caption: "Line ids settle most of them, so those people board too. The few real judgment calls wait on the bench as a card." },
  { id: "stations", title: "Then the stations back up", layers: MERVIN, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 9000, focus: "tests",
    caption: "The trains arrive faster than the checks can take them, one PR per run, and every red still sends someone back up to guess." },
  { id: "ester", title: "Layer three: Ester stacks the stations", layers: ALL, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 11000, focus: "tests", wipe: true, warm: 45,
    caption: "Ester loads the train like a skilled flight crew boarding a plane: seat by seat, a car of PRs per test run. The train lifts off, and the agents step off on parallel platforms, then go underground to start the next feature. Flaky checks rerun quietly. Only your own red comes back to you." },
  { id: "both", title: "Same agents, same hour", layers: "split", knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 16000, focus: "home", wipe: true, warm: 30,
    caption: "Top: the old git way. Bottom: codeSplitter. Count who got home." },
];

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Where the story is `ms` real milliseconds in (looping): the scene, how far through it, and where the faders are. */
export function at(ms: number, scenes = SCENES) {
  const total = scenes.reduce((s, x) => s + x.ms, 0);
  let left = ((ms % total) + total) % total;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    if (left < s.ms) {
      const from = i ? scenes[i - 1]!.knobs : s.knobs, k = ease(Math.min(1, left / (s.ms * 0.6)));
      const knobs: Knobs = { agents: Math.round(lerp(from.agents, s.knobs.agents, k)), overlap: lerp(from.overlap, s.knobs.overlap, k), flaky: lerp(from.flaky, s.knobs.flaky, k) };
      return { i, scene: s, progress: left / s.ms, knobs };
    }
    left -= s.ms;
  }
  return { i: 0, scene: scenes[0]!, progress: 0, knobs: scenes[0]!.knobs };
}

/** The real millisecond a scene starts at. */
export const startOf = (id: string, scenes = SCENES) => {
  let ms = 0;
  for (const s of scenes) { if (s.id === id) return ms; ms += s.ms; }
  return 0;
};
export const total = (scenes = SCENES) => scenes.reduce((s, x) => s + x.ms, 0);
