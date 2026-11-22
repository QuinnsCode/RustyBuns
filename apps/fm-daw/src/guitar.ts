// A friend's guitar, live in the jam room (#4923, step 1 of #4900). Notes and knob turns already sound live because
// every machine plays them itself; a guitar has to travel as sound. So the player who plugs in (G) sends their dry
// input, peer to peer over WebRTC, and every listener plays it through the amp on that player's track in the sesh's
// groove, on their own machine: the patch is shared, so everyone hears the same circuit (and turning a knob costs no
// re-send). A listener whose machine can't run every guitar's amp asks the heaviest one's player for their amp's
// output instead (`wet`, see sendWet): the same circuit, run once, at the cost of a little less of the room on the far
// end. The World only passes the call's setup on, one person to one person, and keeps none of it.
//
// Each guitar is its own call: the player's `out` line to each listener, the listener's `in` line from them. Two
// players with guitars make two calls between them, one each way, so neither offer ever crosses the other.
// No DOM and no Bun here: the World and the page both import it (studio/guitar-line.ts is the browser half).
import { arr, check, int, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import { TRACKS } from "./engine/params.ts";
import type { Project } from "./project.ts";
import { TrackAmp } from "./amp/track-amp.ts";
import type { AmpSettings } from "./amp/messages.ts";
import { DEFAULT_MIC } from "@rustybuns/gear/circuit";

/**
 * Which call a signal is about, from its sender's side: their own guitar going out, or someone's coming in; `pa-out`
 * and `pa-in` the same for a set played to the room over the PA (src/studio/pa-line.ts).
 */
export const LINES = ["out", "in", "pa-out", "pa-in"] as const;
export type Line = (typeof LINES)[number];
const OTHER: Record<Line, Line> = { out: "in", in: "out", "pa-out": "pa-in", "pa-in": "pa-out" };
/** The same call from the other end. */
export const otherEnd = (l: Line): Line => OTHER[l];

const tag = <T extends string>(t: T) => oneOf([t]);
/** An SDP for one audio track runs 2 to 6 kB; this leaves room for a long candidate list. */
const SDP = str(16_000, { min: 1 });
/**
 * A call's setup: a listener asks a player with a guitar to call them (`want`), the offer and its answer, and the
 * network paths each end finds (`ice`; an empty candidate is the end of the list).
 */
const Want = obj({ k: tag("want") });
const Sdp = obj({ k: tag("sdp"), type: oneOf(["offer", "answer"]), sdp: SDP });
const Ice = obj({ k: tag("ice"), candidate: str(2_000, { min: 0 }), mid: str(32, { min: 0, dflt: "" }), index: int(0, 64, 0) });
/** A listener over its budget asks the player to send their amp's output on this call, not their dry input (sendWet). */
const Wet = obj({ k: tag("wet") });
export type Signal = Of<typeof Want> | Of<typeof Sdp> | Of<typeof Ice> | Of<typeof Wet>;
export const Signal: Guard<Signal> = (v) => check(Want, v) ?? check(Sdp, v) ?? check(Ice, v) ?? check(Wet, v) ?? Sdp(v);

const PEER = int(1, Infinity);
/** Page to World: a signal for one other person in the sesh, by their live-line number. */
export const RtcClient = obj({ t: tag("rtc"), to: PEER, line: oneOf(LINES), s: Signal });
export type RtcClient = Of<typeof RtcClient>;
/** World to page: a signal from that person. */
export const RtcServer = obj({ t: tag("rtc"), from: PEER, line: oneOf(LINES), s: Signal });
export type RtcServer = Of<typeof RtcServer>;
export const decodeRtcClient = (v: unknown): RtcClient | null => check(RtcClient, v);
export const decodeRtcServer = (v: unknown): RtcServer | null => check(RtcServer, v);

/** A public STUN server to find each end's address: all a call has when no relay is set up (the desktop, or no TURN key). */
export const STUN: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const URL_ = str(256, { min: 1 });
/** One server a call may use; WebRTC lets `urls` be one string or a list. */
const IceServerGuard = obj({ urls: (v: unknown) => (typeof v === "string" ? [URL_(v)] : arr(URL_, 16, { min: 1 })(v)), username: opt(str(512)), credential: opt(str(512)) });
export type IceServer = Of<typeof IceServerGuard>;
/**
 * What GET /ice answers (src/worker.ts): the servers a guitar call may use and how many seconds they last. With a TURN
 * relay among them, two players whose networks both refuse a direct path still connect, through Cloudflare's relay.
 */
export const IceReply = obj({ iceServers: arr(IceServerGuard, 8, { min: 1 }), ttl: int(0, 7 * 86_400) });
export type IceReply = Of<typeof IceReply>;
/**
 * Cloudflare's TURN key API answers its servers; a browser can't use port 53 (Firefox blocks it, and a call then waits on
 * it), so those go. Null when the reply isn't the shape it should be.
 */
export function browserIce(v: unknown): IceServer[] | null {
  const got = check(obj({ iceServers: arr(IceServerGuard, 8, { min: 1 }) }), v);
  if (!got) return null;
  const out = got.iceServers.map((x) => ({ ...x, urls: x.urls.filter((u) => !/:53(\?|$)/.test(u)) })).filter((x) => x.urls.length);
  return out.length ? out : null;
}

/** A live-line track: -1 is straight in, no track (no amp, heard dry). */
export const GUITAR_TRACK = int(-1, TRACKS - 1);

/**
 * The track your guitar goes into: the one your seat plays (sitting at the bass, the bass track) when it has an amp,
 * else the first track with an amp in the groove, else none (-1: straight in, heard dry).
 */
export function guitarTrack(p: Project, seatTrack: number): number {
  if (seatTrack >= 0 && p.tracks[seatTrack]?.amp) return seatTrack;
  return p.tracks.findIndex((t) => !!t.amp);
}

/** What goes into your audio input: a guitar, or (standing in the vocal booth) a mic. Both travel the same way. */
export type Input = "guitar" | "mic";
/** In the booth you sing into its mic; anywhere else it's your guitar. */
export const inputAt = (seatKind: string | undefined): Input => (seatKind === "booth" ? "mic" : "guitar");
/** Where your input goes: a guitar as guitarTrack says, a voice straight in (-1), never through a guitar amp. */
export const inputTrack = (input: Input, p: Project, seatTrack: number): number => (input === "mic" ? -1 : guitarTrack(p, seatTrack));
/**
 * What to ask the browser for. Both dry and unlevelled (a voice call's noise gate and gain riding chew up a held note
 * or a quiet verse), one channel. A guitar on a jack can't hear the room; a mic hears your speakers, so it cancels
 * their echo, or everyone would hear the band come back a moment late through your mic.
 */
export const capture = (input: Input): { echoCancellation: boolean; noiseSuppression: false; autoGainControl: false; channelCount: 1 } => ({ echoCancellation: input === "mic", noiseSuppression: false, autoGainControl: false, channelCount: 1 });

/**
 * Q Amp's settings for a track's amp: no pedal, the mic where the page starts it, no hiss while the track is quiet.
 * A track's Amp insert plays its take through it (src/amp/insert.ts) and the jam room a guitar plugged into that
 * track; with no amp, the dry input straight through. It lives here because the jam page doesn't load the circuits.
 */
export function guitarSettings(a: TrackAmp | undefined): AmpSettings {
  const { amp, gain, bass, mid, treble, master, rate, depth } = a ?? TrackAmp({});
  return {
    amp, pedal: null, drive: 0, swaps: {}, mic: DEFAULT_MIC, bypass: !a, oversample: INSERT_OVERSAMPLE,
    knobs: { gain, bass, mid, treble, master, rate, depth, noise: 0 },
  };
}
/**
 * Circuit samples per output sample on a track. Q Amp's own page plays at 4; beside the synth engine, 2
 * (its Eco) costs half and keeps the tube stages clean enough (the rigs run 2.3 to 3.1x real time at 4).
 */
export const INSERT_OVERSAMPLE = 2;

/**
 * Opus for a guitar, not a voice: one channel at 128 kb/s, no silence suppression (a held note's tail isn't
 * silence) and forward error correction on, in the offer's or answer's `fmtp` line for Opus.
 */
export function tuneOpus(sdp: string, o: { stereo?: boolean; bitrate?: number } = {}): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const st = o.stereo ? "1" : "0";
  const want: Record<string, string> = { stereo: st, "sprop-stereo": st, maxaveragebitrate: String(o.bitrate ?? 128_000), useinbandfec: "1", usedtx: "0", cbr: "0" };
  const line = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
  const had = line.exec(sdp);
  const params = new Map((had?.[1] ?? "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const [k, ...v] = x.split("="); return [k, v.join("=")] as [string, string]; }));
  for (const [k, v] of Object.entries(want)) params.set(k, v);
  const fmtp = `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(";")}`;
  if (had) return sdp.replace(line, fmtp);
  return sdp.replace(new RegExp(`^(a=rtpmap:${pt} opus/48000[^\\r\\n]*)(\\r?\\n)`, "im"), `$1$2${fmtp}$2`);
}

/** What a call's stats say about the trip, in milliseconds. Either can be missing early in a call. */
export interface Trip { rtt?: number; jitterBuffer?: number }
/** Opus's frame (20 ms), the sender's capture and the receiver's decode, a guess for the rest of the trip. */
export const CODEC_MS = 25;
/**
 * How far behind your own guitar you hear theirs: half the round trip, the jitter buffer and the codec. Your
 * speakers' delay is left out, since your own guitar comes through them too.
 */
export function lagMs(t: Trip): number | null {
  if (t.rtt === undefined) return null;
  return Math.round(t.rtt / 2 + (t.jitterBuffer ?? 0) + CODEC_MS);
}

/**
 * How playing together feels at that lag. Up to 30 ms is about standing across a big stage from each other: tight.
 * Up to 60 ms players notice and lean on the beat: loose. Past it, playing in time breaks down, so the room says to
 * hear the band a loop late (C, src/clock.ts): every guitar's stamped slices then land exactly on their beat, whatever the trip.
 */
export type Feel = "tight" | "loose" | "late";
export const TIGHT_MS = 30, LOOSE_MS = 60;
export const feel = (ms: number): Feel => (ms <= TIGHT_MS ? "tight" : ms <= LOOSE_MS ? "loose" : "late");
/** A guitar's lag: milliseconds, null while its call connects, "failed" when no path between the two networks was found. */
export type Lag = number | null | "failed";
/** The lag in words, for the room's status line. Listening a loop late or at the desk (`now` false) the call's lag doesn't matter. */
export function lagWords(name: string, ms: Lag, input: Input = "guitar", now = true): string {
  if (!now) return `${name}'s ${input} a loop late, in time`;
  if (ms === null) return `${name}'s ${input}: connecting`;
  if (ms === "failed") return `${name}'s ${input} couldn't get through to you (no path between your two networks, not even the relay)`;
  const f = feel(ms);
  return `${name}'s ${input} ${ms} ms behind, ${f === "tight" ? "tight" : f === "loose" ? "loose: lean on the beat" : "too far to play tight: C hears the band a loop late, in time"}`;
}

/**
 * The share of this machine's audio thread the guitars' amps may take (each amp's own meter, summed), leaving the rest
 * for the groove's engine and the room. Q Amp's own split starts at 0.9 of a thread (src/amp/threads.ts); the jam room
 * runs a whole band beside the guitars, so it gives them about half.
 */
export const GUITAR_BUDGET = 0.5;
/** How long the amps stay over budget before one guitar goes wet, seconds: one busy moment isn't a slow machine. */
export const OVER_S = 1 / 3;
/**
 * Which incoming guitar to hear as its player's amp output instead of running its circuit here: while the amps here
 * (yours under "me", each friend's by peer) are over budget, the heaviest one still dry; else none. A wet guitar's own
 * amp is bypassed here, so the next pick is the next heaviest. Your own guitar always runs here: you play through it.
 */
export function sendWet(loads: ReadonlyMap<number | "me", number>, wet: ReadonlySet<number>): number | null {
  let sum = 0, pick: number | null = null, most = -1;
  for (const [who, load] of loads) {
    sum += load;
    if (who !== "me" && !wet.has(who) && load > most) { most = load; pick = who; }
  }
  return sum > GUITAR_BUDGET ? pick : null;
}
