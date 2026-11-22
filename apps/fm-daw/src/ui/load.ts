// What the audio thread needs to mirror a project: the DAW and the jam room (src/studio/) both send it.
import { audible, loopBeats, voiceless, type Project } from "../project.ts";
import { flatEq } from "../engine/eq.ts";
import type { ToWorklet } from "../engine/messages.ts";
import type { AmpSettings } from "../amp/messages.ts";
import { deskPlays, playerId, UNITY } from "../mixer.ts";

/** Everything the worklet needs to mirror a project. */
export function loadMsg(p: Project): ToWorklet {
  return {
    t: "load", params: p.tracks.flatMap((t) => t.params), notes: p.tracks.map((t) => t.notes), auto: p.tracks.map((t) => t.auto ?? []),
    bpm: p.bpm, swing: p.swing, loopBeats: loopBeats(p), audible: audible(p), space: p.space, squash: p.squash, eq: p.eq, eqAuto: p.eqAuto ?? [], eqLinear: !!p.eqLinear,
    trackEq: p.tracks.map((t) => t.eq ?? flatEq()), amps: p.tracks.map((t) => t.amp ?? null), plugins: p.tracks.map((t) => !!t.plugin), voiceless: voiceless(p),
  };
}

/** Someone the live line plays sound for: their number on it, their person id (the grants' `peers`) and their name. */
export interface HeardPlayer { peer: number; who: string; name: string }

/**
 * Keeps the audio thread's desk in step with the sesh: the players' channels, the aux 2 return and the gear cabled
 * into it, and which tracks play once a player's solo counts too. The DAW and the jam room call `sync` after
 * anything changes (the groove, who is heard, the gear room); it sends only what is new.
 */
export class DeskFeed {
  private last = "";
  private soloed = false;
  constructor(private readonly send: (m: ToWorklet) => void) {}
  /** A new audio thread knows nothing: the next sync sends it all. */
  reset() { this.last = ""; }
  sync(p: Project, heard: readonly HeardPlayer[], gear: AmpSettings | null) {
    const who = [...new Map(heard.map((h) => [h.who, { who: h.who, name: h.name }])).values()];
    const plays = deskPlays(p, who), aux2 = p.desk?.aux2;
    const msg: ToWorklet = {
      t: "desk", aux2: { gear, fader: aux2?.fader ?? UNITY, mute: aux2?.mute ?? false, ...(aux2?.eq ? { eq: aux2.eq } : {}) }, ...(p.desk?.space?.eq ? { space: p.desk.space.eq } : {}),
      players: heard.flatMap((h) => { const channel = plays.players.find((c) => c.id === playerId(h.who)); return channel ? [{ peer: h.peer, channel }] : []; }),
    };
    const key = JSON.stringify(msg);
    if (key !== this.last) { this.last = key; this.send(msg); }
    // a player's solo quiets the tracks too: the mask the groove's own messages send knows only the tracks' solos
    const tracks = audible(p), differs = plays.mask.some((on, t) => on !== tracks[t]);
    if (differs || this.soloed) this.send({ t: "audible", mask: plays.mask });
    this.soloed = differs;
  }
}
