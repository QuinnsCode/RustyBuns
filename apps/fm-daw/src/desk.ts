// The desk's model: a channel strip per source and a return per aux, as the gear room keeps it in the browser and
// the sesh keeps it in the project (the players' channels and the aux 2 return, `SeshDesk`). Pure, and it imports
// no circuit: the World reads it with the project. src/mixer.ts plays it.
import { arr, bool, int, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { flatEq, sanitizeEq, type EqDoc } from "./engine/eq.ts";

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
/** A Shape that is left out when flat (no band in any slot), so a desk or a project nobody shaped reads as it did. */
export const shapeEq = (v: unknown): EqDoc | undefined => { if (v == null) return undefined; const eq = sanitizeEq(v); return eq.some(Boolean) ? eq : undefined; };
/** `{ eq }` when it has a band, else nothing. */
export const shapeOf = (eq: EqDoc | undefined): { eq?: EqDoc } => { const e = shapeEq(eq); return e ? { eq: e } : {}; };
/** A return: its own Shape (absent when flat) plays on what comes back from its effect, before its fader. */
export const Return = obj({ aux: int(1, AUXES, 1), name: str(80, { dflt: "" }), fx: oneOf(FX, "cabled"), fader: num(0, 1, UNITY), mute: bool(false), eq: shapeEq });
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

/** Which Shape on the desk: a channel's (by id), a return's (by aux), or the master's. */
export type ShapeAt = { channel: string } | { aux: number } | { master: true };
/** That Shape as it is (flat when it has none). `master` is the master's, which the desk doesn't keep. */
export function shapeAt(d: Desk, at: ShapeAt, master: EqDoc = flatEq()): EqDoc {
  if ("master" in at) return master;
  if ("aux" in at) return d.returns.find((r) => r.aux === at.aux)?.eq ?? flatEq();
  return d.channels.find((c) => c.id === at.channel)?.eq ?? flatEq();
}
/** The desk with that Shape set (the master's is not the desk's: it comes back as it was). */
export function withShape(d: Desk, at: ShapeAt, eq: EqDoc): Desk {
  if ("master" in at) return d;
  if ("aux" in at) return withReturn(d, at.aux, { eq });
  return withChannel(d, at.channel, { eq: sanitizeEq(eq) });
}
/** The Shape's name on the desk: the channel's or return's, or "Master". */
export function shapeName(d: Desk, at: ShapeAt): string {
  if ("master" in at) return "Master";
  if ("aux" in at) { const r = d.returns.find((x) => x.aux === at.aux); return r ? `Return ${r.aux}: ${r.name}` : `Return ${at.aux}`; }
  const c = d.channels.find((x) => x.id === at.channel);
  return c ? c.name || c.id : at.channel;
}

/** A fader's place, 0 to 1, as gain: off at the bottom, 0 dB at UNITY, +6 dB at the top (48 dB of travel). */
export const faderGain = (f: number) => (f <= 0 ? 0 : 10 ** (((Math.min(f, 1) - UNITY) * 48) / 20));
export const faderDb = (f: number) => (f <= 0 ? -Infinity : (Math.min(f, 1) - UNITY) * 48);
/** Which channels play: any solo means only the soloed ones, otherwise every one not muted. */
export const audible = (d: Desk): boolean[] => { const any = d.channels.some((c) => c.solo); return d.channels.map((c) => (any ? c.solo : !c.mute)); };

/**
 * A channel for a sound the desk's audio thread doesn't carry (a guitar heard as it comes, on its own call): the
 * level its chain plays at (input gain and fader; nothing when it is muted, or `on` is false: someone else's solo),
 * each aux send's share of that, and its Shape (left out when flat; the call runs it after the amp). Its pan stays with
 * the desk: the call is placed where its player stands.
 */
export function callStrip(c: Channel, on = true): { level: number; sends: number[]; eq?: EqDoc } {
  return { level: on && !c.mute ? 10 ** (c.gain / 20) * faderGain(c.fader) : 0, sends: c.sends.slice(0, AUXES), ...shapeOf(c.eq) };
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
const Aux2 = obj({ fader: num(0, 1, UNITY), mute: bool(false), eq: shapeEq });
/** The Space return: its fader is the project's Space amount, so all it keeps here is its Shape (on what goes into Space). */
const SpaceRet = obj({ eq: shapeEq });
export const SeshDesk = obj({ players: arr(Channel, MAX_PLAYERS, { drop: true }), aux2: Aux2, space: opt(SpaceRet) });
export type SeshDesk = Of<typeof SeshDesk>;
export const emptySeshDesk = (): SeshDesk => ({ players: [], aux2: { fader: UNITY, mute: false } });
/** One move on that part of the desk: a player's channel as it now is, the aux 2 return, or the Space return's Shape. */
export const DeskEdit = { player: Channel, aux2: Aux2, space: SpaceRet };

/** The kept desk after one move. A channel put back as a new one is no longer kept. */
export function withDeskEdit(d: SeshDesk, edit: { player?: Channel; aux2?: SeshDesk["aux2"]; space?: SeshDesk["space"] }): SeshDesk {
  let players = d.players;
  if (edit.player && isPlayerId(edit.player.id)) {
    const c: Channel = { ...edit.player, source: "player" };
    const plain = JSON.stringify({ ...c, name: "" }) === JSON.stringify(newChannel({ id: c.id, name: "", source: "player" }));
    players = [...players.filter((x) => x.id !== c.id), ...(plain ? [] : [c])].slice(-MAX_PLAYERS);
  }
  const space = edit.space ?? d.space;
  return { players, aux2: edit.aux2 ?? d.aux2, ...(space?.eq ? { space } : {}) };
}
/** Whether it is as a new sesh's: nothing to keep. */
export const plainSeshDesk = (d: SeshDesk) => d.players.length === 0 && d.aux2.fader === UNITY && !d.aux2.mute && !d.aux2.eq && !d.space?.eq;
