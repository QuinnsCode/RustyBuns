// What the page and the servers agree on, in one place: the ids that go in a URL, and the JSON
// each /api route answers. The edge Worker (edge/worker.ts) and the desktop host
// (packages/desktop/host.ts) answer with these shapes; the page (ui/main.ts) reads replies through
// the same guards, so neither side guesses what the other sends.
import { arr, int, num, obj, oneOf, rec, str, type Of } from "@rustybuns/util/guard";

// ---- protocol version: store builds outlive this Worker's changes (packages/util/src/protocol.ts) ----

/** The protocol this page speaks; it rides as `pv` on /ws and the /api calls. */
export const PROTOCOL = 1;
/** The oldest protocol the edge still serves. Raise it only when a change breaks older builds, and keep the old shape working until the stores' builds have moved on. */
export const MIN_PROTOCOL = 1;
/** Where a client below the floor is sent. */
export const STORE_URL = "https://apps.apple.com/app/park-hide-seek";

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

// ---- eqosys: one account across the Q apps (apps/eqosys) --------------------------------------
// A player may sign in through eqosys instead of typing a name. The page sends them to its /login
// with a PKCE challenge, trades the code at /api/exchange from the page (CORS lets this origin), and
// keeps the signed `token`. From then on the token rides to /api/match, /api/parks and /ws in place of
// `uid`, and the Worker takes the player's id and name from it (src/edge/eqosys.ts), not the query.

/** Where eqosys lives. The Worker's EQOSYS_URL var and the page's `phs.eqosys` setting override it for a local eqosys. */
export const EQOSYS = "https://eqosys.qntbr.com";
/** This game's id in eqosys's APPS. */
export const APP = "park-hide-seek";
/** The origins eqosys sends players back to: the online game. The desktop app and a LAN host keep the typed name. */
export const SIGN_IN_FROM = ["https://park-hide-seek.notryanquinn.workers.dev"];

// ---- the iOS app (ios/) -----------------------------------------------------------------------
// The app draws what the edge sends and nothing else. It speaks the same /ws as the page, and it reads
// the ground from /api/zone, because the props are scattered by Zone (zones/zone.ts) in TypeScript and
// the phone must not scatter them again.

/** The things standing on the ground, as Zone scatters them. */
export const PROP_KINDS = ["pine", "sequoia", "saguaro", "cactus", "bush", "boulder", "tent", "log", "cabin", "outhouse", "table", "sign", "geyser", "pool"] as const;

/**
 * GET /api/zone?id=: one drop zone's ground. `heights` is n*n little-endian Int16 metres above sea level in base64
 * (row 0 the south edge); a height in game metres is (sample - lowest) / scale. x is east, y north, from the centre.
 */
export const ZoneReply = obj({
  id: str(64), name: str(100), trees: oneOf(["pine", "sequoia", "desert"] as const),
  /** Game radius of the playable circle, and samples per side. */
  radius: num(1, 1e5), n: int(2, 1024),
  heights: str(1_000_000), lowest: num(-1e5, 1e5), scale: num(1, 1000),
  props: arr(obj({ kind: oneOf(PROP_KINDS), x: num(-1e5, 1e5), y: num(-1e5, 1e5), r: num(0, 1e3), tall: num(0, 1e3), rot: num(-100, 100), size: num(0, 100), label: str(100, { dflt: "" }) }), 5000),
  station: obj({ x: num(-1e5, 1e5), y: num(-1e5, 1e5), yaw: num(-100, 100) }),
});
export type ZoneReply = Of<typeof ZoneReply>;

/** POST /api/report: why a player reported another (App Store guideline 1.2). */
export const REPORT_REASONS = ["name", "cheating", "harassment", "other"] as const;
