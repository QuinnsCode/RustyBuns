// How loud the room is for you: MUSIC (the band, the PA's sets, the room's YouTube decks, guitars, the sound wall)
// against CROWD (people's mics, the dancers and the night air, the generator), and each person on their own. All 0..1,
// for you alone. The two are kept in this browser; a person's level lasts while they're in the room, as a mute does.
// Pure, so the page and the tests share it: the page multiplies what it already sets on each line by these.

export interface Levels { music: number; crowd: number; peers: Map<number, number> }
const KEY = "qollab-studio:levels";

const unit = (v: unknown, or: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : or);

/** The kept music and crowd levels, or full for whichever isn't there. */
export function keptLevels(stored: string | null): Levels {
  let got: unknown = null;
  try { got = stored ? JSON.parse(stored) : null; } catch { /* not ours */ }
  const o = typeof got === "object" && got !== null ? got : {};
  return { music: unit("music" in o ? o.music : null, 1), crowd: unit("crowd" in o ? o.crowd : null, 1), peers: new Map() };
}
export const keepLevels = (l: Levels) => JSON.stringify({ music: l.music, crowd: l.crowd });

export function loadLevels(): Levels {
  try { return keptLevels(localStorage.getItem(KEY)); } catch { return keptLevels(null); }
}
export function saveLevels(l: Levels) {
  try { localStorage.setItem(KEY, keepLevels(l)); } catch { /* this visit only */ }
}

/** One person's level for you (full until you move it). */
export const peerLevel = (l: Levels, peer: number) => l.peers.get(peer) ?? 1;
export function setPeer(l: Levels, peer: number, v: number) {
  const g = unit(v, 1);
  if (g === 1) l.peers.delete(peer); else l.peers.set(peer, g);
}

/**
 * What one of someone's lines plays at for you: `base` (0 when muted, else what the room already gives it), times
 * their level, times its side's (a mic is crowd, everything else they play is music).
 */
export const heard = (l: Levels, peer: number, base: number, crowd = false) => base * peerLevel(l, peer) * (crowd ? l.crowd : l.music);
