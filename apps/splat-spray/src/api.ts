// What the page and the edge Worker agree on for quick play.
import { num, obj, str, type Of } from "@rustybuns/util/guard";

/** A room code: 4 to 8 capitals and digits. Quick play rooms start with Q. */
export const ROOM = /^[A-Z0-9]{4,8}$/;

/** GET /api/match: the quick play room filling up now, and how long until it starts. */
export const MatchReply = obj({ room: str(8, { min: 4, re: ROOM }), startsIn: num(0, 10 * 60_000) });
export type MatchReply = Of<typeof MatchReply>;
