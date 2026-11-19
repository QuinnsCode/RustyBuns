// The desk's model: a channel strip per source and a return per aux, as the gear room keeps it in the browser and
// the sesh keeps it in the project (the players' channels and the aux 2 return, `SeshDesk`). Pure, and it imports
// no circuit: the World reads it with the project. src/mixer.ts plays it.
import { arr, bool, int, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import { flatEq, sanitizeEq } from "./engine/eq.ts";

/** How many aux sends each channel has, and so how many returns the desk has. */
export const AUXES = 2;
export const MAX_CHANNELS = 32;
export const SOURCES = ["player", "instrument", "track"] as const;
/** Where a fader sits at 0 dB. Its top is +6 dB, its bottom is off. */
export const UNITY = 0.75;
/** What a return plays: FM DAW's Space reverb, or the gear cabled into its jacks in the gear room. */
export const FX = ["space", "cabled"] as const;

const ID = str(80, { min: 1 });
export const Channel = obj({
  id: ID,
  name: str(80, { dflt: "" }),
  source: oneOf(SOURCES, "track"),
  /** Input gain, dB. */
  gain: num(-24, 24, 0),
  /** Its Shape EQ (the same bands as a track's). */
  eq: sanitizeEq,
  /** -1 left to 1 right. */
  pan: num(-1, 1, 0),
  fader: num(0, 1, UNITY),
  mute: bool(false),
  solo: bool(false),
  /** Each aux send, 0 to 1, after the fader. */
  sends: arr(num(0, 1, 0), AUXES),
});
export type Channel = Of<typeof Channel>;
export const Return = obj({ aux: int(1, AUXES, 1), name: str(80, { dflt: "" }), fx: oneOf(FX, "cabled"), fader: num(0, 1, UNITY), mute: bool(false) });
export type Return = Of<typeof Return>;
export const Desk = obj({ channels: arr(Channel, MAX_CHANNELS, { drop: true }), returns: arr(Return, AUXES, { drop: true }) });
export type Desk = Of<typeof Desk>;

/** A source the desk gets a channel for. */
export interface Source { id: string; name: string; source: Channel["source"] }

/** Aux 1 is FM DAW's Space as it comes; aux 2 is for gear you cable in. */
export const RETURNS: Return[] = [
  { aux: 1, name: "Space", fx: "space", fader: UNITY, mute: false },
  { aux: 2, name: "Aux 2", fx: "cabled", fader: UNITY, mute: false },
];

export const newChannel = (s: Source): Channel => ({ ...s, gain: 0, eq: flatEq(), pan: 0, fader: UNITY, mute: false, solo: false, sends: Array.from({ length: AUXES }, () => 0) });

/** The desk for these sources: a channel each, in their order, keeping what `prev` had for a source it already had. */
export function deskFor(sources: readonly Source[], prev: Desk | null = null): Desk {
  const had = new Map(prev?.channels.map((c) => [c.id, c]));
  return {
    channels: sources.slice(0, MAX_CHANNELS).map((s) => { const c = had.get(s.id); return c ? { ...c, name: s.name, source: s.source } : newChannel(s); }),
    returns: RETURNS.map((r) => prev?.returns.find((x) => x.aux === r.aux) ?? r),
  };
}

/** A channel with some of its controls changed. */
export const withChannel = (d: Desk, id: string, ch: Partial<Omit<Channel, "id">>): Desk =>
  ({ ...d, channels: d.channels.map((c) => (c.id === id ? Channel({ ...c, ...ch }) : c)) });
/** One aux send on a channel. */
export const withSend = (d: Desk, id: string, aux: number, v: number): Desk =>
  ({ ...d, channels: d.channels.map((c) => (c.id === id ? Channel({ ...c, sends: c.sends.map((s, i) => (i === aux - 1 ? v : s)) }) : c)) });
export const withReturn = (d: Desk, aux: number, r: Partial<Omit<Return, "aux">>): Desk =>
  ({ ...d, returns: d.returns.map((x) => (x.aux === aux ? Return({ ...x, ...r }) : x)) });

/** A fader's place, 0 to 1, as gain: off at the bottom, 0 dB at UNITY, +6 dB at the top (48 dB of travel). */
export const faderGain = (f: number) => (f <= 0 ? 0 : 10 ** (((Math.min(f, 1) - UNITY) * 48) / 20));
export const faderDb = (f: number) => (f <= 0 ? -Infinity : (Math.min(f, 1) - UNITY) * 48);
/** Which channels play: any solo means only the soloed ones, otherwise every one not muted. */
export const audible = (d: Desk): boolean[] => { const any = d.channels.some((c) => c.solo); return d.channels.map((c) => (any ? c.solo : !c.mute)); };

/**
 * A channel for a sound the desk's audio thread doesn't carry (a guitar heard as it comes, on its own call): the
 * level its chain plays at (input gain and fader; nothing when it is muted, or `on` is false: someone else's solo),
 * and each aux send's share of that. Its Shape and pan stay with the desk: the call is placed where its player stands.
 */
export function callStrip(c: Channel, on = true): { level: number; sends: number[] } {
  return { level: on && !c.mute ? 10 ** (c.gain / 20) * faderGain(c.fader) : 0, sends: c.sends.slice(0, AUXES) };
}

// ---- what the sesh keeps of its desk ----
// A track's channel is the track itself (src/mixer.ts). The rest of the desk has no place in the groove, so the
// project keeps it here: each player's channel as it was last set, and the aux 2 return's fader and mute. What is
// cabled into aux 2 is the sesh's gear room patch (src/studio.ts), which the World keeps beside the project.

/** A player's channel id: their person id (src/chat.ts), so the channel is theirs again when they come back. */
export const playerId = (who: string) => `player-${who}`;
export const isPlayerId = (id: string) => /^player-[0-9a-f]{8,64}$/.test(id);
/** Players the sesh keeps a channel for: past it the one set longest ago goes. */
export const MAX_PLAYERS = 32;
const Aux2 = obj({ fader: num(0, 1, UNITY), mute: bool(false) });
export const SeshDesk = obj({ players: arr(Channel, MAX_PLAYERS, { drop: true }), aux2: Aux2 });
export type SeshDesk = Of<typeof SeshDesk>;
export const emptySeshDesk = (): SeshDesk => ({ players: [], aux2: { fader: UNITY, mute: false } });
/** One move on that part of the desk: a player's channel as it now is, or the aux 2 return. */
export const DeskEdit = { player: Channel, aux2: Aux2 };

/** The kept desk after one move. A channel put back as a new one is no longer kept. */
export function withDeskEdit(d: SeshDesk, edit: { player?: Channel; aux2?: SeshDesk["aux2"] }): SeshDesk {
  let players = d.players;
  if (edit.player && isPlayerId(edit.player.id)) {
    const c: Channel = { ...edit.player, source: "player" };
    const plain = JSON.stringify({ ...c, name: "" }) === JSON.stringify(newChannel({ id: c.id, name: "", source: "player" }));
    players = [...players.filter((x) => x.id !== c.id), ...(plain ? [] : [c])].slice(-MAX_PLAYERS);
  }
  return { players, aux2: edit.aux2 ?? d.aux2 };
}
/** Whether it is as a new sesh's: nothing to keep. */
export const plainSeshDesk = (d: SeshDesk) => d.players.length === 0 && d.aux2.fader === UNITY && !d.aux2.mute;
