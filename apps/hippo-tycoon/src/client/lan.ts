// The browser half of Rusty Buns' LAN party: ask the desktop host to open its
// world, say where friends can reach it, and build the sockets for joining.
import { playerId, worldSocket } from "@rustybuns/shell-bun/client";
import { LAN_VERSION } from "../engine/wire.ts";

export interface HostInfo {
  app: string;
  listen: { hostname: string; port: number };
  /** The host machine's LAN addresses, from /__rb/info. */
  lan?: string[];
  guests: { open: boolean; connected: number; max: number };
}

/** The desktop host's info, or null in a plain browser (where /__rb/info is not JSON). */
export async function hostInfo(): Promise<HostInfo | null> {
  try {
    const r = await fetch("/__rb/info");
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    const j = await r.json();
    return j && typeof j.app === "string" ? (j as HostInfo) : null;
  } catch { return null; }
}

const A = ["crude", "gusher", "barrel", "derrick", "slick", "brass", "tycoon", "refined"];
const B = ["kettle", "bonus", "dividend", "pipeline", "yacht", "cigar", "stocks", "jackpot"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
export const makeJoinCode = () => `${pick(A)}-${pick(B)}`;
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

/** The host's own page talks to its own world: same origin, the host identity is vouched. */
export const ownWorldSocket = () => worldSocket("/ws");

/** Online room: the Worker vouches the identity it validates from this query. */
export const onlineSocket = (room: string, name: string) => worldSocket("/ws", { room, uid: playerId(), name });
