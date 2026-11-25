// The listen link's wire, read by both ends: the Listen Durable Object (src/listen.ts) and the pages (the DJ's decks,
// src/dj/live.ts; a listener's page, src/dj/listen-page.ts). The sound goes as binary frames (WebM chunks from the
// decks' MediaRecorder); everything else is one of these JSON messages. No Bun or DOM in here.
import { arr, bool, int, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

/** A set's link id: what follows /listen/ in the address. */
export const SET_ID = /^[a-z0-9]{10}$/;
/** The DJ's key for their link (kept in their browser); only its hash is stored. */
export const DJ_KEY = /^[0-9a-f]{32}$/;
/** Characters in a set's name. */
export const NAME_MAX = 80;
/** Tracks a set's list keeps (the oldest go first). */
export const CUES_MAX = 400;
/** The type the decks stream in: Opus in WebM, which a listener's MediaSource plays from any cluster. */
export const LIVE_TYPE = "audio/webm;codecs=opus";
/** Bits a second the decks stream at: about 58 MB per listener-hour. */
export const LIVE_BITRATE = 128_000;

const Cue = obj({ at: num(0, 86_400 * 7), side: oneOf([0, 1] as const), name: str(200), tube: opt(bool()) });

/** The DJ to the set: its name, a track coming in. */
export const DjSays = obj({ t: oneOf(["name", "cue"] as const), name: opt(str(NAME_MAX, { min: 0 })), cue: opt(Cue) });
export type DjSays = Of<typeof DjSays>;

/** The set to a listener (and the listener count to the DJ): what it is now, a new track, how many listen, its end. */
export const SetSays = obj({
  t: oneOf(["set", "cue", "ears", "end"] as const),
  name: opt(str(NAME_MAX, { min: 0 })),
  live: opt(bool()),
  cues: opt(arr(Cue, CUES_MAX)),
  cue: opt(Cue),
  ears: opt(int(0, 100_000)),
});
export type SetSays = Of<typeof SetSays>;

/** Where a set's listeners go: `/listen/<id>` on the site the decks run on. */
export const listenPath = (id: string) => `/listen/${id}`;
/** The set's socket, for the DJ (with their key) or a listener. */
export const listenSocket = (origin: string, id: string, key?: string) =>
  `${origin.replace(/^http/, "ws")}${listenPath(id)}/ws${key ? `?dj=${key}` : ""}`;
/** The set id in a listen page's path, or null. */
export function setFromPath(path: string): string | null {
  const m = /^\/listen\/([a-z0-9]{10})(\/ws)?\/?$/.exec(path);
  return m ? m[1]! : null;
}
