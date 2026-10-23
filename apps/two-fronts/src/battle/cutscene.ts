// Cutscenes as data: a list of cues on a clock, and pure functions that say what the scene looks
// like at any moment. A cue puts an actor on the ground, walks it somewhere, has one throw
// another, puts words in a bubble over it, captions the bottom of the screen, flies the camera
// or makes a noise. A new cutscene is a new list of cues: nothing here knows any one scene.
// Positions are in the scene's own frame (x right, z towards the camera's start, metres), and
// the player turns them onto the field at an origin, so one script plays anywhere: at the hero's
// spawn, or round a Mossback that has just walked out of the trees. cutscene-view.ts plays them.
import type { Faction } from "./contract.ts";
import type { WookaRole, Trooper } from "./sim.ts";

// What an actor is drawn as: a Marine of a class, or a Wooka of a kind.
export type Actor = { marine: Trooper } | { wooka: WookaRole | "warbur" };
export type Vec = [number, number, number]; // x, height, z
export type Noise = "chatter" | "hoot" | "bark" | "howl" | "thump" | "whoop" | "squeal" | "grunt" | "boom" | "chime" | "warn" | "drum";

export type Cue =
  | { at: number; do: "actor"; id: string; as: Actor; x: number; z: number; face?: number; scale?: number }
  | { at: number; do: "walk"; id: string; x: number; z: number; dur: number }
  | { at: number; do: "face"; id: string; yaw: number }
  | { at: number; do: "hop"; id: string; dur: number; height?: number }          // bounces on the spot, excited
  | { at: number; do: "toss"; id: string; what: string; x: number; z: number; dur: number; height?: number } // id throws what to x, z
  | { at: number; do: "say"; id: string; text: string; dur: number }           // a speech bubble over an actor
  | { at: number; do: "caption"; text: string; who?: string; dur: number }     // a line along the bottom of the screen
  | { at: number; do: "title"; text: string; sub?: string; dur: number }       // a title card across the middle
  | { at: number; do: "camera"; from: Vec; look: Vec; to?: Vec; lookTo?: Vec; dur: number }
  | { at: number; do: "shake"; amount: number }
  | { at: number; do: "sound"; noise: Noise; id?: string }
  | { at: number; do: "gone"; id: string };                                   // off the stage

export interface Cutscene {
  id: string;
  faction: Faction;  // whose story it is: sets the lettering (imperial or tribal)
  cues: Cue[];
  end?: number;      // seconds; the last cue's end when absent
}

const endOf = (c: Cue) => c.at + ("dur" in c ? c.dur : 0);
export const lengthOf = (s: Cutscene) => s.end ?? Math.max(0, ...s.cues.map(endOf));

// The one-off cues (sounds, shakes) whose moment falls in (t0, t1], for a frame to fire.
export const firedBetween = (s: Cutscene, t0: number, t1: number) =>
  s.cues.filter((c) => (c.do === "sound" || c.do === "shake") && c.at > t0 && c.at <= t1);

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export interface ActorState { id: string; as: Actor; x: number; y: number; z: number; yaw: number; scale: number; moving: boolean; flying: boolean }

// Where every actor on stage is at t, and what it's doing. Walks and throws run one after
// another in the order they're cued; a thrown actor flies along an arc and lands where it's sent.
export function actorsAt(s: Cutscene, t: number): ActorState[] {
  const out = new Map<string, ActorState>();
  const cues = s.cues.filter((c) => c.at <= t).sort((a, c) => a.at - c.at);
  for (const c of cues) {
    if (c.do === "actor") out.set(c.id, { id: c.id, as: c.as, x: c.x, y: 0, z: c.z, yaw: c.face ?? 0, scale: c.scale ?? 1, moving: false, flying: false });
    const a = "id" in c && c.id ? out.get(c.id) : undefined;
    if (!a) continue;
    if (c.do === "gone") out.delete(c.id);
    else if (c.do === "face") a.yaw = c.yaw;
    else if (c.do === "walk") {
      const k = Math.min(1, (t - c.at) / Math.max(1e-6, c.dur));
      const x0 = a.x, z0 = a.z;
      if (Math.hypot(c.x - x0, c.z - z0) > 1e-3) a.yaw = Math.atan2(-(c.x - x0), -(c.z - z0));
      a.x = lerp(x0, c.x, ease(k)); a.z = lerp(z0, c.z, ease(k));
      a.moving = k < 1;
    } else if (c.do === "hop") {
      const k = (t - c.at) / Math.max(1e-6, c.dur);
      if (k < 1) a.y = Math.abs(Math.sin(k * Math.PI * 4)) * (c.height ?? 0.6);
      else a.y = 0;
    } else if (c.do === "toss") {
      const w = out.get(c.what);
      if (!w) continue;
      const k = Math.min(1, (t - c.at) / Math.max(1e-6, c.dur));
      const x0 = w.x, z0 = w.z;
      a.yaw = Math.atan2(-(c.x - a.x), -(c.z - a.z));
      w.x = lerp(x0, c.x, k); w.z = lerp(z0, c.z, k);
      w.y = k < 1 ? Math.sin(k * Math.PI) * (c.height ?? 8) : 0;
      w.flying = k < 1;
    }
  }
  return [...out.values()];
}

// The camera at t: the latest move that has started, eased along from where it starts to where it ends.
export function cameraAt(s: Cutscene, t: number): { pos: Vec; look: Vec } | null {
  const moves = s.cues.filter((c): c is Extract<Cue, { do: "camera" }> => c.do === "camera" && c.at <= t);
  const c = moves.sort((a, b) => a.at - b.at).at(-1);
  if (!c) return null;
  const k = ease((t - c.at) / Math.max(1e-6, c.dur)), to = c.to ?? c.from, lookTo = c.lookTo ?? c.look;
  return { pos: c.from.map((v, i) => lerp(v, to[i]!, k)) as Vec, look: c.look.map((v, i) => lerp(v, lookTo[i]!, k)) as Vec };
}

// The words on screen at t: bubbles over actors, the caption and the title card.
export function wordsAt(s: Cutscene, t: number) {
  const live = <K extends Cue["do"]>(kind: K) => s.cues.filter((c): c is Extract<Cue, { do: K }> => c.do === kind && c.at <= t && t < endOf(c));
  return { bubbles: live("say").map((c) => ({ id: c.id, text: c.text })), caption: live("caption").at(-1) ?? null, title: live("title").at(-1) ?? null };
}

// The actors a scene uses, for the player to build once.
export const castOf = (s: Cutscene) => s.cues.filter((c): c is Extract<Cue, { do: "actor" }> => c.do === "actor");

// A scene's frame turned onto the field: rotated by yaw (0 faces -z, like the battle) and moved to x, z.
export interface Origin { x: number; z: number; yaw: number }
export function place(o: Origin, x: number, z: number) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return { x: o.x + x * c + z * s, z: o.z - x * s + z * c };
}
