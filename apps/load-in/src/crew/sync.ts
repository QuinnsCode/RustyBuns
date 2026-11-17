// Between your world (sim.ts) and the crew's room (room.ts): what to tell the room, and what its views do to your
// world. No socket here, so a test passes messages between two worlds and a room by hand.
import { heldItem, holdPose, seeCrew, type World } from "../sim.ts";
import type { Sent, ServerMsg } from "./room.ts";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What one page remembers between ticks: the hold it last told the room about, and the newest drop it has taken per piece. */
export interface Synced { held: string | null; seen: Map<string, number> }
export const synced = (): Synced => ({ held: null, seen: new Map() });

/** What changed in your hands since last time, as messages: a drop where the piece landed, then a grab. */
export function outbox(w: World, s: Synced): Sent[] {
  const now = w.held?.key ?? null, out: Sent[] = [];
  if (now === s.held) return out;
  const was = s.held && w.items.find((i) => i.key === s.held);
  if (was) out.push({ t: "drop", key: was.key, x: r3(was.x), y: r3(was.y), z: r3(was.z), rot: r3(was.rot) });
  if (now) out.push({ t: "grab", key: now, team: !!w.held?.team });
  s.held = now;
  return out;
}

/** Where you stand, and where what you carry is drawn, for the friends to see. */
export function poseOf(w: World): Sent {
  const p = holdPose(w), you = w.you;
  return {
    t: "pose", x: r3(you.x), z: r3(you.z), yaw: r3(you.yaw), crouch: you.crouch,
    carry: p && w.held ? { key: w.held.key, x: r3(p.x), y: r3(p.y), z: r3(p.z), rot: r3(p.rot) } : undefined,
  };
}

/** A message from the room. A view moves your friends and the pieces they carry or set down; a piece set down that was in
 * your hands (the friend on the other end put it down) leaves them. A refusal takes back the grab. */
export function hear(w: World, s: Synced, m: ServerMsg) {
  if (m.t === "refused") {
    if (w.held?.key === m.key) { w.held = null; s.held = null; }
    return;
  }
  for (const p of m.placed) {
    if (p.n <= (s.seen.get(p.key) ?? 0)) continue;
    s.seen.set(p.key, p.n);
    const i = w.items.find((x) => x.key === p.key);
    if (!i) continue;
    if (w.held?.key === p.key) { w.held = null; s.held = null; }
    Object.assign(i, { x: p.x, y: p.y, z: p.z, rot: p.rot });
  }
  const mine = heldItem(w);
  for (const m2 of m.mates) {
    const i = m2.carry && w.items.find((x) => x.key === m2.carry!.key);
    if (i && i !== mine) Object.assign(i, { x: m2.carry!.x, y: m2.carry!.y, z: m2.carry!.z, rot: m2.carry!.rot });
  }
  seeCrew(w, m.mates.map(({ id, name, x, z, yaw, crouch, holding }) => ({ id, name, x, z, yaw, crouch, holding })));
}
