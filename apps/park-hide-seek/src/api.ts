// What the page and the servers agree on, in one place: the ids that go in a URL, and the JSON
// each /api route answers. The edge Worker (edge/worker.ts) and the desktop host
// (packages/desktop/host.ts) answer with these shapes; the page (ui/main.ts) reads replies through
// the same guards, so neither side guesses what the other sends.
import { arr, int, nul, num, obj, rec, str, type Of } from "@rustybuns/util/guard";

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

/** POST eqosys /api/exchange: who signed in, and the token the Worker checks. `token` is null while eqosys has no signing key. */
export const ExchangeReply = obj({
  user: obj({ id: str(200), email: str(320), name: str(200) }),
  app: str(64), source: str(64), access: arr(str(32), 100), token: nul(str(8192)),
});
export type ExchangeReply = Of<typeof ExchangeReply>;
