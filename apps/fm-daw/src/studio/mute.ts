// What you hear of the others in a jam: mute the whole room, or one person, for you alone (the leader's mute for
// everyone is a grant, src/grants.ts, and the World holds it). Your own notes always sound. Pure, so the page and
// the tests share it: the page sends a note to its audio thread only when `sounds` says so.
import type { Live } from "../project.ts";
import type { Jam } from "./jam.ts";

/** Your mutes: the whole room, and the peers you muted (by live-line peer number). */
export interface Mutes { room: boolean; peers: Set<number> }
export const noMutes = (): Mutes => ({ room: false, peers: new Set() });

/** Whether this note from that peer should sound for you. A let-go always goes through, so nothing hangs. */
export function sounds(m: Mutes, from: number, e: Live): boolean {
  if (e.t !== "on") return true;
  return !m.room && !m.peers.has(from);
}

/**
 * Mute or unmute one peer (`on` left out: the other way round). The notes they hold now, which the page must let go of
 * on its audio thread so they don't ring on; none when they're unmuted or already muted.
 */
export function mutePeer(m: Mutes, j: Jam, peer: number, on = !m.peers.has(peer)): { track: number; midi: number }[] {
  const was = m.room || m.peers.has(peer);
  if (on) m.peers.add(peer); else m.peers.delete(peer);
  return on && !was ? held(j, peer) : [];
}

/** Mute or unmute the whole room; the notes to let go of, as `mutePeer`. */
export function muteRoom(m: Mutes, j: Jam, on = !m.room): { track: number; midi: number }[] {
  const was = m.room;
  m.room = on;
  return on && !was ? [...j.others.keys()].filter((p) => !m.peers.has(p)).flatMap((p) => held(j, p)) : [];
}

function held(j: Jam, peer: number) {
  return [...(j.others.get(peer)?.held ?? [])].map((k) => { const [track, midi] = k.split(":").map(Number); return { track, midi }; });
}

/** How far off where you look someone can stand and still be the one you're looking at, radians, and how far away. */
const AIM = 0.35, REACH = 12;
/** The other person you're looking at, or null: nearest the middle of your view, within reach. */
export function facing(j: Jam): number | null {
  let best: number | null = null, bestA = AIM;
  for (const [peer, o] of j.others) {
    const dx = o.at[0] - j.me.x, dz = o.at[1] - j.me.z;
    if (Math.hypot(dx, dz) > REACH || Math.hypot(dx, dz) < 1e-6) continue;
    // the way you look is -z at yaw 0, turning left as yaw grows
    const a = Math.abs(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - j.me.yaw), Math.cos(Math.atan2(-dx, -dz) - j.me.yaw)));
    if (a < bestA) { best = peer; bestA = a; }
  }
  return best;
}
