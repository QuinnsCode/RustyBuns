// The browser half of Rusty Buns' LAN party: ask the desktop host to open its
// world, say where friends can reach it, and build the sockets for joining.
import { playerId, worldSocket } from "@rustybuns/shell-bun/client";
import { LAN_VERSION } from "../engine/wire.ts";
import { pv } from "@rustybuns/util/protocol";
import { arr, bool, check, int, obj, opt, str, type Of } from "@rustybuns/util/guard";
import { PROTOCOL } from "../protocol.ts";
import { fresh, login } from "./eqosys.ts";

/** What the desktop host's /__rb/info says: the app, where it listens, its LAN addresses, and its guests. */
const HostInfo = obj({
  app: str(100),
  listen: obj({ hostname: str(255), port: int(0, 65535) }),
  lan: opt(arr(str(100), 50)),
  guests: obj({ open: bool(), connected: int(0, 1e6), max: int(0, 1e6) }),
});
export type HostInfo = Of<typeof HostInfo>;

/** The desktop host's info, or null in a plain browser (where /__rb/info is not JSON). */
export async function hostInfo(): Promise<HostInfo | null> {
  try {
    const r = await fetch("/__rb/info");
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return check(HostInfo, await r.json());
  } catch { return null; }
}

const A = ["crude", "gusher", "barrel", "derrick", "slick", "brass", "tycoon", "refined"];
const B = ["kettle", "bonus", "dividend", "pipeline", "yacht", "cigar", "stocks", "jackpot"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
// The only lock on a world open to the LAN, so the host wants 12+ characters: two words and four digits
export const makeJoinCode = () => `${pick(A)}-${pick(B)}-${String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000).padStart(4, "0")}`;
export const makeRoomCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

/** Open the host's world to the LAN with this passphrase. */
export async function openLan(code: string): Promise<HostInfo> {
  const r = await fetch("/__rb/host", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: code }) });
  if (!r.ok) throw new Error(`could not open the LAN: ${r.status}`);
  const info = await hostInfo();
  if (!info) throw new Error("the desktop host did not answer");
  return info;
}

export async function closeLan() {
  try { await fetch("/__rb/host", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) }); } catch { /* host already gone */ }
}

/** Turn "192.168.1.20:4000" (or a pasted http:// URL) into the host's /ws URL. */
export function lanUrl(address: string): string | null {
  const a = address.trim();
  if (!a) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(a) ? a : `http://${a}`);
    if (!u.port) return null;                       // the host's port is random: it must be typed
    return `http://${u.host}/ws`;
  } catch { return null; }
}

export const lanSocket = (address: string, code: string, name: string) =>
  worldSocket(lanUrl(address)!, { join: code, uid: playerId(), name, v: LAN_VERSION });

/**
 * The host's own page talks to its own world: same origin, the host identity is
 * vouched. The vouched name is the OS username, so the page passes the menu's
 * name, which the world takes from the host's own page only.
 */
export const ownWorldSocket = (name: string) => worldSocket("/ws", { name });

/** Online room: the Worker vouches the identity it validates from this query. */
export const onlineSocket = (room: string, name: string) => {
  const signed = login();   // signed in through eqosys: the token names them, else the id this browser made
  return worldSocket("/ws", { room, name, ...pv(PROTOCOL), ...(signed && fresh(signed) ? { token: signed.token } : { uid: playerId() }) });
};
