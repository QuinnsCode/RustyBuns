// The world connection. On the desktop it's the host's in-process world, which
// saves the project to sqlite. On Cloudflare it's a Durable Object per room, so
// everyone in the room edits one groove and hears each other play (the live line).
// With no world (plain `vite dev`), the app still works; it just doesn't save.
import { connectSocket } from "@rustybuns/util/socket";
import { seshFromPath } from "../sesh.ts";
import { decodeServer, type ClientMsg, type Floor, type Full, type Live, type Op, type Project, type ServerMsg } from "../project.ts";

/** `locked`: the sesh is private (it has a code). */
export type NetStatus = { state: "connecting" | "online" | "offline" | "full"; peers: number; full?: Full; floor?: FloorState; locked?: boolean };
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
  /** The maker only: make the sesh private with this code, or public again with "". */
  lock(code: string): void;
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

/** A private sesh's code, kept in this browser once typed (or set here), so a reconnect or a revisit gets in. */
const codeKey = (room: string) => `fm-daw:code:${room}`;
export function savedCode(room: string | null): string {
  try { return (room && localStorage.getItem(codeKey(room))) || ""; } catch { return ""; }
}
export function saveCode(room: string | null, code: string) {
  if (!room) return;
  try { if (code) localStorage.setItem(codeKey(room), code); else localStorage.removeItem(codeKey(room)); } catch { /* private window: ask again next time */ }
}

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
  const code = savedCode(room);
  if (code) url.searchParams.set("code", code);
  let peers = 0;
  let floor: FloorState | undefined;
  let locked = false;
  let full: Full | null = null;
  opts.onStatus({ state: "connecting", peers });
  const link = connectSocket<ServerMsg, ClientMsg>(url, {
    decode: decodeServer, queue: 200,
    onMessage: (m) => {
      if (m.t === "snapshot") { opts.onSnapshot(m.project); opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "op") opts.onOp(m.op);
      else if (m.t === "live") opts.onLive(m.from, m.e);
      else if (m.t === "gone") opts.onGone(m.from);
      else if (m.t === "peers") { peers = m.n; opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "floor") { floor = { state: m.state, host: m.host }; opts.onStatus({ state: "online", peers, floor, locked }); }
      else if (m.t === "full") full = m.why;
      else if (m.t === "lock") {
        // the maker changed it: keep the new one, or this tab's next reconnect is turned away
        if (m.code !== undefined) { saveCode(room, m.code); if (m.code) url.searchParams.set("code", m.code); else url.searchParams.delete("code"); }
        locked = m.on;
        opts.onStatus({ state: "online", peers, floor, locked });
      }
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
    lock: (code) => { link.send({ t: "lock", code }); },
    close: () => link.close(),
  };
}
