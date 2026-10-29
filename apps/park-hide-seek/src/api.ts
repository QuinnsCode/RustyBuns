// What the page and the servers agree on, in one place: the ids that go in a URL, and the JSON
// each /api route answers. The edge Worker (edge/worker.ts) and the desktop host
// (packages/desktop/host.ts) answer with these shapes; the page (ui/main.ts) reads replies through
// the same guards, so neither side guesses what the other sends.
import { arr, int, num, obj, rec, str, type Of } from "@rustybuns/util/guard";

/** A room code: 4 to 8 capitals and digits. Quick play rooms start with Q. */
export const ROOM = /^[A-Z0-9]{4,8}$/;
/** A player id, made by the browser and kept there. */
export const UID = /^[A-Za-z0-9_-]{8,64}$/;

/** GET or POST /api/parks: how many players asked for each park, by park code. */
export const ParksReply = obj({ votes: rec(int(0, 1e9)) });
export type ParksReply = Of<typeof ParksReply>;

/** GET /api/match: the quick play room filling up now, and how long until it starts. */
export const MatchReply = obj({ room: str(8, { min: 4, re: ROOM }), startsIn: num(0, 10 * 60_000) });
export type MatchReply = Of<typeof MatchReply>;

/** GET /api/lan (desktop only): where friends on the same network can join. */
export const LanReply = obj({ addresses: arr(str(64), 64), port: int(1, 65535) });
export type LanReply = Of<typeof LanReply>;
