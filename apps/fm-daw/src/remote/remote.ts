// The remote (/remote.html?room=<sesh>): one screen for a jam on a phone. Master: play / stop, the room's level,
// and a fader and a mute per track. Mine: the track at the spot you sit at in the jam room gets the top, with its
// level, a tone knob, a space knob and mute. It sends the ops the desk sends (`param`, `track`, `global`, and play /
// stop on the live line), so the World checks them against the grants like any other page. Pure, so the page and the
// tests share it.
import { MASTER_MIN, type Live, type Op, type Project, type TrackDoc } from "../project.ts";
import { P } from "../engine/params.ts";
import { may, type Can, type GrantServer } from "../grants.ts";
import type { Floor } from "../project.ts";
import { TRACK_COLORS } from "../ui/colors.ts";
import { trackFor } from "../studio/jam.ts";
import type { StudioDef } from "../studio/room.ts";

export { MASTER_MIN };

/** One track's fader as the remote shows it: named and coloured as on the desk. */
export interface Strip { track: number; name: string; color: string; level: number; mute: boolean }

export const strips = (p: Project): Strip[] =>
  p.tracks.map((t, i) => ({ track: i, name: t.name, color: TRACK_COLORS[i % TRACK_COLORS.length], level: t.params[P.GAIN], mute: t.mute }));

/**
 * The tone knob, 0 dark to 1 bright: the track's own hi-cut (a low-pass after its voices) turned the other way round,
 * so it darkens an FM voice and an analog one alike, and it is the desk's (a Mix grant), not the patch's.
 */
export const tone = (t: TrackDoc) => 1 - t.params[P.HICUT];

export const levelOp = (track: number, v: number): Op => ({ t: "param", track, i: P.GAIN, v });
export const toneOp = (track: number, v: number): Op => ({ t: "param", track, i: P.HICUT, v: 1 - v });
export const spaceOp = (track: number, v: number): Op => ({ t: "param", track, i: P.SEND, v });
export const muteOp = (track: number, on: boolean): Op => ({ t: "track", track, mute: on });
/** The room's level, dB: MASTER_MIN is silence, 0 as it was mixed. */
export const masterOp = (db: number): Op => ({ t: "global", master: db });
export const transport = (on: boolean): Live => (on ? { t: "play" } : { t: "stop" });

/**
 * The track you play in the jam room: a peer of yours (the same person, from another page) sits at a spot there, and
 * that spot plays this track; null when you sit nowhere. `seats`: each live-line peer's seat as their body says;
 * `peers`: who each peer number is (the World's grants message).
 */
export function myTrack(seats: ReadonlyMap<number, string | null>, peers: Record<string, string>, me: string | null, defs: readonly StudioDef[], p: Project): number | null {
  if (!me) return null;
  for (const [peer, seat] of seats) {
    if (!seat || peers[String(peer)] !== me) continue;
    const spot = defs.flatMap((d) => d.spots).find((s) => s.id === seat);
    if (!spot) continue;
    // the kit plays every drum track: its knobs go on the first one
    const t = spot.kind === "drums" ? p.tracks.findIndex((x) => x.kind === "drum") : trackFor(spot, p);
    if (t >= 0) return t;
  }
  return null;
}

/** What the remote may do: mix (the faders, the knobs, mute and the room's level) and play (the transport). */
export function rights(g: GrantServer | null, floor: Floor | null, me: string | null): Record<"mix" | "play", boolean> {
  // with no grants yet (the desktop, or before the first hello) the World lets everything through
  if (!g || !floor) return { mix: true, play: true };
  const one = (can: Can) => may(g.grants, floor, me ?? undefined, false, can);
  return { mix: one("mix"), play: one("play") };
}
