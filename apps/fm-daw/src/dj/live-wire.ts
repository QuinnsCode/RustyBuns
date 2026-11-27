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

/** The free limits a set can meet: its length, the month's hours, one set at a time per DJ, the listeners it takes. */
export const LIMITS = ["hours", "month", "one", "ears"] as const;
export type Limit = (typeof LIMITS)[number];
/** The close code of a DJ's socket a limit refused or ended (a full set's listener gets 4001, as before). */
export const CLOSE_LIMIT = 4005;

/** The set to a listener (and the listener count to the DJ): what it is now, a new track, how many listen, its end
 * (`why` names the limit that ended it or turned this socket away, `n` that limit's number). */
export const SetSays = obj({
  t: oneOf(["set", "cue", "ears", "end"] as const),
  name: opt(str(NAME_MAX, { min: 0 })),
  live: opt(bool()),
  cues: opt(arr(Cue, CUES_MAX)),
  cue: opt(Cue),
  ears: opt(int(0, 100_000)),
  why: opt(oneOf(LIMITS)),
  n: opt(num(0, 100_000)),
});
export type SetSays = Of<typeof SetSays>;

const hours = (n: number) => `${Number(n.toFixed(2))} hour${n === 1 ? "" : "s"}`;
/** A limit in plain words: a title and a line, for the card the decks or a listener's page show. */
export function limitSays(why: Limit, n: number): { title: string; says: string } {
  if (why === "hours") return { title: "Your free set hit its time", says: `A free set runs up to ${hours(n)}, so this one ended. Go live again to start a new one.` };
  if (why === "month") return { title: "This month's free hours are used", says: `Free sets get ${hours(n)} a month for each DJ and each connection. They come back on the 1st (UTC).` };
  if (why === "one") return { title: "You're live on another link", says: "A free DJ plays one set at a time. Stop the other one, or wait for it to end, then go live here." };
  return { title: "This set is full", says: `A free set takes ${n} listeners at once, and they're all here. Try again in a bit.` };
}

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
