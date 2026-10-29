// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove and hears each other play (the live line).
// With no world (plain `vite dev`), the app still works; it just doesn't save.
import { connectSocket } from "@rustybuns/util/socket";
import { seshFromPath } from "../sesh.ts";
import { decodeServer, type ClientMsg, type Full, type Live, type Mode, type Op, type Project, type ServerMsg } from "../project.ts";

export type NetStatus = { state: "connecting" | "online" | "offline" | "full"; peers: number; full?: Full };

export interface Net {
  send(op: Op): void;
  /** Seed an empty world with this project. */
  init(project: Project): void;
  /** One live event to everyone else in the room; dropped while offline (a late note is a wrong note). */
  live(e: Live): void;
  /** Host only: who may play (the world ignores anyone else). */
  mode(m: Mode): void;
  close(): void;
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
  /** The sesh's mode, and whether this browser is its host. */
  onMode(mode: Mode, host: boolean): void;
  onStatus(s: NetStatus): void;
}): Net {
  const room = roomName();
  const key = hostKey(room);
  const url = new URL(`ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`);
  if (room) url.searchParams.set("room", room);
  let peers = 0;
  let full: Full | null = null;
  opts.onStatus({ state: "connecting", peers });
  const link = connectSocket<ServerMsg, ClientMsg>(url, {
    decode: decodeServer, queue: 200,
    onMessage: (m) => {
      if (m.t === "snapshot") { opts.onSnapshot(m.project); opts.onStatus({ state: "online", peers }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "live") opts.onLive(m.from, m.e);
      else if (m.t === "gone") opts.onGone(m.from);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers }); }
      else if (m.t === "full") full = m.why;
      else if (m.t === "mode") opts.onMode(m.mode, m.host);
    },
    onClose: (e) => {
      // turned away: stay closed until the player asks again
      if (full) { opts.onStatus({ state: "full", peers: 0, full }); return null; }
      opts.onStatus({ state: "offline", peers: 0 });
      // a few quick retries (host restarting), then back off; no world just stays offline
      return Math.min(1000 * 2 ** (e.tries - 1), 30000);
    },
    // every open shows the key first: the first one a room hears makes its host
    onOpen: () => { link.send({ t: "claim", key }); opts.onStatus({ state: "connecting", peers }); },
  });
  return {
    send: (op) => { link.send({ t: "op", op }); },
    init: (project) => { link.send({ t: "init", project }); },
    live: (e) => { if (link.open) link.send({ t: "live", e }); },
    mode: (m) => { link.send({ t: "mode", mode: m }); },
    close: () => link.close(),
  };
}

/**
 * This browser's key for a sesh, kept so the host stays the host after a reload. Without storage
 * (a private window) it lasts as long as the tab.
 */
function hostKey(room: string | null): string {
  const name = `fm-daw:host:${room ?? ""}`;
  try {
    const had = localStorage.getItem(name);
    if (had && had.length >= 16) return had;
    const key = crypto.randomUUID();
    localStorage.setItem(name, key);
    return key;
  } catch { return crypto.randomUUID(); }
}
