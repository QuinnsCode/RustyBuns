// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove and hears each other play (the live line).
// With no world (plain `vite dev`), the app still works; it just doesn't save.
import { connectSocket } from "@rustybuns/util/socket";
import { seshFromPath } from "../sesh.ts";
import { decodeServer, type ClientMsg, type Floor, type Full, type Live, type Op, type Project, type ServerMsg } from "../project.ts";

export type NetStatus = { state: "connecting" | "online" | "offline" | "full"; peers: number; full?: Full; floor?: FloorState };
/** Who may change the sesh, and whether that's you. None on the desktop or in a sesh with no maker. */
export type FloorState = { state: Floor; host: boolean };

export interface Net {
  send(op: Op): void;
  /** Seed an empty world with this project. */
  init(project: Project): void;
  /** One live event to everyone else in the room; dropped while offline (a late note is a wrong note). */
  live(e: Live): void;
  /** The maker only (the world ignores anyone else): free, held or closed. */
  floor(state: Floor): void;
  close(): void;
}

/** This browser's key to a sesh: the first one to bring a key to a sesh is its maker. */
function seshKey(room: string): string {
  const name = `fm-daw:key:${room}`;
  try {
    const had = localStorage.getItem(name);
    if (had && /^[a-z0-9]{16,64}$/.test(had)) return had;
  } catch { /* private window: a key for this visit only */ }
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(name, key); } catch { /* as above */ }
  return key;
}

/** Online the sesh is the path (/sesh/fuzzy-black-panda); the desktop has one world and no name. */
export const roomName = () => seshFromPath(location.pathname) ?? new URLSearchParams(location.search).get("room");

export function connect(opts: {
  /** Called with the saved project, or null when the world is empty. */
  onSnapshot(p: Project | null): void;
  onOp(op: Op): void;
  onLive(from: number, e: Live): void;
  /** Someone left: let go of whatever they were holding. */
  onGone(from: number): void;
  onStatus(s: NetStatus): void;
}): Net {
  const room = roomName();
  const url = new URL(`ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`);
  if (room) { url.searchParams.set("room", room); url.searchParams.set("key", seshKey(room)); }
  let peers = 0;
  let floor: FloorState | undefined;
  let full: Full | null = null;
  opts.onStatus({ state: "connecting", peers });
  const link = connectSocket<ServerMsg, ClientMsg>(url, {
    decode: decodeServer, queue: 200,
    onMessage: (m) => {
      if (m.t === "snapshot") { opts.onSnapshot(m.project); opts.onStatus({ state: "online", peers, floor }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "live") opts.onLive(m.from, m.e);
      else if (m.t === "gone") opts.onGone(m.from);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers, floor }); }
      else if (m.t === "floor") { floor = { state: m.state, host: m.host }; opts.onStatus({ state: "online", peers, floor }); }
      else if (m.t === "full") full = m.why;
    },
    onClose: (e) => {
      // turned away: stay closed until the player asks again
      if (full) { opts.onStatus({ state: "full", peers: 0, full }); return null; }
      opts.onStatus({ state: "offline", peers: 0 });
      // a few quick retries (host restarting), then back off; no world just stays offline
      return Math.min(1000 * 2 ** (e.tries - 1), 30000);
    },
    onOpen: () => opts.onStatus({ state: "connecting", peers, floor }),
  });
  return {
    send: (op) => { link.send({ t: "op", op }); },
    init: (project) => { link.send({ t: "init", project }); },
    live: (e) => { if (link.open) link.send({ t: "live", e }); },
    floor: (state) => { link.send({ t: "floor", state }); },
    close: () => link.close(),
  };
}
